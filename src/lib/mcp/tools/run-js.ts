import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";

export default defineTool({
  name: "run_js",
  title: "Executar JavaScript",
  description:
    "Executa uma expressão ou bloco JavaScript no servidor para cálculos, regex e parsing. Sem rede e sem acesso a arquivos. Timeout de 2s.",
  inputSchema: {
    code: z.string().trim().min(1).describe("Expressão ou bloco com `return`."),
  },
  annotations: { readOnlyHint: true, openWorldHint: false },
  handler: async ({ code }) => {
    try {
      const src = code.includes("return ") ? code : `return (${code});`;
      const fn = new Function(`"use strict"; ${src}`);
      const timeout = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Timeout 2s")), 2000),
      );
      const result = await Promise.race([Promise.resolve().then(() => fn()), timeout]);
      let serialized: unknown = result;
      try {
        JSON.stringify(result);
      } catch {
        serialized = String(result);
      }
      return {
        content: [{ type: "text", text: JSON.stringify({ result: serialized }) }],
        structuredContent: { result: serialized },
      };
    } catch (e) {
      return {
        content: [{ type: "text", text: e instanceof Error ? e.message : String(e) }],
        isError: true,
      };
    }
  },
});
