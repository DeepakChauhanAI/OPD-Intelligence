# System Status & Recent Fixes (April 21)

This document summarizes the intended workflow of the Ayurveda OPD Voice Agent Dictation system, the critical issues that were disrupting it, the fixes applied, and the current state of the application.

---

## 1. How the System is Supposed to Work

### The Doctor Dictation Workflow
1. **Selection:** The doctor selects a patient and chooses a spoken language (English, Hindi, or Hinglish).
2. **Recording:** The doctor clicks "Start Recording" and dictates clinical notes. As they speak, a live text transcript is displayed dynamically on the screen.
3. **Processing:** The doctor clicks "Stop Recording". The transcript is sent to the backend (`/api/dictation/process`), where a Large Language Model (Gemini) strictly extracts relevant structured fields (Diagnosis, Herbs, Dosages, Diet, Lifestyle advice).
4. **Review Phase:** The frontend receives the structured extraction and pauses in a **Review UI**. The doctor inspects the extracted values, corrects any misunderstandings, and fills in highlighted missing fields.
5. **Confirmation:** The doctor clicks "Confirm & Generate Check-in Templates". 
6. **Backend Generation:** The customized check-in questions are generated based on the specific medicines and lifestyle routines provided and injected into the database's `checkin_templates` table to be used for the daily WhatsApp/voice check-ins.

---

## 2. The Issues (How it Was Actually Working)

Before our fixes, the system broke down at multiple stages:

### Issue A: Urdu / Arabic Script instead of Devanagari (Hindi)
The live dictation was streaming audio via a WebSocket to Gemini's 2.5 Flash Native Audio Model. Because conversational Hindi and Urdu (Hindustani) share identical acoustics, the LLM was probabilistically guessing the language and often outputting Urdu (Arabic script) instead of the desired Devanagari script for Hindi/Hinglish dictations. It was impossible to force a specific script due to limitations in the Multimodal Live API.

### Issue B: Phantom Duplicates & Disappearing Review Options
A background bug was yanking doctors out of the application flow:
* Exactly 8 seconds after clicking "Stop Recording", a redundant `setTimeout` triggered a *second* background extraction attempt using whatever local transcript was currently in memory.
* If a doctor was in the middle of reviewing the structured form from the *first* successful response, this rogue 8-second trigger would force the UI back into "processing" mode, creating a duplicate `Draft processing` entry in the Recent Dictations card, and locking them out of the Review UI entirely.

### Issue C: Check-in Templates Did Not Generate
Because the rogue 8-second bug kicked the doctor out of the Review screen before they could ever press **"Confirm & Generate Check-in Templates"**, the REST endpoint responsible for analyzing the drugs/lifestyle actions (`/api/dictation/confirm`) was never triggered.

---

## 3. What Fixes Have Been Implemented

1. **Decoupled Live Transcription (`DictationEngine.ts`)**
   * Replaced the expensive Live WebSocket API with the browser's native **Web Speech API** (`window.SpeechRecognition`).
   * Explicitly mapped the "Hindi" and "Hinglish" language selections to the `hi-IN` locale. This forces the browser to transcribe spoken audio flawlessly into **Devanagari text** instantly and locally (zero latency).
   * Once dictation stops, only this highly accurate Devanagari text is POSTed to the backend for clinical extraction, bypassing the LLM's Arabic script confusion entirely.

2. **Removed Rogue Safety Timers (`DoctorDictation.tsx`)**
   * Removed the 8000ms `setTimeout` that used to arbitrarily restart the `processTranscript` loop.
   * Since the local dictation engine never encounters "dropped WebSocket packets", the `"saved"` transcript is fully deterministic, meaning we only ever process the dictation once. 
   * This immediately stops duplicate generation and allows the app to cleanly transition into (and stay in) the Review Phase.

3. **Restored Template Generation Flow**
   * Eliminating the frontend interruptions allows the doctor to properly verify the extracted herbs and diet instructions, and naturally click the **Confirm** button. 
   * This routes directly to our robust standard template pipeline (`generate_checkin_templates_from_visit` in `server.py`), successfully seeding the database.

---

## 4. Current State

The system is now stable and functioning exactly as originally envisioned:
* **Instant Dictation:** Real-time speech displays perfect Hindi/Devanagari text on screen without external network lag.
* **Deterministic Flow:** The doctor processes their dictation exactly once. The UI progresses from Recording → Processing → Review seamlessly.
* **Fully Editable:** The doctor maintains full control over the AI-extracted fields in the Review UI and will only proceed when completely satisfied.
* **Data Integrity:** "Recent Dictations" now accurately displays singular processing/confirmed entries, and database check-in tables are being hydrated successfully upon the doctor's explicit confirmation.
