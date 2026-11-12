# Labeled-response traces

Recorded by `../record_lr.py` (2026-11-12): one connection sends 21 labeled
commands and records every line up to a PING sentinel, with the shape the
label came back in (`batch`, `single`, `ack`, `none`). Raw wire only; the
checks against Delivery.tla are done elsewhere.

| File | Server | echo-message |
| --- | --- | --- |
| `lr-nef2-e81d12a-echo.jsonl` | nefarious2 ircv3.2-upgrade e81d12a, local MrLenin/testnet (X3 + Keycloak), not logged in | on |
| `lr-nef2-e81d12a-noecho.jsonl` | same | off |
| `lr-ergo-079720e8-echo.jsonl` | Ergo 079720e8, local, `../../history/servers/ergo/mkconf.py` config | on |
| `lr-ergo-079720e8-noecho.jsonl` | same | off |

    python3 record_lr.py HOST PORT OUT.jsonl --server-label NAME [--no-echo] [--sasl ACCOUNT:PASSWORD]
