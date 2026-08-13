import { defineMcp } from "@lovable.dev/mcp-js";
import getDatetimeTool from "./tools/get-datetime";
import webSearchTool from "./tools/web-search";
import fetchUrlTool from "./tools/fetch-url";
import runJsTool from "./tools/run-js";

export default defineMcp({
  name: "remix-of-your-personal-assistant",
  title: "Remix of Your Personal Assistant",
  version: "0.1.0",
  instructions:
    "Ferramentas do J.A.R.V.I.S.: `get_datetime` para data/hora atuais (America/Sao_Paulo e UTC), `web_search` para busca web em tempo real via DuckDuckGo, `fetch_url` para ler o texto de uma página, e `run_js` para cálculos e parsing determinísticos. Nenhuma ferramenta acessa dados privados do usuário.",
  tools: [getDatetimeTool, webSearchTool, fetchUrlTool, runJsTool],
});
