import { useMemo, useState } from "react";
import { zipSync, strToU8 } from "fflate";
import { Download, HardDrive, X, FileCode } from "lucide-react";

export type ProjectFile = { path: string; content: string };
export type Project = { name: string; description?: string; files: ProjectFile[]; savedTo?: string };

/** Inline local CSS/JS references so the preview works inside an iframe. */
export function buildPreview(files: ProjectFile[]): string | null {
  const map = new Map(files.map((f) => [f.path.replace(/^\.?\//, ""), f.content]));
  let html = map.get("index.html") ?? [...map.entries()].find(([p]) => p.endsWith(".html"))?.[1];
  if (!html) return null;
  html = html.replace(/<link[^>]*href=["']([^"']+\.css)["'][^>]*>/gi, (m, href: string) => {
    const css = map.get(href.replace(/^\.?\//, ""));
    return css != null ? `<style>${css}</style>` : m;
  });
  html = html.replace(/<script([^>]*)src=["']([^"']+\.js)["']([^>]*)><\/script>/gi, (m, a: string, src: string, b: string) => {
    const js = map.get(src.replace(/^\.?\//, ""));
    const attrs = `${a} ${b}`.replace(/\s+/g, " ").trim();
    return js != null ? `<script ${attrs}>${js.replace(/<\/script>/gi, "<\\/script>")}</script>` : m;
  });
  return html;
}

export function downloadZip(p: Project) {
  const data: Record<string, Uint8Array> = {};
  for (const f of p.files) data[`${p.name}/${f.path.replace(/^\.?\//, "")}`] = strToU8(f.content);
  const blob = new Blob([zipSync(data)], { type: "application/zip" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${p.name}.zip`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function ProjectStudio({
  project, onClose, onSaveLocal, canSaveLocal,
}: {
  project: Project;
  onClose: () => void;
  onSaveLocal: () => Promise<void>;
  canSaveLocal: boolean;
}) {
  const [tab, setTab] = useState<"preview" | "code">("preview");
  const [sel, setSel] = useState(0);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const preview = useMemo(() => buildPreview(project.files), [project.files]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background/95 backdrop-blur">
      <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
        <div className="mr-auto min-w-0">
          <div className="truncate font-semibold text-foreground">{project.name}</div>
          <div className="truncate text-xs text-muted-foreground">
            {project.files.length} arquivos{project.savedTo ? ` · salvo em ${project.savedTo}` : ""}
          </div>
        </div>
        <button className="rounded-md border border-border px-3 py-1.5 text-sm" onClick={() => setTab(tab === "preview" ? "code" : "preview")}>
          <FileCode size={14} className="mr-1 inline" />{tab === "preview" ? "Código" : "Prévia"}
        </button>
        <button className="rounded-md border border-border px-3 py-1.5 text-sm" onClick={() => downloadZip(project)}>
          <Download size={14} className="mr-1 inline" />Baixar ZIP
        </button>
        {canSaveLocal && (
          <button
            disabled={saving}
            className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-50"
            onClick={async () => {
              setSaving(true); setMsg("");
              try { await onSaveLocal(); setMsg("Salvo no computador."); }
              catch (e) { setMsg(e instanceof Error ? e.message : "Falha ao salvar."); }
              finally { setSaving(false); }
            }}
          >
            <HardDrive size={14} className="mr-1 inline" />{saving ? "Salvando…" : "Salvar no PC"}
          </button>
        )}
        <button aria-label="Fechar" className="rounded-md border border-border p-1.5" onClick={onClose}><X size={16} /></button>
        {msg && <div className="w-full text-xs text-muted-foreground">{msg}</div>}
      </div>
      {tab === "preview" ? (
        preview ? (
          <iframe title="Prévia" srcDoc={preview} sandbox="allow-scripts allow-forms allow-modals" className="flex-1 bg-card" />
        ) : (
          <div className="p-6 text-sm text-muted-foreground">Sem index.html para prévia — veja o código ou baixe o ZIP.</div>
        )
      ) : (
        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          <div className="flex gap-1 overflow-auto border-b border-border p-2 md:w-56 md:flex-col md:border-b-0 md:border-r">
            {project.files.map((f, i) => (
              <button key={f.path} onClick={() => setSel(i)} className={`whitespace-nowrap rounded px-2 py-1 text-left text-xs ${i === sel ? "bg-accent text-accent-foreground" : "text-muted-foreground"}`}>
                {f.path}
              </button>
            ))}
          </div>
          <pre className="flex-1 overflow-auto p-3 text-xs text-foreground"><code>{project.files[sel]?.content}</code></pre>
        </div>
      )}
    </div>
  );
}
