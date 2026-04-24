/**
 * Doctor Dictation Screen — REAL-TIME WEBSOCKET SYSTEM
 *
 * Three-step flow:
 *   1. Select patient
 *   2. Record audio via WebSocket → live transcript shown in real-time
 *   3. Stop → auto-transcribe + extract (non-blocking) → review structured data → confirm
 */

import { useState, useRef, useEffect, useCallback } from "react";
import {
  FileText,
  Pill,
  Stethoscope,
  Mic,
  Square,
  Loader2,
  AlertTriangle,
  Check,
  Clock,
} from "lucide-react";
import { Card, CardHeader, CardTitle } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Badge } from "../components/ui/Badge";
import { PatientSelector } from "../components/PatientSelector";
import { useAppStore } from "../store/useAppStore";
import { confirmVisit, getPatientIntakes, processDictation } from "../lib/llmClient";
import type { PatientIntakeSummary } from "../lib/llmClient";
import { DictationEngine } from "../lib/dictationEngine";
import type { ExtractedVisit, SelectedPatient, Language } from "../types";

type Phase = "select" | "recording" | "processing" | "review" | "confirmed";

export function DoctorDictationScreen() {
  const {
    dictationList,
    addDictation,
    updateDictation,
    addNotification,
    selectedPatient,
    setSelectedPatient,
    settings,
    updateSettings,
  } = useAppStore();

  const [phase, setPhase] = useState<Phase>("select");
  const [transcript, setTranscript] = useState("");
  const [liveTranscript, setLiveTranscript] = useState("");
  const [extracted, setExtracted] = useState<ExtractedVisit | null>(null);
  const [needsReview, setNeedsReview] = useState<string[]>([]);
  const [visitId, setVisitId] = useState<string>("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [dictationEntryId, setDictationEntryId] = useState("");
  const [recordingTime, setRecordingTime] = useState(0);
  const [selectedLanguage, setSelectedLanguage] = useState<string>(
    settings.language || "hinglish",
  );
  const [intakeSummary, setIntakeSummary] =
    useState<PatientIntakeSummary | null>(null);
  const [historicalIntakes, setHistoricalIntakes] = useState<
    PatientIntakeSummary[]
  >([]);
  const [isLoadingIntake, setIsLoadingIntake] = useState(false);
  const [showPatientBackground, setShowPatientBackground] = useState(false);
  const [showRecentDictations, setShowRecentDictations] = useState(false);

  const engineRef = useRef<DictationEngine | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const liveTranscriptRef = useRef("");
  const hasStructuredExtractionRef = useRef(false);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      engineRef.current?.disconnect();
    };
  }, []);

  // Auto-clear needsReview when required fields are filled
  useEffect(() => {
    if (!extracted) return;

    setNeedsReview((prev) =>
      prev.filter((field) => {
        if (field === "diagnosis_ayurveda")
          return !extracted.diagnosis_ayurveda?.trim();
        if (field === "followup_days") return !extracted.followup_days;

        if (field === "herbs") {
          const herbs = Array.isArray(extracted.herbs) ? extracted.herbs : [];
          if (herbs.length === 0) return true;
          const hasMissing = herbs.some(
            (h) => !h.name?.trim() || !h.dose?.trim() || !h.timing?.trim(),
          );
          return hasMissing;
        }

        const match = field.match(/^herbs\[(\d+)\]\.(.+)$/);
        if (match) {
          const idx = parseInt(match[1]);
          const key = match[2];
          const herb = extracted.herbs[idx];
          if (!herb) return false;
          if (key === "name") return !herb.name?.trim();
          if (key === "dose") return !herb.dose?.trim();
          if (key === "timing") return !herb.timing?.trim();
        }

        return true; // Keep other unknown fields requiring review
      }),
    );
  }, [extracted]);

  // ── Patient Selection ─────────────────────────────────────────

  const handlePatientSelected = async (patient: SelectedPatient) => {
    setSelectedPatient(patient);
    setIntakeSummary(null);
    setHistoricalIntakes([]);
    setPhase("select");

    // Fetch patient's full intake history for doctor's context
    if (patient.id && !patient.isNew) {
      setIsLoadingIntake(true);
      try {
        const res = await getPatientIntakes(patient.id);
        if (res.success && Array.isArray(res.intakes)) {
          const normalizedIntakes = res.intakes.map(normalizeHistoricalIntake);
          setHistoricalIntakes(normalizedIntakes);
          // Default to the most recent one
          if (normalizedIntakes.length > 0) {
            setIntakeSummary(normalizedIntakes[0]);
          }
        }
      } catch {
        // non-fatal — intake history is optional context
      } finally {
        setIsLoadingIntake(false);
      }
    }
  };

  // ── Transcribe & Extract ──────────────────────────────────────

  const processTranscript = useCallback(
    async (fullTranscript: string) => {
      if (!fullTranscript.trim()) {
        addNotification({
          type: "error",
          title: "No Transcript",
          message: "No speech was captured. Please try again.",
        });
        setPhase("select");
        return;
      }

      setIsProcessing(true);
      setPhase("processing");

      try {
        // Use processDictation from llmClient
        const result = await processDictation(fullTranscript, selectedPatient?.id);

        if (!result.success) {
          throw new Error(result.error || "Extraction failed");
        }

        const extractedData = result.extracted as ExtractedVisit;
        setTranscript(fullTranscript);
        setExtracted(extractedData);
        setNeedsReview(Array.isArray(result.needs_review) ? result.needs_review : []);
        setVisitId(result.visit_id || "");
        hasStructuredExtractionRef.current = true;

        const entryId = result.visit_id || `dict-${Date.now()}`;
        setDictationEntryId(entryId);

        addDictation({
          id: entryId,
          patientId: selectedPatient?.id,
          timestamp: new Date().toISOString(),
          rawTranscript: fullTranscript,
          structuredNote: extractedData as any,
          status: "processing",
        });

        setPhase("review");

        addNotification({
          type: "info",
          title: "Transcription Complete",
          message: `Review extracted data${Array.isArray(result.needs_review) && result.needs_review.length ? ` — ${result.needs_review.length} fields need review` : ""}`,
        });
      } catch (err) {
        addNotification({
          type: "error",
          title: "Transcription Failed",
          message: String(err),
        });
        setPhase("select");
      } finally {
        setIsProcessing(false);
      }
    },
    [selectedPatient, addDictation, addNotification],
  );

  // ── Dictation Engine Event Handler ───────────────────────────────────

  const handleDictationEvent = useCallback(
    (event: any) => {
      switch (event.type) {
        case "status":
          if (event.status === "connected") {
            setPhase("recording");
          } else if (event.status === "recording") {
            setPhase("recording");
          } else if (event.status === "processing") {
            setPhase("processing");
          } else if (event.status === "idle") {
            // do nothing
          } else if (event.status === "error") {
            addNotification({
              type: "error",
              title: "Dictation Error",
              message: event.message,
            });
          }
          break;

        case "transcript":
          setLiveTranscript(event.text);
          liveTranscriptRef.current = event.text;
          break;

        case "processed": {
          // Received structured extraction from server via DictationEngine
          const { visitId: vid, extracted: ext, needsReview } = event;
          const extractedData = ext as ExtractedVisit;
          hasStructuredExtractionRef.current = true;
          setTranscript(liveTranscriptRef.current);
          setExtracted(extractedData);
          setNeedsReview(needsReview || []);
          setVisitId(vid || "");

          const entryId = vid || `dict-${Date.now()}`;
          setDictationEntryId(entryId);

          addDictation({
            id: entryId,
            patientId: selectedPatient?.id,
            timestamp: new Date().toISOString(),
            rawTranscript: liveTranscriptRef.current,
            structuredNote: extractedData as any,
            status: "processing",
          });

          setPhase("review");

          addNotification({
            type: "info",
            title: "Transcription Complete",
            message: `Review extracted data${needsReview?.length ? ` — ${needsReview.length} fields need review` : ""}`,
          });
          break;
        }

        case "saved": {
          // Received full transcript after recording stopped
          // Skip fallback processing when the structured extraction path already ran.
          if (hasStructuredExtractionRef.current) {
             console.log("[Dictation] Skipping processTranscript because we already have extracted data");
             break;
          }

          const savedTranscript = (event.transcript || liveTranscriptRef.current).trim();
          if (savedTranscript) {
            void processTranscript(savedTranscript);
          } else {
            addNotification({
              type: "error",
              title: "No Speech Detected",
              message: "Please speak clearly and try again.",
            });
            setPhase("select");
          }
          break;
        }

        case "error":
          addNotification({
            type: "error",
            title: "Transcription Error",
            message: event.message,
          });
          setPhase("select");
          break;
      }
    },
    [addNotification, processTranscript, selectedPatient],
  );

  // ── Recording ─────────────────────────────────────────────────

  const startRecording = async () => {
    try {
      setLiveTranscript("");
      liveTranscriptRef.current = "";
      setTranscript("");
      hasStructuredExtractionRef.current = false;
      setPhase("recording");

      engineRef.current = new DictationEngine({
        wsEndpoint: settings.wsEndpoint,
        language: selectedLanguage,
        patientId: selectedPatient?.id,
        onEvent: handleDictationEvent,
      });

      await engineRef.current.connect();
      await engineRef.current.startRecording();

      // Start timer
      setRecordingTime(0);
      timerRef.current = setInterval(
        () => setRecordingTime((t) => t + 1),
        1000,
      );
    } catch (err: any) {
      addNotification({
        type: "error",
        title: "Recording Error",
        message: err.message || "Could not start recording",
      });
    }
  };

  const stopRecording = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    if (engineRef.current) {
      engineRef.current.stopRecording();
    }
  };

  // ── Confirm ─────────────────────────────────────────────────

  const handleConfirm = async () => {
    if (!visitId || !extracted) return;

    setIsProcessing(true);
    try {
      const result = await confirmVisit(visitId, extracted);

      if (!result.success || !result.ok) {
        throw new Error(result.error || "Confirmation failed");
      }

      setPhase("confirmed");

      addNotification({
        type: "success",
        title: "Visit Finalized",
        message: `Check-in templates generated for ${extracted.followup_days || 30} days`,
      });

      // Update the existing dictation entry instead of adding a duplicate
      if (dictationEntryId) {
        updateDictation(dictationEntryId, {
          structuredNote: extracted as any,
          status: "done",
        });
      }
    } catch (err) {
      addNotification({
        type: "error",
        title: "Confirmation Failed",
        message: String(err),
      });
    } finally {
      setIsProcessing(false);
    }
  };

  // ── Restart ─────────────────────────────────────────────────

  // @ts-ignore
  const normalizeExtractedVisit = (
    visit: Partial<ExtractedVisit> | null | undefined,
  ): ExtractedVisit => ({
    diagnosis_ayurveda: visit?.diagnosis_ayurveda,
    diagnosis_icd: visit?.diagnosis_icd,
    prakriti_observed: visit?.prakriti_observed,
    fasting_glucose: visit?.fasting_glucose ?? null,
    herbs: Array.isArray(visit?.herbs) ? visit.herbs : [],
    diet_restrictions: Array.isArray(visit?.diet_restrictions)
      ? visit.diet_restrictions
      : [],
    lifestyle_advice: Array.isArray(visit?.lifestyle_advice)
      ? visit.lifestyle_advice
      : [],
    followup_days: visit?.followup_days,
    doctor_notes: visit?.doctor_notes,
    needs_review: Array.isArray(visit?.needs_review)
      ? visit.needs_review
      : [],
  });

  const normalizeHistoricalIntake = (intake: PatientIntakeSummary) => {
    // Clean LLM placeholder text (lazy extraction)
    const cleanField = (text: any): string => {
      if (typeof text !== 'string') return '';
      let cleaned = text
        .replace(/Patient:\s*[^\n]*\n?/gi, '')
        .replace(/I've [^;]*;/gi, '')
        .replace(/I'm [^;]*;/gi, '')
        .replace(/Hello[^;]*;/gi, '')
        .replace(/Now[^;]*;/gi, '')
        .replace(/My [^;]*;/gi, '')
        .replace(/The [^;]*;/gi, '')
        .replace(/That was[^;]*;/gi, '')
        .trim();

      // Filter out LLM placeholder text
      const lower = cleaned.toLowerCase();
      if (
        lower.includes('not discussed') ||
        lower.includes('no prior') ||
        lower.includes('no relieving') ||
        lower.includes('not mentioned') ||
        lower.includes('no current') ||
        lower.includes('not captured') ||
        cleaned.length === 0
      ) {
        return '';
      }
      return cleaned.substring(0, 100);
    };

    const cleanArray = (arr: any): string[] => {
      if (!Array.isArray(arr)) return [];
      return arr
        .map((item: any) => typeof item === 'string' ? cleanField(item) : '')
        .filter((s: string) => s.length > 0)
        .slice(0, 5);
    };

    return {
      ...intake,
      name:
        (intake as any).name ||
        intake.patient_name ||
        (typeof intake.chief_complaint === 'string'
          ? intake.chief_complaint.substring(0, 50)
          : '') ||
        "Unknown",
      chiefComplaint: typeof intake.chief_complaint === 'string'
        ? intake.chief_complaint.substring(0, 80)
        : '',
      symptoms: Array.isArray(intake.symptoms)
        ? intake.symptoms
            .map((s: any) => (typeof s === 'string' ? s.substring(0, 30) : s))
            .slice(0, 5)
        : [],
      diet: cleanField(intake.diet),
      sleep: cleanField(intake.sleep),
      bowel: cleanField(intake.bowel),
      current_medications: Array.isArray(intake.current_medications)
        ? intake.current_medications
            .map((m: any) => (typeof m === 'string' ? m.substring(0, 30) : m))
            .slice(0, 3)
        : [],
      redFlags: cleanArray(intake.red_flags),
      dosha: typeof intake.dosha === 'string' ? intake.dosha.substring(0, 20) : '',
      severity: intake.severity,
      duration: typeof intake.duration === 'string' ? intake.duration.substring(0, 20) : '',
    };
  };

  const handleRestart = () => {
    setPhase("select");
    setTranscript("");
    setLiveTranscript("");
    liveTranscriptRef.current = "";
    setExtracted(null);
    setNeedsReview([]);
    setVisitId("");
    setDictationEntryId("");
    setRecordingTime(0);
    setSelectedPatient(null);
    setIntakeSummary(null);
  };

  // ── Render ─────────────────────────────────────────────────

  // Phase 1/2: Selection or Recording
  if (phase === "select" || phase === "recording" || phase === "processing") {
    return (
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-800">
              Doctor Dictation
            </h1>
            <div className="flex items-center gap-2 mt-0.5">
              <Badge variant="dosha">
                {selectedPatient?.isNew ? "New" : "Existing"}
              </Badge>
              <p className="text-sm text-slate-500">
                Patient: {selectedPatient?.name || "Unknown"}
              </p>
              {selectedPatient && (
                <button
                  onClick={() => setSelectedPatient(null)}
                  className="text-xs text-violet-600 hover:text-violet-800 font-medium underline ml-1"
                >
                  Change Patient
                </button>
              )}
            </div>
          </div>
          <Button size="sm" variant="ghost" onClick={handleRestart}>
            Start Over
          </Button>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
          {/* Recording Panel */}
          <div className="lg:col-span-3 space-y-4">
            <Card active>
              <div className="flex flex-col items-center py-8">
                {phase === "recording" ? (
                  <>
                    <div className="relative h-28 w-28 mb-4">
                      <div className="absolute inset-0 rounded-full bg-red-500 animate-ping opacity-30" />
                      <div className="relative flex h-full w-full items-center justify-center rounded-full bg-gradient-to-br from-red-500 to-rose-600 text-white shadow-2xl">
                        <Mic size={36} />
                      </div>
                    </div>
                    <p className="text-sm font-semibold text-red-600 mb-1">
                      Recording... {Math.floor(recordingTime / 60)}:
                      {(recordingTime % 60).toString().padStart(2, "0")}
                    </p>

                    <Button
                      variant="danger"
                      size="lg"
                      onClick={stopRecording}
                      className="mt-6"
                    >
                      <Square size={20} />
                      Stop Recording
                    </Button>
                  </>
                ) : phase === "processing" ? (
                  <>
                    <Loader2
                      size={48}
                      className="animate-spin text-violet-600 mb-4"
                    />
                    <p className="text-sm font-medium text-slate-600">
                      Transcribing & extracting...
                    </p>
                  </>
                ) : selectedPatient ? (
                  <>
                    <div className="h-28 w-28 rounded-full bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center text-white shadow-xl mb-4">
                      <Mic size={36} />
                    </div>
                    <p className="text-sm text-slate-600 mb-4">
                      Record your clinical dictation (30–90 seconds recommended)
                    </p>

                    {/* Language Selection Buttons */}
                    <div className="flex items-center gap-2 mb-6 p-1 bg-slate-100 rounded-lg">
                      {(["en", "hi", "hinglish"] as Language[]).map((lang) => (
                        <button
                          key={lang}
                          onClick={() => {
                            setSelectedLanguage(lang);
                            updateSettings({ language: lang });
                          }}
                          className={`px-4 py-1.5 text-xs font-semibold rounded-md transition-all ${
                            selectedLanguage === lang
                              ? "bg-white text-violet-600 shadow-sm"
                              : "text-slate-500 hover:text-slate-700"
                          }`}
                        >
                          {lang === "en"
                            ? "English"
                            : lang === "hi"
                              ? "Hindi"
                              : "Hinglish"}
                        </button>
                      ))}
                    </div>

                    <Button onClick={startRecording} size="lg">
                      Start Recording
                    </Button>
                  </>
                ) : (
                  <div className="text-center w-full">
                    <PatientSelector
                      title="Select Patient"
                      subtitle="Choose a patient for this dictation"
                      onSelect={handlePatientSelected}
                    />
                  </div>
                )}
              </div>
            </Card>

            {/* Live Transcript Panel */}
            {(phase === "recording" || phase === "processing") && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm flex items-center gap-2">
                    {phase === "recording" ? (
                      <>
                        <span className="relative flex h-3 w-3">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                          <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500" />
                        </span>
                        Live Transcript
                      </>
                    ) : (
                      <>
                        <Loader2
                          size={14}
                          className="animate-spin text-violet-600"
                        />
                        Processing...
                      </>
                    )}
                  </CardTitle>
                </CardHeader>
                <div className="p-4">
                  <p className="text-sm text-slate-600 whitespace-pre-wrap max-h-48 overflow-y-auto font-mono text-xs leading-relaxed">
                    {liveTranscript || transcript || "Waiting for speech..."}
                    {phase === "recording" && (
                      <span className="inline-block w-2 h-4 bg-red-500 ml-1 animate-pulse" />
                    )}
                  </p>
                </div>
              </Card>
            )}
          </div>

          {/* Right panel: intake brief + history */}
          <div className="lg:col-span-2 space-y-4">
            {/* ── Patient Background (Collapsible) ─────────────────── */}
            <Card>
              <CardHeader>
                <button
                  className="flex items-center gap-2 w-full text-left"
                  onClick={() => setShowPatientBackground(!showPatientBackground)}
                >
                  <Stethoscope size={14} className="text-violet-500" />
                  <span className="text-sm font-semibold">Patient Background</span>
                  {isLoadingIntake && (
                    <Loader2 size={12} className="animate-spin text-slate-400 ml-1" />
                  )}
                  <span className="ml-auto text-xs text-slate-400">
                    {showPatientBackground ? "▲" : "▼"}
                  </span>
                </button>
              </CardHeader>
              {showPatientBackground && selectedPatient && (
                <div className="px-4 pb-4 space-y-4 text-xs">
                  {/* Historical Intake Selector */}
                  {historicalIntakes.length > 1 && (
                    <div className="flex flex-col gap-1.5 p-2 bg-slate-50 rounded-lg border border-slate-100">
                      <div className="flex items-center gap-1.5 text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                        <Clock size={10} />
                        Historical Records
                      </div>
                      <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
                        {historicalIntakes.map((intake, idx) => (
                          <button
                            key={intake.id || idx}
                            onClick={() => setIntakeSummary(intake)}
                            className={`px-2 py-1 rounded border transition-all shrink-0 whitespace-nowrap ${
                              intakeSummary?.id === intake.id
                                ? "bg-violet-600 border-violet-600 text-white shadow-sm"
                                : "bg-white border-slate-200 text-slate-600 hover:border-violet-300"
                            }`}
                          >
                            {new Date(intake.created_at).toLocaleDateString(
                              [],
                              {
                                month: "short",
                                day: "numeric",
                                year: intake.created_at.startsWith(
                                  new Date().getFullYear().toString(),
                                )
                                  ? undefined
                                  : "2-digit",
                              },
                            )}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {isLoadingIntake ? (
                    <p className="text-slate-400 italic">Loading intake…</p>
                  ) : intakeSummary ? (
                    <>
                      {/* Red flags banner */}
                      {intakeSummary.red_flags?.length > 0 && (
                        <div className="flex items-start gap-2 rounded bg-red-50 border border-red-200 p-2">
                          <AlertTriangle
                            size={13}
                            className="text-red-500 shrink-0 mt-0.5"
                          />
                          <p className="text-red-700 text-[10px] font-semibold">
                            ⚠ {intakeSummary.red_flags.join(" · ")}
                          </p>
                        </div>
                      )}

                      {/* Chief complaint + severity row */}
                      <div className="rounded-lg bg-violet-50 border border-violet-100 p-2.5">
                        <p className="font-semibold text-violet-800 leading-snug">
                          {intakeSummary.chief_complaint || "(not recorded)"}
                        </p>
                        <div className="flex gap-3 mt-1 text-[10px] text-violet-600">
                          {intakeSummary.duration && (
                            <span>⏱ {intakeSummary.duration}</span>
                          )}
                          {intakeSummary.severity && (
                            <span>⚡ Severity {intakeSummary.severity}/10</span>
                          )}
                          {intakeSummary.dosha && (
                            <span>🌿 {intakeSummary.dosha}</span>
                          )}
                        </div>
                      </div>

                      {/* Symptoms - show as compact tags */}
                      {intakeSummary.symptoms?.length > 0 && (
                        <div>
                          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1">
                            Symptoms
                          </p>
                          <div className="flex flex-wrap gap-1">
                            {intakeSummary.symptoms.slice(0, 5).map((s: string, i: number) => (
                              <span
                                key={i}
                                className="px-1.5 py-0.5 bg-slate-100 text-slate-600 rounded text-[10px] max-w-[120px] truncate"
                                title={s}
                              >
                                {s}
                              </span>
                            ))}
                            {intakeSummary.symptoms.length > 5 && (
                              <span className="px-1.5 py-0.5 text-slate-400 text-[10px]">
                                +{intakeSummary.symptoms.length - 5} more
                              </span>
                            )}
                          </div>
                        </div>
                      )}

                      {/* Lifestyle snapshot - compact view */}
                      <div className="grid grid-cols-3 gap-1.5">
                        {intakeSummary.diet && (
                          <div className="rounded bg-amber-50 p-1.5">
                            <p className="text-[9px] font-bold text-amber-600 uppercase">
                              Diet
                            </p>
                            <p className="text-[10px] text-slate-600 leading-tight line-clamp-2 max-h-[2.5rem] overflow-hidden">
                              {intakeSummary.diet.slice(0, 80)}
                            </p>
                          </div>
                        )}
                        {intakeSummary.sleep && (
                          <div className="rounded bg-sky-50 p-1.5">
                            <p className="text-[9px] font-bold text-sky-600 uppercase">
                              Sleep
                            </p>
                            <p className="text-[10px] text-slate-600 leading-tight line-clamp-2 max-h-[2.5rem] overflow-hidden">
                              {intakeSummary.sleep.slice(0, 80)}
                            </p>
                          </div>
                        )}
                        {intakeSummary.bowel && (
                          <div className="rounded bg-emerald-50 p-1.5">
                            <p className="text-[9px] font-bold text-emerald-600 uppercase">
                              Bowel
                            </p>
                            <p className="text-[10px] text-slate-600 leading-tight line-clamp-2 max-h-[2.5rem] overflow-hidden">
                              {intakeSummary.bowel.slice(0, 80)}
                            </p>
                          </div>
                        )}
                      </div>

                      {/* Current meds - compact list */}
                      {intakeSummary.current_medications?.length > 0 && (
                        <div>
                          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1">
                            Current Medications
                          </p>
                          <ul className="space-y-0.5">
                            {intakeSummary.current_medications.slice(0, 3).map((m: string, i: number) => (
                              <li
                                key={i}
                                className="text-[10px] text-slate-600 flex gap-1"
                              >
                                <span className="text-slate-300">•</span>
                                <span className="truncate max-w-[150px]" title={m}>{m}</span>
                              </li>
                            ))}
                            {intakeSummary.current_medications.length > 3 && (
                              <li className="text-[10px] text-slate-400">
                                +{intakeSummary.current_medications.length - 3} more
                              </li>
                            )}
                          </ul>
                        </div>
                      )}

                      <p className="text-[9px] text-slate-300 pt-1">
                        Intake recorded{" "}
                        {new Date(
                          intakeSummary.created_at,
                        ).toLocaleDateString()}
                      </p>
                    </>
                  ) : (
                    <p className="text-slate-400 italic">
                      No intake on file for this patient.
                    </p>
                  )}
                </div>
              )}
            </Card>

            {/* ── Recent Dictations (Collapsible) ─────────────────────── */}
            <Card>
              <CardHeader>
                <button
                  className="flex items-center gap-2 w-full text-left"
                  onClick={() => setShowRecentDictations(!showRecentDictations)}
                >
                  <FileText size={14} className="text-violet-500" />
                  <span className="text-sm font-semibold">Recent Dictations</span>
                  <Badge variant="info">{dictationList.length}</Badge>
                  <span className="ml-auto text-xs text-slate-400">
                    {showRecentDictations ? "▲" : "▼"}
                  </span>
                </button>
              </CardHeader>
              {showRecentDictations && (
                dictationList.length === 0 ? (
                  <div className="py-6 text-center">
                    <FileText size={28} className="text-slate-200 mx-auto mb-2" />
                    <p className="text-xs text-slate-400">No dictations yet</p>
                  </div>
                ) : (
                  <div className="space-y-2 max-h-[500px] overflow-y-auto p-2">
                    {dictationList.slice(0, 15).map((entry) => {
                      const note = entry.structuredNote as any;
                      return (
                        <div
                          key={entry.id}
                          className="flex items-center gap-3 rounded-xl hover:bg-slate-50 p-2.5 border border-slate-100 transition-colors"
                        >
                          <div
                            className={`h-9 w-9 rounded-lg flex items-center justify-center text-xs font-bold shrink-0 ${
                              entry.status === "done"
                                ? "bg-emerald-50 text-emerald-600"
                                : entry.status === "error"
                                  ? "bg-red-50 text-red-600"
                                  : entry.status === "processing"
                                    ? "bg-amber-50 text-amber-600"
                                    : "bg-slate-50 text-slate-600"
                            }`}
                          >
                            <FileText size={16} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-semibold text-slate-700 truncate">
                              {(note?.diagnosis_ayurveda && String(note.diagnosis_ayurveda) !== "0") ? note.diagnosis_ayurveda : 
                               (note?.diagnosis && String(note.diagnosis) !== "0") ? note.diagnosis : "Draft Visit"}
                            </p>
                            <p className="text-[10px] text-slate-400">
                              {new Date(entry.timestamp).toLocaleTimeString([], {
                                hour: "2-digit",
                                minute: "2-digit",
                              })}
                              {note?.herbs?.length
                                ? ` · ${note.herbs.length} meds`
                                : ""}
                            </p>
                          </div>
                          <Badge
                            variant={
                              entry.status === "done"
                                ? "success"
                                : entry.status === "error"
                                  ? "error"
                                  : entry.status === "processing"
                                    ? "warning"
                                    : "info"
                            }
                            size="sm"
                          >
                            {entry.status}
                          </Badge>
                        </div>
                      );
                    })}
                  </div>
                )
              )}
            </Card>
          </div>
        </div>
      </div>
    );
  }

  // Phase 3: Review extracted data
  if (phase === "review" && extracted) {
    return (
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-800">Review Visit</h1>
            <div className="flex items-center gap-2 mt-0.5">
              <Badge variant={needsReview.length ? "warning" : "success"}>
                {needsReview.length
                  ? `${needsReview.length} field${needsReview.length > 1 ? "s" : ""} need${needsReview.length > 1 ? "" : "s"} review`
                  : "Ready to confirm"}
              </Badge>
            </div>
          </div>
          <Button size="sm" variant="ghost" onClick={handleRestart}>
            Start Over
          </Button>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
          {/* Left: Editable Form */}
          <div className="lg:col-span-3 space-y-4">
            {/* Diagnosis */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Stethoscope size={16} className="text-rose-600" />
                  Diagnosis
                  {needsReview.includes("diagnosis_ayurveda") && (
                    <AlertTriangle size={14} className="text-amber-500" />
                  )}
                </CardTitle>
              </CardHeader>
              <div className="p-4 space-y-3">
                <div>
                  <label className="text-xs font-semibold text-slate-500">
                    Ayurvedic Diagnosis *
                  </label>
                  <input
                    type="text"
                    value={extracted.diagnosis_ayurveda || ""}
                    onChange={(e) =>
                      setExtracted({
                        ...extracted,
                        diagnosis_ayurveda: e.target.value,
                      })
                    }
                    className={`w-full mt-1 px-3 py-2 border rounded-lg text-sm ${needsReview.includes("diagnosis_ayurveda") ? "border-amber-300 bg-amber-50" : ""}`}
                    placeholder="e.g., Vatarakta"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-semibold text-slate-500">
                      ICD-11 Code
                    </label>
                    <input
                      type="text"
                      value={extracted.diagnosis_icd || ""}
                      onChange={(e) =>
                        setExtracted({
                          ...extracted,
                          diagnosis_icd: e.target.value,
                        })
                      }
                      className="w-full mt-1 px-3 py-2 border rounded text-sm"
                      placeholder="e.g., 5A11.0"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-slate-500">
                      Prakriti Observed
                    </label>
                    <input
                      type="text"
                      value={extracted.prakriti_observed || ""}
                      onChange={(e) =>
                        setExtracted({
                          ...extracted,
                          prakriti_observed: e.target.value,
                        })
                      }
                      className="w-full mt-1 px-3 py-2 border rounded text-sm"
                      placeholder="e.g., Vata-Kapha"
                    />
                  </div>
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-500">
                    Fasting Glucose (optional)
                  </label>
                  <input
                    type="number"
                    value={extracted.fasting_glucose ?? ""}
                    onChange={(e) =>
                      setExtracted({
                        ...extracted,
                        fasting_glucose: e.target.value
                          ? Number(e.target.value)
                          : undefined,
                      })
                    }
                    className="w-full mt-1 px-3 py-2 border rounded text-sm"
                    placeholder="mg/dL"
                  />
                </div>
              </div>
            </Card>

            {/* Prescribed Herbs */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Pill size={16} className="text-emerald-600" />
                  Prescribed Herbs / Medicines
                  {needsReview.some((n) => n.startsWith("herbs")) && (
                    <AlertTriangle size={14} className="text-amber-500" />
                  )}
                </CardTitle>
              </CardHeader>
              <div className="p-4 space-y-3">
                {extracted.herbs.map((herb, idx) => (
                  <div key={idx} className="rounded-xl border p-3 relative">
                    <button
                      onClick={() => {
                        const newHerbs = extracted.herbs.filter(
                          (_, i) => i !== idx,
                        );
                        setExtracted({ ...extracted, herbs: newHerbs });
                      }}
                      className="absolute top-2 right-2 text-slate-400 hover:text-red-500 text-sm"
                    >
                      ✕
                    </button>
                    <div className="mb-2">
                      <label className="text-xs font-semibold text-slate-500">
                        Medicine Name *
                      </label>
                      <input
                        type="text"
                        value={herb.name}
                        onChange={(e) => {
                          const newHerbs = [...extracted.herbs];
                          newHerbs[idx].name = e.target.value;
                          setExtracted({ ...extracted, herbs: newHerbs });
                        }}
                        className={`w-full mt-1 px-3 py-2 border rounded text-sm font-medium ${needsReview.includes(`herbs[${idx}].name`) ? "border-amber-300 bg-amber-50" : ""}`}
                        placeholder="e.g., Chandraprabha vati"
                      />
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <div>
                        <label className="text-xs text-slate-500">Dose *</label>
                        <input
                          type="text"
                          value={herb.dose || ""}
                          onChange={(e) => {
                            const newHerbs = [...extracted.herbs];
                            newHerbs[idx].dose = e.target.value;
                            setExtracted({ ...extracted, herbs: newHerbs });
                          }}
                          className={`w-full px-2 py-1.5 border rounded text-sm ${needsReview.includes(`herbs[${idx}].dose`) ? "border-amber-300 bg-amber-50" : ""}`}
                          placeholder="e.g., 2 tabs"
                        />
                      </div>
                      <div>
                        <label className="text-xs text-slate-500">
                          Timing *
                        </label>
                        <input
                          type="text"
                          value={herb.timing || ""}
                          onChange={(e) => {
                            const newHerbs = [...extracted.herbs];
                            newHerbs[idx].timing = e.target.value;
                            setExtracted({ ...extracted, herbs: newHerbs });
                          }}
                          className={`w-full px-2 py-1.5 border rounded text-sm ${needsReview.includes(`herbs[${idx}].timing`) ? "border-amber-300 bg-amber-50" : ""}`}
                          placeholder="e.g., morning"
                        />
                      </div>
                      <div>
                        <label className="text-xs text-slate-500">
                          With (vehicle)
                        </label>
                        <input
                          type="text"
                          value={herb.vehicle || ""}
                          onChange={(e) => {
                            const newHerbs = [...extracted.herbs];
                            newHerbs[idx].vehicle = e.target.value || undefined;
                            setExtracted({ ...extracted, herbs: newHerbs });
                          }}
                          className="w-full px-2 py-1.5 border rounded text-sm"
                          placeholder="e.g., warm water"
                        />
                      </div>
                    </div>
                  </div>
                ))}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    setExtracted({
                      ...extracted,
                      herbs: [
                        ...extracted.herbs,
                        { name: "", dose: "", timing: "", vehicle: "" },
                      ],
                    })
                  }
                >
                  + Add Medicine
                </Button>
              </div>
            </Card>

            {/* Diet & Lifestyle */}
            <div className="grid grid-cols-2 gap-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Diet Restrictions</CardTitle>
                </CardHeader>
                <div className="p-3 space-y-2">
                  {extracted.diet_restrictions?.map((item, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <input
                        type="text"
                        value={item}
                        onChange={(e) => {
                          const newArr = [
                            ...(extracted.diet_restrictions || []),
                          ];
                          newArr[i] = e.target.value;
                          setExtracted({
                            ...extracted,
                            diet_restrictions: newArr,
                          });
                        }}
                        className="flex-1 px-2 py-1.5 border rounded text-sm"
                      />
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          const newArr = (
                            extracted.diet_restrictions || []
                          ).filter((_, idx) => idx !== i);
                          setExtracted({
                            ...extracted,
                            diet_restrictions: newArr,
                          });
                        }}
                      >
                        ✕
                      </Button>
                    </div>
                  ))}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      setExtracted({
                        ...extracted,
                        diet_restrictions: [
                          ...(extracted.diet_restrictions || []),
                          "",
                        ],
                      })
                    }
                  >
                    + Add
                  </Button>
                </div>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Lifestyle Advice</CardTitle>
                </CardHeader>
                <div className="p-3 space-y-2">
                  {extracted.lifestyle_advice?.map((item, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <input
                        type="text"
                        value={item}
                        onChange={(e) => {
                          const newArr = [
                            ...(extracted.lifestyle_advice || []),
                          ];
                          newArr[i] = e.target.value;
                          setExtracted({
                            ...extracted,
                            lifestyle_advice: newArr,
                          });
                        }}
                        className="flex-1 px-2 py-1.5 border rounded text-sm"
                      />
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          const newArr = (
                            extracted.lifestyle_advice || []
                          ).filter((_, idx) => idx !== i);
                          setExtracted({
                            ...extracted,
                            lifestyle_advice: newArr,
                          });
                        }}
                      >
                        ✕
                      </Button>
                    </div>
                  ))}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      setExtracted({
                        ...extracted,
                        lifestyle_advice: [
                          ...(extracted.lifestyle_advice || []),
                          "",
                        ],
                      })
                    }
                  >
                    + Add
                  </Button>
                </div>
              </Card>
            </div>

            {/* Notes */}
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Doctor Notes</CardTitle>
              </CardHeader>
              <div className="p-3">
                <textarea
                  value={extracted.doctor_notes || ""}
                  onChange={(e) =>
                    setExtracted({ ...extracted, doctor_notes: e.target.value })
                  }
                  className="w-full px-3 py-2 border rounded text-sm min-h-[80px]"
                  placeholder="Any additional observations..."
                />
              </div>
            </Card>
          </div>

          {/* Right: Intake Baseline + Summary + Confirm */}
          <div className="lg:col-span-2 space-y-4">
            {/* Intake baseline (compact) */}
            {intakeSummary && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Stethoscope size={14} className="text-violet-500" />
                    Intake Baseline
                  </CardTitle>
                </CardHeader>
                <div className="px-4 pb-4 space-y-2 text-xs">
                  {intakeSummary.red_flags?.length > 0 && (
                    <div className="flex items-start gap-2 rounded bg-red-50 border border-red-200 p-1.5">
                      <AlertTriangle
                        size={12}
                        className="text-red-500 shrink-0 mt-0.5"
                      />
                      <p className="text-red-700 text-[10px] font-semibold">
                        ⚠ {intakeSummary.red_flags.join(" · ")}
                      </p>
                    </div>
                  )}

                  <div className="rounded-lg bg-violet-50 border border-violet-100 p-2.5">
                    <p className="font-semibold text-violet-800 leading-snug">
                      {intakeSummary.chief_complaint || "not captured"}
                    </p>
                    <div className="flex gap-3 mt-1 text-[10px] text-violet-600">
                      {intakeSummary.duration && (
                        <span>⏱ {intakeSummary.duration}</span>
                      )}
                      {intakeSummary.severity && (
                        <span>⚡ Severity {intakeSummary.severity}/10</span>
                      )}
                      {intakeSummary.dosha && (
                        <span>🌿 {intakeSummary.dosha}</span>
                      )}
                    </div>
                  </div>

                  {intakeSummary.symptoms?.slice(0, 5).map((s: string, i: number) => (
                    <span
                      key={i}
                      className="inline-block px-1.5 py-0.5 bg-slate-100 text-slate-600 rounded text-[10px] mr-1 mb-1"
                    >
                      {s}
                    </span>
                  ))}
                </div>
              </Card>
            )}

            {/* Visit Summary Card */}
            <Card>
              <CardHeader>
                <CardTitle className="text-sm flex items-center gap-2">
                  <FileText size={14} className="text-violet-500" />
                  Visit Summary
                </CardTitle>
              </CardHeader>
              <div className="px-4 pb-4 space-y-3 text-xs">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                    Diagnosis
                  </p>
                  <p className="font-semibold text-slate-700">
                    {extracted.diagnosis_ayurveda || "—"}
                    {extracted.diagnosis_icd && (
                      <span className="text-slate-400 font-normal"> ({extracted.diagnosis_icd})</span>
                    )}
                  </p>
                </div>

                {extracted.herbs.length > 0 && (
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                      Prescribed Herbs
                    </p>
                    {extracted.herbs.map((h: any, i: number) => (
                      <div key={i} className="mb-1 p-1.5 bg-emerald-50 rounded border border-emerald-100">
                        <p className="font-medium text-emerald-800">{h.name}</p>
                        <p className="text-[10px] text-emerald-600">
                          {h.dose} · {h.timing}
                          {h.vehicle && ` · with ${h.vehicle}`}
                        </p>
                      </div>
                    ))}
                  </div>
                )}

                {extracted.followup_days && (
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                      Follow-up
                    </p>
                    <p className="text-slate-600">
                      {extracted.followup_days} days
                    </p>
                  </div>
                )}

                {needsReview.length > 0 && (
                  <div className="p-2 bg-amber-50 border border-amber-200 rounded">
                    <p className="text-[10px] font-bold text-amber-700 mb-1">
                      Needs Review
                    </p>
                    <ul className="text-[10px] text-amber-600 space-y-0.5">
                      {needsReview.map((f: string, i: number) => (
                        <li key={i}>• {f}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </Card>

            {/* Confirm Button */}
            <Card>
              <div className="p-4 space-y-3">
                <div>
                  <label className="text-xs font-semibold text-slate-500">
                    Follow-up Days
                  </label>
                  <input
                    type="number"
                    value={extracted.followup_days || 30}
                    onChange={(e) =>
                      setExtracted({
                        ...extracted,
                        followup_days: e.target.value
                          ? parseInt(e.target.value)
                          : undefined,
                      })
                    }
                    className="w-full mt-1 px-3 py-2 border rounded-lg text-sm"
                    placeholder="30"
                  />
                </div>

                <Button
                  onClick={handleConfirm}
                  disabled={needsReview.length > 0 || isProcessing}
                  loading={isProcessing}
                  className="w-full"
                  size="lg"
                >
                  Confirm & Generate Check-in Templates
                </Button>

                {needsReview.length > 0 && (
                  <p className="text-[10px] text-amber-600 text-center">
                    Please complete all required fields before confirming.
                  </p>
                )}
              </div>
            </Card>

            {/* Transcript Preview */}
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Transcript Preview</CardTitle>
              </CardHeader>
              <div className="p-4">
                <p className="text-xs text-slate-600 whitespace-pre-wrap max-h-32 overflow-y-auto font-mono leading-relaxed">
                  {transcript}
                </p>
              </div>
            </Card>
          </div>
        </div>
      </div>
    );
  }

  // Phase 4: Confirmed
  if (phase === "confirmed" && extracted) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-800">Visit Finalized</h1>
            <p className="text-sm text-emerald-600 mt-0.5">
              Check-in templates generated for {extracted.followup_days || 30} days
            </p>
          </div>
          <Button size="sm" variant="ghost" onClick={handleRestart}>
            New Dictation
          </Button>
        </div>

        <Card>
          <div className="p-8 text-center space-y-4">
            <div className="mx-auto w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center">
              <Check size={32} className="text-emerald-600" />
            </div>
            <h2 className="text-xl font-bold text-slate-800">
              Visit Successfully Finalized!
            </h2>
            <p className="text-sm text-slate-500 max-w-md mx-auto">
              The visit record has been saved and check-in templates have been
              generated for the next {extracted.followup_days || 30} days.
              Patients can now use the Visit Check-in screen to track their recovery.
            </p>

            {/* Show generated check-in questions preview */}
            {extracted.herbs?.length > 0 && (
              <div className="max-w-lg mx-auto text-left">
                <p className="text-sm font-semibold text-slate-700 mb-2">
                  Auto-Generated Check-in Questions:
                </p>
                <div className="space-y-2">
                  {extracted.herbs.slice(0, 3).map((herb: any, idx: number) => (
                    <div key={idx} className="p-2 bg-slate-50 rounded-lg text-sm text-slate-600">
                      <p className="font-medium text-slate-700">{herb.name}</p>
                      <p className="text-xs text-slate-500 mt-0.5">
                        Q: Kya aapne aaj {herb.name} li{
                        herb.timing ? ` — ${herb.timing}?` : "?"}
                      </p>
                    </div>
                  ))}
                  {extracted.diet_restrictions?.slice(0, 3 - (extracted.herbs?.length || 0)).map((restriction: string, idx: number) => (
                    <div key={`diet-${idx}`} className="p-2 bg-slate-50 rounded-lg text-sm text-slate-600">
                      <p className="text-xs text-slate-500 mt-0.5">
                        Q: Kya aaj aapne {restriction} se parhej kiya?
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="pt-4">
              <Button onClick={handleRestart}>
                Start New Dictation
              </Button>
            </div>
          </div>
        </Card>
      </div>
    );
  }

  return null;
}
