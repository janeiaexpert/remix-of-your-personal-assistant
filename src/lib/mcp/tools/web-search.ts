import { defineTool, ToolError } from "@lovable.dev/mcp-js";
import { z } from "zod";

type SearchHit = { title: string; url: string; snippet: string };

function decodeHtml(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(parseInt(n, 10)));
}

function stripTags(s: string): string {
  return decodeHtml(s.replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
}

function unwrapDdgUrl(href: string): string {
  try {
    const m = href.match(/[?&]uddg=([^&]+)/);
    if (m) return decodeURIComponent(m[1]);
    if (href.startsWith("//")) return "https:" + href;
    return href;
  } catch {
    return href;
  }
}

export default defineTool({
  name: "web_search",
  title: "Busca web",
  description:
    "Busca web em tempo real via DuckDuckGo (sem chave de API). Use para notícias, cotações, clima, esportes e eventos recentes.",
  inputSchema: {
    query: z.string().trim().min(1).describe("Consulta de busca otimizada."),
    max_results: z.number().int().min(1).max(10).optional().describe("Máximo de resultados (default 5)."),
  },
  annotations: { readOnlyHint: true, openWorldHint: true },
  handler: async ({ query, max_results }) => {
    const limit = max_results ?? 5;
    const res = await fetch("https://html.duckduckgo.com/html/", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36",
        "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
      },
      body: new URLSearchParams({ q: query, kl: "br-pt" }).toString(),
    });
    if (!res.ok) throw new ToolError(`Falha na busca (DuckDuckGo ${res.status}).`);
    const html = await res.text();
    const hits: SearchHit[] = [];
    const re =
      /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) && hits.length < limit) {
      const url = unwrapDdgUrl(m[1]);
      const title = stripTags(m[2]);
      const snippet = stripTags(m[3]);
      if (url && title) hits.push({ title, url, snippet });
    }
    return {
      content: [{ type: "text", text: JSON.stringify({ results: hits }) }],
      structuredContent: { results: hits },
    };
  },
});
