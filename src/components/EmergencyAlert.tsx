import { AlertTriangle, Phone, X } from "lucide-react";

interface EmergencyAlertProps {
  reason: string;
  action: string;
  onDismiss: () => void;
}

export function EmergencyAlert({
  reason,
  action,
  onDismiss,
}: EmergencyAlertProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-md rounded-3xl border-2 border-red-500 bg-white p-6 shadow-2xl animate-bounce-in">
        {/* Header */}
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-red-100 text-red-600 animate-pulse">
              <AlertTriangle size={24} />
            </div>
            <div>
              <h2 className="text-lg font-bold text-red-700">
                🚨 EMERGENCY ALERT
              </h2>
              <p className="text-xs text-red-500">
                Immediate medical attention required
              </p>
            </div>
          </div>
          <button
            onClick={onDismiss}
            className="rounded-full p-1 hover:bg-red-50 text-slate-400"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div className="space-y-3 mb-5">
          <div className="rounded-xl bg-red-50 p-3 border border-red-100">
            <p className="text-sm font-medium text-red-800">
              Red Flag Detected:
            </p>
            <p className="text-sm text-red-700 mt-1">{reason}</p>
          </div>
          <div className="rounded-xl bg-amber-50 p-3 border border-amber-100">
            <p className="text-sm font-medium text-amber-800">
              Action Required:
            </p>
            <p className="text-sm text-amber-700 mt-1">{action}</p>
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-3">
          <a
            href="tel:102"
            className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-red-600 py-3 text-sm font-bold text-white hover:bg-red-700 transition-colors"
          >
            <Phone size={16} />
            Call 102 (Ambulance)
          </a>
          <button
            onClick={onDismiss}
            className="flex-1 rounded-xl border-2 border-red-200 py-3 text-sm font-medium text-red-600 hover:bg-red-50 transition-colors"
          >
            Acknowledge
          </button>
        </div>
      </div>
    </div>
  );
}
