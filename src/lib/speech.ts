import { useEffect, useRef, useState } from "react";

type SpeechRecognitionCtor = new () => SpeechRecognitionInstance;
interface SpeechRecognitionInstance extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((e: SpeechRecognitionEvent) => void) | null;
  onerror: ((e: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
}
interface SpeechRecognitionEvent extends Event {
  results: {
    length: number;
    [index: number]: { 0: { transcript: string }; isFinal: boolean };
  };
}
interface SpeechRecognitionErrorEvent extends Event {
  error: string;
}

export function useSpeech(onFinal: (text: string) => void) {
  const recRef = useRef<SpeechRecognitionInstance | null>(null);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [supported, setSupported] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const Ctor = (window as unknown as {
      SpeechRecognition?: SpeechRecognitionCtor;
      webkitSpeechRecognition?: SpeechRecognitionCtor;
    }).SpeechRecognition ?? (window as unknown as {
      webkitSpeechRecognition?: SpeechRecognitionCtor;
    }).webkitSpeechRecognition;
    if (!Ctor) return;
    setSupported(true);
    const rec = new Ctor();
    rec.lang = "pt-BR";
    rec.continuous = false;
    rec.interimResults = true;
    rec.onresult = (e) => {
      let finalText = "";
      let interimText = "";
      for (let i = 0; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalText += r[0].transcript;
        else interimText += r[0].transcript;
      }
      setInterim(interimText);
      if (finalText.trim()) {
        setInterim("");
        onFinal(finalText.trim());
      }
    };
    rec.onerror = () => setListening(false);
    rec.onend = () => {
      setListening(false);
      setInterim("");
    };
    recRef.current = rec;
    return () => {
      try { rec.stop(); } catch { /* noop */ }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const start = () => {
    if (!recRef.current || listening) return;
    try {
      recRef.current.start();
      setListening(true);
    } catch { /* noop */ }
  };
  const stop = () => {
    if (!recRef.current) return;
    try { recRef.current.stop(); } catch { /* noop */ }
  };

  return { listening, interim, supported, start, stop };
}

// ------- Server-side TTS playback (Lovable AI, PCM stream) -------

import { createParser } from "eventsource-parser";

let audioCtx: AudioContext | null = null;
let currentAbort: AbortController | null = null;

function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!audioCtx) audioCtx = new Ctor({ sampleRate: 24000 });
  return audioCtx;
}

/** Call inside a user gesture (click) to unlock audio playback. */
export async function primeAudio() {
  const ctx = getCtx();
  if (ctx && ctx.state === "suspended") {
    await ctx.resume().catch(() => {});
  }
}

export function cancelSpeech() {
  if (currentAbort) {
    currentAbort.abort();
    currentAbort = null;
  }
}

export async function speak(
  text: string,
  opts: { onStart?: () => void; onEnd?: () => void } = {},
) {
  const ctx = getCtx();
  if (!ctx || !text.trim()) {
    opts.onEnd?.();
    return;
  }
  cancelSpeech();
  const abort = new AbortController();
  currentAbort = abort;

  if (ctx.state === "suspended") {
    await ctx.resume().catch(() => {});
  }

  let playhead = 0;
  let pending = new Uint8Array(0);
  let started = false;
  let lastEndTime = 0;

  const playChunk = (incoming: Uint8Array) => {
    const bytes = new Uint8Array(pending.length + incoming.length);
    bytes.set(pending);
    bytes.set(incoming, pending.length);
    const usable = bytes.length - (bytes.length % 2);
    pending = bytes.slice(usable);
    if (usable === 0) return;
    const samples = new Int16Array(bytes.buffer, 0, usable / 2);
    const floats = Float32Array.from(samples, (s) => s / 32768);
    const buffer = ctx.createBuffer(1, floats.length, 24000);
    buffer.copyToChannel(floats, 0);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    if (playhead === 0) playhead = ctx.currentTime + 0.08;
    else playhead = Math.max(playhead, ctx.currentTime);
    source.start(playhead);
    playhead += buffer.duration;
    lastEndTime = playhead;
    if (!started) {
      started = true;
      opts.onStart?.();
    }
  };

  try {
    const res = await fetch("/api/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
      signal: abort.signal,
    });
    if (!res.ok || !res.body) {
      console.error("TTS failed", res.status, await res.text().catch(() => ""));
      opts.onEnd?.();
      return;
    }
    const parser = createParser({
      onEvent(event) {
        let payload: { type: string; audio?: string };
        try {
          payload = JSON.parse(event.data);
        } catch {
          return;
        }
        if (payload.type !== "speech.audio.delta" || !payload.audio) return;
        const binary = atob(payload.audio);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        playChunk(bytes);
      },
    });
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) parser.feed(value);
    }
    // Schedule onEnd right after last buffer finishes
    const remaining = Math.max(0, lastEndTime - ctx.currentTime);
    window.setTimeout(() => opts.onEnd?.(), remaining * 1000 + 50);
  } catch (err) {
    if ((err as { name?: string })?.name !== "AbortError") {
      console.error("TTS error", err);
    }
    opts.onEnd?.();
  } finally {
    if (currentAbort === abort) currentAbort = null;
  }
}

