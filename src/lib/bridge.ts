// Client-side helper to talk to the local J.A.R.V.I.S. bridge agent
// (see agent/jarvis_agent.py). All calls happen from the browser directly
// to http://127.0.0.1:PORT — never through the server.

export type BridgeConfig = { url: string; token: string };

const STORAGE_KEY = "jarvis:bridge:v1";

export function loadBridge(): BridgeConfig | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<BridgeConfig>;
    if (p && typeof p.url === "string" && typeof p.token === "string") {
      return { url: p.url.replace(/\/$/, ""), token: p.token };
    }
    return null;
  } catch {
    return null;
  }
}

export function saveBridge(cfg: BridgeConfig | null): void {
  if (typeof window === "undefined") return;
  if (!cfg) {
    window.localStorage.removeItem(STORAGE_KEY);
    return;
  }
  window.localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ url: cfg.url.replace(/\/$/, ""), token: cfg.token }),
  );
}

async function call(cfg: BridgeConfig, path: string, body?: unknown): Promise<unknown> {
  const res = await fetch(`${cfg.url}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${cfg.token}`,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { error: `Invalid response: ${text.slice(0, 200)}` };
  }
  if (!res.ok) {
    const errMsg = (data as { error?: string })?.error ?? `HTTP ${res.status}`;
    throw new Error(errMsg);
  }
  return data;
}

export async function health(cfg: BridgeConfig): Promise<{ ok: boolean; cwd: string; platform: string }> {
  return (await call(cfg, "/health")) as { ok: boolean; cwd: string; platform: string };
}

export async function runTool(
  cfg: BridgeConfig,
  name: string,
  input: Record<string, unknown>,
): Promise<unknown> {
  switch (name) {
    case "shell_exec":
      return call(cfg, "/shell", {
        cmd: input.cmd,
        cwd: input.cwd,
        timeout: input.timeout,
      });
    case "fs_read":
      return call(cfg, "/read", { path: input.path });
    case "fs_write":
      return call(cfg, "/write", {
        path: input.path,
        content: input.content ?? "",
        append: input.append ?? false,
      });
    case "fs_list":
      return call(cfg, "/list", { path: input.path ?? "." });
    case "open_app":
      return call(cfg, "/open", { target: input.target, args: input.args });
    default:
      throw new Error(`Unknown local tool: ${name}`);

  }
}

// --- Draft (campos do painel) ------------------------------------------------
// Persistido separadamente da config validada, para que a URL e o token
// digitados sobrevivam a um recarregamento mesmo sem teste bem-sucedido.

const DRAFT_KEY = "jarvis:bridge:draft:v1";

export function loadBridgeDraft(): BridgeConfig | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<BridgeConfig>;
    if (p && typeof p.url === "string" && typeof p.token === "string") {
      return { url: p.url, token: p.token };
    }
    return null;
  } catch {
    return null;
  }
}

export function saveBridgeDraft(draft: BridgeConfig): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  } catch {
    /* quota */
  }
}

// --- Pareamento por QR code --------------------------------------------------
// Codifica URL + token num fragmento de URL (nunca enviado ao servidor),
// para que o celular escaneie e preencha os campos automaticamente.

const PAIR_HASH_KEY = "jarvis-bridge";

function toBase64Url(s: string): string {
  const b64 = btoa(unescape(encodeURIComponent(s)));
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(s: string): string {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  return decodeURIComponent(escape(atob(padded)));
}

export function pairingUrl(cfg: BridgeConfig): string {
  const payload = toBase64Url(JSON.stringify({ u: cfg.url.replace(/\/$/, ""), t: cfg.token }));
  const { origin, pathname } = window.location;
  return `${origin}${pathname}#${PAIR_HASH_KEY}=${payload}`;
}

export function readPairingFromHash(): BridgeConfig | null {
  if (typeof window === "undefined") return null;
  const hash = window.location.hash.replace(/^#/, "");
  if (!hash.startsWith(`${PAIR_HASH_KEY}=`)) return null;
  try {
    const parsed = JSON.parse(fromBase64Url(hash.slice(PAIR_HASH_KEY.length + 1))) as {
      u?: string;
      t?: string;
    };
    if (typeof parsed.u !== "string" || typeof parsed.t !== "string") return null;
    return { url: parsed.u.replace(/\/$/, ""), token: parsed.t };
  } catch {
    return null;
  } finally {
    try {
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
    } catch {
      /* ignore */
    }
  }
}
