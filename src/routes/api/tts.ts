import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/tts")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const key = process.env.LOVABLE_API_KEY;
        if (!key) return new Response("Missing LOVABLE_API_KEY", { status: 500 });
        let body: { text?: string };
        try {
          body = (await request.json()) as { text?: string };
        } catch {
          return new Response("Invalid JSON", { status: 400 });
        }
        const text = body.text?.trim();
        if (!text) return new Response("Missing text", { status: 400 });

        try {
          const upstream = await fetch("https://ai.gateway.lovable.dev/v1/audio/speech", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${key}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model: "openai/gpt-4o-mini-tts",
              input: text,
              voice: "onyx",
              instructions:
                "Speak in Brazilian Portuguese, formal, calm, elegant butler tone, slightly deep, subtle British-inspired sophistication.",
              stream_format: "sse",
              response_format: "pcm",
            }),
            signal: request.signal,
          });
          if (!upstream.ok) {
            const msg = await upstream.text().catch(() => "");
            return new Response(`TTS failed: ${upstream.status} ${msg}`, { status: upstream.status });
          }
          return new Response(upstream.body, {
            headers: { "Content-Type": "text/event-stream" },
          });
        } catch (err) {
          if (request.signal.aborted) return new Response(null, { status: 499 });
          throw err;
        }
      },
    },
  },
});
