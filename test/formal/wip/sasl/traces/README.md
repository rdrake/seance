# SASL traces

Recorded with `record_sasl.py` against local servers only (never a production
network), with test accounts. Client AUTHENTICATE payloads are redacted to
`<payload N bytes>`; passwords and tokens never reach a file. One JSON object
per line: a `meta` record, then one `trace` per scenario (`name`, `question`,
`note`, `lines` [{conn, dir C|S, ms, raw}]).

| File | Server | Scenarios |
| --- | --- | --- |
| `sasl-nef2-e81d12a.jsonl` | nefarious2 e81d12a, single server, X3 and Keycloak (MrLenin/testnet) | all; backend hook = the X3 container |
| `sasl-nef2-e81d12a-kcdown.jsonl` | same | the two notify scenarios, backend hook = the Keycloak container |
| `sasl-nef2-e81d12a-oauthfail.jsonl` | same | `postreg-fail-oauth` |
| `sasl-ergo-v2.19.1-37-g079720e8.jsonl` | Ergo 079720e8, local config | all but the notify scenarios (no backend to take away) |

Scenarios and the open question each bears on (`../DECISIONS.md`):

| Scenario | Bears on |
| --- | --- |
| `prereg-ok` | D3 (900/903 order) |
| `prereg-bad-then-ok` | retry after 904 |
| `unknown-mech`, `external-no-cert` | Q1 (908 with or without 904) |
| `line-too-long` | D6 (905 per line) |
| `total-too-long` | Q2 (the total-length limit's numeric) |
| `abort` | 906 |
| `postreg-unauth` | Q3 (AUTHENTICATE after 001, not logged in) |
| `postreg-same`, `postreg-diff` | Q4 (reauthentication refused at the opener or at the end) |
| `postreg-fail`, `postreg-fail-oauth` | Q5 (a failed reauthentication and the existing login) |
| `postreg-no-cap` | D7 (AUTHENTICATE after 001 without the sasl cap) |
| `notify-backend-cycle` | Q6 (a mechanism-list change and NEW) |
| `notify-del-mid-exchange` | Q7 (DEL of sasl mid-exchange) |

Notes on the recordings:
- On the nefarious2 testnet, a SASL login can attach the connection to the
  account's existing bouncer session (`001` then names the session's nick).
  `postreg-same/diff/fail` did so; the SASL lines are unaffected.
- The `...-kcdown` file is a separate recording because nefarious2 logs in
  through Keycloak directly: with X3 stopped, SASL still works.

    record_sasl.py HOST PORT OUT.jsonl --server-label NAME --acct1 U:P --acct2 U:P \
        [--only a,b] [--hook-cmd-down CMD --hook-cmd-up CMD]
