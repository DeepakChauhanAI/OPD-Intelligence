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
} from "lucide-react";
import { Card, CardHeader, CardTitle } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Badge } from "../components/ui/Badge";
import { PatientSelector } from "../components/PatientSelector";
import { useAppStore } from "../store/useAppStore";
import { confirmVisit, getPatientIntakeSummary } from "../lib/llmClient";
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
  const [selectedLanguage, setSelectedLanguage] = useState<string>(settings.language || "hinglish");
  const [intakeSummary, setIntakeSummary] = useState<PatientIntakeSummary | null>(null);
  const [isLoadingIntake, setIsLoadingIntake] = useState(false);

  const engineRef = useRef<DictationEngine | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const liveTranscriptRef = useRef("");

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      engineRef.current?.disconnect();
    };
  }, []);

  // Auto-clear needsReview when required fields are filled
  useEffect(() => {
    if (!extracted) return;
    
    setNeedsReview((prev) => prev.filter((field) => {
      if (field === 'diagnosis_ayurveda') return !extracted.diagnosis_ayurveda?.trim();
      if (field === 'followup_days') return !extracted.followup_days;
      
      if (field === 'herbs') {
        if (extracted.herbs.length === 0) return true;
        const hasMissing = extracted.herbs.some((h) => !h.name?.trim() || !h.dose?.trim() || !h.timing?.trim());
        return hasMissing;
      }
      
      const match = field.match(/^herbs\[(\d+)\]\.(.+)$/);
      if (match) {
        const idx = parseInt(match[1]);
        const key = match[2];
        const herb = extracted.herbs[idx];
        if (!herb) return false;
        if (key === 'name') return !herb.name?.trim();
        if (key === 'dose') return !herb.dose?.trim();
        if (key === 'timing') return !herb.timing?.trim();
      }
      
      return true; // Keep other unknown fields requiring review
    }));
  }, [extracted]);

  // ── Patient Selection ─────────────────────────────────────────────────────────

  const handlePatientSelected = async (patient: SelectedPatient) => {
    setSelectedPatient(patient);
    setIntakeSummary(null);
    setPhase("select");

    // Fetch patient's most recent intake brief for doctor's context
    if (patient.id && !patient.isNew) {
      setIsLoadingIntake(true);
      try {
        const res = await getPatientIntakeSummary(patient.id);
        if (res.success && res.intake) {
          setIntakeSummary(res.intake);
        }
      } catch {
        // non-fatal — intake summary is optional context
      } finally {
        setIsLoadingIntake(false);
      }
    }
  };

  // ── Transcribe & Extract ──────────────────────────────────────────────────────

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
        const result = await fetch("/api/dictation/process", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            transcript: fullTranscript,
            patient_id: selectedPatient?.id || null,
          }),
        });

        const json = await result.json();

        if (!result.ok || !json.success) {
          throw new Error(json.error || "Extraction failed");
        }

        setTranscript(fullTranscript);
        setExtracted(json.extracted || null);
        setNeedsReview(json.needs_review || []);
        setVisitId(json.visit_id || "");

        const entryId = json.visit_id || `dict-${Date.now()}`;
        setDictationEntryId(entryId);

        addDictation({
          id: entryId,
          patientId: selectedPatient?.id,
          timestamp: new Date().toISOString(),
          rawTranscript: fullTranscript,
          structuredNote: json.extracted as any,
          status: "processing",
        });

        setPhase("review");

        addNotification({
          type: "info",
          title: "Transcription Complete",
          message: `Review extracted data${json.needs_review?.length ? ` — ${json.needs_review.length} fields need review` : ""}`,
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

  // ── Dictation Engine Event Handler ───────────────────────────────────────────

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

        case "saved":
          // Use ref to avoid stale closure — the engine holds the original
          // handler reference, so closure-captured liveTranscript is always "".
          const savedTranscript = liveTranscriptRef.current.trim();
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
    [addNotification, processTranscript],
  );

  // ── Recording ─────────────────────────────────────────────────────────────────

  const startRecording = async () => {
    try {
      setLiveTranscript("");
      liveTranscriptRef.current = "";
      setTranscript("");
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

  // ── Confirm ───────────────────────────────────────────────────────────────────

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

  // ── Restart ───────────────────────────────────────────────────────────────────

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

  // ── Render ────────────────────────────────────────────────────────────────────

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
            </div>
          </div>
          <Button size="sm" variant="ghost" onClick={handleRestart}>
            Start Over
          </Button>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
          {/* Recording Panel */}
          <div className="lg:col-span-3 space-y-4">
            <Card glow>
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

                    {/* Live Transcript Display */}
                    {liveTranscript && (
                      <div className="w-full max-w-2xl mt-4 px-4">
                        <div className="rounded-lg bg-slate-50 border border-slate-200 p-3">
                          <p className="text-xs text-slate-500 mb-1">
                            Live Transcript
                          </p>
                          <p className="text-sm text-slate-700 leading-relaxed min-h-[60px] max-h-32 overflow-y-auto">
                            {liveTranscript}
                            <span className="inline-block w-2 h-4 bg-red-400 ml-1 animate-pulse" />
                          </p>
                        </div>
                      </div>
                    )}

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
                          {lang === "en" ? "English" : lang === "hi" ? "Hindi" : "Hinglish"}
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

            {/* Close col-span-3 before starting col-span-2 history */}
          </div>

          {/* Right panel: intake brief + history */}
          <div className="lg:col-span-2 space-y-4">

            {/* ── Patient Intake Brief ─────────────────────────────────── */}
            {selectedPatient && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Stethoscope size={14} className="text-violet-500" />
                    Patient Background
                    {isLoadingIntake && (
                      <Loader2 size={12} className="animate-spin text-slate-400 ml-1" />
                    )}
                  </CardTitle>
                </CardHeader>
                <div className="px-4 pb-4 space-y-2 text-xs">
                  {isLoadingIntake ? (
                    <p className="text-slate-400 italic">Loading intake…</p>
                  ) : intakeSummary ? (
                    <>
                      {/* Red flags banner */}
                      {intakeSummary.red_flags?.length > 0 && (
                        <div className="flex items-start gap-2 rounded-lg bg-red-50 border border-red-200 p-2">
                          <AlertTriangle size={13} className="text-red-500 shrink-0 mt-0.5" />
                          <p className="text-red-700 font-semibold">
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

                      {/* Symptoms */}
                      {intakeSummary.symptoms?.length > 0 && (
                        <div>
                          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1">Symptoms</p>
                          <div className="flex flex-wrap gap-1">
                            {intakeSummary.symptoms.map((s, i) => (
                              <span key={i} className="px-1.5 py-0.5 bg-slate-100 text-slate-600 rounded text-[10px]">
                                {s}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Lifestyle snapshot */}
                      <div className="grid grid-cols-3 gap-1.5">
                        {intakeSummary.diet && (
                          <div className="rounded bg-amber-50 p-1.5">
                            <p className="text-[9px] font-bold text-amber-600 uppercase">Diet</p>
                            <p className="text-[10px] text-slate-600 leading-tight line-clamp-2">{intakeSummary.diet}</p>
                          </div>
                        )}
                        {intakeSummary.sleep && (
                          <div className="rounded bg-sky-50 p-1.5">
                            <p className="text-[9px] font-bold text-sky-600 uppercase">Sleep</p>
                            <p className="text-[10px] text-slate-600 leading-tight line-clamp-2">{intakeSummary.sleep}</p>
                          </div>
                        )}
                        {intakeSummary.bowel && (
                          <div className="rounded bg-emerald-50 p-1.5">
                            <p className="text-[9px] font-bold text-emerald-600 uppercase">Bowel</p>
                            <p className="text-[10px] text-slate-600 leading-tight line-clamp-2">{intakeSummary.bowel}</p>
                          </div>
                        )}
                      </div>

                      {/* Current meds */}
                      {intakeSummary.current_medications?.length > 0 && (
                        <div>
                          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1">Current Medications</p>
                          <ul className="space-y-0.5">
                            {intakeSummary.current_medications.map((m, i) => (
                              <li key={i} className="text-[10px] text-slate-600 flex gap-1"><span className="text-slate-300">•</span>{m}</li>
                            ))}
                          </ul>
                        </div>
                      )}

                      <p className="text-[9px] text-slate-300 pt-1">
                        Intake recorded {new Date(intakeSummary.created_at).toLocaleDateString()}
                      </p>
                    </>
                  ) : (
                    <p className="text-slate-400 italic">No intake on file for this patient.</p>
                  )}
                </div>
              </Card>
            )}

            {/* ── Recent Dictations ────────────────────────────────────── */}
            <Card>
              <CardHeader>
                <CardTitle>Recent Dictations</CardTitle>
                <Badge variant="info">{dictationList.length}</Badge>
              </CardHeader>
              {dictationList.length === 0 ? (
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
                            {note?.diagnosis_ayurveda ||
                              note?.diagnosis ||
                              "Draft"}
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
                    placeholder="e.g., Vataja Prameha"
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
                      <AlertTriangle size={12} className="text-red-500 shrink-0 mt-0.5" />
                      <p className="text-red-700 text-[10px] font-semibold">
                        {intakeSummary.red_flags.join(" · ")}
                      </p>
                    </div>
                  )}
                  <div className="rounded bg-violet-50 border border-violet-100 p-2">
                    <p className="font-semibold text-violet-800 text-[11px]">
                      {intakeSummary.chief_complaint || "(no complaint recorded)"}
                    </p>
                    <div className="flex flex-wrap gap-2 mt-0.5 text-[10px] text-violet-600">
                      {intakeSummary.duration && <span>⏱ {intakeSummary.duration}</span>}
                      {intakeSummary.severity && <span>⚡ Sev. {intakeSummary.severity}/10</span>}
                      {intakeSummary.dosha && <span>🌿 {intakeSummary.dosha}</span>}
                    </div>
                  </div>
                  {intakeSummary.symptoms?.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {intakeSummary.symptoms.slice(0, 5).map((s, i) => (
                        <span key={i} className="px-1.5 py-0.5 bg-slate-100 text-slate-600 rounded text-[10px]">{s}</span>
                      ))}
                    </div>
                  )}
                </div>
              </Card>
            )}

            <Card>
              <CardHeader>
                <CardTitle>Visit Summary</CardTitle>
              </CardHeader>
              <div className="p-4 space-y-3">
                <div>
                  <label className="text-xs font-semibold text-slate-500">
                    Follow-up (days)
                  </label>
                  <input
                    type="number"
                    value={extracted.followup_days || 30}
                    onChange={(e) =>
                      setExtracted({
                        ...extracted,
                        followup_days: parseInt(e.target.value) || 30,
                      })
                    }
                    className="w-full px-3 py-2 border rounded text-sm"
                    min={1}
                    max={365}
                  />
                  <p className="text-[10px] text-slate-400 mt-1">
                    Check-in templates will cover this period
                  </p>
                </div>

                {needsReview.length > 0 && (
                  <div className="rounded-lg bg-amber-50 p-3 border border-amber-200">
                    <p className="text-xs font-semibold text-amber-700 mb-2 flex items-center gap-1">
                      <AlertTriangle size={12} /> Needs Review
                    </p>
                    <ul className="space-y-1">
                      {needsReview.map((field) => (
                        <li
                          key={field}
                          className="text-xs text-amber-800 flex items-center gap-2"
                        >
                          <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                          {field}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <Button
                  onClick={handleConfirm}
                  disabled={isProcessing || needsReview.length > 0}
                  className="w-full"
                  size="lg"
                  variant="success"
                >
                  {isProcessing ? (
                    <>
                      <Loader2 size={16} className="animate-spin mr-2" />
                      Finalizing...
                    </>
                  ) : (
                    <>
                      <Check size={16} className="mr-2" />
                      Confirm & Generate Check-in Templates
                    </>
                  )}
                </Button>
                {needsReview.length > 0 && (
                  <p className="text-xs text-slate-500 text-center">
                    Please review highlighted fields before confirming
                  </p>
                )}
              </div>
            </Card>

            {/* Transcript Preview */}
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Transcript</CardTitle>
              </CardHeader>
              <div className="p-3">
                <p className="text-xs text-slate-600 whitespace-pre-wrap max-h-40 overflow-y-auto font-mono">
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
  if (phase === "confirmed") {
    return (
      <div className="space-y-6">
        <div className="flex flex-col items-center justify-center py-16">
          <div className="h-20 w-20 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-600 mb-4">
            <Check size={40} />
          </div>
          <h1 className="text-2xl font-bold text-slate-800 mb-2">
            Visit Finalized
          </h1>
          <p className="text-sm text-slate-600 mb-6">
            Daily check-in question templates generated for{" "}
            {extracted?.followup_days || 30} days
          </p>
          <Button onClick={handleRestart} size="lg">
            New Dictation
          </Button>
        </div>
      </div>
    );
  }

  return null;
}
