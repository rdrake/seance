#!/usr/bin/env python3
"""Check record_reg.py traces against SpecReg.tla's server rules.

Per connection, from the lines the server sent:
  RuleBurstAfter001     no metadata batch before 001.
  RuleMetaBatch         with draft/metadata-2 ACKed, exactly one metadata batch
                        for the client between 001 and the end of the MOTD
                        (376 or 422), empty if nothing was set.
  RuleMetaCarries       every key the server confirmed (761) before 001 is in
                        that batch.
  RuleNickIgnoredOn433  001 is never addressed to a nick answered with 433.
  RuleCookieGate        a PING sent before 001 holds 001 until its PONG.
  RulePassGate          after a wrong PASS there is no 001.
  RulePassRefusalSaid   a refused PASS is answered with 464 or ERROR.
  RuleNothingAfterError nothing but the close follows ERROR.

    python3 check_reg.py traces/*.jsonl
"""
import json
import re
import sys

TAG = re.compile(r"^@\S+ ")


def words(raw):
    w = TAG.sub("", raw, count=1).split()
    if w and w[0].startswith(":"):
        w = w[1:]
    return w


def check_conn(lines, scen):
    cl = [x["raw"] for x in lines if x["dir"] == "C"]
    meta = False
    fails, notes = [], []
    seen001 = welcomed_as = None
    refused433, prereg_keys = set(), set()
    pending_ping, ping_ok = None, True
    batches = []          # (open index, end-of-motd seen before open?, keys)
    cur = None
    eom = False
    error_at = None
    bad_pass = any(x["dir"] == "C" and x["raw"].startswith("PASS ") for x in lines) \
        and scen.startswith("pass-wrong")
    got464 = False
    for i, x in enumerate(lines):
        raw = x["raw"]
        if x["dir"] == "C":
            w = words(raw)
            if w[:1] == ["PONG"] and pending_ping and pending_ping in raw:
                pending_ping = None
            continue
        if raw == "<connection closed>":
            continue
        if error_at is not None:
            fails.append(f"RuleNothingAfterError: {raw[:60]}")
            continue
        w = words(raw)
        if not w:
            continue
        cmd = w[0]
        if cmd == "CAP" and len(w) > 2 and w[2] == "ACK" and "draft/metadata-2" in raw:
            meta = True
        elif cmd == "433" and len(w) > 2:
            refused433.add(w[2])
        elif cmd == "761" and seen001 is None and len(w) > 3:
            prereg_keys.add(w[3])
        elif cmd == "PING" and seen001 is None:
            pending_ping = w[-1].lstrip(":")
        elif cmd == "464":
            got464 = True
        elif cmd == "001":
            seen001 = i
            welcomed_as = w[1]
            if welcomed_as in refused433:
                fails.append(f"RuleNickIgnoredOn433: 001 to {welcomed_as}")
            if pending_ping:
                fails.append("RuleCookieGate: 001 before the PONG")
            if bad_pass:
                fails.append("RulePassGate: 001 after a wrong PASS")
        elif cmd in ("376", "422"):
            eom = True
        elif cmd == "BATCH" and len(w) > 2 and w[1].startswith("+") and w[2] == "metadata":
            if seen001 is None:
                fails.append("RuleBurstAfter001: metadata batch before 001")
            cur = (w[1][1:], eom, set())
            batches.append(cur)
        elif cmd == "METADATA" and cur and f"batch={cur[0]}" in raw and len(w) > 2:
            cur[2].add(w[2])
        elif cmd == "BATCH" and cur and w[1] == "-" + cur[0]:
            cur = None
        elif cmd == "ERROR":
            error_at = i
    if bad_pass and seen001 is None and error_at is None and not got464:
        fails.append("RulePassRefusalSaid: refused without 464 or ERROR")
    if meta and seen001 is not None:
        if not batches:
            fails.append("RuleMetaBatch: no metadata batch"
                         + (" (nothing was set: an empty one is owed)" if not prereg_keys else ""))
        else:
            if len(batches) > 1:
                fails.append(f"RuleMetaBatch: {len(batches)} metadata batches")
            if batches[0][1]:
                fails.append("RuleMetaBatch: metadata batch after the end of the MOTD")
            missing = prereg_keys - batches[0][2]
            if missing:
                fails.append(f"RuleMetaCarries: batch lacks {sorted(missing)}")
    return fails, notes


def main():
    total = 0
    for path in sys.argv[1:]:
        rows = [json.loads(l) for l in open(path)]
        meta, traces = rows[0], [r for r in rows[1:] if r.get("lines")]
        bad = 0
        out = []
        for t in traces:
            conns = {}
            for x in t["lines"]:
                conns.setdefault(x["conn"], []).append(x)
            for c, lines in conns.items():
                fails, _ = check_conn(lines, t["name"])
                bad += bool(fails)
                for f in fails:
                    out.append(f"  FAIL {t['name']} {c}: {f}")
        n = sum(len({x['conn'] for x in t['lines']}) for t in traces)
        print(f"== {meta['server_label'][:60]}: {n - bad}/{n} connections hold")
        print("\n".join(out)) if out else None
        total += bad
    return 1 if total else 0


if __name__ == "__main__":
    sys.exit(main())
