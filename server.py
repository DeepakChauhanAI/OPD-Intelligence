"""
Ayurveda OPD Intelligence — FastAPI Backend Server
===================================================
Provides:
  1. SQLite persistence for patients, dictations, check-ins
  2. WebSocket bridge: React ↔ this server ↔ Gemini Live API (voice)
  3. REST endpoints for LLM extraction (intake, dictation, check-in)
  4. Health check, transcript listing
"""

import asyncio
import base64
import json
import os
import sqlite3
import re
import time
import urllib.request
import urllib.error
from contextlib import asynccontextmanager
from datetime import datetime
from typing import Optional

from dotenv import load_dotenv
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, UploadFile, File, Body
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

load_dotenv()

try:
    import websockets
except ImportError:
    raise ImportError("pip install websockets")

# ═══════════════════════════════════════════════════════════════════════════════
# CONFIGURATION
# ═══════════════════════════════════════════════════════════════════════════════

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
if not GEMINI_API_KEY:
    raise ValueError("Set GEMINI_API_KEY in your .env file")

VOICE_MODEL = "models/gemini-2.5-flash-native-audio-latest"
TEXT_MODEL = "gemini-2.5-flash"
API_VERSION = "v1alpha"
INPUT_RATE = 16000
OUTPUT_RATE = 24000

GEMINI_LIVE_URI = (
    f"wss://generativelanguage.googleapis.com/ws/"
    f"google.ai.generativelanguage.{API_VERSION}"
    f".GenerativeService.BidiGenerateContent"
    f"?key={GEMINI_API_KEY}"
)

GEMINI_TEXT_API = (
    f"https://generativelanguage.googleapis.com/v1beta/"
    f"models/{TEXT_MODEL}:generateContent"
    f"?key={GEMINI_API_KEY}"
)

DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "opd_data.db")

# ═══════════════════════════════════════════════════════════════════════════════
# SYSTEM INSTRUCTIONS
# ═══════════════════════════════════════════════════════════════════════════════

VOICE_SYSTEM_INSTRUCTION = """You are Dhara, an Ayurvedic medical intake AI assistant for an OPD clinic.
Your voice should be warm, calm, and slightly slower than normal conversation.

IMPORTANT RULES:
1. You are NOT a doctor. You only collect information.
2. Ask exactly the questions below, in this exact order.
3. Ask only one question at a time.
4. Keep each turn short and natural.
5. If the patient gives a vague answer, gently ask for a brief clarification.
6. Do not invent or add extra questions.
7. After the final question, give a short closing acknowledgement and stop asking questions.
8. When the intake is complete, first summarize the patient's assessment in 3 to 4 short lines in simple Hinglish, then ask: "Kya ye vivran aapke anusaar sahi hai?"

QUESTION FLOW:
1. "Namskaar, Mere naam Dhara hai. Main aapka swasthya vivaran lene aayi hoon. Aaj aap kis takleef ke liye aaye hain?"
2. "Yeh takleef kab se hai? Kitne din, hafte, ya mahine?"
3. "1 se 10 mein, aaj aapki takleef kitni hai? 1 = bahut halki, 10 = bahut zyada."
4. "Kya koi cheez ise aur badha deti hai — jaise khaana, mausam, ya samay?"
5. "Aap roz kya khaate hain — zyaada tala hua, khatta, teekha, ya saada?"
6. "Neend kaisi hai? Raat ko kayi baar uthna padta hai?"
7. "Petcchala ya kabz — kuch takleef hai?"
8. "Koi dawai, kadha, ya Ayurvedic cheez le rahe hain abhi?"

CLOSING:
After the last answer, briefly summarize the conversation in 3 to 4 short lines in simple Hinglish.
Then ask: "Kya ye vivran aapke anusaar sahi hai?"
Wait for the patient's yes/no confirmation before ending.
Do not ask a new medical question after the summary.

VOICE STYLE:
- Short sentences. Natural speech. Kind tone.
- If the patient sounds distressed, acknowledge it briefly.
"""

# ═══════════════════════════════════════════════════════════════════════════════
# DICTATION-SPECIFIC SYSTEM INSTRUCTION
# ═══════════════════════════════════════════════════════════════════════════════

DICTATION_SYSTEM_INSTRUCTION = """You are a professional medical transcription engine for an Ayurvedic doctor.
Your ONLY output must be the raw, verbatim text of the doctor's dictation.

CRITICAL FORMATTING RULES:
1. No Markdown: NEVER use bold text (**...**), headers (#), or lists unless explicitly dictated.
2. No Commentary: NEVER include "Transcribing...", "Thinking...", or any headers describing your actions.
3. No Thinking Blocks: NEVER output text wrapped in <think> tags or similar blocks.
4. No Bold: Total prohibition on double asterisks (**).
5. No Prose: Output ONLY the spoken words. Do not introduce with "Here is the transcript:" or similar.
6. Verbatim: Preserve all medical terminology, herb names, dosages, and timings exactly as spoken.
7. Silence: If the doctor is not speaking, or there is only background noise, output NOTHING. Remain completely silent.

LANGUAGE CONTEXT:
The doctor may speak in English, Hindi, or a Hinglish mix. Transcribe exactly as spoken.
Output ONLY the transcription. Do not think out loud. Do not show reasoning.
"""


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
            herb_name TEXT,  -- linked prescription item
            created_at TEXT NOT NULL,
            FOREIGN KEY (visit_id) REFERENCES visits(id)
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
        ("checkins", [
            ("chief_complaint", "TEXT"),
            ("duration", "TEXT"),
            ("severity", "INTEGER"),
            ("aggravating_factors", "TEXT"),
            ("relieving_factors", "TEXT"),
            ("diet", "TEXT"),
            ("sleep", "TEXT"),
            ("bowel", "TEXT"),
            ("current_medications", "TEXT"),
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


def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


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

active_sessions = {}


# ═══════════════════════════════════════════════════════════════════════════════
# PYDANTIC MODELS
# ═══════════════════════════════════════════════════════════════════════════════

class PatientCreate(BaseModel):
    name: str
    age: Optional[int] = None
    gender: Optional[str] = None
    chief_complaint: Optional[str] = None
    symptoms: Optional[list[str]] = []
    duration: Optional[str] = None
    severity: Optional[str] = None
    dosha: Optional[str] = None
    prakriti: Optional[str] = None


class PatientUpdate(BaseModel):
    name: Optional[str] = None
    age: Optional[int] = None
    gender: Optional[str] = None
    chief_complaint: Optional[str] = None
    symptoms: Optional[list[str]] = None
    duration: Optional[str] = None
    severity: Optional[str] = None
    dosha: Optional[str] = None
    prakriti: Optional[str] = None
    aggravating_factors: Optional[str] = None
    diet: Optional[str] = None
    sleep: Optional[str] = None
    bowel: Optional[str] = None
    current_medications: Optional[str] = None


class IntakeExtractionRequest(BaseModel):
    transcript: str
    patient_id: Optional[str] = None
    language: str = "en"


class DictationRequest(BaseModel):
    transcript: str
    patient_id: Optional[str] = None


class CheckinRequest(BaseModel):
    patient_id: Optional[str] = None
    responses: list[dict]


class SummaryRequest(BaseModel):
    transcript_text: str
    session_id: Optional[str] = None


# ─── Visit Processing Models ────────────────────────────────────────────────────

class PrescriptionItem(BaseModel):
    name: str
    dose: Optional[str] = None
    timing: Optional[str] = None
    frequency: Optional[str] = None
    route: Optional[str] = None  # oral/topical/etc
    duration: Optional[str] = None


class VisitRecord(BaseModel):
    diagnosis_ayurveda: str
    diagnosis_icd11: Optional[str] = None
    prescriptions: list[PrescriptionItem] = []
    lifestyle_advice: list[str] = []
    diet_restrictions: list[str] = []
    followup_days: Optional[int] = None
    additional_notes: Optional[str] = None


class VisitExtractionResponse(BaseModel):
    success: bool
    visit: VisitRecord
    checkin_questions: list[str] = []
    error: Optional[str] = None


# ═══════════════════════════════════════════════════════════════════════════════
# GEMINI TEXT API HELPER
# ═══════════════════════════════════════════════════════════════════════════════

def call_gemini_text(prompt: str, system_instruction: str = "", temperature: float = 0.2) -> dict:
    """Call Gemini text API and return parsed JSON."""
    body = {
        "contents": [{"role": "user", "parts": [{"text": prompt}]}],
        "generationConfig": {
            "temperature": temperature,
            "responseMimeType": "application/json",
        },
    }
    if system_instruction:
        body["systemInstruction"] = {"parts": [{"text": system_instruction}]}

    req_data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(
        GEMINI_TEXT_API,
        data=req_data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    last_error = None
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=30) as response:
                response_body = response.read().decode("utf-8")
            break
        except urllib.error.HTTPError as exc:
            last_error = exc
            retryable_statuses = {429, 500, 502, 503, 504}
            if exc.code not in retryable_statuses or attempt == 2:
                raise
            time.sleep(1.5 * (attempt + 1))
        except urllib.error.URLError as exc:
            last_error = exc
            if attempt == 2:
                raise
            time.sleep(1.5 * (attempt + 1))
    else:
        raise RuntimeError(f"Gemini text call failed: {last_error}")

    response_json = json.loads(response_body)
    candidates = response_json.get("candidates", [])
    if not candidates:
        raise ValueError("No candidates in Gemini response")

    raw_text = candidates[0]["content"]["parts"][0]["text"]

    # Clean markdown fences
    clean = raw_text.strip()
    if clean.startswith("```"):
        lines = clean.split("\n")
        lines = [l for l in lines if not l.strip().startswith("```")]
        clean = "\n".join(lines).strip()

    return json.loads(clean)


def is_missing_intake_value(value) -> bool:
    """Treat blank and placeholder intake values as missing."""
    if value in (None, "", [], {}):
        return True

    if isinstance(value, list):
        return not value or all(is_missing_intake_value(item) for item in value)

    if isinstance(value, dict):
        return not bool(value)

    if isinstance(value, str):
        normalized = re.sub(r"\s+", " ", value.strip().lower())
        placeholder_patterns = [
            r"^not (captured|discussed|mentioned|noted|reported)$",
            r"^diet not discussed$",
            r"^sleep not discussed$",
            r"^bowel habits not discussed$",
            r"^bowel not discussed$",
            r"^no (current )?(medications|medicines|medicine|prior treatments|relieving factors|aggravating factors)( reported| mentioned| noted)?$",
            r"^no.*(diet|sleep|bowel|medication|treatment).*$",
            r"^unknown$",
            r"^none$",
            r"^n/?a$",
            r"^na$",
        ]
        return any(re.match(pattern, normalized) for pattern in placeholder_patterns)

    return False


def parse_transcript_turns(transcript: str) -> list[dict]:
    """Parse labeled transcript lines into speaker turns."""
    turns = []
    current_speaker = None

    for raw_line in transcript.splitlines():
        line = re.sub(r"^\[.*?\]\s*", "", raw_line.strip())
        if not line:
            continue

        speaker_match = re.match(
            r"^(Dhara|Patient|Doctor|User|Pt|Assistant)\s*:\s*(.*)$",
            line,
            flags=re.IGNORECASE,
        )
        if speaker_match:
            speaker = speaker_match.group(1).strip().lower()
            text = speaker_match.group(2).strip()
            speaker = "Dhara" if speaker in {"dhara", "doctor", "assistant"} else "Patient"
            current_speaker = speaker
            turns.append({"speaker": speaker, "text": text})
            continue

        if turns and current_speaker:
            turns[-1]["text"] = f"{turns[-1]['text']} {line}".strip()
        else:
            turns.append({"speaker": "Patient", "text": line})
            current_speaker = "Patient"

    return turns


def build_intake_answer_blocks(transcript: str) -> list[str]:
    """Return the patient answers for the eight fixed Dhara questions."""
    turns = parse_transcript_turns(transcript)
    answer_blocks = []
    dhara_turn_indexes = [index for index, turn in enumerate(turns) if turn["speaker"] == "Dhara"]

    for question_position in range(8):
        if question_position >= len(dhara_turn_indexes):
            answer_blocks.append("")
            continue

        dhara_index = dhara_turn_indexes[question_position]
        next_dhara_index = next(
            (index for index in dhara_turn_indexes if index > dhara_index),
            len(turns),
        )
        answer_texts = [
            turn["text"]
            for turn in turns[dhara_index + 1 : next_dhara_index]
            if turn["speaker"] == "Patient" and turn["text"].strip()
        ]
        answer_blocks.append(" ".join(answer_texts).strip())

    return answer_blocks


def extract_missing_intake_fields(transcript: str, existing_patient: dict) -> dict:
    """Fill gaps for intake fields that the main extractor missed."""
    missing_fields = []
    field_map = {
        "diet_pattern": existing_patient.get("diet_pattern") or existing_patient.get("diet"),
        "sleep_quality": existing_patient.get("sleep_quality") or existing_patient.get("sleep"),
        "bowel_habits": existing_patient.get("bowel_habits") or existing_patient.get("bowel"),
        "currentMedications": existing_patient.get("currentMedications"),
        "prior_treatments": existing_patient.get("prior_treatments"),
        "relievingFactors": existing_patient.get("relievingFactors"),
    }

    for field_name, current_value in field_map.items():
        if is_missing_intake_value(current_value):
            missing_fields.append(field_name)

    if not missing_fields:
        return {}

    system_instruction = """You extract only missing intake fields from an Ayurveda patient transcript.
Output ONLY valid JSON.
If a field is not clearly mentioned, return null.
Do not invent anything."""

    answer_blocks = build_intake_answer_blocks(transcript)
    segmented_transcript = "\n".join(
        f"Q{index + 1} patient answer: {answer_blocks[index] or 'not mentioned'}"
        for index in range(len(answer_blocks))
    )

    prompt = f"""Transcript:
{transcript}

Structured answer blocks:
{segmented_transcript}

Fill only these fields if they are explicitly mentioned:
{", ".join(missing_fields)}

Return exactly this JSON:
{{
  "diet_pattern": string | null,
  "sleep_quality": string | null,
  "bowel_habits": string | null,
  "currentMedications": string[] | null,
  "prior_treatments": string[] | null,
  "relievingFactors": string[] | null
}}"""

    try:
        return call_gemini_text(prompt, system_instruction, temperature=0.1)
    except Exception as exc:
        print(f"[WARN] Missing-field intake extraction failed: {exc}")
        return {}


def build_local_intake_fallback(transcript: str) -> dict:
    """Best-effort local extraction when Gemini is unavailable."""
    def clean_line(line: str) -> str:
        cleaned = re.sub(r"^\[.*?\]\s*", "", line.strip())
        cleaned = re.sub(r"^(Dhara|Patient|Doctor|User|Pt)\s*:\s*", "", cleaned, flags=re.IGNORECASE)
        return cleaned.strip()

    answer_lines = [clean_line(line) for line in build_intake_answer_blocks(transcript)]
    patient_text = " ".join(line for line in answer_lines if line) if answer_lines else clean_line(transcript)
    lower_text = patient_text.lower()

    def line_at(index: int) -> str:
        return answer_lines[index] if index < len(answer_lines) else ""

    def first_matching_line(index: int, keywords: list[str]) -> str:
        candidate = line_at(index)
        candidate_lower = candidate.lower()
        if candidate and any(keyword in candidate_lower for keyword in keywords):
            return candidate
        for line in answer_lines:
            line_lower = line.lower()
            if any(keyword in line_lower for keyword in keywords):
                return line
        return candidate

    complaint = first_matching_line(0, ["pain", "problem", "takleef", "complaint", "dard", "issue"]) or "not captured"
    duration_text = first_matching_line(1, ["din", "day", "days", "hafte", "week", "weeks", "mahine", "month", "months"])
    severity_text = first_matching_line(2, ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "severity"])
    aggravating_text = first_matching_line(3, ["badh", "worse", "increase", "heat", "khaana", "mausam", "samay"])
    diet_text = first_matching_line(4, ["diet", "khata", "khaate", "khana", "saada", "teekha", "tala"])
    sleep_text = first_matching_line(5, ["sleep", "neend", "sona", "uthna"])
    bowel_text = first_matching_line(6, ["bowel", "kabz", "petcchala", "pet chala", "constipation", "stool"])
    meds_text = first_matching_line(7, ["dawai", "medicine", "medications", "kadha", "ayurvedic", "churna", "vati"])
    relieving_text = first_matching_line(3, ["relief", "better", "behtar", "kam", "sukoon", "relieving"])
    prior_treatments_text = first_matching_line(7, ["treatment", "इलाज", "upchar", "therapy", "cure"])

    duration_match = re.search(r"(\d+\s*(?:din|days?|hafte|weeks?|mahine|months?))", duration_text or lower_text)
    severity_match = re.search(r"\b(10|[1-9])\b", severity_text or lower_text)

    aggravating = aggravating_text if aggravating_text else "no aggravating factors noted"
    diet = diet_text if diet_text else "diet not discussed"
    sleep = sleep_text if sleep_text else "sleep not discussed"
    bowel = bowel_text if bowel_text else "bowel habits not discussed"
    medications = meds_text if meds_text else "no current medications reported"
    relieving = relieving_text if relieving_text else "no relieving factors noted"
    prior_treatments = prior_treatments_text if prior_treatments_text else "no prior treatments reported"

    summary_lines = [
        f"Chief complaint: {complaint}.",
        f"Duration: {duration_match.group(1) if duration_match else 'not captured'}. Severity: {severity_match.group(1) if severity_match else 'not captured'}/10. Aggravating factors: {aggravating}.",
        f"Relieving factors: {relieving}. Diet: {diet}. Sleep: {sleep}.",
        f"Bowel: {bowel}. Medications: {medications}. Prior treatments: {prior_treatments}. Dosha flag: not specified.",
    ]

    patient = {
        "name": None,
        "age": None,
        "gender": None,
        "chiefComplaint": complaint,
        "symptoms": [],
        "duration": duration_match.group(1) if duration_match else None,
        "severity": int(severity_match.group(1)) if severity_match else None,
        "aggravatingFactors": [aggravating] if aggravating else None,
        "relievingFactors": [relieving] if relieving else None,
        "diet_pattern": diet,
        "sleep_quality": sleep,
        "bowel_habits": bowel,
        "currentMedications": [medications] if medications else None,
        "prior_treatments": [prior_treatments] if prior_treatments else None,
        "dosha": None,
        "prakriti": None,
        "redFlags": [],
        "summary": "\n".join(summary_lines),
    }

    return {
        "status": "incomplete",
        "patient": patient,
        "ask_followup": "Gemini unavailable; fallback extraction used.",
        "emergency_alert": None,
        "ayurvedic_assessment": {
            "dosha_imbalance": [],
            "probable_diagnosis": "Fallback extraction only",
            "suggested_herbs": [],
            "lifestyle_advice": [],
            "further_investigation": [],
        },
        "summary_text": "\n".join(summary_lines),
    }



# ═══════════════════════════════════════════════════════════════════════════════
# REST ENDPOINTS — Health & Patients
# ═══════════════════════════════════════════════════════════════════════════════

@app.get("/api/health")
async def health():
    return {
        "status": "online",
        "voice_model": VOICE_MODEL,
        "text_model": TEXT_MODEL,
        "active_sessions": len(active_sessions),
    }


@app.get("/api/patients")
async def list_patients():
    db = get_db()
    rows = db.execute("SELECT * FROM patients ORDER BY updated_at DESC").fetchall()
    db.close()
    patients = []
    for r in rows:
        patients.append({
            "id": r["id"],
            "name": r["name"],
            "age": r["age"],
            "gender": r["gender"],
            "chiefComplaint": r["chief_complaint"],
            "symptoms": json.loads(r["symptoms"] or "[]"),
            "duration": r["duration"],
            "severity": r["severity"],
            "dosha": r["dosha"],
            "prakriti": r["prakriti"],
            "vitals": json.loads(r["vitals"] or "{}") if r["vitals"] else None,
            "redFlags": json.loads(r["red_flags"] or "[]"),
            "aggravatingFactors": r["aggravating_factors"],
            "diet": r["diet"],
            "sleep": r["sleep"],
            "bowel": r["bowel"],
            "currentMedications": r["current_medications"],
            "timestamp": r["created_at"],
            "updatedAt": r["updated_at"],
        })
    return {"patients": patients}


@app.post("/api/patients")
async def create_patient(patient: PatientCreate):
    pid = f"patient-{int(datetime.now().timestamp() * 1000)}"
    now = datetime.now().isoformat()
    db = get_db()
    db.execute(
        """INSERT INTO patients (id, name, age, gender, chief_complaint, symptoms, 
           duration, severity, dosha, prakriti, vitals, red_flags, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (pid, patient.name, patient.age, patient.gender, patient.chief_complaint,
         json.dumps(patient.symptoms or []), patient.duration, patient.severity,
         patient.dosha, patient.prakriti, None, json.dumps([]), now, now),
    )
    db.commit()
    db.close()
    return {"id": pid, "name": patient.name, "created_at": now}


@app.get("/api/patients/{patient_id}")
async def get_patient(patient_id: str):
    db = get_db()
    r = db.execute("SELECT * FROM patients WHERE id = ?", (patient_id,)).fetchone()
    db.close()
    if not r:
        return {"error": "Patient not found"}, 404
    return {
        "id": r["id"],
        "name": r["name"],
        "age": r["age"],
        "gender": r["gender"],
        "chiefComplaint": r["chief_complaint"],
        "symptoms": json.loads(r["symptoms"] or "[]"),
        "duration": r["duration"],
        "severity": r["severity"],
        "dosha": r["dosha"],
        "prakriti": r["prakriti"],
        "vitals": json.loads(r["vitals"] or "{}") if r["vitals"] else None,
        "redFlags": json.loads(r["red_flags"] or "[]"),
        "aggravatingFactors": r["aggravating_factors"],
        "diet": r["diet"],
        "sleep": r["sleep"],
        "bowel": r["bowel"],
        "currentMedications": r["current_medications"],
        "timestamp": r["created_at"],
    }


@app.get("/api/patients/{patient_id}/intake-summary")
async def get_patient_intake_summary(patient_id: str):
    """
    Returns the most recent intake record for a patient, formatted as a
    concise clinical summary for the doctor's pre-consultation brief.
    """
    db = get_db()
    row = db.execute(
        """SELECT i.*, p.name, p.age, p.gender
           FROM intakes i
           JOIN patients p ON i.patient_id = p.id
           WHERE i.patient_id = ?
           ORDER BY i.created_at DESC LIMIT 1""",
        (patient_id,)
    ).fetchone()
    db.close()

    if not row:
        return {"success": True, "intake": None}  # No intake yet — not an error

    def safe_json(val):
        if val is None:
            return []
        try:
            return json.loads(val)
        except Exception:
            return val

    return {
        "success": True,
        "intake": {
            "id": row["id"],
            "patient_name": row["name"],
            "patient_age": row["age"],
            "patient_gender": row["gender"],
            "chief_complaint": row["chief_complaint"],
            "symptoms": safe_json(row["symptoms"]),
            "duration": row["duration"],
            "severity": row["severity"],
            "aggravating_factors": safe_json(row.get("aggravating_factors")),
            "diet": row.get("diet"),
            "sleep": row.get("sleep"),
            "bowel": row.get("bowel"),
            "current_medications": safe_json(row.get("current_medications")),
            "dosha": row["dosha"],
            "prakriti": row["prakriti"],
            "red_flags": safe_json(row["red_flags"]),
            "summary": row.get("summary"),
            "created_at": row["created_at"],
        },
    }


@app.put("/api/patients/{patient_id}")
async def update_patient(patient_id: str, patient: PatientUpdate):
    db = get_db()
    existing = db.execute("SELECT * FROM patients WHERE id = ?", (patient_id,)).fetchone()
    if not existing:
        db.close()
        return {"error": "Patient not found"}

    now = datetime.now().isoformat()
    updates = {}
    if patient.name is not None:
        updates["name"] = patient.name
    if patient.age is not None:
        updates["age"] = patient.age
    if patient.gender is not None:
        updates["gender"] = patient.gender
    if patient.chief_complaint is not None:
        updates["chief_complaint"] = patient.chief_complaint
    if patient.symptoms is not None:
        updates["symptoms"] = json.dumps(patient.symptoms)
    if patient.duration is not None:
        updates["duration"] = patient.duration
    if patient.severity is not None:
        updates["severity"] = patient.severity
    if patient.dosha is not None:
        updates["dosha"] = patient.dosha
    if patient.prakriti is not None:
        updates["prakriti"] = patient.prakriti
    if patient.aggravating_factors is not None:
        updates["aggravating_factors"] = patient.aggravating_factors
    if patient.diet is not None:
        updates["diet"] = patient.diet
    if patient.sleep is not None:
        updates["sleep"] = patient.sleep
    if patient.bowel is not None:
        updates["bowel"] = patient.bowel
    if patient.current_medications is not None:
        updates["current_medications"] = patient.current_medications
    updates["updated_at"] = now

    if updates:
        set_clause = ", ".join(f"{k} = ?" for k in updates.keys())
        values = list(updates.values()) + [patient_id]
        db.execute(f"UPDATE patients SET {set_clause} WHERE id = ?", values)
        db.commit()

    db.close()
    return {"id": patient_id, "updated": True}


# ═══════════════════════════════════════════════════════════════════════════════
# REST ENDPOINTS — Intake Extraction (LLM)
# ═══════════════════════════════════════════════════════════════════════════════

@app.post("/api/extract-intake")
async def extract_intake(request: IntakeExtractionRequest):
    """Extract structured patient intake from transcript using Gemini."""
    lang_note = ""
    if request.language == "hi":
        lang_note = "The conversation may be in Hindi. Extract and return in English JSON."
    elif request.language == "hinglish":
        lang_note = "The conversation may be in Hinglish. Extract and return in English JSON."

    system_instruction = f"""You are an expert Ayurvedic clinical data extractor. 
{lang_note}
RULES:
- Output ONLY valid JSON, no markdown, no prose
- Never hallucinate symptoms or details not mentioned
- Return null for any field not mentioned
- Detect red flags (chest pain, unconsciousness, severe bleeding, etc.)
- Assess dosha imbalance based on symptoms when possible"""

    prompt = f"""Extract structured patient intake from this conversation transcript.
Important:
- The transcript contains both Dhara's questions and the patient's answers.
- Ignore Dhara's questions and summary lines when extracting facts.
- Use the patient's answers as the primary source of truth.
- Preserve any mentioned details instead of marking them as not discussed.
- If a patient answer exists anywhere in the transcript, map it into the matching field.
- Do not omit diet, sleep, bowel, medications, relieving factors, or prior treatments if they were mentioned.

"{request.transcript}"

Return this exact JSON structure (use null for missing fields):
{{
  "status": "complete" | "incomplete" | "emergency",
  "patient": {{
    "name": string | null,
    "age": number | null,
    "gender": "male" | "female" | "other" | null,
    "chiefComplaint": string | null,
    "symptoms": string[],
    "duration": string | null,
    "severity": number | null (1-10 scale),
    "aggravatingFactors": string[] | null,
    "relievingFactors": string[] | null,
    "diet_pattern": string | null,
    "sleep_quality": string | null,
    "bowel_habits": string | null,
    "currentMedications": string[] | null,
    "prior_treatments": string[] | null,
    "dosha": string | null,
    "prakriti": string | null,
    "redFlags": string[]
  }},
  "ask_followup": string | null,
  "emergency_alert": {{
    "triggered": boolean,
    "reason": string,
    "action": string
  }} | null,
  "ayurvedic_assessment": {{
    "dosha_imbalance": string[],
    "probable_diagnosis": string,
    "suggested_herbs": string[],
    "lifestyle_advice": string[],
    "further_investigation": string[]
  }} | null
}}"""

    try:
        data = call_gemini_text(prompt, system_instruction)

        patient_data = data.get("patient", {})
        missing_fields = extract_missing_intake_fields(request.transcript, patient_data)
        if missing_fields:
            if is_missing_intake_value(patient_data.get("diet_pattern")) and missing_fields.get("diet_pattern"):
                patient_data["diet_pattern"] = missing_fields.get("diet_pattern")
            if is_missing_intake_value(patient_data.get("sleep_quality")) and missing_fields.get("sleep_quality"):
                patient_data["sleep_quality"] = missing_fields.get("sleep_quality")
            if is_missing_intake_value(patient_data.get("bowel_habits")) and missing_fields.get("bowel_habits"):
                patient_data["bowel_habits"] = missing_fields.get("bowel_habits")
            if is_missing_intake_value(patient_data.get("currentMedications")) and missing_fields.get("currentMedications"):
                patient_data["currentMedications"] = missing_fields.get("currentMedications")
            if is_missing_intake_value(patient_data.get("prior_treatments")) and missing_fields.get("prior_treatments"):
                patient_data["prior_treatments"] = missing_fields.get("prior_treatments")
            if is_missing_intake_value(patient_data.get("relievingFactors")) and missing_fields.get("relievingFactors"):
                patient_data["relievingFactors"] = missing_fields.get("relievingFactors")
            data["patient"] = patient_data

        # Local red flag detection as safety net
        RED_FLAGS = [
            "chest pain", "unconscious", "severe bleeding", "not breathing",
            "seizure", "stroke", "paralysis", "heart attack", "coughing blood",
        ]
        lower_transcript = request.transcript.lower()
        local_flags = [f for f in RED_FLAGS if f in lower_transcript]
        if local_flags and data.get("status") != "emergency":
            data["status"] = "emergency"
            data["emergency_alert"] = {
                "triggered": True,
                "reason": f"Red flags detected: {', '.join(local_flags)}",
                "action": "Refer to emergency immediately",
            }

        # If patient_id provided, save as intake record
        if request.patient_id:
            patient_data = data.get("patient", {})
            aggravating_factors = patient_data.get("aggravatingFactors")
            relieving_factors = patient_data.get("relievingFactors")
            current_medications = patient_data.get("currentMedications")
            prior_treatments = patient_data.get("prior_treatments")
            if aggravating_factors is not None and not isinstance(aggravating_factors, str):
                aggravating_factors = json.dumps(aggravating_factors)
            if relieving_factors is not None and not isinstance(relieving_factors, str):
                relieving_factors = json.dumps(relieving_factors)
            if current_medications is not None and not isinstance(current_medications, str):
                current_medications = json.dumps(current_medications)
            if prior_treatments is not None and not isinstance(prior_treatments, str):
                prior_treatments = json.dumps(prior_treatments)
            diet_pattern = patient_data.get("diet_pattern") or patient_data.get("diet")
            sleep_quality = patient_data.get("sleep_quality") or patient_data.get("sleep")
            bowel_habits = patient_data.get("bowel_habits") or patient_data.get("bowel")
            dosha_flag = patient_data.get("dosha") or ((data.get('ayurvedic_assessment') or {}).get('dosha_imbalance') or 'not specified')
            summary_lines = [
                f"Chief complaint: {patient_data.get('chiefComplaint') or 'not captured'}.",
                f"Duration: {patient_data.get('duration') or 'not captured'}. Severity: {patient_data.get('severity') or 'not captured'}/10. Aggravating factors: {aggravating_factors or 'not noted'}.",
                f"Relieving factors: {relieving_factors or 'not noted'}. Diet: {diet_pattern or 'not discussed'}. Sleep: {sleep_quality or 'not discussed'}.",
                f"Bowel: {bowel_habits or 'not discussed'}. Medications: {current_medications or 'not reported'}. Prior treatments: {prior_treatments or 'not reported'}. Dosha flag: {dosha_flag}.",
            ]
            summary_text = "\n".join(summary_lines)
            db = get_db()
            intake_id = f"intake-{int(datetime.now().timestamp() * 1000)}"
            db.execute(
                """INSERT INTO intakes (id, patient_id, chief_complaint, symptoms, duration,
                   severity, aggravating_factors, diet, sleep, bowel, current_medications,
                   dosha, prakriti, vitals, red_flags, raw_transcript, extraction_json, summary, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (intake_id, request.patient_id,
                 patient_data.get("chiefComplaint"), json.dumps(patient_data.get("symptoms", [])),
                 patient_data.get("duration"), patient_data.get("severity"),
                 aggravating_factors, diet_pattern,
                 sleep_quality, bowel_habits,
                 current_medications,
                 patient_data.get("dosha"), patient_data.get("prakriti"),
                 None, json.dumps(patient_data.get("redFlags", [])),
                 request.transcript, json.dumps(data), summary_text, datetime.now().isoformat()),
            )
            # Also update patient record (if we have at least chief complaint)
            if patient_data.get("chiefComplaint"):
                db.execute(
                    """UPDATE patients SET chief_complaint = ?, symptoms = ?, duration = ?,
                       severity = ?, aggravating_factors = ?, diet = ?, sleep = ?, bowel = ?,
                       current_medications = ?, dosha = ?, prakriti = ?, red_flags = ?, updated_at = ? WHERE id = ?""",
                    (patient_data.get("chiefComplaint"), json.dumps(patient_data.get("symptoms", [])),
                     patient_data.get("duration"), patient_data.get("severity"),
                     aggravating_factors, diet_pattern,
                     sleep_quality, bowel_habits,
                     current_medications,
                     patient_data.get("dosha"), patient_data.get("prakriti"),
                     json.dumps(patient_data.get("redFlags", [])),
                     datetime.now().isoformat(), request.patient_id),
                )
            db.commit()
            db.close()

        return {"success": True, "data": data}

    except Exception as e:
        print(f"[ERROR] Intake extraction error: {e}")
        fallback = build_local_intake_fallback(request.transcript)
        if request.patient_id:
            fallback_patient = fallback.get("patient", {})
            summary_text = fallback.get("summary_text", "")
            db = get_db()
            intake_id = f"intake-{int(datetime.now().timestamp() * 1000)}"
            db.execute(
                """INSERT INTO intakes (id, patient_id, chief_complaint, symptoms, duration,
                   severity, aggravating_factors, diet, sleep, bowel, current_medications,
                   dosha, prakriti, vitals, red_flags, raw_transcript, extraction_json, summary, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (intake_id, request.patient_id,
                 fallback_patient.get("chiefComplaint"), json.dumps(fallback_patient.get("symptoms", [])),
                 fallback_patient.get("duration"), fallback_patient.get("severity"),
                 json.dumps(fallback_patient.get("aggravatingFactors", [])) if fallback_patient.get("aggravatingFactors") is not None else None,
                 fallback_patient.get("diet_pattern"),
                 fallback_patient.get("sleep_quality"), fallback_patient.get("bowel_habits"),
                 json.dumps(fallback_patient.get("currentMedications", [])) if fallback_patient.get("currentMedications") is not None else None,
                 fallback_patient.get("dosha"), fallback_patient.get("prakriti"),
                 None, json.dumps(fallback_patient.get("redFlags", [])),
                 request.transcript, json.dumps(fallback), summary_text, datetime.now().isoformat()),
            )
            db.commit()
            db.close()
        return {"success": True, "data": fallback}


# ═══════════════════════════════════════════════════════════════════════════════
# REST ENDPOINTS — Doctor Dictation (New Audio-based System)
# ═══════════════════════════════════════════════════════════════════════════════

class DictationTranscribeRequest(BaseModel):
    patient_id: Optional[str] = None
    language_hint: Optional[str] = "en"  # en, hi, hinglish




# ─── Audio Transcription using Gemini Multimodal ───────────────────────────────

@app.post("/api/dictation/transcribe")
async def dictation_transcribe(
    request: DictationTranscribeRequest,
    audio: UploadFile = File(...)
):
    """
    Step A: Transcribe doctor's audio dictation using Gemini Flash 2.5 multimodal.
    
    Input: audio blob (webm/mp4/wav)
    Output: {
      transcript: string,
      extracted: { ... structured JSON ... },
      needs_review: [field names],
      visit_id: string
    }
    """
    try:
        # Read audio bytes
        audio_bytes = await audio.read()
        audio_b64 = base64.b64encode(audio_bytes).decode("utf-8")
        
        # Detect MIME type from filename
        mime = "audio/webm"
        if audio.filename:
            if audio.filename.endswith(".mp4"):
                mime = "audio/mp4"
            elif audio.filename.endswith(".wav"):
                mime = "audio/wav"
            elif audio.filename.endswith(".m4a"):
                mime = "audio/mp4"

        # System instruction for pure transcription
        system_instruction = """You are a medical audio transcription engine.
Transcribe the audio accurately and completely.
- Language may be English, Hindi, or Hinglish mix
- Preserve all medical terminology, herb names, dosages, timings exactly as spoken
- Do NOT summarize, interpret, or correct
- Output ONLY the raw transcript text, nothing else"""

        # Build Gemini multimodal request
        contents = [
            {
                "role": "user",
                "parts": [
                    {
                        "text": "Transcribe this doctor's dictation accurately. Preserve all medical details, dosages, and timings exactly as spoken."
                    },
                    {
                        "inlineData": {
                            "mimeType": mime,
                            "data": audio_b64
                        }
                    }
                ]
            }
        ]

        body = {
            "contents": contents,
            "systemInstruction": {"parts": [{"text": system_instruction}]},
            "generationConfig": {
                "temperature": 0.0,
                "maxOutputTokens": 4096,
            }
        }

        # Call Gemini Text API (multimodal)
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{TEXT_MODEL}:generateContent?key={GEMINI_API_KEY}"
        req = urllib.request.Request(
            url,
            data=json.dumps(body).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST"
        )

        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                result = json.loads(resp.read())
                transcript = result["candidates"][0]["content"]["parts"][0]["text"]
        except urllib.error.HTTPError as e:
            error_body = e.read().decode()
            print(f"[ERROR] Gemini transcription failed: {e.code} - {error_body}")
            # Fallback mock response for testing
            transcript = "[Transcription failed - API error]"

        # Now extract structured data from transcript using LLM
        extracted = await extract_visit_from_transcript(transcript, request.patient_id)

        # Create provisional visit record
        visit_id = f"visit-{int(datetime.now().timestamp() * 1000)}"
        db = get_db()
        db.execute(
            """INSERT INTO visits (
                id, patient_id, raw_transcript, extracted_json,
                status, visit_date, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (
                visit_id,
                request.patient_id,
                transcript,
                json.dumps(extracted),
                "draft",
                datetime.now().strftime("%Y-%m-%d"),
                datetime.now().isoformat(),
            ),
        )
        db.commit()
        db.close()

        return {
            "success": True,
            "visit_id": visit_id,
            "transcript": transcript,
            "extracted": extracted,
            "needs_review": extracted.get("needs_review", []),
            "confidence": extracted.get("confidence", "medium"),
        }

    except Exception as e:
        print(f"[ERROR] Dictation transcription error: {e}")
        return {"success": False, "error": str(e)}


# ─── Structured Extraction from Transcript (LLM + Confidence Heuristics) ─────────

async def extract_visit_from_transcript(transcript: str, patient_id: Optional[str] = None) -> dict:
    """
    Step B: Extract structured visit data from transcript using Gemini Flash 2.5.
    Returns structured dict with 'needs_review' list of low-confidence fields.
    """
    system_instruction = """You are a clinical data extraction system for an Ayurveda OPD.
Extract structured data from the doctor's dictation transcript.
Return ONLY valid JSON — no prose, no markdown.

CRITICAL RULES:
- Use null for any field not explicitly mentioned
- Do NOT infer, hallucinate, or invent missing values
- Preserve exact dosage, timing, and herb names as spoken
- For herbs: always include name, dose, timing; vehicle can be null
- Output must be valid JSON matching the exact schema"""

    prompt = f"""Doctor's dictation transcript:

"{transcript}"

Extract and return EXACTLY this JSON:

{{
  "diagnosis_ayurveda": "string — Ayurvedic diagnosis name (e.g., 'Vatarakta', 'Sandhigata Vata', 'Prameha')",
  "diagnosis_icd": "string — ICD-11 code if identifiable, else null",
  "prakriti_observed": "string — observed Prakriti (Vata/Pitta/Kapha) if mentioned, else null",
  "fasting_glucose": "number — fasting blood glucose value in mg/dL if mentioned, else null",
  "herbs": [
    {{
      "name": "string — exact herb/medicine name (e.g., Chandraprabha vati, Triphala churna, Karela juice, Ashwagandha, Guduchi)",
      "dose": "string — exact dose as spoken (e.g., '2 tablets', '5g', '30ml', '1 cup')",
      "timing": "string — exact timing/frequency (e.g., 'morning empty stomach', 'twice daily after meals', 'at bedtime')",
      "vehicle": "string — anupana/vehicle (e.g., 'with warm water', 'with milk', 'before food') or null if not mentioned"
    }}
  ],
  "diet_restrictions": ["string — specific foods or behaviors to avoid (e.g., 'cold foods', ' sweets', 'fried items')"],
  "lifestyle_advice": ["string — specific activities/routines to follow (e.g., 'warm oil massage', 'gentle yoga', 'early bedtime')"],
  "followup_days": "number — days until next review (typically 7, 14, 21, or 30)",
  "doctor_notes": "string — any additional notes, observations, or patient complaints"
}}"""

    try:
        data = call_gemini_text(prompt, system_instruction, temperature=0.1)

        # Validate and normalize
        if not isinstance(data, dict):
            data = {}

        # Heuristic confidence scoring
        needs_review = []
        confidence = "high"

        # Check diagnosis_ayurveda
        dx = data.get("diagnosis_ayurveda", "")
        if not dx or not isinstance(dx, str) or dx.lower().strip() in ["", "unknown", "not mentioned", "none", "n/a", "na"]:
            needs_review.append("diagnosis_ayurveda")
            confidence = "low"

        # Check herbs array
        herbs = data.get("herbs", [])
        if not herbs or not isinstance(herbs, list) or len(herbs) == 0:
            needs_review.append("herbs")
            confidence = "low"
        else:
            for i, herb in enumerate(herbs):
                if not isinstance(herb, dict):
                    needs_review.append(f"herbs[{i}] (invalid format)")
                    continue
                name = herb.get("name", "")
                dose = herb.get("dose", "")
                timing = herb.get("timing", "")
                if not name or not isinstance(name, str) or name.strip().lower() in ["", "unknown", "not mentioned"]:
                    needs_review.append(f"herbs[{i}].name")
                if not dose or not isinstance(dose, str) or dose.strip().lower() in ["", "unknown", "not mentioned"]:
                    needs_review.append(f"herbs[{i}].dose")
                if not timing or not isinstance(timing, str) or timing.strip().lower() in ["", "unknown", "not mentioned"]:
                    needs_review.append(f"herbs[{i}].timing")

        # Check followup_days
        fud = data.get("followup_days")
        if fud is None or not isinstance(fud, (int, float)) or fud < 1 or fud > 365:
            needs_review.append("followup_days")
            if confidence != "low":
                confidence = "medium"

        # Ensure arrays are lists
        diet = data.get("diet_restrictions", [])
        if not isinstance(diet, list):
            diet = []
        lifestyle = data.get("lifestyle_advice", [])
        if not isinstance(lifestyle, list):
            lifestyle = []

        # Build structured response
        structured = {
            "diagnosis_ayurveda": dx if dx and isinstance(dx, str) else None,
            "diagnosis_icd": data.get("diagnosis_icd") if data.get("diagnosis_icd") else None,
            "prakriti_observed": data.get("prakriti_observed") if data.get("prakriti_observed") else None,
            "fasting_glucose": data.get("fasting_glucose") if isinstance(data.get("fasting_glucose"), (int, float)) else None,
            "herbs": herbs if isinstance(herbs, list) else [],
            "diet_restrictions": diet,
            "lifestyle_advice": lifestyle,
            "followup_days": int(fud) if isinstance(fud, (int, float)) and 1 <= fud <= 365 else 30,
            "doctor_notes": data.get("doctor_notes", ""),
        }

        return {
            **structured,
            "needs_review": needs_review,
            "confidence": confidence,
        }

    except Exception as e:
        print(f"[ERROR] Extraction error: {e}")
        return {
            "diagnosis_ayurveda": None,
            "diagnosis_icd": None,
            "prakriti_observed": None,
            "fasting_glucose": None,
            "herbs": [],
            "diet_restrictions": [],
            "lifestyle_advice": [],
            "followup_days": 30,
            "doctor_notes": "",
            "needs_review": ["all"],
            "confidence": "low",
        }



class DictationProcessRequest(BaseModel):
    transcript: str
    patient_id: Optional[str] = None


@app.post("/api/dictation/process")
async def process_dictation(request: DictationProcessRequest):
    """
    Process a dictation transcript (from WebSocket session) into structured data.
    Returns extracted visit record with confidence/review flags.
    Also links the most recent intake for this patient so the visit row
    carries a reference to the pre-consultation intake record.
    """
    try:
        extracted = await extract_visit_from_transcript(request.transcript, request.patient_id)

        # Resolve the most recent intake_id for this patient (may be None)
        intake_id = None
        severity_initial = None
        db = get_db()
        if request.patient_id:
            intake_row = db.execute(
                "SELECT id, severity FROM intakes WHERE patient_id = ? ORDER BY created_at DESC LIMIT 1",
                (request.patient_id,)
            ).fetchone()
            if intake_row:
                intake_id = intake_row["id"]
                try:
                    severity_initial = int(intake_row["severity"]) if intake_row["severity"] else None
                except (ValueError, TypeError):
                    severity_initial = None

        # Create visit record (linked to intake)
        visit_id = f"visit-{int(datetime.now().timestamp() * 1000)}"
        db.execute(
            """INSERT INTO visits (
                id, patient_id, intake_id, raw_transcript, extracted_json,
                status, visit_date, severity_initial, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                visit_id,
                request.patient_id,
                intake_id,
                request.transcript,
                json.dumps(extracted),
                "draft",
                datetime.now().strftime("%Y-%m-%d"),
                severity_initial,
                datetime.now().isoformat(),
            ),
        )
        db.commit()
        db.close()

        return {
            "success": True,
            "visit_id": visit_id,
            "intake_id": intake_id,
            "extracted": extracted,
            "needs_review": extracted.get("needs_review", []),
            "confidence": extracted.get("confidence", "medium"),
        }

    except Exception as e:
        print(f"[ERROR] Dictation processing error: {e}")
        return {"success": False, "error": str(e)}


# ─── Confirm / Finalize Visit ──────────────────────────────────────────────────

@app.post("/api/dictation/confirm")
async def dictation_confirm(body: dict = Body(...)):
    """
    Step D: Doctor confirms/corrects extracted data and finalizes the visit.
    
    Input: {visit_id, extracted_json: { ... corrected structured data ... }}
    Output: {ok: true, checkin_templates_generated: true}
    
    Actions:
      - Update visits.extracted_json and status='prescription_added'
      - Generate check-in question templates for next N days
      - Save to checkin_templates table
    """
    try:
        visit_id = body.get("visit_id")
        corrected = body.get("extracted_json", {})
        
        if not visit_id:
            return {"success": False, "error": "visit_id required"}

        db = get_db()
        
        # Verify visit exists
        row = db.execute("SELECT id FROM visits WHERE id = ?", (visit_id,)).fetchone()
        if not row:
            db.close()
            return {"success": False, "error": "Visit not found"}

        # Extract followup_days and severity_initial if available
        followup_days = corrected.get("followup_days", 30)
        severity_initial = None
        # Try to get severity from existing patient intake if available
        patient_row = db.execute("SELECT patient_id FROM visits WHERE id = ?", (visit_id,)).fetchone()
        if patient_row and patient_row["patient_id"]:
            patient_intake = db.execute(
                "SELECT severity FROM intakes WHERE patient_id = ? ORDER BY created_at DESC LIMIT 1",
                (patient_row["patient_id"],)
            ).fetchone()
            if patient_intake and patient_intake["severity"]:
                severity_initial = patient_intake["severity"]

        # Update visit with confirmed data
        db.execute(
            """UPDATE visits 
               SET extracted_json = ?, status = 'prescription_added', 
                   followup_days = ?, severity_initial = ?, updated_at = ?
               WHERE id = ?""",
            (json.dumps(corrected), followup_days, severity_initial, datetime.now().isoformat(), visit_id),
        )

        # Generate check-in question templates (3 questions, valid for entire followup period)
        templates = generate_checkin_templates_from_visit(corrected, visit_id)
        for tmpl in templates:
            db.execute(
                """INSERT INTO checkin_templates (
                    id, visit_id, question_hi, question_en,
                    day_range_start, day_range_end, herb_name, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    tmpl["id"],
                    visit_id,
                    tmpl["question_hi"],
                    tmpl["question_en"],
                    tmpl["day_start"],
                    tmpl["day_end"],
                    tmpl.get("herb_name"),
                    datetime.now().isoformat(),
                ),
            )
        
        # Link visit to patient's last_visit
        db.execute(
            """UPDATE patients SET last_visit_id = ?, updated_at = ? WHERE id = (
                SELECT patient_id FROM visits WHERE id = ?
            )""",
            (visit_id, datetime.now().isoformat(), visit_id),
        )

        db.commit()
        db.close()

        return {
            "ok": True,
            "checkin_templates_generated": len(templates),
            "visit_id": visit_id,
            "status": "prescription_added",
        }

    except Exception as e:
        print(f"[ERROR] Dictation confirm error: {e}")
        return {"success": False, "error": str(e)}


# ─── Check-in Question Template Generation ────────────────────────────────────

def generate_checkin_templates_from_visit(visit_data: dict, visit_id: str) -> list[dict]:
    """
    Generate 3 daily check-in question templates for the follow-up period.
    Questions stored in checkin_templates table.
    
    Rules (exact):
    1. Herb adherence questions (highest priority) — one per herb (up to 3 total)
       Hindi: "Kya aapne aaj [herb] li — [timing]?" or timing-specific
       English: "Did you take [herb] today — [timing]?"
    2. Diet restrictions — one per restriction (up to 3 total)
       Hindi: "Kya aaj aapne [restriction] se parhej kiya?"
       English: "Did you avoid [restriction] today?"
    3. Lifestyle advice — only if needed to reach 3
       Based on activity keywords
    
    All questions cover day_range_start=1 to day_range_end=followup_days.
    """
    templates = []
    followup_days = int(visit_data.get("followup_days", 30))
    herbs = visit_data.get("herbs", [])
    diet_restrictions = visit_data.get("diet_restrictions", [])
    lifestyle_advice = visit_data.get("lifestyle_advice", [])
    
    # Ensure lists exist
    if not isinstance(herbs, list): herbs = []
    if not isinstance(diet_restrictions, list): diet_restrictions = []
    if not isinstance(lifestyle_advice, list): lifestyle_advice = []

    used_texts = set()  # prevent duplicates

    # Priority 1: Herb adherence questions (up to 3 herbs or fill remaining slots)
    for herb in herbs[:3]:
        name = (herb.get("name") or "").strip()
        timing = (herb.get("timing") or "").strip()
        
        if name and name not in used_texts:
            # Build question with timing specificity
            timing_lower = timing.lower()
            if "morning" in timing_lower or "subah" in timing_lower:
                q_hi = f"Kya aapne aaj {name} subah li?"
                q_en = f"Did you take {name} this morning?"
            elif "evening" in timing_lower or "shaam" in timing_lower:
                q_hi = f"Kya aapne aaj {name} shaam ko li?"
                q_en = f"Did you take {name} this evening?"
            elif "bedtime" in timing_lower or "before sleep" in timing_lower or "raat" in timing_lower or "sone" in timing_lower:
                q_hi = f"Kya aapne aaj {name} sone se pehle li?"
                q_en = f"Did you take {name} before bed?"
            elif "after food" in timing_lower or "after meals" in timing_lower or "khane ke baad" in timing_lower:
                q_hi = f"Kya aapne aaj {name} khane ke baad li?"
                q_en = f"Did you take {name} after meals today?"
            elif "before food" in timing_lower or "empty stomach" in timing_lower:
                q_hi = f"Kya aapne aaj {name} khane se pehle li?"
                q_en = f"Did you take {name} before food today?"
            else:
                # Generic timing
                q_hi = f"Kya aapne aaj {name} li?"
                q_en = f"Did you take {name} today?"
            
            templates.append({
                "id": f"qherb-{visit_id}-{len(templates)}",
                "question_hi": q_hi,
                "question_en": q_en,
                "day_start": 1,
                "day_end": followup_days,
                "herb_name": name,
            })
            used_texts.add(name)

    # Priority 2: Diet restrictions (fill remaining slots)
    if len(templates) < 3:
        for restriction in diet_restrictions:
            restriction = restriction.strip()
            if restriction and restriction not in used_texts:
                q_hi = f"Kya aaj aapne {restriction} se parhej kiya?"
                q_en = f"Did you avoid {restriction} today?"
                templates.append({
                    "id": f"qdiet-{visit_id}-{len(templates)}",
                    "question_hi": q_hi,
                    "question_en": q_en,
                    "day_start": 1,
                    "day_end": followup_days,
                    "herb_name": None,
                })
                used_texts.add(restriction)
                if len(templates) >= 3:
                    break

    # Priority 3: Lifestyle advice (fill remaining slots)
    if len(templates) < 3:
        for activity in lifestyle_advice:
            activity = activity.strip()
            if activity and activity not in used_texts:
                activity_lower = activity.lower()
                # Extract action keyword
                if "walk" in activity_lower:
                    q_hi = "Kya aapne aaj walk ki?"
                    q_en = "Did you take a walk today?"
                    keyword = "walk"
                elif "yoga" in activity_lower:
                    q_hi = "Kya aapne aaj yoga kiya?"
                    q_en = "Did you practice yoga today?"
                    keyword = "yoga"
                elif "exercise" in activity_lower or "workout" in activity_lower:
                    q_hi = "Kya aapne aaj exercise kiya?"
                    q_en = "Did you exercise today?"
                    keyword = "exercise"
                elif "sleep" in activity_lower or "rest" in activity_lower:
                    q_hi = "Kya aapne aaj acchi neend li?"
                    q_en = "Did you get good sleep/rest today?"
                    keyword = "sleep"
                elif "massage" in activity_lower or "abhyanga" in activity_lower:
                    q_hi = "Kya aapne aaj aapna body massage kiya?"
                    q_en = "Did you do self-massage today?"
                    keyword = "massage"
                else:
                    # Generic lifestyle
                    q_hi = f"Kya aapne aaj apni rozmarra ke anusar '{activity[:25]}' kiya?"
                    q_en = f"Did you follow your routine ({activity[:25]}) today?"
                    keyword = activity[:25]
                
                templates.append({
                    "id": f"qlife-{visit_id}-{len(templates)}",
                    "question_hi": q_hi,
                    "question_en": q_en,
                    "day_start": 1,
                    "day_end": followup_days,
                    "herb_name": None,
                })
                used_texts.add(activity)
                if len(templates) >= 3:
                    break

    # Pad to exactly 3 questions if needed
    while len(templates) < 3:
        idx = len(templates) + 1
        templates.append({
            "id": f"qgen-{visit_id}-{idx}",
            "question_hi": f"Kya aapka aaj swasthya theek raha?",
            "question_en": f"Is your health okay today?",
            "day_start": 1,
            "day_end": followup_days,
            "herb_name": None,
        })

    return templates[:3]


# ═══════════════════════════════════════════════════════════════════════════════
# (Legacy kept for backward compatibility)
# ═══════════════════════════════════════════════════════════════════════════════


# ═══════════════════════════════════════════════════════════════════════════════
# REST ENDPOINTS — Check-in Analysis (LLM)
# ═══════════════════════════════════════════════════════════════════════════════

@app.post("/api/analyze-checkin")
async def analyze_checkin(request: CheckinRequest):
    """Analyze daily check-in responses (Stage 1 - 8 questions)."""
    system_instruction = """You are an Ayurvedic wellness coach analyzing daily patient check-ins.
RULES:
- Output ONLY valid JSON
- Base analysis purely on provided responses
- Give actionable Ayurvedic recommendations"""

    responses_text = "\n\n".join(
        f"Q: {r.get('question', '')}\nA: {r.get('answer', '')}" for r in request.responses
    )

    prompt = f"""Analyze these pre-visit intake responses from an Ayurveda patient:

{responses_text}

Return exactly this JSON with all fields captured:
{{
  "overall_status": "improving" | "stable" | "declining" | "needs_attention",
  "dosha_today": string (based on symptoms),
  "key_observations": string[],
  "recommendations": string[],
  "intake_summary": {{
    "chief_complaint": string,
    "duration": string,
    "severity": number (1-10),
    "aggravating_factors": string[],
    "relieving_factors": string[],
    "diet_pattern": string,
    "sleep_quality": string,
    "bowel_habits": string,
    "current_medications": string[],
    "prior_treatments": string[]
  }}
}}"""

    try:
        data = call_gemini_text(prompt, system_instruction, temperature=0.3)

        # Save to database with all intake fields
        checkin_id = f"checkin-{int(datetime.now().timestamp() * 1000)}"
        db = get_db()
        
        # Extract intake data from response
        intake_data = data.get("intake_summary", {})
        
        db.execute(
            """INSERT INTO checkins (id, patient_id, date, responses, summary, 
               chief_complaint, duration, severity, aggravating_factors, relieving_factors,
               diet, sleep, bowel, current_medications, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (checkin_id, request.patient_id, datetime.now().strftime("%Y-%m-%d"),
             json.dumps(request.responses), json.dumps(data),
             intake_data.get("chief_complaint", ""),
             intake_data.get("duration", ""),
             intake_data.get("severity", 0),
             json.dumps(intake_data.get("aggravating_factors", [])),
             json.dumps(intake_data.get("relieving_factors", [])),
             intake_data.get("diet_pattern", ""),
             intake_data.get("sleep_quality", ""),
             intake_data.get("bowel_habits", ""),
             json.dumps(intake_data.get("current_medications", [])),
             datetime.now().isoformat()),
        )
        db.commit()
        db.close()

        return {"success": True, "data": data, "id": checkin_id}

    except Exception as e:
        print(f"[ERROR] Check-in analysis error: {e}")
        return {"success": False, "error": str(e)}


# ═══════════════════════════════════════════════════════════════════════════════
# REST ENDPOINTS — Generate Check-in Questions from Prescription (Stage 2 → 3)
# ═══════════════════════════════════════════════════════════════════════════════

class GenerateCheckinRequest(BaseModel):
    prescription: list
    diet_restrictions: Optional[list] = []
    patient_id: Optional[str] = None
    visit_id: Optional[str] = None

@app.post("/api/generate-checkin-questions")
async def generate_checkin_questions(request: GenerateCheckinRequest):
    """Generate 3 daily check-in questions from doctor's prescription."""
    system_instruction = """You are an Ayurvedic treatment adherence assistant.
    Generate exactly 3 questions - one for each prescribed item or diet restriction.
    Questions should ask if the patient took the medicine or followed the advice.
    Return in English, Hindi, and Hinglish."""

    # Format prescription for prompt
    prescription_text = "\n".join([
        f"- {p.get('name', '')}: {p.get('dose', '')} {p.get('frequency', '')} {p.get('timing', '')}"
        for p in (request.prescription or [])
    ])
    diet_text = "\n".join([f"- {d}" for d in (request.diet_restrictions or [])])

    prompt = f"""Generate 3 check-in questions from this prescription:

PRESCRIPTIONS:
{prescription_text}

DIET RESTRICTIONS:
{diet_text}

For each question, create Hindi and Hinglish versions. Return exactly this JSON:
{{
  "questions": [
    {{
      "question_en": "English question about taking medicine X",
      "question_hi": "Hindi question",
      "question_hinglish": "Hinglish question",
      "related_item": "medicine/diet item name"
    }}
  ],
  "generated_for_patient": "{request.patient_id or ''}",
  "generated_from_visit": "{request.visit_id or ''}"
}}"""

    try:
        data = call_gemini_text(prompt, system_instruction)
        return {"success": True, "data": data}

    except Exception as e:
        print(f"[ERROR] Check-in question generation error: {e}")
        return {"success": False, "error": str(e)}


# ═══════════════════════════════════════════════════════════════════════════════
# REST ENDPOINTS — Post-Visit Check-in Analysis (Stage 3)
# ═══════════════════════════════════════════════════════════════════════════════

class PostVisitCheckinRequest(BaseModel):
    responses: list
    patient_id: Optional[str] = None

@app.post("/api/analyze-postvisit-checkin")
async def analyze_postvisit_checkin(request: PostVisitCheckinRequest):
    """Analyze daily post-visit check-in responses for adherence and trends."""
    system_instruction = """You are an Ayurvedic treatment adherence tracker.
    Analyze patient responses about taking medicines and following diet.
    Output ONLY valid JSON."""

    responses_text = "\n".join(
        f"Q: {r.get('question', '')}\nA: {r.get('answer', '')}" for r in request.responses
    )

    prompt = f"""Analyze these daily check-in responses about medication adherence:

{responses_text}

Return exactly this JSON:
{{
  "adherence_score": number (0-100),
  "adherence_flags": ["reason if missed"],
  "severity_trend": number (-1 declining, 0 stable, 1 improving),
  "water_intake": "noted if mentioned",
  "meal_timing": "noted if mentioned",
  "notes": "any observations"
}}"""

    try:
        data = call_gemini_text(prompt, system_instruction)
        
        # Save to database
        checkin_id = f"postvisit-{int(datetime.now().timestamp() * 1000)}"
        db = get_db()
        db.execute(
            """INSERT INTO postvisit_checkins (id, patient_id, date, responses, analysis, created_at)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (checkin_id, request.patient_id, datetime.now().strftime("%Y-%m-%d"),
             json.dumps(request.responses), json.dumps(data), datetime.now().isoformat()),
        )
        db.commit()
        db.close()

        return {"success": True, "data": data, "id": checkin_id}

    except Exception as e:
        print(f"[ERROR] Post-visit check-in analysis error: {e}")
        return {"success": False, "error": str(e)}


# ═══════════════════════════════════════════════════════════════════════════════
# REST ENDPOINTS — Module 3: Daily Check-in from visits (POST-visit monitoring)
# ═══════════════════════════════════════════════════════════════════════════════


@app.get("/api/checkin/{visit_id}/today")
async def get_checkin_today(visit_id: str):
    """
    GET /api/checkin/{visit_id}/today
    Returns the 3 check-in questions for today based on the visit's prescription.
    Day range is determined by days elapsed since visit_date.
    """
    db = get_db()
    
    # Get visit details
    visit = db.execute(
        "SELECT * FROM visits WHERE id = ?", (visit_id,)
    ).fetchone()
    if not visit:
        db.close()
        return {"success": False, "error": "Visit not found"}
    
    # Calculate current day number since visit
    visit_date_str = visit["visit_date"]
    try:
        visit_date = datetime.strptime(visit_date_str, "%Y-%m-%d").date()
        today = datetime.now().date()
        day_number = (today - visit_date).days + 1
    except Exception:
        day_number = 1
    
    # If beyond followup period, no questions
    followup_days = visit["followup_days"] or 30
    if day_number > followup_days:
        db.close()
        return {
            "success": True,
            "questions": [],
            "day_number": day_number,
            "followup_days": followup_days,
            "message": "Follow-up period ended",
        }
    
    # Fetch all checkin_templates for this visit where day_number is within range
    rows = db.execute(
        """SELECT question_hi, question_en, herb_name 
           FROM checkin_templates 
           WHERE visit_id = ? AND day_range_start <= ? AND day_range_end >= ?
           ORDER BY id""",
        (visit_id, day_number, day_number)
    ).fetchall()
    db.close()
    
    if not rows:
        # No templates found - return generic questions
        return {
            "success": True,
            "questions": [
                {"question_hi": "Kya aapka aaj swasthya theek raha?", "question_en": "Is your health okay today?"},
                {"question_hi": "Kya aapne apni dawaayein li?", "question_en": "Did you take your medicines today?"},
                {"question_hi": "Kya aapne koi khaas parhej kiya?", "question_en": "Did you follow any dietary restrictions today?"},
            ],
            "day_number": day_number,
        }
    
    questions = [
        {"question_hi": r["question_hi"], "question_en": r["question_en"], "herb_name": r["herb_name"]}
        for r in rows
    ][:3]  # max 3
    
    return {
        "success": True,
        "questions": questions,
        "day_number": day_number,
        "followup_days": followup_days,
    }


@app.post("/api/checkin/{visit_id}/today")
async def submit_checkin_today(visit_id: str, request: dict = Body(...)):
    """
    POST /api/checkin/{visit_id}/today
    Submit patient's check-in answers for today.
    
    Request body: { a1: "yes", a2: "yes", a3: "no", severity_today: 4 }
    
    Actions:
    1. Save answers to daily_logs table
    2. Compute adherence_score = count of "yes" answers (for a1-a3 only)
    3. Check alert logic: if last 2 daily_logs have severity_today >= visits.severity_initial -> alert_flag=1
    4. Update patient record with latest adherence info
    """
    try:
        a1 = request.get("a1", "").lower().strip()
        a2 = request.get("a2", "").lower().strip()
        a3 = request.get("a3", "").lower().strip()
        severity_today = request.get("severity_today")
        
        # Validate severity
        if severity_today is None:
            severity_today = 0
        else:
            try:
                severity_today = int(severity_today)
                # Clamp to 1-10
                severity_today = max(1, min(10, severity_today))
            except (ValueError, TypeError):
                severity_today = 0
        
        # Compute adherence score (count yes answers)
        yes_count = sum(1 for ans in [a1, a2, a3] if ans in ["yes", "haan", "ji", "true", "1"])
        adherence_score = yes_count  # 0-3
        
        db = get_db()
        
        # Get visit and patient info
        visit = db.execute("SELECT * FROM visits WHERE id = ?", (visit_id,)).fetchone()
        if not visit:
            db.close()
            return {"success": False, "error": "Visit not found"}
        
        patient_id = visit["patient_id"]
        visit_date_str = visit["visit_date"]
        followup_days = visit["followup_days"] or 30
        
        # Calculate day number
        try:
            visit_date = datetime.strptime(visit_date_str, "%Y-%m-%d").date()
            today = datetime.now().date()
            day_number = (today - visit_date).days + 1
        except Exception:
            day_number = 1
        
        # Fetch today's questions (for storage)
        question_rows = db.execute(
            """SELECT question_hi, question_en 
               FROM checkin_templates 
               WHERE visit_id = ? AND day_range_start <= ? AND day_range_end >= ?
               ORDER BY id LIMIT 3""",
            (visit_id, day_number, day_number)
        ).fetchall()
        questions_json = [
            {"question_hi": r["question_hi"], "question_en": r["question_en"]}
            for r in question_rows
        ]
        if not questions_json:
            questions_json = [
                {"question_hi": "Kya aapka aaj swasthya theek raha?", "question_en": "Is your health okay today?"},
                {"question_hi": "Kya aapne apni dawaayein li?", "question_en": "Did you take your medicines today?"},
                {"question_hi": "Kya aapne koi khaas parhej kiya?", "question_en": "Did you follow any dietary restrictions today?"},
            ]
        
        # Save daily log
        daily_id = f"daily-{int(datetime.now().timestamp() * 1000)}"
        db.execute(
            """INSERT INTO daily_logs (
                id, visit_id, patient_id, day_number, date,
                questions, responses, severity_today, adherence_score, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                daily_id,
                visit_id,
                patient_id,
                day_number,
                today.strftime("%Y-%m-%d"),
                json.dumps(questions_json),
                json.dumps([{"answer": a1}, {"answer": a2}, {"answer": a3}]),
                severity_today,
                adherence_score,
                datetime.now().isoformat(),
            ),
        )
        
        # ALERT LOGIC: Check last 2 logs for severity escalation
        if patient_id:
            # Get last 2 daily logs (excluding today's just inserted)
            recent_rows = db.execute(
                """SELECT severity_today FROM daily_logs 
                   WHERE patient_id = ? AND date != ? 
                   ORDER BY date DESC LIMIT 2""",
                (patient_id, today.strftime("%Y-%m-%d"))
            ).fetchall()
            
            # Also fetch initial severity from intake
            initial_severity_row = db.execute(
                "SELECT severity FROM intakes WHERE patient_id = ? ORDER BY created_at DESC LIMIT 1",
                (patient_id,)
            ).fetchone()
            
            # Trigger alert if today's severity >= initial severity AND (two recent logs show increase)
            alert_triggered = False
            if initial_severity_row and initial_severity_row["severity"]:
                try:
                    initial_sev = int(initial_severity_row["severity"])
                    if severity_today >= initial_sev:
                        # Check trend: recent logs also elevated
                        if len(recent_rows) >= 2:
                            recent_sevs = [r["severity_today"] for r in recent_rows if r["severity_today"]]
                            if recent_sevs and all(sev >= initial_sev for sev in recent_sevs):
                                alert_triggered = True
                except (ValueError, TypeError):
                    pass
            
            if alert_triggered:
                db.execute(
                    "UPDATE visits SET alert_flag = 1, updated_at = ? WHERE id = ?",
                    (datetime.now().isoformat(), visit_id)
                )
        
        db.commit()
        db.close()

        return {
            "success": True,
            "adherence_score": adherence_score,
            "day_number": day_number,
            "alert_flag": alert_triggered if 'alert_triggered' in locals() else False,
        }

    except Exception as e:
        print(f"[ERROR] Check-in submit error: {e}")
        return {"success": False, "error": str(e)}


# ═══════════════════════════════════════════════════════════════════════════════
# REST ENDPOINTS — Dictation History
# ═══════════════════════════════════════════════════════════════════════════════

@app.get("/api/visits")
async def list_visits(patient_id: Optional[str] = None):
    """List all visits, optionally filtered by patient_id."""
    db = get_db()
    if patient_id:
        rows = db.execute(
            "SELECT * FROM visits WHERE patient_id = ? ORDER BY created_at DESC", (patient_id,)
        ).fetchall()
    else:
        rows = db.execute("SELECT * FROM visits ORDER BY created_at DESC").fetchall()
    db.close()
    
    visits = []
    for r in rows:
        visits.append({
            "id": r["id"],
            "patient_id": r["patient_id"],
            "visit_date": r["visit_date"],
            "status": r["status"],
            "followup_days": r["followup_days"],
            "diagnosis_ayurveda": r["diagnosis_ayurveda"],
            "extracted_json": json.loads(r["extracted_json"]) if r["extracted_json"] else None,
            "needs_review": json.loads(r["needs_review"]) if r["needs_review"] else [],
            "created_at": r["created_at"],
        })
    return {"visits": visits}


@app.get("/api/visits/{visit_id}")
async def get_visit(visit_id: str):
    """Get a single visit record."""
    db = get_db()
    r = db.execute("SELECT * FROM visits WHERE id = ?", (visit_id,)).fetchone()
    db.close()
    if not r:
        return {"success": False, "error": "Visit not found"}, 404
    return {
        "id": r["id"],
        "patient_id": r["patient_id"],
        "raw_transcript": r["raw_transcript"],
        "extracted_json": json.loads(r["extracted_json"]) if r["extracted_json"] else None,
        "diagnosis_ayurveda": r["diagnosis_ayurveda"],
        "diagnosis_icd": r["diagnosis_icd11"],  # backward compatible
        "diagnosis_icd11": r["diagnosis_icd11"],
        "prakriti_observed": r["prakriti_observed"],
        "fasting_glucose": r["fasting_glucose"],
        "herbs": json.loads(r["herbs"]) if r["herbs"] else [],
        "diet_restrictions": json.loads(r["diet_restrictions"]) if r["diet_restrictions"] else [],
        "lifestyle_advice": json.loads(r["lifestyle_advice"]) if r["lifestyle_advice"] else [],
        "followup_days": r["followup_days"],
        "doctor_notes": r["doctor_notes"],
        "needs_review": json.loads(r["needs_review"]) if r["needs_review"] else [],
        "status": r["status"],
        "visit_date": r["visit_date"],
        "created_at": r["created_at"],
    }


@app.get("/api/visits/{visit_id}/templates")
async def get_visit_checkin_templates(visit_id: str):
    """Get all check-in question templates for a given visit."""
    db = get_db()
    rows = db.execute(
        "SELECT * FROM checkin_templates WHERE visit_id = ? ORDER BY day_range_start, id",
        (visit_id,)
    ).fetchall()
    db.close()
    return {
        "success": True,
        "templates": [
            {
                "id": r["id"],
                "visit_id": r["visit_id"],
                "question_hi": r["question_hi"],
                "question_en": r["question_en"],
                "day_range_start": r["day_range_start"],
                "day_range_end": r["day_range_end"],
                "herb_name": r["herb_name"],
                "created_at": r["created_at"],
            }
            for r in rows
        ],
    }


@app.get("/api/dictations")
async def list_dictations(patient_id: Optional[str] = None):
    db = get_db()
    if patient_id:
        rows = db.execute(
            "SELECT * FROM dictations WHERE patient_id = ? ORDER BY created_at DESC", (patient_id,)
        ).fetchall()
    else:
        rows = db.execute("SELECT * FROM dictations ORDER BY created_at DESC").fetchall()
    db.close()
    return {"dictations": [
        {
            "id": r["id"],
            "patientId": r["patient_id"],
            "rawTranscript": r["raw_transcript"],
            "structuredNote": json.loads(r["structured_note"]) if r["structured_note"] else None,
            "checkinQuestions": json.loads(r["checkin_questions"]) if r["checkin_questions"] else None,
            "status": r["status"],
            "timestamp": r["created_at"],
        }
        for r in rows
    ]}


@app.get("/api/dictations/latest-checkin-questions")
async def get_latest_checkin_questions(patient_id: str):
    """Get the check-in questions from the patient's most recent dictation."""
    db = get_db()
    row = db.execute(
        "SELECT checkin_questions FROM dictations WHERE patient_id = ? ORDER BY created_at DESC LIMIT 1",
        (patient_id,)
    ).fetchone()
    db.close()
    
    if row and row["checkin_questions"]:
        return {"success": True, "questions": json.loads(row["checkin_questions"])}
    return {"success": False, "questions": None}


@app.get("/api/checkins")
async def list_checkins(patient_id: Optional[str] = None):
    db = get_db()
    if patient_id:
        rows = db.execute(
            "SELECT * FROM checkins WHERE patient_id = ? ORDER BY created_at DESC", (patient_id,)
        ).fetchall()
    else:
        rows = db.execute("SELECT * FROM checkins ORDER BY created_at DESC").fetchall()
    db.close()
    return {"checkins": [
        {
            "id": r["id"],
            "patientId": r["patient_id"],
            "date": r["date"],
            "responses": json.loads(r["responses"]),
            "summary": json.loads(r["summary"]) if r["summary"] else None,
        }
        for r in rows
    ]}


# ═══════════════════════════════════════════════════════════════════════════════
# WEBSOCKET — DOCTOR DICTATION (Real-time Transcription)
# ═══════════════════════════════════════════════════════════════════════════════

@app.websocket("/ws/dictation")
async def websocket_dictation(ws: WebSocket):
    """WebSocket endpoint for real-time doctor dictation transcription."""
    await ws.accept()
    session_id = datetime.now().strftime("%Y%m%d_%H%M%S")
    
    # Extract patient_id and language from query params if provided
    patient_id = None
    language = "hinglish"
    try:
        query_string = ws.query_params
        patient_id = query_string.get("patient_id")
        language = query_string.get("language", "hinglish")
    except Exception:
        pass

    print(f"[WS-Dictation] New dictation session: {session_id} (patient: {patient_id or 'not specified'}, language: {language})")

    bridge = DictationBridge(ws, patient_id, language)
    active_sessions[session_id] = bridge

    try:
        connected = await bridge.connect_gemini()
        if not connected:
            return

        # Run both directions concurrently
        await asyncio.gather(
            bridge.client_to_gemini(),
            bridge.gemini_to_client(),
        )

    except WebSocketDisconnect:
        print(f"[WS-Dictation] Client disconnected: {session_id}")
    except Exception as e:
        print(f"[ERROR] Dictation session error: {e}")
    finally:
        bridge.is_running = False
        await bridge.save_transcript()

        if bridge.gemini_ws:
            try:
                await bridge.gemini_ws.close()
            except Exception:
                pass

        active_sessions.pop(session_id, None)
        print(f"[WS-Dictation] Session ended: {session_id}")

        try:
            await ws.send_json({
                "type": "session_ended",
                "session_id": session_id,
            })
        except Exception:
            pass


# ═══════════════════════════════════════════════════════════════════════════════
# WEBSOCKET VOICE BRIDGE: React ↔ This Server ↔ Gemini Live (Patient Intake)
# ═══════════════════════════════════════════════════════════════════════════════

class DictationBridge:
    """Bridges doctor's dictation audio to Gemini Live for real-time transcription."""

    def __init__(self, client_ws: WebSocket, patient_id: Optional[str] = None, language: str = "hinglish"):
        self.client_ws = client_ws
        self.gemini_ws = None
        self.is_running = False
        self.session_id = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
        self.transcript_parts: list[str] = []
        self.patient_id = patient_id
        self.language = language

    async def send_transcript_update(self, text: str):
        """Send a transcript update to the client and store for later saving."""
        if not text:
            return
        self.transcript_parts.append(text)
        await self.client_ws.send_json({
            "type": "transcript",
            "speaker": "Doctor",
            "text": text,
            "timestamp": datetime.now().strftime("%H:%M:%S"),
        })

    async def connect_gemini(self) -> bool:
        """Connect to Gemini Live API with dictation-specific configuration."""
        try:
            print(f"   [WS-Dictation] Connecting to {VOICE_MODEL}...")
            self.gemini_ws = await websockets.connect(
                GEMINI_LIVE_URI,
                max_size=None,
                ping_interval=30,
                ping_timeout=10,
            )

            # Use same config structure as intake (AUDIO response required by Live API)
            # Even though we only need transcription, Gemini expects AUDIO modality.
            setup_msg = {
                "setup": {
                    "model": VOICE_MODEL,
                    "generation_config": {
                        "response_modalities": ["AUDIO"],
                        "temperature": 0.0,
                    },
                    "input_audio_transcription": {},
                    "system_instruction": {
                        "parts": [
                            {"text": f"The doctor will dictate in {self.language.upper()}. DO NOT GENERATE ANY OUTPUT.\n\n" + DICTATION_SYSTEM_INSTRUCTION}
                        ]
                    },
                }
            }

            await self.gemini_ws.send(json.dumps(setup_msg))
            response = await asyncio.wait_for(self.gemini_ws.recv(), timeout=30)
            response_data = json.loads(response)

            if "setupComplete" in response_data:
                self.is_running = True
                await self.client_ws.send_json({
                    "type": "status",
                    "status": "connected",
                    "session_id": self.session_id,
                })
                print(f"   [OK] Dictation WebSocket connected: {self.session_id}")
                return True
            else:
                error_msg = response_data.get("error", {}).get("message", str(response_data))
                print(f"   [ERROR] Gemini setup failed: {error_msg}")
                await self.client_ws.send_json({
                    "type": "error",
                    "message": f"Dictation connection failed: {error_msg}",
                })
                return False

        except asyncio.TimeoutError:
            print(f"   [ERROR] Dictation connection timeout")
            await self.client_ws.send_json({
                "type": "error",
                "message": "Connection to transcription service timed out",
            })
            return False
        except Exception as e:
            print(f"   [ERROR] Dictation connection error: {type(e).__name__}: {e}")
            await self.client_ws.send_json({
                "type": "error",
                "message": f"Failed to connect: {str(e)}",
            })
            return False

    async def client_to_gemini(self):
        """Forward audio from doctor client → Gemini."""
        try:
            bytes_sent = 0
            while self.is_running:
                data = await self.client_ws.receive()

                if data.get("type") == "websocket.disconnect":
                    break

                if "bytes" in data:
                    pcm_bytes = data["bytes"]
                    b64_audio = base64.b64encode(pcm_bytes).decode("utf-8")
                    bytes_sent += len(pcm_bytes)

                    msg = {
                        "realtimeInput": {
                            "mediaChunks": [
                                {
                                    "mimeType": f"audio/pcm;rate={INPUT_RATE}",
                                    "data": b64_audio,
                                }
                            ]
                        }
                    }
                    await self.gemini_ws.send(json.dumps(msg))

                    # Log periodically to debug
                    if bytes_sent % (INPUT_RATE * 2) < 100:  # ~every 0.5 sec
                        print(f"   [WS-Dictation] Sent {bytes_sent} audio bytes total")

                elif "text" in data:
                    try:
                        msg = json.loads(data["text"])
                        if msg.get("type") == "end_session":
                            break
                        elif msg.get("type") == "turn_end":
                            await self.gemini_ws.send(json.dumps({
                                "realtimeInput": {
                                    "audioStreamEnd": True
                                }
                            }))
                    except json.JSONDecodeError:
                        pass

        except WebSocketDisconnect:
            pass
        except Exception as e:
            print(f"[ERROR] Dictation client→gemini error: {e}")

    async def gemini_to_client(self):
        """Forward transcripts from Gemini → doctor client."""
        msg_count = 0
        try:
            while self.is_running and self.gemini_ws:
                response = await self.gemini_ws.recv()
                response_data = json.loads(response)
                msg_count += 1

                # Handle serverContent (Live API response wrapper)
                if "serverContent" in response_data:
                    sc = response_data["serverContent"]
                    
                    if "inputTranscription" in sc:
                        transcription = sc["inputTranscription"]
                        text = transcription.get("text", "").strip()
                        if text:
                            await self.send_transcript_update(text)
                if "error" in response_data:
                    print(f"   [ERROR] Gemini error: {response_data['error']}")
                    await self.client_ws.send_json({
                        "type": "error",
                        "message": response_data["error"].get("message", "Unknown error"),
                    })

        except WebSocketDisconnect:
            pass
        except Exception as e:
            print(f"[ERROR] Dictation gemini→client error: {e}")
        finally:
            print(f"   [WS-Dictation] Received {msg_count} messages, transcript parts: {len(self.transcript_parts)}")

    async def save_transcript(self):
        """Save the full transcript to the dictations table."""
        if not self.transcript_parts:
            return

        full_transcript = " ".join(self.transcript_parts)
        dictation_id = f"dict-{int(datetime.now().timestamp() * 1000)}"

        db = get_db()
        db.execute(
            """INSERT INTO dictations (id, patient_id, raw_transcript, structured_note, status, created_at)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (dictation_id, self.patient_id, full_transcript, None, "processing", datetime.now().isoformat()),
        )
        db.commit()
        db.close()

        print(f"[DB] Saved dictation transcript: {dictation_id}")

        # Notify client that transcript has been saved; ignore errors if client disconnected
        try:
            await self.client_ws.send_json({
                "type": "dictation_saved",
                "dictation_id": dictation_id,
            })
        except Exception:
            pass  # Client already disconnected


# ═══════════════════════════════════════════════════════════════════════════════
# WEBSOCKET VOICE BRIDGE: React ↔ This Server ↔ Gemini Live (Patient Intake)
# ═══════════════════════════════════════════════════════════════════════════════

class GeminiBridge:
    """Manages one patient voice session: bridges React client to Gemini Live."""

    def __init__(self, client_ws: WebSocket):
        self.client_ws = client_ws
        self.gemini_ws = None
        self.is_running = False
        self.session_id = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
        self.transcript_parts = []

    async def append_transcript(self, speaker: str, text: str):
        if not text:
            return
        ts = datetime.now().strftime("%H:%M:%S")
        self.transcript_parts.append(f"[{ts}] {speaker}: {text}")
        await self.client_ws.send_json({
            "type": "transcript",
            "speaker": speaker,
            "text": f"{speaker}: {text}",
            "timestamp": ts,
        })

    async def connect_gemini(self) -> bool:
        """Connect to Gemini Live API."""
        try:
            print(f"   [WS] Connecting to {VOICE_MODEL}...")
            self.gemini_ws = await websockets.connect(
                GEMINI_LIVE_URI,
                max_size=None,
                ping_interval=30,
                ping_timeout=10,
            )
            print(f"   [WS] WebSocket to Gemini opened, sending setup...")

            setup_msg = {
                "setup": {
                    "model": VOICE_MODEL,
                    "generation_config": {
                        "response_modalities": ["AUDIO"],
                        "temperature": 0.3,
                        "speech_config": {
                            "voice_config": {
                                "prebuilt_voice_config": {
                                    "voice_name": "Aoede"
                                }
                            }
                        },
                    },
                    "input_audio_transcription": {},
                    "output_audio_transcription": {},
                    "system_instruction": {
                        "parts": [{"text": VOICE_SYSTEM_INSTRUCTION}]
                    },
                }
            }

            await self.gemini_ws.send(json.dumps(setup_msg))
            print(f"   [WS] Setup sent, waiting for response...")
            response = await asyncio.wait_for(self.gemini_ws.recv(), timeout=30)
            response_data = json.loads(response)
            print(f"   [WS] Response: {response_data.keys()}")

            if "setupComplete" in response_data:
                self.is_running = True
                await self.client_ws.send_json({
                    "type": "status",
                    "status": "connected",
                    "session_id": self.session_id,
                })
                print(f"   [OK] Gemini Live connected for session {self.session_id}")
                return True
            else:
                error_msg = response_data.get("error", {}).get("message", str(response_data))
                print(f"   [ERROR] Gemini setup failed: {error_msg}")
                await self.client_ws.send_json({
                    "type": "error",
                    "message": f"Gemini setup failed: {error_msg}",
                })
                return False

        except asyncio.TimeoutError:
            print(f"   [ERROR] Gemini connection timeout")
            await self.client_ws.send_json({
                "type": "error",
                "message": "Gemini connection timed out",
            })
            return False
        except Exception as e:
            print(f"   [ERROR] Gemini connection error: {type(e).__name__}: {e}")
            await self.client_ws.send_json({
                "type": "error",
                "message": f"Failed to connect to Gemini: {str(e)}",
            })
            return False

    async def client_to_gemini(self):
        """Forward audio from React client → Gemini."""
        try:
            while self.is_running:
                data = await self.client_ws.receive()

                if data.get("type") == "websocket.disconnect":
                    break

                if "bytes" in data:
                    pcm_bytes = data["bytes"]
                    b64_audio = base64.b64encode(pcm_bytes).decode("utf-8")

                    msg = {
                        "realtimeInput": {
                            "mediaChunks": [
                                {
                                    "mimeType": f"audio/pcm;rate={INPUT_RATE}",
                                    "data": b64_audio,
                                }
                            ]
                        }
                    }
                    await self.gemini_ws.send(json.dumps(msg))

                elif "text" in data:
                    try:
                        msg = json.loads(data["text"])
                        if msg.get("type") == "end_session":
                            break
                        elif msg.get("type") == "turn_end":
                            # User stopped speaking — flush the realtime audio stream
                            await self.gemini_ws.send(json.dumps({
                                "realtimeInput": {
                                    "audioStreamEnd": True
                                }
                            }))
                        elif msg.get("type") == "summarize_now":
                            await self.gemini_ws.send(json.dumps({
                                "realtimeInput": {
                                    "text": "Please summarize the patient's intake in 3 to 4 short Hinglish lines, then ask: 'Kya ye vivran aapke anusaar sahi hai?'",
                                }
                            }))
                    except json.JSONDecodeError:
                        pass

        except WebSocketDisconnect:
            pass
        except Exception as e:
            print(f"[ERROR] Client→Gemini error: {e}")
        finally:
            self.is_running = False

    async def gemini_to_client(self):
        """Forward audio from Gemini → React client."""
        try:
            while self.is_running:
                response = await self.gemini_ws.recv()
                gemini_data = json.loads(response)

                # Debug: log event types received (uncomment if needed)
                # print(f"[WS] Received event types: {list(gemini_data.keys())}")

                if "serverContent" in gemini_data:
                    sc = gemini_data["serverContent"]

                    if sc.get("turnComplete", False):
                        await self.client_ws.send_json({"type": "turn_complete"})
                        continue

                    model_turn = sc.get("modelTurn", {})
                    parts = model_turn.get("parts", [])

                    for part in parts:
                        if "inlineData" in part:
                            inline = part["inlineData"]
                            mime = inline.get("mimeType", "")
                            if "audio" in mime:
                                audio_bytes = base64.b64decode(inline["data"])
                                await self.client_ws.send_bytes(audio_bytes)

                        if "text" in part:
                            await self.append_transcript("Dhara", part["text"])

                    if "inputTranscription" in sc:
                        transcription = sc["inputTranscription"]
                        user_text = transcription.get("text", "").strip()
                        if user_text:
                            await self.client_ws.send_json({
                                "type": "status",
                                "status": "recording",
                            })
                            await self.client_ws.send_json({
                                "type": "model_speaking",
                                "speaking": False,
                            })
                            await self.append_transcript(
                                "Patient",
                                user_text,
                            )

                    # NEW: Capture Dhara's speech text from outputTranscription
                    if "outputTranscription" in sc:
                        output_transcription = sc["outputTranscription"]
                        dhara_text = output_transcription.get("text", "").strip()
                        if dhara_text:
                            await self.append_transcript("Dhara", dhara_text)

                if "error" in gemini_data:
                    await self.client_ws.send_json({
                        "type": "error",
                        "message": gemini_data["error"].get("message", "Unknown"),
                    })
                    break

        except Exception as e:
            print(f"[ERROR] Gemini→Client error: {e}")
        finally:
            self.is_running = False

    async def save_transcript(self):
        """Save transcript to database."""
        if self.transcript_parts:
            content = "\n".join(self.transcript_parts)
            db = get_db()
            db.execute(
                "INSERT INTO transcripts (id, session_id, content, created_at) VALUES (?, ?, ?, ?)",
                (f"tx-{self.session_id}", self.session_id, content, datetime.now().isoformat()),
            )
            db.commit()
            db.close()
            print(f"[DB] Transcript saved for session {self.session_id}")
            return content
        return None


@app.websocket("/ws/voice")
async def websocket_voice(ws: WebSocket):
    """WebSocket endpoint for voice sessions."""
    await ws.accept()
    session_id = datetime.now().strftime("%Y%m%d_%H%M%S")
    print(f"[WS] New voice session: {session_id}")

    bridge = GeminiBridge(ws)
    active_sessions[session_id] = bridge

    try:
        print(f"   [WS] Attempting to connect to Gemini Live...")
        connected = await bridge.connect_gemini()
        if not connected:
            print(f"   [ERROR] Gemini connection failed, closing WebSocket")
            return
        print(f"   [OK] Gemini connected successfully!")

        await asyncio.gather(
            bridge.client_to_gemini(),
            bridge.gemini_to_client(),
        )

    except WebSocketDisconnect:
        print(f"[WS] Client disconnected: {session_id}")
    except Exception as e:
        print(f"[ERROR] Session error: {e}")
    finally:
        bridge.is_running = False
        await bridge.save_transcript()

        if bridge.gemini_ws:
            try:
                await bridge.gemini_ws.close()
            except Exception:
                pass

        active_sessions.pop(session_id, None)
        print(f"[WS] Session ended: {session_id}")

        try:
            await ws.send_json({
                "type": "session_ended",
                "session_id": session_id,
            })
        except Exception:
            pass


# ═══════════════════════════════════════════════════════════════════════════════
# TRANSCRIPTS ENDPOINT
# ═══════════════════════════════════════════════════════════════════════════════

@app.get("/api/transcripts")
async def list_transcripts():
    db = get_db()
    rows = db.execute("SELECT * FROM transcripts ORDER BY created_at DESC LIMIT 50").fetchall()
    db.close()
    return {"transcripts": [
        {"id": r["id"], "session_id": r["session_id"], "content": r["content"], "created_at": r["created_at"]}
        for r in rows
    ]}


# ═══════════════════════════════════════════════════════════════════════════════
# ENTRY POINT
# ═══════════════════════════════════════════════════════════════════════════════

if __name__ == "__main__":
    import uvicorn

    print("=" * 60)
    print("  AYURVEDA OPD INTELLIGENCE — Backend Server")
    print(f"  Voice Model: {VOICE_MODEL}")
    print(f"  Text Model:  {TEXT_MODEL}")
    print(f"  Database:    {DB_PATH}")
    print("  REST API:    http://localhost:8000")
    print("  WebSocket:   ws://localhost:8000/ws/voice")
    print("=" * 60)

    uvicorn.run(app, host="0.0.0.0", port=8000, log_level="info")
