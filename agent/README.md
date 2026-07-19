# J.A.R.V.I.S. Local Bridge

Gives the Jarvis web UI real access to **your** machine: shell commands,
reading and writing files, listing directories. All under a bearer token
you control.

## Requirements

- Python 3.8+ (no dependencies — uses stdlib only)

## Run

```bash
python3 agent/jarvis_agent.py
```

You'll see something like:

```
============================================================
  J.A.R.V.I.S. local bridge — online
============================================================
  URL       : http://127.0.0.1:7842
  Token     : Xq7p...long-random-token...
  Base cwd  : /Users/you
============================================================
```

## Connect from the Jarvis web UI

1. Open the Jarvis app.
2. Click the **plug icon** in the header → paste the **URL** and **Token**.
3. Click "Testar conexão" — should read **online**.
4. Now ask Jarvis things like:
   - "liste os arquivos no meu Desktop"
   - "rode `git status` no repositório X"
   - "leia o arquivo ~/notas.md e me resuma"
   - "crie um arquivo hello.txt com 'olá mundo'"

## Configuration

| Env var        | Default                      | Purpose                                  |
| -------------- | ---------------------------- | ---------------------------------------- |
| `JARVIS_PORT`  | `7842`                       | Port to listen on (localhost only)       |
| `JARVIS_TOKEN` | random, printed on startup   | Fix the token instead of regenerating    |
| `JARVIS_CWD`   | current directory            | Base directory for relative paths        |

Example:

```bash
JARVIS_PORT=9000 JARVIS_TOKEN=meutokensecreto JARVIS_CWD=~/dev python3 agent/jarvis_agent.py
```

## Security

- Binds to `127.0.0.1` only — never reachable from the network.
- Every request requires `Authorization: Bearer <token>`.
- Shell commands run **as your user, with your permissions**. Treat this
  like giving Jarvis a terminal on your machine — because that's exactly
  what it is. Only use tokens you generated yourself.
- Stop it with `Ctrl+C` when you're done.
