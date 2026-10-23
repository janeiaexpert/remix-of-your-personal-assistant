import { defineTool, ToolError } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { searchWeb } from "../../web-search";

export default defineTool({
  name: "web_search",
  title: "Busca web",
  description:
    "Pesquisa assuntos na internet em tempo real com fontes e links, com alternativa automática se a primeira fonte falhar.",
  inputSchema: {
    query: z.string().trim().min(1).describe("Consulta de busca otimizada."),
    max_results: z.number().int().min(1).max(10).optional().describe("Máximo de resultados (default 5)."),
  },
  annotations: { readOnlyHint: true, openWorldHint: true },
  handler: async ({ query, max_results }) => {
    let payload;
    try { payload = await searchWeb(query, max_results ?? 5); }
    catch (error) { throw new ToolError(error instanceof Error ? error.message : "Falha na pesquisa."); }
    return {
      content: [{ type: "text", text: JSON.stringify(payload) }],
      structuredContent: payload,
    };
  },
});
