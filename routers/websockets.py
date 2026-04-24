"""
Router for Websockets
"""
import json
import asyncio
import base64
from datetime import datetime
from typing import Optional
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, UploadFile, File, Body
from pydantic import BaseModel
from config import GEMINI_API_KEY, VOICE_MODEL, TEXT_MODEL, GEMINI_LIVE_URI, VOICE_SYSTEM_INSTRUCTION, DICTATION_SYSTEM_INSTRUCTION, INPUT_RATE
from models import PatientCreate, PatientUpdate, IntakeExtractionRequest, DictationRequest, CheckinRequest, SummaryRequest
from utils import get_db, active_sessions, call_gemini_text, extract_missing_intake_fields, is_missing_intake_value, build_local_intake_fallback, sanitize_intake_transcript, build_local_visit_fallback, extract_dictation_cues_from_transcript, compose_doctor_notes
import websockets

router = APIRouter(prefix="")



class DictationBridge:
    """Bridges doctor's dictation audio to Gemini Live for real-time transcription."""

    def __init__(self, client_ws: WebSocket, patient_id: Optional[str] = None, language: str = "hinglish"):
        self.client_ws = client_ws
        self.gemini_ws = None
        self.is_running = False
        self.session_id = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
        self.transcript_parts: list[str] = []
        self.patient_id = patient_id
        self.language = language

    async def send_transcript_update(self, text: str):
        """Send a transcript update to the client and store for later saving."""
        if not text:
            return
        self.transcript_parts.append(text)
        await self.client_ws.send_json({
            "type": "transcript",
            "speaker": "Doctor",
            "text": text,
            "timestamp": datetime.now().strftime("%H:%M:%S"),
        })

    async def connect_gemini(self) -> bool:
        """Connect to Gemini Live API with dictation-specific configuration."""
        try:
            print(f"   [WS-Dictation] Connecting to {VOICE_MODEL}...")
            self.gemini_ws = await websockets.connect(
                GEMINI_LIVE_URI,
                max_size=None,
                ping_interval=30,
                ping_timeout=10,
            )

            # Use same config structure as intake (AUDIO response required by Live API)
            # Even though we only need transcription, Gemini expects AUDIO modality.
            setup_msg = {
                "setup": {
                    "model": VOICE_MODEL,
                    "generation_config": {
                        "response_modalities": ["AUDIO"],
                        "temperature": 0.0,
                    },
                    "input_audio_transcription": {},
                    "system_instruction": {
                        "parts": [
                            {"text": f"The doctor will dictate in {self.language.upper()}. DO NOT GENERATE ANY OUTPUT.\n\n" + DICTATION_SYSTEM_INSTRUCTION}
                        ]
                    },
                }
            }

            await self.gemini_ws.send(json.dumps(setup_msg))
            response = await asyncio.wait_for(self.gemini_ws.recv(), timeout=30)
            response_data = json.loads(response)

            if "setupComplete" in response_data:
                self.is_running = True
                await self.client_ws.send_json({
                    "type": "status",
                    "status": "connected",
                    "session_id": self.session_id,
                })
                print(f"   [OK] Dictation WebSocket connected: {self.session_id}")
                return True
            else:
                error_msg = response_data.get("error", {}).get("message", str(response_data))
                print(f"   [ERROR] Gemini setup failed: {error_msg}")
                await self.client_ws.send_json({
                    "type": "error",
                    "message": f"Dictation connection failed: {error_msg}",
                })
                return False

        except asyncio.TimeoutError:
            print(f"   [ERROR] Dictation connection timeout")
            await self.client_ws.send_json({
                "type": "error",
                "message": "Connection to transcription service timed out",
            })
            return False
        except Exception as e:
            print(f"   [ERROR] Dictation connection error: {type(e).__name__}: {e}")
            await self.client_ws.send_json({
                "type": "error",
                "message": f"Failed to connect: {str(e)}",
            })
            return False

    async def client_to_gemini(self):
        """Forward audio from doctor client → Gemini."""
        try:
            bytes_sent = 0
            while self.is_running:
                data = await self.client_ws.receive()

                if data.get("type") == "websocket.disconnect":
                    break

                if "bytes" in data:
                    pcm_bytes = data["bytes"]
                    b64_audio = base64.b64encode(pcm_bytes).decode("utf-8")
                    bytes_sent += len(pcm_bytes)

                    msg = {
                        "realtimeInput": {
                            "mediaChunks": [
                                {
                                    "mimeType": f"audio/pcm;rate={INPUT_RATE}",
                                    "data": b64_audio,
                                }
                            ]
                        }
                    }
                    await self.gemini_ws.send(json.dumps(msg))

                    # Log periodically to debug
                    if bytes_sent % (INPUT_RATE * 2) < 100:  # ~every 0.5 sec
                        print(f"   [WS-Dictation] Sent {bytes_sent} audio bytes total")

                elif "text" in data:
                    try:
                        msg = json.loads(data["text"])
                        if msg.get("type") == "end_session":
                            break
                        elif msg.get("type") == "turn_end":
                            await self.gemini_ws.send(json.dumps({
                                "realtimeInput": {
                                    "audioStreamEnd": True
                                }
                            }))
                    except json.JSONDecodeError:
                        pass

        except WebSocketDisconnect:
            pass
        except Exception as e:
            print(f"[ERROR] Dictation client→gemini error: {e}")

    async def gemini_to_client(self):
        """Forward transcripts from Gemini → doctor client."""
        msg_count = 0
        try:
            while self.is_running and self.gemini_ws:
                response = await self.gemini_ws.recv()
                response_data = json.loads(response)
                msg_count += 1

                # Handle serverContent (Live API response wrapper)
                if "serverContent" in response_data:
                    sc = response_data["serverContent"]
                    
                    if "inputTranscription" in sc:
                        transcription = sc["inputTranscription"]
                        text = transcription.get("text", "").strip()
                        if text:
                            await self.send_transcript_update(text)
                if "error" in response_data:
                    print(f"   [ERROR] Gemini error: {response_data['error']}")
                    await self.client_ws.send_json({
                        "type": "error",
                        "message": response_data["error"].get("message", "Unknown error"),
                    })

        except WebSocketDisconnect:
            pass
        except Exception as e:
            print(f"[ERROR] Dictation gemini→client error: {e}")
        finally:
            print(f"   [WS-Dictation] Received {msg_count} messages, transcript parts: {len(self.transcript_parts)}")

    async def save_transcript(self):
        """Save the full transcript to the dictations table."""
        if not self.transcript_parts:
            return

        full_transcript = " ".join(self.transcript_parts)
        dictation_id = f"dict-{int(datetime.now().timestamp() * 1000)}"

        db = get_db()
        db.execute(
            """INSERT INTO dictations (id, patient_id, raw_transcript, structured_note, status, created_at)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (dictation_id, self.patient_id, full_transcript, None, "processing", datetime.now().isoformat()),
        )
        db.commit()
        db.close()

        print(f"[DB] Saved dictation transcript: {dictation_id}")

        # Notify client that transcript has been saved; ignore errors if client disconnected
        try:
            await self.client_ws.send_json({
                "type": "dictation_saved",
                "dictation_id": dictation_id,
            })
        except Exception:
            pass  # Client already disconnected


# ═══════════════════════════════════════════════════════════════════════════════
# GEMINI BRIDGE: React ↔ This Server ↔ Gemini Live (Patient Intake)
# ═══════════════════════════════════════════════════════════════════════════════

class GeminiBridge:
    """Manages one patient voice session: bridges React client to Gemini Live."""

    def __init__(self, client_ws: WebSocket):
        self.client_ws = client_ws
        self.gemini_ws = None
        self.is_running = False
        self.session_id = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
        self.transcript_parts = []
        self.awaiting_confirmation = False

    def is_summary_turn(self, text: str) -> bool:
        """Detect if Dhara just provided a summary based on keywords."""
        lower = text.lower()
        summary_patterns = [
            "vivran",       # "Kya ye vivran…"
            "sahi hai",     # "…aapke anusaar sahi hai?"
            "is this correct",
            "summary",
            "theek hai kya",
            "theek lagta hai",
            "sab sahi hai",
        ]
        return any(p in lower for p in summary_patterns)

    def normalize_confirmation(self, text: str) -> Optional[str]:
        """Normalize patient's 'Yes' or 'No' response."""
        lower = text.strip().lower()
        # Hindi/Hinglish/English "Yes"
        if lower in ["yes", "haan", "han", "haan ji", "ji haan"] or lower.startswith(("yes ", "haan ", "han ")):
            return "Yes"
        # Hindi/Hinglish/English "No"
        if lower in ["no", "nahi", "nahin", "na"] or lower.startswith(("no ", "nahi ", "nahin ")):
            return "No"
        return None

    async def append_transcript(self, speaker: str, text: str):
        if not text:
            return
        ts = datetime.now().strftime("%H:%M:%S")
        self.transcript_parts.append(f"[{ts}] {speaker}: {text}")
        await self.client_ws.send_json({
            "type": "transcript",
            "speaker": speaker,
            "text": f"{speaker}: {text}",
            "timestamp": ts,
        })

    async def connect_gemini(self) -> bool:
        """Connect to Gemini Live API."""
        try:
            print(f"   [WS] Connecting to {VOICE_MODEL}...")
            self.gemini_ws = await websockets.connect(
                GEMINI_LIVE_URI,
                max_size=None,
                ping_interval=30,
                ping_timeout=10,
            )
            print(f"   [WS] WebSocket to Gemini opened, sending setup...")

            setup_msg = {
                "setup": {
                    "model": VOICE_MODEL,
                    "generation_config": {
                        "response_modalities": ["AUDIO"],
                        "temperature": 0.3,
                        "speech_config": {
                            "voice_config": {
                                "prebuilt_voice_config": {
                                    "voice_name": "Aoede"
                                }
                            }
                        },
                    },
                    "input_audio_transcription": {},
                    "output_audio_transcription": {},
                    "system_instruction": {
                        "parts": [{"text": VOICE_SYSTEM_INSTRUCTION}]
                    },
                }
            }

            await self.gemini_ws.send(json.dumps(setup_msg))
            print(f"   [WS] Setup sent, waiting for response...")
            response = await asyncio.wait_for(self.gemini_ws.recv(), timeout=30)
            response_data = json.loads(response)
            print(f"   [WS] Response: {response_data.keys()}")

            if "setupComplete" in response_data:
                self.is_running = True
                await self.client_ws.send_json({
                    "type": "status",
                    "status": "connected",
                    "session_id": self.session_id,
                })
                print(f"   [OK] Gemini Live connected for session {self.session_id}")
                return True
            else:
                error_msg = response_data.get("error", {}).get("message", str(response_data))
                print(f"   [ERROR] Gemini setup failed: {error_msg}")
                await self.client_ws.send_json({
                    "type": "error",
                    "message": f"Gemini setup failed: {error_msg}",
                })
                return False

        except asyncio.TimeoutError:
            print(f"   [ERROR] Gemini connection timeout")
            await self.client_ws.send_json({
                "type": "error",
                "message": "Gemini connection timed out",
            })
            return False
        except Exception as e:
            print(f"   [ERROR] Gemini connection error: {type(e).__name__}: {e}")
            await self.client_ws.send_json({
                "type": "error",
                "message": f"Failed to connect to Gemini: {str(e)}",
            })
            return False

    async def client_to_gemini(self):
        """Forward audio from React client → Gemini."""
        try:
            while self.is_running:
                data = await self.client_ws.receive()

                if data.get("type") == "websocket.disconnect":
                    break

                if "bytes" in data:
                    pcm_bytes = data["bytes"]
                    b64_audio = base64.b64encode(pcm_bytes).decode("utf-8")

                    msg = {
                        "realtimeInput": {
                            "mediaChunks": [
                                {
                                    "mimeType": f"audio/pcm;rate={INPUT_RATE}",
                                    "data": b64_audio,
                                }
                            ]
                        }
                    }
                    await self.gemini_ws.send(json.dumps(msg))

                elif "text" in data:
                    try:
                        msg = json.loads(data["text"])
                        if msg.get("type") == "end_session":
                            break
                        elif msg.get("type") == "turn_end":
                            # User stopped speaking — flush the realtime audio stream
                            await self.gemini_ws.send(json.dumps({
                                "realtimeInput": {
                                    "audioStreamEnd": True
                                }
                            }))
                        elif msg.get("type") == "summarize_now":
                            await self.gemini_ws.send(json.dumps({
                                "realtimeInput": {
                                    "text": "Please summarize the patient's intake in 3 to 4 short Hinglish lines, then ask: 'Kya ye vivran aapke anusaar sahi hai?'",
                                }
                            }))
                    except json.JSONDecodeError:
                        pass

        except WebSocketDisconnect:
            pass
        except Exception as e:
            print(f"[ERROR] Client→Gemini error: {e}")
        finally:
            self.is_running = False

    async def gemini_to_client(self):
        """Forward audio from Gemini → React client."""
        try:
            while self.is_running:
                response = await self.gemini_ws.recv()
                gemini_data = json.loads(response)

                if "serverContent" in gemini_data:
                    sc = gemini_data["serverContent"]

                    if sc.get("turnComplete", False):
                        await self.client_ws.send_json({"type": "turn_complete"})
                        continue

                    model_turn = sc.get("modelTurn", {})
                    parts = model_turn.get("parts", [])

                    for part in parts:
                        if "inlineData" in part:
                            inline = part["inlineData"]
                            mime = inline.get("mimeType", "")
                            if "audio" in mime:
                                audio_bytes = base64.b64decode(inline["data"])
                                await self.client_ws.send_bytes(audio_bytes)

                        if "text" in part:
                            await self.append_transcript("Dhara", part["text"])

                    if "inputTranscription" in sc:
                        transcription = sc["inputTranscription"]
                        user_text = transcription.get("text", "").strip()
                        if user_text:
                            await self.client_ws.send_json({
                                "type": "status",
                                "status": "recording",
                            })
                            await self.client_ws.send_json({
                                "type": "model_speaking",
                                "speaking": False,
                            })
                            await self.append_transcript("Patient", user_text)
                            # AUTO-CONFIRMATION: Detect patient response if we just asked for confirmation
                            if self.awaiting_confirmation:
                                conf = self.normalize_confirmation(user_text)
                                if conf:
                                    print(f"   [CONFIRMATION] Detected: {conf}")
                                    await self.client_ws.send_json({
                                        "type": "confirmation",
                                        "value": conf
                                    })
                                    self.awaiting_confirmation = False

                    # NEW: Capture Dhara's speech text from outputTranscription
                    if "outputTranscription" in sc:
                        output_transcription = sc["outputTranscription"]
                        dhara_text = output_transcription.get("text", "").strip()
                        if dhara_text:
                            await self.append_transcript("Dhara", dhara_text)
                            # AUTO-CONFIRMATION: Detect if Dhara just gave a summary
                            if self.is_summary_turn(dhara_text):
                                print(f"   [CONFIRMATION] Dhara summary turn detected")
                                self.awaiting_confirmation = True
                                await self.client_ws.send_json({
                                    "type": "summary_detected",
                                    "text": dhara_text
                                })

                if "error" in gemini_data:
                    await self.client_ws.send_json({
                        "type": "error",
                        "message": gemini_data["error"].get("message", "Unknown"),
                    })
                    break

        except Exception as e:
            print(f"[ERROR] Gemini→Client error: {e}")
        finally:
            self.is_running = False

    async def save_transcript(self):
        """Save transcript to database."""
        if self.transcript_parts:
            content = "\n".join(self.transcript_parts)
            db = get_db()
            db.execute(
                "INSERT INTO transcripts (id, session_id, content, created_at) VALUES (?, ?, ?, ?)",
                (f"tx-{self.session_id}", self.session_id, content, datetime.now().isoformat()),
            )
            db.commit()
            db.close()
            print(f"[DB] Transcript saved for session {self.session_id}")
            return content
        return None


@router.websocket("/ws/voice")
async def websocket_voice(ws: WebSocket):
    """WebSocket endpoint for voice sessions."""
    await ws.accept()
    session_id = datetime.now().strftime("%Y%m%d_%H%M%S")
    print(f"[WS] New voice session: {session_id}")

    bridge = GeminiBridge(ws)
    active_sessions[session_id] = bridge

    try:
        print(f"   [WS] Attempting to connect to Gemini Live...")
        connected = await bridge.connect_gemini()
        if not connected:
            print(f"   [ERROR] Gemini connection failed, closing WebSocket")
            return
        print(f"   [OK] Gemini connected successfully!")

        await asyncio.gather(
            bridge.client_to_gemini(),
            bridge.gemini_to_client(),
        )

    except WebSocketDisconnect:
        print(f"[WS] Client disconnected: {session_id}")
    except Exception as e:
        print(f"[ERROR] Session error: {e}")
    finally:
        bridge.is_running = False
        await bridge.save_transcript()

        if bridge.gemini_ws:
            try:
                await bridge.gemini_ws.close()
            except Exception:
                pass

        active_sessions.pop(session_id, None)
        print(f"[WS] Session ended: {session_id}")

        try:
            await ws.send_json({
                "type": "session_ended",
                "session_id": session_id,
            })
        except Exception:
            pass



