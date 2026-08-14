import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/generate-image")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { prompt, stream = true } = (await request.json()) as {
          prompt: string;
          stream?: boolean;
        };
        const key = process.env["LOVABLE_API_KEY"];
        if (!key) return new Response("Missing LOVABLE_API_KEY", { status: 500 });
        if (!prompt || typeof prompt !== "string") {
          return new Response("Missing prompt", { status: 400 });
        }

        const full = `${prompt.trim()}

Requisitos técnicos obrigatórios da imagem:
- Proporção estritamente 4:5 (retrato vertical, 1024x1280).
- Composição completa dentro do quadro 4:5, sem cortes no assunto principal.
- Máxima nitidez e qualidade fotográfica/ilustrativa, iluminação coerente.
- Sem bordas brancas, sem molduras, sem marcas d'água, sem texto sobreposto.`;

        const upstream = await fetch("https://ai.gateway.lovable.dev/v1/images/generations", {
          method: "POST",
          headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "google/gemini-3-pro-image",
            messages: [{ role: "user", content: full }],
            modalities: ["image", "text"],
            ...(stream ? { stream: true } : {}),
          }),
        });
        if (!upstream.ok || !upstream.body) {
          return new Response(await upstream.text(), { status: upstream.status });
        }
        if (!stream) {
          return new Response(upstream.body, { headers: { "Content-Type": "application/json" } });
        }
        return new Response(upstream.body, {
          headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
        });
      },
    },
  },
});
