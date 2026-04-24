"""
Router for Intake
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



@router.post("/api/extract-intake")
async def extract_intake(request: IntakeExtractionRequest):
    """Extract structured patient intake from transcript using Gemini."""
    transcript = sanitize_intake_transcript(request.transcript)
    lang_note = ""
    if request.language == "hi":
        lang_note = "The conversation may be in Hindi. Extract and return in English JSON."
    elif request.language == "hinglish":
        lang_note = "The conversation may be in Hinglish. Extract and return in English JSON."

    system_instruction = f"""You are a JSON extraction machine. {lang_note}
OUTPUT REQUIREMENTS:
- You MUST output ONLY a single valid JSON object
- NO text before or after the JSON
- NO thinking, reasoning, or explanations
- NO markdown formatting, NO code blocks
- The JSON must be complete and valid

EXTRACTION RULES:
- Extract EVERY detail the patient mentions - be thorough, not lazy
- NEVER return "not discussed", "no prior treatments", "no relieving factors" or similar placeholder text
- If the patient mentions bowel habits, extract exactly what they said (e.g., "regular", "constipation", "good")
- If the patient mentions sleep quality, extract exactly what they said
- If medications are mentioned, list them explicitly
- Use null ONLY if the topic was truly never discussed
- Detect red flags (chest pain, unconsciousness, severe bleeding, etc.)
- Assess dosha imbalance based on symptoms when possible

REMEMBER: Your entire response must be ONLY the JSON object. Nothing else."""

    prompt = f"""Extract structured patient intake from this conversation transcript.
Important:
- The transcript contains both Dhara's questions and the patient's answers.
- Ignore Dhara's questions and summary lines when extracting facts.
- Use the patient's answers as the primary source of truth.
- Preserve any mentioned details instead of marking them as not discussed.
- If a patient answer exists anywhere in the transcript, map it into the matching field.
- Do not omit diet, sleep, bowel, medications, relieving factors, or prior treatments if they were mentioned.

"{transcript}"

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
        missing_fields = extract_missing_intake_fields(transcript, patient_data)
        fallback_patient = build_local_intake_fallback(transcript).get("patient", {})

        if is_missing_intake_value(patient_data.get("chiefComplaint")) and fallback_patient.get("chiefComplaint"):
            patient_data["chiefComplaint"] = fallback_patient.get("chiefComplaint")
        if is_missing_intake_value(patient_data.get("duration")) and fallback_patient.get("duration"):
            patient_data["duration"] = fallback_patient.get("duration")
        if is_missing_intake_value(patient_data.get("severity")) and fallback_patient.get("severity") is not None:
            patient_data["severity"] = fallback_patient.get("severity")
        if is_missing_intake_value(patient_data.get("aggravatingFactors")) and fallback_patient.get("aggravatingFactors"):
            patient_data["aggravatingFactors"] = fallback_patient.get("aggravatingFactors")
        if is_missing_intake_value(patient_data.get("relievingFactors")) and fallback_patient.get("relievingFactors"):
            patient_data["relievingFactors"] = fallback_patient.get("relievingFactors")
        if is_missing_intake_value(patient_data.get("diet_pattern")) and fallback_patient.get("diet_pattern"):
            patient_data["diet_pattern"] = fallback_patient.get("diet_pattern")
        if is_missing_intake_value(patient_data.get("sleep_quality")) and fallback_patient.get("sleep_quality"):
            patient_data["sleep_quality"] = fallback_patient.get("sleep_quality")
        if is_missing_intake_value(patient_data.get("bowel_habits")) and fallback_patient.get("bowel_habits"):
            patient_data["bowel_habits"] = fallback_patient.get("bowel_habits")
        if is_missing_intake_value(patient_data.get("currentMedications")) and fallback_patient.get("currentMedications"):
            patient_data["currentMedications"] = fallback_patient.get("currentMedications")
        if is_missing_intake_value(patient_data.get("prior_treatments")) and fallback_patient.get("prior_treatments"):
            patient_data["prior_treatments"] = fallback_patient.get("prior_treatments")
        if is_missing_intake_value(patient_data.get("dosha")) and fallback_patient.get("dosha"):
            patient_data["dosha"] = fallback_patient.get("dosha")
        if is_missing_intake_value(patient_data.get("prakriti")) and fallback_patient.get("prakriti"):
            patient_data["prakriti"] = fallback_patient.get("prakriti")
        if is_missing_intake_value(patient_data.get("redFlags")) and fallback_patient.get("redFlags"):
            patient_data["redFlags"] = fallback_patient.get("redFlags")

        # Clean patient_data — remove LLM placeholder text and AI-generated monologue
        placeholder_patterns = [
            "not discussed", "no prior", "no relieving", "not mentioned", 
            "no current", "not captured", "no discomfort", "habits not discussed",
            "hello", "hi ", "greeting", "i've begun", "i am", "i'm now", "my focus",
            "ready to", "shifting focus", "transition", "conversational flow",
            "established", "instructed", "warm greeting", "patient:", "dharai",
        ]
        def clean_value(val):
            if isinstance(val, str):
                lower_val = val.lower()
                # If it's a known placeholder or looks like LLM monologue, return None
                if any(p in lower_val for p in placeholder_patterns):
                    return None
                # If it's very short (< 3 chars) and not a real word, likely garbage
                if len(val.strip()) < 3 and not val.isalnum():
                    return None
                return val
            elif isinstance(val, list):
                cleaned = [clean_value(v) for v in val if clean_value(v) is not None]
                return cleaned if cleaned else None
            return val

        # Clean all patient fields
        for field in ["chiefComplaint", "duration", "aggravatingFactors", "relievingFactors",
                      "diet_pattern", "sleep_quality", "bowel_habits", "currentMedications",
                      "prior_treatments", "dosha", "prakriti", "redFlags"]:
            if field in patient_data:
                cleaned = clean_value(patient_data[field])
                if cleaned is not None:
                    patient_data[field] = cleaned
                else:
                    patient_data[field] = None if field not in ["redFlags", "aggravatingFactors", "relievingFactors", "currentMedications", "prior_treatments"] else []

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
        lower_transcript = transcript.lower()
        local_flags = [f for f in RED_FLAGS if f in lower_transcript]
        if local_flags and data.get("status") != "emergency":
            data["status"] = "emergency"
            data["emergency_alert"] = {
                "triggered": True,
                "reason": f"Red flags detected: {', '.join(local_flags)}",
                "action": "Refer to emergency immediately",
            }

        # Build clean summary - only include fields that have actual values
        patient_data = data.get("patient", {})
        
        # If chiefComplaint is missing but symptoms exist, use first symptom
        if not patient_data.get("chiefComplaint") and patient_data.get("symptoms"):
            symptoms = patient_data.get("symptoms", [])
            if symptoms and len(symptoms) > 0:
                patient_data["chiefComplaint"] = symptoms[0]
        
        summary_lines = []
        if patient_data.get("chiefComplaint"):
            summary_lines.append(f"Chief complaint: {patient_data.get('chiefComplaint')}")
        if patient_data.get("duration"):
            severity_text = f" / {patient_data.get('severity')}/10" if patient_data.get('severity') else ""
            summary_lines.append(f"Duration: {patient_data.get('duration')}{severity_text}")
        if patient_data.get("aggravatingFactors"):
            val = patient_data.get('aggravatingFactors')
            val_str = ", ".join(val) if isinstance(val, list) else str(val)
            summary_lines.append(f"Aggravating factors: {val_str}")
        if patient_data.get("relievingFactors"):
            val = patient_data.get('relievingFactors')
            val_str = ", ".join(val) if isinstance(val, list) else str(val)
            summary_lines.append(f"Relieving factors: {val_str}")
        if patient_data.get("diet_pattern"):
            summary_lines.append(f"Diet: {patient_data.get('diet_pattern')}")
        if patient_data.get("sleep_quality"):
            summary_lines.append(f"Sleep: {patient_data.get('sleep_quality')}")
        if patient_data.get("bowel_habits"):
            summary_lines.append(f"Bowel: {patient_data.get('bowel_habits')}")
        if patient_data.get("currentMedications"):
            val = patient_data.get('currentMedications')
            val_str = ", ".join(val) if isinstance(val, list) else str(val)
            summary_lines.append(f"Medications: {val_str}")
        if patient_data.get("prior_treatments"):
            val = patient_data.get('prior_treatments')
            val_str = ", ".join(val) if isinstance(val, list) else str(val)
            summary_lines.append(f"Prior treatments: {val_str}")
        if patient_data.get("dosha"):
            summary_lines.append(f"Dosha: {patient_data.get('dosha')}")
        
        summary_text = "\n".join(summary_lines) or "Intake recorded."
        
        # If patient_id provided, save as intake record
        if request.patient_id:
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
            dosha_flag = patient_data.get("dosha") or ((data.get('ayurvedic_assessment') or {}).get('dosha_imbalance') or None)
            
            # Force status to "complete" if chief complaint + duration are present
            if patient_data.get("chiefComplaint") and patient_data.get("duration"):
                data["status"] = "complete"
            
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
                 transcript, json.dumps(data), summary_text, datetime.now().isoformat()),
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
        
        # Replace LLM's messy summary with our clean version
        data["summary"] = summary_text
        if "patient" in data and isinstance(data["patient"], dict):
            data["patient"]["summary"] = summary_text  # Also replace nested summary
        
        return {"success": True, "data": data}

    except Exception as e:
        print(f"[ERROR] Intake extraction error: {e}")
        fallback = build_local_intake_fallback(request.transcript)
        summary_text = fallback.get("summary_text", "Intake recorded.")
        if request.patient_id:
            fallback_patient = fallback.get("patient", {})
            db = get_db()
            intake_id = f"intake-{int(datetime.now().timestamp() * 1000)}"
            db.execute(
                """INSERT INTO intakes (id, patient_id, chief_complaint, symptoms, duration,
                   severity, aggravating_factors, diet, sleep, bowel, current_medications,
                   dosha, prakriti, vitals, red_flags, raw_transcript, extraction_json, summary, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (intake_id, request.patient_id,
                 fallback_patient.get("chiefComplaint"), json.dumps(fallback_patient.get("symptoms", [])),
                 fallback_patient.get("duration"), fallback_patient.get("severity"),
                 json.dumps(fallback_patient.get("aggravatingFactors", [])) if fallback_patient.get("aggravatingFactors") is not None else None,
                 fallback_patient.get("diet_pattern"),
                 fallback_patient.get("sleep_quality"), fallback_patient.get("bowel_habits"),
                 json.dumps(fallback_patient.get("currentMedications", [])) if fallback_patient.get("currentMedications") is not None else None,
                 fallback_patient.get("dosha"), fallback_patient.get("prakriti"),
                 None, json.dumps(fallback_patient.get("redFlags", [])),
                 transcript, json.dumps(fallback), summary_text, datetime.now().isoformat()),
            )
            db.commit()
            db.close()
        # Remove patient.summary to avoid showing raw extraction logic
        if "patient" in fallback and isinstance(fallback["patient"], dict):
            fallback["patient"]["summary"] = None
        return {"success": True, "data": fallback}



