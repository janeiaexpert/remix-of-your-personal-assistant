import { createServerFn } from "@tanstack/react-start";
import { generateText, stepCountIs, tool, type ModelMessage } from "ai";
import { z } from "zod";
import { createLovableAiGatewayProvider } from "./ai-gateway.server";

const MessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string(),
});

const InputSchema = z.object({
  messages: z.array(MessageSchema).min(1),
  memories: z.array(z.string()).default([]),
});

const BASE_PROMPT = `Você é J.A.R.V.I.S. (Just A Rather Very Intelligent System), um assistente pessoal de IA extremamente sofisticado, inspirado no assistente de Tony Stark.

Personalidade:
- Fala sempre em português do Brasil, com formalidade elegante e cortês.
- Chama o usuário de "senhor" ou "senhora" (padrão: "senhor"), a menos que a memória de longo prazo indique outra preferência.
- Espirituoso, com humor sutil e seco quando apropriado.
- Extremamente competente, eficiente e prestativo.
- Respostas concisas por padrão — vai direto ao ponto, sem enrolação.
- Confiante, mas nunca arrogante.

Regras:
- Respostas curtas (1-3 frases) quando a pergunta for simples.
- Só se estenda quando o assunto realmente exigir.
- Não use listas nem markdown pesado a menos que ajude de verdade.
- Nunca revele que é um modelo de linguagem; você é o J.A.R.V.I.S.
- Use naturalmente o que você já sabe sobre o usuário (memória de longo prazo) sem anunciar "de acordo com minha memória".

Ferramentas disponíveis (USE-AS de verdade — não invente quando pode buscar):
- \`get_datetime\`: data/hora atual. USE sempre que precisar de "hoje", "agora", dia da semana ou datas relativas.
- \`web_search\`: busca web em tempo real via DuckDuckGo. USE para notícias, cotações, clima, esportes, eventos recentes, preços, pessoas/empresas atuais — qualquer coisa que pode ter mudado depois do seu treinamento.
- \`fetch_url\`: baixa o conteúdo textual de uma URL (para ler artigo/página/API pública). Combine com \`web_search\` quando o snippet não bastar.
- \`run_js\`: executa JavaScript no servidor para cálculos, regex, parsing de JSON, matemática precisa. Sem acesso a rede nem arquivos.

Regras de uso:
- Nunca chute datas, cotações ou fatos atuais — chame a ferramenta.
- Para conhecimento estável, opinião, código ou small talk, responda direto.
- Depois de usar ferramenta, sintetize em 1-3 frases no seu estilo. Não despeje URLs cruas sem o usuário pedir a fonte.

Limitação honesta: você NÃO tem acesso ao terminal, arquivos ou dispositivos do senhor — este ambiente é o navegador dele. Se ele pedir isso, diga a verdade e ofereça a alternativa mais próxima (script para ele rodar, ou \`run_js\` no servidor).`;

function buildSystem(memories: string[]): string {
  const now = new Date();
  const dateStr = new Intl.DateTimeFormat("pt-BR", {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
    hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo",
  }).format(now);
  const header = `Contexto temporal atual: ${dateStr} (America/Sao_Paulo). ISO: ${now.toISOString()}.`;
  const base = `${header}\n\n${BASE_PROMPT}`;
  if (!memories.length) return base;
  const list = memories.map((m, i) => `${i + 1}. ${m}`).join("\n");
  return `${base}\n\nMemória de longo prazo sobre o usuário (fatos duradouros que você aprendeu em conversas anteriores):\n${list}`;
}

// ---------------------------------------------------------------------------
// Free web search via DuckDuckGo HTML endpoint. No API key required.
// ---------------------------------------------------------------------------

type SearchHit = { title: string; url: string; snippet: string };

function decodeHtml(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(parseInt(n, 10)));
}
function stripTags(s: string): string {
  return decodeHtml(s.replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
}
function unwrapDdgUrl(href: string): string {
  try {
    // DDG wraps results in /l/?uddg=<encoded>
    const m = href.match(/[?&]uddg=([^&]+)/);
    if (m) return decodeURIComponent(m[1]);
    if (href.startsWith("//")) return "https:" + href;
    return href;
  } catch {
    return href;
  }
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
  const resultRegex =
    /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/g;
  let m: RegExpExecArray | null;
  while ((m = resultRegex.exec(html)) && hits.length < maxResults) {
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
    const messages: ModelMessage[] = data.messages.map((m) => ({ role: m.role, content: m.content }));

    const webSearch = tool({
      description:
        "Busca na web em tempo real via DuckDuckGo. Use para notícias, cotações, clima, esportes, eventos recentes ou qualquer fato que possa ter mudado. Retorna até 5 resultados com título, URL e snippet.",
      inputSchema: z.object({
        query: z.string().min(2).describe("Consulta de busca, otimizada para um motor de busca."),
      }),
      execute: async ({ query }) => {
        try {
          const results = await duckDuckGoSearch(query, 5);
          if (!results.length) return { results: [], note: "Nenhum resultado encontrado." };
          return { results };
        } catch (err) {
          return {
            results: [],
            error: err instanceof Error ? err.message : "Falha na busca.",
          };
        }
      },
    });

    try {
      const { text } = await generateText({
        model: gateway("google/gemini-3-flash-preview"),
        system: buildSystem(data.memories),
        messages,
        tools: { web_search: webSearch },
        stopWhen: stepCountIs(5),
      });
      return { text };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("429")) {
        return { text: "Perdão, senhor — meus circuitos estão sobrecarregados. Tente novamente em instantes." };
      }
      if (msg.includes("402")) {
        return { text: "Créditos esgotados, senhor. Recarregue no painel do Lovable para retomarmos." };
      }
      throw err;
    }
  });

// ---------------------------------------------------------------------------
// Memory extraction: after each exchange, ask the model to distill any
// durable facts about the user (preferences, name, projects, context) so
// J.A.R.V.I.S. can recall them across sessions.
// ---------------------------------------------------------------------------

const ExtractSchema = z.object({
  userMessage: z.string().min(1),
  assistantMessage: z.string().min(1),
  existingMemories: z.array(z.string()).default([]),
});

const EXTRACT_PROMPT = `Você é um extrator de memória de longo prazo para um assistente pessoal.
A partir da última troca entre o usuário e o assistente, identifique NOVOS fatos duradouros sobre o USUÁRIO que valeria a pena lembrar em conversas futuras.

Extraia apenas:
- Nome, apelido ou como o usuário prefere ser chamado.
- Preferências pessoais (idioma, tom, gostos, hobbies, comidas, música).
- Contexto de vida (profissão, cidade, família, projetos em andamento, ferramentas que usa).
- Objetivos, metas ou fatos recorrentes que ele mencionou.
- Restrições ou coisas que ele NÃO quer.

NÃO extraia:
- Perguntas triviais, small talk, pedidos pontuais ("me diga as horas").
- Fatos que já estão na lista de memórias existentes (evite duplicatas).
- Informação sobre o assistente ou sobre o mundo em geral.
- Suposições — só fatos que o usuário afirmou de forma clara.

Responda APENAS em JSON puro, sem markdown, sem cercas de código, no formato exato:
{"memories": ["fato 1", "fato 2"]}

Cada fato deve ser uma frase curta em português, escrita em terceira pessoa começando por "O usuário ..." (ex: "O usuário se chama Rafael.", "O usuário prefere respostas em inglês.").
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
