import { useCallback, useState } from "react";
import { Download, ImagePlus, Loader2, Share2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { streamImage, toPng45, downloadPng, isIOS, TARGET_H, TARGET_W } from "@/lib/imagegen";

export type GeneratedCard = {
  id: string;
  prompt: string;
  dataUrl: string;
  blob: Blob | null;
  isFinal: boolean;
};

function newId() {
  return Math.random().toString(36).slice(2);
}

export function ImageStudio({ onClose }: { onClose: () => void }) {
  const [prompt, setPrompt] = useState("");
  const [cards, setCards] = useState<GeneratedCard[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openCard, setOpenCard] = useState<GeneratedCard | null>(null);
  const [saveNote, setSaveNote] = useState<string | null>(null);

  const generate = useCallback(async () => {
    const p = prompt.trim();
    if (!p || busy) return;
    const id = newId();
    setBusy(true);
    setError(null);
    setCards((c) => [{ id, prompt: p, dataUrl: "", blob: null, isFinal: false }, ...c]);
    try {
      await streamImage(p, (dataUrl, isFinal) => {
        setCards((c) => c.map((x) => (x.id === id ? { ...x, dataUrl, isFinal } : x)));
        if (isFinal) {
          void toPng45(dataUrl).then(({ dataUrl: png, blob }) => {
            setCards((c) => c.map((x) => (x.id === id ? { ...x, dataUrl: png, blob } : x)));
          });
        }
      });
    } catch (e) {
      setCards((c) => c.filter((x) => x.id !== id));
      setError(e instanceof Error ? e.message : "Falha na geração da imagem.");
    } finally {
      setBusy(false);
    }
  }, [prompt, busy]);

  const save = useCallback(async (card: GeneratedCard) => {
    setSaveNote(null);
    try {
      let blob = card.blob;
      if (!blob) blob = (await toPng45(card.dataUrl)).blob;
      const name = `jarvis-${card.prompt.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40) || "imagem"}-${TARGET_W}x${TARGET_H}.png`;
      const how = await downloadPng(blob, name);
      setSaveNote(
        how === "shared"
          ? "Escolha “Salvar Imagem” na folha de compartilhamento, senhor."
          : `PNG ${TARGET_W}×${TARGET_H} salvo em Downloads.`,
      );
    } catch (e) {
      setSaveNote(e instanceof Error ? e.message : "Não foi possível baixar.");
    }
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-0 backdrop-blur-sm sm:items-center sm:p-4">
      <div className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-t-xl border border-hud/30 bg-card/95 shadow-hud sm:rounded-xl">
        <header className="flex items-center justify-between border-b border-hud/20 px-4 py-3">
          <h2 className="flex items-center gap-2 font-mono text-xs uppercase tracking-widest text-hud">
            <ImagePlus size={14} /> Estúdio de imagens · PNG 4:5
          </h2>
          <button type="button" onClick={onClose} aria-label="Fechar" className="text-hud/70 hover:text-gold">
            <X size={16} />
          </button>
        </header>

        <div className="space-y-3 border-b border-hud/15 p-4">
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void generate(); }
            }}
            rows={2}
            placeholder="Descreva a imagem, senhor. Ex: retrato cinematográfico de um piloto em armadura, luz azul do reator"
            className="w-full resize-none rounded-md border border-hud/30 bg-input/60 px-3 py-2 font-mono text-xs text-foreground placeholder:text-muted-foreground/60 focus:border-hud focus:outline-none"
          />
          <div className="flex items-center justify-between gap-2">
            <span className="font-mono text-[10px] text-muted-foreground">
              Saída: PNG {TARGET_W}×{TARGET_H} (4:5)
            </span>
            <button
              type="button"
              onClick={() => void generate()}
              disabled={busy || !prompt.trim()}
              className="flex items-center gap-2 rounded-md border border-hud bg-hud/20 px-4 py-2 font-mono text-[11px] uppercase tracking-widest text-hud transition hover:bg-hud/30 disabled:opacity-40"
            >
              {busy ? <Loader2 size={14} className="animate-spin" /> : <ImagePlus size={14} />}
              {busy ? "Gerando…" : "Gerar"}
            </button>
          </div>
          {error && <p className="font-mono text-[10px] text-gold">{error}</p>}
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {cards.length === 0 ? (
            <p className="py-8 text-center font-mono text-[11px] text-muted-foreground">
              Nenhuma imagem ainda. Descreva e toque em Gerar.
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {cards.map((card) => (
                <div key={card.id} className="overflow-hidden rounded-lg border border-hud/25 bg-black/30">
                  <button
                    type="button"
                    onClick={() => { setSaveNote(null); setOpenCard(card); }}
                    className="block w-full"
                    style={{ aspectRatio: "4 / 5" }}
                  >
                    {card.dataUrl ? (
                      <img
                        src={card.dataUrl}
                        alt={card.prompt}
                        className={cn(
                          "h-full w-full object-cover transition-[filter] duration-300",
                          card.isFinal ? "blur-0" : "blur-xl",
                        )}
                      />
                    ) : (
                      <span className="flex h-full w-full items-center justify-center">
                        <Loader2 size={18} className="animate-spin text-hud" />
                      </span>
                    )}
                  </button>
                  <div className="flex items-center justify-between gap-1 border-t border-hud/20 px-2 py-1.5">
                    <span className="truncate font-mono text-[9px] text-foreground/70">{card.prompt}</span>
                    <button
                      type="button"
                      onClick={() => { setSaveNote(null); setOpenCard(card); }}
                      disabled={!card.isFinal}
                      aria-label="Baixar este card"
                      className="shrink-0 text-hud hover:text-gold disabled:opacity-30"
                    >
                      <Download size={13} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {openCard && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/85 p-4">
          <div className="flex w-full max-w-sm flex-col gap-3 rounded-xl border border-hud/35 bg-card/95 p-4 shadow-hud">
            <div className="flex items-center justify-between">
              <h3 className="font-mono text-[11px] uppercase tracking-widest text-hud">
                Baixar PNG {TARGET_W}×{TARGET_H}
              </h3>
              <button
                type="button"
                onClick={() => { setOpenCard(null); setSaveNote(null); }}
                aria-label="Fechar"
                className="text-hud/70 hover:text-gold"
              >
                <X size={16} />
              </button>
            </div>
            <img
              src={openCard.dataUrl}
              alt={openCard.prompt}
              className="mx-auto max-h-[52vh] rounded-md border border-hud/20 object-contain"
              style={{ aspectRatio: "4 / 5" }}
            />
            <button
              type="button"
              onClick={() => void save(openCard)}
              className="flex items-center justify-center gap-2 rounded-md border border-hud bg-hud/20 px-4 py-3 font-mono text-[11px] uppercase tracking-widest text-hud hover:bg-hud/30"
            >
              {isIOS() ? <Share2 size={14} /> : <Download size={14} />}
              {isIOS() ? "Salvar no iPhone" : "Baixar PNG"}
            </button>
            <a
              href={openCard.dataUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-center font-mono text-[10px] text-hud/70 underline"
            >
              Abrir em nova aba (toque e segure para salvar)
            </a>
            {saveNote && <p className="text-center font-mono text-[10px] text-gold">{saveNote}</p>}
          </div>
        </div>
      )}
    </div>
  );
}
