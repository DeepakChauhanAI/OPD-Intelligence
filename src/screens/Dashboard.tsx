import {
  Users,
  Mic2,
  ClipboardCheck,
  AlertCircle,
  Activity,
  Stethoscope,
  Leaf,
  Calendar,
  Zap,
} from "lucide-react";
import { useState, useEffect } from "react";
import { Card, CardHeader, CardTitle } from "../components/ui/Card";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { useAppStore } from "../store/useAppStore";

const DOSHA_COLORS: Record<string, string> = {
  vata: "bg-sky-100 text-sky-700",
  pitta: "bg-orange-100 text-orange-700",
  kapha: "bg-emerald-100 text-emerald-700",
};

const QUICK_ACTIONS = [
  {
    label: "New Patient Intake",
    screen: "intake" as const,
    icon: <Users size={18} />,
    color: "from-violet-500 to-indigo-600",
  },
  {
    label: "Doctor Dictation",
    screen: "dictation" as const,
    icon: <Mic2 size={18} />,
    color: "from-sky-500 to-blue-600",
  },
  {
    label: "Daily Check-in",
    screen: "checkin" as const,
    icon: <ClipboardCheck size={18} />,
    color: "from-emerald-500 to-teal-600",
  },
];

export function Dashboard() {
  const {
    intakeList,
    dictationList,
    checkinList,
    setScreen,
    notifications,
    settings,
    fetchPatients,
  } = useAppStore();

  const [backendStatus, setBackendStatus] = useState<
    "online" | "offline" | "unknown"
  >("unknown");

  // Fetch backend health and patients on mount
  useEffect(() => {
    const checkBackend = async () => {
      try {
        const res = await fetch("/api/health");
        if (res.ok) {
          setBackendStatus("online");
          // Also fetch patients
          fetchPatients();
        } else {
          setBackendStatus("offline");
        }
      } catch {
        setBackendStatus("offline");
      }
    };
    checkBackend();
  }, [fetchPatients]);

  const emergencyCount = intakeList.filter(
    (p) => p.redFlags && p.redFlags.length > 0,
  ).length;

  const todayStr = new Date().toDateString();
  const todayIntakes = intakeList.filter(
    (i) => new Date(i.timestamp).toDateString() === todayStr,
  ).length;

  const recentPatients = intakeList.slice(0, 5);
  const activeNotifications = notifications;

  const hasApiKey = !!settings.apiKey;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">
            Good {getGreeting()},
          </h1>
          <p className="text-slate-500 text-sm mt-0.5">
            {new Date().toLocaleDateString("en-IN", {
              weekday: "long",
              year: "numeric",
              month: "long",
              day: "numeric",
            })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div
            className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium ${
              backendStatus === "online"
                ? "bg-emerald-50 text-emerald-700"
                : backendStatus === "offline"
                  ? "bg-red-50 text-red-700"
                  : "bg-slate-50 text-slate-500"
            }`}
          >
            <Activity size={12} />
            {backendStatus === "online"
              ? "Backend Online"
              : backendStatus === "offline"
                ? "Backend Offline"
                : "Checking..."}
          </div>
        </div>
      </div>

      {/* API Key warning */}
      {!hasApiKey && (
        <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <AlertCircle size={18} className="text-amber-600 mt-0.5 shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-semibold text-amber-800">
              API Key Required
            </p>
            <p className="text-xs text-amber-600 mt-0.5">
              Configure your Gemini API key in Settings to enable AI features.
            </p>
          </div>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setScreen("settings")}
          >
            Configure
          </Button>
        </div>
      )}

      {/* Emergency banner */}
      {emergencyCount > 0 && (
        <div className="flex items-center gap-3 rounded-2xl border-2 border-red-400 bg-red-50 p-4 animate-pulse">
          <AlertCircle size={20} className="text-red-600 shrink-0" />
          <p className="text-sm font-bold text-red-700">
            {emergencyCount} patient(s) with red flag symptoms — review
            immediately
          </p>
          <Button
            size="sm"
            variant="danger"
            onClick={() => setScreen("intake")}
          >
            Review
          </Button>
        </div>
      )}

      {/* Stats grid */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[
          {
            label: "Today's Patients",
            value: todayIntakes,
            icon: <Users size={20} />,
            color: "text-violet-600",
            bg: "bg-violet-50",
            trend: "+2 vs yesterday",
          },
          {
            label: "Total Dictations",
            value: dictationList.length,
            icon: <Mic2 size={20} />,
            color: "text-sky-600",
            bg: "bg-sky-50",
            trend: "Structured notes",
          },
          {
            label: "Check-ins Done",
            value: checkinList.length,
            icon: <ClipboardCheck size={20} />,
            color: "text-emerald-600",
            bg: "bg-emerald-50",
            trend: "Daily tracking",
          },
          {
            label: "Red Flags",
            value: emergencyCount,
            icon: <AlertCircle size={20} />,
            color: emergencyCount > 0 ? "text-red-600" : "text-slate-400",
            bg: emergencyCount > 0 ? "bg-red-50" : "bg-slate-50",
            trend: emergencyCount > 0 ? "Need attention" : "All clear",
          },
        ].map((stat) => (
          <Card key={stat.label} className="relative overflow-hidden">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs text-slate-500 font-medium">
                  {stat.label}
                </p>
                <p className={`text-3xl font-bold mt-1 ${stat.color}`}>
                  {stat.value}
                </p>
                <p className="text-[10px] text-slate-400 mt-1">{stat.trend}</p>
              </div>
              <div
                className={`flex h-10 w-10 items-center justify-center rounded-xl ${stat.bg} ${stat.color}`}
              >
                {stat.icon}
              </div>
            </div>
          </Card>
        ))}
      </div>

      {/* Quick Actions */}
      <div>
        <h2 className="text-sm font-semibold text-slate-600 mb-3 uppercase tracking-wider">
          Quick Actions
        </h2>
        <div className="grid grid-cols-3 gap-4">
          {QUICK_ACTIONS.map((action) => (
            <button
              key={action.label}
              onClick={() => setScreen(action.screen)}
              className="group relative overflow-hidden rounded-2xl p-5 text-left transition-all hover:scale-[1.02] active:scale-95 shadow-sm"
            >
              <div
                className={`absolute inset-0 bg-gradient-to-br ${action.color} opacity-90`}
              />
              <div className="relative z-10">
                <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-white/20 text-white">
                  {action.icon}
                </div>
                <p className="text-sm font-semibold text-white">
                  {action.label}
                </p>
                <p className="text-xs text-white/70 mt-0.5">Voice AI powered</p>
              </div>
              <Zap
                size={60}
                className="absolute -right-4 -bottom-4 text-white/10"
              />
            </button>
          ))}
        </div>
      </div>

      {/* Recent Patients + Ayurveda Insight */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Recent Patients */}
        <Card>
          <CardHeader>
            <CardTitle>Recent Patients</CardTitle>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setScreen("intake")}
            >
              View all
            </Button>
          </CardHeader>
          {recentPatients.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <Stethoscope size={32} className="text-slate-200 mb-2" />
              <p className="text-sm text-slate-400">No patients yet</p>
              <p className="text-xs text-slate-300 mt-1">
                Start a Patient Intake session
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {recentPatients.map((patient) => (
                <div
                  key={patient.id}
                  className="flex items-center gap-3 rounded-xl bg-slate-50 p-3 hover:bg-slate-100 transition-colors"
                >
                  <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-violet-100 to-indigo-100 text-sm font-bold text-violet-600">
                    {patient.name?.[0]?.toUpperCase() || "?"}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-700 truncate">
                      {patient.name || "Unknown"}
                    </p>
                    <p className="text-xs text-slate-400 truncate">
                      {patient.chiefComplaint || "No complaint recorded"}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    {patient.redFlags.length > 0 && (
                      <Badge variant="emergency">🚨 Red Flag</Badge>
                    )}
                    {patient.dosha && (
                      <span
                        className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full capitalize ${
                          DOSHA_COLORS[patient.dosha.split("-")[0]] ||
                          "bg-violet-100 text-violet-600"
                        }`}
                      >
                        {patient.dosha}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Ayurveda Daily Wisdom */}
        <Card className="relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-amber-50 via-orange-50 to-yellow-50 opacity-60" />
          <div className="relative z-10">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Leaf size={16} className="text-emerald-600" />
                Ayurveda Insight
              </CardTitle>
              <Badge variant="dosha">Daily</Badge>
            </CardHeader>

            <div className="space-y-4">
              <div className="rounded-xl bg-white/70 p-4 border border-amber-100">
                <p className="text-sm font-semibold text-amber-800 mb-1">
                  🌿 Today's Dosha Focus
                </p>
                <p className="text-xs text-slate-600">{getDoshaTip()}</p>
              </div>

              <div className="grid grid-cols-3 gap-2">
                {["Vata", "Pitta", "Kapha"].map((d) => (
                  <div
                    key={d}
                    className="rounded-xl bg-white/60 p-2 text-center border border-white"
                  >
                    <p className="text-lg">
                      {d === "Vata" ? "💨" : d === "Pitta" ? "🔥" : "🌊"}
                    </p>
                    <p className="text-xs font-medium text-slate-600">{d}</p>
                    <p className="text-[10px] text-slate-400">
                      {d === "Vata"
                        ? "Air+Space"
                        : d === "Pitta"
                          ? "Fire+Water"
                          : "Earth+Water"}
                    </p>
                  </div>
                ))}
              </div>

              <div className="flex items-center gap-2 text-xs text-slate-500">
                <Calendar size={12} />
                <span>
                  {new Date().toLocaleDateString("en-IN", {
                    month: "long",
                    day: "numeric",
                  })}{" "}
                  — {getRituSeason()}
                </span>
              </div>
            </div>
          </div>
        </Card>
      </div>

      {/* Notifications */}
      {activeNotifications.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Recent Alerts</CardTitle>
            <Badge variant="warning">{activeNotifications.length}</Badge>
          </CardHeader>
          <div className="space-y-2">
            {activeNotifications.slice(0, 4).map((n) => (
              <div
                key={n.id}
                className={`flex items-start gap-3 rounded-xl p-3 text-sm ${
                  n.type === "error"
                    ? "bg-red-50 border border-red-100"
                    : n.type === "warning"
                      ? "bg-amber-50 border border-amber-100"
                      : "bg-slate-50 border border-slate-100"
                }`}
              >
                <span>
                  {n.type === "error"
                    ? "🚨"
                    : n.type === "warning"
                      ? "⚠️"
                      : "ℹ️"}
                </span>
                <div>
                  <p className="font-medium text-slate-700">{n.title}</p>
                  <p className="text-xs text-slate-500 mt-0.5">{n.message}</p>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return "Morning 🌅";
  if (h < 17) return "Afternoon ☀️";
  return "Evening 🌙";
}

function getDoshaTip() {
  const tips = [
    "Vata season: Warm, oily foods like sesame and ghee help ground excess air. Favor routine and rest.",
    "Pitta pacification: Avoid spicy food and direct sun. Coconut water and coriander are cooling.",
    "Kapha balance: Light, warm foods and vigorous exercise prevent stagnation. Ginger tea is excellent.",
    "Tridosha balance: A walk in nature, sattvic food, and meditation benefit all constitutions today.",
  ];
  return tips[new Date().getDay() % tips.length];
}

function getRituSeason() {
  const month = new Date().getMonth();
  if (month >= 2 && month <= 3) return "Vasanta Ritu (Spring)";
  if (month >= 4 && month <= 5) return "Grishma Ritu (Summer)";
  if (month >= 6 && month <= 7) return "Varsha Ritu (Monsoon)";
  if (month >= 8 && month <= 9) return "Sharad Ritu (Autumn)";
  if (month >= 10 && month <= 11) return "Hemanta Ritu (Early Winter)";
  return "Shishira Ritu (Late Winter)";
}
