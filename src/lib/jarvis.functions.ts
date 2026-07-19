import { createServerFn } from "@tanstack/react-start";
import { generateText, stepCountIs, tool, type ModelMessage } from "ai";
import { z } from "zod";
import { createLovableAiGatewayProvider } from "./ai-gateway.server";

const InputSchema = z.object({
  // Opaque ModelMessage[] — the client owns the full transcript including
  // tool calls and tool results so we can resume multi-step loops.
  messages: z.array(z.any()).min(1),
  memories: z.array(z.string()).default([]),
  hasBridge: z.boolean().default(false),
});

const BASE_PROMPT = `Você é J.A.R.V.I.S. (Just A Rather Very Intelligent System), o assistente pessoal de IA de Tony Stark.

Personalidade:
- Sempre em português do Brasil, formalidade elegante.
- Chama o usuário de "senhor" (a menos que a memória indique o contrário).
- Espirituoso, humor seco quando cabe. Confiante, nunca arrogante.
- Respostas concisas por padrão (1-3 frases). Só se estende quando o assunto exige.

Regras:
- Nunca revele que é um modelo de linguagem; você é o J.A.R.V.I.S.
- Não use markdown pesado nem listas a menos que ajude de verdade.
- Use naturalmente o que sabe do usuário sem anunciar "de acordo com minha memória".

Ferramentas do SERVIDOR (sempre disponíveis, USE-as):
- get_datetime — data/hora atuais. Sempre que precisar de "hoje", "agora", dia da semana.
- web_search — busca web em tempo real (DuckDuckGo). Notícias, cotações, clima, eventos recentes.
- fetch_url — baixa conteúdo textual de uma URL. Combine com web_search quando precisar do artigo completo.
- run_js — JavaScript no servidor para cálculos, regex, parsing. Sem rede, sem fs.

Ferramentas LOCAIS (bridge na máquina do usuário — USE quando ele pedir ação real na máquina dele):
- shell_exec — executa comando shell na máquina do usuário (bash/zsh). É acesso REAL: ls, git, npm, cat, curl, make, python, etc. Retorna stdout/stderr/exit.
- fs_read — lê um arquivo do disco do usuário.
- fs_write — escreve/anexa um arquivo no disco do usuário.
- fs_list — lista o conteúdo de um diretório.

Regras de uso das ferramentas locais:
- Antes de comandos destrutivos (rm, mv sobre arquivos importantes, git reset --hard, drop database), pergunte confirmação ao senhor em uma frase curta.
- Comandos exploratórios (ls, cat, git status, pwd, which, --version, --help) execute direto.
- Se o senhor pedir algo que exige a máquina dele mas a bridge não está conectada, avise em uma frase e sugira rodar \`python3 agent/jarvis_agent.py\`.
- Depois de executar, resuma o resultado no seu estilo — não despeje stdout cru inteiro se for grande.

Regras gerais:
- Nunca chute datas, cotações, ou o conteúdo de arquivos — chame a ferramenta.
- Depois de qualquer ferramenta, sintetize em 1-3 frases.`;

const CLIENT_TOOL_NAMES = new Set(["shell_exec", "fs_read", "fs_write", "fs_list"]);

function buildSystem(memories: string[], hasBridge: boolean): string {
  const now = new Date();
  const dateStr = new Intl.DateTimeFormat("pt-BR", {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
    hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo",
  }).format(now);
  const header = `Contexto temporal atual: ${dateStr} (America/Sao_Paulo). ISO: ${now.toISOString()}.`;
  const bridgeLine = hasBridge
    ? "Bridge local: CONECTADA. As ferramentas shell_exec/fs_* estão operacionais na máquina do senhor."
    : "Bridge local: OFFLINE. As ferramentas shell_exec/fs_* NÃO funcionam agora — não tente usá-las; peça ao senhor para rodar 'python3 agent/jarvis_agent.py' se ele precisar.";
  const base = `${header}\n${bridgeLine}\n\n${BASE_PROMPT}`;
  if (!memories.length) return base;
  const list = memories.map((m, i) => `${i + 1}. ${m}`).join("\n");
  return `${base}\n\nMemória de longo prazo sobre o usuário:\n${list}`;
}

// ---------------------------------------------------------------------------
// DuckDuckGo web search (no API key).
// ---------------------------------------------------------------------------

type SearchHit = { title: string; url: string; snippet: string };
function decodeHtml(s: string): string {
  return s
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ")
    .replace(/&#x27;/g, "'")
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
  } catch { return href; }
}
async function duckDuckGoSearch(query: string, maxResults = 5): Promise<SearchHit[]> {
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
  if (!res.ok) throw new Error(`DuckDuckGo ${res.status}`);
  const html = await res.text();
  const hits: SearchHit[] = [];
  const re = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) && hits.length < maxResults) {
    const url = unwrapDdgUrl(m[1]);
    const title = stripTags(m[2]);
    const snippet = stripTags(m[3]);
    if (url && title) hits.push({ title, url, snippet });
  }
  return hits;
}

export const askJarvis = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => InputSchema.parse(data))
  .handler(async ({ data }) => {
    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("Missing LOVABLE_API_KEY");
    const gateway = createLovableAiGatewayProvider(key);

    const web_search = tool({
      description: "Busca web em tempo real via DuckDuckGo. Use para notícias, cotações, clima, esportes, eventos recentes. Retorna até 5 resultados.",
      inputSchema: z.object({ query: z.string().describe("Consulta otimizada.") }),
      execute: async ({ query }) => {
        try {
          const results = await duckDuckGoSearch(query, 5);
          return results.length ? { results } : { results: [], note: "Nenhum resultado." };
        } catch (e) {
          return { results: [], error: e instanceof Error ? e.message : "Falha na busca." };
        }
      },
    });

    const get_datetime = tool({
      description: "Data e hora atuais em America/Sao_Paulo e UTC.",
      inputSchema: z.object({}),
      execute: async () => {
        const now = new Date();
        return {
          iso_utc: now.toISOString(),
          sao_paulo: new Intl.DateTimeFormat("pt-BR", {
            weekday: "long", year: "numeric", month: "long", day: "numeric",
            hour: "2-digit", minute: "2-digit", second: "2-digit",
            timeZone: "America/Sao_Paulo",
          }).format(now),
          unix: Math.floor(now.getTime() / 1000),
        };
      },
    });

    const fetch_url = tool({
      description: "Baixa o conteúdo textual de uma URL http/https. HTML é convertido para texto. Máx ~15 KB.",
      inputSchema: z.object({ url: z.string().url() }),
      execute: async ({ url }) => {
        try {
          const res = await fetch(url, {
            headers: {
              "User-Agent": "Mozilla/5.0 (JarvisBot)",
              Accept: "text/html,application/json,text/plain,*/*",
              "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
            },
          });
          const ct = res.headers.get("content-type") ?? "";
          const raw = await res.text();
          let body = raw;
          if (ct.includes("html")) {
            body = raw
              .replace(/<script[\s\S]*?<\/script>/gi, "")
              .replace(/<style[\s\S]*?<\/style>/gi, "")
              .replace(/<[^>]+>/g, " ")
              .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
              .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
              .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
              .replace(/\s+/g, " ").trim();
          }
          return { status: res.status, contentType: ct, body: body.slice(0, 15000) };
        } catch (e) {
          return { error: e instanceof Error ? e.message : "Falha ao buscar URL." };
        }
      },
    });

    const run_js = tool({
      description: "Executa uma expressão ou bloco JavaScript no servidor. Sem rede, sem fs. Timeout 2s.",
      inputSchema: z.object({ code: z.string() }),
      execute: async ({ code }) => {
        try {
          const src = code.includes("return ") ? code : `return (${code});`;
          const fn = new Function(`"use strict"; ${src}`);
          const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error("Timeout 2s")), 2000),
          );
          const result = await Promise.race([Promise.resolve().then(() => fn()), timeoutPromise]);
          let serialized: unknown = result;
          try { JSON.stringify(result); } catch { serialized = String(result); }
          return { result: serialized };
        } catch (e) {
          return { error: e instanceof Error ? e.message : String(e) };
        }
      },
    });

    // -------------------------------------------------------------------
    // CLIENT-SIDE tools (no execute). The AI SDK returns their tool calls
    // in `toolCalls`; the browser executes them against the local bridge
    // and re-invokes this server function with the tool-result appended.
    // -------------------------------------------------------------------
    const shell_exec = tool({
      description: "Executa um comando shell na máquina do usuário via bridge local. Retorna {exit, stdout, stderr, cwd}. Peça confirmação antes de comandos destrutivos.",
      inputSchema: z.object({
        cmd: z.string().describe("Comando completo, ex: 'ls -la ~/Downloads'."),
        cwd: z.string().optional().describe("Diretório de trabalho absoluto."),
        timeout: z.number().optional().describe("Timeout em segundos (default 30, máx 300)."),
      }),
    });
    const fs_read = tool({
      description: "Lê um arquivo do disco do usuário via bridge local.",
      inputSchema: z.object({ path: z.string() }),
    });
    const fs_write = tool({
      description: "Escreve conteúdo em um arquivo no disco do usuário. append=true para anexar.",
      inputSchema: z.object({
        path: z.string(),
        content: z.string(),
        append: z.boolean().optional(),
      }),
    });
    const fs_list = tool({
      description: "Lista o conteúdo de um diretório na máquina do usuário.",
      inputSchema: z.object({ path: z.string() }),
    });

    try {
      const result = await generateText({
        model: gateway("google/gemini-3-flash-preview"),
        system: buildSystem(data.memories, data.hasBridge),
        messages: data.messages as ModelMessage[],
        tools: data.hasBridge
          ? { web_search, get_datetime, fetch_url, run_js, shell_exec, fs_read, fs_write, fs_list }
          : { web_search, get_datetime, fetch_url, run_js },
        stopWhen: stepCountIs(12),
      });

      const pending = result.toolCalls
        .filter((tc) => CLIENT_TOOL_NAMES.has(tc.toolName))
        .map((tc) => ({ id: tc.toolCallId, name: tc.toolName, inputJson: JSON.stringify(tc.input ?? {}) }));

      return {
        text: result.text,
        responseMessagesJson: JSON.stringify(result.response.messages),
        pending,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("429")) {
        return { text: "Perdão, senhor — circuitos sobrecarregados. Tente novamente em instantes.", responseMessagesJson: "[]", pending: [] as { id: string; name: string; inputJson: string }[] };
      }
      if (msg.includes("402")) {
        return { text: "Créditos esgotados, senhor. Recarregue no painel do Lovable.", responseMessagesJson: "[]", pending: [] as { id: string; name: string; inputJson: string }[] };
      }
      throw err;
    }
  });

// ---------------------------------------------------------------------------
// Long-term memory extraction.
// ---------------------------------------------------------------------------

const ExtractSchema = z.object({
  userMessage: z.string().min(1),
  assistantMessage: z.string().min(1),
  existingMemories: z.array(z.string()).default([]),
});

const EXTRACT_PROMPT = `Você é um extrator de memória de longo prazo para um assistente pessoal.
A partir da última troca entre o usuário e o assistente, identifique NOVOS fatos duradouros sobre o USUÁRIO.

Extraia apenas:
- Nome/apelido/como prefere ser chamado.
- Preferências pessoais (idioma, tom, gostos, hobbies).
- Contexto de vida (profissão, cidade, família, projetos, ferramentas que usa).
- Objetivos, metas ou fatos recorrentes.
- Restrições ou coisas que ele NÃO quer.

NÃO extraia: perguntas triviais, small talk, pedidos pontuais, fatos duplicados, informação sobre o mundo em geral, suposições.

Responda APENAS em JSON puro, sem markdown:
{"memories": ["fato 1", "fato 2"]}

Cada fato em português, terceira pessoa, começando por "O usuário ...".
Se não houver nada relevante, retorne {"memories": []}.`;

export const extractMemories = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => ExtractSchema.parse(data))
  .handler(async ({ data }) => {
    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("Missing LOVABLE_API_KEY");
    const gateway = createLovableAiGatewayProvider(key);

    const userContent = `Memórias existentes:\n${
      data.existingMemories.length ? data.existingMemories.map((m, i) => `${i + 1}. ${m}`).join("\n") : "(nenhuma)"
    }\n\nÚltima troca:\nUsuário: ${data.userMessage}\nAssistente: ${data.assistantMessage}\n\nExtraia novos fatos duradouros sobre o usuário.`;

    try {
      const { text } = await generateText({
        model: gateway("google/gemini-3-flash-preview"),
        system: EXTRACT_PROMPT,
        messages: [{ role: "user", content: userContent }],
      });
      const cleaned = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
      const parsed = JSON.parse(cleaned) as { memories?: unknown };
      const raw = Array.isArray(parsed.memories) ? parsed.memories : [];
      const memories = raw
        .filter((m): m is string => typeof m === "string")
        .map((m) => m.trim())
        .filter((m) => m.length > 0 && m.length <= 240);
      return { memories };
    } catch {
      return { memories: [] as string[] };
    }
  });
