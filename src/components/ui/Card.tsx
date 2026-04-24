import { cn } from "../../utils/cn";

interface CardProps {
  children: React.ReactNode;
  className?: string;
  active?: boolean;
  emergency?: boolean;
}

export function Card({ children, className, active, emergency }: CardProps) {
  return (
    <div
      className={cn(
        "rounded-2xl border bg-white p-5 shadow-sm transition-all",
        active && "ring-2 ring-blue-300 ring-offset-1",
        emergency &&
          "border-red-400 ring-2 ring-red-400 ring-offset-1 animate-pulse",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function CardHeader({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mb-4 flex items-center justify-between", className)}>
      {children}
    </div>
  );
}

export function CardTitle({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <h3 className={cn("text-base font-semibold text-slate-800", className)}>
      {children}
    </h3>
  );
}
