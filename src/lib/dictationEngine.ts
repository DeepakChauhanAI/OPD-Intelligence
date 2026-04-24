/**
 * DictationEngine — Real-time transcription for doctor dictation
 *
 * Uses native browser Web Speech API for zero-latency,
 * perfectly localized real-time transcription across languages.
 * On stopRecording(), sends transcript to server for processing.
 */

export type DictationEvent =
  | {
      type: "status";
      status:
        | "connecting"
        | "connected"
        | "recording"
        | "processing"
        | "error"
        | "idle";
    }
  | { type: "transcript"; text: string; timestamp: string }
  | { type: "turn_complete" }
  | { type: "saved"; dictationId: string; transcript: string }
  | { type: "processed"; visitId: string; extracted: any; needsReview: string[]; confidence: string }
  | { type: "error"; message: string };

export type DictationEventHandler = (event: DictationEvent) => void;

export class DictationEngine {
  private recognition: any = null;
  private connected = false;
  private finalTranscript = "";
  
  private mediaRecorder: MediaRecorder | null = null;
  private audioChunks: Blob[] = [];
  private audioStream: MediaStream | null = null;

  private config: {
    wsEndpoint: string;
    language: string;
    patientId?: string;
    onEvent: DictationEventHandler;
  };

  constructor(config: {
    wsEndpoint: string;
    language: string;
    patientId?: string;
    onEvent: DictationEventHandler;
  }) {
    this.config = config;
  }

  async connect(): Promise<boolean> {
    try {
      this.audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.connected = true;
      this.emit({ type: "status", status: "connected" });
      return true;
    } catch (err: any) {
      this.emit({
        type: "error",
        message: "Microphone access denied or not available.",
      });
      return false;
    }
  }

  async startRecording(): Promise<void> {
    if (!this.connected || !this.audioStream) {
      const connected = await this.connect();
      if (!connected) return;
    }

    // Set up MediaRecorder
    this.audioChunks = [];
    try {
      this.mediaRecorder = new MediaRecorder(this.audioStream!);
      this.mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) this.audioChunks.push(e.data);
      };
      this.mediaRecorder.onstart = () => {
        this.emit({ type: "status", status: "recording" });
      };
      this.mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(this.audioChunks, { type: "audio/webm" });
        await this.processAudioOnServer(audioBlob);
      };
      this.mediaRecorder.start(1000); // chunk every second
    } catch (e: any) {
      this.emit({ type: "error", message: "Could not start audio recorder." });
      return;
    }

    // Set up SpeechRecognition for live UI feedback
    const SpeechRecognition =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;
      
    if (SpeechRecognition) {
      this.recognition = new SpeechRecognition();

      // Map language to a supported locale for SpeechRecognition
      let langCode = "hi-IN"; // Default to Hindi for better Hinglish support
      if (this.config.language.toLowerCase() === "en") langCode = "en-IN";
      else if (this.config.language.toLowerCase() === "hinglish") langCode = "hi-IN";

      this.recognition.lang = langCode;
      this.recognition.continuous = true;
      this.recognition.interimResults = true;
      this.finalTranscript = "";

      this.recognition.onresult = (event: any) => {
        let interimTranscript = "";
        let latestFinal = "";

        for (let i = event.resultIndex; i < event.results.length; ++i) {
          if (event.results[i].isFinal) {
            latestFinal += event.results[i][0].transcript + " ";
          } else {
            interimTranscript += event.results[i][0].transcript;
          }
        }

        if (latestFinal) {
          this.finalTranscript += latestFinal;
        }

        const currentText = (this.finalTranscript + interimTranscript).trim();

        this.emit({
          type: "transcript",
          text: currentText,
          timestamp: new Date().toLocaleTimeString(),
        });
      };

      this.recognition.onerror = (event: any) => {
        if (event.error !== "not-allowed" && event.error !== "no-speech") {
          console.warn("Speech recognition error", event.error);
        }
      };

      this.recognition.onend = () => {
        // If we stop naturally or due to pause, auto restart unless we called stopRecording() manually
        if (this.connected && this.recognition) {
          try {
            this.recognition.start();
          } catch (e) {}
        }
      };

      try {
        this.recognition.start();
      } catch (e: any) {
        console.warn("Could not start speech recognition:", e.message);
      }
    }
  }

  stopRecording(): void {
    if (this.recognition) {
      this.recognition.onend = null; // prevent restart
      this.recognition.stop();
      this.recognition = null;
    }
    
    if (this.mediaRecorder && this.mediaRecorder.state !== "inactive") {
      this.mediaRecorder.stop();
    }
    
    this.emit({ type: "status", status: "processing" });
  }

  private async processAudioOnServer(audioBlob: Blob): Promise<void> {
    try {
      const formData = new FormData();
      formData.append("audio", audioBlob, "dictation.webm");
      if (this.config.patientId) {
        formData.append("patient_id", this.config.patientId);
      }
      formData.append("language_hint", this.config.language);

      const response = await fetch("/api/dictation/transcribe", {
        method: "POST",
        body: formData,
      });

      const json = await response.json();
      if (json.success) {
        this.emit({
          type: "processed",
          visitId: json.visit_id,
          extracted: json.extracted,
          needsReview: json.needs_review || [],
          confidence: json.confidence || "medium",
        });
        this.emit({
          type: "saved",
          dictationId: json.visit_id,
          transcript: json.transcript || this.finalTranscript.trim(),
        });
      } else {
        this.emit({
          type: "error",
          message: json.error || "Processing failed",
        });
      }
    } catch (err) {
      this.emit({ type: "error", message: String(err) });
    }
  }

  disconnect(): void {
    this.connected = false;
    if (this.recognition) {
      this.recognition.onend = null;
      this.recognition.stop();
      this.recognition = null;
    }
    if (this.mediaRecorder && this.mediaRecorder.state !== "inactive") {
      this.mediaRecorder.stop();
    }
    if (this.audioStream) {
      this.audioStream.getTracks().forEach((track) => track.stop());
      this.audioStream = null;
    }
  }

  private emit(event: DictationEvent): void {
    if (typeof this.config.onEvent === "function") {
      try {
        this.config.onEvent(event);
      } catch (err) {
        console.warn("DictationEngine emit error:", err);
      }
    }
  }
}
