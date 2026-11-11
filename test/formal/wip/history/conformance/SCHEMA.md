# Delivery client checks: the scenario and observation formats

The scenarios live in `scenarios.jsonl`, written by `scenarios.py`, one JSON object per line: `{name, tag, why, labels, steps}`.

`tag` says how much the scenario's server behaviour is allowed:
- `guaranteed`: a MUST;
- `allowed`: something the text permits;
- `adversarial`: beyond the text, the model's `Lossy` or `Competing`.

A failure in an adversarial scenario is a robustness note, not a bug.

## Steps

The driver runs the steps in order, after registration (001) with `echo-message`, `labeled-response` and `batch` negotiated, and `#chan` joined. In the steps below, request `i` is the i-th `send`.

- **`{"send": {i, tgt, cmd, txt}}`**: the client sends `cmd` (PRIVMSG or NOTICE) with text `txt`. The target is `#chan`, or the client's own nick when `tgt` is "self". Send it through the client's normal user path, the one that makes a pending copy. Record the label the client put on the line, if any.
- **`{"line": {raw, m}}`**: the server sends `raw` to the client, after these substitutions:
  - `{L<i>}` becomes request i's label;
  - `{me}` becomes the client's nick;
  - `{chan}` becomes `#chan`.

  `m` is the model's line (Delivery.tla `Ln`), which the checker uses. Drivers ignore it.
- **`{"timeout": i}`**: the client's own timeout for request i fires. Each send happens at virtual time 10 s × i. The timeout step advances the clock to exactly i's deadline, which is i's send time plus the client's timeout, so only i's timer fires. A client with no timeout records `"no-timeout"` and continues.
- **`{"close": true}`**: the connection closes, as a transport close with no QUIT.

If a scenario's `labels` is true and the client didn't label every request the scenario labels, skip it and record `"skipped": "no-label"`.

## Observation (one JSON object per scenario run)

```
{"name": ..., "client": "seance", "sha": "<commit>", "labels": {"1": "s1", "2": "s2"},
 "snap": [{"after": <step index>, "out": {"1": "pending", "2": "confirmed"}}, ...],
 "shown": {"1": <times the message text for request i appears as a settled own line>},
 "notes": "...", "skipped": null}
```

Write a snapshot after every step, including sends. `out` maps every request sent so far to one of `pending`, `confirmed`, `accepted`, `failed` or `timedout`. Each client's README section says how these are read from its observable state. When a client cannot tell two outcomes apart (for example `failed` from `timedout`), it records the closer one and says so in `notes`.
