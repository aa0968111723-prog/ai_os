import { useCallback, useEffect, useRef, useState } from "react";

/**
 * 語音輸入（按住 Orb 說話）。
 *
 * ## 為什麼是 Web Speech API 而不是自己送模型
 *
 * Companion 的語音要在**按住的當下**就顯示逐字稿，使用者才知道機器有沒有聽懂。
 * 錄完再上傳轉寫至少要多等一秒，而那一秒使用者會以為壞了、再按一次。
 * Android WebView 的 `webkitSpeechRecognition` 是裝置端的，interim result
 * 幾百毫秒就回來。缺點是 iOS Safari 支援不完整——所以這裡**一定要有退路**：
 * 不支援時 `supported=false`，Companion 顯示文字輸入而不是一顆按不動的麥克風。
 *
 * ## 音量圈是另一條路
 *
 * `SpeechRecognition` 不吐音量，所以振幅另外從 `getUserMedia` ＋ `AnalyserNode` 取。
 * 兩者共用麥克風在 Android Chrome 是可以的；拿不到就回 0，音量圈不動，
 * **辨識照樣運作**——不要因為裝飾拿不到而讓核心功能失效。
 *
 * ## 清理
 *
 * 麥克風是使用者看得到的資源（狀態列的紅點）。停止時一定要 stop 每一條 track、
 * close AudioContext。少一個，使用者會看到 App 明明沒在錄音卻一直亮著。
 */

export type VoiceStatus = "idle" | "listening" | "denied" | "unsupported" | "error";

export interface VoiceInputState {
  supported: boolean;
  status: VoiceStatus;
  /** 目前為止的逐字稿（含 interim） */
  transcript: string;
  /** 0–1 音量；拿不到時恆為 0 */
  amplitude: number;
  start: () => void;
  /** 停止並回傳最終逐字稿（空字串＝沒說話） */
  stop: () => string;
}

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
}

interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>;
}

type RecognitionCtor = new () => SpeechRecognitionLike;

function recognitionCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: RecognitionCtor;
    webkitSpeechRecognition?: RecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** 中文優先：站內介面與內容都是繁中，辨識語系跟著走。 */
const RECOGNITION_LANG = "zh-TW";
/** 音量取樣間隔：15Hz 足以讓圈跟著聲音動，又不會每幀都算 FFT。 */
const AMPLITUDE_INTERVAL_MS = 66;

export function useVoiceInput(): VoiceInputState {
  const [supported] = useState(() => recognitionCtor() !== null);
  const [status, setStatus] = useState<VoiceStatus>(() => (recognitionCtor() ? "idle" : "unsupported"));
  const [transcript, setTranscript] = useState("");
  const [amplitude, setAmplitude] = useState(0);

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const transcriptRef = useRef("");
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const meterTimer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  const teardownMeter = useCallback(() => {
    clearInterval(meterTimer.current);
    meterTimer.current = undefined;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    void audioCtxRef.current?.close().catch(() => undefined);
    audioCtxRef.current = null;
    setAmplitude(0);
  }, []);

  const startMeter = useCallback(async () => {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx();
      audioCtxRef.current = ctx;
      const analyser = ctx.createAnalyser();
      // 256 已經足夠算 RMS；再大只是多算 FFT，而我們只要一個數字。
      analyser.fftSize = 256;
      ctx.createMediaStreamSource(stream).connect(analyser);
      const buffer = new Uint8Array(analyser.frequencyBinCount);
      meterTimer.current = setInterval(() => {
        analyser.getByteTimeDomainData(buffer);
        let sum = 0;
        for (const sample of buffer) {
          const centered = (sample - 128) / 128;
          sum += centered * centered;
        }
        const rms = Math.sqrt(sum / buffer.length);
        // ×3.2 讓一般說話音量落在 0.3–0.8，圈才看得出變化（原始 RMS 多在 0.05–0.2）
        setAmplitude(Math.min(1, rms * 3.2));
      }, AMPLITUDE_INTERVAL_MS);
    } catch {
      // 使用者拒絕麥克風、或這個裝置沒有——音量圈不動，辨識仍然照跑。
      teardownMeter();
    }
  }, [teardownMeter]);

  const start = useCallback(() => {
    const Ctor = recognitionCtor();
    if (!Ctor) {
      setStatus("unsupported");
      return;
    }
    // 連按兩次不該開兩條辨識：第二條會把第一條的結果吃掉。
    if (recognitionRef.current) return;

    transcriptRef.current = "";
    setTranscript("");
    const recognition = new Ctor();
    recognition.lang = RECOGNITION_LANG;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.onresult = (event) => {
      let text = "";
      for (let i = 0; i < event.results.length; i++) {
        text += event.results[i][0]?.transcript ?? "";
      }
      transcriptRef.current = text;
      setTranscript(text);
    };
    recognition.onerror = (event) => {
      setStatus(event.error === "not-allowed" || event.error === "service-not-allowed" ? "denied" : "error");
    };
    recognition.onend = () => {
      recognitionRef.current = null;
      setStatus((prev) => (prev === "listening" ? "idle" : prev));
    };
    recognitionRef.current = recognition;
    setStatus("listening");
    try {
      recognition.start();
    } catch {
      recognitionRef.current = null;
      setStatus("error");
      return;
    }
    void startMeter();
  }, [startMeter]);

  const stop = useCallback((): string => {
    const recognition = recognitionRef.current;
    recognitionRef.current = null;
    try {
      recognition?.stop();
    } catch {
      /* 已經停了 */
    }
    teardownMeter();
    setStatus((prev) => (prev === "listening" ? "idle" : prev));
    return transcriptRef.current.trim();
  }, [teardownMeter]);

  // 卸載時一定要收乾淨：離開 Companion 之後麥克風還開著是最糟的 bug 之一。
  useEffect(() => () => {
    try {
      recognitionRef.current?.abort();
    } catch {
      /* ignore */
    }
    recognitionRef.current = null;
    clearInterval(meterTimer.current);
    streamRef.current?.getTracks().forEach((track) => track.stop());
    void audioCtxRef.current?.close().catch(() => undefined);
  }, []);

  return { supported, status, transcript, amplitude, start, stop };
}
