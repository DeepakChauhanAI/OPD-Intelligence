"""
Router for Checkin
"""
import json
import asyncio
import base64
from datetime import datetime
from typing import Optional
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, UploadFile, File, Body
from pydantic import BaseModel
from config import GEMINI_API_KEY, VOICE_MODEL, TEXT_MODEL, GEMINI_LIVE_URI, VOICE_SYSTEM_INSTRUCTION, DICTATION_SYSTEM_INSTRUCTION
from models import PatientCreate, PatientUpdate, IntakeExtractionRequest, DictationRequest, CheckinRequest, SummaryRequest
from utils import get_db, active_sessions, call_gemini_text, extract_missing_intake_fields, is_missing_intake_value, build_local_intake_fallback, sanitize_intake_transcript, build_local_visit_fallback, extract_dictation_cues_from_transcript, compose_doctor_notes
import websockets

router = APIRouter(prefix="")



@router.post("/api/analyze-checkin")
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





class GenerateCheckinRequest(BaseModel):
    prescription: list
    diet_restrictions: Optional[list] = []
    patient_id: Optional[str] = None
    visit_id: Optional[str] = None

@router.post("/api/generate-checkin-questions")
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





class PostVisitCheckinRequest(BaseModel):
    responses: list
    patient_id: Optional[str] = None

@router.post("/api/analyze-postvisit-checkin")
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






@router.get("/api/checkin/{visit_id}/today")
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


@router.post("/api/checkin/{visit_id}/today")
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



