# Labeled-response traces

Recorded by `../record_lr.py` (2026-11-12): one connection sends labeled
commands (21 in the e81d12a files, 63 in the others, which add the states
the person messaged can be in, refusing channels, multiline and commands
answered by several lines) and records every line up to a PING sentinel, with the shape the
label came back in (`batch`, `single`, `ack`, `none`). Raw wire only; the
checks against Delivery.tla are done elsewhere.

| File | Server | echo-message |
| --- | --- | --- |
| `lr-nef2-e81d12a-echo.jsonl` | nefarious2 ircv3.2-upgrade e81d12a, local MrLenin/testnet (X3 + Keycloak), not logged in | on |
| `lr-nef2-e81d12a-noecho.jsonl` | same | off |
| `lr-nef2-253218e-echo.jsonl` | nefarious2 ircv3.2-upgrade 253218e, local single server (Docker, iauthd-ts), not logged in | on |
| `lr-nef2-253218e-noecho.jsonl` | same | off |
| `lr-ergo-079720e8-echo.jsonl` | Ergo 079720e8, local, its `default.yaml` with a plaintext loopback listener and fakelag off | on |
| `lr-ergo-079720e8-noecho.jsonl` | same | off |

    python3 record_lr.py HOST PORT OUT.jsonl --server-label NAME [--no-echo] [--sasl ACCOUNT:PASSWORD]
