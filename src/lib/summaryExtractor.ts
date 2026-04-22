/**
 * Extracts structured medical data from Gemini's reasoning/thinking text
 * and generates a proper clinical summary.
 */

import type { TranscriptEntry } from "../types";

export interface ExtractedMedicalData {
  chiefComplaint: string | null;
  onset: string | null;
  location: string | null;
  duration: string | null;
  character: string | null;
  aggravating: string | null;
  relieving: string | null;
  timing: string | null;
  severity: string | null;
  associatedSymptoms: string | null;
  medicalHistory: string | null;
  medications: string | null;
  allergies: string | null;
}

function extractValue(text: string, patterns: RegExp[]): string | null {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      let value = match[1].trim();
      value = value.replace(/[.,;:]+$/, "").trim();
      value = value.replace(/^["']|["']$/g, "").trim();
      if (value.length > 0) {
        return value;
      }
    }
  }
  return null;
}

export function extractMedicalData(
  entries: TranscriptEntry[],
): ExtractedMedicalData {
  const fullText = entries.map((e) => e.text).join("\n");
  const data: ExtractedMedicalData = {
    chiefComplaint: null,
    onset: null,
    location: null,
    duration: null,
    character: null,
    aggravating: null,
    relieving: null,
    timing: null,
    severity: null,
    associatedSymptoms: null,
    medicalHistory: null,
    medications: null,
    allergies: null,
  };

  for (const entry of entries) {
    const text = entry.text;
    const lower = text.toLowerCase();

    if (
      !data.chiefComplaint &&
      (lower.includes("chief complaint") ||
        lower.includes("brings you in") ||
        lower.includes("main concern"))
    ) {
      data.chiefComplaint = extractValue(text, [
        /chief complaint (?:of|is|:)\s*(.+?)(?:\.|,\s*as|\s*Now|\s*I(?:'|'))/i,
        /complaint[^.]*?(?:of|is|:)\s+(.+?)(?:\.|,|\s+Now|\s+I(?:'|'))/i,
        /brings you in[^.]*?(?:is|:)?\s+(.+?)(?:\.|$)/i,
        /complaining (?:of|about)\s+(.+?)(?:\.|,|$)/i,
        /presenting with\s+(.+?)(?:\.|,|$)/i,
      ]);
    }

    if (
      !data.onset &&
      (lower.includes("onset") ||
        lower.includes("first start") ||
        lower.includes("when did") ||
        lower.includes("first began"))
    ) {
      data.onset = extractValue(text, [
        /onset[^.]*?(?:as|is|of|:)\s+(.+?)(?:\.|,\s*Now|\s+Now|\s+I(?:'|'))/i,
        /(?:started|began|first)[^.]*?(?:approximately|about|around)?\s*(.+?\b(?:ago|back|week|month|day|year|yesterday|today|recently|gradually)\b[^.]*?)(?:\.|,|$)/i,
        /(?:it|this|pain|symptoms?)\s+(?:started|began)\s+(.+?)(?:\.|,|$)/i,
      ]);
    }

    if (
      !data.location &&
      (lower.includes("location") ||
        lower.includes("where") ||
        lower.includes("area"))
    ) {
      data.location = extractValue(text, [
        /location[^.]*?(?:is|of|:)\s+["']?(.+?)["']?(?:\.|,\s*I|\s+I(?:'|'))/i,
        /(?:which is|that is|feels? it|located)\s+["']?(.+?)["']?(?:\.|,|$)/i,
      ]);
    }

    if (
      !data.duration &&
      (lower.includes("duration") ||
        lower.includes("how long") ||
        lower.includes("continuous") ||
        lower.includes("constant"))
    ) {
      data.duration = extractValue(text, [
        /duration[^.]*?(?:is|of|:)\s+["']?(.+?)["']?(?:\.|,\s*I|\s+I(?:'|'))/i,
        /["'](.+?(?:continuous|constant|intermittent|comes and goes|not going away|all day|all the time)[^"']*)["']/i,
      ]);
    }

    if (
      !data.character &&
      (lower.includes("character") ||
        lower.includes("sharp") ||
        lower.includes("dull") ||
        lower.includes("burning") ||
        lower.includes("aching"))
    ) {
      data.character = extractValue(text, [
        /(?:pain|it)\s+is\s+(sharp|dull|burning|aching|throbbing|stabbing|cramping|shooting|tingling|pressure|squeezing|tearing)[^.]*/i,
        /(?:character|nature|type)[^.]*?(?:is|:)\s+["']?(.+?)["']?(?:\.|,\s*I|\s+Now|\s+I(?:'|'))/i,
      ]);
    }

    if (
      !data.aggravating &&
      (lower.includes("aggravat") ||
        lower.includes("worse") ||
        lower.includes("exacerbat") ||
        lower.includes("makes it worse"))
    ) {
      data.aggravating = extractValue(text, [
        /(?:aggravat|exacerbat|worsen|makes?\s+(?:it\s+)?worse)[^.]*?(?:is|by|:|\s)\s*(.+?)(?:\.\s*(?:That|This|I|Now)|\.|,\s*(?:and|I)|$)/i,
      ]);
    }

    if (
      !data.relieving &&
      (lower.includes("reliev") ||
        lower.includes("better") ||
        lower.includes("alleviat") ||
        lower.includes("helps") ||
        lower.includes("eases"))
    ) {
      data.relieving = extractValue(text, [
        /(?:reliev|alleviat|helps|eases|makes?\s+(?:it\s+)?better)[^.]*?(?:is|by|:)\s*(.+?)(?:\.\s*(?:Now|I|This)|\.|,\s*I|$)/i,
      ]);
    }

    if (
      !data.timing &&
      (lower.includes("timing") ||
        lower.includes("constant") ||
        lower.includes("intermittent") ||
        lower.includes("comes and goes"))
    ) {
      if (lower.includes("timing")) {
        data.timing = extractValue(text, [
          /timing[^.]*?(?:is|:)\s+["']?(.+?)["']?(?:\.|,\s*I|\s+I(?:'|'))/i,
          /(?:nature|pain)\s+is\s+(constant|intermittent|continuous|periodic|comes and goes|episodic)[^.]*/i,
        ]);
      }
    }

    if (
      !data.severity &&
      (lower.includes("severity") ||
        lower.includes("scale") ||
        lower.includes("/10") ||
        lower.includes("out of ten"))
    ) {
      data.severity = extractValue(text, [
        /severity[^.]*?(?:score|rating|level|is|of|:)\s*(?:(?:of|at|is)\s+)?(\d+\s*(?:\/|out of)\s*10)/i,
        /(\d+\s*(?:\/|out of)\s*10)/i,
      ]);
      if (data.severity && /^\d+$/.test(data.severity)) {
        data.severity = `${data.severity}/10`;
      }
    }

    if (
      !data.associatedSymptoms &&
      (lower.includes("associated") ||
        lower.includes("other symptom") ||
        lower.includes("alongside") ||
        lower.includes("difficulty"))
    ) {
      data.associatedSymptoms = extractValue(text, [
        /(?:associated|other|additional)\s+symptoms?[^.]*?(?:is|are|include|:)\s+(.+?)(?:\.\s*(?:Now|I|This)|\.|$)/i,
      ]);
    }

    if (
      !data.medicalHistory &&
      (lower.includes("medical history") ||
        lower.includes("existing") ||
        lower.includes("condition") ||
        lower.includes("diagnosed"))
    ) {
      data.medicalHistory = extractValue(text, [
        /(?:medical history|existing condition|past medical|medical condition)[^.]*?(?:is|includes?|of|:)\s+(.+?)(?:\.\s*(?:Now|I|This)|\.|$)/i,
      ]);
      if (data.medicalHistory) {
        data.medicalHistory = data.medicalHistory
          .replace(
            /^(?:the\s+)?(?:user(?:'s)?\s+)?(?:confirmation\s+)?(?:of\s+)?/i,
            "",
          )
          .trim();
      }
    }

    if (
      !data.medications &&
      (lower.includes("medication") ||
        lower.includes("taking") ||
        lower.includes("prescription"))
    ) {
      data.medications = extractValue(text, [
        /medication[^.]*?(?:is|are|includes?|:)\s+(.+?)(?:\.\s*(?:Now|I|My)|\.|$)/i,
        /(?:currently\s+)?(?:taking|on|using)\s+(.+?)(?:\.\s*(?:Now|I|My)|\.|$)/i,
      ]);
      if (
        !data.medications &&
        (lower.includes("negative response") ||
          lower.includes("not taking") ||
          lower.includes("no medication") ||
          lower.includes("none"))
      ) {
        data.medications = "None reported";
      }
    }

    if (!data.allergies && lower.includes("allerg")) {
      data.allergies = extractValue(text, [
        /allerg[^.]*?(?:is|to|includes?|:)\s+(.+?)(?:\.\s*(?:Now|I|It|This)|\.|;|$)/i,
        /allergic\s+to\s+(.+?)(?:\.\s*(?:Now|I|It|This)|\.|;|$)/i,
      ]);
      if (data.allergies) {
        data.allergies = data.allergies
          .replace(/^(?:the\s+)?(?:user(?:'s)?\s+)?/i, "")
          .trim();
      }
    }
  }

  if (!data.chiefComplaint) {
    data.chiefComplaint = extractValue(fullText, [
      /chief complaint (?:of|is|:)\s*(.+?)(?:\.|,\s*as)/i,
      /(?:complain(?:ing|s)?|presenting) (?:of|with|about)\s+(.+?)(?:\.|,)/i,
    ]);
  }

  return data;
}

export function generateStructuredSummary(
  data: ExtractedMedicalData,
): { label: string; value: string }[] {
  const fields: { label: string; value: string }[] = [];

  if (data.chiefComplaint)
    fields.push({ label: "Chief Complaint", value: data.chiefComplaint });
  if (data.onset) fields.push({ label: "Onset", value: data.onset });
  if (data.location) fields.push({ label: "Location", value: data.location });
  if (data.duration) fields.push({ label: "Duration", value: data.duration });
  if (data.character)
    fields.push({ label: "Character", value: data.character });
  if (data.aggravating)
    fields.push({ label: "Aggravating Factors", value: data.aggravating });
  if (data.relieving)
    fields.push({ label: "Relieving Factors", value: data.relieving });
  if (data.timing) fields.push({ label: "Timing", value: data.timing });
  if (data.severity) fields.push({ label: "Severity", value: data.severity });
  if (data.associatedSymptoms)
    fields.push({
      label: "Associated Symptoms",
      value: data.associatedSymptoms,
    });
  if (data.medicalHistory)
    fields.push({ label: "Medical History", value: data.medicalHistory });
  if (data.medications)
    fields.push({ label: "Medications", value: data.medications });
  if (data.allergies)
    fields.push({ label: "Allergies", value: data.allergies });

  return fields;
}

export function getCompletionStats(data: ExtractedMedicalData): {
  captured: number;
  total: number;
  percentage: number;
} {
  const total = 13;
  let captured = 0;
  for (const value of Object.values(data)) {
    if (value !== null) captured++;
  }
  return { captured, total, percentage: Math.round((captured / total) * 100) };
}
