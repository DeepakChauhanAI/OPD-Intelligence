"""
Utility functions for Ayurveda OPD Intelligence
"""
import asyncio
import base64
import json
import os
import re
import time
import urllib.request
import urllib.error
from contextlib import asynccontextmanager
from datetime import datetime
from typing import Optional

from config import DB_PATH, GEMINI_TEXT_API
from models import PatientCreate, PatientUpdate, IntakeExtractionRequest, DictationRequest, CheckinRequest, SummaryRequest

import sqlite3

# Active sessions store (shared state)
active_sessions = {}


def get_db():
    conn = sqlite3.connect(DB_PATH, timeout=30)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=30000")
    return conn


def call_gemini_text(prompt: str, system_instruction: str = "", temperature: float = 0.2) -> dict:
    """Call Gemini text API and return parsed JSON."""
    body = {
        "contents": [{"role": "user", "parts": [{"text": prompt}]}],
        "generationConfig": {
            "temperature": temperature,
            "responseMimeType": "application/json",
            "thinkingConfig": {"thinkingBudget": 0},  # Disable thinking output
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

    # Extract JSON from possible mixed text (find first { and last })
    try:
        return json.loads(clean)
    except json.JSONDecodeError:
        # Try to extract JSON from mixed text
        # Method 1: Find first { and matching last }
        start = clean.find("{")
        end = clean.rfind("}") + 1
        if start != -1 and end != 0:
            try:
                return json.loads(clean[start:end])
            except json.JSONDecodeError:
                pass
        
        # Method 2: Use regex to find JSON pattern
        import re
        json_match = re.search(r'\{[^{}]*\{[^{}]*\}[^{}]*\}|\{[^{}]*\}', clean, re.DOTALL)
        if json_match:
            try:
                return json.loads(json_match.group(0))
            except json.JSONDecodeError:
                pass
        
        raise ValueError(f"Could not parse JSON from response: {clean[:200]}")


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


def sanitize_intake_transcript(transcript: str) -> str:
    """
    Remove the closing summary/confirmation tail from a voice-to-voice intake.

    The patient-facing summary and yes/no confirmation are useful for the UI,
    but they can confuse extraction if we feed the entire conversation back in.
    """
    lines = []
    stop_patterns = [
        r"kya ye vivran aapke anusaar sahi hai",
        r"summary.*correct",
        r"is this summary correct",
        r"^\s*summary\s*:",
    ]
    stop = False
    for line in transcript.splitlines():
        if any(re.search(p, line, re.IGNORECASE) for p in stop_patterns):
            stop = True
        if not stop:
            lines.append(line)
    return "\n".join(lines)


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
    transcript = sanitize_intake_transcript(transcript)

    def clean_line(line: str) -> str:
        cleaned = re.sub(r"^\[.*?\]\s*", "", line.strip())
        cleaned = re.sub(r"^(Dhara|Patient|Doctor|User|Pt)\s*:\s*", "", cleaned, flags=re.IGNORECASE)
        return cleaned.strip()

    answer_lines = [clean_line(line) for line in build_intake_answer_blocks(transcript)]
    if not any(answer_lines):
        answer_lines = [clean_line(transcript)]
    patient_text = " ".join(line for line in answer_lines if line) or clean_line(transcript)
    lower_text = patient_text.lower()

    def line_at(index: int) -> str:
        return answer_lines[index] if index < len(answer_lines) else ""

    def first_matching_line(index: int, keywords: list[str]) -> str:
        # First check the expected index
        candidate = line_at(index)
        if candidate and any(keyword in candidate.lower() for keyword in keywords):
            return candidate
        # Search all lines for a keyword match
        for line in answer_lines:
            if any(keyword in line.lower() for keyword in keywords):
                return line
        # Nothing found — return empty string (not the candidate)
        return ""

    complaint = first_matching_line(
        0,
        [
            "pain", "problem", "takleef", "complaint", "dard", "issue",
            "jalan", "burning", "stomach", "pet", "fever", "bukhar",
            "cough", "khansi", "headache", "sir dard", "body pain",
            "kamzori", "weakness", "nausea", "vomit",
        ],
    ) or "not captured"
    if complaint == "not captured":
        sentence_candidates = [
            sent.strip()
            for sent in re.split(r"[।.!?]\s+|\n+", patient_text)
            if sent.strip()
        ]
        if sentence_candidates:
            complaint = sentence_candidates[0][:120]
    duration_text = first_matching_line(1, ["din", "day", "days", "hafte", "week", "weeks", "mahine", "month", "months"])
    severity_text = first_matching_line(2, ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "severity"])
    aggravating_text = first_matching_line(3, ["badh", "worse", "increase", "heat", "khaana", "mausam", "samay", "night"])
    diet_text = first_matching_line(4, ["diet", "khata", "khaate", "khana", "saada", "teekha", "tala", "spicy", "masala"])
    sleep_text = first_matching_line(5, ["sleep", "neend", "sona", "uthna", "acchi", "good", "bad"])
    bowel_text = first_matching_line(6, ["bowel", "kabz", "petcchala", "pet chala", "constipation", "stool", "regular"])
    meds_text = first_matching_line(7, ["dawai", "medicine", "medications", "kadha", "ayurvedic", "churna", "vati", "ashwagandha", "le raha"])
    relieving_text = first_matching_line(8, ["relief", "better", "behtar", "kam", "sukoon", "relieving", "no worse"])
    prior_treatments_text = first_matching_line(9, ["treatment", "इलाज", "upchar", "therapy", "cure", "prior", "pehle"])

    duration_match = re.search(
        r"(\d+\s*(?:din|days?|hafte|weeks?|mahine|months?)|"
        r"(?:ek|ek|1)\s*(?:din|day|days|hafte|week|weeks|mahina|month|months)|"
        r"(?:do|\u0926\u094b|2)\s*(?:din|\u0926\u093f\u0928|day|days|hafte|week|weeks|mahine|months?)|"
        r"(?:tin|\u0924\u0940\u0928|3)\s*(?:din|\u0926\u093f\u0928|day|days|hafte|week|weeks|mahine|months?)|"
        r"last night|since last night|since yesterday|past\s+\d+\s*days?|previous\s+\d+\s*days?)",
        duration_text or lower_text,
        flags=re.IGNORECASE,
    )
    severity_match = re.search(r"\b(10|[1-9])\b", severity_text or lower_text)

    aggravating = aggravating_text if aggravating_text else None
    diet = diet_text if diet_text else None
    sleep = sleep_text if sleep_text else None
    bowel = bowel_text if bowel_text else None
    medications = meds_text if meds_text else None
    relieving = relieving_text if relieving_text else None
    prior_treatments = prior_treatments_text if prior_treatments_text else None

    # Build clean summary - only include fields that have actual values
    summary_lines = []
    if complaint:
        summary_lines.append(f"Chief complaint: {complaint}.")
    if duration_match:
        severity_text = f" / {severity_match.group(1)}/10" if severity_match else ""
        summary_lines.append(f"Duration: {duration_match.group(1)}{severity_text}.")
    if aggravating:
        summary_lines.append(f"Aggravating factors: {aggravating}.")
    if relieving:
        summary_lines.append(f"Relieving factors: {relieving}.")
    if diet:
        summary_lines.append(f"Diet: {diet}.")
    if sleep:
        summary_lines.append(f"Sleep: {sleep}.")
    if bowel:
        summary_lines.append(f"Bowel: {bowel}.")
    if medications:
        summary_lines.append(f"Medications: {medications}.")
    if prior_treatments:
        summary_lines.append(f"Prior treatments: {prior_treatments}.")

    # Determine status - complete if we have chief complaint and duration
    status = "complete" if complaint and duration_match else "incomplete"

    patient = {
        "name": None,
        "age": None,
        "gender": None,
        "chiefComplaint": complaint or None,
        "symptoms": [],
        "duration": duration_match.group(1) if duration_match else None,
        "severity": int(severity_match.group(1)) if severity_match else None,
        "aggravatingFactors": [aggravating] if aggravating else None,
        "relievingFactors": [relieving] if relieving else None,
        "diet_pattern": diet or None,
        "sleep_quality": sleep or None,
        "bowel_habits": bowel or None,
        "currentMedications": [medications] if medications else None,
        "prior_treatments": [prior_treatments] if prior_treatments else None,
        "dosha": None,
        "prakriti": None,
        "redFlags": [],
        "summary": "\n".join(summary_lines),
    }

    return {
        "status": status,
        "patient": patient,
        "ask_followup": "Gemini unavailable; fallback extraction used." if status == "incomplete" else None,
        "emergency_alert": None,
        "ayurvedic_assessment": {
            "dosha_imbalance": [],
            "probable_diagnosis": "Fallback extraction only",
            "suggested_herbs": [],
            "lifestyle_advice": [],
            "further_investigation": [],
        },
        "summary_text": "\n".join(summary_lines) or "Intake recorded.",
    }


def build_local_visit_fallback(transcript: str) -> dict:
    """
    Best-effort fallback for doctor dictation extraction.

    This keeps the visit-processing flow alive when Gemini is unavailable by
    returning a safe, schema-complete payload with low confidence.
    """
    cleaned_lines = [
        re.sub(r"^\s*[-*•]\s*", "", line.strip())
        for line in transcript.splitlines()
        if line.strip()
    ]
    local_cues = extract_dictation_cues_from_transcript(transcript)
    doctor_notes = local_cues.get("doctor_notes") or "\n".join(cleaned_lines).strip() or transcript.strip()

    return {
        "diagnosis_ayurveda": None,
        "diagnosis_icd": None,
        "prakriti_observed": None,
        "fasting_glucose": None,
        "herbs": [],
        "diet_restrictions": local_cues.get("diet_restrictions", []),
        "lifestyle_advice": local_cues.get("lifestyle_advice", []),
        "followup_days": local_cues.get("followup_days") or 30,
        "doctor_notes": doctor_notes[:2000],
        "needs_review": ["diagnosis_ayurveda"],
        "confidence": "low",
    }


def extract_dictation_cues_from_transcript(transcript: str) -> dict:
    """
    Lightweight local parsing for common doctor dictation phrases.

    This is intentionally conservative. It only extracts details that are
    stated clearly in the transcript, especially for Hindi/Hinglish dictation.
    """
    transcript = sanitize_intake_transcript(transcript)
    text = re.sub(r"\s+", " ", transcript.strip().lower())

    def add_unique(items: list[str], value: str) -> None:
        value = value.strip()
        if value and value not in items:
            items.append(value)

    diet_restrictions: list[str] = []
    lifestyle_advice: list[str] = []
    followup_days: Optional[int] = None

    if any(
        phrase in text
        for phrase in [
            "tala hua", "\u0924\u0932\u093e \u0939\u0941\u0906", "fried", "deep fried", "deep-fried",
        ]
    ):
        add_unique(diet_restrictions, "Avoid fried foods")

    if any(
        phrase in text
        for phrase in [
            "taral", "\u0924\u0930\u0932", "fluids", "liquid", "paani", "\u092a\u093e\u0928\u0940",
        ]
    ):
        add_unique(lifestyle_advice, "Increase water and fluids")

    if (
        "blood glucose" in text
        or "blood sugar" in text
        or "sugar level" in text
        or "gluco" in text
        or "\u0917\u094d\u0932\u0942\u0915" in text
        or "\u0917\u094d\u0932\u0942\u0915\u094b" in text
    ):
        add_unique(lifestyle_advice, "Check blood glucose before the next visit")

    if any(
        phrase in text
        for phrase in [
            "lifestyle", "\u0932\u093e\u0907\u092b\u0938\u094d\u091f\u093e\u0907\u0932", "\u091c\u0940\u0935\u0928\u0936\u0948\u0932\u0940",
        ]
    ):
        add_unique(lifestyle_advice, "Make lifestyle changes promptly")

    followup_patterns = [
        r"(\d+)\s*(?:din|\u0926\u093f\u0928|day|days|dinon|\u0926\u093f\u0928\u094b\u0902)\s*(?:baad|bad|later)?",
        r"(?:follow\s*up|followup|review|recheck|wapis|\u0935\u093e\u092a\u0938)\s*(?:.*?)(\d+)\s*(?:din|\u0926\u093f\u0928|day|days)",
    ]
    for pattern in followup_patterns:
        match = re.search(pattern, text)
        if match:
            try:
                followup_days = int(match.group(1))
                break
            except (ValueError, TypeError, IndexError):
                continue

    doctor_notes_parts = []
    if "\u0938\u0940\u0930\u093f\u092f\u0938" in transcript or "serious" in text:
        doctor_notes_parts.append("Condition appears serious.")
    if lifestyle_advice:
        doctor_notes_parts.append("; ".join(lifestyle_advice))
    if diet_restrictions:
        doctor_notes_parts.append("; ".join(diet_restrictions))
    if followup_days is not None:
        doctor_notes_parts.append(f"Follow up in {followup_days} days.")

    return {
        "diet_restrictions": diet_restrictions,
        "lifestyle_advice": lifestyle_advice,
        "followup_days": followup_days,
        "doctor_notes": " ".join(doctor_notes_parts).strip(),
    }


def compose_doctor_notes(structured: dict, transcript: str) -> str:
    """
    Create a short clinical summary for the Doctor Notes field.

    The transcript remains the raw spoken text; this field should summarize
    the actionable takeaways in a concise form.
    """
    parts = []

    if structured.get("diagnosis_ayurveda"):
        parts.append(f"Dx: {structured['diagnosis_ayurveda']}.")

    if structured.get("diet_restrictions"):
        diet = "; ".join(structured["diet_restrictions"][:3])
        parts.append(f"Diet: {diet}.")

    if structured.get("lifestyle_advice"):
        advice = "; ".join(structured["lifestyle_advice"][:3])
        parts.append(f"Advice: {advice}.")

    if structured.get("followup_days"):
        parts.append(f"Follow up in {structured['followup_days']} days.")

    if structured.get("fasting_glucose") is not None:
        parts.append(f"Check fasting glucose: {structured['fasting_glucose']}.")

    if not parts:
        cues = extract_dictation_cues_from_transcript(transcript)
        if cues.get("doctor_notes"):
            return cues["doctor_notes"]
        return "No structured clinical note extracted."

    return " ".join(parts).strip()
