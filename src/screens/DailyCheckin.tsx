/**
 * Daily Check-in Screen
 * Conversational wellness check for existing patients
 * Voice or text answers → AI analysis
 */

import { useState, useRef, useEffect, useCallback } from "react";
import {
  ClipboardCheck,
  ChevronRight,
  RotateCcw,
  TrendingUp,
  TrendingDown,
  Minus,
  AlertCircle,
} from "lucide-react";
import { Card, CardHeader, CardTitle } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Badge } from "../components/ui/Badge";
import { VoiceOrb } from "../components/VoiceOrb";
import { PatientSelector } from "../components/PatientSelector";
import { useAppStore } from "../store/useAppStore";
import { VoiceEngine } from "../lib/voiceEngine";
import { analyzeCheckin, getLatestCheckinQuestions } from "../lib/llmClient";
import { validateCheckinSummary } from "../schemas/medical";
import type {
  DailyCheckin,
  CheckinResponse,
  CheckinSummary,
  SelectedPatient,
} from "../types";

const CHECKIN_QUESTIONS_EN = [
  "What is your main health concern or problem today?",
  "How long have you been experiencing this? (days/weeks/months)",
  "On a scale of 1 to 10, how severe is it currently?",
  "What makes your problem worse?",
  "What provides relief or makes you feel better?",
  "Describe your daily diet - what do you eat in a typical day?",
  "How is your sleep - do you sleep well and feel rested?",
  "Any current medications or treatments you are taking?",
];

const CHECKIN_QUESTIONS_HI = [
  "आज आपका मुख्य स्वास्थ्य समस्या क्या है?",
  "आप यह समस्या कितने समय से झेल रहे हैं? (दिन/सप्ताह/महीने)",
  "अभी तक की गंभीरता कितनी है? 1 से 10 के पैमाने पर?",
  "आपकी समस्या क्या बदतर बनाता है?",
  "क्या चीज़ आपको बेहतर करती है?",
  "अपनी दैनिक आहार का वर्णन करें - आप एक दिन में क्या खाते हैं?",
  "आपकी नींद कैसी है - क्या आप अच्छे से सोते हैं और ताज़ा महसूस करते हैं?",
  "क्या आप कोई दवाएं या उपचार ले रहे हैं?",
];

const CHECKIN_QUESTIONS_HINGLISH = [
  "Aaj aapka main health concern kya hai?",
  "Kitne time se aap ye problem face kar rahe ho? (days/weeks/months)",
  "Abhi tak severity kitni hai? 1 se 10 scale par?",
  "Kya aapki problem ko behtar karta hai?",
  "Kya cheej aapko better feel karwati hai?",
  "Apni daily diet describe karo - aap ek din mein kya khate ho?",
  "Aapki neend kaisi hai - kya aap ache se sote ho aur taza feel karte ho?",
  "Koi current medications ya treatment le rahe ho?",
];

const STATUS_CONFIG = {
  improving: {
    icon: <TrendingUp size={16} />,
    color: "text-emerald-600",
    bg: "bg-emerald-50",
    border: "border-emerald-200",
    label: "Improving",
  },
  stable: {
    icon: <Minus size={16} />,
    color: "text-sky-600",
    bg: "bg-sky-50",
    border: "border-sky-200",
    label: "Stable",
  },
  declining: {
    icon: <TrendingDown size={16} />,
    color: "text-red-600",
    bg: "bg-red-50",
    border: "border-red-200",
    label: "Declining",
  },
  needs_attention: {
    icon: <AlertCircle size={16} />,
    color: "text-amber-600",
    bg: "bg-amber-50",
    border: "border-amber-200",
    label: "Needs Attention",
  },
};

export function DailyCheckinScreen() {
  const {
    settings,
    sessionStatus,
    setSessionStatus,
    partialTranscript,
    setPartialTranscript,
    checkinList,
    addCheckin,
    addNotification,
    selectedPatient,
    setSelectedPatient,
  } = useAppStore();

  const [currentQuestion, setCurrentQuestion] = useState(0);
  const [responses, setResponses] = useState<CheckinResponse[]>([]);
  const [currentAnswer, setCurrentAnswer] = useState("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [summary, setSummary] = useState<CheckinSummary | null>(null);
  const [phase, setPhase] = useState<"select" | "intro" | "questions" | "done">(
    "select",
  );
  const [selectedHistory, setSelectedHistory] = useState<DailyCheckin | null>(
    null,
  );
  const [customQuestions, setCustomQuestions] = useState<string[] | null>(null);
  const [isLoadingQuestions, setIsLoadingQuestions] = useState(false);

  const engineRef = useRef<VoiceEngine | null>(null);
  const answerRef = useRef("");
  const transcriptRef = useRef("");

  // Use custom questions from doctor's prescription, or fall back to defaults
  const questions =
    customQuestions ||
    (settings.language === "hi"
      ? CHECKIN_QUESTIONS_HI
      : settings.language === "hinglish"
        ? CHECKIN_QUESTIONS_HINGLISH
        : CHECKIN_QUESTIONS_EN);

  // Patient selected → fetch auto-generated questions then move to intro
  const handlePatientSelected = async (patient: SelectedPatient) => {
    setSelectedPatient(patient);

    // Fetch auto-generated check-in questions from latest dictation
    setIsLoadingQuestions(true);
    try {
      const result = await getLatestCheckinQuestions(patient.id);
      if (result.success && result.questions && result.questions.length > 0) {
        setCustomQuestions(result.questions);
      } else {
        setCustomQuestions(null);
      }
    } catch {
      setCustomQuestions(null);
    } finally {
      setIsLoadingQuestions(false);
    }

    setPhase("intro");
  };

  useEffect(() => {
    engineRef.current = new VoiceEngine({
      wsEndpoint: settings.wsEndpoint,
      apiKey: settings.apiKey,
      language: settings.language,
      autoSpeak: settings.autoSpeak,
      interruptMode: settings.interruptMode,
      onEvent: (event) => {
        switch (event.type) {
          case "transcript_partial":
            setPartialTranscript(event.text);
            break;
          case "transcript_final":
            answerRef.current = event.text;
            setCurrentAnswer(event.text);
            setPartialTranscript("");
            break;
          case "status":
            setSessionStatus(event.status as never);
            break;
          case "error":
            setSessionStatus("error");
            addNotification({
              type: "error",
              title: "Voice Error",
              message: event.message,
            });
            break;
        }
      },
    });

    return () => {
      engineRef.current?.disconnect();
    };
  }, [settings, setSessionStatus, setPartialTranscript, addNotification]);

  const startListening = useCallback(async () => {
    setPartialTranscript("");
    answerRef.current = "";
    setSessionStatus("recording");
    try {
      if (!engineRef.current?.isConnected) {
        const ok = await engineRef.current!.connectWS();
        if (!ok) throw new Error("WS connection failed");
      }
      engineRef.current!.startStreaming();
    } catch (err) {
      console.error("Listening start error:", err);
      setSessionStatus("error");
    }
  }, [setSessionStatus, setPartialTranscript]);

  // Auto-start listening when AI finishes speaking
  useEffect(() => {
    if (phase === "questions" && sessionStatus === "idle") {
      // AI finished speaking, start listening
      const timer = setTimeout(() => {
        startListening();
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [sessionStatus, phase]);

  // Capture transcript when turn complete
  useEffect(() => {
    if (phase === "questions" && partialTranscript) {
      answerRef.current = partialTranscript;
      transcriptRef.current = partialTranscript;
    }
  }, [partialTranscript, phase]);

  const handleNext = () => {
    const answer = currentAnswer.trim() || answerRef.current.trim();
    if (!answer) {
      addNotification({
        type: "warning",
        title: "No Answer",
        message: "Please speak or type your answer.",
      });
      return;
    }

    const response: CheckinResponse = {
      question: questions[currentQuestion],
      answer,
      timestamp: new Date().toISOString(),
    };

    const newResponses = [...responses, response];
    setResponses(newResponses);
    setCurrentAnswer("");
    answerRef.current = "";

    if (currentQuestion < questions.length - 1) {
      setCurrentQuestion((q) => q + 1);
    } else {
      handleAnalyze(newResponses);
    }
  };

  const handleSkip = () => {
    const response: CheckinResponse = {
      question: questions[currentQuestion],
      answer: "Skipped",
      timestamp: new Date().toISOString(),
    };
    const newResponses = [...responses, response];
    setResponses(newResponses);
    setCurrentAnswer("");

    if (currentQuestion < questions.length - 1) {
      setCurrentQuestion((q) => q + 1);
    } else {
      handleAnalyze(newResponses);
    }
  };

  const handleAnalyze = async (allResponses: CheckinResponse[]) => {
    if (!settings.apiKey) {
      addNotification({
        type: "error",
        title: "API Key Missing",
        message: "Configure Gemini API key in Settings.",
      });
      return;
    }

    setIsAnalyzing(true);
    setPhase("done");

    try {
      const result = await analyzeCheckin(
        allResponses.map((r) => ({ question: r.question, answer: r.answer })),
        settings.apiKey,
        selectedPatient?.id,
      );

      if (!result.success || !result.data) {
        addNotification({
          type: "error",
          title: "Analysis Failed",
          message: result.error || "Unknown",
        });
        return;
      }

      const validation = validateCheckinSummary(result.data);
      const summaryData = (validation.data || result.data) as CheckinSummary;
      setSummary(summaryData);

      const checkin: DailyCheckin = {
        id: `checkin-${Date.now()}`,
        date: new Date().toISOString().split("T")[0],
        responses: allResponses,
        summary: summaryData,
      };
      addCheckin(checkin);

      addNotification({
        type: "success",
        title: "Check-in Complete",
        message: `Status: ${summaryData.overall_status}`,
      });

      if (settings.autoSpeak) {
        const msg = `Your overall status is ${summaryData.overall_status}. ${summaryData.key_observations[0] || ""}`;
        engineRef.current?.speakText(msg, settings.language);
      }
    } catch (err) {
      addNotification({ type: "error", title: "Error", message: String(err) });
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleRestart = () => {
    setCurrentQuestion(0);
    setResponses([]);
    setCurrentAnswer("");
    setSummary(null);
    setPhase("select");
    setSelectedPatient(null);
    setCustomQuestions(null);
    engineRef.current?.stopPlayback();
  };

  // Note: Beacon-style continuous mode - voice is always on when in questions phase

  const progress = Math.round((currentQuestion / questions.length) * 100);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Daily Check-in</h1>
          <div className="flex items-center gap-2 mt-0.5">
            {selectedPatient && (
              <Badge variant="dosha">{selectedPatient.name}</Badge>
            )}
            <p className="text-sm text-slate-500">
              Conversational wellness tracking
            </p>
          </div>
        </div>
        <Button
          size="sm"
          variant="ghost"
          onClick={handleRestart}
          icon={<RotateCcw size={14} />}
        >
          Restart
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        {/* Left: Q&A Panel */}
        <div className="lg:col-span-3 space-y-4">
          {/* Patient Selection */}
          {phase === "select" && (
            <PatientSelector
              title="Daily Check-in"
              subtitle="Select a patient to begin wellness check-in"
              onSelect={handlePatientSelected}
            />
          )}

          {phase === "intro" && (
            <Card className="text-center py-8">
              <div className="flex flex-col items-center gap-4">
                <div className="h-16 w-16 rounded-2xl bg-emerald-50 flex items-center justify-center text-emerald-600">
                  <ClipboardCheck size={32} />
                </div>
                {isLoadingQuestions ? (
                  <div className="text-sm text-slate-500">
                    Loading personalized questions...
                  </div>
                ) : (
                  <>
                    <div>
                      <h2 className="text-lg font-bold text-slate-800">
                        Daily Wellness Check-in
                      </h2>
                      <p className="text-sm text-slate-500 mt-1 max-w-sm">
                        {customQuestions
                          ? "Answer 3 personalized questions about your treatment adherence today."
                          : `Answer ${questions.length} questions about your health today.`}
                        You can speak or type your answers.
                      </p>
                    </div>
                    <Button
                      size="lg"
                      onClick={() => setPhase("questions")}
                      icon={<ChevronRight size={16} />}
                    >
                      Begin Check-in
                    </Button>
                  </>
                )}
              </div>
            </Card>
          )}

          {phase === "questions" && (
            <>
              {/* Progress */}
              <div className="flex items-center gap-3">
                <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-emerald-400 to-teal-500 rounded-full transition-all duration-500"
                    style={{ width: `${progress}%` }}
                  />
                </div>
                <span className="text-xs font-medium text-slate-500 shrink-0">
                  {currentQuestion + 1}/{questions.length}
                </span>
              </div>

              {/* Question Card */}
              <Card glow>
                <div className="mb-4">
                  <Badge variant="dosha" className="mb-3">
                    Question {currentQuestion + 1}
                  </Badge>
                  <h3 className="text-lg font-semibold text-slate-800">
                    {questions[currentQuestion]}
                  </h3>
                </div>

                {/* Voice Input - Beacon-style continuous */}
                <div className="flex flex-col items-center py-4 border-t border-slate-100">
                  <VoiceOrb
                    status={sessionStatus}
                    partialTranscript={partialTranscript}
                    size="sm"
                    onStart={() => {
                      // Check-in mode handles listening automatically
                    }}
                  />
                </div>

                {/* Text Input */}
                <div className="mt-3">
                  <textarea
                    className="w-full text-sm rounded-xl border border-slate-200 p-3 min-h-[80px] focus:outline-none focus:ring-2 focus:ring-emerald-300 resize-none"
                    placeholder="Or type your answer here..."
                    value={currentAnswer}
                    onChange={(e) => setCurrentAnswer(e.target.value)}
                  />
                </div>

                <div className="flex gap-2 mt-3">
                  <Button
                    className="flex-1"
                    onClick={handleNext}
                    icon={<ChevronRight size={14} />}
                  >
                    {currentQuestion < questions.length - 1
                      ? "Next"
                      : "Complete"}
                  </Button>
                  <Button variant="ghost" onClick={handleSkip}>
                    Skip
                  </Button>
                </div>
              </Card>

              {/* Previous responses */}
              {responses.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle>Answered ({responses.length})</CardTitle>
                  </CardHeader>
                  <div className="space-y-2 max-h-48 overflow-y-auto">
                    {responses.map((r, i) => (
                      <div key={i} className="rounded-xl bg-slate-50 p-3">
                        <p className="text-xs font-medium text-slate-500 mb-1">
                          Q{i + 1}: {r.question}
                        </p>
                        <p className="text-sm text-slate-700">{r.answer}</p>
                      </div>
                    ))}
                  </div>
                </Card>
              )}
            </>
          )}

          {phase === "done" && (
            <Card>
              {isAnalyzing ? (
                <div className="flex flex-col items-center justify-center py-10 gap-3">
                  <div className="h-10 w-10 animate-spin rounded-full border-4 border-emerald-200 border-t-emerald-600" />
                  <p className="text-sm text-slate-500">
                    Analyzing your responses with AI...
                  </p>
                </div>
              ) : summary ? (
                <div className="space-y-4">
                  <CardHeader>
                    <CardTitle>Check-in Analysis</CardTitle>
                    <Badge variant="success">Done</Badge>
                  </CardHeader>

                  {/* Status */}
                  <div
                    className={`flex items-center gap-3 rounded-2xl p-4 border ${
                      STATUS_CONFIG[summary.overall_status]?.bg
                    } ${STATUS_CONFIG[summary.overall_status]?.border}`}
                  >
                    <span
                      className={STATUS_CONFIG[summary.overall_status]?.color}
                    >
                      {STATUS_CONFIG[summary.overall_status]?.icon}
                    </span>
                    <div>
                      <p className="text-xs text-slate-500 font-medium">
                        Overall Status
                      </p>
                      <p
                        className={`text-lg font-bold capitalize ${STATUS_CONFIG[summary.overall_status]?.color}`}
                      >
                        {STATUS_CONFIG[summary.overall_status]?.label}
                      </p>
                    </div>
                    <div className="ml-auto text-right">
                      <p className="text-xs text-slate-400">Dosha Today</p>
                      <p className="text-sm font-semibold text-violet-600">
                        {summary.dosha_today}
                      </p>
                    </div>
                  </div>

                  {/* Observations */}
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">
                      Key Observations
                    </p>
                    <ul className="space-y-1.5">
                      {summary.key_observations.map((obs, i) => (
                        <li
                          key={i}
                          className="flex items-start gap-2 text-sm text-slate-600"
                        >
                          <span className="text-emerald-500 mt-0.5 shrink-0">
                            •
                          </span>
                          {obs}
                        </li>
                      ))}
                    </ul>
                  </div>

                  {/* Recommendations */}
                  <div className="rounded-xl bg-violet-50 p-3 border border-violet-100">
                    <p className="text-xs font-semibold uppercase tracking-wider text-violet-500 mb-2">
                      🌿 Ayurvedic Recommendations
                    </p>
                    <ul className="space-y-1.5">
                      {summary.recommendations.map((rec, i) => (
                        <li
                          key={i}
                          className="flex items-start gap-2 text-sm text-violet-700"
                        >
                          <span className="shrink-0">→</span>
                          {rec}
                        </li>
                      ))}
                    </ul>
                  </div>

                  <Button
                    variant="secondary"
                    onClick={handleRestart}
                    className="w-full"
                  >
                    Start New Check-in
                  </Button>
                </div>
              ) : null}
            </Card>
          )}
        </div>

        {/* Right: History */}
        <div className="lg:col-span-2 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Check-in History</CardTitle>
              <Badge variant="info">{checkinList.length}</Badge>
            </CardHeader>
            {checkinList.length === 0 ? (
              <div className="py-6 text-center">
                <ClipboardCheck
                  size={28}
                  className="text-slate-200 mx-auto mb-2"
                />
                <p className="text-xs text-slate-400">No check-ins yet</p>
              </div>
            ) : (
              <div className="space-y-2">
                {checkinList.slice(0, 10).map((c) => {
                  const cfg = c.summary
                    ? STATUS_CONFIG[c.summary.overall_status]
                    : null;
                  return (
                    <button
                      key={c.id}
                      onClick={() =>
                        setSelectedHistory(
                          selectedHistory?.id === c.id ? null : c,
                        )
                      }
                      className="w-full flex items-center gap-3 rounded-xl hover:bg-slate-50 p-2.5 text-left border border-slate-100 transition-colors"
                    >
                      <div
                        className={`h-8 w-8 rounded-lg flex items-center justify-center ${cfg?.bg || "bg-slate-50"} ${cfg?.color || "text-slate-400"}`}
                      >
                        {cfg?.icon || <Minus size={14} />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-slate-700">
                          {c.date}
                        </p>
                        <p className="text-[10px] text-slate-400">
                          {c.responses.length} responses ·{" "}
                          {c.summary?.dosha_today || "No analysis"}
                        </p>
                      </div>
                      {cfg && (
                        <Badge
                          variant={
                            c.summary?.overall_status === "improving"
                              ? "success"
                              : c.summary?.overall_status === "declining"
                                ? "error"
                                : c.summary?.overall_status ===
                                    "needs_attention"
                                  ? "warning"
                                  : "info"
                          }
                          size="sm"
                        >
                          {cfg.label}
                        </Badge>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </Card>

          {selectedHistory?.summary && (
            <Card>
              <CardHeader>
                <CardTitle>Summary — {selectedHistory.date}</CardTitle>
              </CardHeader>
              <div className="space-y-2 text-sm">
                <div className="rounded-xl bg-slate-50 p-3">
                  <p className="text-xs text-slate-400 font-medium">Dosha</p>
                  <p className="text-slate-700 font-semibold">
                    {selectedHistory.summary.dosha_today}
                  </p>
                </div>
                <ul className="space-y-1">
                  {selectedHistory.summary.key_observations.map((o, i) => (
                    <li key={i} className="text-xs text-slate-600 flex gap-1.5">
                      <span className="text-emerald-400">•</span>
                      {o}
                    </li>
                  ))}
                </ul>
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
