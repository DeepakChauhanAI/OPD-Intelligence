/**
 * VoiceOrb — Central voice control component
 * Push-to-talk: Hold to record, release to process
 * Shows live waveform animation, status indicators
 */

import { useState, useCallback, useRef, useEffect } from "react";
import { Mic, Volume2, Loader2, AlertTriangle } from "lucide-react";
import { cn } from "../utils/cn";
import type { SessionStatus } from "../types";

interface VoiceOrbProps {
  status: SessionStatus;
  partialTranscript: string;
  onPushStart?: () => void;
  onPushEnd?: () => void;
  onStart?: () => void;
  disabled?: boolean;
  size?: "sm" | "md" | "lg";
}

const statusConfig: Record<
  SessionStatus,
  { color: string; ring: string; icon: React.ReactNode; label: string }
> = {
  idle: {
    color: "from-violet-500 to-indigo-600",
    ring: "ring-violet-200",
    icon: <Mic size={28} />,
    label: "Click to start",
  },
  connecting: {
    color: "from-amber-400 to-orange-500",
    ring: "ring-amber-200",
    icon: <Loader2 size={28} className="animate-spin" />,
    label: "Connecting...",
  },
  connected: {
    color: "from-emerald-400 to-teal-500",
    ring: "ring-emerald-200",
    icon: <Mic size={28} />,
    label: "Listening...",
  },
  recording: {
    color: "from-red-500 to-rose-600",
    ring: "ring-red-300 animate-ping-slow",
    icon: <Mic size={28} />,
    label: "Listening...",
  },
  processing: {
    color: "from-sky-400 to-blue-500",
    ring: "ring-sky-200",
    icon: <Loader2 size={28} className="animate-spin" />,
    label: "Processing...",
  },
  speaking: {
    color: "from-emerald-400 to-green-500",
    ring: "ring-emerald-200",
    icon: <Volume2 size={28} />,
    label: "Dhara is speaking...",
  },
  error: {
    color: "from-red-400 to-red-600",
    ring: "ring-red-200",
    icon: <AlertTriangle size={28} />,
    label: "Error — tap to retry",
  },
};

const sizeConfig = {
  sm: { orb: "h-16 w-16", ring: "h-20 w-20", text: "text-xs" },
  md: { orb: "h-24 w-24", ring: "h-32 w-32", text: "text-sm" },
  lg: { orb: "h-32 w-32", ring: "h-44 w-44", text: "text-base" },
};

export function VoiceOrb({
  status,
  partialTranscript,
  onPushStart,
  onPushEnd,
  onStart,
  disabled,
  size = "lg",
}: VoiceOrbProps) {
  const [pressing, setPressing] = useState(false);
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cfg = statusConfig[status] || {
    color: "from-slate-500 to-slate-600",
    ring: "ring-slate-200",
    icon: <Mic size={28} />,
    label: "Unknown",
  };
  const sz = sizeConfig[size];

  // Wave bars for animation
  const bars = Array.from({ length: 7 });

  const handleOrbClick = useCallback(() => {
    if (disabled) return;
    // If onStart is provided and status is idle/connected, trigger it
    if (status === "idle" || status === "connected") {
      if (onStart) {
        onStart();
      } else if (onPushStart) {
        setPressing(true);
        onPushStart();
      }
    }
  }, [disabled, onStart, onPushStart, status]);

  const handleMouseDown = useCallback(() => {
    if (disabled) return;
    setPressing(true);
    onPushStart?.();
  }, [disabled, onPushStart]);

  const handleMouseUp = useCallback(() => {
    if (!pressing) return;
    setPressing(false);
    onPushEnd?.();
  }, [pressing, onPushEnd]);

  // Touch support
  const handleTouchStart = useCallback(
    (e: React.TouchEvent) => {
      e.preventDefault();
      handleMouseDown();
    },
    [handleMouseDown],
  );

  const handleTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      e.preventDefault();
      handleMouseUp();
    },
    [handleMouseUp],
  );

  useEffect(() => {
    return () => {
      if (pressTimer.current) clearTimeout(pressTimer.current);
    };
  }, []);

  const isRecording = status === "recording";

  return (
    <div className="flex flex-col items-center gap-4">
      {/* Outer ring */}
      <div className="relative flex items-center justify-center">
        {/* Pulse rings */}
        {isRecording && (
          <>
            <span
              className={cn(
                "absolute rounded-full bg-red-400/20",
                sz.ring,
                "animate-ping",
              )}
            />
            <span
              className={cn(
                "absolute rounded-full bg-red-400/10",
                sz.ring,
                "animate-ping [animation-delay:150ms]",
              )}
            />
          </>
        )}

        {/* Main Orb */}
        <button
          onClick={handleOrbClick}
          onMouseDown={handleMouseDown}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
          disabled={disabled}
          className={cn(
            "relative flex items-center justify-center rounded-full text-white shadow-2xl transition-all duration-200 select-none",
            `bg-gradient-to-br ${cfg.color}`,
            `ring-4 ${cfg.ring}`,
            sz.orb,
            pressing
              ? "scale-95 shadow-inner"
              : "hover:scale-105 active:scale-95",
            disabled && "opacity-40 cursor-not-allowed",
          )}
        >
          {cfg.icon}

          {/* Waveform overlay when recording */}
          {isRecording && (
            <div className="absolute inset-0 flex items-center justify-center gap-0.5 rounded-full overflow-hidden px-4">
              {bars.map((_, i) => (
                <div
                  key={i}
                  className="w-1 rounded-full bg-white/70"
                  style={{
                    height: `${20 + Math.sin((i / bars.length) * Math.PI) * 50}%`,
                    animation: `wave 0.8s ease-in-out infinite`,
                    animationDelay: `${i * 0.1}s`,
                  }}
                />
              ))}
            </div>
          )}
        </button>
      </div>

      {/* Status label */}
      <div className="text-center space-y-1">
        <p className={cn("font-medium text-slate-600", sz.text)}>{cfg.label}</p>

        {/* Partial transcript */}
        {partialTranscript && (
          <p className="text-xs text-slate-400 italic max-w-xs truncate">
            "{partialTranscript}"
          </p>
        )}
      </div>
    </div>
  );
}
