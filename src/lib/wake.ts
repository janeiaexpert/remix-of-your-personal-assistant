import { useEffect, useRef, useState } from "react";

// -----------------------------------------------------------------------------
// Ativação por palavra ("JARVIS") e por duas palmas.
// Roda um reconhecimento contínuo separado do microfone principal + um detector
// de picos de áudio (palmas) usando AnalyserNode.
// -----------------------------------------------------------------------------

type RecCtor = new () => RecInstance;
interface RecInstance extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((e: WakeResultEvent) => void) | null;
  onerror: ((e: Event) => void) | null;
  onend: (() => void) | null;
}
interface WakeResultEvent extends Event {
  results: { length: number; [i: number]: { 0: { transcript: string }; isFinal: boolean } };
}

function getRecCtor(): RecCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: RecCtor; webkitSpeechRecognition?: RecCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const WAKE_RE = /\b(jarvis|jarves|jarvys|jarvi[sz]|j[áa]rvis|charves|jarbas)\b/i;

export type WakeMode = "off" | "word" | "clap" | "both";

export function useWake({
  mode,
  onWake,
  paused,
}: {
  mode: WakeMode;
  onWake: () => void;
  paused?: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const [armed, setArmed] = useState(false);
  const [claps, setClaps] = useState(0);
  const onWakeRef = useRef(onWake);
  useEffect(() => { onWakeRef.current = onWake; }, [onWake]);

  const wantWord = mode === "word" || mode === "both";
  const wantClap = mode === "clap" || mode === "both";
  const active = mode !== "off" && !paused;

  // --- palavra de ativação -------------------------------------------------
  useEffect(() => {
    if (!active || !wantWord) return;
    const Ctor = getRecCtor();
    if (!Ctor) {
      setError("Reconhecimento de voz não suportado neste navegador.");
      return;
    }
    let stopped = false;
    let rec: RecInstance | null = null;
    let restartTimer: number | undefined;

    const spin = () => {
      if (stopped) return;
      try {
        rec = new Ctor();
      } catch {
        return;
      }
      rec.lang = "pt-BR";
      rec.continuous = true;
      rec.interimResults = true;
      rec.onresult = (e) => {
        for (let i = 0; i < e.results.length; i++) {
          const t = e.results[i][0].transcript;
          if (WAKE_RE.test(t)) {
            onWakeRef.current();
            try { rec?.stop(); } catch { /* noop */ }
            return;
          }
        }
      };
      rec.onerror = (e) => {
        const err = (e as unknown as { error?: string }).error;
        if (err === "not-allowed" || err === "service-not-allowed") {
          setError("Permissão de microfone negada.");
          stopped = true;
        }
      };
      rec.onend = () => {
        if (stopped) return;
        restartTimer = window.setTimeout(spin, 600);
      };
      try {
        rec.start();
        setArmed(true);
      } catch { /* noop */ }
    };
    spin();

    return () => {
      stopped = true;
      setArmed(false);
      if (restartTimer) window.clearTimeout(restartTimer);
      try { rec?.stop(); } catch { /* noop */ }
    };
  }, [active, wantWord]);

  // --- duas palmas ---------------------------------------------------------
  useEffect(() => {
    if (!active || !wantClap) return;
    let stopped = false;
    let stream: MediaStream | null = null;
    let ctx: AudioContext | null = null;
    let raf = 0;

    void (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch {
        setError("Permissão de microfone negada para detectar palmas.");
        return;
      }
      if (stopped) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      ctx = new Ctor();
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      src.connect(analyser);
      const buf = new Float32Array(analyser.fftSize);
      let lastClap = 0;
      let firstClap = 0;
      let cooldownUntil = 0;

      const tick = () => {
        if (stopped || !ctx) return;
        analyser.getFloatTimeDomainData(buf);
        let peak = 0;
        for (let i = 0; i < buf.length; i++) {
          const v = Math.abs(buf[i]);
          if (v > peak) peak = v;
        }
        const now = performance.now();
        if (peak > 0.35 && now - lastClap > 120 && now > cooldownUntil) {
          lastClap = now;
          if (firstClap && now - firstClap < 1000) {
            firstClap = 0;
            setClaps(0);
            cooldownUntil = now + 1500;
            onWakeRef.current();
          } else {
            firstClap = now;
            setClaps(1);
            window.setTimeout(() => setClaps(0), 1100);
          }
        }
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
      setArmed(true);
    })();

    return () => {
      stopped = true;
      setArmed(false);
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
      void ctx?.close().catch(() => {});
    };
  }, [active, wantClap]);

  return { armed, error, claps };
}
