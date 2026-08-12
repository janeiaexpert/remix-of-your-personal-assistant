import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";

export default defineTool({
  name: "get_datetime",
  title: "Data e hora atuais",
  description:
    "Retorna a data e hora atuais em UTC e no fuso America/Sao_Paulo. Use sempre que precisar de 'hoje' ou 'agora'.",
  inputSchema: {},
  annotations: { readOnlyHint: true, openWorldHint: false },
  handler: () => {
    const now = new Date();
    const payload = {
      iso_utc: now.toISOString(),
      sao_paulo: new Intl.DateTimeFormat("pt-BR", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        timeZone: "America/Sao_Paulo",
      }).format(now),
      unix: Math.floor(now.getTime() / 1000),
    };
    return {
      content: [{ type: "text", text: JSON.stringify(payload) }],
      structuredContent: payload,
    };
  },
});
