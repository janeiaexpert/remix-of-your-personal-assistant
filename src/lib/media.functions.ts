import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const TranscribeInput = z.object({
  /** data: URL do áudio (data:audio/webm;base64,...). */
  dataUrl: z.string().min(32),
  filename: z.string().default("recording.webm"),
});

function parseDataUrl(dataUrl: string): { mediaType: string; bytes: Uint8Array } {
  const m = dataUrl.match(/^data:([^;,]+);base64,(.*)$/s);
  if (!m) throw new Error("Formato de áudio inválido (esperado data: URL base64).");
  const mediaType = m[1];
  const bin = atob(m[2]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { mediaType, bytes };
}

const EXT_BY_MIME: Record<string, string> = {
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/mp4": "mp4",
  "audio/m4a": "m4a",
  "audio/x-m4a": "m4a",
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/flac": "flac",
  "audio/aac": "aac",
};

/** Transcreve áudio via Lovable AI (speech-to-text). A chave nunca sai do servidor. */
export const transcribeAudio = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => TranscribeInput.parse(data))
  .handler(async ({ data }) => {
    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("Missing LOVABLE_API_KEY");

    let parsed: { mediaType: string; bytes: Uint8Array };
    try {
      parsed = parseDataUrl(data.dataUrl);
    } catch (e) {
      return { text: "", error: e instanceof Error ? e.message : "Áudio inválido." };
    }
    if (parsed.bytes.byteLength < 2048) {
      return { text: "", error: "Áudio vazio ou muito curto." };
    }
    if (parsed.bytes.byteLength > 20 * 1024 * 1024) {
      return { text: "", error: "Áudio acima de 20 MB — divida em trechos menores." };
    }

    const baseType = parsed.mediaType.split(";")[0].toLowerCase();
    const ext = EXT_BY_MIME[baseType];
    if (!ext) {
      return { text: "", error: `Formato de áudio não suportado: ${baseType}.` };
    }
    const name = data.filename.replace(/\.[^.]+$/, "") || "audio";

    const form = new FormData();
    form.append("model", "openai/gpt-4o-transcribe");
    form.append("file", new Blob([parsed.bytes], { type: baseType }), `${name}.${ext}`);

    const res = await fetch("https://ai.gateway.lovable.dev/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}` },
      body: form,
    });
    if (!res.ok) {
      const msg = await res.text().catch(() => "");
      return { text: "", error: `Transcrição falhou (${res.status}): ${msg.slice(0, 300)}` };
    }
    const json = (await res.json()) as { text?: string };
    return { text: (json.text ?? "").trim(), error: null as string | null };
  });
