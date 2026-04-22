import { useRef, useEffect, useCallback } from "react";

interface AudioVisualizerProps {
  status:
    | "idle"
    | "connecting"
    | "connected"
    | "listening"
    | "model_speaking"
    | "complete"
    | "error"
    | "disconnected";
}

export function AudioVisualizer({ status }: AudioVisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animFrameRef = useRef<number>(0);
  const timeRef = useRef(0);

  const getColor = useCallback(() => {
    switch (status) {
      case "listening":
        return { r: 37, g: 99, b: 235 }; // blue
      case "model_speaking":
        return { r: 16, g: 185, b: 129 }; // green
      case "connecting":
      case "connected":
        return { r: 234, g: 179, b: 8 }; // yellow
      case "error":
        return { r: 239, g: 68, b: 68 }; // red
      default:
        return { r: 148, g: 163, b: 184 }; // gray
    }
  }, [status]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const size = 280;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    canvas.style.width = `${size}px`;
    canvas.style.height = `${size}px`;
    ctx.scale(dpr, dpr);

    const centerX = size / 2;
    const centerY = size / 2;
    const baseRadius = 90;

    const draw = () => {
      timeRef.current += 0.02;
      ctx.clearRect(0, 0, size, size);
      const color = getColor();

      let avgLevel = 0;
      const isActive = status === "listening" || status === "model_speaking";
      if (isActive) {
        avgLevel =
          0.3 +
          0.2 * Math.sin(timeRef.current * 3) +
          0.1 * Math.sin(timeRef.current * 7);
      } else if (status === "connecting" || status === "connected") {
        avgLevel = 0.1 + 0.05 * Math.sin(timeRef.current * 2);
      }

      const glowRadius = baseRadius + 30 + avgLevel * 40;
      const gradient = ctx.createRadialGradient(
        centerX,
        centerY,
        baseRadius,
        centerX,
        centerY,
        glowRadius,
      );
      gradient.addColorStop(
        0,
        `rgba(${color.r}, ${color.g}, ${color.b}, 0.15)`,
      );
      gradient.addColorStop(1, `rgba(${color.r}, ${color.g}, ${color.b}, 0)`);
      ctx.beginPath();
      ctx.arc(centerX, centerY, glowRadius, 0, Math.PI * 2);
      ctx.fillStyle = gradient;
      ctx.fill();

      const midRadius = baseRadius + 8 + avgLevel * 20;
      ctx.beginPath();
      ctx.arc(centerX, centerY, midRadius, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(${color.r}, ${color.g}, ${color.b}, 0.25)`;
      ctx.lineWidth = 2;
      ctx.stroke();

      const segments = 64;
      ctx.beginPath();
      for (let i = 0; i <= segments; i++) {
        const angle = (i / segments) * Math.PI * 2 - Math.PI / 2;
        let amplitude = 0;
        if (isActive) {
          amplitude =
            (Math.sin(angle * 3 + timeRef.current * 4) * 0.5 + 0.5) *
            avgLevel *
            25;
          amplitude +=
            Math.sin(angle * 5 + timeRef.current * 6) * 0.3 * avgLevel * 15;
        }
        const r = baseRadius + amplitude;
        const x = centerX + Math.cos(angle) * r;
        const y = centerY + Math.sin(angle) * r;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.strokeStyle = `rgba(${color.r}, ${color.g}, ${color.b}, 0.6)`;
      ctx.lineWidth = 2.5;
      ctx.stroke();

      const innerGrad = ctx.createRadialGradient(
        centerX,
        centerY,
        0,
        centerX,
        centerY,
        baseRadius,
      );
      innerGrad.addColorStop(
        0,
        `rgba(${color.r}, ${color.g}, ${color.b}, 0.08)`,
      );
      innerGrad.addColorStop(
        0.7,
        `rgba(${color.r}, ${color.g}, ${color.b}, 0.04)`,
      );
      innerGrad.addColorStop(
        1,
        `rgba(${color.r}, ${color.g}, ${color.b}, 0.12)`,
      );
      ctx.beginPath();
      ctx.arc(centerX, centerY, baseRadius, 0, Math.PI * 2);
      ctx.fillStyle = innerGrad;
      ctx.fill();
      ctx.strokeStyle = `rgba(${color.r}, ${color.g}, ${color.b}, 0.5)`;
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.fillStyle = `rgba(${color.r}, ${color.g}, ${color.b}, 0.9)`;
      ctx.font = "600 24px Inter, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      if (status === "listening") {
        drawMicIcon(ctx, centerX, centerY, color);
      } else if (status === "model_speaking") {
        drawSpeakerIcon(ctx, centerX, centerY, color);
      } else if (status === "connecting" || status === "connected") {
        ctx.fillText("⏳", centerX, centerY);
      } else if (status === "complete") {
        ctx.fillText("✓", centerX, centerY);
      } else if (status === "error") {
        ctx.fillText("!", centerX, centerY);
      } else {
        drawCrossIcon(ctx, centerX, centerY, color);
      }

      animFrameRef.current = requestAnimationFrame(draw);
    };

    draw();

    return () => {
      cancelAnimationFrame(animFrameRef.current);
    };
  }, [status, getColor]);

  return (
    <div className="relative flex items-center justify-center">
      <canvas ref={canvasRef} className="drop-shadow-lg" />
    </div>
  );
}

function drawMicIcon(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  color: { r: number; g: number; b: number },
) {
  ctx.save();
  ctx.strokeStyle = `rgba(${color.r}, ${color.g}, ${color.b}, 0.8)`;
  ctx.lineWidth = 2.5;
  ctx.lineCap = "round";

  const w = 8,
    h = 14;
  ctx.beginPath();
  ctx.roundRect(cx - w, cy - h - 2, w * 2, h * 2, 8);
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(cx, cy + 2, 14, Math.PI, 0, false);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(cx, cy + 16);
  ctx.lineTo(cx, cy + 22);
  ctx.moveTo(cx - 8, cy + 22);
  ctx.lineTo(cx + 8, cy + 22);
  ctx.stroke();
  ctx.restore();
}

function drawSpeakerIcon(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  color: { r: number; g: number; b: number },
) {
  ctx.save();
  ctx.strokeStyle = `rgba(${color.r}, ${color.g}, ${color.b}, 0.8)`;
  ctx.fillStyle = `rgba(${color.r}, ${color.g}, ${color.b}, 0.8)`;
  ctx.lineWidth = 2.5;
  ctx.lineCap = "round";

  ctx.beginPath();
  ctx.moveTo(cx - 12, cy - 6);
  ctx.lineTo(cx - 4, cy - 6);
  ctx.lineTo(cx + 6, cy - 14);
  ctx.lineTo(cx + 6, cy + 14);
  ctx.lineTo(cx - 4, cy + 6);
  ctx.lineTo(cx - 12, cy + 6);
  ctx.closePath();
  ctx.fill();

  ctx.beginPath();
  ctx.arc(cx + 8, cy, 10, -Math.PI / 3, Math.PI / 3, false);
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(cx + 8, cy, 18, -Math.PI / 3, Math.PI / 3, false);
  ctx.stroke();

  ctx.restore();
}

function drawCrossIcon(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  color: { r: number; g: number; b: number },
) {
  ctx.save();
  ctx.fillStyle = `rgba(${color.r}, ${color.g}, ${color.b}, 0.7)`;
  const s = 6,
    l = 18;
  ctx.fillRect(cx - s, cy - l, s * 2, l * 2);
  ctx.fillRect(cx - l, cy - s, l * 2, s * 2);
  ctx.restore();
}
