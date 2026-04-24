"""
Pydantic models for Ayurveda OPD Intelligence
"""
from pydantic import BaseModel
from typing import Optional


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
