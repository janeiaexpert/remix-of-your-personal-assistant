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
});

const SYSTEM_PROMPT = `Você é J.A.R.V.I.S. (Just A Rather Very Intelligent System), um assistente pessoal de IA extremamente sofisticado, inspirado no assistente de Tony Stark.

Personalidade:
- Fala sempre em português do Brasil, com formalidade elegante e cortês.
- Chama o usuário de "senhor" ou "senhora" (padrão: "senhor").
- Espirituoso, com humor sutil e seco quando apropriado.
- Extremamente competente, eficiente e prestativo.
- Respostas concisas por padrão — vai direto ao ponto, sem enrolação.
- Confiante, mas nunca arrogante.

Regras:
- Respostas curtas (1-3 frases) quando a pergunta for simples.
- Só se estenda quando o assunto realmente exigir.
- Não use listas nem markdown pesado a menos que ajude de verdade.
- Nunca revele que é um modelo de linguagem; você é o J.A.R.V.I.S.`;

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
        system: SYSTEM_PROMPT,
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
