import { useEffect, useRef, useState } from "react";

// -----------------------------------------------------------------------------
// Ativação por palavra ("JARVIS") e por duas palmas.
// Ambos os detectores rodam ao mesmo tempo no modo "both": o detector de palmas
// mantém UM stream de microfone vivo e o reconhecimento de voz é reiniciado com
// tolerância a erros, sem derrubar o stream. O estado "paused" não desliga o
// microfone — apenas ignora os gatilhos — o que evita oscilação entre ciclos.
// -----------------------------------------------------------------------------

type RecCtor = new () => RecInstance;
interface RecInstance extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  abort?: () => void;
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
  const pausedRef = useRef(!!paused);
  useEffect(() => { onWakeRef.current = onWake; }, [onWake]);
  useEffect(() => { pausedRef.current = !!paused; }, [paused]);

  const wantWord = mode === "word" || mode === "both";
  const wantClap = mode === "clap" || mode === "both";
  const active = mode !== "off";

  const fire = () => {
    if (pausedRef.current) return;
    onWakeRef.current();
  };

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
    let backoff = 400;

    const schedule = (ms: number) => {
      if (stopped) return;
      if (restartTimer) window.clearTimeout(restartTimer);
      restartTimer = window.setTimeout(spin, ms);
    };

    function spin() {
      if (stopped) return;
      try {
        rec = new Ctor!();
      } catch {
        schedule(1500);
        return;
      }
      rec.lang = "pt-BR";
      rec.continuous = true;
      rec.interimResults = true;
      rec.onresult = (e) => {
        for (let i = 0; i < e.results.length; i++) {
          const t = e.results[i][0].transcript;
          if (WAKE_RE.test(t)) {
            fire();
            // Reinicia o reconhecedor para limpar o buffer, sem desligar de vez.
            try { rec?.abort ? rec.abort() : rec?.stop(); } catch { /* noop */ }
            return;
          }
        }
      };
      rec.onerror = (e) => {
        const err = (e as unknown as { error?: string }).error;
        if (err === "not-allowed" || err === "service-not-allowed") {
          setError("Permissão de microfone negada.");
          setArmed(false);
          stopped = true;
          return;
        }
        // aborted / no-speech / audio-capture / network → tenta de novo
        backoff = Math.min(backoff * 2, 4000);
        schedule(backoff);
      };
      rec.onend = () => {
        if (stopped) return;
        schedule(backoff);
      };
      try {
        rec.start();
        backoff = 400;
        setArmed(true);
        setError(null);
      } catch {
        schedule(800);
      }
    }

    // No modo "ambos" damos um pequeno atraso para o stream de palmas subir
    // primeiro — assim os dois consumidores do microfone convivem.
    const startDelay = wantClap ? 700 : 0;
    const boot = window.setTimeout(spin, startDelay);

    return () => {
      stopped = true;
      window.clearTimeout(boot);
      if (restartTimer) window.clearTimeout(restartTimer);
      try { rec?.abort ? rec.abort() : rec?.stop(); } catch { /* noop */ }
      if (!wantClap) setArmed(false);
    };
  }, [active, wantWord, wantClap]);

  // --- duas palmas ---------------------------------------------------------
  useEffect(() => {
    if (!active || !wantClap) return;
    let stopped = false;
    let stream: MediaStream | null = null;
    let ctx: AudioContext | null = null;
    let raf = 0;

    void (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
        });
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
      if (ctx.state === "suspended") await ctx.resume().catch(() => {});
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
            fire();
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
