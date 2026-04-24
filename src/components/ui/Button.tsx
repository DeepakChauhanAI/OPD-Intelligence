import { cn } from "../../utils/cn";
import type { ButtonHTMLAttributes } from "react";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?:
    | "primary"
    | "secondary"
    | "danger"
    | "ghost"
    | "emergency"
    | "success";
  size?: "sm" | "md" | "lg" | "xl";
  loading?: boolean;
  icon?: React.ReactNode;
}

const variants = {
  primary: "bg-blue-600 hover:bg-blue-700 text-white shadow-sm shadow-blue-200",
  secondary:
    "bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 shadow-sm",
  danger: "bg-red-600 hover:bg-red-700 text-white shadow-sm shadow-red-200",
  ghost: "bg-transparent hover:bg-blue-50 text-blue-600",
  emergency:
    "bg-red-600 hover:bg-red-700 text-white shadow-lg shadow-red-300 animate-pulse",
  success:
    "bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm shadow-emerald-200",
};

const sizes = {
  sm: "px-3 py-1.5 text-xs rounded-lg",
  md: "px-4 py-2 text-sm rounded-xl",
  lg: "px-5 py-2.5 text-base rounded-xl",
  xl: "px-8 py-4 text-lg rounded-2xl",
};

export function Button({
  children,
  variant = "primary",
  size = "md",
  loading,
  icon,
  className,
  disabled,
  ...props
}: ButtonProps) {
  return (
    <button
      {...props}
      disabled={disabled || loading}
      className={cn(
        "inline-flex items-center gap-2 font-medium transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed active:scale-95",
        variants[variant],
        sizes[size],
        className,
      )}
    >
      {loading ? (
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
      ) : (
        icon && <span className="shrink-0">{icon}</span>
      )}
      {children}
    </button>
  );
}
