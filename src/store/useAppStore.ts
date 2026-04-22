import { create } from "zustand";
import type {
  Screen,
  AppSettings,
  SessionStatus,
  PatientIntake,
  DictationEntry,
  DailyCheckin,
  AppNotification,
  SelectedPatient,
} from "../types";

// ─── State Shape ──────────────────────────────────────────────────────────────

interface AppState {
  // Navigation
  currentScreen: Screen;
  setScreen: (s: Screen) => void;

  // Settings
  settings: AppSettings;
  updateSettings: (s: Partial<AppSettings>) => void;

  // Voice session
  sessionStatus: SessionStatus;
  setSessionStatus: (s: SessionStatus) => void;
  partialTranscript: string;
  setPartialTranscript: (t: string) => void;

  // Patient selection
  selectedPatient: SelectedPatient | null;
  setSelectedPatient: (p: SelectedPatient | null) => void;

  // Patient Intake
  intakeList: PatientIntake[];
  addIntake: (intake: PatientIntake) => void;
  updateIntake: (id: string, update: Partial<PatientIntake>) => void;

  // Dictation
  dictationList: DictationEntry[];
  addDictation: (entry: DictationEntry) => void;
  updateDictation: (id: string, update: Partial<DictationEntry>) => void;

  // Check-in
  checkinList: DailyCheckin[];
  addCheckin: (checkin: DailyCheckin) => void;

  // Notifications
  notifications: AppNotification[];
  addNotification: (n: Omit<AppNotification, "id" | "timestamp">) => void;
  dismissNotification: (id: string) => void;

  // Emergency
  emergencyAlert: { reason: string; action: string } | null;
  setEmergencyAlert: (alert: { reason: string; action: string } | null) => void;

  // Backend patients (fetched from API)
  backendPatients: PatientIntake[];
  setBackendPatients: (patients: PatientIntake[]) => void;
  fetchPatients: () => Promise<void>;
}

// ─── Default Settings ─────────────────────────────────────────────────────────

const defaultSettings: AppSettings = {
  apiKey: (import.meta as any).env?.VITE_GEMINI_API_KEY || "",
  wsEndpoint: "ws://localhost:8000/ws/voice",
  language: "hinglish",
  autoSpeak: true,
  interruptMode: true,
};

// ─── Store ────────────────────────────────────────────────────────────────────

export const useAppStore = create<AppState>((set, _get) => ({
  // Navigation
  currentScreen: "dashboard",
  setScreen: (s) => {
    set({ currentScreen: s, selectedPatient: null });
  },

  // Settings
  settings: defaultSettings,
  updateSettings: (partial) =>
    set((state) => ({
      settings: { ...state.settings, ...partial },
    })),

  // Voice session
  sessionStatus: "idle",
  setSessionStatus: (s) => set({ sessionStatus: s }),
  partialTranscript: "",
  setPartialTranscript: (t) => set({ partialTranscript: t }),

  // Patient selection
  selectedPatient: null,
  setSelectedPatient: (p) => set({ selectedPatient: p }),

  // Patient Intake
  intakeList: [],
  addIntake: (intake) =>
    set((state) => ({
      intakeList: [intake, ...state.intakeList],
    })),
  updateIntake: (id, update) =>
    set((state) => ({
      intakeList: state.intakeList.map((i) =>
        i.id === id ? { ...i, ...update } : i,
      ),
    })),

  // Dictation
  dictationList: [],
  addDictation: (entry) =>
    set((state) => ({
      dictationList: [entry, ...state.dictationList],
    })),
  updateDictation: (id, update) =>
    set((state) => ({
      dictationList: state.dictationList.map((d) =>
        d.id === id ? { ...d, ...update } : d,
      ),
    })),

  // Check-in
  checkinList: [],
  addCheckin: (checkin) =>
    set((state) => ({
      checkinList: [checkin, ...state.checkinList],
    })),

  // Notifications
  notifications: [],
  addNotification: (n) => {
    const notification: AppNotification = {
      ...n,
      id: `notif-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      timestamp: new Date().toISOString(),
    };
    set((state) => ({
      notifications: [notification, ...state.notifications].slice(0, 20),
    }));

    // Auto-dismiss after 5s
    setTimeout(() => {
      set((state) => ({
        notifications: state.notifications.filter(
          (item) => item.id !== notification.id,
        ),
      }));
    }, 5000);
  },
  dismissNotification: (id) =>
    set((state) => ({
      notifications: state.notifications.filter((n) => n.id !== id),
    })),

  // Emergency
  emergencyAlert: null,
  setEmergencyAlert: (alert) => set({ emergencyAlert: alert }),

  // Backend patients
  backendPatients: [],
  setBackendPatients: (patients) => set({ backendPatients: patients }),
  fetchPatients: async () => {
    try {
      const res = await fetch("/api/patients");
      if (res.ok) {
        const data = await res.json();
        set({ backendPatients: data.patients || [] });
      }
    } catch (err) {
      console.warn("Failed to fetch patients from backend:", err);
    }
  },
}));
