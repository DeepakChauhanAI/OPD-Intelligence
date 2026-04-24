// ─── Domain Types ─────────────────────────────────────────────────────────────

export type Screen =
  | "dashboard"
  | "intake"
  | "dictation"
  | "visit_checkin"
  | "checkin"
  | "settings";

export type Language = "en" | "hi" | "hinglish";

export type SessionStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "recording"
  | "processing"
  | "speaking"
  | "error";

// ─── Settings ─────────────────────────────────────────────────────────────────

export interface AppSettings {
  wsEndpoint: string;
  language: Language;
  autoSpeak: boolean;
  interruptMode: boolean;
}

// ─── Patient ──────────────────────────────────────────────────────────────────

export interface Vitals {
  bp?: string;
  pulse?: number;
  temperature?: number;
  weight?: number;
  height?: number;
}

export interface PatientIntake {
  id: string;
  patientId?: string; // Links to a patient record (for existing patients)
  name: string;
  age: number | null;
  gender: "male" | "female" | "other" | null;
  chiefComplaint: string;
  symptoms: string[];
  duration: string;
  severity: "mild" | "moderate" | "severe" | null;
  aggravatingFactors?: string | null;
  relievingFactors?: string[] | string | null;
  diet?: string | null;
  diet_pattern?: string | null;
  sleep?: string | null;
  sleep_quality?: string | null;
  bowel?: string | null;
  bowel_habits?: string | null;
  currentMedications?: string | null;
  prior_treatments?: string[] | string | null;
  dosha?: string;
  prakriti?: string;
  summary?: string;
  vitals?: Vitals;
  redFlags: string[];
  timestamp: string;
}

// ─── Doctor Dictation ─────────────────────────────────────────────────────────

export interface MedicineEntry {
  name: string;
  dose: string;
  frequency: string;
  duration: string;
  route: string;
}

export interface StructuredNote {
  chief_complaint: string;
  history: string;
  examination: string;
  diagnosis: string;
  prescription: MedicineEntry[];
  follow_up: string;
  advice: string;
}

export interface PrescriptionItem {
  name: string;
  dose?: string;
  timing?: string;
  frequency?: string;
  route?: string;
  duration?: string;
}

export interface ExtractedVisit {
  diagnosis_ayurveda?: string;
  diagnosis_icd?: string; // ICD-11 or ICD-10 code
  prakriti_observed?: string; // observed Prakriti (Vata/Pitta/Kapha)
  fasting_glucose?: number | null; // mg/dL
  herbs: Array<{
    name: string; // exact herb name
    dose?: string; // e.g., '2 tablets', '5g'
    timing?: string; // e.g., 'morning empty stomach'
    vehicle?: string; // anupana, e.g., 'with warm milk'
  }>;
  diet_restrictions: string[]; // foods/behaviors to avoid
  lifestyle_advice: string[]; // activities/routines to follow
  followup_days?: number; // 7-30 typical
  doctor_notes?: string;
  needs_review?: string[]; // fields with low confidence
  confidence?: "high" | "medium" | "low";
}

export interface VisitRecord {
  id: string;
  patient_id?: string;
  raw_transcript?: string;
  extracted_json?: ExtractedVisit;
  diagnosis_ayurveda?: string;
  diagnosis_icd?: string;
  prakriti_observed?: string;
  fasting_glucose?: number | null;
  herbs: Array<{
    name: string;
    dose?: string;
    timing?: string;
    vehicle?: string;
  }>;
  diet_restrictions: string[];
  lifestyle_advice: string[];
  followup_days?: number;
  doctor_notes?: string;
  needs_review?: string[];
  status?: "draft" | "prescription_added" | "confirmed" | "completed";
  visit_date?: string;
  created_at?: string;
}

export interface DictationEntry {
  id: string;
  patientId?: string; // Links to a patient record
  timestamp: string;
  rawTranscript: string;
  structuredNote?: any; // Structured dictation or visit data
  status: "recording" | "processing" | "done" | "error";
}

// ─── Daily Check-in ──────────────────────────────────────────────────────────

export interface CheckinResponse {
  question: string;
  answer: string;
  timestamp: string;
}

export interface CheckinSummary {
  overall_status: "improving" | "stable" | "declining" | "needs_attention";
  dosha_today: string;
  key_observations: string[];
  recommendations: string[];
}

export interface DailyCheckin {
  id: string;
  patientId?: string;
  date: string;
  responses: CheckinResponse[];
  summary?: CheckinSummary;
  // Stage 1 - Pre-visit intake fields
  chief_complaint?: string;
  duration?: string;
  severity?: number;
  aggravating_factors?: string[];
  relieving_factors?: string[];
  diet_pattern?: string;
  sleep_quality?: string;
  bowel_habits?: string;
  current_medications?: string[];
  prior_treatments?: string[];
}

// ─── Post-Visit Check-in (Stage 3) ─────────────────────────────────────────────

export interface PostVisitCheckin {
  id: string;
  patientId: string;
  visitId?: string; // Link to the original visit
  date: string;
  generatedFromPrescription: string[]; // herbs/meds that were prescribed
  questions: string[]; // Auto-generated from prescription
  responses: CheckinResponse[];
  // Daily log fields
  severity_trend?: number;
  adherence_flags?: string[];
  water_intake?: string;
  meal_timing?: string;
}

// ─── Check-in Template (from visits) ────────────────────────────────────────────

export interface CheckinTemplate {
  id: string;
  visit_id: string;
  question_hi: string;
  question_en: string;
  day_range_start: number;
  day_range_end: number;
  herb_name?: string | null;
  created_at: string;
}

// ─── Daily Log (post-visit) ─────────────────────────────────────────────────────

export interface DailyLog {
  id: string;
  visit_id: string;
  patient_id?: string;
  day_number: number;
  date: string;
  questions: Array<{ question_hi: string; question_en: string }>;
  responses: Array<{ answer: string }>;
  severity_today?: number; // 1-10
  adherence_score?: number; // 0-3
  created_at: string;
}

// Auto-generated check-in questions from prescription
export interface PrescribedItem {
  name: string;
  dose?: string;
  timing?: string;
  frequency?: string;
}

export interface AutoCheckinQuestions {
  patientId: string;
  visitId: string;
  generated_at: string;
  questions: {
    question_en: string;
    question_hi: string;
    question_hinglish: string;
    related_item: string; // which prescription item this questions
  }[];
}

// ─── Ayurvedic Assessment ────────────────────────────────────────────────────

export interface AyurvedicAssessment {
  dosha_imbalance: string[];
  probable_diagnosis: string;
  suggested_herbs: string[];
  lifestyle_advice: string[];
  further_investigation: string[];
}

// ─── Emergency ───────────────────────────────────────────────────────────────

export interface EmergencyAlert {
  triggered: boolean;
  reason: string;
  action: string;
}

// ─── Clinical Extraction Result ──────────────────────────────────────────────

export interface ClinicalExtraction {
  status: "complete" | "incomplete" | "emergency";
  patient?: Partial<PatientIntake>;
  ask_followup?: string;
  emergency_alert?: EmergencyAlert;
  ayurvedic_assessment?: AyurvedicAssessment;
}

// ─── Notifications ───────────────────────────────────────────────────────────

export interface AppNotification {
  id: string;
  type: "success" | "error" | "warning" | "info";
  title: string;
  message: string;
  timestamp: string;
}

// ─── Selected Patient (for patient selection flow) ───────────────────────────

export interface SelectedPatient {
  id: string;
  name: string;
  age?: number | null;
  gender?: string | null;
  chiefComplaint?: string;
  isNew: boolean; // true = new patient, false = existing
}

// ─── Voice Engine Events ─────────────────────────────────────────────────────

export type VoiceEvent =
  | { type: "status"; status: string }
  | { type: "transcript_partial"; text: string }
  | { type: "transcript_final"; text: string }
  | { type: "assistant_text"; text: string }
  | { type: "audio"; data: ArrayBuffer }
  | { type: "turn_complete" }
  | { type: "error"; message: string }
  | { type: "model_speaking"; speaking: boolean }
  | {
      type: "clinical_summary";
      narrative: string;
      fields: Record<string, string>;
    }
  | { type: "generating_summary" }
  | { type: "transcript_file"; filename: string }
  | { type: "summary_detected"; text?: string }
  | { type: "confirmation"; value: string };

export type VoiceEventHandler = (event: VoiceEvent) => void;

// ─── Beacon Session Types (from Beacon project) ────────────────────────────────

export type BeaconSessionState =
  | "idle"
  | "connecting"
  | "connected"
  | "ended"
  | "error";

export interface TranscriptEntry {
  text: string;
  timestamp: string;
  speaker: "patient" | "beacon" | string;
  isSummary?: boolean;
}

export interface ClinicalSummaryData {
  narrative: string;
  fields: Record<string, string>;
  raw: string;
}

export interface BeaconMessage {
  type:
    | "status"
    | "model_speaking"
    | "turn_complete"
    | "transcript"
    | "session_ended"
    | "error"
    | "clinical_summary"
    | "generating_summary"
    | "summary_detected"
    | "confirmation";
  status?: string;
  session_id?: string;
  speaking?: boolean;
  text?: string;
  timestamp?: string;
  transcript_file?: string;
  message?: string;
  narrative?: string;
  fields?: Record<string, string>;
  raw?: string;
  value?: string;
}

export interface HealthResponse {
  status: string;
  model: string;
  active_sessions: number;
}

export interface TranscriptFile {
  filename: string;
  content: string;
  created: number;
}
