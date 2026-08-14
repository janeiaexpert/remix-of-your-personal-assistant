import { createParser } from "eventsource-parser";
import { flushSync } from "react-dom";

export const TARGET_W = 1024;
export const TARGET_H = 1280; // 4:5

type Payload =
  | { type: "image_generation.partial_image"; b64_json: string; partial_image_index: number }
  | { type: "image_generation.completed"; b64_json: string }
  | { type: "error"; error: { message: string } };

/** Stream de geração de imagem: entrega cada quadro (parcial e final) como data URL. */
export async function streamImage(
  prompt: string,
  onFrame: (dataUrl: string, isFinal: boolean) => void,
): Promise<void> {
  const res = await fetch("/api/generate-image", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt }),
  });
  if (!res.ok || !res.body) {
    throw new Error(`Falha na geração (${res.status}): ${await res.text().catch(() => "")}`);
  }

  let sawAny = false;
  let sawCompleted = false;
  let streamError: string | undefined;

  const parser = createParser({
    onEvent(event) {
      let payload: Payload | undefined;
      try { payload = JSON.parse(event.data) as Payload; } catch { /* ignore */ }
      if (event.event === "error" || payload?.type === "error") {
        sawAny = true;
        streamError =
          (payload as { error?: { message?: string } } | undefined)?.error?.message ??
          "Geração de imagem falhou";
        return;
      }
      if (
        event.event !== "image_generation.partial_image" &&
        event.event !== "image_generation.completed"
      ) return;
      if (!payload || !("b64_json" in payload)) return;
      sawAny = true;
      const isFinal = event.event === "image_generation.completed";
      flushSync(() => {
        onFrame(`data:image/png;base64,${payload.b64_json}`, isFinal);
      });
      if (isFinal) sawCompleted = true;
    },
  });

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      parser.feed(value);
    }
  } finally {
    reader.cancel().catch(() => {});
  }

  if (streamError) throw new Error(streamError);
  if (!sawAny) {
    const replay = await fetch("/api/generate-image", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, stream: false }),
    });
    if (!replay.ok) throw new Error(`Falha na geração (${replay.status})`);
    const json = (await replay.json()) as { data?: { b64_json?: string }[] };
    const b64 = json.data?.[0]?.b64_json;
    if (!b64) throw new Error("Nenhuma imagem retornada");
    onFrame(`data:image/png;base64,${b64}`, true);
    return;
  }
  if (!sawCompleted) throw new Error("Stream terminou sem a imagem final");
}

/** Normaliza qualquer imagem para PNG exato 1024x1280 (4:5), recorte central "cover". */
export async function toPng45(dataUrl: string): Promise<{ dataUrl: string; blob: Blob }> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.crossOrigin = "anonymous";
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error("Não foi possível ler a imagem gerada."));
    el.src = dataUrl;
  });

  const canvas = document.createElement("canvas");
  canvas.width = TARGET_W;
  canvas.height = TARGET_H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas indisponível neste navegador.");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  const scale = Math.max(TARGET_W / img.width, TARGET_H / img.height);
  const w = img.width * scale;
  const h = img.height * scale;
  ctx.drawImage(img, (TARGET_W - w) / 2, (TARGET_H - h) / 2, w, h);

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Falha ao gerar PNG."))), "image/png");
  });
  return { dataUrl: canvas.toDataURL("image/png"), blob };
}

export function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  return /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

/**
 * Baixa o PNG. Em iPhone/iPad usa a folha de compartilhamento (Salvar Imagem);
 * no desktop/Android usa download direto.
 */
export async function downloadPng(blob: Blob, filename: string): Promise<"shared" | "downloaded"> {
  const file = new File([blob], filename, { type: "image/png" });
  const nav = navigator as Navigator & {
    canShare?: (d: { files?: File[] }) => boolean;
    share?: (d: { files?: File[]; title?: string }) => Promise<void>;
  };
  if (isIOS() && nav.canShare?.({ files: [file] }) && nav.share) {
    await nav.share({ files: [file], title: filename });
    return "shared";
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return "downloaded";
}
