import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import ReactMarkdown from "react-markdown";
import {
  Mic, MicOff, Send, Volume2, VolumeX, Trash2, Brain, X, Plus, Plug, PlugZap, QrCode,
  Paperclip, Monitor, MonitorOff, Link2, FileVideo, FileText, Radio, Camera, Music, Aperture, ImagePlus,
} from "lucide-react";
import { askJarvis, extractMemories } from "@/lib/jarvis.functions";
import { transcribeAudio } from "@/lib/media.functions";
import { useSpeech, speak, cancelSpeech, primeAudio } from "@/lib/speech";
import { loadBridge, saveBridge, loadBridgeDraft, saveBridgeDraft, health, runTool, pairingUrl, readPairingFromHash, type BridgeConfig } from "@/lib/bridge";
import {
  type Attachment, newId, kindFromMime, guessMimeFromUrl, fileToDataUrl, fileToText,
  startScreenShare, captureFrame, startCamera, extractVideoFrames,
  validateFile, formatBytes, ACCEPT_ATTR,
} from "@/lib/vision";
import { useWake, type WakeMode } from "@/lib/wake";

import QRCode from "qrcode";
import { cn } from "@/lib/utils";

type Msg = { role: "user" | "assistant"; content: string; attachments?: Attachment[] };
const STORAGE_KEY = "jarvis:conversation:v1";
const MEMORY_KEY = "jarvis:memories:v1";
const WAKE_KEY = "jarvis:wake:v1";
const MAX_MEMORIES = 60;
const GREETING: Msg = {
  role: "assistant",
  content: "Sistemas online. Ao seu dispor, senhor. Em que posso ajudá-lo?",
};


function loadMemories(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(MEMORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((m): m is string => typeof m === "string") : [];
  } catch {
    return [];
  }
}

function normalize(s: string) {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}
function isMobileDevice() {
  if (typeof navigator === "undefined") return false;
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
}
function isLoopback(url: string) {
  return /^(https?:\/\/)?(127\.0\.0\.1|localhost)(:\d+)?\/?$/i.test(url.trim());
}
function isHttpUrl(url: string) {
  return /^http:\/\//i.test(url.trim());
}
function pageIsHttps() {
  return typeof window !== "undefined" && window.location.protocol === "https:";
}

function mergeMemories(existing: string[], incoming: string[]): string[] {
  const seen = new Set(existing.map(normalize));
  const merged = [...existing];
  for (const m of incoming) {
    const n = normalize(m);
    if (n && !seen.has(n)) {
      seen.add(n);
      merged.push(m);
    }
  }
  return merged.slice(-MAX_MEMORIES);
}

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
  const extract = useServerFn(extractMemories);
  const transcribe = useServerFn(transcribeAudio);

  const [messages, setMessages] = useState<Msg[]>([GREETING]);
  const [memories, setMemories] = useState<string[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [voiceOn, setVoiceOn] = useState(true);
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [newMemory, setNewMemory] = useState("");
  const [bridge, setBridge] = useState<BridgeConfig | null>(null);
  const [bridgeStatus, setBridgeStatus] = useState<"offline" | "online" | "error">("offline");
  const [bridgeOpen, setBridgeOpen] = useState(false);
  const [bridgeUrl, setBridgeUrl] = useState("http://127.0.0.1:7842");
  const [bridgeToken, setBridgeToken] = useState("");
  const [bridgeError, setBridgeError] = useState<string | null>(null);
  const [isMobile, setIsMobile] = useState(false);
  const [toolLog, setToolLog] = useState<string[]>([]);
  const [qrImage, setQrImage] = useState<string | null>(null);
  const [qrOpen, setQrOpen] = useState(false);
  const [qrMode, setQrMode] = useState<"lan" | "tunnel">("lan");
  const [tunnelUrl, setTunnelUrl] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [attachOpen, setAttachOpen] = useState(false);
  const [linkInput, setLinkInput] = useState("");
  const [screenOn, setScreenOn] = useState(false);
  const [screenError, setScreenError] = useState<string | null>(null);
  const [wakeMode, setWakeMode] = useState<WakeMode>("off");
  const [wakeOpen, setWakeOpen] = useState(false);

  const bridgeRef = useRef<BridgeConfig | null>(null);
  const memoriesRef = useRef<string[]>([]);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);

  useEffect(() => { memoriesRef.current = memories; }, [memories]);


  // Hydrate from localStorage
  useEffect(() => {
    setIsMobile(isMobileDevice());
    setMessages(loadMessages());
    setMemories(loadMemories());
    try {
      const w = window.localStorage.getItem(WAKE_KEY);
      if (w === "word" || w === "clap" || w === "both") setWakeMode(w);
    } catch { /* ignore */ }

    const paired = readPairingFromHash();
    const b = paired ?? loadBridge();
    const draft = loadBridgeDraft();
    if (draft && !paired) {
      setBridgeUrl(draft.url);
      setBridgeToken(draft.token);
    }
    if (b) {
      setBridgeUrl(b.url);
      setBridgeToken(b.token);
      if (paired) {
        setBridgeOpen(true);
        setBridgeError(null);
      } else {
        setBridge(b);
        bridgeRef.current = b;
      }
      void health(b)
        .then(() => {
          setBridge(b);
          bridgeRef.current = b;
          saveBridge(b);
          setBridgeStatus("online");
        })
        .catch((e: unknown) => {
          setBridgeStatus("error");
          if (paired) setBridgeError(e instanceof Error ? e.message : "Falha ao conectar");
        });
    }
    setHydrated(true);
  }, []);


  useEffect(() => { bridgeRef.current = bridge; }, [bridge]);

  // Persist o que foi digitado no painel (URL + token), mesmo sem conexão OK
  useEffect(() => {
    if (!hydrated) return;
    saveBridgeDraft({ url: bridgeUrl, token: bridgeToken });
  }, [bridgeUrl, bridgeToken, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    // Não persistimos data: URLs nem quadros (estouram a quota) — apenas o rótulo.
    const slim = messages.map((m) => ({
      ...m,
      attachments: m.attachments?.map((a) => ({
        ...a,
        url: a.url.startsWith("data:") ? "" : a.url,
        frames: undefined,
        transcript: a.transcript ? a.transcript.slice(0, 2000) : undefined,
      })),
    }));

    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(slim)); } catch { /* quota */ }
  }, [messages, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    try { window.localStorage.setItem(MEMORY_KEY, JSON.stringify(memories)); } catch { /* quota */ }
  }, [memories, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    try { window.localStorage.setItem(WAKE_KEY, wakeMode); } catch { /* quota */ }
  }, [wakeMode, hydrated]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading]);

  useEffect(() => { inputRef.current?.focus(); }, []);

  // --- Anexos --------------------------------------------------------------
  const addFiles = useCallback(async (files: FileList | null) => {
    if (!files?.length) return;
    setScreenError(null);
    const errors: string[] = [];
    for (const file of Array.from(files).slice(0, 6)) {
      const invalid = validateFile(file);
      if (invalid) { errors.push(invalid); continue; }

      const mediaType = (file.type || guessMimeFromUrl(file.name)).toLowerCase();
      const kind = kindFromMime(mediaType, file.name);
      const id = newId();
      const base: Attachment = { id, kind, name: file.name, mediaType, url: "", size: file.size };

      try {
        if (kind === "file") {
          // Texto simples: extraímos o conteúdo (o modelo não aceita o binário).
          const text = await fileToText(file);
          setAttachments((a) => [
            ...a,
            { ...base, transcript: text.slice(0, 40000), note: "texto extraído" },
          ]);
          continue;
        }

        const url = await fileToDataUrl(file);

        if (kind === "audio") {
          setAttachments((a) => [...a, { ...base, url, note: "transcrevendo…" }]);
          const res = await transcribe({ data: { dataUrl: url, filename: file.name } });
          if (res.error || !res.text) {
            setAttachments((a) => a.filter((x) => x.id !== id));
            errors.push(`${file.name}: ${res.error ?? "não foi possível transcrever."}`);
            setScreenError(errors.join(" • "));
            continue;
          }
          setAttachments((a) =>
            a.map((x) => (x.id === id ? { ...x, transcript: res.text, note: "transcrito" } : x)),
          );
          continue;
        }

        if (kind === "video") {
          setAttachments((a) => [...a, { ...base, url, note: "extraindo quadros…" }]);
          try {
            const frames = await extractVideoFrames(file, 4);
            setAttachments((a) =>
              a.map((x) =>
                x.id === id ? { ...x, frames, note: `${frames.length} quadros analisados` } : x,
              ),
            );
          } catch (e) {
            // Codec não suportado pelo navegador: mantemos o anexo e avisamos o modelo.
            setAttachments((a) =>
              a.map((x) =>
                x.id === id
                  ? { ...x, note: "quadros indisponíveis neste navegador" }
                  : x,
              ),
            );
            errors.push(
              `${file.name}: não consegui extrair quadros (${e instanceof Error ? e.message : "codec"}) — descreva o vídeo ou envie um print.`,
            );
          }
          continue;
        }

        // Imagem ou PDF: vão direto ao modelo no formato nativo.
        setAttachments((a) => [...a, { ...base, url }]);
      } catch (e) {
        errors.push(`${file.name}: ${e instanceof Error ? e.message : "falha ao processar."}`);
      }
    }
    if (errors.length) setScreenError(errors.join(" • "));
  }, [transcribe]);

  const addLink = useCallback(async () => {
    const url = linkInput.trim();
    if (!/^https?:\/\//i.test(url)) { setScreenError("Cole um link http(s) válido."); return; }
    const mediaType = guessMimeFromUrl(url);
    const kind = kindFromMime(mediaType, url);
    const id = newId();
    const name = url.split("/").pop() || url;
    setLinkInput("");
    setScreenError(null);

    if (kind === "video") {
      setAttachments((a) => [
        ...a,
        { id, kind, name, mediaType, url, fromLink: true, note: "extraindo quadros…" },
      ]);
      try {
        const frames = await extractVideoFrames(url, 4);
        setAttachments((a) =>
          a.map((x) => (x.id === id ? { ...x, frames, note: `${frames.length} quadros analisados` } : x)),
        );
      } catch {
        setAttachments((a) =>
          a.map((x) =>
            x.id === id
              ? { ...x, kind: "file", note: "vídeo remoto sem acesso direto — analisarei pela URL" }
              : x,
          ),
        );
      }
      return;
    }

    if (kind === "audio") {
      setAttachments((a) => [...a, { id, kind, name, mediaType, url, fromLink: true, note: "baixando…" }]);
      try {
        const blob = await fetch(url).then((r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.blob();
        });
        const dataUrl = await fileToDataUrl(blob);
        const res = await transcribe({ data: { dataUrl, filename: name } });
        if (res.error || !res.text) throw new Error(res.error ?? "sem transcrição");
        setAttachments((a) =>
          a.map((x) => (x.id === id ? { ...x, size: blob.size, transcript: res.text, note: "transcrito" } : x)),
        );
      } catch (e) {
        setAttachments((a) => a.filter((x) => x.id !== id));
        setScreenError(`${name}: não foi possível transcrever o áudio remoto (${e instanceof Error ? e.message : "erro"}).`);
      }
      return;
    }

    setAttachments((a) => [...a, { id, kind, name, mediaType, url, fromLink: true }]);
  }, [linkInput, transcribe]);

  const removeAttachment = (id: string) =>
    setAttachments((a) => a.filter((x) => x.id !== id));

  // --- Câmera --------------------------------------------------------------
  const takePhoto = useCallback(async () => {
    setScreenError(null);
    let stream: MediaStream | null = null;
    try {
      stream = await startCamera(isMobile ? "environment" : "user");
      const url = await captureFrame(stream, 1280);
      setAttachments((a) => [
        ...a,
        { id: newId(), kind: "image", name: `foto-${Date.now()}.jpg`, mediaType: "image/jpeg", url, note: "câmera" },
      ]);
    } catch (e) {
      setScreenError(e instanceof Error ? e.message : "Câmera indisponível.");
    } finally {
      stream?.getTracks().forEach((t) => t.stop());
    }
  }, [isMobile]);


  // --- Visão da tela -------------------------------------------------------
  const stopScreen = useCallback(() => {
    screenStreamRef.current?.getTracks().forEach((t) => t.stop());
    screenStreamRef.current = null;
    setScreenOn(false);
  }, []);

  const toggleScreen = useCallback(async () => {
    if (screenOn) { stopScreen(); return; }
    setScreenError(null);
    try {
      const stream = await startScreenShare();
      stream.getVideoTracks()[0]?.addEventListener("ended", () => {
        screenStreamRef.current = null;
        setScreenOn(false);
      });
      screenStreamRef.current = stream;
      setScreenOn(true);
    } catch (e) {
      setScreenError(e instanceof Error ? e.message : "Captura de tela cancelada.");
      setScreenOn(false);
    }
  }, [screenOn, stopScreen]);

  const grabScreenshot = useCallback(async (): Promise<Attachment | null> => {
    const stream = screenStreamRef.current;
    if (!stream) return null;
    try {
      const url = await captureFrame(stream);
      return { id: newId(), kind: "image", name: "tela-atual.jpg", mediaType: "image/jpeg", url };
    } catch {
      return null;
    }
  }, []);

  useEffect(() => () => stopScreen(), [stopScreen]);




  const testBridge = useCallback(async () => {
    const cfg = { url: bridgeUrl.trim().replace(/\/$/, ""), token: bridgeToken.trim() };
    if (!cfg.url || !cfg.token) { setBridgeError("URL e token obrigatórios"); return; }
    setBridgeError(null);
    try {
      await health(cfg);
      setBridge(cfg); bridgeRef.current = cfg; saveBridge(cfg); setBridgeStatus("online");
    } catch (e) {
      setBridgeStatus("error");
      setBridgeError(e instanceof Error ? e.message : "Falha ao conectar");
    }
  }, [bridgeUrl, bridgeToken]);

  const disconnectBridge = useCallback(() => {
    setBridge(null); bridgeRef.current = null; saveBridge(null); setBridgeStatus("offline");
  }, []);

  // QR code de pareamento (URL + token) para escanear no celular.
  // Modo "lan": IP local via http (só funciona se a página também for http).
  // Modo "tunnel": URL https de um túnel (cloudflared/ngrok) apontando para o agente.
  const qrTarget = (qrMode === "tunnel" ? tunnelUrl : bridgeUrl).trim().replace(/\/$/, "");
  useEffect(() => {
    if (!qrOpen) { setQrImage(null); return; }
    const token = bridgeToken.trim();
    if (!qrTarget || !token) { setQrImage(null); return; }
    let alive = true;
    void QRCode.toDataURL(pairingUrl({ url: qrTarget, token }), {
      width: 320,
      margin: 1,
      errorCorrectionLevel: "M",
      color: { dark: "#0b1622", light: "#ffffff" },
    })
      .then((data) => { if (alive) setQrImage(data); })
      .catch(() => { if (alive) setQrImage(null); });
    return () => { alive = false; };
  }, [qrOpen, qrTarget, bridgeToken]);



  const send = useCallback(
    async (text: string) => {
      const clean = text.trim();
      if ((!clean && attachments.length === 0) || loading) return;
      void primeAudio();
      cancelSpeech();
      setSpeaking(false);
      const shot = screenOn ? await grabScreenshot() : null;
      const outgoing: Attachment[] = shot ? [...attachments, shot] : attachments;
      const userMsg: Msg = {
        role: "user",
        content: clean || (outgoing.length ? "(anexo)" : ""),
        ...(outgoing.length ? { attachments: outgoing } : {}),
      };
      const displayNext: Msg[] = [...messages, userMsg];
      setMessages(displayNext);
      setInput("");
      setAttachments([]);
      setAttachOpen(false);
      setLoading(true);
      setToolLog([]);
      try {
        const currentMemories = memoriesRef.current;
        // Build initial ModelMessage[] from the visible transcript (multimodal).
        let modelMessages: unknown[] = displayNext.map((m) => {
          const atts = m.attachments ?? [];
          if (m.role !== "user" || !atts.length) return { role: m.role, content: m.content };
          const parts: unknown[] = [{ type: "text", text: m.content }];
          for (const a of atts) {
            if (a.kind === "image" && a.url) {
              parts.push({ type: "image", image: a.url });
            } else if (a.kind === "pdf" && a.url) {
              parts.push({ type: "file", data: a.url, mediaType: "application/pdf", filename: a.name });
            } else if (a.kind === "video") {
              // Vídeo bruto não é aceito no chat: enviamos os quadros extraídos.
              for (const f of a.frames ?? []) parts.push({ type: "image", image: f });
              parts.push({
                type: "text",
                text: a.frames?.length
                  ? `[Vídeo "${a.name}": ${a.frames.length} quadros acima, em ordem cronológica.]`
                  : `[Vídeo "${a.name}" em ${a.url} — não consegui extrair quadros; use fetch_url/web_search se ajudar.]`,
              });
            } else if (a.kind === "audio") {
              parts.push({
                type: "text",
                text: a.transcript
                  ? `[Áudio "${a.name}" — transcrição]\n${a.transcript}`
                  : `[Áudio "${a.name}" sem transcrição disponível.]`,
              });
            } else if (a.transcript) {
              parts.push({ type: "text", text: `[Arquivo "${a.name}"]\n${a.transcript}` });
            } else if (a.url) {
              parts.push({ type: "text", text: `[Link para análise: ${a.url}] Use fetch_url para ler o conteúdo.` });
            }
          }
          return { role: "user", content: parts };
        });


        let finalText = "";
        const MAX_ROUNDS = 6;
        for (let round = 0; round < MAX_ROUNDS; round++) {
          const cfg = bridgeRef.current;
          const res = await ask({
            data: {
              messages: modelMessages,
              memories: currentMemories,
              hasBridge: !!cfg && bridgeStatus === "online",
            },
          });
          finalText = res.text || finalText;
          const responseMsgs = JSON.parse(res.responseMessagesJson) as unknown[];
          modelMessages = [...modelMessages, ...responseMsgs];
          if (!res.pending.length) break;
          if (!cfg) {
            finalText = "A bridge local está offline, senhor — não posso tocar na sua máquina agora. Rode `python3 agent/jarvis_agent.py` e cole a URL + token no painel do plug.";
            break;
          }
          const toolResults = await Promise.all(
            res.pending.map(async (call) => {
              let input: Record<string, unknown> = {};
              try { input = JSON.parse(call.inputJson) as Record<string, unknown>; } catch { /* */ }
              setToolLog((l) => [...l, `▶ ${call.name} ${JSON.stringify(input).slice(0, 120)}`]);
              try {
                const output = await runTool(cfg, call.name, input);
                return { toolCallId: call.id, toolName: call.name, output };
              } catch (e) {
                return {
                  toolCallId: call.id, toolName: call.name,
                  output: { error: e instanceof Error ? e.message : String(e) },
                };
              }
            }),
          );
          modelMessages.push({
            role: "tool",
            content: toolResults.map((r) => ({
              type: "tool-result",
              toolCallId: r.toolCallId,
              toolName: r.toolName,
              output: { type: "json", value: r.output },
            })),
          });
        }
        const reply = finalText || "…";
        setMessages((m) => [...m, { role: "assistant", content: reply }]);
        if (voiceOn) {
          void speak(reply, { onStart: () => setSpeaking(true), onEnd: () => setSpeaking(false) });
        }
        void extract({
          data: { userMessage: clean, assistantMessage: reply, existingMemories: currentMemories },
        })
          .then(({ memories: found }) => {
            if (found.length) setMemories((prev) => mergeMemories(prev, found));
          })
          .catch(() => { /* silent */ });
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
    [ask, extract, loading, messages, voiceOn, bridgeStatus, attachments, screenOn, grabScreenshot],
  );


  const speech = useSpeech((finalText) => {
    void send(finalText);
  });

  // Ativação por "JARVIS" ou duas palmas: liga o microfone principal.
  const wake = useWake({
    mode: wakeMode,
    paused: speech.listening || loading || speaking,
    onWake: () => {
      void primeAudio();
      if (!speech.listening) speech.start();
    },
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
    if (wakeMode !== "off" && wake.armed) return { label: "AGUARDANDO “JARVIS”", color: "text-hud/80 text-glow" };
    return { label: "ONLINE", color: "text-hud/80 text-glow" };
  }, [speech.listening, loading, speaking, wakeMode, wake.armed]);

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
          <div className="flex flex-wrap items-center justify-end gap-2">
            <div className={cn("hidden font-mono text-xs tracking-widest sm:block", status.color)}>
              ● {status.label}
            </div>
            <IconButton
              title={wakeMode === "off" ? "Ativação por voz/palmas (desligada)" : `Ativação: ${wakeMode}`}
              onClick={() => setWakeOpen((o) => !o)}
              active={wakeMode !== "off"}
            >
              <Radio size={16} />
            </IconButton>
            <IconButton
              title={screenOn ? "Parar visão da tela" : "Ativar visão da tela"}
              onClick={() => void toggleScreen()}
              active={screenOn}
            >
              {screenOn ? <Monitor size={16} /> : <MonitorOff size={16} />}
            </IconButton>
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

            <IconButton
              title={`Memória (${memories.length})`}
              onClick={() => setMemoryOpen((o) => !o)}
              active={memoryOpen || memories.length > 0}
            >
              <Brain size={16} />
            </IconButton>
            <IconButton
              title={`Bridge local (${bridgeStatus})`}
              onClick={() => setBridgeOpen((o) => !o)}
              active={bridgeStatus === "online"}
            >
              {bridgeStatus === "online" ? <PlugZap size={16} /> : <Plug size={16} />}
            </IconButton>
            <IconButton title="Limpar conversa" onClick={clearConversation}>
              <Trash2 size={16} />
            </IconButton>
          </div>
        </header>

        {wakeOpen && (
          <div className="mt-4 rounded-lg border border-hud/30 bg-card/60 p-4 shadow-hud backdrop-blur-sm">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-mono text-xs uppercase tracking-[0.3em] text-hud text-glow">
                Ativação sem as mãos
              </h2>
              <button type="button" onClick={() => setWakeOpen(false)} className="text-hud/60 hover:text-hud">
                <X size={14} />
              </button>
            </div>
            <p className="mb-3 font-mono text-[10px] leading-relaxed text-muted-foreground">
              Escolha como me chamar, senhor: dizendo <span className="text-hud">“JARVIS”</span>, batendo{" "}
              <span className="text-hud">duas palmas</span>, ou os dois. O microfone fica escutando em segundo
              plano neste navegador e abre a captação de voz automaticamente.
            </p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {([
                { v: "off", label: "Desligado" },
                { v: "word", label: "Palavra “Jarvis”" },
                { v: "clap", label: "Duas palmas" },
                { v: "both", label: "Ambos" },
              ] as { v: WakeMode; label: string }[]).map((o) => (
                <button
                  key={o.v}
                  type="button"
                  onClick={() => { void primeAudio(); setWakeMode(o.v); }}
                  className={cn(
                    "rounded border px-2 py-2 font-mono text-[10px] transition",
                    wakeMode === o.v
                      ? "border-hud bg-hud/15 text-hud shadow-hud"
                      : "border-hud/25 text-muted-foreground hover:text-hud",
                  )}
                >
                  {o.label}
                </button>
              ))}
            </div>
            <p className="mt-3 font-mono text-[10px] text-muted-foreground">
              Estado:{" "}
              <span className={wake.armed ? "text-hud" : "text-muted-foreground"}>
                {wakeMode === "off" ? "inativo" : wake.armed ? "escutando gatilho" : "iniciando…"}
              </span>
              {wake.claps === 1 && <span className="text-gold"> • uma palma detectada…</span>}
            </p>
            {wake.error && <p className="mt-1 font-mono text-[10px] text-gold">{wake.error}</p>}
          </div>
        )}



        {bridgeOpen && (
          <div className="mt-4 rounded-lg border border-hud/30 bg-card/60 p-4 shadow-hud backdrop-blur-sm">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-mono text-xs uppercase tracking-[0.3em] text-hud text-glow">
                Bridge local — {bridgeStatus}
              </h2>
              <button type="button" onClick={() => setBridgeOpen(false)} className="text-hud/60 hover:text-hud">
                <X size={14} />
              </button>
            </div>
            {isMobile ? (
              <>
                <p className="mb-3 font-mono text-[10px] leading-relaxed text-muted-foreground">
                  <span className="text-gold">Aviso móvel:</span> o navegador do celular não acessa o localhost da sua estação de trabalho.
                  Para usar a bridge a partir deste dispositivo, rode o agente com acesso à rede local:
                </p>
                <pre className="mb-3 overflow-x-auto rounded border border-hud/20 bg-black/50 p-2 font-mono text-[10px] text-hud/90">
                  JARVIS_HOST=0.0.0.0 python3 agent/jarvis_agent.py
                </pre>
                <p className="mb-3 font-mono text-[10px] leading-relaxed text-muted-foreground">
                  Cole abaixo o <strong>endereço IP local</strong> do seu computador (ex: <code className="text-hud">http://192.168.1.50:7842</code>), não 127.0.0.1.
                </p>
                {isLoopback(bridgeUrl) && (
                  <p className="mb-3 font-mono text-[10px] text-gold">
                    ⚠ O campo URL está como localhost. Troque pelo IP local do computador onde o agente está rodando.
                  </p>
                )}
              </>
            ) : (
              <p className="mb-3 font-mono text-[10px] leading-relaxed text-muted-foreground">
                Rode <code className="text-hud">python3 agent/jarvis_agent.py</code> na sua máquina, cole a URL e o token abaixo, e o Jarvis passa a executar shell/arquivos aí.
              </p>
            )}
            <div className="mb-2 flex gap-2">
              <input
                value={bridgeUrl}
                onChange={(e) => setBridgeUrl(e.target.value)}
                placeholder="http://127.0.0.1:7842"
                className="flex-1 rounded border border-hud/30 bg-input/60 px-3 py-2 font-mono text-xs text-foreground focus:border-hud focus:outline-none"
              />
            </div>
            <div className="mb-2 flex gap-2">
              <input
                value={bridgeToken}
                onChange={(e) => setBridgeToken(e.target.value)}
                placeholder="token (do terminal do agent)"
                className="flex-1 rounded border border-hud/30 bg-input/60 px-3 py-2 font-mono text-xs text-foreground focus:border-hud focus:outline-none"
              />
            </div>
            {bridgeError && (
              <p className="mb-2 font-mono text-[10px] text-gold">{bridgeError}</p>
            )}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => void testBridge()}
                className="rounded border border-hud/40 bg-hud/10 px-3 py-1.5 font-mono text-xs text-hud hover:bg-hud/20"
              >
                Testar / conectar
              </button>
              <button
                type="button"
                onClick={() => setQrOpen((o) => !o)}
                disabled={!bridgeToken.trim()}
                className="flex items-center gap-1.5 rounded border border-hud/40 px-3 py-1.5 font-mono text-xs text-hud hover:bg-hud/10 disabled:opacity-40"
              >
                <QrCode size={13} /> {qrOpen ? "Ocultar QR" : "QR p/ celular"}
              </button>
              {bridge && (
                <button
                  type="button"
                  onClick={disconnectBridge}
                  className="rounded border border-hud/30 px-3 py-1.5 font-mono text-xs text-muted-foreground hover:text-gold"
                >
                  Desconectar
                </button>
              )}
            </div>
            {qrOpen && (
              <div className="mt-3 rounded border border-hud/20 bg-black/40 p-3">
                <div className="mb-3 flex gap-2">
                  <button
                    type="button"
                    onClick={() => setQrMode("lan")}
                    className={`flex-1 rounded border px-2 py-1.5 font-mono text-[10px] ${qrMode === "lan" ? "border-hud bg-hud/15 text-hud" : "border-hud/25 text-muted-foreground hover:text-hud"}`}
                  >
                    Rede local (http)
                  </button>
                  <button
                    type="button"
                    onClick={() => setQrMode("tunnel")}
                    className={`flex-1 rounded border px-2 py-1.5 font-mono text-[10px] ${qrMode === "tunnel" ? "border-hud bg-hud/15 text-hud" : "border-hud/25 text-muted-foreground hover:text-hud"}`}
                  >
                    Túnel (https)
                  </button>
                </div>

                {qrMode === "lan" ? (
                  <p className="mb-3 font-mono text-[10px] leading-relaxed text-muted-foreground">
                    Usa o endereço do campo URL acima (ex: <code className="text-hud">http://192.168.1.50:7842</code>).
                    Rode o agente com <code className="text-hud">JARVIS_HOST=0.0.0.0</code>.
                    {pageIsHttps() && isHttpUrl(qrTarget) && (
                      <span className="mt-1 block text-gold">
                        ⚠ Esta página está em https, então o celular vai bloquear chamadas http (conteúdo misto). Use a aba
                        “Túnel (https)” ou abra o Jarvis por http na rede local.
                      </span>
                    )}
                  </p>
                ) : (
                  <>
                    <p className="mb-2 font-mono text-[10px] leading-relaxed text-muted-foreground">
                      Abra um túnel https para o agente local e cole a URL pública abaixo. Duas opções gratuitas:
                    </p>
                    <pre className="mb-1 overflow-x-auto rounded border border-hud/20 bg-black/50 p-2 font-mono text-[10px] text-hud/90">
{`# 1) Cloudflare Tunnel (sem conta)
cloudflared tunnel --url http://127.0.0.1:7842`}
                    </pre>
                    <pre className="mb-2 overflow-x-auto rounded border border-hud/20 bg-black/50 p-2 font-mono text-[10px] text-hud/90">
{`# 2) ngrok (conta gratuita)
ngrok http 7842`}
                    </pre>
                    <input
                      value={tunnelUrl}
                      onChange={(e) => setTunnelUrl(e.target.value)}
                      placeholder="https://algo-aleatorio.trycloudflare.com"
                      className="mb-2 w-full rounded border border-hud/30 bg-input/60 px-3 py-2 font-mono text-xs text-foreground focus:border-hud focus:outline-none"
                    />
                    <div className="mb-3 flex gap-2">
                      <button
                        type="button"
                        onClick={() => setBridgeUrl(qrTarget)}
                        disabled={!qrTarget}
                        className="rounded border border-hud/40 px-2 py-1 font-mono text-[10px] text-hud hover:bg-hud/10 disabled:opacity-40"
                      >
                        Usar também nesta máquina
                      </button>
                    </div>
                    {isHttpUrl(qrTarget) && (
                      <p className="mb-2 font-mono text-[10px] text-gold">
                        ⚠ A URL do túnel precisa começar com https:// para funcionar no celular.
                      </p>
                    )}
                  </>
                )}

                {!qrTarget ? (
                  <p className="font-mono text-[10px] text-muted-foreground">
                    {qrMode === "tunnel" ? "Cole a URL do túnel para gerar o QR." : "Preencha a URL da bridge acima."}
                  </p>
                ) : qrImage ? (
                  <div className="flex flex-col items-center gap-2">
                    <img
                      src={qrImage}
                      alt="QR code de pareamento da bridge local do J.A.R.V.I.S."
                      className="h-44 w-44 rounded bg-white p-1"
                    />
                    <p className="text-center font-mono text-[10px] leading-relaxed text-muted-foreground">
                      Escaneie com a câmera do celular — o Jarvis abre já com endereço e token preenchidos e tenta conectar.
                    </p>
                    <p className="break-all text-center font-mono text-[10px] text-hud/70">{qrTarget}</p>
                    {qrMode === "lan" && isLoopback(qrTarget) && (
                      <p className="text-center font-mono text-[10px] text-gold">
                        ⚠ A URL é localhost: o celular não vai alcançar. Troque pelo IP local (ex: http://192.168.1.50:7842).
                      </p>
                    )}
                  </div>
                ) : (
                  <p className="font-mono text-[10px] text-muted-foreground">Gerando QR…</p>
                )}
              </div>
            )}


            {toolLog.length > 0 && (
              <div className="mt-3 max-h-32 overflow-y-auto rounded border border-hud/20 bg-black/40 p-2 font-mono text-[10px] text-hud/80">
                {toolLog.map((l, i) => (<div key={i}>{l}</div>))}
              </div>
            )}
          </div>
        )}

        {memoryOpen && (
          <MemoryPanel
            memories={memories}
            newMemory={newMemory}
            setNewMemory={setNewMemory}
            onAdd={() => {
              const v = newMemory.trim();
              if (!v) return;
              setMemories((prev) => mergeMemories(prev, [v]));
              setNewMemory("");
            }}
            onRemove={(idx) => setMemories((prev) => prev.filter((_, i) => i !== idx))}
            onClear={() => setMemories([])}
            onClose={() => setMemoryOpen(false)}
          />
        )}

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
        {(attachments.length > 0 || attachOpen || screenOn || screenError) && (
          <div className="mt-4 rounded-md border border-hud/25 bg-card/50 p-3 backdrop-blur-sm">
            {screenOn && (
              <p className="mb-2 flex items-center gap-2 font-mono text-[10px] text-hud">
                <Camera size={12} /> Visão de tela ativa — um print atual acompanha cada mensagem.
              </p>
            )}
            {attachOpen && (
              <div className="mb-2 flex flex-col gap-2 sm:flex-row">
                <div className="flex flex-1 items-center gap-2">
                  <Link2 size={14} className="shrink-0 text-hud/70" />
                  <input
                    value={linkInput}
                    onChange={(e) => setLinkInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addLink(); } }}
                    placeholder="Cole um link de imagem, vídeo, áudio, PDF ou página (https://...)"
                    className="min-w-0 flex-1 rounded border border-hud/30 bg-input/60 px-3 py-2 font-mono text-xs text-foreground focus:border-hud focus:outline-none"
                  />
                </div>
                <button
                  type="button"
                  onClick={addLink}
                  className="shrink-0 rounded border border-hud/40 bg-hud/10 px-3 py-2 font-mono text-[10px] text-hud hover:bg-hud/20"
                >
                  Anexar link
                </button>
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  className="shrink-0 rounded border border-hud/40 px-3 py-2 font-mono text-[10px] text-hud hover:bg-hud/10"
                >
                  Escolher arquivos
                </button>
              </div>
            )}
            {attachments.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {attachments.map((a) => (
                  <div
                    key={a.id}
                    className="group relative flex items-center gap-2 rounded border border-hud/30 bg-hud/5 px-2 py-1.5"
                  >
                    {a.kind === "image" && a.url ? (
                      <img src={a.url} alt={a.name} className="h-10 w-10 rounded object-cover" />
                    ) : a.kind === "video" && a.frames?.[0] ? (
                      <img src={a.frames[0]} alt={a.name} className="h-10 w-10 rounded object-cover" />
                    ) : a.kind === "video" ? (
                      <FileVideo size={16} className="text-hud" />
                    ) : a.kind === "audio" ? (
                      <Music size={16} className="text-hud" />
                    ) : (
                      <FileText size={16} className="text-hud" />
                    )}
                    <span className="flex min-w-0 flex-col">
                      <span className="max-w-[150px] truncate font-mono text-[10px] text-foreground/80">
                        {a.name}
                      </span>
                      <span className="font-mono text-[9px] text-hud/60">
                        {[a.kind, formatBytes(a.size), a.note].filter(Boolean).join(" · ")}
                      </span>
                    </span>
                    <button
                      type="button"
                      onClick={() => removeAttachment(a.id)}
                      aria-label="Remover anexo"
                      className="text-hud/60 hover:text-gold"
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            {screenError && <p className="mt-2 font-mono text-[10px] text-gold">{screenError}</p>}
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-3 flex items-center gap-2">
          <input
            ref={fileRef}
            type="file"
            multiple
            accept={ACCEPT_ATTR}
            className="hidden"
            onChange={(e) => { void addFiles(e.target.files); e.target.value = ""; }}
          />
          <button
            type="button"
            onClick={() => void takePhoto()}
            aria-label="Tirar foto com a câmera"
            title="Tirar foto com a câmera"
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md border border-hud/40 bg-hud/10 text-hud transition hover:bg-hud/20 hover:shadow-hud"
          >
            <Aperture size={18} />
          </button>

          <button
            type="button"
            onClick={() => setAttachOpen((o) => !o)}
            aria-label="Anexar arquivo ou link"
            title="Anexar imagem, vídeo, áudio, PDF, texto ou link"
            className={cn(
              "flex h-12 w-12 shrink-0 items-center justify-center rounded-md border transition",
              attachOpen || attachments.length
                ? "border-hud bg-hud/20 text-hud shadow-hud"
                : "border-hud/40 bg-hud/10 text-hud hover:bg-hud/20 hover:shadow-hud",
            )}
          >
            <Paperclip size={18} />
          </button>
          {speech.supported && (
            <button
              type="button"
              onClick={() => {
                void primeAudio();
                if (speech.listening) speech.stop();
                else speech.start();
              }}
              disabled={loading}
              aria-label={speech.listening ? "Parar" : "Falar"}
              title={speech.listening ? "Parar de ouvir" : "Falar"}
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
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Fale comigo, senhor..."
            rows={1}
            disabled={loading}
            className="h-12 min-w-0 flex-1 resize-none rounded-md border border-hud/30 bg-input/60 px-4 py-3 font-mono text-sm leading-6 text-foreground placeholder:text-muted-foreground/60 focus:border-hud focus:outline-none focus:ring-1 focus:ring-hud"
          />
          <button
            type="submit"
            disabled={loading || (!input.trim() && attachments.length === 0)}
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
        {message.attachments && message.attachments.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {message.attachments.map((a) => (
              <div key={a.id} className="flex items-center gap-1.5 rounded border border-hud/25 bg-hud/5 px-2 py-1">
                {a.kind === "image" && a.url ? (
                  <img src={a.url} alt={a.name} className="h-12 w-12 rounded object-cover" />
                ) : a.kind === "video" ? (
                  <FileVideo size={14} className="text-hud" />
                ) : a.kind === "audio" ? (
                  <Music size={14} className="text-hud" />
                ) : (
                  <FileText size={14} className="text-hud" />
                )}
                <span className="max-w-[120px] truncate font-mono text-[10px] text-foreground/70">{a.name}</span>
              </div>
            ))}
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

function MemoryPanel({
  memories,
  newMemory,
  setNewMemory,
  onAdd,
  onRemove,
  onClear,
  onClose,
}: {
  memories: string[];
  newMemory: string;
  setNewMemory: (v: string) => void;
  onAdd: () => void;
  onRemove: (idx: number) => void;
  onClear: () => void;
  onClose: () => void;
}) {
  return (
    <div className="mt-4 rounded-lg border border-hud/30 bg-card/60 p-4 shadow-hud backdrop-blur-sm">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Brain size={14} className="text-hud" />
          <h2 className="font-mono text-xs uppercase tracking-[0.3em] text-hud text-glow">
            Memória de longo prazo
          </h2>
          <span className="font-mono text-[10px] text-muted-foreground">
            {memories.length} fato{memories.length === 1 ? "" : "s"}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {memories.length > 0 && (
            <button
              type="button"
              onClick={onClear}
              className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground hover:text-gold"
            >
              esquecer tudo
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="text-hud/60 hover:text-hud"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      <p className="mb-3 font-mono text-[10px] leading-relaxed text-muted-foreground">
        Fatos duradouros sobre você que o J.A.R.V.I.S. lembra em toda conversa. Salvos apenas neste
        navegador. Ele extrai automaticamente do que você conta, e você pode editar à vontade.
      </p>

      {memories.length === 0 ? (
        <p className="mb-3 font-mono text-xs italic text-muted-foreground/70">
          Nenhuma memória ainda — conte algo sobre você e ela aparecerá aqui.
        </p>
      ) : (
        <ul className="mb-3 max-h-56 space-y-1.5 overflow-y-auto pr-1">
          {memories.map((m, i) => (
            <li
              key={i}
              className="group flex items-start justify-between gap-2 rounded border border-hud/20 bg-hud/5 px-3 py-2 font-mono text-xs text-foreground/90"
            >
              <span className="flex-1 leading-relaxed">{m}</span>
              <button
                type="button"
                onClick={() => onRemove(i)}
                aria-label="Esquecer"
                className="mt-0.5 shrink-0 text-hud/40 opacity-60 transition hover:text-gold group-hover:opacity-100"
              >
                <X size={12} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          onAdd();
        }}
        className="flex items-center gap-2"
      >
        <input
          value={newMemory}
          onChange={(e) => setNewMemory(e.target.value)}
          placeholder="Adicionar um fato manualmente..."
          className="flex-1 rounded border border-hud/30 bg-input/60 px-3 py-2 font-mono text-xs text-foreground placeholder:text-muted-foreground/60 focus:border-hud focus:outline-none"
        />
        <button
          type="submit"
          disabled={!newMemory.trim()}
          aria-label="Adicionar memória"
          className="flex h-9 w-9 items-center justify-center rounded border border-hud/40 bg-hud/10 text-hud transition hover:bg-hud/20 disabled:opacity-40"
        >
          <Plus size={14} />
        </button>
      </form>
    </div>
  );
}
