"""
Ayurveda OPD Intelligence — FastAPI Backend Server
===================================================
Provides:
  1. SQLite persistence for patients, dictations, check-ins
  2. WebSocket bridge: React ↔ this server ↔ Gemini Live API (voice)
  3. REST endpoints for LLM extraction (intake, dictation, check-in)
  4. Health check, transcript listing
"""

import sqlite3
import os

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from contextlib import asynccontextmanager

load_dotenv()

try:
    import websockets
except ImportError:
    raise ImportError("pip install websockets")

# Import from new modular structure
from config import GEMINI_API_KEY, GEMINI_LIVE_URI, DB_PATH, VOICE_SYSTEM_INSTRUCTION, DICTATION_SYSTEM_INSTRUCTION
from models import PatientCreate, PatientUpdate, IntakeExtractionRequest, DictationRequest, CheckinRequest, SummaryRequest, PrescriptionItem, VisitRecord, VisitExtractionResponse
from utils import (
    get_db, active_sessions, call_gemini_text,
    extract_missing_intake_fields, is_missing_intake_value,
    build_local_intake_fallback, sanitize_intake_transcript,
    build_local_visit_fallback, extract_dictation_cues_from_transcript,
    compose_doctor_notes
)


# ═══════════════════════════════════════════════════════════════════════════════
# DATABASE SETUP
# ═══════════════════════════════════════════════════════════════════════════════

def init_db():
    """Initialize SQLite database with all tables."""
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()

    c.execute("""
        CREATE TABLE IF NOT EXISTS patients (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            age INTEGER,
            gender TEXT,
            chief_complaint TEXT,
            symptoms TEXT,
            duration TEXT,
            severity TEXT,
            dosha TEXT,
            prakriti TEXT,
            vitals TEXT,
            red_flags TEXT,
            aggravating_factors TEXT,
            diet TEXT,
            sleep TEXT,
            bowel TEXT,
            current_medications TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
    """)

    c.execute("""
        CREATE TABLE IF NOT EXISTS intakes (
            id TEXT PRIMARY KEY,
            patient_id TEXT NOT NULL,
            chief_complaint TEXT,
            symptoms TEXT,
            duration TEXT,
            severity TEXT,
            dosha TEXT,
            prakriti TEXT,
            vitals TEXT,
            red_flags TEXT,
            aggravating_factors TEXT,
            diet TEXT,
            sleep TEXT,
            bowel TEXT,
            current_medications TEXT,
            raw_transcript TEXT,
            extraction_json TEXT,
            created_at TEXT NOT NULL,
            FOREIGN KEY (patient_id) REFERENCES patients(id)
        )
     """)

    c.execute("""
        CREATE TABLE IF NOT EXISTS dictations (
            id TEXT PRIMARY KEY,
            patient_id TEXT,
            raw_transcript TEXT NOT NULL,
            structured_note TEXT,
            checkin_questions TEXT,
            status TEXT NOT NULL DEFAULT 'processing',
            created_at TEXT NOT NULL,
            FOREIGN KEY (patient_id) REFERENCES patients(id)
        )
    """)

    c.execute("""
        CREATE TABLE IF NOT EXISTS visits (
            id TEXT PRIMARY KEY,
            patient_id TEXT NOT NULL,
            raw_transcript TEXT,
            extracted_json TEXT,
            diagnosis_ayurveda TEXT,
            diagnosis_icd11 TEXT,
            prakriti_observed TEXT,
            fasting_glucose REAL,
            herbs TEXT,              -- JSON array of {name, dose, timing, vehicle}
            diet_restrictions TEXT,  -- JSON array
            lifestyle_advice TEXT,   -- JSON array
            followup_days INTEGER,
            doctor_notes TEXT,
            needs_review TEXT,       -- JSON array of field names needing manual review
            status TEXT DEFAULT 'draft',  -- draft, reviewed, confirmed, prescription_added
            visit_date TEXT NOT NULL,
            created_at TEXT NOT NULL,
            FOREIGN KEY (patient_id) REFERENCES patients(id)
        )
     """)

    c.execute("""
        CREATE TABLE IF NOT EXISTS checkin_templates (
            id TEXT PRIMARY KEY,
            visit_id TEXT NOT NULL,
            question_hi TEXT NOT NULL,
            question_en TEXT NOT NULL,
            day_range_start INTEGER NOT NULL DEFAULT 1,
            day_range_end INTEGER NOT NULL,
            herb_name TEXT, -- linked prescription item
            created_at TEXT NOT NULL,
            FOREIGN KEY (visit_id) REFERENCES visits(id)
        )
    """)

    c.execute("""
        CREATE TABLE IF NOT EXISTS checkins (
            id TEXT PRIMARY KEY,
            patient_id TEXT,
            date TEXT NOT NULL,
            responses TEXT,      -- JSON array of check-in answers
            summary TEXT,        -- JSON of full intake summary
            chief_complaint TEXT,
            duration TEXT,
            severity INTEGER,
            aggravating_factors TEXT,
            relieving_factors TEXT,
            diet TEXT,
            sleep TEXT,
            bowel TEXT,
            current_medications TEXT,
            created_at TEXT NOT NULL,
            FOREIGN KEY (patient_id) REFERENCES patients(id)
        )
    """)

    c.execute("""
        CREATE TABLE IF NOT EXISTS postvisit_checkins (
            id TEXT PRIMARY KEY,
            patient_id TEXT,
            visit_id TEXT,
            date TEXT NOT NULL,
            questions TEXT NOT NULL,
            responses TEXT NOT NULL,
            analysis TEXT,
            created_at TEXT NOT NULL,
            FOREIGN KEY (patient_id) REFERENCES patients(id)
        )
    """)

    # ─── Daily check-in logs for post-visit monitoring ─────────────────────────────
    c.execute("""
        CREATE TABLE IF NOT EXISTS daily_logs (
            id TEXT PRIMARY KEY,
            visit_id TEXT NOT NULL,
            patient_id TEXT,
            day_number INTEGER NOT NULL,
            date TEXT NOT NULL,
            questions TEXT NOT NULL,  -- JSON array of {question_hi, question_en}
            responses TEXT NOT NULL,   -- JSON array of {answer, answered_at}
            severity_today INTEGER,   -- 1-10 self-reported severity
            adherence_score INTEGER,  -- 0-3 count of "yes" answers
            created_at TEXT NOT NULL,
            FOREIGN KEY (visit_id) REFERENCES visits(id),
            FOREIGN KEY (patient_id) REFERENCES patients(id)
        )
    """)

    # ─── Transcription storage for voice sessions ──────────────────────────────────
    c.execute("""
        CREATE TABLE IF NOT EXISTS transcripts (
            id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            content TEXT NOT NULL,
            created_at TEXT NOT NULL
        )
    """)

    # ─── Schema migration: add new columns if they don't exist ─────────────────
    # This ensures existing databases get the new fields without data loss.
    _migrations = [
        ("patients", [
            ("aggravating_factors", "TEXT"),
            ("diet", "TEXT"),
            ("sleep", "TEXT"),
            ("bowel", "TEXT"),
            ("current_medications", "TEXT"),
            ("last_visit_id", "TEXT"),
        ]),
        ("intakes", [
            ("aggravating_factors", "TEXT"),
            ("diet", "TEXT"),
            ("sleep", "TEXT"),
            ("bowel", "TEXT"),
            ("current_medications", "TEXT"),
            ("summary", "TEXT"),
        ]),
        ("dictations", [
            ("diagnosis_ayurveda", "TEXT"),
            ("diagnosis_icd11", "TEXT"),
            ("prakriti_observed", "TEXT"),
            ("vitals", "TEXT"),
            ("diet_restrictions", "TEXT"),
            ("diet_recommendations", "TEXT"),
            ("lifestyle_advice", "TEXT"),
            ("followup_days", "INTEGER"),
            ("additional_notes", "TEXT"),
        ]),
        ("visits", [
            ("raw_transcript", "TEXT"),
            ("extracted_json", "TEXT"),
            ("prakriti_observed", "TEXT"),
            ("fasting_glucose", "REAL"),
            ("herbs", "TEXT"),
            ("doctor_notes", "TEXT"),
            ("needs_review", "TEXT"),
            ("status", "TEXT"),
            ("severity_initial", "INTEGER"),  # baseline severity from intake
            ("alert_flag", "INTEGER"),         # 1 if alert triggered, 0 otherwise
            ("updated_at", "TEXT"),
            ("intake_id", "TEXT"),             # FK to intakes.id — links visit to patient's intake
        ]),
        ("daily_logs", [
            ("visit_id", "TEXT"),
            ("patient_id", "TEXT"),
            ("day_number", "INTEGER"),
            ("date", "TEXT"),
            ("questions", "TEXT"),
            ("responses", "TEXT"),
            ("severity_today", "INTEGER"),
            ("adherence_score", "INTEGER"),
            ("created_at", "TEXT"),
        ]),
    ]
    for table, columns in _migrations:
        c.execute(f"PRAGMA table_info({table})")
        existing = {row[1] for row in c.fetchall()}
        for col_name, col_type in columns:
            if col_name not in existing:
                c.execute(f"ALTER TABLE {table} ADD COLUMN {col_name} {col_type}")
                print(f"   [OK] Added column '{col_name}' to '{table}'")

    conn.commit()
    conn.close()
    print(f"[DB] Database initialized: {DB_PATH}")


# ═══════════════════════════════════════════════════════════════════════════════
# FASTAPI APP
# ═══════════════════════════════════════════════════════════════════════════════

@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    yield

app = FastAPI(title="Ayurveda OPD Intelligence", version="1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ═══════════════════════════════════════════════════════════════════════════════
# ROUTERS
# ═══════════════════════════════════════════════════════════════════════════════

from routers.patients import router as patients_router
from routers.intake import router as intake_router
from routers.dictation import router as dictation_router
from routers.checkin import router as checkin_router
from routers.websockets import router as websockets_router

app.include_router(patients_router)
app.include_router(intake_router)
app.include_router(dictation_router)
app.include_router(checkin_router)
app.include_router(websockets_router)
