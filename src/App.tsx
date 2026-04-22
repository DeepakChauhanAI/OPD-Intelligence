import { useAppStore } from "./store/useAppStore";
import { Sidebar } from "./components/Sidebar";
import { NotificationToast } from "./components/NotificationToast";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { Dashboard } from "./screens/Dashboard";
import { PatientIntakeScreen } from "./screens/PatientIntake";
import { DoctorDictationScreen } from "./screens/DoctorDictation";
import { VisitCheckinScreen } from "./screens/VisitCheckinScreen";
import { SettingsScreen } from "./screens/Settings";

function ScreenRenderer() {
  const { currentScreen } = useAppStore();
  switch (currentScreen) {
    case "dashboard":
      return <Dashboard />;
    case "intake":
      return <PatientIntakeScreen />;
    case "dictation":
      return <DoctorDictationScreen />;
    case "visit_checkin":
      return <VisitCheckinScreen />;
    case "settings":
      return <SettingsScreen />;
    default:
      return <Dashboard />;
  }
}

export default function App() {
  return (
    <ErrorBoundary>
      <div className="flex h-screen overflow-hidden bg-slate-50 font-sans antialiased">
        {/* Sidebar */}
        <Sidebar />

        {/* Main Content */}
        <main className="flex-1 overflow-y-auto">
          {/* Top bar */}
          <div className="sticky top-0 z-10 flex h-14 items-center justify-between border-b border-slate-100 bg-white/80 backdrop-blur-sm px-6">
            <ScreenTitle />
            <div className="flex items-center gap-3 text-xs text-slate-400">
              <span className="hidden sm:block">OPD Intelligence v1.0</span>
              <div className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              <span>Ayurveda AI</span>
            </div>
          </div>

          {/* Page content */}
          <div className="p-6">
            <ScreenRenderer />
          </div>
        </main>

        {/* Global notifications */}
        <NotificationToast />
      </div>
    </ErrorBoundary>
  );
}

function ScreenTitle() {
  const { currentScreen } = useAppStore();
  const titles: Record<string, string> = {
    dashboard: "🏥 OPD Dashboard",
    intake: "👤 Patient Intake",
    dictation: "🎙️ Doctor Dictation",
    visit_checkin: "📋 Visit Check-in",
    settings: "⚙️ Settings",
  };
  return (
    <h2 className="text-sm font-semibold text-slate-600">
      {titles[currentScreen] || "OPD Intelligence"}
    </h2>
  );
}
