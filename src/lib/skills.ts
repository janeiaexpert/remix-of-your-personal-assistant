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
  {
    id: "keyboard",
    name: "Escrever com o teclado",
    builtin: true,
    instructions:
      "Quando o senhor pedir para escrever num programa do computador (Word, Bloco de Notas, e-mail, WhatsApp): 1) abra o app com open_app se não estiver aberto; 2) avise em uma frase para ele clicar onde o texto deve entrar; 3) use type_text com o texto completo e, se pedido, keys 'enter' ou 'ctrl+s'. Requer bridge conectada.",
  },
  {
    id: "video",
    name: "Criar/editar vídeo (Remotion)",
    builtin: true,
    instructions:
      "Para vídeos de até 30s (renderizados GRÁTIS na máquina do senhor, requer bridge + Node 18+ + Python): " +
      "1) Escreva um roteiro curto em pt-BR (cenas de 3-6s, total <= 30s) e confirme em 1 frase. " +
      "2) Use build_project com um projeto Remotion completo: package.json (remotion, @remotion/cli, react, react-dom; script \"render\": \"remotion render src/index.ts Main out/video.mp4\"), src/index.ts (registerRoot), src/Root.tsx (Composition 'Main', 30fps, 1080x1920 vertical salvo pedido diferente, durationInFrames = segundos*30), src/Main.tsx com <Sequence> por cena e <Audio src={staticFile('narracao.mp3')}/>. " +
      "Movimento fluido: spring() e interpolate() com easing em entradas, saídas, escala, parallax e textos palavra por palavra (estilo hyperframe/kinetic typography). " +
      "Avatar narrador: um boneco em SVG/React (cabeça, olhos que piscam, corpo, braços gesticulando) cuja boca abre/fecha sincronizada com a narração usando useAudioData + visualizeAudio de @remotion/media-utils. " +
      "3) Voz humanizada pt-BR grátis: shell_exec na pasta do projeto: 'pip install edge-tts' e 'edge-tts --voice pt-BR-AntonioNeural --rate=+5% --text \"<roteiro>\" --write-media public/narracao.mp3' (voz feminina: pt-BR-FranciscaNeural ou pt-BR-ThalitaNeural). " +
      "4) shell_exec 'npm install' e depois 'npm run render' (timeout 300). Ao fim, open_app no arquivo out/video.mp4. " +
      "Para EDITAR: leia os arquivos com fs_read, altere com fs_write (cenas, cores, textos, duração, voz) e renderize de novo. Nunca exceda 30s.",
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
    if (!v) return BUILTIN_SKILLS.map((s) => s.id);
    const ids: string[] = JSON.parse(v);
    // Auto-enable built-in skills added after the user's last save.
    const known: string[] = JSON.parse(localStorage.getItem("jarvis:skills:known:v1") || "[]");
    const fresh = BUILTIN_SKILLS.map((s) => s.id).filter((id) => !known.includes(id) && !ids.includes(id));
    localStorage.setItem("jarvis:skills:known:v1", JSON.stringify(BUILTIN_SKILLS.map((s) => s.id)));
    return known.length ? [...ids, ...fresh] : [...ids, ...fresh.filter((id) => id === "video")];
  } catch {
    return BUILTIN_SKILLS.map((s) => s.id);
  }
}
export function saveActiveSkills(ids: string[]) {
  try { localStorage.setItem(ACTIVE_KEY, JSON.stringify(ids)); } catch { /* */ }
}
