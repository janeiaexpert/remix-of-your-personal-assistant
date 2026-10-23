export type SearchHit = { title: string; url: string; snippet: string };
export type SearchRequest = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export function decodeSearchText(value: string): string {
  return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#(x[0-9a-f]+|\d+);/gi, (_, n: string) => {
      const code = n.toLowerCase().startsWith("x") ? parseInt(n.slice(1), 16) : Number(n);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
    })
    .replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
    .replace(/\s+/g, " ").trim();
}

function publicLink(value: string): string | null {
  try {
    const url = new URL(value, "https://duckduckgo.com");
    const target = new URL(url.searchParams.get("uddg") ?? url.toString());
    return ["http:", "https:"].includes(target.protocol) ? target.toString() : null;
  } catch { return null; }
}

export function parseSearchResults(text: string, format: "html" | "rss", limit: number): SearchHit[] {
  const results: SearchHit[] = [];
  const add = (title: string, link: string, snippet: string) => {
    const url = publicLink(decodeSearchText(link));
    const cleanTitle = decodeSearchText(title);
    if (url && cleanTitle && !results.some((hit) => hit.url === url)) {
      results.push({ title: cleanTitle, url, snippet: decodeSearchText(snippet) });
    }
  };
  if (format === "rss") {
    for (const match of text.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)) {
      const field = (name: string) => match[1].match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)<\\/${name}>`, "i"))?.[1] ?? "";
      add(field("title"), field("link"), field("description"));
    }
  } else {
    // Attribute order varies; snippets may be anchors or spans.
    for (const match of text.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
      if (!/class=["'][^"']*\bresult__a\b/.test(match[1])) continue;
      const link = match[1].match(/href=["']([^"']+)["']/i)?.[1];
      if (!link) continue;
      const tail = text.slice((match.index ?? 0) + match[0].length);
      const section = tail.split(/\bresult__a\b/)[0];
      const snippet = section.match(/<(?:a|span)\b[^>]*class=["'][^"']*result__snippet[^"']*["'][^>]*>([\s\S]*?)<\/(?:a|span)>/i)?.[1] ?? "";
      add(match[2], link, snippet);
    }
  }
  return results.slice(0, limit);
}

export async function searchWeb(query: string, maxResults = 5, request: SearchRequest = fetch) {
  const cleanQuery = query.trim();
  if (!cleanQuery) throw new Error("Informe um assunto para pesquisar.");
  const limit = Math.max(1, Math.min(10, Math.trunc(maxResults)));
  const providers = [
    { name: "DuckDuckGo", url: `https://html.duckduckgo.com/html/?${new URLSearchParams({ q: cleanQuery, kl: "br-pt" })}`, format: "html" as const },
    { name: "Bing", url: `https://www.bing.com/search?${new URLSearchParams({ q: cleanQuery, format: "rss", setlang: "pt-br", cc: "br" })}`, format: "rss" as const },
  ];
  for (const provider of providers) {
    try {
      const response = await request(provider.url, {
        headers: { Accept: "text/html,application/rss+xml,application/xml", "Accept-Language": "pt-BR,pt;q=0.9", "User-Agent": "Mozilla/5.0" },
        signal: AbortSignal.timeout(10000),
      });
      if (response.status !== 200) continue;
      const text = await response.text();
      if (/anomaly\.js|anomaly-modal|captcha/i.test(text)) continue;
      const results = parseSearchResults(text, provider.format, limit);
      if (results.length) return { results, provider: provider.name, query: cleanQuery, searchedAt: new Date().toISOString() };
    } catch { /* Try the next source on network errors and timeouts. */ }
  }
  throw new Error("Não consegui obter resultados da pesquisa: os serviços podem estar bloqueados ou indisponíveis. Tente novamente ou envie uma URL para leitura; não há resultados verificados para este pedido.");
}