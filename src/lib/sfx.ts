// Efeitos sonoros HUD estilo Homem de Ferro: "lâmina" metálica de fundo.
// Áudio 100% sintetizado via WebAudio (sem arquivos).

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let enabled = true;

function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!ctx) {
    ctx = new Ctor();
    master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);
  }
  return ctx;
}

export function setSfxEnabled(on: boolean) {
  enabled = on;
}

/** Chame dentro de um gesto do usuário para liberar o áudio. */
export async function primeSfx() {
  const c = getCtx();
  if (c && c.state === "suspended") await c.resume().catch(() => {});
}

function noiseBuffer(c: AudioContext, seconds: number) {
  const len = Math.max(1, Math.floor(c.sampleRate * seconds));
  const buf = c.createBuffer(1, len, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}

/**
 * Whoosh metálico de lâmina: ruído filtrado com sweep + cauda ressonante.
 * variant "up" (ativação) ou "down" (resposta/encerramento).
 */
export function bladeSwipe(variant: "up" | "down" = "up", volume = 1) {
  if (!enabled) return;
  const c = getCtx();
  if (!c || !master) return;
  if (c.state === "suspended") void c.resume().catch(() => {});
  const t = c.currentTime + 0.01;
  const dur = 0.5;

  // Corpo do whoosh
  const src = c.createBufferSource();
  src.buffer = noiseBuffer(c, dur + 0.2);

  const bp = c.createBiquadFilter();
  bp.type = "bandpass";
  bp.Q.value = 3.2;
  const fA = variant === "up" ? 380 : 2600;
  const fB = variant === "up" ? 3800 : 300;
  bp.frequency.setValueAtTime(fA, t);
  bp.frequency.exponentialRampToValueAtTime(fB, t + dur * 0.8);

  const hp = c.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = 220;

  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.28 * volume, t + 0.07);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);

  src.connect(bp).connect(hp).connect(g).connect(master);
  src.start(t);
  src.stop(t + dur + 0.1);

  // Cauda metálica (ressonância de lâmina)
  const ringFreqs = variant === "up" ? [1180, 1770, 2360] : [880, 1320, 1980];
  ringFreqs.forEach((f, i) => {
    const osc = c.createOscillator();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(f, t);
    osc.frequency.exponentialRampToValueAtTime(f * (variant === "up" ? 1.05 : 0.94), t + 0.4);
    const og = c.createGain();
    const peak = (0.055 / (i + 1)) * volume;
    og.gain.setValueAtTime(0.0001, t + 0.03);
    og.gain.exponentialRampToValueAtTime(peak, t + 0.09);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
    osc.connect(og).connect(master);
    osc.start(t);
    osc.stop(t + 0.6);
  });
}

/** Sub-bass curto que dá peso ao movimento (impacto da armadura). */
export function hudImpact(volume = 1) {
  if (!enabled) return;
  const c = getCtx();
  if (!c || !master) return;
  const t = c.currentTime + 0.01;
  const osc = c.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(120, t);
  osc.frequency.exponentialRampToValueAtTime(42, t + 0.25);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.18 * volume, t + 0.03);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
  osc.connect(g).connect(master);
  osc.start(t);
  osc.stop(t + 0.35);
}
