import { useMemo } from "react";

interface InterviewProgressProps {
  currentPhase: number;
  totalPhases: number;
  phaseName: string;
  phaseDescription: string;
}

const PHASES = [
  {
    name: "Chief Complaint",
    icon: "💬",
    tip: "Describe what brings you in today",
  },
  { name: "Onset", icon: "📅", tip: "When did this first start?" },
  { name: "Location", icon: "📍", tip: "Where exactly do you feel it?" },
  { name: "Duration", icon: "⏱️", tip: "How long does it last?" },
  { name: "Character", icon: "🔍", tip: "Sharp, dull, burning, aching?" },
  { name: "Aggravating", icon: "⬆️", tip: "What makes it worse?" },
  { name: "Relieving", icon: "⬇️", tip: "What makes it better?" },
  { name: "Timing", icon: "🔄", tip: "Constant or comes and goes?" },
  { name: "Severity", icon: "📊", tip: "Rate it from 0 to 10" },
  { name: "Other Symptoms", icon: "🩺", tip: "Any other symptoms?" },
  { name: "Medical History", icon: "📋", tip: "Past conditions or surgeries" },
  { name: "Medications", icon: "💊", tip: "Current medications" },
  { name: "Allergies", icon: "⚠️", tip: "Known allergies" },
  { name: "Summary", icon: "✅", tip: "Review your information" },
];

export function InterviewProgress({ currentPhase }: InterviewProgressProps) {
  const phase = PHASES[Math.min(currentPhase, PHASES.length - 1)];
  const progress = ((currentPhase + 1) / PHASES.length) * 100;

  const visiblePhases = useMemo(() => {
    const start = Math.max(0, currentPhase - 1);
    const end = Math.min(PHASES.length, start + 4);
    return PHASES.slice(start, end).map((p, i) => ({
      ...p,
      index: start + i,
    }));
  }, [currentPhase]);

  return (
    <div className="w-full max-w-md mx-auto">
      <div className="relative mb-3">
        <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-blue-500 to-emerald-500 rounded-full transition-all duration-700 ease-out"
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className="flex justify-between mt-1">
          <span className="text-[10px] text-slate-400">Start</span>
          <span className="text-[10px] text-slate-400 font-medium">
            {currentPhase + 1} of {PHASES.length}
          </span>
          <span className="text-[10px] text-slate-400">Complete</span>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-3 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-blue-50 text-xl shrink-0">
            {phase.icon}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs text-blue-600 font-semibold uppercase tracking-wider">
              Current Question
            </p>
            <p className="text-sm font-medium text-slate-800 truncate">
              {phase.name}
            </p>
          </div>
        </div>

        <div className="mt-2 px-2 py-1.5 bg-amber-50 rounded-lg border border-amber-100">
          <p className="text-xs text-amber-700 flex items-center gap-1.5">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-3.5 w-3.5 shrink-0"
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
            <span className="font-medium">Tip:</span> {phase.tip}
          </p>
        </div>
      </div>

      <div className="mt-2 flex gap-1 justify-center">
        {visiblePhases.map((p) => (
          <div
            key={p.index}
            className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-medium transition-all duration-300 ${
              p.index === currentPhase
                ? "bg-blue-100 text-blue-700"
                : p.index < currentPhase
                  ? "bg-emerald-50 text-emerald-600"
                  : "bg-slate-50 text-slate-400"
            }`}
          >
            <span>{p.index < currentPhase ? "✓" : p.icon}</span>
            <span className="hidden sm:inline">{p.name}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function detectPhase(text: string): number {
  const lower = text.toLowerCase();

  if (
    lower.includes("thank you") &&
    (lower.includes("recorded") || lower.includes("doctor will review"))
  )
    return 13;
  if (
    lower.includes("summarize") ||
    lower.includes("summary") ||
    lower.includes("let me summarize") ||
    lower.includes("i've noted") ||
    lower.includes("here's what")
  )
    return 13;
  if (lower.includes("allerg")) return 12;
  if (
    lower.includes("medication") ||
    lower.includes("medicine") ||
    lower.includes("taking any")
  )
    return 11;
  if (
    lower.includes("medical condition") ||
    lower.includes("medical history") ||
    lower.includes("existing")
  )
    return 10;
  if (
    lower.includes("other symptom") ||
    lower.includes("associated") ||
    lower.includes("alongside")
  )
    return 9;
  if (
    lower.includes("scale") ||
    lower.includes("zero to ten") ||
    lower.includes("severity") ||
    lower.includes("rate it")
  )
    return 8;
  if (
    lower.includes("constant") ||
    lower.includes("come and go") ||
    lower.includes("timing") ||
    lower.includes("comes and goes")
  )
    return 7;
  if (
    lower.includes("better") ||
    lower.includes("reliev") ||
    lower.includes("ease") ||
    lower.includes("help")
  )
    return 6;
  if (
    lower.includes("worse") ||
    lower.includes("aggravat") ||
    lower.includes("trigger")
  )
    return 5;
  if (
    lower.includes("character") ||
    lower.includes("sharp") ||
    lower.includes("dull") ||
    lower.includes("burning") ||
    lower.includes("describe it") ||
    lower.includes("describe the")
  )
    return 4;
  if (
    lower.includes("how long") ||
    lower.includes("duration") ||
    lower.includes("last when")
  )
    return 3;
  if (
    lower.includes("where") ||
    lower.includes("location") ||
    lower.includes("feel it") ||
    lower.includes("area")
  )
    return 2;
  if (
    lower.includes("when did") ||
    lower.includes("onset") ||
    lower.includes("first start") ||
    lower.includes("begin")
  )
    return 1;
  if (
    lower.includes("what brings you") ||
    lower.includes("hello") ||
    lower.includes("beacon") ||
    lower.includes("intake")
  )
    return 0;

  return -1;
}
