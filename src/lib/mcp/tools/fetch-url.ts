import { defineTool, ToolError } from "@lovable.dev/mcp-js";
import { z } from "zod";

export default defineTool({
  name: "fetch_url",
  title: "Ler URL",
  description:
    "Baixa o conteúdo textual de uma URL http/https. HTML é convertido para texto puro. Máximo ~15 KB.",
  inputSchema: {
    url: z.string().url().describe("URL http(s) a ser lida."),
  },
  annotations: { readOnlyHint: true, openWorldHint: true },
  handler: async ({ url }) => {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new ToolError("Apenas URLs http(s) são suportadas.");
    }
    const res = await fetch(parsed.toString(), {
      headers: {
        "User-Agent": "Mozilla/5.0 (JarvisBot)",
        Accept: "text/html,application/json,text/plain,*/*",
        "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
      },
    });
    const contentType = res.headers.get("content-type") ?? "";
    const raw = await res.text();
    let body = raw;
    if (contentType.includes("html")) {
      body = raw
        .replace(/<script[\s\S]*?<\/script>/gi, "")
        .replace(/<style[\s\S]*?<\/style>/gi, "")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/\s+/g, " ")
        .trim();
    }
    const payload = { status: res.status, contentType, body: body.slice(0, 15000) };
    return {
      content: [{ type: "text", text: JSON.stringify(payload) }],
      structuredContent: payload,
    };
  },
});
