# Registration traces

Recorded with `record_reg.py` against local servers only, with no accounts and no SASL. PING is never answered automatically: each scenario answers it as a step. A connection password, where used, is redacted to `<password>`. One JSON object per line: a `meta` record, then one `trace` per scenario (`name`, `question`, `note`, `lines` [{conn, dir C|S, ms, raw}]).

| File | Server | Scenarios |
| --- | --- | --- |
| `reg-nef2-e81d12a.jsonl` | nefarious2 e81d12a, single server, X3 and Keycloak (MrLenin/testnet), plain port | all but the PASS scenarios (no connection password configured) |
| `reg-ergo-v2.19.1-37-g079720e8.jsonl` | Ergo 079720e8, local config | all but the PASS scenarios |
| `reg-ergo-v2.19.1-37-g079720e8-pass.jsonl` | the same Ergo, with a server password | `pass-wrong`, `pass-right` |

| Scenario | Bears on |
| --- | --- |
| `cookie-unanswered`, `cookie-wrong-token` | Q3, D2 |
| `nick-taken-after-end`, `nick-taken-before-end` | D3 |
| `meta-prereg-set`, `meta-prereg-none` | D6 |
| `meta-prereg-nicktarget` | Q1 |
| `meta-after-end` | Q2, D7 |
| `meta-prereg-nocap` | D5 |
| `rereg-after-001` | D8 (462) |
| `pass-wrong`, `pass-right` | Q5 |
| `timeout-silent` | Q4 |

    record_reg.py HOST PORT OUT.jsonl --server-label NAME [--only a,b] [--timeout-wait S] [--pass P]
    check.py reg-*.jsonl     # the wire rules of ../model/SpecReg.tla, per connection
