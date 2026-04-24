/**
 * LLM Client — Backend-Only Mode
 * All Gemini API calls are proxied through the FastAPI backend.
 * No API keys are sent from the browser.
 */

// ─── Intake Extraction ───────────────────────────────────────────────────────

export async function extractIntake(
  transcript: string,
  language: string = "en",
  patientId?: string,
): Promise<{ success: boolean; data?: any; error?: string }> {
  try {
    const res = await fetch("/api/extract-intake", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transcript, language, patient_id: patientId }),
    });

    const json = await res.json();
    if (!res.ok || !json.success) {
      return { success: false, error: json.error || `HTTP ${res.status}` };
    }

    return { success: true, data: json.data };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

// ─── Structure Dictation (Legacy — for old dictation format) ───────────────────

export async function structureDictation(
  transcript: string,
  patientId?: string,
): Promise<{ success: boolean; data?: any; error?: string }> {
  try {
    const res = await fetch("/api/structure-dictation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transcript, patient_id: patientId }),
    });

    const json = await res.json();
    if (!res.ok || !json.success) {
      return { success: false, error: json.error || `HTTP ${res.status}` };
    }

    return { success: true, data: json.data };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

// ─── Process Visit (Clinical Dictation — new endpoint) ─────────────────────────

export async function processVisit(
  transcript: string,
  patientId?: string,
): Promise<{
  success: boolean;
  data?: any;
  checkin_questions?: string[];
  error?: string;
}> {
  // Deprecated - use transcribeDictation + confirmVisit instead
  try {
    const res = await fetch("/api/process-visit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transcript, patient_id: patientId }),
    });

    const json = await res.json();
    if (!res.ok || !json.success) {
      return { success: false, error: json.error || `HTTP ${res.status}` };
    }

    return {
      success: true,
      data: json.visit,
      checkin_questions: json.checkin_questions,
    };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

// ─── Dictation Audio Transcription (Gemini Multimodal) ─────────────────────────

export async function transcribeDictation(
  audioBlob: Blob,
  patientId?: string,
  languageHint: string = "en",
): Promise<{
  success: boolean;
  visit_id?: string;
  transcript?: string;
  extracted?: any;
  needs_review?: string[];
  confidence?: string;
  error?: string;
}> {
  try {
    const formData = new FormData();
    formData.append("audio", audioBlob, "dictation.webm");
    formData.append("patient_id", patientId || "");
    formData.append("language_hint", languageHint);

    const res = await fetch("/api/dictation/transcribe", {
      method: "POST",
      body: formData,
    });

    const json = await res.json();
    if (!res.ok || !json.success) {
      return { success: false, error: json.error || `HTTP ${res.status}` };
    }

    return {
      success: true,
      visit_id: json.visit_id,
      transcript: json.transcript,
      extracted: json.extracted,
      needs_review: json.needs_review,
      confidence: json.confidence,
    };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

// ─── Process Dictation (WebSocket flow → structured extraction) ───────

export async function processDictation(
  transcript: string,
  patientId?: string,
): Promise<{
  success: boolean;
  visit_id?: string;
  extracted?: any;
  needs_review?: string[];
  confidence?: string;
  checkin_templates_generated?: number;
  error?: string;
}> {
  try {
    const res = await fetch("/api/dictation/process", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transcript, patient_id: patientId }),
    });

    const json = await res.json();
    if (!res.ok || !json.success) {
      return { success: false, error: json.error || `HTTP ${res.status}` };
    }

    return {
      success: true,
      visit_id: json.visit_id,
      extracted: json.extracted,
      needs_review: json.needs_review,
      confidence: json.confidence,
      checkin_templates_generated: json.checkin_templates_generated,
    };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

// ─── Confirm / Finalize Visit ──────────────────────────────────────────────────

export async function confirmVisit(
  visitId: string,
  correctedExtractedJson: any,
): Promise<{
  success: boolean;
  ok?: boolean;
  checkin_templates_generated?: number;
  error?: string;
}> {
  try {
    const res = await fetch("/api/dictation/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        visit_id: visitId,
        extracted_json: correctedExtractedJson,
      }),
    });

    const json = await res.json();
    if (!res.ok) {
      return { success: false, error: json.error || `HTTP ${res.status}` };
    }

    return {
      success: true,
      ok: json.ok,
      checkin_templates_generated: json.checkin_templates_generated,
    };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

// ─── Check-in Analysis ──────────────────────────────────────────────────────

export async function analyzeCheckin(
  responses: { question: string; answer: string }[],
  patientId?: string,
): Promise<{ success: boolean; data?: any; error?: string }> {
  try {
    const res = await fetch("/api/analyze-checkin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ responses, patient_id: patientId }),
    });

    const json = await res.json();
    if (!res.ok || !json.success) {
      return { success: false, error: json.error || `HTTP ${res.status}` };
    }

    return { success: true, data: json.data };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

// ─── Create Patient (via backend) ────────────────────────────────────────────

export async function createPatient(
  name: string,
  age?: number | null,
  gender?: string | null,
): Promise<{ success: boolean; id?: string; error?: string }> {
  try {
    const res = await fetch("/api/patients", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, age, gender }),
    });

    const json = await res.json();
    if (!res.ok) {
      return { success: false, error: json.error || `HTTP ${res.status}` };
    }

    return { success: true, id: json.id };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

// ─── Update Patient (via backend) ────────────────────────────────────────────

export async function updatePatient(
  patientId: string,
  data: Record<string, any>,
): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await fetch(`/api/patients/${patientId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });

    const json = await res.json();
    if (!res.ok) {
      return { success: false, error: json.error || `HTTP ${res.status}` };
    }

    return { success: true };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

// ─── Generate Auto Check-in Questions from Prescription ──────────────────────

interface PrescriptionItem {
  name: string;
  dose?: string;
  timing?: string;
  frequency?: string;
}

interface GenerateCheckinQuestionsParams {
  prescription: PrescriptionItem[];
  diet_restrictions?: string[];
  patientId: string;
  visitId: string;
}

export async function generateCheckinQuestions(
  params: GenerateCheckinQuestionsParams,
): Promise<{ success: boolean; data?: any; error?: string }> {
  try {
    const res = await fetch("/api/generate-checkin-questions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    });

    const json = await res.json();
    if (!res.ok || !json.success) {
      return { success: false, error: json.error || `HTTP ${res.status}` };
    }

    return { success: true, data: json.data };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

// ─── Analyze Post-Visit Check-in (Stage 3) ─────────────────────────────────────

interface PostVisitResponse {
  question: string;
  answer: string;
}

export async function analyzePostVisitCheckin(
  responses: PostVisitResponse[],
  patientId?: string,
): Promise<{ success: boolean; data?: any; error?: string }> {
  try {
    const res = await fetch("/api/analyze-postvisit-checkin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ responses, patient_id: patientId }),
    });

    const json = await res.json();
    if (!res.ok || !json.success) {
      return { success: false, error: json.error || `HTTP ${res.status}` };
    }

    return { success: true, data: json.data };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

// ─── Get Latest Check-in Questions from Dictation ─────────────────────────

export async function getLatestCheckinQuestions(
  patientId: string,
): Promise<{ success: boolean; questions?: string[]; error?: string }> {
  try {
    const res = await fetch(
      `/api/dictations/latest-checkin-questions?patient_id=${patientId}`,
    );

    const json = await res.json();
    if (!res.ok || !json.success) {
      return { success: false, error: json.error || `HTTP ${res.status}` };
    }

    return { success: true, questions: json.questions };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

// ─── Get Visits List ────────────────────────────────────────────────────────────

export async function getVisits(patientId?: string): Promise<{
  success: boolean;
  visits?: any[];
  error?: string;
}> {
  try {
    const url = patientId
      ? `/api/visits?patient_id=${patientId}`
      : "/api/visits";
    const res = await fetch(url);
    const json = await res.json();
    if (!res.ok || !json.success) {
      return { success: false, error: json.error || `HTTP ${res.status}` };
    }
    return { success: true, visits: json.visits };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

// ─── Get Single Visit ───────────────────────────────────────────────────────────

export async function getVisit(visitId: string): Promise<{
  success: boolean;
  visit?: any;
  error?: string;
}> {
  try {
    const res = await fetch(`/api/visits/${visitId}`);
    const json = await res.json();
    if (!res.ok || !json.success) {
      return { success: false, error: json.error || `HTTP ${res.status}` };
    }
    return { success: true, visit: json };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

// ─── Get Today's Check-in Questions (Module 3) ──────────────────────────────────

export async function getCheckinToday(visitId: string): Promise<{
  success: boolean;
  questions?: Array<{
    question_hi: string;
    question_en: string;
    herb_name?: string;
  }>;
  day_number?: number;
  followup_days?: number;
  error?: string;
}> {
  try {
    const res = await fetch(`/api/checkin/${visitId}/today`);
    const json = await res.json();
    if (!res.ok || !json.success) {
      return { success: false, error: json.error || `HTTP ${res.status}` };
    }
    return {
      success: true,
      questions: json.questions,
      day_number: json.day_number,
      followup_days: json.followup_days,
    };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

// ─── Get Patient Intake Summary (for Doctor pre-consult brief) ──────────────────

export interface PatientIntakeSummary {
  id: string;
  patient_name: string;
  patient_age: number | null;
  patient_gender: string | null;
  chief_complaint: string | null;
  symptoms: string[];
  duration: string | null;
  severity: string | null;
  aggravating_factors: string[];
  diet: string | null;
  sleep: string | null;
  bowel: string | null;
  current_medications: string[];
  dosha: string | null;
  prakriti: string | null;
  red_flags: string[];
  summary: string | null;
  created_at: string;
}

export async function getPatientIntakeSummary(patientId: string): Promise<{
  success: boolean;
  intake?: PatientIntakeSummary | null;
  error?: string;
}> {
  try {
    const res = await fetch(`/api/patients/${patientId}/intake-summary`);
    const json = await res.json();
    if (!res.ok) {
      return { success: false, error: json.error || `HTTP ${res.status}` };
    }
    return { success: true, intake: json.intake ?? null };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

/**
 * Get all historical intake records for a patient.
 */
export async function getPatientIntakes(patientId: string): Promise<{
  success: boolean;
  intakes?: PatientIntakeSummary[];
  error?: string;
}> {
  try {
    const res = await fetch(`/api/patients/${patientId}/intakes`);
    const json = await res.json();
    if (!res.ok) {
      return { success: false, error: json.error || `HTTP ${res.status}` };
    }
    return { success: true, intakes: json.intakes || [] };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

// ─── Submit Today's Check-in Answers (Module 3) ─────────────────────────────────

export async function submitCheckinToday(
  visitId: string,
  a1: string,
  a2: string,
  a3: string,
  severity_today?: number,
): Promise<{
  success: boolean;
  adherence_score?: number;
  day_number?: number;
  alert_flag?: boolean;
  error?: string;
}> {
  try {
    const res = await fetch(`/api/checkin/${visitId}/today`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        a1,
        a2,
        a3,
        severity_today: severity_today ?? null,
      }),
    });

    const json = await res.json();
    if (!res.ok || !json.success) {
      return { success: false, error: json.error || `HTTP ${res.status}` };
    }

    return {
      success: true,
      adherence_score: json.adherence_score,
      day_number: json.day_number,
      alert_flag: json.alert_flag,
    };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}
