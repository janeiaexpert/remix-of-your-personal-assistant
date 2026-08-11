// Captura da tela/câmera do computador e utilidades de anexos multimídia.

export type Attachment = {
  id: string;
  kind: "image" | "video" | "audio" | "pdf" | "file";
  name: string;
  mediaType: string;
  /** data: URL (upload/screenshot) ou URL http(s) pública (link). */
  url: string;
  fromLink?: boolean;
  /** bytes (quando conhecido). */
  size?: number;
  /** Transcrição (áudio) ou texto auxiliar enviado ao modelo. */
  transcript?: string;
  /** Quadros extraídos de vídeo (data: URLs de imagem) enviados ao modelo. */
  frames?: string[];
  /** Nota exibida na UI (ex.: "3 quadros analisados"). */
  note?: string;
};

export function newId() {
  return Math.random().toString(36).slice(2, 10);
}

export const MAX_BYTES = {
  image: 12 * 1024 * 1024,
  video: 60 * 1024 * 1024,
  audio: 20 * 1024 * 1024,
  pdf: 18 * 1024 * 1024,
  file: 8 * 1024 * 1024,
} as const;

export const ACCEPT_ATTR =
  "image/*,video/*,audio/*,application/pdf,text/plain,text/markdown,text/csv,application/json";

const IMAGE_OK = ["image/png", "image/jpeg", "image/webp", "image/gif", "image/heic", "image/heif"];
const TEXTY_OK = ["text/plain", "text/markdown", "text/csv", "application/json", "text/x-markdown"];

export function formatBytes(n?: number): string {
  if (!n && n !== 0) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function kindFromMime(mime: string, url = ""): Attachment["kind"] {
  const m = (mime || "").toLowerCase();
  if (m === "application/pdf") return "pdf";
  if (m.startsWith("image/")) return "image";
  if (m.startsWith("video/")) return "video";
  if (m.startsWith("audio/")) return "audio";
  if (/\.(png|jpe?g|gif|webp|bmp|svg|heic|heif)(\?|$)/i.test(url)) return "image";
  if (/\.(mp4|webm|mov|m4v|avi|mkv)(\?|$)/i.test(url)) return "video";
  if (/\.(mp3|wav|m4a|ogg|opus|flac|aac|webm)(\?|$)/i.test(url)) return "audio";
  if (/\.pdf(\?|$)/i.test(url)) return "pdf";
  return "file";
}

export function guessMimeFromUrl(url: string): string {
  const m = url.toLowerCase().match(
    /\.(png|jpe?g|gif|webp|bmp|svg|heic|heif|mp4|webm|mov|m4v|mp3|wav|m4a|ogg|opus|flac|aac|pdf|txt|md|csv|json)(\?|$)/,
  );
  if (!m) return "application/octet-stream";
  const ext = m[1];
  const map: Record<string, string> = {
    png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
    webp: "image/webp", bmp: "image/bmp", svg: "image/svg+xml",
    heic: "image/heic", heif: "image/heif",
    mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime", m4v: "video/x-m4v",
    mp3: "audio/mpeg", wav: "audio/wav", m4a: "audio/mp4", ogg: "audio/ogg",
    opus: "audio/ogg", flac: "audio/flac", aac: "audio/aac",
    pdf: "application/pdf",
    txt: "text/plain", md: "text/markdown", csv: "text/csv", json: "application/json",
  };
  return map[ext] ?? "application/octet-stream";
}

/** Retorna null se aceito, ou a mensagem de erro para o senhor. */
export function validateFile(file: File): string | null {
  const mediaType = (file.type || guessMimeFromUrl(file.name)).toLowerCase();
  const kind = kindFromMime(mediaType, file.name);
  if (kind === "file" && !TEXTY_OK.includes(mediaType)) {
    return `${file.name}: formato não suportado (${mediaType || "desconhecido"}). Aceito: imagem, vídeo, áudio, PDF ou texto.`;
  }
  if (kind === "image" && !IMAGE_OK.includes(mediaType)) {
    return `${file.name}: imagem em formato não suportado (${mediaType}). Use PNG, JPEG, WEBP, GIF ou HEIC.`;
  }
  const max = MAX_BYTES[kind];
  if (file.size > max) {
    return `${file.name}: ${formatBytes(file.size)} excede o limite de ${formatBytes(max)} para ${kind}.`;
  }
  if (file.size === 0) return `${file.name}: arquivo vazio.`;
  return null;
}

export function fileToDataUrl(file: File | Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result));
    fr.onerror = () => reject(new Error("Falha ao ler arquivo"));
    fr.readAsDataURL(file);
  });
}

export function fileToText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result));
    fr.onerror = () => reject(new Error("Falha ao ler texto"));
    fr.readAsText(file);
  });
}

// --- Screen share -----------------------------------------------------------

export async function startScreenShare(): Promise<MediaStream> {
  const md = navigator.mediaDevices as MediaDevices & {
    getDisplayMedia?: (c: MediaStreamConstraints) => Promise<MediaStream>;
  };
  if (!md?.getDisplayMedia) throw new Error("Este navegador não suporta captura de tela.");
  return md.getDisplayMedia({ video: true, audio: false });
}

// --- Câmera -----------------------------------------------------------------

export async function startCamera(facing: "user" | "environment" = "user"): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error("Câmera indisponível neste navegador.");
  return navigator.mediaDevices.getUserMedia({
    video: { facingMode: facing, width: { ideal: 1280 } },
    audio: false,
  });
}

export async function captureFrame(stream: MediaStream, maxWidth = 1280): Promise<string> {
  const video = document.createElement("video");
  video.muted = true;
  video.srcObject = stream;
  await video.play();
  // aguarda dimensões reais
  for (let i = 0; i < 30 && !video.videoWidth; i++) {
    await new Promise((r) => setTimeout(r, 50));
  }
  const w = video.videoWidth || 1280;
  const h = video.videoHeight || 720;
  const scale = Math.min(1, maxWidth / w);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas indisponível");
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  video.pause();
  video.srcObject = null;
  return canvas.toDataURL("image/jpeg", 0.7);
}

// --- Vídeo: extração de quadros --------------------------------------------

/**
 * Extrai `count` quadros distribuídos ao longo do vídeo como data: URLs JPEG.
 * O modelo analisa os quadros (imagens), pois vídeo bruto não é aceito no chat.
 */
export async function extractVideoFrames(
  source: File | string,
  count = 4,
  maxWidth = 900,
): Promise<string[]> {
  const url = typeof source === "string" ? source : URL.createObjectURL(source);
  const video = document.createElement("video");
  video.muted = true;
  video.crossOrigin = "anonymous";
  video.preload = "auto";
  video.src = url;

  const frames: string[] = [];
  try {
    await new Promise<void>((resolve, reject) => {
      const to = setTimeout(() => reject(new Error("Tempo esgotado ao ler o vídeo.")), 20000);
      video.onloadedmetadata = () => { clearTimeout(to); resolve(); };
      video.onerror = () => { clearTimeout(to); reject(new Error("Não foi possível decodificar o vídeo.")); };
    });

    const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
    const w = video.videoWidth || 640;
    const h = video.videoHeight || 360;
    const scale = Math.min(1, maxWidth / w);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(h * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas indisponível");

    const times = duration
      ? Array.from({ length: count }, (_, i) => (duration * (i + 0.5)) / count)
      : [0];

    for (const t of times) {
      await new Promise<void>((resolve, reject) => {
        const to = setTimeout(() => reject(new Error("Tempo esgotado ao extrair quadro.")), 15000);
        video.onseeked = () => { clearTimeout(to); resolve(); };
        video.onerror = () => { clearTimeout(to); reject(new Error("Falha ao extrair quadro.")); };
        video.currentTime = Math.min(t, Math.max(0, duration - 0.05));
      });
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      frames.push(canvas.toDataURL("image/jpeg", 0.7));
    }
  } finally {
    video.src = "";
    if (typeof source !== "string") URL.revokeObjectURL(url);
  }
  return frames;
}
