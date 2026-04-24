"""
Router for Patients
"""
import json
import asyncio
import base64
from datetime import datetime
from typing import Optional
from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect, UploadFile, File, Body
from pydantic import BaseModel
from config import GEMINI_API_KEY, VOICE_MODEL, TEXT_MODEL, GEMINI_LIVE_URI, VOICE_SYSTEM_INSTRUCTION, DICTATION_SYSTEM_INSTRUCTION
from models import PatientCreate, PatientUpdate, IntakeExtractionRequest, DictationRequest, CheckinRequest, SummaryRequest
from utils import get_db, active_sessions, call_gemini_text, extract_missing_intake_fields, is_missing_intake_value, build_local_intake_fallback, sanitize_intake_transcript, build_local_visit_fallback, extract_dictation_cues_from_transcript, compose_doctor_notes
import websockets

router = APIRouter(prefix="")


def row_to_dict(row):
    if not row:
        return None
    return dict(row)


def safe_json_loads(value, default):
    if value is None:
        return default
    try:
        return json.loads(value)
    except Exception:
        return value



@router.get("/api/health")
async def health():
    return {
        "status": "online",
        "voice_model": VOICE_MODEL,
        "text_model": TEXT_MODEL,
        "active_sessions": len(active_sessions),
    }


@router.get("/api/patients")
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


@router.post("/api/patients")
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


@router.get("/api/patients/{patient_id}")
async def get_patient(patient_id: str):
    db = get_db()
    r = db.execute("SELECT * FROM patients WHERE id = ?", (patient_id,)).fetchone()
    db.close()
    if not r:
        raise HTTPException(status_code=404, detail="Patient not found")
    return {
        "id": r["id"],
        "name": r["name"],
        "age": r["age"],
        "gender": r["gender"],
        "chiefComplaint": r["chief_complaint"],
        "symptoms": safe_json_loads(r["symptoms"], []),
        "duration": r["duration"],
        "severity": r["severity"],
        "dosha": r["dosha"],
        "prakriti": r["prakriti"],
        "vitals": safe_json_loads(r["vitals"], None),
        "redFlags": safe_json_loads(r["red_flags"], []),
        "aggravatingFactors": r["aggravating_factors"],
        "diet": r["diet"],
        "sleep": r["sleep"],
        "bowel": r["bowel"],
        "currentMedications": r["current_medications"],
        "timestamp": r["created_at"],
    }


@router.get("/api/patients/{patient_id}/intake-summary")
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

    return {
        "success": True,
        "intake": {
            "id": row["id"],
            "patient_name": row["name"],
            "patient_age": row["age"],
            "patient_gender": row["gender"],
            "chief_complaint": row["chief_complaint"],
            "symptoms": safe_json_loads(row["symptoms"], []),
            "duration": row["duration"],
            "severity": row["severity"],
            "aggravating_factors": safe_json_loads(row["aggravating_factors"], []),
            "diet": row["diet"],
            "sleep": row["sleep"],
            "bowel": row["bowel"],
            "current_medications": safe_json_loads(row["current_medications"], []),
            "dosha": row["dosha"],
            "prakriti": row["prakriti"],
            "red_flags": safe_json_loads(row["red_flags"], []),
            "summary": row["summary"] if "summary" in row.keys() else None,
            "created_at": row["created_at"],
        },
    }


@router.get("/api/patients/{patient_id}/intakes")
async def get_patient_intakes(patient_id: str):
    """
    Returns all historical intake records for a patient.
    Used to browse history in the doctor dictation view.
    """
    db = get_db()
    rows = db.execute(
        """SELECT * FROM intakes 
           WHERE patient_id = ?
           ORDER BY created_at DESC""",
        (patient_id,)
    ).fetchall()
    db.close()

    intakes = []
    for r in rows:
        intakes.append({
            "id": r["id"],
            "chief_complaint": r["chief_complaint"],
            "symptoms": safe_json_loads(r["symptoms"], []),
            "duration": r["duration"],
            "severity": r["severity"],
            "aggravating_factors": safe_json_loads(r["aggravating_factors"], []),
            "diet": r["diet"],
            "sleep": r["sleep"],
            "bowel": r["bowel"],
            "current_medications": safe_json_loads(r["current_medications"], []),
            "dosha": r["dosha"],
            "prakriti": r["prakriti"],
            "red_flags": safe_json_loads(r["red_flags"], []),
            "summary": r["summary"] if "summary" in r.keys() else None,
            "created_at": r["created_at"],
        })

    return {"success": True, "intakes": intakes}


@router.put("/api/patients/{patient_id}")
async def update_patient(patient_id: str, patient: PatientUpdate):
    db = get_db()
    existing = db.execute("SELECT * FROM patients WHERE id = ?", (patient_id,)).fetchone()
    if not existing:
        db.close()
        raise HTTPException(status_code=404, detail="Patient not found")

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



