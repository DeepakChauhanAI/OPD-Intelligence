/**
 * Visit Check-in Screen — Post-Visit Prescription Adherence (Module 3)
 *
 * After a doctor visit, patients answer 3 auto-generated questions daily:
 * 1. Herb/medicine adherence (highest priority)
 * 2. Diet restrictions
 * 3. Lifestyle advice
 *
 * Flow:
 * 1. Select visit (patient's latest prescription)
 * 2. Fetch today's 3 questions from /api/checkin/{visit_id}/today
 * 3. Patient answers each question (Yes/No)
 * 4. Submit answers → adherence_score computed, alerts triggered
 */

import { useState, useEffect } from "react";
import { ClipboardList, AlertTriangle, Check } from "lucide-react";
import { Card, CardHeader, CardTitle } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Badge } from "../components/ui/Badge";
import { useAppStore } from "../store/useAppStore";
import {
  getCheckinToday,
  submitCheckinToday,
  getVisits,
} from "../lib/llmClient";

type Phase = "select" | "questions" | "done";

interface Question {
  question_hi: string;
  question_en: string;
  herb_name?: string;
}

export function VisitCheckinScreen() {
  const { backendPatients, fetchPatients, addNotification, settings } =
    useAppStore();

  const [phase, setPhase] = useState<Phase>("select");
  const [visits, setVisits] = useState<any[]>([]);
  const [selectedVisit, setSelectedVisit] = useState<any>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [dayNumber, setDayNumber] = useState<number>(1);
  const [answers, setAnswers] = useState<{
    a1: string;
    a2: string;
    a3: string;
  }>({
    a1: "",
    a2: "",
    a3: "",
  });
  const [severityToday, setSeverityToday] = useState<number>(5);
  const [isLoading, setIsLoading] = useState(false);
  const [adherenceScore, setAdherenceScore] = useState<number | null>(null);
  const [alertFlag, setAlertFlag] = useState(false);
  const [selectedPatient, setSelectedPatient] = useState<any>(null);

  // Load backend patients on mount
  useEffect(() => {
    fetchPatients();
  }, [fetchPatients]);

  const handleSelectPatient = (patient: any) => {
    setSelectedPatient(patient);
    loadVisitsForPatient(patient.id);
  };

  const loadVisitsForPatient = async (patientId: string) => {
    setIsLoading(true);
    try {
      const result = await getVisits(patientId);
      if (result.success && result.visits) {
        // Only show visits with prescription_added status (ready for check-in)
        const validVisits = result.visits.filter(
          (v: any) => v.status === "prescription_added"
        );
        setVisits(validVisits);
        if (validVisits.length > 0) {
          const latest = validVisits[0];
          setSelectedVisit(latest);
          loadQuestions(latest.id);
        } else {
          // No valid visits
          setSelectedVisit(null);
          setPhase("select");
        }
      }
    } catch (err) {
      addNotification({
        type: "error",
        title: "Error",
        message: "Failed to load visits",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const loadQuestions = async (visitId: string) => {
    setIsLoading(true);
    try {
      const result = await getCheckinToday(visitId);
      if (result.success) {
        if (result.questions && result.questions.length > 0) {
          setQuestions(result.questions as Question[]);
        } else {
          setQuestions([
            {
              question_hi: "Kya aapka aaj swasthya theek raha?",
              question_en: "Is your health okay today?",
            },
            {
              question_hi: "Kya aapne apni dawaayein li?",
              question_en: "Did you take your medicines today?",
            },
            {
              question_hi: "Kya aapne koi khaas parhej kiya?",
              question_en: "Did you follow any dietary restrictions today?",
            },
          ]);
        }
        setDayNumber(result.day_number || 1);
        setPhase("questions");
      }
    } catch (err) {
      addNotification({
        type: "error",
        title: "Error",
        message: "Failed to load questions",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleVisitSelected = (visit: any) => {
    setSelectedVisit(visit);
    setPhase("questions");
    loadQuestions(visit.id);
  };

  const handleAnswerChange = (idx: number, value: string) => {
    const key = `a${idx + 1}` as const;
    setAnswers((prev) => ({ ...prev, [key]: value }));
  };

  const handleSubmit = async () => {
    if (!selectedVisit) return;
    setIsLoading(true);
    try {
      const result = await submitCheckinToday(
        selectedVisit.id,
        answers.a1,
        answers.a2,
        answers.a3,
        severityToday,
      );

      if (result.success) {
        setAdherenceScore(result.adherence_score ?? 0);
        setAlertFlag(result.alert_flag ?? false);
        setPhase("done");
        addNotification({
          type: "success",
          title: "Check-in Submitted",
          message: `Adherence: ${result.adherence_score}/3`,
        });
      } else {
        throw new Error(result.error);
      }
    } catch (err: any) {
      addNotification({
        type: "error",
        title: "Submission Failed",
        message: err.message,
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleRestart = () => {
    setPhase("select");
    setSelectedVisit(null);
    setQuestions([]);
    setAnswers({ a1: "", a2: "", a3: "" });
    setAdherenceScore(null);
    setAlertFlag(false);
    setSelectedPatient(null);
  };

  const getQuestionText = (q: Question, lang: string): string => {
    if (lang === "hi") return q.question_hi;
    return q.question_en;
  };

  const language = settings.language;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Visit Check-in</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Post-visit prescription adherence
          </p>
        </div>
        <Button
          size="sm"
          variant="ghost"
          onClick={handleRestart}
          icon={<ClipboardList size={14} />}
        >
          New Check-in
        </Button>
      </div>

      {/* Phase 1: Select Patient + Visit */}
      {phase === "select" && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* Patient Selection */}
          <Card>
            <CardHeader>
              <CardTitle>1. Select Patient</CardTitle>
            </CardHeader>
            <div className="p-4 space-y-3">
              <div className="max-h-64 overflow-y-auto space-y-2">
                {backendPatients.map((patient) => (
                    <div
                      key={patient.id}
                      className={`p-3 rounded-lg border cursor-pointer transition-colors ${
                        selectedPatient?.id === patient.id
                          ? "border-violet-500 bg-violet-50"
                          : "border-slate-200 hover:bg-slate-50"
                      }`}
                      onClick={() => handleSelectPatient(patient)}
                    >
                      <p className="text-sm font-medium text-slate-800">
                        {patient.name}
                      </p>
                      <p className="text-xs text-slate-500">
                        {patient.age}y, {patient.gender} ·{" "}
                        {patient.chiefComplaint?.slice(0, 40) || "No complaint"}
                      </p>
                    </div>
                  ))}
              </div>
            </div>
          </Card>

          {/* Visit Selection */}
          <Card>
            <CardHeader>
              <CardTitle>2. Select Visit</CardTitle>
            </CardHeader>
            <div className="p-4">
              {!selectedPatient ? (
                <p className="text-sm text-slate-500">
                  Please select a patient first
                </p>
              ) : visits.length === 0 ? (
                <p className="text-sm text-slate-500">
                  No completed visits found for this patient. Please complete a
                  doctor dictation first.
                </p>
              ) : (
                <div className="space-y-2">
                  {visits.map((visit) => (
                    <div
                      key={visit.id}
                      className={`p-3 rounded-lg border cursor-pointer transition-colors ${
                        selectedVisit?.id === visit.id
                          ? "border-violet-500 bg-violet-50"
                          : "border-slate-200 hover:bg-slate-50"
                      }`}
                      onClick={() => handleVisitSelected(visit)}
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm font-medium text-slate-800">
                            {(visit.diagnosis_ayurveda && String(visit.diagnosis_ayurveda) !== "0") ? visit.diagnosis_ayurveda : "Clinic Visit"}
                          </p>
                          <p className="text-xs text-slate-500">
                            {visit.visit_date} · {visit.followup_days} days
                            follow-up
                          </p>
                        </div>
                        {visit.status === "prescription_added" && (
                          <Badge variant="success">Active</Badge>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Card>
        </div>
      )}

      {/* Phase 2: Questions */}
      {phase === "questions" && selectedVisit && (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Check-in for Day {dayNumber}</CardTitle>
                <Badge variant="info">Follow-up</Badge>
              </div>
              <p className="text-xs text-slate-500 mt-1">
                Answer these 3 questions about your treatment today.
              </p>
            </CardHeader>
            <div className="p-6 space-y-6">
              {questions.map((q, idx) => (
                <div key={idx} className="space-y-2">
                  <label className="block text-sm font-medium text-slate-700">
                    Q{idx + 1}: {getQuestionText(q, language)}
                  </label>
                  <div className="flex gap-2">
                    <Button
                      variant={
                        answers[`a${idx + 1}` as keyof typeof answers] === "yes"
                          ? "success"
                          : "secondary"
                      }
                      onClick={() => handleAnswerChange(idx, "yes")}
                      className="flex-1"
                    >
                      <Check size={16} className="mr-2" />
                      Yes
                    </Button>
                    <Button
                      variant={
                        answers[`a${idx + 1}` as keyof typeof answers] === "no"
                          ? "danger"
                          : "secondary"
                      }
                      onClick={() => handleAnswerChange(idx, "no")}
                      className="flex-1"
                    >
                      <AlertTriangle size={16} className="mr-2" />
                      No
                    </Button>
                  </div>
                </div>
              ))}

              {/* Severity Slider */}
              <div className="pt-4 border-t">
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  How is your health severity today? (1 = mild, 10 = severe)
                </label>
                <input
                  type="range"
                  min="1"
                  max="10"
                  value={severityToday}
                  onChange={(e) => setSeverityToday(parseInt(e.target.value))}
                  className="w-full"
                />
                <div className="flex justify-between text-xs text-slate-500">
                  <span>1 Mild</span>
                  <span className="font-bold text-violet-600">
                    {severityToday}
                  </span>
                  <span>10 Severe</span>
                </div>
              </div>
            </div>
          </Card>

          <div className="flex justify-end">
            <Button
              onClick={handleSubmit}
              disabled={isLoading || !answers.a1 || !answers.a2 || !answers.a3}
              loading={isLoading}
            >
              Submit Check-in
            </Button>
          </div>
        </div>
      )}

      {/* Phase 3: Done */}
      {phase === "done" && (
        <Card>
          <div className="p-8 text-center space-y-4">
            <div className="mx-auto w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center">
              <Check size={32} className="text-emerald-600" />
            </div>
            <h2 className="text-xl font-bold text-slate-800">
              Check-in Submitted!
            </h2>
            <div className="grid grid-cols-2 gap-4 max-w-md mx-auto">
              <div className="p-4 bg-slate-50 rounded-lg">
                <p className="text-sm text-slate-500">Adherence Score</p>
                <p className="text-2xl font-bold text-violet-600">
                  {adherenceScore} / 3
                </p>
              </div>
              <div className="p-4 bg-slate-50 rounded-lg">
                <p className="text-sm text-slate-500">Alert Status</p>
                <p
                  className={`text-lg font-bold ${alertFlag ? "text-red-600" : "text-emerald-600"}`}
                >
                  {alertFlag ? "⚠️ Flagged" : "✅ OK"}
                </p>
              </div>
            </div>
            {alertFlag && (
              <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
                <AlertTriangle className="inline mr-2" size={16} />
                Severity is elevated compared to initial visit. Your doctor may
                follow up.
              </div>
            )}
            <div className="pt-4">
              <Button onClick={handleRestart}>Check in again tomorrow</Button>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
