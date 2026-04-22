import { useMemo } from "react";
import type { TranscriptEntry, ClinicalSummaryData } from "../types";

interface SummaryModalProps {
  visible: boolean;
  transcript: TranscriptEntry[];
  sessionId: string | null;
  elapsedTime: number;
  clinicalSummary: ClinicalSummaryData | null;
  isGeneratingSummary: boolean;
  onDownload: () => void;
  onNewSession: () => void;
  onGoHome: () => void;
}

const DISPLAY_FIELDS = [
  { key: "chief_complaint", label: "Chief Complaint" },
  { key: "onset", label: "Onset" },
  { key: "location", label: "Location" },
  { key: "duration", label: "Duration" },
  { key: "character", label: "Character" },
  { key: "aggravating_factors", label: "Aggravating Factors" },
  { key: "relieving_factors", label: "Relieving Factors" },
  { key: "timing", label: "Timing" },
  { key: "severity", label: "Severity" },
  { key: "associated_symptoms", label: "Associated Symptoms" },
  { key: "medical_history", label: "Medical History" },
  { key: "current_medications", label: "Current Medications" },
  { key: "allergies", label: "Allergies" },
];

function lookupField(
  fields: Record<string, string>,
  canonicalKey: string,
): string | null {
  if (fields[canonicalKey]) return fields[canonicalKey].trim();
  const shortKey = canonicalKey
    .replace("_factors", "")
    .replace("_symptoms", "");
  if (fields[shortKey]) return fields[shortKey].trim();
  const noPrefix = canonicalKey.replace("current_", "");
  if (fields[noPrefix]) return fields[noPrefix].trim();
  const lowerCanonical = canonicalKey.toLowerCase().replace(/_/g, "");
  for (const [k, v] of Object.entries(fields)) {
    const lowerK = k.toLowerCase().replace(/_/g, "");
    if (lowerK === lowerCanonical && v && v.trim()) return v.trim();
  }
  return null;
}

function isNotCaptured(value: string): boolean {
  const lower = value.toLowerCase().trim();
  return (
    lower === "not discussed" ||
    lower === "not captured" ||
    lower === "not mentioned" ||
    lower === "not reported" ||
    lower === "not provided" ||
    lower === "n/a" ||
    lower === "unknown" ||
    lower === ""
  );
}

export function SummaryModal({
  visible,
  transcript,
  sessionId,
  elapsedTime,
  clinicalSummary,
  isGeneratingSummary,
  onDownload,
  onNewSession,
  onGoHome,
}: SummaryModalProps) {
  if (!visible) return null;

  const minutes = Math.floor(elapsedTime / 60);
  const seconds = elapsedTime % 60;
  const timeStr = `${minutes}m ${seconds}s`;
  const dateStr = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const timeOfDay = new Date().toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
  });

  const processedFields = useMemo(() => {
    if (
      !clinicalSummary?.fields ||
      Object.keys(clinicalSummary.fields).length === 0
    ) {
      return { captured: [], missing: DISPLAY_FIELDS.map((f) => f.label) };
    }

    const captured: { label: string; value: string }[] = [];
    const missing: string[] = [];

    for (const field of DISPLAY_FIELDS) {
      const value = lookupField(clinicalSummary.fields, field.key);
      if (value && !isNotCaptured(value)) {
        captured.push({ label: field.label, value });
      } else {
        missing.push(field.label);
      }
    }

    return { captured, missing };
  }, [clinicalSummary]);

  const narrative = clinicalSummary?.narrative || "";
  const hasBackendSummary = !!narrative || processedFields.captured.length > 0;
  const capturedCount = processedFields.captured.length;
  const totalCount = DISPLAY_FIELDS.length;
  const percentage = Math.round((capturedCount / totalCount) * 100);
  const hasData = hasBackendSummary || transcript.length > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="animate-fade-in bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] flex flex-col overflow-hidden">
        <div className="px-6 pt-6 pb-4 border-b border-slate-100 bg-gradient-to-r from-emerald-50 to-blue-50 shrink-0">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-100 shadow-sm">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-6 w-6 text-emerald-600"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
            </div>
            <div>
              <h2 className="text-xl font-bold text-slate-800">
                Intake Session Complete
              </h2>
              <div className="flex items-center gap-3 mt-0.5">
                <span className="text-xs text-slate-400">
                  {dateStr} at {timeOfDay}
                </span>
                <span className="text-xs text-slate-400">• {timeStr}</span>
                {sessionId && (
                  <span className="text-xs text-slate-400 font-mono">
                    • #{sessionId}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="px-6 py-2.5 bg-slate-50 border-b border-slate-100 flex items-center gap-4 shrink-0">
          <div className="flex items-center gap-1.5 text-xs text-slate-500">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-3.5 w-3.5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
              />
            </svg>
            <span>
              <strong>{transcript.length}</strong> entries logged
            </span>
          </div>
          {hasBackendSummary && (
            <>
              <div
                className={`flex items-center gap-1.5 text-xs ${percentage >= 80 ? "text-emerald-600" : percentage >= 50 ? "text-amber-600" : "text-red-500"}`}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-3.5 w-3.5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M9 12l2 2 4-4"
                  />
                </svg>
                <span>
                  <strong>
                    {capturedCount}/{totalCount}
                  </strong>{" "}
                  fields ({percentage}%)
                </span>
              </div>
              <div className="flex items-center gap-1.5 text-xs text-blue-600">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-3.5 w-3.5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M5 13l4 4L19 7"
                  />
                </svg>
                <span>AI-generated summary</span>
              </div>
            </>
          )}
        </div>

        <div className="flex-1 overflow-y-auto">
          {isGeneratingSummary && (
            <div className="px-6 py-8 text-center bg-blue-50/50">
              <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-blue-100 mb-4">
                <div className="h-7 w-7 border-2 border-blue-300 border-t-blue-600 rounded-full animate-spin" />
              </div>
              <p className="text-blue-700 font-semibold">
                Generating Clinical Summary...
              </p>
              <p className="text-xs text-blue-500 mt-1">
                Analyzing the interview data to extract patient information
              </p>
            </div>
          )}

          {!isGeneratingSummary && hasData ? (
            <div className="divide-y divide-slate-100">
              {narrative && (
                <div className="px-6 py-5 bg-emerald-50/60">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-emerald-100">
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        className="h-4 w-4 text-emerald-600"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={2}
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"
                        />
                      </svg>
                    </div>
                    <div>
                      <h3 className="text-sm font-bold uppercase tracking-wider text-emerald-800">
                        Clinical Assessment Summary
                      </h3>
                      <p className="text-[10px] text-emerald-600">
                        AI-extracted from interview
                      </p>
                    </div>
                  </div>

                  <div className="ml-10 bg-white rounded-lg p-4 border border-emerald-200 shadow-sm">
                    <p className="text-sm text-emerald-900 leading-relaxed font-medium">
                      {narrative}
                    </p>
                  </div>
                </div>
              )}

              {processedFields.captured.length > 0 && (
                <div className="px-6 py-5">
                  <div className="flex items-center gap-2 mb-4">
                    <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-blue-100">
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        className="h-4 w-4 text-blue-600"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={2}
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M4 6h16M4 10h16M4 14h16M4 18h16"
                        />
                      </svg>
                    </div>
                    <div>
                      <h3 className="text-sm font-bold uppercase tracking-wider text-slate-700">
                        OLDCARTS Assessment
                      </h3>
                      <p className="text-[10px] text-slate-500">
                        Structured patient data
                      </p>
                    </div>
                  </div>

                  <div className="ml-10 bg-slate-50 rounded-lg border border-slate-200 overflow-hidden">
                    <table className="w-full text-sm">
                      <tbody className="divide-y divide-slate-200">
                        {processedFields.captured.map((field, i) => (
                          <tr
                            key={i}
                            className={
                              i % 2 === 0 ? "bg-white" : "bg-slate-50/50"
                            }
                          >
                            <td className="px-4 py-2.5 font-semibold text-slate-600 w-[160px] align-top whitespace-nowrap">
                              {field.label}
                            </td>
                            <td className="px-4 py-2.5 text-slate-800">
                              {field.value}
                            </td>
                          </tr>
                        ))}
                        {processedFields.missing.map((label, i) => (
                          <tr key={`missing-${i}`} className="bg-amber-50/50">
                            <td className="px-4 py-2 font-semibold text-slate-400 w-[160px] align-top whitespace-nowrap">
                              {label}
                            </td>
                            <td className="px-4 py-2 text-slate-400 italic text-xs">
                              Not captured
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="ml-10 mt-3">
                    <div className="flex items-center justify-between text-xs text-slate-500 mb-1">
                      <span>Data Completeness</span>
                      <span className="font-semibold">{percentage}%</span>
                    </div>
                    <div className="h-2 bg-slate-200 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-500 ${
                          percentage >= 80
                            ? "bg-emerald-500"
                            : percentage >= 50
                              ? "bg-amber-500"
                              : "bg-red-400"
                        }`}
                        style={{ width: `${percentage}%` }}
                      />
                    </div>
                  </div>
                </div>
              )}

              {!hasBackendSummary && transcript.length > 0 && (
                <div className="px-6 py-5 bg-amber-50/50">
                  <div className="flex items-center gap-2 mb-2">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      className="h-5 w-5 text-amber-500"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z"
                      />
                    </svg>
                    <p className="text-sm text-amber-700 font-medium">
                      AI summary generation was not available
                    </p>
                  </div>
                  <p className="text-xs text-amber-600 ml-7">
                    Please ensure the backend server is running and has access
                    to the Gemini API.
                  </p>
                </div>
              )}

              {transcript.length > 0 && (
                <details className="px-6 py-4 group" open={!hasBackendSummary}>
                  <summary className="flex items-center gap-2 cursor-pointer text-sm font-semibold text-slate-500 hover:text-slate-700 transition-colors select-none">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      className="h-4 w-4 transition-transform group-open:rotate-90"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M9 5l7 7-7 7"
                      />
                    </svg>
                    Raw Conversation Log ({transcript.length} entries)
                  </summary>
                  <div className="mt-3 space-y-2 ml-6 max-h-60 overflow-y-auto">
                    {transcript.map((entry, i) => (
                      <div key={i} className="flex gap-3 text-xs">
                        <span className="text-slate-300 font-mono shrink-0 mt-0.5">
                          {entry.timestamp}
                        </span>
                        <p className="text-slate-500 leading-relaxed">
                          {entry.text}
                        </p>
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </div>
          ) : !isGeneratingSummary ? (
            <div className="text-center py-12 px-6 space-y-4">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-amber-50">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-8 w-8 text-amber-400"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={1.5}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                  />
                </svg>
              </div>
              <div>
                <p className="text-slate-600 font-medium text-lg">
                  No clinical data captured
                </p>
                <p className="text-sm text-slate-400 mt-2 max-w-sm mx-auto">
                  The interview may not have completed enough phases to generate
                  a summary.
                </p>
              </div>
            </div>
          ) : null}
        </div>

        <div className="px-6 py-2.5 bg-blue-50/50 border-t border-blue-100/50 shrink-0">
          <div className="flex items-center gap-2 text-xs text-blue-700">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-4 w-4 shrink-0"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            <span className="font-medium">
              This documentation will be reviewed by your healthcare provider.
            </span>
          </div>
        </div>

        <div className="px-6 py-4 border-t border-slate-100 bg-slate-50/50 space-y-3 shrink-0">
          <div className="flex flex-col sm:flex-row gap-2">
            <button
              onClick={onDownload}
              disabled={!hasData || isGeneratingSummary}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-white border border-slate-200 text-slate-700 font-medium text-sm hover:bg-slate-50 hover:border-slate-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-4 w-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                />
              </svg>
              Download Report
            </button>
            <button
              onClick={onNewSession}
              className="flex-1 px-4 py-2.5 rounded-xl bg-gradient-to-r from-blue-500 to-blue-700 text-white font-medium text-sm hover:from-blue-600 hover:to-blue-800 transition-colors shadow-md shadow-blue-200/50"
            >
              New Session
            </button>
          </div>
          <button
            onClick={onGoHome}
            className="w-full px-4 py-2 rounded-xl text-slate-500 font-medium text-sm hover:text-slate-700 hover:bg-white transition-colors"
          >
            ← Back to Home
          </button>
        </div>
      </div>
    </div>
  );
}
