import { z } from "zod";

// ─── Red Flag Keywords ────────────────────────────────────────────────────────

export const RED_FLAG_SYMPTOMS = [
  "chest pain",
  "chest tightness",
  "unconscious",
  "unconsciousness",
  "not breathing",
  "difficulty breathing",
  "severe breathlessness",
  "stroke",
  "paralysis",
  "seizure",
  "convulsion",
  "severe bleeding",
  "coughing blood",
  "vomiting blood",
  "anaphylaxis",
  "anaphylactic shock",
  "heart attack",
  "cardiac arrest",
  "acute abdomen",
  "sudden vision loss",
];

// ─── Zod Schemas ──────────────────────────────────────────────────────────────

export const VitalsSchema = z.object({
  bp: z.string().optional(),
  pulse: z.number().min(20).max(300).optional(),
  temperature: z.number().min(90).max(110).optional(),
  weight: z.number().min(1).max(500).optional(),
  height: z.number().min(30).max(300).optional(),
});

export const MedicineEntrySchema = z.object({
  name: z.string().min(1),
  dose: z.string().min(1),
  frequency: z.string().min(1),
  duration: z.string().min(1),
  route: z.string().default("oral"),
});

export const AyurvedicAssessmentSchema = z.object({
  dosha_imbalance: z.array(z.string()),
  probable_diagnosis: z.string(),
  suggested_herbs: z.array(z.string()),
  lifestyle_advice: z.array(z.string()),
  further_investigation: z.array(z.string()),
});

export const EmergencyAlertSchema = z.object({
  triggered: z.boolean(),
  reason: z.string(),
  action: z.string(),
});

export const PatientIntakeSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  age: z.number().min(0).max(150).nullable(),
  gender: z.enum(["male", "female", "other"]).nullable(),
  chiefComplaint: z.string().min(1),
  symptoms: z.array(z.string()),
  duration: z.string(),
  severity: z.enum(["mild", "moderate", "severe"]).nullable(),
  aggravatingFactors: z.string().optional(),
  diet: z.string().optional(),
  sleep: z.string().optional(),
  bowel: z.string().optional(),
  currentMedications: z.string().optional(),
  dosha: z
    .enum([
      "vata",
      "pitta",
      "kapha",
      "vata-pitta",
      "pitta-kapha",
      "vata-kapha",
      "tridosha",
    ])
    .optional(),
  prakriti: z.string().optional(),
  vitals: VitalsSchema.optional(),
  redFlags: z.array(z.string()),
  timestamp: z.string(),
});

export const ClinicalExtractionSchema = z.object({
  status: z.enum(["complete", "incomplete", "emergency"]),
  patient: PatientIntakeSchema.partial().optional(),
  ask_followup: z.string().optional(),
  emergency_alert: EmergencyAlertSchema.optional(),
  ayurvedic_assessment: AyurvedicAssessmentSchema.optional(),
});

export const StructuredNoteSchema = z.object({
  chief_complaint: z.string(),
  history: z.string(),
  examination: z.string(),
  diagnosis: z.string(),
  prescription: z.array(MedicineEntrySchema),
  follow_up: z.string(),
  advice: z.string(),
});

export const DictationEntrySchema = z.object({
  id: z.string(),
  timestamp: z.string(),
  rawTranscript: z.string(),
  structuredNote: StructuredNoteSchema.optional(),
  status: z.enum(["recording", "processing", "done", "error"]),
});

export const CheckinSummarySchema = z.object({
  overall_status: z.enum([
    "improving",
    "stable",
    "declining",
    "needs_attention",
  ]),
  dosha_today: z.string(),
  key_observations: z.array(z.string()),
  recommendations: z.array(z.string()),
});

// ─── Red Flag Detection ───────────────────────────────────────────────────────

export function detectRedFlags(text: string): string[] {
  const lower = text.toLowerCase();
  return RED_FLAG_SYMPTOMS.filter((flag) => lower.includes(flag));
}

export function isEmergency(text: string): boolean {
  return detectRedFlags(text).length > 0;
}

// ─── LLM Output Validator ─────────────────────────────────────────────────────

export function validateClinicalExtraction(raw: unknown) {
  const result = ClinicalExtractionSchema.safeParse(raw);
  if (!result.success) {
    return {
      success: false,
      error: result.error.flatten(),
      data: null,
    };
  }
  return { success: true, error: null, data: result.data };
}

export function validateStructuredNote(raw: unknown) {
  const result = StructuredNoteSchema.safeParse(raw);
  if (!result.success) {
    return { success: false, error: result.error.flatten(), data: null };
  }
  return { success: true, error: null, data: result.data };
}

export function validateCheckinSummary(raw: unknown) {
  const result = CheckinSummarySchema.safeParse(raw);
  if (!result.success) {
    return { success: false, error: result.error.flatten(), data: null };
  }
  return { success: true, error: null, data: result.data };
}
