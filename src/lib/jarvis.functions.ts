import { createServerFn } from "@tanstack/react-start";
import { generateText, type ModelMessage } from "ai";
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
- Use naturalmente o que você já sabe sobre o usuário (memória de longo prazo) sem anunciar "de acordo com minha memória".`;

function buildSystem(memories: string[]): string {
  if (!memories.length) return BASE_PROMPT;
  const list = memories.map((m, i) => `${i + 1}. ${m}`).join("\n");
  return `${BASE_PROMPT}\n\nMemória de longo prazo sobre o usuário (fatos duradouros que você aprendeu em conversas anteriores):\n${list}`;
}

export const askJarvis = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => InputSchema.parse(data))
  .handler(async ({ data }) => {
    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("Missing LOVABLE_API_KEY");

    const gateway = createLovableAiGatewayProvider(key);
    const messages: ModelMessage[] = data.messages.map((m) => ({ role: m.role, content: m.content }));

    try {
      const { text } = await generateText({
        model: gateway("google/gemini-3-flash-preview"),
        system: buildSystem(data.memories),
        messages,
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
