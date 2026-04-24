/**
 * Patient Intake Screen
 * Step 1: Select patient (new or existing)
 * Step 2: Voice/text intake with VoiceOrb
 * Step 3: AI extraction via backend
 */

import { useState, useRef, useEffect } from "react";
import { ClipboardList, RotateCcw, AlertTriangle, Mic } from "lucide-react";
import { Card, CardHeader, CardTitle } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Badge } from "../components/ui/Badge";
import { AudioVisualizer } from "../components/AudioVisualizer";
import { VoiceOrb } from "../components/VoiceOrb";
import { PatientSelector } from "../components/PatientSelector";
import { EmergencyAlert } from "../components/EmergencyAlert";
import { useAppStore } from "../store/useAppStore";
import { VoiceEngine } from "../lib/voiceEngine";
import { extractIntake, createPatient } from "../lib/llmClient";
import { detectRedFlags } from "../schemas/medical";
import type {
  PatientIntake,
  ClinicalExtraction,
  SelectedPatient,
} from "../types";

export function PatientIntakeScreen() {
  const {
    settings,
    sessionStatus,
    setSessionStatus,
    partialTranscript,
    setPartialTranscript,
    intakeList,
    addIntake,
    addNotification,
    emergencyAlert,
    setEmergencyAlert,
    selectedPatient,
    setSelectedPatient,
  } = useAppStore();

  const [transcript, setTranscript] = useState("");
  const [extraction, setExtraction] = useState<ClinicalExtraction | null>(null);
  const [isExtracting, setIsExtracting] = useState(false);
  const [phase, setPhase] = useState<"select" | "record" | "review">("select");
  const [hasSubmitted, setHasSubmitted] = useState(false);
  const [conversationStarted, setConversationStarted] = useState(false);
  const [awaitingConfirmation, setAwaitingConfirmation] = useState(false);
  const [summaryDetectedAuto, setSummaryDetectedAuto] = useState(false);
  const [summaryPreview, setSummaryPreview] = useState("");
  const confirmationResponseRef = useRef<string>("");
  const awaitingConfirmationRef = useRef(false);
  const performExtractRef = useRef<
    () => Promise<{
      success: boolean;
      data?: ClinicalExtraction;
    }>
  >(async () => ({ success: false }));

  const engineRef = useRef<VoiceEngine | null>(null);
  const transcriptRef = useRef("");
  useEffect(() => {
    awaitingConfirmationRef.current = awaitingConfirmation;
  }, [awaitingConfirmation]);

  const visualizerStatus =
    conversationStarted && sessionStatus === "idle"
      ? "listening"
      : sessionStatus === "speaking"
        ? "model_speaking"
        : sessionStatus === "recording"
          ? "listening"
          : sessionStatus === "connected"
            ? "connected"
            : sessionStatus === "connecting"
              ? "connecting"
              : sessionStatus === "error"
                ? "error"
                : "disconnected";
  const orbStatus =
    conversationStarted && sessionStatus === "idle"
      ? "recording"
      : sessionStatus;

  // Initialize voice engine
  useEffect(() => {
    engineRef.current = new VoiceEngine({
      wsEndpoint: settings.wsEndpoint,
      language: settings.language,
      autoSpeak: settings.autoSpeak,
      interruptMode: settings.interruptMode,
      onEvent: (event) => {
        if (event.type === "status") {
          setSessionStatus(
            event.status as
              | "idle"
              | "connecting"
              | "connected"
              | "recording"
              | "error",
          );
        } else if (event.type === "transcript_partial") {
          setPartialTranscript(event.text);
        } else if (event.type === "summary_detected") {
          // Dhara just delivered her summary — backend detected it
          setSummaryDetectedAuto(true);
          setAwaitingConfirmation(true);
          setSummaryPreview(event.text || "");
        } else if (event.type === "confirmation") {
          // Patient confirmation detected by backend
          if (event.value === "Yes") {
            void (async () => {
              setAwaitingConfirmation(false);
              const result = await performExtractRef.current();
              if (result.success) {
                setHasSubmitted(true);
                setConversationStarted(false);
                engineRef.current?.disconnect();
                setSessionStatus("idle");
              }
            })();
          } else if (event.value === "No") {
            addNotification({
              type: "info",
              title: "Summary Rejected",
              message: "Patient said No. Intake remains open.",
            });
            setAwaitingConfirmation(false);
            setSummaryDetectedAuto(false);
            setSummaryPreview("");
          }
        } else if (event.type === "transcript_final") {
          // Always append to transcript (never skip)
          transcriptRef.current = transcriptRef.current
            ? `${transcriptRef.current}\n${event.text}`
            : event.text;
          setTranscript(transcriptRef.current.trim());
          setPartialTranscript("");
        } else if (event.type === "error") {
          setSessionStatus("error");
          addNotification({
            type: "error",
            title: "Voice Error",
            message: event.message,
          });
        }
      },
    });

    return () => {
      engineRef.current?.disconnect();
    };
  }, [settings]);

  // Patient selected -> move to record phase
  const handlePatientSelected = async (patient: SelectedPatient) => {
    setSelectedPatient(patient);
    setHasSubmitted(false);
    setConversationStarted(false);
    setAwaitingConfirmation(false);
    confirmationResponseRef.current = "";
    setSummaryPreview("");

    if (patient.isNew) {
      // Create patient in backend
      const res = await createPatient(
        patient.name,
        patient.age,
        patient.gender,
      );
      if (res.success && res.id) {
        setSelectedPatient({ ...patient, id: res.id });
      }
    }

    setPhase("record");
  };

  // Voice Mode Handling

  // Real-time red flag detection from transcript
  useEffect(() => {
    if (!transcript) return;
    const flags = detectRedFlags(transcript);
    if (flags.length > 0) {
      setEmergencyAlert({
        reason: `Red flags detected: ${flags.join(", ")}`,
        action: "Refer to emergency department immediately",
      });
    }
  }, [transcript, setEmergencyAlert]);

  // Note: Beacon-style - mic is controlled by the voiceEngine based on AI speaking state
  // No need for explicit push buttons - continuous voice when in record phase

  // Extract structured data from transcript
  const buildDoctorSummary = (data: ClinicalExtraction) => {
    const patient = data.patient || {};
    const complaint = patient.chiefComplaint || "chief complaint not captured";
    const duration = patient.duration || "duration not mentioned";
    const severity = patient.severity
      ? `${patient.severity}/10`
      : "severity not mentioned";
    const aggravating = patient.aggravatingFactors
      ? Array.isArray(patient.aggravatingFactors)
        ? patient.aggravatingFactors.join(", ")
        : patient.aggravatingFactors
      : "no aggravating factors noted";
    const relieving = patient.relievingFactors
      ? Array.isArray(patient.relievingFactors)
        ? patient.relievingFactors.join(", ")
        : patient.relievingFactors
      : "no relieving factors noted";
    const diet = patient.diet || patient.diet_pattern || "diet not discussed";
    const sleep =
      patient.sleep || patient.sleep_quality || "sleep not discussed";
    const bowel =
      patient.bowel || patient.bowel_habits || "bowel habits not discussed";
    const meds =
      patient.currentMedications || "no current medications reported";
    const priorTreatments = patient.prior_treatments
      ? Array.isArray(patient.prior_treatments)
        ? patient.prior_treatments.join(", ")
        : patient.prior_treatments
      : "no prior treatments reported";
    const doshaFlag =
      patient.dosha ||
      data.ayurvedic_assessment?.dosha_imbalance?.join(", ") ||
      "dosha not specified";

    return [
      `Chief complaint: ${complaint}. Duration: ${duration}.`,
      `Severity: ${severity}. Aggravating factors: ${aggravating}. Relieving factors: ${relieving}.`,
      `Diet: ${diet}. Sleep: ${sleep}. Bowel: ${bowel}.`,
      `Medications: ${meds}. Prior treatments: ${priorTreatments}. Dosha flag: ${doshaFlag}.`,
    ].join("\n");
  };

  const getSeverityDisplay = (severity: unknown) => {
    const score = getSeverityScore(severity);
    return score !== null ? `${score}/10` : "";
  };

  const getSeverityScore = (severity: unknown) => {
    if (typeof severity === "number" && Number.isFinite(severity)) {
      return severity;
    }
    if (typeof severity === "string") {
      const normalized = severity.trim();
      const numeric = Number(normalized);
      if (!Number.isNaN(numeric) && normalized !== "") {
        return numeric;
      }
      const label = normalized.toLowerCase();
      if (label === "mild") return 3;
      if (label === "moderate") return 6;
      if (label === "severe") return 8;
    }
    return null;
  };

  const getSeverityTone = (severity: unknown) => {
    const score = getSeverityScore(severity);
    if (score === null) {
      return {
        badge: "success" as const,
        accent: "border-blue-100 bg-gradient-to-br from-blue-50 to-white",
        dot: "bg-blue-100 text-blue-700",
      };
    }

    if (score >= 8) {
      return {
        badge: "error" as const,
        accent: "border-red-100 bg-gradient-to-br from-red-50 to-white",
        dot: "bg-red-100 text-red-700",
      };
    }

    if (score >= 5) {
      return {
        badge: "warning" as const,
        accent: "border-amber-100 bg-gradient-to-br from-amber-50 to-white",
        dot: "bg-amber-100 text-amber-700",
      };
    }

    return {
      badge: "success" as const,
      accent: "border-emerald-100 bg-gradient-to-br from-emerald-50 to-white",
      dot: "bg-emerald-100 text-emerald-700",
    };
  };

  const getDoctorSummaryLines = (data: ClinicalExtraction) =>
    (data.patient?.summary || buildDoctorSummary(data))
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

  const toList = (value: unknown) =>
    Array.isArray(value) ? value : value ? [String(value)] : [];

  const normalizeTranscriptPatient = (
    patient: Partial<ClinicalExtraction["patient"]>,
  ) => ({
    ...patient,
    diet:
      patient?.diet ||
      (patient as { diet_pattern?: string | null })?.diet_pattern ||
      null,
    sleep:
      patient?.sleep ||
      (patient as { sleep_quality?: string | null })?.sleep_quality ||
      null,
    bowel:
      patient?.bowel ||
      (patient as { bowel_habits?: string | null })?.bowel_habits ||
      null,
    relievingFactors:
      patient?.relievingFactors ||
      (patient as { relieving_factors?: string[] | string | null })
        ?.relieving_factors ||
      null,
    prior_treatments:
      patient?.prior_treatments ||
      (patient as { priorTreatments?: string[] | string | null })
        ?.priorTreatments ||
      null,
  });

  const buildExtractionTranscript = (rawTranscript: string) =>
    rawTranscript
      .split("\n")
      .map((line) => line.trim())
      .filter(
        (line) =>
          line &&
          !line.toLowerCase().startsWith("dhara:") &&
          !line.toLowerCase().startsWith("system:"),
      )
      .join("\n");

  const performExtract = async (): Promise<{
    success: boolean;
    data?: ClinicalExtraction;
  }> => {
    const text = buildExtractionTranscript(transcript).trim();
    if (!text) {
      addNotification({
        type: "warning",
        title: "No Transcript",
        message: "Record or type something first.",
      });
      return { success: false };
    }

    setIsExtracting(true);
    try {
      const result = await extractIntake(
        text,
        settings.language,
        selectedPatient?.id,
      );

      if (!result.success || !result.data) {
        addNotification({
          type: "error",
          title: "Extraction Failed",
          message: result.error || "Could not extract data.",
        });
        return { success: false };
      }

      const data = result.data as ClinicalExtraction;
      const normalizedData: ClinicalExtraction = {
        ...data,
        patient: data.patient
          ? normalizeTranscriptPatient(data.patient)
          : data.patient,
      };
      if (normalizedData.ayurvedic_assessment) {
        normalizedData.ayurvedic_assessment = {
          ...normalizedData.ayurvedic_assessment,
          dosha_imbalance: toList(
            normalizedData.ayurvedic_assessment.dosha_imbalance,
          ),
          suggested_herbs: toList(
            normalizedData.ayurvedic_assessment.suggested_herbs,
          ),
          lifestyle_advice: toList(
            normalizedData.ayurvedic_assessment.lifestyle_advice,
          ),
          further_investigation: toList(
            normalizedData.ayurvedic_assessment.further_investigation,
          ),
        };
      }
      setExtraction(normalizedData);
      setPhase("review");

      // Check for emergency
      if (
        normalizedData.status === "emergency" &&
        normalizedData.emergency_alert?.triggered
      ) {
        setEmergencyAlert({
          reason: normalizedData.emergency_alert.reason,
          action: normalizedData.emergency_alert.action,
        });
      }

      // Save to local store
      const intake: PatientIntake = {
        id: `intake-${Date.now()}`,
        patientId: selectedPatient?.id,
        name:
          normalizedData.patient?.name || selectedPatient?.name || "Unknown",
        age: (normalizedData.patient?.age as number) || null,
        gender:
          (normalizedData.patient?.gender as "male" | "female" | "other") ||
          null,
        chiefComplaint: normalizedData.patient?.chiefComplaint || "",
        symptoms: normalizedData.patient?.symptoms || [],
        duration: normalizedData.patient?.duration || "",
        severity:
          (normalizedData.patient?.severity as
            | "mild"
            | "moderate"
            | "severe") || null,
        aggravatingFactors: normalizedData.patient?.aggravatingFactors || null,
        diet: normalizedData.patient?.diet || null,
        sleep: normalizedData.patient?.sleep || null,
        bowel: normalizedData.patient?.bowel || null,
        currentMedications: normalizedData.patient?.currentMedications || null,
        dosha: normalizedData.patient?.dosha,
        prakriti: normalizedData.patient?.prakriti,
        summary: buildDoctorSummary(normalizedData),
        redFlags: normalizedData.patient?.redFlags || [],
        timestamp: new Date().toISOString(),
      };
      addIntake(intake);

      addNotification({
        type: "success",
        title: "Intake Extracted",
        message: `Patient: ${intake.name} — ${intake.chiefComplaint || "No complaint noted"}`,
      });
      return { success: true, data };
    } catch (err) {
      addNotification({
        type: "error",
        title: "Extraction Error",
        message: String(err),
      });
      return { success: false };
    } finally {
      setIsExtracting(false);
    }
  };

  useEffect(() => {
    performExtractRef.current = performExtract;
  }, [performExtract]);

  const handleProceedToDoctorStage = async () => {
    if (hasSubmitted || isExtracting) return;
    setAwaitingConfirmation(false);
    setSummaryDetectedAuto(false);
    setSummaryPreview("");
    const result = await performExtractRef.current();
    if (result.success) {
      setHasSubmitted(true);
      setConversationStarted(false);
      engineRef.current?.disconnect();
      setSessionStatus("idle");
    }
  };

  const handleRestart = () => {
    setTranscript("");
    transcriptRef.current = "";
    setExtraction(null);
    setPhase("select");
    setSelectedPatient(null);
    setHasSubmitted(false);
    setConversationStarted(false);
    setAwaitingConfirmation(false);
    setSummaryDetectedAuto(false);
    confirmationResponseRef.current = "";
    setSummaryPreview("");
    engineRef.current?.disconnect();
    engineRef.current?.stopPlayback();
    setSessionStatus("idle");
  };

  // Render

  // Step 1: Patient selection
  if (phase === "select") {
    return (
      <PatientSelector
        title="Patient Intake"
        subtitle="Select or create a patient to begin intake"
        onSelect={handlePatientSelected}
      />
    );
  }

  return (
    <div className="space-y-6">
      {/* Emergency Alert */}
      {emergencyAlert && (
        <EmergencyAlert
          reason={emergencyAlert.reason}
          action={emergencyAlert.action}
          onDismiss={() => setEmergencyAlert(null)}
        />
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Patient Intake</h1>
          <div className="flex items-center gap-2 mt-0.5">
            <Badge variant="dosha">
              {selectedPatient?.isNew ? "New" : "Existing"}
            </Badge>
            <p className="text-sm text-slate-500">
              {selectedPatient?.name || "Unknown Patient"}
            </p>
          </div>
        </div>
        <Button
          size="sm"
          variant="ghost"
          onClick={handleRestart}
          icon={<RotateCcw size={14} />}
        >
          Start Over
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        {/* Left: Voice + Transcript */}
        <div className="lg:col-span-3 space-y-4">
          {phase === "record" &&
            !conversationStarted &&
            !awaitingConfirmation &&
            (sessionStatus === "idle" || sessionStatus === "error") && (
              <Card className="text-center py-8">
                <div className="flex flex-col items-center gap-4">
                  <div className="h-16 w-16 rounded-2xl bg-blue-50 flex items-center justify-center text-blue-600">
                    <Mic size={32} />
                  </div>
                  <div>
                    <h2 className="text-lg font-bold text-slate-800">
                      Start Conversation with Dhara
                    </h2>
                    <p className="text-sm text-slate-500 mt-1 max-w-sm">
                      Click below to start the voice interview. Dhara will
                      introduce herself and ask you questions.
                    </p>
                  </div>
                  <Button
                    size="lg"
                    onClick={async () => {
                      if (!engineRef.current) return;

                      // Set status immediately
                      setSessionStatus("connecting");
                      console.log("?? Starting voice interview...");

                      try {
                        const ok = await engineRef.current.connectWS();
                        if (!ok) {
                          console.error("? Failed to connect");
                          setSessionStatus("error");
                          return;
                        }

                        console.log(
                          "? WebSocket connected, starting streaming...",
                        );
                        await engineRef.current.startStreaming();
                        setConversationStarted(true);
                        setSessionStatus("recording");
                        console.log("??? Now recording!");
                      } catch (err) {
                        console.error("? Error:", err);
                        setSessionStatus("error");
                      }
                    }}
                    icon={<Mic size={16} />}
                  >
                    Start Voice Interview
                  </Button>
                </div>
              </Card>
            )}

          {phase === "record" &&
            (conversationStarted ||
              awaitingConfirmation ||
              sessionStatus === "connecting" ||
              sessionStatus === "connected" ||
              sessionStatus === "recording" ||
              sessionStatus === "speaking") && (
              <>
                {/* Voice Orb - Beacon-style continuous mode */}
                <Card active>
                  <div className="flex flex-col items-center py-6 gap-4">
                    {awaitingConfirmation && (
                      <div className="w-full max-w-2xl rounded-2xl border border-blue-100 bg-blue-50 p-4 text-left">
                        <p className="text-xs font-semibold uppercase tracking-wider text-blue-600 mb-2">
                          Dhara’s Assessment
                        </p>
                        <p className="whitespace-pre-line text-sm leading-6 text-blue-900">
                          {summaryPreview ||
                            "Dhara aapki baat ka saar taiyar kar rahi hain..."}
                        </p>
                      </div>
                    )}
                    <div className="flex items-center gap-2 rounded-full bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-600">
                      <span
                        className={`h-2.5 w-2.5 rounded-full ${
                          sessionStatus === "speaking"
                            ? "bg-emerald-500 animate-pulse"
                            : sessionStatus === "recording"
                              ? "bg-red-500 animate-pulse"
                              : sessionStatus === "connecting"
                                ? "bg-amber-500 animate-pulse"
                                : "bg-slate-400"
                        }`}
                      />
                      {sessionStatus === "speaking"
                        ? "Dhara is speaking"
                        : awaitingConfirmation
                          ? "Please confirm the summary"
                          : sessionStatus === "recording" ||
                              (conversationStarted && sessionStatus === "idle")
                            ? "Listening for your response"
                            : sessionStatus === "connected"
                              ? "Connected and ready"
                              : "Connecting..."}
                    </div>
                    <AudioVisualizer status={visualizerStatus} />
                    <VoiceOrb
                      status={orbStatus}
                      partialTranscript={partialTranscript}
                      onStart={async () => {
                        if (!engineRef.current) return;
                        setSessionStatus("connecting");
                        try {
                          const ok = await engineRef.current.connectWS();
                          if (ok) {
                            await engineRef.current.startStreaming();
                            setConversationStarted(true);
                            setSessionStatus("recording");
                          } else {
                            setSessionStatus("error");
                          }
                        } catch {
                          setSessionStatus("error");
                        }
                      }}
                    />
                    <p className="text-xs text-slate-400 mt-4">
                      {awaitingConfirmation
                        ? "Listen to the summary and answer Yes or No"
                        : sessionStatus === "speaking"
                          ? "Please listen — Dhara is replying"
                          : "Speak naturally · Dhara is listening"}
                    </p>
                    <div className="flex flex-wrap justify-center gap-2 mt-3">
                      {/* Auto-confirmation status indicator */}
                      {awaitingConfirmation && summaryDetectedAuto && (
                        <div className="w-full flex items-center justify-center gap-2 mb-2 px-3 py-2 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-700">
                          <span className="relative flex h-2 w-2">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                          </span>
                          <span className="text-xs font-medium">
                            Dhara summarized — waiting for patient's
                            confirmation
                          </span>
                        </div>
                      )}
                      {isExtracting && (
                        <div className="w-full flex items-center justify-center gap-2 mb-2 px-3 py-2 rounded-lg bg-blue-50 border border-blue-200 text-blue-700">
                          <span className="h-3 w-3 rounded-full border-2 border-blue-400 border-t-transparent animate-spin" />
                          <span className="text-xs font-medium">
                            Extracting clinical data…
                          </span>
                        </div>
                      )}
                      <Button
                        variant="secondary"
                        onClick={handleProceedToDoctorStage}
                        disabled={
                          isExtracting || hasSubmitted || !transcript.trim()
                        }
                      >
                        {isExtracting ? "Extracting..." : "Extract Now"}
                      </Button>
                      <Button
                        variant="ghost"
                        onClick={handleRestart}
                        disabled={isExtracting}
                      >
                        End Without Saving
                      </Button>
                    </div>
                  </div>
                </Card>
              </>
            )}

          {phase === "review" && extraction && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <ClipboardList size={16} className="text-violet-600" />
                  Extraction Result
                </CardTitle>
                <Badge
                  variant={
                    extraction.status === "emergency"
                      ? "error"
                      : extraction.status === "complete"
                        ? "success"
                        : "warning"
                  }
                >
                  {extraction.status}
                </Badge>
              </CardHeader>

              <div className="space-y-4">
                {extraction.patient?.chiefComplaint && (
                  <div
                    className={`rounded-2xl p-4 shadow-sm ${getSeverityTone(extraction.patient?.severity).accent}`}
                  >
                    <div className="flex items-center justify-between gap-3 mb-3">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-wider text-violet-600">
                          Clinical Intake Summary
                        </p>
                        <p className="text-sm text-slate-500">
                          Ready for doctor review
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        {getSeverityDisplay(extraction.patient?.severity) && (
                          <Badge
                            variant={
                              getSeverityTone(extraction.patient?.severity)
                                .badge
                            }
                          >
                            {getSeverityDisplay(extraction.patient?.severity)}
                          </Badge>
                        )}
                        <Badge variant="dosha">4-line brief</Badge>
                      </div>
                    </div>
                    <div className="space-y-2">
                      {getDoctorSummaryLines(extraction).map((line, index) => (
                        <div
                          key={`${index}-${line}`}
                          className="flex gap-3 rounded-xl bg-white/80 px-3 py-2 border border-white/70"
                        >
                          <div
                            className={`mt-0.5 h-6 w-6 shrink-0 rounded-full text-[10px] font-bold flex items-center justify-center ${getSeverityTone(extraction.patient?.severity).dot}`}
                          >
                            {index + 1}
                          </div>
                          <p className="text-sm leading-6 text-slate-700">
                            {line}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Patient Info */}
                {extraction.patient && (
                  <div className="grid grid-cols-2 gap-3">
                    {[
                      { label: "Name", value: extraction.patient.name },
                      { label: "Age", value: extraction.patient.age },
                      { label: "Gender", value: extraction.patient.gender },
                      {
                        label: "Complaint",
                        value: extraction.patient.chiefComplaint,
                      },
                      { label: "Duration", value: extraction.patient.duration },
                      {
                        label: "Severity",
                        value: getSeverityDisplay(extraction.patient.severity),
                      },
                      { label: "Dosha", value: extraction.patient.dosha },
                      {
                        label: "Aggravating Factors",
                        value: extraction.patient.aggravatingFactors,
                      },
                      { label: "Diet", value: extraction.patient.diet },
                      { label: "Sleep", value: extraction.patient.sleep },
                      { label: "Bowel", value: extraction.patient.bowel },
                      {
                        label: "Current Medications",
                        value: extraction.patient.currentMedications,
                      },
                    ].map(
                      (item) =>
                        item.value && (
                          <div
                            key={item.label}
                            className="rounded-xl bg-slate-50 p-3"
                          >
                            <p className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">
                              {item.label}
                            </p>
                            <p className="text-sm font-medium text-slate-700 capitalize mt-0.5">
                              {String(item.value)}
                            </p>
                          </div>
                        ),
                    )}
                  </div>
                )}

                {/* Symptoms */}
                {Array.isArray(extraction.patient?.symptoms) &&
                  extraction.patient.symptoms.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">
                        Symptoms
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {extraction.patient.symptoms.map((s, i) => (
                          <Badge key={i} variant="info">
                            {s}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}

                {/* Lifestyle & Habits */}
                {(extraction.patient?.aggravatingFactors ||
                  extraction.patient?.diet ||
                  extraction.patient?.sleep ||
                  extraction.patient?.bowel ||
                  extraction.patient?.currentMedications ||
                  extraction.patient?.prior_treatments) && (
                  <div className="rounded-xl bg-slate-50 p-3 border border-slate-100">
                    <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">
                      Lifestyle & Habits
                    </p>
                    <div className="grid grid-cols-2 gap-3">
                      {extraction.patient?.aggravatingFactors && (
                        <div>
                          <p className="text-[10px] uppercase text-slate-400">
                            Aggravating Factors
                          </p>
                          <p className="text-sm text-slate-700">
                            {extraction.patient.aggravatingFactors}
                          </p>
                        </div>
                      )}
                      {extraction.patient?.diet && (
                        <div>
                          <p className="text-[10px] uppercase text-slate-400">
                            Diet
                          </p>
                          <p className="text-sm text-slate-700">
                            {extraction.patient.diet}
                          </p>
                        </div>
                      )}
                      {extraction.patient?.sleep && (
                        <div>
                          <p className="text-[10px] uppercase text-slate-400">
                            Sleep
                          </p>
                          <p className="text-sm text-slate-700">
                            {extraction.patient.sleep}
                          </p>
                        </div>
                      )}
                      {extraction.patient?.bowel && (
                        <div>
                          <p className="text-[10px] uppercase text-slate-400">
                            Bowel
                          </p>
                          <p className="text-sm text-slate-700">
                            {extraction.patient.bowel}
                          </p>
                        </div>
                      )}
                      {extraction.patient?.currentMedications && (
                        <div>
                          <p className="text-[10px] uppercase text-slate-400">
                            Current Medications
                          </p>
                          <p className="text-sm text-slate-700">
                            {extraction.patient.currentMedications}
                          </p>
                        </div>
                      )}
                      {extraction.patient?.prior_treatments && (
                        <div>
                          <p className="text-[10px] uppercase text-slate-400">
                            Prior Treatments
                          </p>
                          <p className="text-sm text-slate-700">
                            {Array.isArray(extraction.patient.prior_treatments)
                              ? extraction.patient.prior_treatments.join(", ")
                              : extraction.patient.prior_treatments}
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Red Flags */}
                {Array.isArray(extraction.patient?.redFlags) &&
                  extraction.patient.redFlags.length > 0 && (
                    <div className="rounded-xl bg-red-50 p-3 border border-red-100">
                      <p className="text-xs font-semibold uppercase text-red-500 mb-1.5 flex items-center gap-1">
                        <AlertTriangle size={12} /> Red Flags
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {extraction.patient.redFlags.map((f, i) => (
                          <Badge key={i} variant="error">
                            {f}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}

                {/* Ayurvedic Assessment */}
                {extraction.ayurvedic_assessment && (
                  <div className="rounded-xl bg-violet-50 p-3 border border-violet-100">
                    <p className="text-xs font-semibold uppercase text-violet-500 mb-2">
                      ?? Ayurvedic Assessment
                    </p>
                    {extraction.ayurvedic_assessment.probable_diagnosis && (
                      <p className="text-sm text-violet-700 mb-2">
                        <strong>Diagnosis:</strong>{" "}
                        {extraction.ayurvedic_assessment.probable_diagnosis}
                      </p>
                    )}
                    {Array.isArray(
                      extraction.ayurvedic_assessment.dosha_imbalance,
                    ) &&
                      extraction.ayurvedic_assessment.dosha_imbalance.length >
                        0 && (
                        <div className="flex flex-wrap gap-1.5 mb-2">
                          {extraction.ayurvedic_assessment.dosha_imbalance.map(
                            (d, i) => (
                              <Badge key={i} variant="dosha">
                                {d}
                              </Badge>
                            ),
                          )}
                        </div>
                      )}
                    {Array.isArray(
                      extraction.ayurvedic_assessment.suggested_herbs,
                    ) &&
                      extraction.ayurvedic_assessment.suggested_herbs.length >
                        0 && (
                        <div className="mb-2">
                          <p className="text-xs text-violet-500 font-medium">
                            Suggested Herbs:
                          </p>
                          <p className="text-sm text-violet-700">
                            {extraction.ayurvedic_assessment.suggested_herbs.join(
                              ", ",
                            )}
                          </p>
                        </div>
                      )}
                  </div>
                )}

                {/* Follow-up */}
                {extraction.ask_followup && (
                  <div className="rounded-xl bg-amber-50 p-3 border border-amber-100">
                    <p className="text-xs font-semibold text-amber-600 mb-1">
                      Suggested Follow-up
                    </p>
                    <p className="text-sm text-amber-700">
                      {extraction.ask_followup}
                    </p>
                  </div>
                )}

                <Button
                  variant="secondary"
                  onClick={handleRestart}
                  className="w-full"
                >
                  New Intake
                </Button>
              </div>
            </Card>
          )}
        </div>

        {/* Right: Recent Intakes */}
        <div className="lg:col-span-2 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Recent Intakes</CardTitle>
              <Badge variant="info">
                 {intakeList.filter((i) => !selectedPatient || i.patientId === selectedPatient?.id).length}
               </Badge>
            </CardHeader>
            {intakeList.filter((i) => !selectedPatient || i.patientId === selectedPatient?.id).length === 0 ? (
              <div className="py-6 text-center">
                <ClipboardList
                  size={28}
                  className="text-slate-200 mx-auto mb-2"
                />
                <p className="text-xs text-slate-400">No intakes yet</p>
              </div>
            ) : (
              <div className="space-y-2 max-h-[500px] overflow-y-auto">
                {intakeList.filter((i) => !selectedPatient || i.patientId === selectedPatient?.id).slice(0, 15).map((intake) => (
                  <div
                    key={intake.id}
                    className={`flex items-center gap-3 rounded-xl hover:bg-slate-50 p-2.5 border transition-colors ${
                      getSeverityTone(intake.severity).accent
                    }`}
                  >
                    <div
                      className={`h-9 w-9 rounded-lg flex items-center justify-center font-bold text-xs shrink-0 ${getSeverityTone(intake.severity).dot}`}
                    >
                      {intake.name.charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-slate-700 truncate">
                        {intake.name}
                      </p>
                      <p className="text-[10px] text-slate-400 truncate">
                        {intake.chiefComplaint || "No complaint"} ·{" "}
                        {new Date(intake.timestamp).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </p>
                      {(intake.chiefComplaint || intake.duration) && (
                        <p className="mt-0.5 text-[10px] text-slate-500 truncate">
                          {intake.chiefComplaint || "No complaint"}
                          {intake.duration ? ` · ${intake.duration}` : ""}
                          {getSeverityDisplay(intake.severity)
                            ? ` · ${getSeverityDisplay(intake.severity)}`
                            : ""}
                        </p>
                      )}
                      {intake.summary && (
                        <p className="mt-1 text-[10px] text-slate-500 whitespace-pre-line line-clamp-2">
                          {intake.summary}
                        </p>
                      )}
                    </div>
                    {intake.redFlags.length > 0 && (
                      <AlertTriangle
                        size={14}
                        className="text-red-400 shrink-0"
                      />
                    )}
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
