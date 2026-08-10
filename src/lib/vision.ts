// Captura da tela do computador (screen share) e utilidades de anexos.

export type Attachment = {
  id: string;
  kind: "image" | "video" | "file";
  name: string;
  mediaType: string;
  /** data: URL (upload/screenshot) ou URL http(s) pública (link). */
  url: string;
  fromLink?: boolean;
};

export function newId() {
  return Math.random().toString(36).slice(2, 10);
}

export function kindFromMime(mime: string, url = ""): Attachment["kind"] {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (/\.(png|jpe?g|gif|webp|bmp|svg)(\?|$)/i.test(url)) return "image";
  if (/\.(mp4|webm|mov|m4v|avi|mkv)(\?|$)/i.test(url)) return "video";
  return "file";
}

export function guessMimeFromUrl(url: string): string {
  const m = url.toLowerCase().match(/\.(png|jpe?g|gif|webp|bmp|svg|mp4|webm|mov|m4v|pdf)(\?|$)/);
  if (!m) return "application/octet-stream";
  const ext = m[1];
  const map: Record<string, string> = {
    png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
    webp: "image/webp", bmp: "image/bmp", svg: "image/svg+xml",
    mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime", m4v: "video/x-m4v",
    pdf: "application/pdf",
  };
  return map[ext] ?? "application/octet-stream";
}

export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result));
    fr.onerror = () => reject(new Error("Falha ao ler arquivo"));
    fr.readAsDataURL(file);
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
