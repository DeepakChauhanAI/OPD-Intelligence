import {
  LayoutDashboard,
  UserPlus,
  Mic2,
  Settings,
  Activity,
  Leaf,
  Stethoscope,
} from "lucide-react";
import { cn } from "../utils/cn";
import type { Screen } from "../types";
import { useAppStore } from "../store/useAppStore";

const navItems: {
  id: Screen;
  label: string;
  icon: React.ReactNode;
  sub?: string;
}[] = [
  {
    id: "dashboard",
    label: "Dashboard",
    icon: <LayoutDashboard size={18} />,
    sub: "Overview",
  },
  {
    id: "intake",
    label: "Patient Intake",
    icon: <UserPlus size={18} />,
    sub: "Voice AI",
  },
  {
    id: "dictation",
    label: "Dr. Dictation",
    icon: <Mic2 size={18} />,
    sub: "Voice Notes",
  },
  {
    id: "visit_checkin",
    label: "Visit Check-in",
    icon: <Stethoscope size={18} />,
    sub: "Adherence",
  },
  {
    id: "settings",
    label: "Settings",
    icon: <Settings size={18} />,
    sub: "API & Config",
  },
];

export function Sidebar() {
  const { currentScreen, setScreen, sessionStatus, intakeList, dictationList } =
    useAppStore();

  return (
    <aside className="flex h-full w-64 flex-col border-r border-slate-100 bg-white">
      {/* Logo */}
      <div className="flex items-center gap-3 px-5 py-5 border-b border-slate-100">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-indigo-600 shadow-md shadow-violet-200">
          <Leaf size={18} className="text-white" />
        </div>
        <div>
          <p className="text-sm font-bold text-slate-800">OPD Intelligence</p>
          <p className="text-[10px] text-slate-400 uppercase tracking-wider">
            Ayurveda AI
          </p>
        </div>
      </div>

      {/* Live status pill */}
      <div className="px-4 py-3">
        <div
          className={cn(
            "flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-medium transition-all",
            sessionStatus === "connected" || sessionStatus === "recording"
              ? "bg-emerald-50 text-emerald-700"
              : sessionStatus === "error"
                ? "bg-red-50 text-red-600"
                : "bg-slate-50 text-slate-500",
          )}
        >
          <Activity size={13} />
          <span className="capitalize">Voice: {sessionStatus}</span>
          <span
            className={cn(
              "ml-auto h-2 w-2 rounded-full",
              sessionStatus === "recording"
                ? "bg-red-500 animate-pulse"
                : sessionStatus === "connected"
                  ? "bg-emerald-500"
                  : sessionStatus === "processing" ||
                      sessionStatus === "connecting"
                    ? "bg-amber-400 animate-pulse"
                    : "bg-slate-300",
            )}
          />
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-1 px-3 py-2">
        {navItems.map((item) => (
          <button
            key={item.id}
            onClick={() => setScreen(item.id)}
            className={cn(
              "group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-all",
              currentScreen === item.id
                ? "bg-violet-50 text-violet-700"
                : "text-slate-500 hover:bg-slate-50 hover:text-slate-700",
            )}
          >
            <span
              className={cn(
                "flex h-8 w-8 items-center justify-center rounded-lg transition-all",
                currentScreen === item.id
                  ? "bg-violet-100 text-violet-600"
                  : "bg-slate-100 text-slate-400 group-hover:bg-slate-200",
              )}
            >
              {item.icon}
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium leading-none">{item.label}</p>
              {item.sub && (
                <p className="text-[10px] text-slate-400 mt-0.5 leading-none">
                  {item.sub}
                </p>
              )}
            </div>
            {item.id === "intake" && intakeList.length > 0 && (
              <span className="text-[10px] font-bold rounded-full bg-violet-100 text-violet-600 px-1.5 py-0.5">
                {intakeList.length}
              </span>
            )}
            {item.id === "dictation" && dictationList.length > 0 && (
              <span className="text-[10px] font-bold rounded-full bg-violet-100 text-violet-600 px-1.5 py-0.5">
                {dictationList.length}
              </span>
            )}
          </button>
        ))}
      </nav>

      {/* Footer */}
      <div className="p-4 border-t border-slate-100">
        <div className="rounded-xl bg-gradient-to-br from-violet-50 to-indigo-50 p-3 text-center">
          <p className="text-xs font-semibold text-violet-700">
            Gemini 2.5 Flash
          </p>
          <p className="text-[10px] text-violet-400 mt-0.5">
            Powered by Google AI
          </p>
        </div>
      </div>
    </aside>
  );
}
