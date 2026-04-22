# Ayurveda OPD Voice Agent 🌿

A cutting-edge, voice-driven AI assistant designed specifically for Ayurvedic Outpatient Departments (OPD). This application seamlessly digitizes patient workflows, clinical intakes, and doctor dictations using real-time conversational AI powered by the **Gemini Multimodal Live API**.

---

## 📋 Table of Contents

- [Overview](#overview)
- [Key Features](#key-features)
- [System Architecture](#system-architecture)
- [Project Structure](#project-structure)
- [Database Schema](#database-schema)
- [API Reference](#api-reference)
- [WebSocket Protocol](#websocket-protocol)
- [Type Definitions](#type-definitions)
- [Getting Started](#getting-started)
- [Usage Workflow](#usage-workflow)
- [Development](#development)
- [Testing & Validation](#testing--validation)
- [Troubleshooting](#troubleshooting)
- [Security Considerations](#security-considerations)
- [Performance](#performance)
- [Limitations & Future Work](#limitations--future-work)
- [Contributing](#contributing)
- [License](#license)

---

## 📖 Overview

This is a production-grade voice-enabled healthcare assistant that automates the complete OPD patient intake and clinical documentation workflow for Ayurvedic practitioners. Built with a modern decoupled architecture, it combines real-time WebSocket audio streaming with LLM-powered data extraction.

### Problem Statement

Traditional OPD workflows rely on manual note-taking, leading to:

- Incomplete patient histories
- Time-consuming documentation
- Delayed clinical decisions
- Inconsistent data quality

### Solution

Voice-first patient interaction that automatically:

- Captures chief complaints, symptoms, and medical history
- Extracts structured clinical data in real-time
- Formats doctor dictation into standardized notes
- Tracks patient progress between visits
- Persists everything to a SQLite database with zero configuration

### Target Use Case

Ayurvedic clinics and hospitals seeking to digitize their outpatient workflow while maintaining natural doctor-patient interaction through voice technology.

---

## 🌟 Key Features

### 1. Intelligent Patient Intake

Automated conversational flow that conducts structured patient interviews:

- **Symptom Exploration:** Onset, location, duration, character, aggravating/relieving factors, timing, severity (0-10 scale)
- **Dosha Assessment:** Brief Prakriti (body constitution) evaluation through targeted questions
- **Medical History:** Existing conditions, current medications, allergies
- **Red Flag Detection:** Automatic identification of emergency symptoms (chest pain, unconsciousness, severe bleeding, etc.)
- **Ayurvedic Analysis:** Probable dosha imbalances, suggested herbs, lifestyle recommendations

**Output:** Complete `PatientIntake` record stored in SQLite with structured JSON extraction.

### 2. Clinical Dictation & Structuring

Doctors speak naturally; the AI converts unstructured dictation into clinical notes:

- **History & Examination findings**
- **Diagnosis** section
- **Prescriptions** with structured medicine entries (name, dose, frequency, duration, route)
- **Follow-up Advice** and recommendations

**Processing:**

1. Local Web Speech API (`DictationEngine.ts`) provides real-time local transcription
2. Guaranteed Devanagari script output for Hindi/Hinglish with zero network latency
3. Full transcript sent to `/api/dictation/process` over standard HTTP
4. Gemini Flash rigorously extracts clinical structure into JSON schema
5. Saved to `dictations` table with editable Review UI and confirmation stage.

### 3. Daily Patient Check-ins

Remote wellness monitoring via structured questionnaires:

- Physicians define custom check-in questions (name, appetite, sleep, energy, digestion, etc.)
- Patients respond via voice or text
- AI analyzes responses and predicts status: `improving`, `stable`, `declining`, `needs_attention`
- Generates Ayurvedic recommendations based on current state

**Data Flow:** Responses → `/api/analyze-checkin` → Summary JSON stored in `checkins` table.

### 4. Multi-Language Support

Full support for three language modes:

- **English** (en-IN voice)
- **Hindi** (hi-IN voice)
- **Hinglish** (mixed, hi-IN voice)

Gemini Live adapts its conversation; extraction prompts include language-specific instructions. Frontend offers language toggle in Settings.

### 5. Enterprise-Grade Security

No client-side API key exposure:

- FastAPI backend holds all Google Gemini credentials
- WebSocket proxy (`/ws/voice`) handles all audio streaming
- REST endpoints process all LLM extraction server-side
- CORS configured for development flexibility
- SQLite database stored server-side, never exposed to browser

### 6. Seamless Data Persistence

All patient interactions saved automatically:

- **Patients** table stores core demographics and latest intake data
- **Intakes** table preserves full extraction history with raw transcripts
- **Dictations** table tracks all doctor recordings and structured notes
- **Checkins** table maintains daily wellness snapshots
- **Transcripts** table archives complete voice session logs

---

## 🏗️ System Architecture

### High-Level Design

```
┌───────────────────────────────────────────────────────────────────┐
│                         React Frontend                            │
│  (Thin client — no API keys, handles audio I/O, state via Zustand)│
└──────────────┬──────────────────────┬────────────────────────────┘
               │                      │
          WebSocket                HTTP REST
               │                      │
               ▼                      ▼
┌───────────────────────────────────────────────────────────────────┐
│                    FastAPI Backend Server                         │
│  ┌─────────────┐  ┌──────────────┐  ┌─────────────────────────┐ │
│  │ WebSocket   │  │ REST API     │  │ SQLite Database         │ │
│  │ Bridge      │  │ (LLM calls)  │  │ (opd_data.db)           │ │
│  └─────────────┘  └──────────────┘  └─────────────────────────┘ │
└──────────────┬──────────────────────┬────────────────────────────┘
               │                      │
               ▼                      ▼
┌───────────────────────────────────────────────────────────────────┐
│          Google Gemini Live API (Audio Streaming)                 │
│          Google Gemini Text API (Extraction)                      │
└───────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

#### Frontend (React + TypeScript)

- **Voice Capture:** Uses `MediaRecorder` API + `ScriptProcessor` to capture 16kHz PCM audio
- **Audio Playback:** Receives 24kHz PCM from Gemini, converts to float32, plays via `AudioContext`
- **WebSocket Management:** `voiceEngine.ts` handles bidirectional streaming
- **State Management:** Zustand store (`useAppStore.ts`) holds patients, intakes, dictations, checkins
- **UI Components:** 5 main screens (Dashboard, Intake, Dictation, Check-in, Settings) with responsive Tailwind CSS

#### Backend (FastAPI + Python)

- **WebSocket Endpoint** `/ws/voice`: Bridges React client to Gemini Live with `GeminiBridge` class
- **REST Endpoints:** 6 key endpoints for CRUD and LLM extraction
- **Database:** SQLite with async connection pooling via `aiosqlite`
- **LLM Integration:** Urllib HTTP calls to Gemini Text API; JSON response parsing
- **System Prompts:** Carefully crafted Ayurvedic clinical instructions for each workflow

---

## 📁 Project Structure

```text
ayurveda-opd-voice-agent/
├── server.py                     # FastAPI backend entrypoint (973 lines)
│   ├── WebSocket bridge (/ws/voice) — bidirectional audio relay
│   ├── REST endpoints — /api/* for CRUD and LLM extraction
│   ├── Database models — SQLite schema initialization
│   └── Gemini integration — Live Audio API + Text API
│
├── requirements.txt              # Python dependencies
│   ├── fastapi     (Web framework)
│   ├── uvicorn     (ASGI server)
│   ├── websockets  (Gemini Live protocol)
│   ├── pydantic    (Request validation)
│   ├── aiosqlite   (Async SQLite)
│   └── python-dotenv (Environment variables)
│
├── seed_db.py                    # Optional database seeding script
├── seed_full_data.py             # Comprehensive sample data generator
│
├── .env                          # Local configuration (gitignored)
├── .env.example                  # Environment template
├── opd_data.db                   # SQLite database (auto-generated)
│
├── index.html                    # Vite entrypoint
├── vite.config.ts                # Development server + proxy config
│   ├── Proxy rules:
│   │   /api/*     → http://localhost:8000
│   │   /ws/*      → ws://localhost:8000
│   └── Single-file plugin for bundling
│
├── tsconfig.json                 # TypeScript configuration
├── package.json                  # Node dependencies + scripts
│   ├── react 19 + react-dom 19
│   ├── zustand (state management)
│   ├── zod (validation)
│   ├── tailwindcss v4
│   └── lucide-react (icons)
│
└── src/
    ├── types/index.ts            # Core TypeScript type definitions (171 lines)
    │   ├── Screen, VoiceMode, Language, SessionStatus
    │   ├── PatientIntake, Vitals, DictationEntry, DailyCheckin
    │   ├── StructuredNote, MedicineEntry, CheckinSummary
    │   ├── AyurvedicAssessment, EmergencyAlert, ClinicalExtraction
    │   └── VoiceEvent types for WebSocket messaging
    │
    ├── store/useAppStore.ts      # Zustand global store (177 lines)
    │   ├── Navigation state (currentScreen)
    │   ├── Settings (apiKey, wsEndpoint, language, voiceMode)
    │   ├── Voice session (sessionStatus, partialTranscript)
    │   ├── Patient selection (selectedPatient, backendPatients)
    │   ├── Domain data (intakeList, dictationList, checkinList)
    │   ├── Notifications (toast messages with auto-dismiss)
    │   └── Emergency alert handling
    │
    ├── schemas/medical.ts        # Zod validation schemas (150 lines)
    │   ├── RED_FLAG_SYMPTOMS — emergency keyword list
    │   ├── VitalsSchema, MedicineEntrySchema, PatientIntakeSchema
    │   ├── StructuredNoteSchema, DictationEntrySchema
    │   ├── CheckinSummarySchema, AyurvedicAssessmentSchema
    │   ├── detectRedFlags(text) — red flag detection function
    │   ├── validateClinicalExtraction(raw) — Zod validator
    │   ├── validateStructuredNote(raw)
    │   └── validateCheckinSummary(raw)
    │
    ├── lib/
    │   ├── voiceEngine.ts         # WebSocket audio bridge (339 lines)
    │   │   ├── connectWS() — establishes WS connection to backend
    │   │   ├── startStreaming() — captures microphone using AudioContext
    │   │   ├── stopStreaming() — releases media tracks
    │   │   ├── Gemini-to-client audio relay with playback queue
    │   │   ├── handleServerMessage() — status, transcript, error handling
    │   │   ├── startBrowserSTT() — fallback SpeechRecognition
    │   │   ├── speakText() — TTS via window.speechSynthesis
    │   │   └── float32ToInt16() — PCM conversion helper
    │   │
    │   └── llmClient.ts           # Gemini Text API wrapper
    │       └── Minimal wrapper around call_gemini_text() in server
    │
    ├── components/               # Reusable UI building blocks
    │   ├── ui/
    │   │   ├── Card.tsx, Button.tsx, Badge.tsx
    │   │   ├── VoiceOrb.tsx       # Animated microphone button
    │   │   ├── TranscriptDisplay.tsx
    │   │   └── PatientSelector.tsx
    │   └── layout/
    │       ├── Header.tsx, Footer.tsx, Sidebar.tsx
    │
    ├── screens/                  # Top-level page components
    │   ├── Dashboard.tsx         # Overview with quick stats
    │   ├── PatientIntake.tsx     # Voice-based intake workflow
    │   ├── DoctorDictation.tsx   # Clinical note dictation
    │   ├── DailyCheckin.tsx      # Patient wellness tracking
    │   └── Settings.tsx          # API key, language, voice mode
    │
    └── utils/
        ├── cn.ts                # Tailwind class merger (clsx + tailwind-merge)
        └── formatDate.ts         # Date formatting helpers
```

---

## 🗄️ Database Schema

### SQLite Tables

#### `patients` — Core patient demographics

| Column          | Type        | Description                                              |
| --------------- | ----------- | -------------------------------------------------------- |
| id              | TEXT (PK)   | Patient identifier (format: `patient-<timestamp>`)       |
| name            | TEXT        | Full name                                                |
| age             | INTEGER     | Age in years                                             |
| gender          | TEXT        | `male`, `female`, or `other`                             |
| chief_complaint | TEXT        | Primary reason for visit                                 |
| symptoms        | TEXT (JSON) | Array of symptom strings                                 |
| duration        | TEXT        | Duration of chief complaint (e.g. "2 days")              |
| severity        | TEXT        | `mild`, `moderate`, or `severe`                          |
| dosha           | TEXT        | Detected dosha imbalance (vata/pitta/kapha combinations) |
| prakriti        | TEXT        | Body constitution description                            |
| vitals          | TEXT (JSON) | Optional vitals object (bp, pulse, temp, weight, height) |
| red_flags       | TEXT (JSON) | Array of emergency symptoms detected                     |
| created_at      | TEXT (ISO)  | Record creation timestamp                                |
| updated_at      | TEXT (ISO)  | Last update timestamp                                    |

#### `intakes` — Historical intake sessions

| Column          | Type        | Description                               |
| --------------- | ----------- | ----------------------------------------- |
| id              | TEXT (PK)   | Intake record ID (`intake-<timestamp>`)   |
| patient_id      | TEXT (FK)   | Links to `patients.id`                    |
| chief_complaint | TEXT        | Extracted chief complaint                 |
| symptoms        | TEXT (JSON) | Extracted symptoms array                  |
| duration        | TEXT        | Extracted duration                        |
| severity        | TEXT        | Extracted severity                        |
| dosha           | TEXT        | Extracted dosha                           |
| prakriti        | TEXT        | Extracted prakriti hints                  |
| vitals          | TEXT (JSON) | Reserved for future vitals capture        |
| red_flags       | TEXT (JSON) | Extracted red flag symptoms               |
| raw_transcript  | TEXT        | Full conversation text from voice session |
| extraction_json | TEXT (JSON) | Complete Gemini extraction response       |
| created_at      | TEXT (ISO)  | Intake session timestamp                  |

#### `dictations` — Doctor voice notes

| Column          | Type                | Description                                   |
| --------------- | ------------------- | --------------------------------------------- |
| id              | TEXT (PK)           | Dictation ID (`dict-<timestamp>`)             |
| patient_id      | TEXT (FK, nullable) | Optional patient linkage                      |
| raw_transcript  | TEXT                | Unstructured doctor speech                    |
| structured_note | TEXT (JSON)         | Gemini-formatted clinical note                |
| status          | TEXT                | `recording`, `processing`, `done`, or `error` |
| created_at      | TEXT (ISO)          | Recording timestamp                           |

#### `checkins` — Daily patient check-in records

| Column     | Type                | Description                                             |
| ---------- | ------------------- | ------------------------------------------------------- |
| id         | TEXT (PK)           | Check-in ID (`checkin-<timestamp>`)                     |
| patient_id | TEXT (FK, nullable) | Optional patient linkage                                |
| date       | TEXT (YYYY-MM-DD)   | Check-in date                                           |
| responses  | TEXT (JSON)         | Array of `{question, answer, timestamp}` objects        |
| summary    | TEXT (JSON)         | Gemini analysis (`overall_status`, `dosha_today`, etc.) |
| created_at | TEXT (ISO)          | Submission timestamp                                    |

#### `transcripts` — Full voice session logs

| Column     | Type        | Description                           |
| ---------- | ----------- | ------------------------------------- |
| id         | TEXT (PK)   | Transcript ID (`tx-<session_id>`)     |
| session_id | TEXT        | Unique voice session identifier       |
| content    | TEXT (TEXT) | Complete timestamped conversation log |
| created_at | TEXT (ISO)  | Archive timestamp                     |

---

## 🔌 API Reference

### Base URL

```
Development: http://localhost:8000
Production:  [your-domain]/api
```

All endpoints return JSON responses with the following envelope pattern:

```json
{
  "success": true,
  "data": { ... },
  "error": null
}
```

Error responses:

```json
{
  "success": false,
  "error": "Error description",
  "data": null
}
```

---

### Health & Status

#### `GET /api/health`

Returns server status and model configuration.

**Response:**

```json
{
  "status": "online",
  "voice_model": "models/gemini-2.5-flash-native-audio-latest",
  "text_model": "gemini-2.5-flash",
  "active_sessions": 3
}
```

---

### Patient Management

#### `GET /api/patients`

Lists all patients sorted by most recently updated.

**Query Parameters:** None

**Response:**

```json
{
  "patients": [
    {
      "id": "patient-1713312345678",
      "name": "Rajesh Kumar",
      "age": 45,
      "gender": "male",
      "chiefComplaint": "Joint pain in knees",
      "symptoms": ["pain", "stiffness", "swelling"],
      "duration": "6 months",
      "severity": "moderate",
      "dosha": "vata",
      "prakriti": "Vata dominant with slight Kapha",
      "vitals": {
        "bp": "120/80",
        "pulse": 72,
        "temperature": 98.6,
        "weight": 70
      },
      "redFlags": [],
      "timestamp": "2026-04-16T12:00:00",
      "updatedAt": "2026-04-16T12:05:00"
    }
  ]
}
```

#### `GET /api/patients/{patient_id}`

Retrieves a single patient record.

**Response:** Patient object (same structure as above, without `updatedAt`)

**Errors:** 404 if patient not found.

#### `POST /api/patients`

Creates a new patient record.

**Request Body (PatientCreate):**

```json
{
  "name": "Priya Sharma",
  "age": 32,
  "gender": "female",
  "chief_complaint": "Skin rash and itching",
  "symptoms": ["rash", "itching", "dry skin"],
  "duration": "3 weeks",
  "severity": "mild",
  "dosha": "pitta",
  "prakriti": "Pitta dominant"
}
```

**Response:**

```json
{
  "id": "patient-1713312349000",
  "name": "Priya Sharma",
  "created_at": "2026-04-16T12:05:00"
}
```

#### `PUT /api/patients/{patient_id}`

Updates patient fields. All fields are optional; only provided fields are modified.

**Request Body (PatientUpdate):** Same as `PatientCreate`, all fields optional.

**Response:**

```json
{
  "id": "patient-1713312349000",
  "updated": true
}
```

---

### Clinical Extraction Endpoints

#### `POST /api/extract-intake`

Extracts structured patient intake data from a raw transcript using Gemini Flash.

**Request Body:**

```json
{
  "transcript": "Namaste. I've had a headache for 3 days. It's a throbbing pain on the right side...",
  "patient_id": "patient-1713312345678",
  "language": "en"
}
```

**Language Options:** `"en"`, `"hi"`, `"hinglish"`

**Processing:**

1. Gemini Flash called with system instruction for Ayurvedic data extraction
2. Local red flag detection acts as safety net
3. If `patient_id` provided, creates `intakes` record and updates `patients` table
4. If emergency detected, `status = "emergency"` and `emergency_alert` populated

**Response:**

```json
{
  "success": true,
  "data": {
    "status": "complete",
    "patient": {
      "name": "Rajesh Kumar",
      "age": 45,
      "gender": "male",
      "chiefComplaint": "Headache, throbbing on right side",
      "symptoms": ["headache", "throbbing pain", "right side"],
      "duration": "3 days",
      "severity": "moderate",
      "dosha": "pitta",
      "prakriti": "Pitta dominant",
      "redFlags": []
    },
    "ask_followup": null,
    "emergency_alert": null,
    "ayurvedic_assessment": {
      "dosha_imbalance": ["pitta"],
      "probable_diagnosis": "Ardhavabhedaka (migraine)",
      "suggested_herbs": ["Brahmi", "Jatamansi", "Shankhapushpi"],
      "lifestyle_advice": [
        "Avoid sun exposure during peak hours",
        "Practice Pranayama - Anulom Vilom",
        "Maintain regular sleep schedule"
      ],
      "further_investigation": ["Eye examination", "Blood pressure monitoring"]
    }
  }
}
```

#### `POST /api/structure-dictation`

Converts doctor's raw dictation into structured clinical note.

**Request Body:**

```json
{
  "transcript": "Patient presents with vata predominant arthritis in both knees. History of 2 years... Prescribe Shallaki 400mg twice daily after food for 3 months. Ashwagandha 500mg at bedtime. Advice: warm oil massage, avoid cold foods, gentle yoga exercises.",
  "patient_id": "patient-1713312345678"
}
```

**Response:**

```json
{
  "success": true,
  "data": {
    "chief_complaint": "Vata predominant arthritis in both knees",
    "history": "Patient has a history of 2 years with gradual onset...",
    "examination": "Swelling and crepitus noted in both knee joints...",
    "diagnosis": "Vatarakta / Sandhigata Vata",
    "prescription": [
      {
        "name": "Shallaki (Boswellia serrata)",
        "dose": "400mg",
        "frequency": "twice daily after food",
        "duration": "3 months",
        "route": "oral"
      },
      {
        "name": "Ashwagandha (Withania somnifera)",
        "dose": "500mg",
        "frequency": "once daily at bedtime",
        "duration": "3 months",
        "route": "oral"
      }
    ],
    "follow_up": "Review after 4 weeks",
    "advice": "Warm oil massage (Mahanarayan taila), avoid cold foods and drinks, practice gentle yoga exercises for joint mobility"
  },
  "id": "dict-1713312350000"
}
```

#### `POST /api/analyze-checkin`

Analyzes daily check-in responses and generates wellness summary.

**Request Body:**

```json
{
  "patient_id": "patient-1713312345678",
  "responses": [
    {
      "question": "How was your energy level today?",
      "answer": "Good, better than yesterday"
    },
    {
      "question": "Any joint pain or stiffness?",
      "answer": "Mild stiffness in the morning, subsided after warm oil massage"
    },
    { "question": "Sleep quality?", "answer": "Slept well, 7 hours" },
    {
      "question": "Appetite and digestion?",
      "answer": "Appetite good, digestion normal"
    }
  ]
}
```

**Response:**

```json
{
  "success": true,
  "data": {
    "overall_status": "improving",
    "dosha_today": "Vata stabilized, Pitta balanced",
    "key_observations": [
      "Energy levels improved from previous day",
      "Morning joint stiffness present but responding to treatment",
      "Sleep quality adequate",
      "Appetite and digestion normal"
    ],
    "recommendations": [
      "Continue current medication regimen",
      "Maintain warm oil massage routine",
      " Practice gentle yoga before bedtime",
      "Avoid cold, raw foods in the evening"
    ]
  },
  "id": "checkin-1713312351000"
}
```

---

### History & Transcripts

#### `GET /api/dictations?patient_id=<optional>`

Lists all dictation records, optionally filtered by patient.

**Response:**

```json
{
  "dictations": [
    {
      "id": "dict-1713312350000",
      "patientId": "patient-1713312345678",
      "rawTranscript": "Patient presents with vata predominant arthritis...",
      "structuredNote": {
        /* StructuredNote object */
      },
      "status": "done",
      "timestamp": "2026-04-16T12:10:00"
    }
  ]
}
```

#### `GET /api/checkins?patient_id=<optional>`

Lists all check-in summaries.

**Response:**

```json
{
  "checkins": [
    {
      "id": "checkin-1713312351000",
      "patientId": "patient-1713312345678",
      "date": "2026-04-16",
      "responses": [
        /* array of CheckinResponse objects */
      ],
      "summary": {
        /* CheckinSummary object */
      }
    }
  ]
}
```

#### `GET /api/transcripts`

Lists up to 50 most recent voice session transcripts.

**Response:**

```json
{
  "transcripts": [
    {
      "id": "tx-20260416_120055_123456",
      "session_id": "20260416_120055_123456",
      "content": "[12:00:55] Namaste, I'm your Ayurvedic intake assistant...",
      "created_at": "2026-04-16T12:02:00"
    }
  ]
}
```

---

## 🔄 WebSocket Protocol

### Connection

```
ws://localhost:8000/ws/voice
```

The WebSocket endpoint is the core real-time audio bridge between the React frontend and Google's Gemini Live API.

### Message Flow

1. **Client → Server:** Raw PCM audio chunks (16-bit little-endian, 16kHz, mono) sent as binary WebSocket messages.

2. **Server → Client:** Audio response chunks (24kHz, 16-bit PCM) sent as binary; status/text messages sent as JSON.

### JSON Messages from Server → Client

#### Connection Status

```json
{
  "type": "status",
  "status": "connected",
  "session_id": "20260416_120055_123456"
}
```

Statuses: `connecting`, `connected`, `recording`, `processing`, `speaking`, `error`, `idle`.

#### Transcription Updates

```json
{
  "type": "transcript",
  "text": "I've had a headache for three days",
  "timestamp": "12:00:55"
}
```

#### Turn Complete

```json
{ "type": "turn_complete" }
```

Signals that Gemini has finished its turn and is listening again.

#### Session End

```json
{
  "type": "session_ended",
  "session_id": "20260416_120055_123456"
}
```

#### Error

```json
{ "type": "error", "message": "WebSocket connection timed out" }
```

---

### Connection Lifecycle

```
Client                        Server                       Gemini Live
  |                              |                              |
  |───ws.connect()───────────────>│                              |
  |                              │───wss.connect()─────────────>│
  |                              │<────setupComplete────────────│
  |<───status(connected)─────────│                              |
  |                              │                              |
  |───binary(audio chunks)───────>│───realtimeInput─────────────>│
  |                              │<────modelTurn (audio+text)───│
  |<───binary(audio) + json───────│                              |
  |                              │                              |
  |<───turn_complete──────────────│                              |
  |                              │                              |
  │◄──────session ends / disconnect───────────────────────────────►│
```

### Client-Side Audio Encoding

**Capture:**

- Microphone: 16kHz, mono, float32 samples (via `AudioContext`)
- Processor: `ScriptProcessorNode` (4096-sample buffer)
- Conversion: float32 → int16 (PCM) before WebSocket send

**Playback:**

- Receive 24kHz, 16-bit PCM binary chunks
- Convert to float32 array (divide by 32768)
- Create `AudioBuffer`, play via `AudioContext`

---

## 🧾 Type Definitions

See `src/types/index.ts` for the full type hierarchy. Key interfaces:

### Domain Models

**AppSettings:**

```ts
{
  apiKey: string;
  wsEndpoint: string;
  language: "en" | "hi" | "hinglish";
  voiceMode: "push-to-talk" | "continuous";
  autoSpeak: boolean;
  interruptMode: boolean;
}
```

**PatientIntake:**

```ts
{
  id: string;
  patientId?: string;
  name: string;
  age: number | null;
  gender: 'male' | 'female' | 'other' | null;
  chiefComplaint: string;
  symptoms: string[];
  duration: string;
  severity: 'mild' | 'moderate' | 'severe' | null;
  dosha?: string;
  prakriti?: string;
  vitals?: Vitals;
  redFlags: string[];
  timestamp: string;
}
```

**StructuredNote:**

```ts
{
  chief_complaint: string;
  history: string;
  examination: string;
  diagnosis: string;
  prescription: MedicineEntry[];
  follow_up: string;
  advice: string;
}
```

**CheckinSummary:**

```ts
{
  overall_status: 'improving' | 'stable' | 'declining' | 'needs_attention';
  dosha_today: string;
  key_observations: string[];
  recommendations: string[];
}
```

### Event Types

```ts
type VoiceEvent =
  | { type: "status"; status: string }
  | { type: "transcript_partial"; text: string }
  | { type: "transcript_final"; text: string }
  | { type: "audio"; data: ArrayBuffer }
  | { type: "turn_complete" }
  | { type: "error"; message: string };
```

---

## 🚀 Getting Started

### Prerequisites Checklist

- [ ] Node.js ≥18 (check with `node --version`)
- [ ] Python ≥3.10 (check with `python --version`)
- [ ] Google Gemini API key (obtain from [Google AI Studio](https://aistudio.google.com/))
- [ ] Git installed
- [ ] Modern browser (Chrome recommended for best WebSocket + WebAudio support)

### 1. Clone & Install

```bash
git clone <your-repo-url>
cd ayurveda-opd-voice-agent

# Install frontend dependencies
npm install

# Install Python dependencies (in virtual environment)
python -m venv venv
# Windows activation:
venv\Scripts\activate
# macOS/Linux activation:
# source venv/bin/activate
pip install -r requirements.txt
```

### 2. Environment Configuration

Create a `.env` file in the project root:

```bash
# Required: Google Gemini API key for backend LLM calls
GEMINI_API_KEY=your_gemini_api_key_here

# Required: Frontend reads this for WebSocket connection setup
VITE_GEMINI_API_KEY=your_gemini_api_key_here
```

**Important:** The `VITE_GEMINI_API_KEY` is only used for frontend health checks. The actual Gemini API calls pass through the backend which reads `GEMINI_API_KEY`.

### 3. Initialize Database

```bash
# The database is auto-created on first server start, but you can pre-seed:
python seed_full_data.py
```

This creates `opd_data.db` with sample patients, intakes, dictations, and check-ins for testing.

### 4. Start Backend Server

```bash
uvicorn server:app --reload --port 8000
```

**Expected output:**

```
============================================================
  AYURVEDA OPD INTELLIGENCE — Backend Server
  Voice Model: models/gemini-2.5-flash-native-audio-latest
  Text Model:  gemini-2.5-flash
  Database:    C:\...\opd_data.db
  REST API:    http://localhost:8000
  WebSocket:   ws://localhost:8000/ws/voice
============================================================
INFO:     Started server process [12345]
INFO:     Waiting for application startup.
💾 Database initialized: C:\...\opd_data.db
INFO:     Application startup complete.
INFO:     Uvicorn running on http://0.0.0.0:8000
```

Leave this terminal running.

### 5. Start Frontend Dev Server

In a new terminal window:

```bash
npm run dev
```

**Expected output:**

```
VITE v7.2.4  ready in 450 ms

➜  Local:   http://localhost:5173/
➜  Network: use --host to expose
```

Open the displayed URL in Chrome.

### 6. Verify Installation

1. Navigate to the app: `http://localhost:5173/`
2. Click **Settings** → Confirm API Key field is pre-filled (from `.env`)
3. Go to **Dashboard** → Check "Backend Status" card shows `Online`
4. Test voice: Go to **Patient Intake**, click the Voice Orb, speak a symptom

If the orb turns red and you hear errors:

- Confirm backend is running (`http://localhost:8000/api/health`)
- Check console (F12) for CORS or WebSocket errors
- Verify `.env` values are correct

---

## 💡 Usage Workflow

### Full Clinical Session

#### Step 1: Dashboard

- View system status, patient counts, recent activity
- Quick access to all 4 main features

#### Step 2: Patient Intake

1. Click **Patient Intake** in navigation
2. In **Patient Selector** modal:
   - Search existing patients OR
   - Click **"New Patient"** → Enter name, age, gender
   - Confirm patient selection
3. Click the **Voice Orb** center-screen (turns red when active)
4. Speak naturally as if you're the patient:
   - _"I've had severe lower back pain for a week. It's a dull ache that gets worse when I sit for long..."_
5. Voice Engine captures audio, sends to Gemini Live via WebSocket
6. Gemini asks follow-up questions in sequence:
   - Onset? Duration? Aggravating factors? Severity 0-10?
   - Any other symptoms? Prakriti assessment? Medical history? Medications?
7. After the summary, click **Stop** or say _"That's all"_
8. System saves intake to database; you see a confirmation toast

**Result:** `patients` row + `intakes` row created; red flags (if any) highlighted.

#### Step 3: Doctor Dictation

1. Navigate to **Dr. Dictation**
2. Select the same patient from dropdown
3. Click **Voice Orb**, speak your clinical assessment:
   - _"Patient presents with Vata predominant low back pain. history of 2 years, aggravated by prolonged sitting. examination shows muscle spasm in lumbar region..."_
4. After speaking, click **Stop**
5. System displays formatted clinical note with:
   - History
   - Examination
   - Diagnosis
   - Prescription (editable)
   - Follow-up advice
6. Review and click **Save Note**

**Result:** `dictations` row created with structured JSON note.

#### Step 4: Daily Check-in (Next Day)

1. Go to **Daily Check-in**
2. Select patient
3. Click **Voice Orb**, ask check-in questions (or use predefined set):
   - _"How was your energy level today?"_
   - _"Any pain or stiffness in your back?"_
4. Patient answers; each Q&A pair recorded
5. Click **Stop**, then **Generate Summary**
6. AI analyzes responses, predicts status, generates recommendations

**Result:** `checkins` row created with responses + summary.

---

## 🛠️ Development

### Local Development Guide

#### Backend Hot Reload

```bash
# Terminal 1
uvicorn server:app --reload --port 8000
```

- `--reload` watches `server.py` for changes and restarts automatically
- API docs available at `http://localhost:8000/docs` (Swagger UI)
- Alternative ReDoc view: `http://localhost:8000/redoc`

#### Frontend Hot Reload

```bash
# Terminal 2
npm run dev
```

- Vite's dev server with HMR (Hot Module Replacement)
- Source maps enabled for debugging
- ESLint/TypeScript errors appear in console

#### Environment Variables Reload

Changes to `.env` require server restart. Frontend uses Vite's import.meta.env which hot-reloads.

### Adding a New REST Endpoint

1. Add Pydantic request/response models at top of `server.py`

```python
class MyRequest(BaseModel):
    field: str

class MyResponse(BaseModel):
    result: dict
```

2. Define endpoint function:

```python
@app.post("/api/my-endpoint")
async def my_endpoint(req: MyRequest):
    # Business logic here
    return {"result": {...}}
```

3. Auto-generated docs at `/docs` with full schema validation.

### Adding a New Frontend Screen

1. Create `src/screens/MyScreen.tsx`
2. Add route to `src/App.tsx`:

```tsx
<Route path="/my-screen" element={<MyScreen />} />
```

3. Add navigation item to sidebar/header component

### Database Migrations

This project uses SQLite without a migration tool. To add a new column:

1. Modify `init_db()` in `server.py`
2. If adding to existing `patients` table and you need to preserve data:
   ```sql
   ALTER TABLE patients ADD COLUMN new_column TEXT;
   ```
3. Delete `opd_data.db` and re-run `seed_db.py` for fresh database (development only)

### Debugging WebSocket

1. Open Chrome DevTools → Network tab → WS sub-tab
2. Filter for `ws://localhost:8000/ws/voice`
3. Messages panel shows raw binary frames + JSON control messages
4. Console: `voiceEngine` object logs status changes

Common issues:

- **WS connection refused** → Backend not running, wrong port
- **Mixed content** → Use `ws://` for localhost, not `wss://`
- **CORS error** → Vite proxy misconfigured; check `vite.config.ts`

---

## ✅ Testing & Validation

### Manual Test Cases

#### Smoke Test

```
1. Start backend + frontend
2. Dashboard loads without error
3. /api/health returns JSON with status "online"
```

#### Patient Intake Flow

```
1. Create new patient "Test Patient"
2. Start voice session — orb turns red
3. Say: "Headache for 2 days, moderate severity, throbbing"
4. Verify Gemini asks: "When did it start?", "Location?", etc.
5. Click Stop
6. Verify intake saved (backendPatients in store updates)
7. GET /api/patients shows updated record
8. Database query: SELECT * FROM intakes WHERE patient_id = ?
9. Extract_json column contains valid JSON with symptoms array
```

#### Dictation Flow

```
1. Select patient from Intake flow
2. Navigate to Dr. Dictation
3. Record: "Prescribe Ashwagandha 500mg twice daily for 1 month"
4. Click Stop
5. Verify structuredNote.prescription array contains 1 entry
6. Verify JSON schema matches StructuredNoteSchema in schemas/medical.ts
```

#### Language Switching

```
1. Settings → Language: Hindi
2. Go to Intake, start voice
3. Gemini responds in Hindi ("Namaste, aaj aapki kya samasya hai?")
4. Switch to English mid-conversation — Gemini adapts
5. Extract intake, verify extraction still contains English JSON keys
```

#### Emergency Detection

```
1. Intake: "I have severe chest pain and can't breathe"
2. Red flags auto-detected locally (server.py line 511)
3. Response status = "emergency"
4. emergency_alert object populated
5. UI displays emergency banner (if implemented)
```

### Automated Testing Suggestions

This project currently has no test suite. Recommended additions:

1. **Backend Unit Tests** (pytest):
   - `test_call_gemini_text()` — mock Gemini API response
   - `test_extract_intake_endpoint()` — provide transcript, validate JSON shape
   - `test_structure_dictation_endpoint()` — verify prescription parsing
   - `test_red_flag_detection()` — verify local keyword scanning

2. **Frontend Unit Tests** (Vitest + Testing Library):
   - `VoiceEngine` class: mock WebSocket, test audio encoding
   - `useAppStore`: test state mutations (addIntake, updatePatient, etc.)
   - Schema validation: test `validateClinicalExtraction` with valid/invalid data

3. **E2E Tests** (Playwright):
   - Full intake → dictation → check-in flow
   - Multi-language switching
   - Error states (backend down, invalid API key)

---

## 🐛 Troubleshooting

### Backend Issues

| Symptom                               | Likely Cause                 | Fix                                       |
| ------------------------------------- | ---------------------------- | ----------------------------------------- |
| `ValueError: Set GEMINI_API_KEY`      | `.env` missing or not loaded | Create `.env` with `GEMINI_API_KEY=xxx`   |
| `ImportError: pip install websockets` | Python dependency missing    | `pip install websockets`                  |
| `Database locked`                     | SQLite concurrent access     | Ensure `aiosqlite` used; restart server   |
| 404 on `/api/*` endpoints             | Server not running           | `uvicorn server:app --reload`             |
| 400 Bad Request from Gemini           | Invalid JSON in LLM call     | Check server logs for raw Gemini response |

### Frontend Issues

| Symptom                       | Likely Cause                    | Fix                                                               |
| ----------------------------- | ------------------------------- | ----------------------------------------------------------------- |
| Voice orb doesn't turn red    | WebSocket failed to connect     | Check backend health (`http://localhost:8000/api/health`)         |
| "No microphone" error         | Permissions denied              | Allow microphone in browser; use HTTPS in production              |
| No audio playback             | AudioContext not resumed        | User gesture required; click anywhere to resume                   |
| CORS error in console         | Vite proxy not working          | Ensure `vite.config.ts` proxy config matches backend port         |
| Language toggle has no effect | Frontend not sending to backend | Check WebSocket message: `{"type":"config","language":"hi"}` sent |

### Gemini API Issues

| Symptom                     | Likely Cause                           | Fix                                                                    |
| --------------------------- | -------------------------------------- | ---------------------------------------------------------------------- |
| 403 Forbidden               | Invalid API key or billing not enabled | Verify key in Google AI Studio; enable billing                         |
| Quota exceeded              | Free tier limit reached                | Upgrade Google Cloud billing; or wait for quota reset                  |
| Audio streaming lag         | Network latency                        | Ensure WebSocket stable; test with local network                       |
| Responses in wrong language | System instruction not honored         | Check `VOICE_SYSTEM_INSTRUCTION` in `server.py` includes language note |

### Database Issues

**Database won't create:**

```bash
# Check file permissions:
ls -la opd_data.db  # Should not exist initially
# Server creates it on startup. Check error logs:
# "Permission denied" → Move project to writeable directory
```

**Corrupted database:**

```bash
# Delete and reseed:
rm opd_data.db
python seed_full_data.py
```

---

## 🔒 Security Considerations

### API Key Management

- `GEMINI_API_KEY` is stored server-side only in `.env`
- Never exposed to browser via `VITE_GEMINI_API_KEY` is acceptable because:
  - `VITE_` prefix ensures bundler replaces at build-time (not visible in prod source)
  - Frontend only uses key for health checks, not actual Gemini calls
  - In production, consider removing `VITE_GEMINI_API_KEY` entirely

### Authentication / Authorization

**This is a demo.** Production deployment requires:

- User authentication (OAuth2 / JWT)
- Role-based access control (doctor, nurse, patient)
- Session management with secure cookies
- CSRF protection for REST endpoints

### Data Privacy

- SQLite database stored locally; encrypt with SQLCipher for production
- HIPAA compliance requires:
  - Audit logging of all data access
  - Data at rest encryption
  - Secure transmission (HTTPS + WSS only)
  - Signed Business Associate Agreement (BAA) with Google Cloud

### Input Validation

- Pydantic models validate all REST requests
- Zod schemas validate LLM extraction results before storage
- Transcript sanitization prevents injection attacks

---

## ⚡ Performance

### Latency Benchmarks

| Operation                    | Target Latency | Notes                                      |
| ---------------------------- | -------------- | ------------------------------------------ |
| WebSocket connect to Gemini  | <2s            | Dependent on network; retry logic included |
| Speech-to-Text (first token) | <500ms         | Gemini Live streaming                      |
| Audio playback from Gemini   | <200ms         | Playback queue ensures smooth audio        |
| `/api/extract-intake`        | 1.5-3s         | Gemini Flash, ~500 tokens                  |
| `/api/structure-dictation`   | 2-4s           | Longer transcript = more processing        |
| `/api/analyze-checkin`       | 1-2s           | Short responses, fast inference            |

### Optimization Tips

1. **Reduce Gemini latency:**
   - Deploy backend closer to Google Cloud region (us-central1 for lowest latency)
   - Use Cloud CDN for static assets
   - Enable gzip compression on Nginx

2. **Frontend performance:**
   - Code splitting via React Router lazy loading
   - Virtualize long lists (dictation history) with `react-window`
   - Debounce search queries in Patient Selector

3. **Database optimization:**
   - Add indexes on foreign keys: `CREATE INDEX idx_intakes_patient ON intakes(patient_id)`
   - Add composite index on `checkins(patient_id, date)` for daily summaries
   - Use WAL mode for concurrent reads: `PRAGMA journal_mode=WAL`

---

## ⚠️ Limitations & Future Work

### Current Limitations

1. **No user authentication** — Any user can access all patient data
2. **Single practitioner** — No multi-clinic or multi-user support
3. **SQLite only** — Not suitable for high-concurrency deployments (>50 simultaneous users)
4. **No mobile app** — Responsive design works on mobile browsers but no native app
5. **Limited offline support** — Requires constant WebSocket connectivity
6. **Single language per session** — Cannot seamlessly switch languages mid-conversation (backend supports, UI doesn't expose)
7. **No audio file upload** — Only live voice capture; cannot upload recordings

### Planned Enhancements

- [ ] **User authentication** (Supabase Auth / NextAuth.js)
- [ ] **Multi-tenant deployment** (PostgreSQL + schemas per clinic)
- [ ] **Export functionality** (PDF clinical notes, CSV data export)
- [ ] **Integration with EHR** (FHIR API compatibility)
- [ ] **Offline mode** (service worker + IndexedDB sync)
- [ ] **Push notifications** for follow-up reminders
- [ ] **Advanced analytics dashboard** (patient outcomes, practitioner efficiency)
- [ ] **Voice command shortcuts** ("new patient", "switch to dictation")
- [ ] **SMS/WhatsApp check-in** for patients without smartphones
- [ ] **Multi-language utterance** (switch Hindi/English within same conversation)

---

## 🤝 Contributing

### Development Setup

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/voice-commands`
3. Follow the project's TypeScript + Python style guides
4. Add tests for new features
5. Run linting:

   ```bash
   # Frontend
   npm run lint  # (if script exists)
   npx tsc --noEmit

   # Backend
   ruff check server.py
   black server.py --check
   ```

6. Commit with clear messages: `git commit -m "Add speech-to-text fallback for Safari"`
7. Push and open a Pull Request

### Code Style

- **Frontend:** 2-space indentation, semicolons optional (follow Prettier default)
- **Backend:** 4-space indentation, semicolons required (Python standard)
- **TypeScript:** Strict mode enabled (`strict: true` in tsconfig.json)
- **Python:** Type hints encouraged (PEP 484)

---

## 📜 License

This project is intended for demonstration purposes. Not intended for direct production clinical deployment without appropriate HIPAA/medical compliance auditing.

---

## 🙏 Acknowledgments

- **Google Gemini Team** — Exceptional multimodal Live API
- **FastAPI** — Incredibly fast, modern Python web framework
- **React + Vite** — Blazing-fast frontend tooling
- **Tailwind CSS** — Utility-first styling made easy
- **Zustand** — Minimal, scalable state management
- **Ayurvedic practitioners** — For domain guidance and clinical validation

---

_Generated with care for the Ayurveda OPD community 🌿_
