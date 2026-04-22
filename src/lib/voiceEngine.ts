/**
 * VoiceEngine — WebSocket Audio Bridge + Browser STT Fallback
 * Connects to FastAPI backend /ws/voice for Gemini Live audio relay.
 * Falls back to browser SpeechRecognition for text-only STT.
 */

import type { VoiceEvent, VoiceEventHandler } from "../types";

interface VoiceEngineConfig {
  wsEndpoint: string;
  apiKey: string;
  language: string;
  autoSpeak: boolean;
  interruptMode: boolean;
  onEvent: VoiceEventHandler;
}

export class VoiceEngine {
  private config: VoiceEngineConfig;
  private ws: WebSocket | null = null;
  private audioContext: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private scriptProcessor: ScriptProcessorNode | null = null;
  private sourceRef: MediaStreamAudioSourceNode | null = null; // keep ref to disconnect
  private silentGain: GainNode | null = null;
  private playbackQueue: ArrayBuffer[] = [];
  private playbackContext: AudioContext | null = null;
  private playbackGain: GainNode | null = null;
  private isPlaying = false;
  private connected = false;
  private muted = false; // mic mute flag
  private pendingTurnComplete = false;

  // VAD state
  private isSpeaking = false; // user is currently speaking (VAD active)
  private silentFrames = 0;
  private speechStartedAt = 0;
  private lastVoiceAt = 0;
  private turnEndSent = false;
  private readonly VOICE_THRESHOLD = 0.015; // RMS threshold (tunable, ~-36 dB)
  private readonly END_OF_SPEECH_MS = 1600; // ignore short pauses before ending a turn
  private readonly MIN_SPEECH_MS = 350; // do not end turns for tiny bursts

  constructor(config: VoiceEngineConfig) {
    this.config = config;
  }

  // Safe event emitter (guards against disposed/undefined config)
  private emit(event: VoiceEvent): void {
    if (this.config && typeof this.config.onEvent === "function") {
      try {
        this.config.onEvent(event);
      } catch (err) {
        console.warn("VoiceEngine emit error:", err);
      }
    }
  }

  // ── WebSocket Connection ──────────────────────────────────────────────────

  async connectWS(): Promise<boolean> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      return true;
    }

    this.emit({ type: "status", status: "connecting" });

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        console.error("⏱️ WebSocket connection timeout");
        if (this.ws) {
          this.ws.close();
          this.ws = null;
        }
        reject(new Error("Connection timeout"));
      }, 30000); // 30 second timeout

      try {
        const wsUrl = this.config?.wsEndpoint || "ws://localhost:8000/ws/voice";
        console.log("🔌 Connecting to:", wsUrl);
        this.ws = new WebSocket(wsUrl);
        this.ws.binaryType = "arraybuffer";

        this.ws.onopen = () => {
          console.log("🔌 WebSocket connected to backend");
          clearTimeout(timeoutId);
          this.connected = true;
          this.emit({ type: "status", status: "connected" });
          resolve(true);
        };

        this.ws.onerror = (error) => {
          console.error("❌ WebSocket error:", error);
          clearTimeout(timeoutId);
        };

        this.ws.onclose = (event) => {
          console.log("❌ WebSocket closed:", event.code, event.reason);
          clearTimeout(timeoutId);
          if (!this.connected) {
            this.emit({ type: "status", status: "idle" });
          }
        };

        this.ws.onmessage = (event) => {
          if (event.data instanceof ArrayBuffer) {
            this.pendingTurnComplete = false;
            this.emit({ type: "model_speaking", speaking: true });
            this.emit({ type: "status", status: "speaking" });
            this.playbackQueue.push(event.data);
            if (!this.isPlaying) {
              this.playNextAudio();
            }
          } else {
            try {
              const msg = JSON.parse(event.data);
              this.handleServerMessage(msg);
            } catch {
              console.warn("Non-JSON WS message:", event.data);
            }
          }
        };
      } catch (err) {
        clearTimeout(timeoutId);
        console.error("❌ WebSocket create error:", err);
        this.emit({
          type: "error",
          message: `WebSocket error: ${err}`,
        });
        reject(err);
      }
    });
  }

  private handleServerMessage(msg: any) {
    switch (msg.type) {
      case "status":
        this.emit({ type: "status", status: msg.status });
        break;
      case "transcript":
        this.emit({ type: "transcript_final", text: msg.text });
        break;
      case "assistant_text":
        this.emit({ type: "assistant_text", text: msg.text ?? "" });
        break;
      case "turn_complete":
        this.emit({ type: "turn_complete" });
        this.pendingTurnComplete = true;
        break;
      case "session_ended":
        this.emit({ type: "status", status: "idle" });
        break;
      case "error":
        this.emit({ type: "error", message: msg.message });
        break;
      case "model_speaking":
        this.emit({
          type: "model_speaking",
          speaking: msg.speaking ?? false,
        });
        break;
      case "clinical_summary":
        this.emit({
          type: "clinical_summary",
          narrative: msg.narrative ?? "",
          fields: msg.fields ?? {},
        });
        break;
      case "generating_summary":
        this.emit({ type: "generating_summary" });
        break;
      case "transcript_file":
        this.emit({
          type: "transcript_file",
          filename: msg.transcript_file ?? msg.filename ?? "",
        });
        break;
    }
  }

  // ── Microphone Capture & Send ─────────────────────────────────────────────

  async startStreaming(): Promise<void> {
    if (!this.connected || !this.ws) {
      const ok = await this.connectWS();
      if (!ok) return;
    }

    try {
      this.audioContext = new AudioContext({ sampleRate: 16000 });
      if (this.audioContext.state === "suspended") {
        await this.audioContext.resume();
      }
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: 16000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      const source = this.audioContext.createMediaStreamSource(
        this.mediaStream,
      );
      this.sourceRef = source; // store for cleanup
      this.scriptProcessor = this.audioContext.createScriptProcessor(
        4096,
        1,
        1,
      );
      this.silentGain = this.audioContext.createGain();
      this.silentGain.gain.value = 0;

      this.scriptProcessor.onaudioprocess = (event) => {
        if (this.muted || this.ws?.readyState !== WebSocket.OPEN) return;

        const float32 = event.inputBuffer.getChannelData(0);
        const rms = this.calculateRMS(float32);
        const voiceDetected = rms > this.VOICE_THRESHOLD;
        const now = performance.now();

        if (voiceDetected) {
          this.lastVoiceAt = now;
          this.silentFrames = 0;
          this.turnEndSent = false;
          if (!this.isSpeaking) {
            this.isSpeaking = true;
            this.speechStartedAt = now;
            this.emit({ type: "status", status: "recording" });
          }
          const int16 = this.float32ToInt16(float32);
          this.ws!.send(int16.buffer);
        } else {
          if (this.isSpeaking) {
            this.silentFrames++;
            const silentForMs = now - this.lastVoiceAt;
            const speechLengthMs = now - this.speechStartedAt;
            const endOfSpeechReached =
              silentForMs >= this.END_OF_SPEECH_MS &&
              speechLengthMs >= this.MIN_SPEECH_MS;

            if (endOfSpeechReached && !this.turnEndSent) {
              this.isSpeaking = false;
              this.silentFrames = 0;
              this.turnEndSent = true;
              this.emit({ type: "status", status: "idle" });
              this.ws!.send(JSON.stringify({ type: "turn_end" }));
            } else {
              const int16 = this.float32ToInt16(float32);
              this.ws!.send(int16.buffer);
            }
          }
        }
      };

      source.connect(this.scriptProcessor);
      this.scriptProcessor.connect(this.silentGain);
      this.silentGain.connect(this.audioContext.destination);

      this.muted = false;
      this.turnEndSent = false;
      this.speechStartedAt = 0;
      this.lastVoiceAt = 0;
      this.emit({ type: "status", status: "recording" });
    } catch (err) {
      this.emit({
        type: "error",
        message: `Microphone error: ${err}`,
      });
    }
  }

  stopStreaming(): void {
    this.muted = true;
    this.stopPlayback(); // cancel any queued playback
    if (this.scriptProcessor) {
      this.scriptProcessor.disconnect();
      this.scriptProcessor = null;
    }
    if (this.sourceRef) {
      this.sourceRef.disconnect();
      this.sourceRef = null;
    }
    if (this.silentGain) {
      this.silentGain.disconnect();
      this.silentGain = null;
    }
    if (this.audioContext) {
      this.audioContext.close().catch(() => {});
      this.audioContext = null;
    }
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((t) => t.stop());
      this.mediaStream = null;
    }
    this.emit({ type: "status", status: "idle" });
  }

  disconnect(): void {
    this.stopStreaming();
    if (this.ws) {
      try {
        this.ws.send(JSON.stringify({ type: "end_session" }));
      } catch {}
      this.ws.close();
      this.ws = null;
    }
    this.connected = false;
    this.playbackQueue = [];
    this.stopPlayback();
  }

  // ── Audio Playback (Gemini voice response) ────────────────────────────────

  private async playNextAudio() {
    if (this.playbackQueue.length === 0) {
      this.isPlaying = false;
      this.muted = false; // unmute mic when playback fully done
      if (this.pendingTurnComplete) {
        this.pendingTurnComplete = false;
        this.emit({ type: "model_speaking", speaking: false });
        this.emit({ type: "status", status: "idle" });
      } else if (this.mediaStream) {
        this.emit({ type: "model_speaking", speaking: false });
        this.emit({ type: "status", status: "recording" });
      }
      return;
    }

    this.isPlaying = true;
    this.muted = true; // mute mic while AI speaks
    this.emit({ type: "status", status: "speaking" });

    const chunkCount = Math.min(4, this.playbackQueue.length);
    const chunks = this.playbackQueue.splice(0, chunkCount);
    try {
      if (!this.playbackContext) {
        this.playbackContext = new AudioContext();
        this.playbackGain = this.playbackContext.createGain();
        this.playbackGain.gain.value = 1;
        this.playbackGain.connect(this.playbackContext.destination);
      }

      if (this.playbackContext.state === "suspended") {
        await this.playbackContext.resume();
      }

      const ctx = this.playbackContext;
      const totalSamples = chunks.reduce((sum, chunk) => {
        return sum + new Int16Array(chunk).length;
      }, 0);
      const float32 = new Float32Array(totalSamples);
      let offset = 0;
      for (const chunk of chunks) {
        const int16 = new Int16Array(chunk);
        for (let i = 0; i < int16.length; i++) {
          float32[offset++] = int16[i] / 32768;
        }
      }

      const buffer = ctx.createBuffer(1, float32.length, 24000);
      buffer.copyToChannel(float32, 0);

      const source = ctx.createBufferSource();
      source.buffer = buffer;
      const gainNode = ctx.createGain();
      const now = ctx.currentTime;
      const fadeSeconds = Math.min(0.02, buffer.duration / 6);
      gainNode.gain.setValueAtTime(0, now);
      gainNode.gain.linearRampToValueAtTime(1, now + fadeSeconds);
      gainNode.gain.setValueAtTime(
        1,
        Math.max(now + fadeSeconds, now + buffer.duration - fadeSeconds),
      );
      gainNode.gain.linearRampToValueAtTime(0, now + buffer.duration);
      source.connect(gainNode);
      gainNode.connect(this.playbackGain!);
      source.onended = () => {
        // Continue to next chunk; muted will be cleared when queue empty
        this.playNextAudio();
      };
      source.start();
    } catch (err) {
      console.warn("Audio playback error:", err);
      this.playNextAudio();
    }
  }

  stopPlayback(): void {
    this.playbackQueue = [];
    this.isPlaying = false;
    this.muted = false; // ensure mic unmuted when playback stopped
    this.turnEndSent = false;
    this.pendingTurnComplete = false;
    this.speechStartedAt = 0;
    this.lastVoiceAt = 0;
    if (this.playbackContext) {
      this.playbackContext.close().catch(() => {});
      this.playbackContext = null;
      this.playbackGain = null;
    }
    window.speechSynthesis?.cancel();
  }

  // ── Browser STT (Fallback) ────────────────────────────────────────────────

  startBrowserSTT(
    onResult: (text: string, isFinal: boolean) => void,
  ): () => void {
    const SpeechRecognition =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      this.emit({
        type: "error",
        message: "Browser speech recognition not supported. Use Chrome.",
      });
      return () => {};
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;

    const langMap: Record<string, string> = {
      en: "en-IN",
      hi: "hi-IN",
      hinglish: "hi-IN",
    };
    recognition.lang = langMap[this.config?.language || "en"] || "en-IN";

    recognition.onresult = (event: any) => {
      let interim = "";
      let final = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          final += result[0].transcript;
        } else {
          interim += result[0].transcript;
        }
      }

      if (final) {
        onResult(final, true);
      } else if (interim) {
        onResult(interim, false);
      }
    };

    recognition.onerror = (event: any) => {
      if (event.error !== "aborted") {
        console.warn("STT error:", event.error);
      }
    };

    recognition.start();

    return () => {
      try {
        recognition.stop();
      } catch {}
    };
  }

  // ── TTS (Browser SpeechSynthesis) ─────────────────────────────────────────

  speakText(
    text: string,
    language: string = "en",
    onEnd?: () => void,
  ): void {
    if (!window.speechSynthesis) return;

    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 0.88;
    utterance.pitch = 1.0;
    if (onEnd) {
      utterance.onend = onEnd;
    }

    const langMap: Record<string, string> = {
      en: "en-IN",
      hi: "hi-IN",
      hinglish: "hi-IN",
    };
    utterance.lang = langMap[language] || "en-IN";
    window.speechSynthesis.speak(utterance);
  }

  sendControlMessage(payload: Record<string, unknown>): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private calculateRMS(float32: Float32Array): number {
    let sum = 0;
    for (let i = 0; i < float32.length; i++) {
      sum += float32[i] * float32[i];
    }
    return Math.sqrt(sum / float32.length);
  }

  private float32ToInt16(float32: Float32Array): Int16Array {
    const int16 = new Int16Array(float32.length);
    for (let i = 0; i < float32.length; i++) {
      const s = Math.max(-1, Math.min(1, float32[i]));
      int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    return int16;
  }

  get isConnected(): boolean {
    return this.connected;
  }

  // Mic mute control (used during AI speech to prevent echo)
  setMuted(muted: boolean): void {
    this.muted = muted;
  }
}
