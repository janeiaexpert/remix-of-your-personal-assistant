#!/usr/bin/env python3
"""
J.A.R.V.I.S. local bridge agent.

Runs a small HTTP server on your machine that the Jarvis web app talks to
so it can execute real shell commands and read/write files as YOU.

Security model:
  - Binds to 127.0.0.1 only (never exposed to the network).
  - Every request must send `Authorization: Bearer <TOKEN>`.
  - Token is auto-generated on first run and printed to your terminal.
  - CORS + Private-Network-Access headers allow the Jarvis web UI (any
    https origin) to call in from your browser.

Usage:
  python3 jarvis_agent.py              # default port 7842
  JARVIS_PORT=9000 python3 jarvis_agent.py
  JARVIS_TOKEN=meutoken python3 jarvis_agent.py

Endpoints:
  GET  /health                         -> {"ok": true, "cwd": "..."}
  POST /shell    {"cmd": "...", "cwd": "?", "timeout": 30}
  POST /read     {"path": "..."}
  POST /write    {"path": "...", "content": "...", "append": false}
  POST /list     {"path": "."}
"""
from __future__ import annotations

import json
import os
import secrets
import subprocess
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HOST = "127.0.0.1"
PORT = int(os.environ.get("JARVIS_PORT", "7842"))
TOKEN = os.environ.get("JARVIS_TOKEN") or secrets.token_urlsafe(24)
BASE_CWD = Path(os.environ.get("JARVIS_CWD", os.getcwd())).expanduser().resolve()
MAX_READ = 512 * 1024  # 512 KB


def _cors(handler: BaseHTTPRequestHandler) -> None:
    origin = handler.headers.get("Origin", "*")
    handler.send_header("Access-Control-Allow-Origin", origin)
    handler.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
    handler.send_header(
        "Access-Control-Allow-Headers", "Content-Type, Authorization"
    )
    handler.send_header("Access-Control-Allow-Private-Network", "true")
    handler.send_header("Access-Control-Max-Age", "86400")
    handler.send_header("Vary", "Origin")


def _json(handler: BaseHTTPRequestHandler, status: int, payload: dict) -> None:
    body = json.dumps(payload).encode("utf-8")
    handler.send_response(status)
    _cors(handler)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)


def _resolve(path_str: str) -> Path:
    p = Path(path_str).expanduser()
    if not p.is_absolute():
        p = BASE_CWD / p
    return p.resolve()


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt: str, *args) -> None:  # noqa: A003
        sys.stderr.write("[jarvis-agent] " + (fmt % args) + "\n")

    def do_OPTIONS(self) -> None:  # noqa: N802
        self.send_response(204)
        _cors(self)
        self.end_headers()

    def _auth_ok(self) -> bool:
        header = self.headers.get("Authorization", "")
        return header == f"Bearer {TOKEN}"

    def _read_body(self) -> dict:
        length = int(self.headers.get("Content-Length") or 0)
        if not length:
            return {}
        raw = self.rfile.read(length)
        try:
            return json.loads(raw.decode("utf-8"))
        except Exception:
            return {}

    def do_GET(self) -> None:  # noqa: N802
        if self.path == "/health":
            if not self._auth_ok():
                return _json(self, 401, {"error": "unauthorized"})
            return _json(
                self,
                200,
                {"ok": True, "cwd": str(BASE_CWD), "platform": sys.platform},
            )
        _json(self, 404, {"error": "not found"})

    def do_POST(self) -> None:  # noqa: N802
        if not self._auth_ok():
            return _json(self, 401, {"error": "unauthorized"})

        body = self._read_body()
        try:
            if self.path == "/shell":
                return self._shell(body)
            if self.path == "/read":
                return self._read(body)
            if self.path == "/write":
                return self._write(body)
            if self.path == "/list":
                return self._list(body)
        except Exception as exc:  # noqa: BLE001
            return _json(self, 500, {"error": str(exc)})
        _json(self, 404, {"error": "not found"})

    def _shell(self, body: dict) -> None:
        cmd = body.get("cmd")
        if not cmd or not isinstance(cmd, str):
            return _json(self, 400, {"error": "cmd required"})
        cwd = body.get("cwd") or str(BASE_CWD)
        timeout = min(int(body.get("timeout") or 30), 300)
        try:
            proc = subprocess.run(
                cmd,
                shell=True,
                cwd=cwd,
                capture_output=True,
                text=True,
                timeout=timeout,
            )
            return _json(
                self,
                200,
                {
                    "exit": proc.returncode,
                    "stdout": proc.stdout[-64_000:],
                    "stderr": proc.stderr[-16_000:],
                    "cwd": cwd,
                },
            )
        except subprocess.TimeoutExpired as exc:
            return _json(
                self,
                200,
                {
                    "exit": -1,
                    "stdout": (exc.stdout or "")[-64_000:] if isinstance(exc.stdout, str) else "",
                    "stderr": f"timeout after {timeout}s",
                    "cwd": cwd,
                },
            )

    def _read(self, body: dict) -> None:
        path = body.get("path")
        if not path:
            return _json(self, 400, {"error": "path required"})
        p = _resolve(path)
        if not p.exists():
            return _json(self, 404, {"error": f"not found: {p}"})
        if p.is_dir():
            return _json(self, 400, {"error": "path is a directory; use /list"})
        try:
            data = p.read_bytes()
            truncated = len(data) > MAX_READ
            text = data[:MAX_READ].decode("utf-8", errors="replace")
            return _json(
                self,
                200,
                {"path": str(p), "content": text, "bytes": len(data), "truncated": truncated},
            )
        except Exception as exc:  # noqa: BLE001
            return _json(self, 500, {"error": str(exc)})

    def _write(self, body: dict) -> None:
        path = body.get("path")
        content = body.get("content", "")
        append = bool(body.get("append"))
        if not path:
            return _json(self, 400, {"error": "path required"})
        p = _resolve(path)
        p.parent.mkdir(parents=True, exist_ok=True)
        mode = "a" if append else "w"
        with p.open(mode, encoding="utf-8") as fh:
            fh.write(content)
        return _json(self, 200, {"path": str(p), "bytes": len(content), "appended": append})

    def _list(self, body: dict) -> None:
        path = body.get("path") or "."
        p = _resolve(path)
        if not p.exists():
            return _json(self, 404, {"error": f"not found: {p}"})
        if not p.is_dir():
            return _json(self, 400, {"error": "path is not a directory"})
        entries = []
        for child in sorted(p.iterdir()):
            try:
                st = child.stat()
                entries.append(
                    {
                        "name": child.name,
                        "type": "dir" if child.is_dir() else "file",
                        "size": st.st_size,
                    }
                )
            except Exception:
                continue
        return _json(self, 200, {"path": str(p), "entries": entries})


def main() -> None:
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print("=" * 60)
    print("  J.A.R.V.I.S. local bridge — online")
    print("=" * 60)
    print(f"  URL       : http://{HOST}:{PORT}")
    print(f"  Token     : {TOKEN}")
    print(f"  Base cwd  : {BASE_CWD}")
    print("=" * 60)
    print("  Paste the URL and token into the Jarvis web UI (Bridge panel).")
    print("  Ctrl+C to stop.")
    print()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[jarvis-agent] shutting down")
        server.shutdown()


if __name__ == "__main__":
    main()
