import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import ReactMarkdown from "react-markdown";
import { Mic, MicOff, Send, Volume2, VolumeX, Trash2 } from "lucide-react";
import { askJarvis } from "@/lib/jarvis.functions";
import { useSpeech, speak, cancelSpeech, primeAudio } from "@/lib/speech";
import { cn } from "@/lib/utils";

type Msg = { role: "user" | "assistant"; content: string };
const STORAGE_KEY = "jarvis:conversation:v1";
const GREETING: Msg = {
  role: "assistant",
  content: "Sistemas online. Ao seu dispor, senhor. Em que posso ajudá-lo?",
};

export const Route = createFileRoute("/")({ component: Jarvis });

function loadMessages(): Msg[] {
  if (typeof window === "undefined") return [GREETING];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [GREETING];
    const parsed = JSON.parse(raw) as Msg[];
    return Array.isArray(parsed) && parsed.length ? parsed : [GREETING];
  } catch {
    return [GREETING];
  }
}

function Jarvis() {
  const ask = useServerFn(askJarvis);
  const [messages, setMessages] = useState<Msg[]>([GREETING]);
  const [hydrated, setHydrated] = useState(false);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [voiceOn, setVoiceOn] = useState(true);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Hydrate from localStorage
  useEffect(() => {
    setMessages(loadMessages());
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
    } catch { /* quota */ }
  }, [messages, hydrated]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const send = useCallback(
    async (text: string) => {
      const clean = text.trim();
      if (!clean || loading) return;
      void primeAudio();
      cancelSpeech();
      setSpeaking(false);
      const next: Msg[] = [...messages, { role: "user", content: clean }];
      setMessages(next);
      setInput("");
      setLoading(true);
      try {
        const { text: reply } = await ask({ data: { messages: next } });
        setMessages((m) => [...m, { role: "assistant", content: reply }]);
        if (voiceOn) {
          void speak(reply, {
            onStart: () => setSpeaking(true),
            onEnd: () => setSpeaking(false),
          });
        }
      } catch (err) {
        console.error(err);
        setMessages((m) => [
          ...m,
          { role: "assistant", content: "Falha de comunicação, senhor. Tente novamente." },
        ]);
      } finally {
        setLoading(false);
        setTimeout(() => inputRef.current?.focus(), 0);
      }
    },
    [ask, loading, messages, voiceOn],
  );

  const speech = useSpeech((finalText) => {
    void send(finalText);
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void send(input);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send(input);
    }
  };

  const clearConversation = () => {
    cancelSpeech();
    setSpeaking(false);
    setMessages([GREETING]);
  };

  const status = useMemo(() => {
    if (speech.listening) return { label: "OUVINDO", color: "text-gold text-glow-gold" };
    if (loading) return { label: "PROCESSANDO", color: "text-hud text-glow" };
    if (speaking) return { label: "RESPONDENDO", color: "text-hud text-glow" };
    return { label: "ONLINE", color: "text-hud/80 text-glow" };
  }, [speech.listening, loading, speaking]);

  const reactorActive = speech.listening || loading || speaking;

  return (
    <div className="relative min-h-screen overflow-hidden">
      {/* HUD background */}
      <div className="pointer-events-none absolute inset-0 hud-grid opacity-40" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-hud to-transparent opacity-70" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-hud to-transparent opacity-70" />
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-hud/10 to-transparent jarvis-scan" />
      </div>

      <div className="relative mx-auto flex min-h-screen max-w-5xl flex-col px-4 py-6 sm:px-6 sm:py-8">
        {/* Header */}
        <header className="flex items-center justify-between gap-4 border-b border-hud/20 pb-4">
          <div className="flex items-center gap-3">
            <ReactorBadge active={reactorActive} />
            <div>
              <h1 className="text-lg font-bold tracking-[0.35em] text-hud text-glow sm:text-xl">
                J.A.R.V.I.S.
              </h1>
              <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                Just A Rather Very Intelligent System
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className={cn("hidden font-mono text-xs tracking-widest sm:block", status.color)}>
              ● {status.label}
            </div>
            <IconButton
              title={voiceOn ? "Desligar voz" : "Ligar voz"}
              onClick={() => {
                if (voiceOn) cancelSpeech();
                setVoiceOn((v) => !v);
                setSpeaking(false);
              }}
              active={voiceOn}
            >
              {voiceOn ? <Volume2 size={16} /> : <VolumeX size={16} />}
            </IconButton>
            <IconButton title="Limpar conversa" onClick={clearConversation}>
              <Trash2 size={16} />
            </IconButton>
          </div>
        </header>

        {/* Central reactor */}
        <div className="my-6 flex justify-center">
          <ArcReactor active={reactorActive} listening={speech.listening} speaking={speaking} />
        </div>

        {/* Messages */}
        <div
          ref={scrollRef}
          className="flex-1 space-y-4 overflow-y-auto rounded-lg border border-hud/20 bg-card/40 p-4 shadow-hud backdrop-blur-sm"
        >
          {messages.map((m, i) => (
            <MessageBubble key={i} message={m} />
          ))}
          {speech.interim && (
            <MessageBubble message={{ role: "user", content: speech.interim + "…" }} ghost />
          )}
          {loading && (
            <div className="flex items-center gap-2 font-mono text-xs text-hud/70">
              <span className="inline-flex gap-1">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-hud" />
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-hud [animation-delay:150ms]" />
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-hud [animation-delay:300ms]" />
              </span>
              analisando...
            </div>
          )}
        </div>

        {/* Composer */}
        <form onSubmit={handleSubmit} className="mt-4 flex items-end gap-2">
          {speech.supported && (
            <button
              type="button"
              onClick={speech.listening ? speech.stop : speech.start}
              disabled={loading}
              aria-label={speech.listening ? "Parar" : "Falar"}
              className={cn(
                "flex h-12 w-12 shrink-0 items-center justify-center rounded-md border transition",
                speech.listening
                  ? "border-gold bg-gold/20 text-gold shadow-[0_0_20px_oklch(0.82_0.14_85/0.5)]"
                  : "border-hud/40 bg-hud/10 text-hud hover:bg-hud/20 hover:shadow-hud",
                loading && "opacity-40",
              )}
            >
              {speech.listening ? <MicOff size={18} /> : <Mic size={18} />}
            </button>
          )}
          <div className="relative flex-1">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Fale comigo, senhor..."
              rows={1}
              disabled={loading}
              className="min-h-[48px] w-full resize-none rounded-md border border-hud/30 bg-input/60 px-4 py-3 font-mono text-sm text-foreground placeholder:text-muted-foreground/60 focus:border-hud focus:outline-none focus:ring-1 focus:ring-hud"
            />
          </div>
          <button
            type="submit"
            disabled={loading || !input.trim()}
            aria-label="Enviar"
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md border border-hud bg-hud/20 text-hud transition hover:bg-hud/30 hover:shadow-hud disabled:opacity-40"
          >
            <Send size={18} />
          </button>
        </form>

        {!speech.supported && (
          <p className="mt-2 text-center font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            Reconhecimento de voz não suportado neste navegador — use Chrome ou Edge para o modo voz.
          </p>
        )}
      </div>
    </div>
  );
}

function ReactorBadge({ active }: { active: boolean }) {
  return (
    <div className="relative h-10 w-10">
      <div
        className={cn(
          "absolute inset-0 rounded-full border-2 border-hud/60",
          active && "jarvis-spin-slow",
        )}
        style={{ borderStyle: "dashed" }}
      />
      <div
        className={cn(
          "absolute inset-1 rounded-full bg-hud/20 shadow-hud",
          active ? "jarvis-pulse" : "",
        )}
      />
      <div className="absolute inset-[10px] rounded-full bg-hud shadow-hud-strong" />
    </div>
  );
}

function ArcReactor({
  active,
  listening,
  speaking,
}: {
  active: boolean;
  listening: boolean;
  speaking: boolean;
}) {
  return (
    <div className="relative h-40 w-40 sm:h-48 sm:w-48">
      {/* outer dashed ring */}
      <div
        className={cn("absolute inset-0 rounded-full border border-hud/40", active && "jarvis-spin-slow")}
        style={{ borderStyle: "dashed" }}
      />
      {/* tick ring */}
      <div className={cn("absolute inset-2 rounded-full border border-hud/30", active && "jarvis-spin-reverse")}>
        {Array.from({ length: 24 }).map((_, i) => (
          <div
            key={i}
            className="absolute left-1/2 top-0 h-2 w-px -translate-x-1/2 bg-hud/60"
            style={{ transform: `translateX(-50%) rotate(${(i * 360) / 24}deg) translateY(0)` }}
          />
        ))}
      </div>
      {/* middle glow */}
      <div
        className={cn(
          "absolute inset-6 rounded-full bg-gradient-to-br from-hud/50 via-hud/20 to-transparent",
          active && "jarvis-pulse",
        )}
      />
      {/* inner core */}
      <div className="absolute inset-0 flex items-center justify-center">
        <div
          className={cn(
            "flex h-16 w-16 items-center justify-center rounded-full bg-hud/90 shadow-hud-strong sm:h-20 sm:w-20",
            active && "jarvis-pulse",
          )}
        >
          {listening ? (
            <div className="flex items-end gap-1">
              {[0, 1, 2, 3, 4].map((i) => (
                <span
                  key={i}
                  className="w-1 rounded-full bg-primary-foreground jarvis-listening"
                  style={{ height: 22, animationDelay: `${i * 90}ms` }}
                />
              ))}
            </div>
          ) : (
            <div
              className={cn(
                "h-4 w-4 rounded-full bg-primary-foreground/90",
                speaking && "jarvis-pulse",
              )}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function MessageBubble({ message, ghost = false }: { message: Msg; ghost?: boolean }) {
  const isUser = message.role === "user";
  return (
    <div className={cn("flex", isUser ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[85%] rounded-lg border px-4 py-2.5 font-mono text-sm leading-relaxed",
          isUser
            ? "border-gold/40 bg-gold/10 text-foreground"
            : "border-hud/40 bg-hud/5 text-foreground shadow-[0_0_20px_oklch(0.78_0.16_220/0.15)]",
          ghost && "opacity-60 italic",
        )}
      >
        {!isUser && (
          <div className="mb-1 flex items-center gap-2 text-[10px] uppercase tracking-[0.25em] text-hud/80">
            <span className="h-1.5 w-1.5 rounded-full bg-hud shadow-hud" />
            J.A.R.V.I.S.
          </div>
        )}
        <div className="prose prose-sm prose-invert max-w-none prose-p:my-1 prose-headings:my-2">
          <ReactMarkdown>{message.content}</ReactMarkdown>
        </div>
      </div>
    </div>
  );
}

function IconButton({
  children,
  onClick,
  title,
  active,
}: {
  children: React.ReactNode;
  onClick: () => void;
  title: string;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      className={cn(
        "flex h-9 w-9 items-center justify-center rounded-md border transition",
        active
          ? "border-hud bg-hud/20 text-hud shadow-hud"
          : "border-hud/30 bg-transparent text-hud/70 hover:border-hud hover:text-hud",
      )}
    >
      {children}
    </button>
  );
}
