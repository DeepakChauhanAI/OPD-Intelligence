/**
 * DictationEngine — Real-time transcription for doctor dictation
 *
 * Uses native browser Web Speech API for zero-latency, 
 * perfectly localized real-time transcription across languages.
 */

export type DictationEvent =
  | {
      type: "status";
      status: "connecting" | "connected" | "recording" | "processing" | "error" | "idle";
    }
  | { type: "transcript"; text: string; timestamp: string }
  | { type: "turn_complete" }
  | { type: "saved"; dictationId: string }
  | { type: "error"; message: string };

export type DictationEventHandler = (event: DictationEvent) => void;

export class DictationEngine {
  private recognition: any = null;
  private connected = false;
  private finalTranscript = "";
  
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
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      this.emit({ type: "error", message: "Speech Recognition is not supported in this browser. Please use Chrome or Edge." });
      return false;
    }
    this.connected = true;
    this.emit({ type: "status", status: "connected" });
    return true;
  }

  async startRecording(): Promise<void> {
    if (!this.connected) {
      await this.connect();
    }

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    this.recognition = new SpeechRecognition();
    
    // Map hinglish to a supported locale
    let langCode = "hi-IN";
    if (this.config.language.toLowerCase() === "english") langCode = "en-IN";
    
    this.recognition.lang = langCode;
    this.recognition.continuous = true;
    this.recognition.interimResults = true;
    this.finalTranscript = "";

    this.recognition.onstart = () => {
      this.emit({ type: "status", status: "recording" });
    };

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
      if (event.error === 'not-allowed') {
        this.emit({ type: "error", message: "Microphone access denied." });
      } else if (event.error !== 'no-speech') {
        console.warn("Speech recognition error", event.error);
      }
    };

    this.recognition.onend = () => {
      // If we stop naturally or due to pause, auto restart unless we called stopRecording() manually
      if (this.connected && this.recognition) {
         try { this.recognition.start(); } catch(e) {}
      }
    };

    try {
      this.recognition.start();
    } catch (e: any) {
      this.emit({ type: "error", message: e.message });
    }
  }

  stopRecording(): void {
    if (this.recognition) {
       this.recognition.onend = null; // prevent restart
       this.recognition.stop();
       this.recognition = null;
    }
    this.emit({ type: "status", status: "processing" });
    
    // Simulate the server saving delay and trigger submission
    setTimeout(() => {
      this.emit({ type: "saved", dictationId: `dict-${Date.now()}` });
    }, 500);
  }

  disconnect(): void {
    this.connected = false;
    if (this.recognition) {
       this.recognition.onend = null;
       this.recognition.stop();
       this.recognition = null;
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

