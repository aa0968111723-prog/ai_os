import { useCallback, useEffect, useRef, useState } from "react";

/**
 * 語音輸入（按住 Orb 說話）——原生優先、Web Speech 備援。
 *
 * ## 兩條路（Native v1 起）
 *
 * 1. **原生 AiosSpeech plugin**（Capacitor 殼）：Android WebView **沒有**
 *    `webkitSpeechRecognition`，在 APK 裡 Web Speech 的偵測必定 unsupported——
 *    按住 Orb 只能退回打字。原生 bridge 用系統 SpeechRecognizer 補上：
 *    同樣的逐字稿與音量圈語意，辨識在裝置端跑，音訊不經伺服器。
 *    音量由 plugin 的 rms 事件餵，**不再另開 getUserMedia**（避免雙重佔麥）。
 * 2. **Web Speech**（手機瀏覽器）：與 #794 相同，行為不變。
 *
 * ## stopAsync 與 stop
 *
 * 原生引擎在 stopListening 之後才吐最終結果（比最後一段 partial 準）。
 * `stopAsync()` 等最終結果最多 800ms，逾時取最後的 partial——放開 Orb 的
 * 呼叫端用它。同步 `stop()` 保留（立即回目前逐字稿），行為與 #794 相同。
 *
 * ## 清理
 *
 * 麥克風是使用者看得到的資源（狀態列紅點）。stop／unmount 收乾淨兩條路的
 * 所有資源；原生側另有 handleOnPause 在 App 進背景時強制收麥（雙保險）。
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
  /** 停止並回傳目前逐字稿（同步；native 下不等最終結果） */
  stop: () => string;
  /** 停止並等最終結果（native ≤800ms；web 立即）——放開 Orb 用這個 */
  stopAsync: () => Promise<string>;
}

/* ── 原生 plugin 介面（與 android/.../AiosSpeechPlugin.java 一對一） ── */

interface PluginListenerHandleLike { remove: () => Promise<void> | void }

interface AiosSpeechPluginLike {
  available?: () => Promise<{ available?: boolean }>;
  start?: (options: { language?: string }) => Promise<void>;
  stop?: () => Promise<void>;
  addListener?: (
    event: "partialResult" | "result" | "rms" | "state" | "error",
    callback: (payload: Record<string, unknown>) => void,
  ) => Promise<PluginListenerHandleLike> | PluginListenerHandleLike;
}

function nativeSpeechPlugin(): AiosSpeechPluginLike | null {
  if (typeof window === "undefined") return null;
  const cap = (window as unknown as {
    Capacitor?: { Plugins?: { AiosSpeech?: AiosSpeechPluginLike } };
  }).Capacitor;
  const plugin = cap?.Plugins?.AiosSpeech ?? null;
  return plugin?.start && plugin.addListener ? plugin : null;
}

/* ── Web Speech（與 #794 相同） ── */

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
/** stopAsync 等原生最終結果的上限：再久使用者會以為沒送出去。 */
const NATIVE_FINAL_RESULT_MS = 800;

export function useVoiceInput(): VoiceInputState {
  // 原生 plugin 在場＝一定支援語音介面（有沒有辨識服務由 start 時的 reject 誠實回報）
  const [mode] = useState<"native" | "web" | "none">(() =>
    nativeSpeechPlugin() ? "native" : recognitionCtor() ? "web" : "none");
  const supported = mode !== "none";
  const [status, setStatus] = useState<VoiceStatus>(() => (mode === "none" ? "unsupported" : "idle"));
  const [transcript, setTranscript] = useState("");
  const [amplitude, setAmplitude] = useState(0);

  const transcriptRef = useRef("");
  /** stopAsync 正在等的最終結果；native result 事件到時 resolve */
  const pendingFinalRef = useRef<((text: string) => void) | null>(null);

  /* ── native 資源 ── */
  const nativeHandlesRef = useRef<PluginListenerHandleLike[]>([]);
  const nativeActiveRef = useRef(false);

  /* ── web 資源 ── */
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
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

  const teardownNativeListeners = useCallback(() => {
    for (const handle of nativeHandlesRef.current) {
      try {
        void handle.remove();
      } catch {
        /* 已移除 */
      }
    }
    nativeHandlesRef.current = [];
    nativeActiveRef.current = false;
    setAmplitude(0);
  }, []);

  /* ── native start ── */
  const startNative = useCallback(async () => {
    const plugin = nativeSpeechPlugin();
    if (!plugin?.start || !plugin.addListener) {
      setStatus("unsupported");
      return;
    }
    if (nativeActiveRef.current) return; // 連按兩次不開兩條辨識
    nativeActiveRef.current = true;
    transcriptRef.current = "";
    setTranscript("");

    const listen = async (
      event: Parameters<NonNullable<AiosSpeechPluginLike["addListener"]>>[0],
      callback: (payload: Record<string, unknown>) => void,
    ) => {
      const handle = await plugin.addListener!(event, callback);
      nativeHandlesRef.current.push(handle);
    };
    try {
      await listen("partialResult", (payload) => {
        const text = typeof payload.transcript === "string" ? payload.transcript : "";
        if (!text) return;
        transcriptRef.current = text;
        setTranscript(text);
      });
      await listen("result", (payload) => {
        const text = typeof payload.transcript === "string" ? payload.transcript : "";
        if (text) {
          transcriptRef.current = text;
          setTranscript(text);
        }
        pendingFinalRef.current?.(transcriptRef.current.trim());
        pendingFinalRef.current = null;
      });
      await listen("rms", (payload) => {
        const level = typeof payload.level === "number" ? payload.level : 0;
        setAmplitude(Math.min(1, Math.max(0, level)));
      });
      await listen("state", (payload) => {
        const next = payload.status;
        if (next === "listening") setStatus("listening");
        else if (next === "denied") setStatus("denied");
        else if (next === "error") setStatus("error");
        else if (next === "idle") setStatus((prev) => (prev === "listening" ? "idle" : prev));
      });
      await plugin.start({ language: RECOGNITION_LANG });
      setStatus("listening");
    } catch (error) {
      teardownNativeListeners();
      const message = error instanceof Error ? error.message : String(error);
      setStatus(message.includes("denied") ? "denied" : message.includes("unavailable") ? "unsupported" : "error");
    }
  }, [teardownNativeListeners]);

  /* ── web start（#794 原樣） ── */
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

  const startWeb = useCallback(() => {
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

  const start = useCallback(() => {
    if (mode === "native") void startNative();
    else startWeb();
  }, [mode, startNative, startWeb]);

  const stop = useCallback((): string => {
    if (mode === "native") {
      const plugin = nativeSpeechPlugin();
      void plugin?.stop?.().catch(() => undefined);
      setStatus((prev) => (prev === "listening" ? "idle" : prev));
      return transcriptRef.current.trim();
    }
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
  }, [mode, teardownMeter]);

  const stopAsync = useCallback((): Promise<string> => {
    if (mode !== "native" || !nativeActiveRef.current) return Promise.resolve(stop());
    return new Promise<string>((resolve) => {
      // 引擎把已收音訊辨識完的最終結果比最後一段 partial 準；等它 ≤800ms
      const timer = setTimeout(() => {
        pendingFinalRef.current = null;
        resolve(transcriptRef.current.trim());
      }, NATIVE_FINAL_RESULT_MS);
      pendingFinalRef.current = (text) => {
        clearTimeout(timer);
        resolve(text);
      };
      const plugin = nativeSpeechPlugin();
      void plugin?.stop?.().catch(() => {
        clearTimeout(timer);
        pendingFinalRef.current = null;
        resolve(transcriptRef.current.trim());
      });
      setStatus((prev) => (prev === "listening" ? "idle" : prev));
    }).finally(() => {
      nativeActiveRef.current = false;
    });
  }, [mode, stop]);

  // 卸載收乾淨：離開 Companion 之後麥克風還開著是最糟的 bug 之一。
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
    const plugin = nativeSpeechPlugin();
    void plugin?.stop?.().catch(() => undefined);
    for (const handle of nativeHandlesRef.current) {
      try {
        void handle.remove();
      } catch {
        /* ignore */
      }
    }
    nativeHandlesRef.current = [];
  }, []);

  return { supported, status, transcript, amplitude, start, stop, stopAsync };
}
