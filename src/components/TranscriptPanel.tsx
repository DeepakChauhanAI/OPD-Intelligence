import { useRef, useEffect, useMemo } from "react";
import type { TranscriptEntry } from "../types";
import {
  extractMedicalData,
  generateStructuredSummary,
  getCompletionStats,
} from "../lib/summaryExtractor";

interface TranscriptPanelProps {
  transcript: TranscriptEntry[];
  visible: boolean;
  onClose: () => void;
}

export function TranscriptPanel({
  transcript,
  visible,
  onClose,
}: TranscriptPanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current && visible) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [transcript.length, visible]);

  const { fields, stats } = useMemo(() => {
    if (transcript.length === 0)
      return { fields: [], stats: { captured: 0, total: 13, percentage: 0 } };
    const data = extractMedicalData(transcript);
    return {
      fields: generateStructuredSummary(data),
      stats: getCompletionStats(data),
    };
  }, [transcript]);

  if (!visible) return null;

  return (
    <div className="animate-slide-up fixed bottom-0 left-0 right-0 z-40 max-h-[60vh] bg-white/95 backdrop-blur-lg border-t border-slate-200 shadow-2xl rounded-t-2xl flex flex-col">
      <div className="flex items-center justify-between px-6 py-3 border-b border-slate-100 shrink-0">
        <div className="flex items-center gap-2">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-4 w-4 text-emerald-500"
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
          <h3 className="text-sm font-semibold text-slate-700">Patient Data</h3>
          {stats.captured > 0 && (
            <span
              className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                stats.percentage >= 80
                  ? "bg-emerald-100 text-emerald-700"
                  : stats.percentage >= 50
                    ? "bg-amber-100 text-amber-700"
                    : "bg-blue-100 text-blue-700"
              }`}
            >
              {stats.captured}/{stats.total} fields
            </span>
          )}
        </div>
        <button
          onClick={onClose}
          className="flex items-center justify-center h-7 w-7 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
          title="Close"
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
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-3">
        {transcript.length === 0 ? (
          <div className="text-center py-6">
            <p className="text-sm text-slate-400">
              Waiting for data collection...
            </p>
            <p className="text-xs text-slate-300 mt-1">
              Medical data will appear here as collected
            </p>
          </div>
        ) : (
          <div className="max-w-2xl mx-auto space-y-4">
            {fields.length > 0 && (
              <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4">
                <div className="flex items-center gap-2 mb-3">
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
                  <h4 className="text-xs font-bold text-emerald-800 uppercase tracking-wider">
                    Captured Patient Data
                  </h4>
                  <div className="flex-1" />
                  <div className="flex items-center gap-1">
                    <div className="h-1.5 w-16 bg-emerald-200 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-emerald-500 rounded-full transition-all duration-500"
                        style={{ width: `${stats.percentage}%` }}
                      />
                    </div>
                    <span className="text-[10px] text-emerald-600 font-medium">
                      {stats.percentage}%
                    </span>
                  </div>
                </div>

                <div className="grid gap-1.5">
                  {fields.map((field, i) => (
                    <div
                      key={i}
                      className="flex gap-2 text-sm bg-white/70 rounded-lg px-3 py-1.5"
                    >
                      <span className="font-semibold text-slate-600 w-[140px] shrink-0 text-xs uppercase tracking-wide">
                        {field.label}
                      </span>
                      <span className="text-slate-800 capitalize text-sm">
                        {field.value}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <details className="group">
              <summary className="flex items-center gap-2 cursor-pointer text-xs font-semibold text-slate-400 hover:text-slate-600 transition-colors select-none">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-3.5 w-3.5 transition-transform group-open:rotate-90"
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
                Raw Log ({transcript.length} entries)
              </summary>
              <div className="mt-2 space-y-1.5 ml-5">
                {transcript.map((entry, i) => (
                  <div key={i} className="flex gap-2 text-xs">
                    <span className="text-slate-300 font-mono shrink-0">
                      {entry.timestamp}
                    </span>
                    <p className="text-slate-500 leading-relaxed">
                      {entry.text}
                    </p>
                  </div>
                ))}
              </div>
            </details>
          </div>
        )}
      </div>

      <div className="px-6 py-2 border-t border-slate-50 shrink-0">
        <p className="text-[10px] text-slate-300 text-center">
          Data extracted from AI reasoning text
        </p>
      </div>
    </div>
  );
}
