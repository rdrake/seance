#!/usr/bin/env python3
"""Seance's code model (seance test/formal/handshake/Handshake.tla) as spec
traces: every settled behaviour TLC prints with MBT.cfg's Dump (one JSON
line each: env, sent, got, rest) becomes a check.py trace.

- Seance's lines: CAPLS/NICK/USER are dropped (the spec client's LS 302 is
  implicit); AUTH -> AUTHMECH, AUTHDATA, AUTHABORT -> AUTHSTAR, CAPEND -> END,
  REQ, QUIT.
- Server lines as Seance read them (got), then `rest`, the lines the server
  sent after Seance quit and stopped reading.  904T (the timeout 904) -> 904.
  TIMER events are not lines.
- r of a sent line = server lines read before it; nread = lines read in all.
- Caps: Order <<"x", "y", "sasl">> -> x = a, y = b.
- env: wantSasl = Seance has credentials, creds = the password is right,
  svcOk = services up, required = required and has credentials (without
  credentials Seance never starts SASL, so required has no effect; the spec
  allows required only with wantSasl).  Worlds with env.eager (a
  client that is not Seance) are dropped.

Usage: handshake_traces.py RAW.jsonl OUT.jsonl
"""
import json, sys

CAP = {"x": "a", "y": "b", "sasl": "sasl"}
CLI = {"AUTH": "AUTHMECH", "AUTHDATA": "AUTHDATA", "AUTHABORT": "AUTHSTAR",
       "CAPEND": "END", "REQ": "REQ", "QUIT": "QUIT"}


def caps(m):
    return sorted(CAP[c] for c in m.get("caps", []))


def srv(m):
    t = "904" if m["t"] == "904T" else m["t"]
    return {"t": t, "caps": caps(m), "more": False}


def convert(d):
    e = d["env"]
    obs, reads_at = [], []          # reads_at[i] = Len(sent) when obs[i] was read
    for g in d["got"]:
        if g["m"]["t"] == "TIMER":
            continue
        obs.append(srv(g["m"]))
        reads_at.append(g["at"])
    nread = len(obs)
    obs += [srv(m) for m in d["rest"]]
    cli = []
    for k, m in enumerate(d["sent"]):
        if m["t"] in ("CAPLS", "NICK", "USER"):
            continue
        r = sum(1 for a in reads_at if a <= k)
        cli.append({"m": {"t": CLI[m["t"]], "caps": caps(m), "more": False}, "r": r})
    offered = sorted(CAP[c] for c in e["offered"])
    return {"env": {"creds": e["pwOk"], "wantSasl": e["creds"], "required": e["required"] and e["creds"],
                    "svcOk": e["svcUp"]},
            "offered": offered, "obs": obs, "cli": cli, "nread": nread,
            "other": ["a", "b"],
            "seance": {k: e[k] for k in ("refuse", "timely", "trusted")} | {"outcome": d["outcome"]}}


def main():
    seen, out, n = set(), open(sys.argv[2], "w"), 0
    for l in open(sys.argv[1]):
        l = l.strip()
        if not l.startswith('"{'):
            continue
        d = json.loads(json.loads(l))
        if d["env"]["eager"]:
            continue
        tr = convert(d)
        key = json.dumps({k: tr[k] for k in ("env", "offered", "obs", "cli", "nread")}, sort_keys=True)
        if key in seen:
            continue
        seen.add(key)
        tr["name"] = f"seance{n:04d}"
        out.write(json.dumps(tr) + "\n")
        n += 1
    print(n, "distinct Seance wire traces (eager worlds dropped)")


if __name__ == "__main__":
    main()
