import {
  LayoutDashboard,
  UserPlus,
  Mic2,
  Settings,
  Leaf,
  Stethoscope,
  ChevronLeft,
  ChevronRight,
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
  const {
    currentScreen,
    setScreen,
    intakeList,
    dictationList,
    sidebarCollapsed,
    setSidebarCollapsed,
  } = useAppStore();

  return (
    <aside
      className={`flex h-full flex-col border-r border-slate-100 bg-white transition-all duration-300 ease-in-out ${sidebarCollapsed ? "w-20" : "w-64"}`}
    >
      {/* Logo */}
      <div className="flex items-center gap-3 px-5 py-5 border-b border-slate-100">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 shadow-md shadow-blue-200">
          <Leaf size={18} className="text-white" />
        </div>
        <div className={`${sidebarCollapsed ? "hidden" : "block"}`}>
          <p className="text-sm font-bold text-slate-800">OPD Intelligence</p>
          <p className="text-[10px] text-slate-400 uppercase tracking-wider">
            Ayurveda AI
          </p>
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
                ? "bg-blue-50 text-blue-700"
                : "text-slate-500 hover:bg-slate-50 hover:text-slate-700",
            )}
          >
            <span
              className={cn(
                "flex h-9 w-9 items-center justify-center rounded-lg transition-all",
                currentScreen === item.id
                  ? "bg-blue-100 text-blue-600"
                  : "bg-slate-100 text-slate-400 group-hover:bg-slate-200",
              )}
            >
              {item.icon}
            </span>
            <div
              className={`${sidebarCollapsed ? "hidden" : "block"} flex-1 min-w-0`}
            >
              <p className="text-sm font-medium leading-none">{item.label}</p>
              {item.sub && (
                <p className="text-[10px] text-slate-400 mt-0.5 leading-none">
                  {item.sub}
                </p>
              )}
            </div>
            {!sidebarCollapsed &&
              item.id === "intake" &&
              intakeList.length > 0 && (
                <span className="text-[10px] font-bold rounded-full bg-blue-100 text-blue-600 px-1.5 py-0.5">
                  {intakeList.length}
                </span>
              )}
            {!sidebarCollapsed &&
              item.id === "dictation" &&
              dictationList.length > 0 && (
                <span className="text-[10px] font-bold rounded-full bg-blue-100 text-blue-600 px-1.5 py-0.5">
                  {dictationList.length}
                </span>
              )}
          </button>
        ))}
      </nav>

      {/* Toggle Button */}
      <button
        onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
        className="absolute -right-3 top-1/2 -translate-y-1/2 h-8 w-8 rounded-full flex items-center justify-center bg-blue-50 hover:bg-blue-100 text-blue-600 transition-all duration-200 z-20"
      >
        {sidebarCollapsed ? (
          <ChevronRight size={18} />
        ) : (
          <ChevronLeft size={18} />
        )}
      </button>
    </aside>
  );
}
