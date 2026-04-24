import { cn } from "../../utils/cn";

interface BadgeProps {
  children: React.ReactNode;
  variant?:
    | "default"
    | "success"
    | "warning"
    | "error"
    | "emergency"
    | "info"
    | "dosha";
  size?: "sm" | "md";
  className?: string;
}

const variants = {
  default: "bg-slate-100 text-slate-600 border-slate-200",
  success: "bg-emerald-100 text-emerald-700 border-emerald-200",
  warning: "bg-amber-100 text-amber-700 border-amber-200",
  error: "bg-red-100 text-red-700 border-red-200",
  emergency: "bg-red-100 text-red-700 border-red-200 animate-pulse",
  info: "bg-blue-100 text-blue-700 border-blue-200",
  dosha: "bg-teal-100 text-teal-700 border-teal-200",
};

export function Badge({
  children,
  variant = "default",
  size = "sm",
  className,
}: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border font-medium",
        size === "sm" ? "px-2 py-0.5 text-xs" : "px-3 py-1 text-sm",
        variants[variant],
        className,
      )}
    >
      {children}
    </span>
  );
}
