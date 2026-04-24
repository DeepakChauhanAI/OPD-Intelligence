/**
 * PatientSelector Component
 * Shows "New Patient" vs "Existing Patient" selection before intake/dictation.
 * Fetches patient list from backend API.
 */

import { useState, useEffect } from "react";
import { UserPlus, Users, Search, ChevronRight, ArrowLeft } from "lucide-react";
import { Card, CardHeader, CardTitle } from "./ui/Card";
import { Button } from "./ui/Button";
import { useAppStore } from "../store/useAppStore";
import type { SelectedPatient } from "../types";

interface PatientSelectorProps {
  title: string;
  subtitle: string;
  onSelect: (patient: SelectedPatient) => void;
}

export function PatientSelector({
  title,
  subtitle,
  onSelect,
}: PatientSelectorProps) {
  const { backendPatients, intakeList, fetchPatients } = useAppStore();
  const [mode, setMode] = useState<"choose" | "list">("choose");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [newPatientName, setNewPatientName] = useState("");
  const [showNewForm, setShowNewForm] = useState(false);

  // Merge backend patients with local intake list for comprehensive list
  const allPatients = (() => {
    const map = new Map<
      string,
      {
        id: string;
        name: string;
        age?: number | null;
        gender?: string | null;
        chiefComplaint?: string;
      }
    >();

    // Backend patients first (authoritative)
    for (const p of backendPatients) {
      map.set(p.id, {
        id: p.id,
        name: p.name,
        age: p.age,
        gender: p.gender,
        chiefComplaint: p.chiefComplaint,
      });
    }

    // Then local intake list (may have patients not yet synced)
    for (const p of intakeList) {
      if (!map.has(p.id) && !map.has(p.patientId || "")) {
        map.set(p.id, {
          id: p.id,
          name: p.name,
          age: p.age,
          gender: p.gender,
          chiefComplaint: p.chiefComplaint,
        });
      }
    }

    return Array.from(map.values());
  })();

  const filtered = allPatients.filter((p) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      p.name.toLowerCase().includes(q) ||
      (p.chiefComplaint || "").toLowerCase().includes(q)
    );
  });

  useEffect(() => {
    setLoading(true);
    fetchPatients().finally(() => setLoading(false));
  }, []);

  const handleNewPatient = () => {
    if (!newPatientName.trim()) return;
    const patient: SelectedPatient = {
      id: `patient-${Date.now()}`,
      name: newPatientName.trim(),
      isNew: true,
    };
    onSelect(patient);
  };

  const handleExistingPatient = (p: (typeof allPatients)[0]) => {
    const patient: SelectedPatient = {
      id: p.id,
      name: p.name,
      age: p.age,
      gender: p.gender,
      chiefComplaint: p.chiefComplaint,
      isNew: false,
    };
    onSelect(patient);
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-800">{title}</h1>
        <p className="text-sm text-slate-500 mt-0.5">{subtitle}</p>
      </div>

      {mode === "choose" && !showNewForm && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-lg">
          {/* New Patient */}
          <button
            onClick={() => setShowNewForm(true)}
            className="group flex flex-col items-center gap-4 rounded-2xl border-2 border-dashed border-emerald-200 bg-emerald-50/50 p-8 transition-all hover:border-emerald-400 hover:bg-emerald-50 hover:shadow-lg"
          >
            <div className="h-14 w-14 rounded-2xl bg-emerald-100 flex items-center justify-center text-emerald-600 group-hover:scale-110 transition-transform">
              <UserPlus size={28} />
            </div>
            <div className="text-center">
              <p className="text-base font-bold text-slate-800">New Patient</p>
              <p className="text-xs text-slate-500 mt-1">
                Start a fresh intake
              </p>
            </div>
          </button>

          {/* Existing Patient */}
          <button
            onClick={() => setMode("list")}
            className="group flex flex-col items-center gap-4 rounded-2xl border-2 border-dashed border-violet-200 bg-violet-50/50 p-8 transition-all hover:border-violet-400 hover:bg-violet-50 hover:shadow-lg"
          >
            <div className="h-14 w-14 rounded-2xl bg-violet-100 flex items-center justify-center text-violet-600 group-hover:scale-110 transition-transform">
              <Users size={28} />
            </div>
            <div className="text-center">
              <p className="text-base font-bold text-slate-800">
                Existing Patient
              </p>
              <p className="text-xs text-slate-500 mt-1">
                {allPatients.length} patient
                {allPatients.length !== 1 ? "s" : ""} on record
              </p>
            </div>
          </button>
        </div>
      )}

      {/* New Patient Form */}
      {showNewForm && (
        <Card className="max-w-md animate-fade-in">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <UserPlus size={16} className="text-emerald-600" />
              New Patient
            </CardTitle>
          </CardHeader>
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1.5">
                Patient Name *
              </label>
              <input
                type="text"
                value={newPatientName}
                onChange={(e) => setNewPatientName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleNewPatient()}
                placeholder="Enter patient name"
                className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-300"
                autoFocus
              />
            </div>
            <div className="flex gap-2">
              <Button
                onClick={handleNewPatient}
                icon={<ChevronRight size={14} />}
                className="flex-1"
              >
                Start Intake
              </Button>
              <Button
                variant="ghost"
                onClick={() => setShowNewForm(false)}
                icon={<ArrowLeft size={14} />}
              >
                Back
              </Button>
            </div>
          </div>
        </Card>
      )}

      {/* Existing Patient List */}
      {mode === "list" && (
        <div className="space-y-4 max-w-lg animate-fade-in">
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setMode("choose")}
              icon={<ArrowLeft size={14} />}
            >
              Back
            </Button>
            <h2 className="text-lg font-semibold text-slate-800">
              Select Patient
            </h2>
          </div>

          {/* Search */}
          <div className="relative">
            <Search
              size={16}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
            />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name or complaint..."
              className="w-full rounded-xl border border-slate-200 pl-10 pr-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300"
              autoFocus
            />
          </div>

          {/* Patient List */}
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <div className="h-8 w-8 animate-spin rounded-full border-4 border-violet-200 border-t-violet-600" />
            </div>
          ) : filtered.length === 0 ? (
            <Card className="text-center py-8">
              <Users size={32} className="text-slate-200 mx-auto mb-2" />
              <p className="text-sm text-slate-500">
                {search
                  ? "No patients match your search"
                  : "No patients on record yet"}
              </p>
              <Button
                variant="secondary"
                size="sm"
                className="mt-3"
                onClick={() => {
                  setMode("choose");
                  setShowNewForm(true);
                }}
              >
                Add New Patient
              </Button>
            </Card>
          ) : (
            <div className="space-y-2 max-h-[400px] overflow-y-auto">
              {filtered.map((p) => (
                <button
                  key={p.id}
                  onClick={() => handleExistingPatient(p)}
                  className="w-full flex items-center gap-3 rounded-xl border border-slate-100 bg-white p-3.5 text-left transition-all hover:border-violet-300 hover:bg-violet-50 hover:shadow-sm"
                >
                  <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-violet-100 to-indigo-100 flex items-center justify-center text-violet-600 font-bold text-sm shrink-0">
                    {p.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-slate-800 truncate">
                      {p.name}
                    </p>
                    <div className="flex items-center gap-2 mt-0.5">
                      {p.age && (
                        <span className="text-xs text-slate-400">{p.age}y</span>
                      )}
                      {p.gender && (
                        <span className="text-xs text-slate-400 capitalize">
                          {p.gender}
                        </span>
                      )}
                      {p.chiefComplaint && (
                        <span className="text-xs text-slate-500 truncate">
                          — {p.chiefComplaint}
                        </span>
                      )}
                    </div>
                  </div>
                  <ChevronRight size={16} className="text-slate-300 shrink-0" />
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
