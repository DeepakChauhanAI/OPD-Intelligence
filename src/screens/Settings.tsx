/**
 * Settings Screen
 * API key config, voice mode, language, WS endpoint
 */

import { useState } from "react";
import {
  Settings as SettingsIcon,
  Save,
  Wifi,
  Mic,
  Volume2,
  Globe,
} from "lucide-react";
import { Card, CardHeader, CardTitle } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Badge } from "../components/ui/Badge";
import { useAppStore } from "../store/useAppStore";
import type { Language } from "../types";

export function SettingsScreen() {
  const { settings, updateSettings, addNotification } = useAppStore();
  const [localSettings, setLocalSettings] = useState({ ...settings });
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<"idle" | "success" | "error">(
    "idle",
  );

  const handleSave = () => {
    updateSettings(localSettings);
    addNotification({
      type: "success",
      title: "Settings Saved",
      message: "Configuration updated successfully.",
    });
  };

  const handleTestBackend = async () => {
    setTesting(true);
    setTestResult("idle");
    try {
      const res = await fetch("/api/health");
      if (res.ok) {
        setTestResult("success");
        addNotification({
          type: "success",
          title: "Backend Connected",
          message: "FastAPI backend is online.",
        });
      } else {
        setTestResult("error");
        addNotification({
          type: "error",
          title: "Backend Error",
          message: `Status: ${res.status}`,
        });
      }
    } catch (err) {
      setTestResult("error");
      addNotification({
        type: "error",
        title: "Connection Error",
        message:
          "Cannot reach backend at localhost:8000. Is the server running?",
      });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="space-y-6 max-w-2xl">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-800">Settings</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          Configure AI, voice, and language preferences
        </p>
      </div>

      {/* Backend Status */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <div className="h-7 w-7 rounded-lg bg-violet-50 flex items-center justify-center">
              <SettingsIcon size={14} className="text-violet-600" />
            </div>
            Backend Server
          </CardTitle>
          <Badge
            variant={
              testResult === "success"
                ? "success"
                : testResult === "error"
                  ? "error"
                  : "info"
            }
          >
            {testResult === "success"
              ? "Connected"
              : testResult === "error"
                ? "Error"
                : "Not Tested"}
          </Badge>
        </CardHeader>

        <div className="space-y-4">
          <div className="flex items-center gap-3 rounded-xl bg-violet-50 p-3 border border-violet-100">
            <div className="h-8 w-8 rounded-lg bg-violet-100 flex items-center justify-center">
              <span className="text-sm">🤖</span>
            </div>
            <div>
              <p className="text-sm font-semibold text-violet-800">
                gemini-2.5-flash (via Backend)
              </p>
              <p className="text-xs text-violet-500">
                All API calls proxied through FastAPI · Key secured server-side
              </p>
            </div>
          </div>
          <Button
            size="sm"
            variant="secondary"
            onClick={handleTestBackend}
            className={testing ? "opacity-50" : ""}
          >
            {testing ? "Testing..." : "Test Connection"}
          </Button>
        </div>
      </Card>

      {/* WebSocket Bridge */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <div className="h-7 w-7 rounded-lg bg-sky-50 flex items-center justify-center">
              <Wifi size={14} className="text-sky-600" />
            </div>
            WebSocket Voice Bridge
          </CardTitle>
          <Badge variant="success">Backend</Badge>
        </CardHeader>

        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1.5">
              WS Endpoint
            </label>
            <input
              type="url"
              value={localSettings.wsEndpoint}
              onChange={(e) =>
                setLocalSettings((s) => ({ ...s, wsEndpoint: e.target.value }))
              }
              placeholder="ws://localhost:8000/ws/voice"
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300"
            />
            <p className="text-xs text-slate-400 mt-1.5">
              Voice bridge powered by FastAPI backend. Audio is relayed to
              Gemini Live API server-side.
            </p>
          </div>
        </div>
      </Card>

      {/* Voice Settings */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <div className="h-7 w-7 rounded-lg bg-rose-50 flex items-center justify-center">
              <Mic size={14} className="text-rose-600" />
            </div>
            Voice Settings
          </CardTitle>
        </CardHeader>

        <div className="space-y-4">
          {/* Mode info */}
          <div className="rounded-xl border border-slate-200 p-3 bg-slate-50">
            <div className="flex items-center gap-3">
              <Mic size={16} className="text-violet-500" />
              <div>
                <p className="text-sm font-medium text-slate-700">
                  Continuous Voice Mode
                </p>
                <p className="text-xs text-slate-400">
                  Always listening. Speak naturally, AI responds when you stop.
                </p>
              </div>
            </div>
          </div>

          {/* Auto-speak */}
          <div className="flex items-center justify-between rounded-xl border border-slate-200 p-3">
            <div className="flex items-center gap-3">
              <Volume2 size={16} className="text-slate-500" />
              <div>
                <p className="text-sm font-medium text-slate-700">
                  Auto-speak responses
                </p>
                <p className="text-xs text-slate-400">
                  AI reads answers aloud via TTS
                </p>
              </div>
            </div>
            <button
              onClick={() =>
                setLocalSettings((s) => ({ ...s, autoSpeak: !s.autoSpeak }))
              }
              className={`relative h-6 w-11 rounded-full transition-colors ${localSettings.autoSpeak ? "bg-violet-500" : "bg-slate-200"
                }`}
            >
              <span
                className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${localSettings.autoSpeak ? "translate-x-5" : "translate-x-0.5"
                  }`}
              />
            </button>
          </div>

          {/* Interrupt mode */}
          <div className="flex items-center justify-between rounded-xl border border-slate-200 p-3">
            <div className="flex items-center gap-3">
              <Mic size={16} className="text-slate-500" />
              <div>
                <p className="text-sm font-medium text-slate-700">
                  Interrupt on new input
                </p>
                <p className="text-xs text-slate-400">
                  Stop AI speech when you start speaking
                </p>
              </div>
            </div>
            <button
              onClick={() =>
                setLocalSettings((s) => ({
                  ...s,
                  interruptMode: !s.interruptMode,
                }))
              }
              className={`relative h-6 w-11 rounded-full transition-colors ${localSettings.interruptMode ? "bg-violet-500" : "bg-slate-200"
                }`}
            >
              <span
                className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${localSettings.interruptMode
                  ? "translate-x-5"
                  : "translate-x-0.5"
                  }`}
              />
            </button>
          </div>
        </div>
      </Card>

      {/* Language */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <div className="h-7 w-7 rounded-lg bg-emerald-50 flex items-center justify-center">
              <Globe size={14} className="text-emerald-600" />
            </div>
            Language
          </CardTitle>
        </CardHeader>

        <div className="grid grid-cols-3 gap-2">
          {(
            [
              { id: "en", label: "English", flag: "GB", sub: "Standard" },
              { id: "hi", label: "हिंदी", flag: "🇮🇳", sub: "Hindi" },
              {
                id: "hinglish",
                label: "Hinglish",
                flag: "🔤",
                sub: "Hindi + English",
              },
            ] as { id: Language; label: string; flag: string; sub: string }[]
          ).map((lang) => (
            <button
              key={lang.id}
              onClick={() =>
                setLocalSettings((s) => ({ ...s, language: lang.id }))
              }
              className={`rounded-xl border-2 p-3 text-center transition-all ${localSettings.language === lang.id
                ? "border-emerald-400 bg-emerald-50"
                : "border-slate-200 hover:border-slate-300"
                }`}
            >
              <p className="text-2xl mb-1">{lang.flag}</p>
              <p className="text-sm font-semibold text-slate-700">
                {lang.label}
              </p>
              <p className="text-[10px] text-slate-400">{lang.sub}</p>
            </button>
          ))}
        </div>
      </Card>

      {/* Save */}
      <Button
        size="lg"
        onClick={handleSave}
        icon={<Save size={16} />}
        className="w-full"
      >
        Save Settings
      </Button>

      {/* System Architecture Info */}
      <Card>
        <CardHeader>
          <CardTitle>System Architecture</CardTitle>
          <Badge variant="success">v2 — Backend</Badge>
        </CardHeader>
        <div className="space-y-3 text-sm">
          <div className="rounded-xl bg-slate-50 p-4 font-mono text-xs text-slate-600">
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-violet-500">Browser</span>
                <span className="text-slate-300">→</span>
                <span className="text-sky-500">AudioWorklet</span>
                <span className="text-slate-300">→</span>
                <span className="text-emerald-500">FastAPI WS Bridge</span>
                <span className="text-slate-300">→</span>
                <span className="text-amber-500">Gemini Live</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-violet-500">Browser</span>
                <span className="text-slate-300">→</span>
                <span className="text-sky-500">REST API</span>
                <span className="text-slate-300">→</span>
                <span className="text-emerald-500">FastAPI</span>
                <span className="text-slate-300">→</span>
                <span className="text-amber-500">Gemini Text</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-violet-500">Storage</span>
                <span className="text-slate-300">→</span>
                <span className="text-sky-500">SQLite</span>
                <span className="text-slate-300">+</span>
                <span className="text-red-500">Zod Validation</span>
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs text-slate-500">
            <div className="rounded-xl bg-slate-50 p-2.5">
              <p className="font-semibold text-slate-700">Voice</p>
              <p>Gemini 2.5 Flash Native Audio</p>
            </div>
            <div className="rounded-xl bg-slate-50 p-2.5">
              <p className="font-semibold text-slate-700">Text/Extract</p>
              <p>Gemini 2.5 Flash (via Backend)</p>
            </div>
            <div className="rounded-xl bg-slate-50 p-2.5">
              <p className="font-semibold text-slate-700">STT Fallback</p>
              <p>Browser WebSpeech API</p>
            </div>
            <div className="rounded-xl bg-slate-50 p-2.5">
              <p className="font-semibold text-slate-700">Database</p>
              <p>SQLite (server-side)</p>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}
