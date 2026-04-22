import { useEffect } from 'react';
import { CheckCircle2, XCircle, AlertTriangle, Info, X } from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import { cn } from '../utils/cn';
import type { AppNotification } from '../types';

const ICONS: Record<AppNotification['type'], React.ReactNode> = {
  success: <CheckCircle2 size={16} className="text-emerald-500" />,
  error: <XCircle size={16} className="text-red-500" />,
  warning: <AlertTriangle size={16} className="text-amber-500" />,
  info: <Info size={16} className="text-sky-500" />,
};

const BORDER: Record<AppNotification['type'], string> = {
  success: 'border-emerald-200 bg-white',
  error: 'border-red-200 bg-white',
  warning: 'border-amber-200 bg-white',
  info: 'border-sky-200 bg-white',
};

function Toast({ notification, onDismiss }: { notification: AppNotification; onDismiss: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDismiss, 5000);
    return () => clearTimeout(t);
  }, [notification.id]);

  return (
    <div
      className={cn(
        'flex items-start gap-3 rounded-2xl border p-3.5 shadow-lg shadow-slate-200/50 backdrop-blur-sm transition-all duration-300 w-80',
        BORDER[notification.type]
      )}
    >
      <span className="mt-0.5 shrink-0">{ICONS[notification.type]}</span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-slate-800">{notification.title}</p>
        <p className="text-xs text-slate-500 mt-0.5 line-clamp-2">{notification.message}</p>
      </div>
      <button
        onClick={onDismiss}
        className="text-slate-300 hover:text-slate-500 mt-0.5 shrink-0"
      >
        <X size={14} />
      </button>
    </div>
  );
}

export function NotificationToast() {
  const { notifications, dismissNotification } = useAppStore();
  const active = notifications.slice(-4);

  if (active.length === 0) return null;

  return (
    <div className="fixed bottom-6 right-6 z-40 flex flex-col gap-2 items-end">
      {active.map((n) => (
        <Toast key={n.id} notification={n} onDismiss={() => dismissNotification(n.id)} />
      ))}
    </div>
  );
}
