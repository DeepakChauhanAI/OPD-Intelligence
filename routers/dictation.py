"""
Router for Dictation
"""
import json
import asyncio
import base64
import urllib.request
import urllib.error
from datetime import datetime
from typing import Optional
from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect, UploadFile, File, Form, Body
from pydantic import BaseModel
from config import GEMINI_API_KEY, VOICE_MODEL, TEXT_MODEL, GEMINI_LIVE_URI, VOICE_SYSTEM_INSTRUCTION, DICTATION_SYSTEM_INSTRUCTION
from models import PatientCreate, PatientUpdate, IntakeExtractionRequest, DictationRequest, CheckinRequest, SummaryRequest
from utils import get_db, active_sessions, call_gemini_text, extract_missing_intake_fields, is_missing_intake_value, build_local_intake_fallback, sanitize_intake_transcript, build_local_visit_fallback, extract_dictation_cues_from_transcript, compose_doctor_notes
import websockets

router = APIRouter(prefix="")





# ─── Audio Transcription using Gemini Multimodal ───────────────────────────────

@router.post("/api/dictation/transcribe")
async def dictation_transcribe(
    audio: UploadFile = File(...),
    patient_id: Optional[str] = Form(None),
    language_hint: Optional[str] = Form("en"),
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
        if not patient_id:
            return {
                "success": False,
                "error": "patient_id required for dictation transcription",
            }

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
        extracted = await extract_visit_from_transcript(transcript, patient_id)

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
                patient_id,
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
- For doctor_notes, write a short clinical summary of the advice and findings.
- Do not copy the entire transcript into doctor_notes.
- If the doctor gives lifestyle or diet advice in Hindi/Hinglish, extract it into the correct fields.
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

        local_cues = extract_dictation_cues_from_transcript(transcript)
        transcript_lower = transcript.lower()
        has_prescription_cues = any(
            phrase in transcript_lower
            for phrase in [
                "tablet",
                "tab ",
                "vati",
                "churna",
                "powder",
                "dose",
                "ml",
                "mg",
                "syrup",
                "medicine",
                "medicine",
                "dawai",
                "kadha",
                "medicine",
            ]
        )

        if local_cues.get("diet_restrictions") and (
            not isinstance(data.get("diet_restrictions"), list)
            or len(data.get("diet_restrictions") or []) == 0
        ):
            data["diet_restrictions"] = local_cues["diet_restrictions"]

        if local_cues.get("lifestyle_advice") and (
            not isinstance(data.get("lifestyle_advice"), list)
            or len(data.get("lifestyle_advice") or []) == 0
        ):
            data["lifestyle_advice"] = local_cues["lifestyle_advice"]

        if local_cues.get("followup_days") and (
            not isinstance(data.get("followup_days"), (int, float))
            or data.get("followup_days") < 1
            or data.get("followup_days") > 365
        ):
            data["followup_days"] = local_cues["followup_days"]

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
        if not isinstance(herbs, list) or len(herbs) == 0:
            if has_prescription_cues:
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
        }

        doctor_notes = data.get("doctor_notes", "")
        if isinstance(doctor_notes, str):
            doctor_notes = doctor_notes.strip()
        if not doctor_notes or doctor_notes == transcript.strip() or len(doctor_notes) > 250:
            doctor_notes = compose_doctor_notes(structured, transcript)

        return {
            **structured,
            "doctor_notes": doctor_notes,
            "needs_review": needs_review,
            "confidence": confidence,
        }

    except Exception as e:
        print(f"[WARN] Extraction fallback used: {e}")
        return build_local_visit_fallback(transcript)



class DictationProcessRequest(BaseModel):
    transcript: str
    patient_id: Optional[str] = None


@router.post("/api/dictation/process")
async def process_dictation(request: DictationProcessRequest):
    """
    Process a dictation transcript (from WebSocket session) into structured data.
    Returns extracted visit record with confidence/review flags.
    Also links the most recent intake for this patient so the visit row
    carries a reference to the pre-consultation intake record.
    Generates check-in templates automatically from the extracted prescription.
    """
    try:
        if not request.patient_id:
            return {
                "success": False,
                "error": "patient_id required for dictation processing",
            }

        extracted = await extract_visit_from_transcript(request.transcript, request.patient_id)

        # Resolve the most recent intake_id for this patient (may be None)
        intake_id = None
        severity_initial = None
        db = get_db()
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

        # Create visit record (linked to intake) with status 'draft'
        visit_id = f"visit-{int(datetime.now().timestamp() * 1000)}"
        followup_days = extracted.get("followup_days") or 30
        
        db.execute(
            """INSERT INTO visits (
                id, patient_id, intake_id, raw_transcript, extracted_json,
                diagnosis_ayurveda, diagnosis_icd11, prakriti_observed,
                fasting_glucose, herbs, diet_restrictions, lifestyle_advice,
                followup_days, doctor_notes, needs_review,
                status, visit_date, severity_initial, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                visit_id,
                request.patient_id,
                intake_id,
                request.transcript,
                json.dumps(extracted),
                extracted.get("diagnosis_ayurveda"),
                extracted.get("diagnosis_icd"),
                extracted.get("prakriti_observed"),
                extracted.get("fasting_glucose"),
                json.dumps(extracted.get("herbs", [])),
                json.dumps(extracted.get("diet_restrictions", [])),
                json.dumps(extracted.get("lifestyle_advice", [])),
                followup_days,
                extracted.get("doctor_notes"),
                json.dumps(extracted.get("needs_review", [])),
                "draft",
                datetime.now().strftime("%Y-%m-%d"),
                severity_initial,
                datetime.now().isoformat(),
            ),
        )

        # Link visit to patient's last_visit
        db.execute(
            """UPDATE patients SET last_visit_id = ?, updated_at = ? WHERE id = ?""",
            (visit_id, datetime.now().isoformat(), request.patient_id),
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

@router.post("/api/dictation/confirm")
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
               SET extracted_json = ?, 
                   diagnosis_ayurveda = ?,
                   diagnosis_icd11 = ?,
                   prakriti_observed = ?,
                   fasting_glucose = ?,
                   herbs = ?,
                   diet_restrictions = ?,
                   lifestyle_advice = ?,
                   doctor_notes = ?,
                   needs_review = ?,
                   status = 'prescription_added', 
                   followup_days = ?, 
                   severity_initial = ?, 
                   updated_at = ?
               WHERE id = ?""",
            (
                json.dumps(corrected), 
                corrected.get("diagnosis_ayurveda"),
                corrected.get("diagnosis_icd"),
                corrected.get("prakriti_observed"),
                corrected.get("fasting_glucose"),
                json.dumps(corrected.get("herbs", [])),
                json.dumps(corrected.get("diet_restrictions", [])),
                json.dumps(corrected.get("lifestyle_advice", [])),
                corrected.get("doctor_notes"),
                json.dumps([]), # Clear needs_review on confirmation
                followup_days, 
                severity_initial, 
                datetime.now().isoformat(), 
                visit_id
            ),
        )

        # Generate check-in question templates (3 questions, valid for entire followup period)
        # First check if templates already exist for this visit
        existing = db.execute(
            "SELECT COUNT(*) as cnt FROM checkin_templates WHERE visit_id = ?",
            (visit_id,)
        ).fetchone()
        
        if existing and existing["cnt"] > 0:
            print(f"[WARN] Check-in templates already exist for visit {visit_id}, skipping generation")
            templates = []  # Empty list since we're not regenerating
        else:
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









@router.get("/api/visits")
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
    return {"success": True, "visits": visits}


@router.get("/api/visits/{visit_id}")
async def get_visit(visit_id: str):
    """Get a single visit record."""
    db = get_db()
    r = db.execute("SELECT * FROM visits WHERE id = ?", (visit_id,)).fetchone()
    db.close()
    if not r:
        raise HTTPException(status_code=404, detail="Visit not found")
    return {
        "success": True,
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


@router.get("/api/visits/{visit_id}/templates")
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


@router.get("/api/dictations")
async def list_dictations(patient_id: Optional[str] = None):
    db = get_db()
    if patient_id:
        rows = db.execute(
            "SELECT * FROM dictations WHERE patient_id = ? ORDER BY created_at DESC", (patient_id,)
        ).fetchall()
    else:
        rows = db.execute("SELECT * FROM dictations ORDER BY created_at DESC").fetchall()
    db.close()
    return {"success": True, "dictations": [
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


@router.get("/api/dictations/latest-checkin-questions")
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


@router.get("/api/checkins")
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





@router.websocket("/ws/dictation")
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



