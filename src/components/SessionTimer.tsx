import { useState, useEffect, useRef } from "react";

interface SessionTimerProps {
  isRunning: boolean;
}

export function SessionTimer({ isRunning }: SessionTimerProps) {
  const [elapsed, setElapsed] = useState(0);
  const startTimeRef = useRef<number>(Date.now());

  useEffect(() => {
    if (!isRunning) return;
    startTimeRef.current = Date.now();
    setElapsed(0);

    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTimeRef.current) / 1000));
    }, 1000);

    return () => clearInterval(interval);
  }, [isRunning]);

  const minutes = Math.floor(elapsed / 60);
  const seconds = elapsed % 60;

  return (
    <div className="flex items-center gap-1.5 text-xs text-slate-400">
      <div
        className={`h-1.5 w-1.5 rounded-full ${isRunning ? "bg-red-500 animate-pulse" : "bg-slate-300"}`}
      />
      <span className="font-mono tabular-nums">
        {String(minutes).padStart(2, "0")}:{String(seconds).padStart(2, "0")}
      </span>
    </div>
  );
}
