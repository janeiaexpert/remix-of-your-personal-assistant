import { useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import coverAsset from "@/assets/jarvis-cover.png.asset.json";

type Props = { onExit: () => void };

/**
 * Capa cinematográfica do J.A.R.V.I.S. — vermelho / prata / dourado,
 * com holograma em movimento e luzes acendendo suavemente.
 */
export function CoverScreen({ onExit }: Props) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const t = window.setTimeout(() => setReady(true), 80);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onExit();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("keydown", onKey);
    };
  }, [onExit]);

  return (
    <div className="fixed inset-0 z-50 overflow-hidden bg-black">
      {/* Fundo: imagem com parallax lento e brilho pulsante */}
      <div
        className="absolute inset-0 bg-cover bg-center cover-drift"
        style={{ backgroundImage: `url(${coverAsset.url})` }}
        aria-hidden
      />
      <div className="absolute inset-0 cover-breathe bg-[radial-gradient(circle_at_50%_48%,oklch(0.62_0.22_28/0.45),transparent_58%)]" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_48%,transparent_35%,oklch(0.10_0.02_20/0.85)_100%)]" />

      {/* Anéis holográficos em movimento */}
      <div className="pointer-events-none absolute left-1/2 top-1/2 aspect-square w-[78vmin] -translate-x-1/2 -translate-y-1/2">
        <div className="absolute inset-0 rounded-full border border-[oklch(0.62_0.22_28/0.55)] cover-spin" />
        <div className="absolute inset-[9%] rounded-full border border-dashed border-[oklch(0.85_0.15_85/0.5)] cover-spin-rev" />
        <div className="absolute inset-[20%] rounded-full border border-[oklch(0.88_0.01_250/0.35)] cover-spin" />
        <div className="absolute inset-[32%] rounded-full border-2 border-[oklch(0.62_0.22_28/0.45)] cover-breathe" />
      </div>

      {/* Linha de varredura do holograma */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-[oklch(0.85_0.15_85/0.22)] to-transparent cover-scan" />
      </div>
      {/* Scanlines finas */}
      <div className="pointer-events-none absolute inset-0 cover-scanlines opacity-40" />

      {/* Conteúdo */}
      <div
        className={`relative flex h-full flex-col items-center justify-center px-6 text-center transition-all duration-1000 ${
          ready ? "opacity-100 blur-0" : "opacity-0 blur-md"
        }`}
      >
        <p className="font-mono text-[10px] uppercase tracking-[0.55em] text-[oklch(0.88_0.01_250)] cover-flicker">
          system status: operational
        </p>
        <h1 className="mt-4 text-4xl font-bold tracking-[0.3em] text-[oklch(0.72_0.2_28)] cover-title sm:text-6xl">
          J.A.R.V.I.S.
        </h1>
        <div className="mt-4 h-px w-56 max-w-[70vw] bg-gradient-to-r from-transparent via-[oklch(0.85_0.15_85)] to-transparent" />
        <p className="mt-4 max-w-md font-mono text-[11px] uppercase tracking-[0.3em] text-[oklch(0.85_0.15_85/0.85)]">
          armor integrity 98% · power levels stable
        </p>

        <button
          type="button"
          onClick={onExit}
          className="mt-10 inline-flex items-center gap-2 rounded-full border border-[oklch(0.62_0.22_28/0.7)] bg-[oklch(0.20_0.05_25/0.55)] px-6 py-3 font-mono text-xs uppercase tracking-[0.3em] text-[oklch(0.92_0.02_60)] backdrop-blur-sm transition-all hover:border-[oklch(0.85_0.15_85)] hover:shadow-[0_0_30px_oklch(0.62_0.22_28/0.55)]"
        >
          <ArrowLeft size={14} />
          Voltar à interface
        </button>
      </div>
    </div>
  );
}
