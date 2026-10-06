export type Skill = { id: string; name: string; instructions: string; builtin?: boolean };

export const BUILTIN_SKILLS: Skill[] = [
  {
    id: "site",
    name: "Criar site",
    builtin: true,
    instructions:
      "Para sites: gere HTML5 semântico, CSS moderno e responsivo (mobile first) e JS puro. Arquivos: index.html, styles.css, script.js (+ outras páginas se pedido). Visual caprichado, tipografia elegante, sem placeholders 'lorem'. Entregue SEMPRE via build_project.",
  },
  {
    id: "app",
    name: "Criar aplicativo",
    builtin: true,
    instructions:
      "Para aplicativos web: app de página única em index.html + app.js + styles.css, com estado em localStorage, telas navegáveis, layout de celular, funcionando sem servidor. Entregue via build_project. Para apps maiores na máquina do senhor, proponha um plano e use shell_exec (ex.: npm create vite) passo a passo.",
  },
  {
    id: "system",
    name: "Criar sistema / API",
    builtin: true,
    instructions:
      "Para sistemas e APIs: planeje módulos, modelo de dados e rotas. Gere código real (ex.: Node/Express ou Python/FastAPI) com README e instruções de execução, entregue via build_project. Inclua uma página index.html de painel/demonstração quando fizer sentido.",
  },
  {
    id: "landing",
    name: "Landing page",
    builtin: true,
    instructions:
      "Para landing pages: seções herói, benefícios, prova social, preços e CTA. Copy persuasivo em português. Entregue via build_project.",
  },
];

const CUSTOM_KEY = "jarvis:skills:custom:v1";
const ACTIVE_KEY = "jarvis:skills:active:v1";

export function loadCustomSkills(): Skill[] {
  if (typeof window === "undefined") return [];
  try {
    const v = JSON.parse(localStorage.getItem(CUSTOM_KEY) || "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
export function saveCustomSkills(s: Skill[]) {
  try { localStorage.setItem(CUSTOM_KEY, JSON.stringify(s)); } catch { /* */ }
}
export function loadActiveSkills(): string[] {
  if (typeof window === "undefined") return BUILTIN_SKILLS.map((s) => s.id);
  try {
    const v = localStorage.getItem(ACTIVE_KEY);
    return v ? JSON.parse(v) : BUILTIN_SKILLS.map((s) => s.id);
  } catch {
    return BUILTIN_SKILLS.map((s) => s.id);
  }
}
export function saveActiveSkills(ids: string[]) {
  try { localStorage.setItem(ACTIVE_KEY, JSON.stringify(ids)); } catch { /* */ }
}
