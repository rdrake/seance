#!/usr/bin/env python3
"""Check recorded registration traces against SpecReg's wire rules.

  check.py TRACE.jsonl [...]

Each connection of each scenario is one client wire, in order (C = sent,
S = read). The rules are SpecReg's, read on that wire (../model/SpecReg.tla,
../RULES.md):

  PassBeforeLatter  C PASS never after both a C NICK and a C USER   (MI:103, client)
  PongToken         every C PONG carries the token of an earlier S PING (MC:135, client)
  MetaStar          C METADATA before S 001 targets *                (MD:176, client)
  BurstAfter001     no S 376/422/metadata BATCH before S 001         (MI:117-126)
  MetaBatch         metadata ACKed and S 376/422 read: a metadata batch for
                    001's nick opened and closed between 001 and 376/422 (MD:113, MD:140)
  MetaCarries       a S 761 with target * before 001: a METADATA line inside
                    that batch                                       (MD:140, D6)
  NickIgnoredOn433  no S 001 for a nick that got S 433 with no later C NICK of it (MC:53)
  PassRefusalSaid   a C PASS that ends without S 001: S 464 or ERROR was read (MC:32)
  NothingAfterError nothing read after S ERROR                      (MC:230)

A scenario that breaks a client rule on purpose (the recorder probing the
server) is reported as `client probe`, not as a server finding.
"""
import json, sys

PROBES = {("meta-prereg-nicktarget", "MetaStar"), ("rereg-after-001", "PassBeforeLatter"),
          ("cookie-wrong-token", "PongToken")}


def parse(raw):
    tags = {}
    if raw.startswith("@"):
        head, _, raw = raw.partition(" ")
        for kv in head[1:].split(";"):
            k, _, v = kv.partition("=")
            tags[k] = v
    w = raw.split(" ")
    if w and w[0].startswith(":"):
        src, w = w[0], w[1:]
    else:
        src = None
    return tags, src, w


def check(lines):
    out = {}
    C = lambda i: lines[i]["dir"] == "C"
    W = [parse(l["raw"])[2] for l in lines]
    cmd = lambda i: (W[i][0].upper() if W[i] else "")
    idx001 = next((i for i in range(len(lines)) if not C(i) and cmd(i) == "001"), None)
    motd = next((i for i in range(len(lines)) if not C(i) and cmd(i) in ("376", "422")), None)
    nick001 = W[idx001][1] if idx001 is not None and len(W[idx001]) > 1 else None

    def fail(rule, why):
        out.setdefault(rule, []).append(why)

    seen_nick = seen_user = False
    pings = set()
    for i, l in enumerate(lines):
        c = cmd(i)
        if C(i):
            if c == "PASS" and seen_nick and seen_user:
                fail("PassBeforeLatter", f"line {i}: PASS after NICK and USER")
            seen_nick |= c == "NICK"
            seen_user |= c == "USER"
            if c == "PONG":
                tok = " ".join(W[i][1:]).lstrip(":")
                if tok not in pings:
                    fail("PongToken", f"line {i}: PONG {tok!r} answers no PING read")
            if c == "METADATA" and (idx001 is None or i < idx001) and len(W[i]) > 1 and W[i][1] != "*":
                fail("MetaStar", f"line {i}: METADATA {W[i][1]} before 001")
        else:
            if c == "PING":
                pings.add(" ".join(W[i][1:]).lstrip(":"))
            if c in ("376", "422") or (c == "BATCH" and len(W[i]) > 2 and W[i][1].startswith("+") and W[i][2] == "metadata"):
                if idx001 is None or i < idx001:
                    fail("BurstAfter001", f"line {i}: {c} before 001")
    # MetaBatch / MetaCarries
    acked = any(not C(i) and len(W[i]) > 3 and W[i][0] == "CAP" and W[i][2] == "ACK"
                and "draft/metadata-2" in " ".join(W[i][3:]) for i in range(len(lines)))
    if acked and idx001 is not None and motd is not None:
        opens = [i for i in range(len(lines)) if not C(i) and cmd(i) == "BATCH" and len(W[i]) > 2
                 and W[i][1].startswith("+") and W[i][2] == "metadata"]
        good = None
        for b in opens:
            ref = W[b][1][1:]
            target = W[b][3] if len(W[b]) > 3 else None
            e = next((j for j in range(b + 1, len(lines)) if not C(j) and cmd(j) == "BATCH" and W[j][1] == "-" + ref), None)
            if e is not None and idx001 < b < e < motd and target == nick001:
                good = (b, e)
        if good is None:
            where = [f"line {b} ({'after' if b > motd else 'before'} {cmd(motd)})" for b in opens]
            fail("MetaBatch", "no metadata batch for the 001 nick between 001 and "
                 f"{cmd(motd)}" + (f"; batches at {', '.join(where)}" if where else "; no batch at all"))
        pre761 = any(not C(i) and cmd(i) == "761" and len(W[i]) > 2 and W[i][2] == "*" and i < idx001
                     for i in range(len(lines)))
        if pre761 and (good is None or not any(cmd(k) == "METADATA" and not C(k) for k in range(good[0] + 1, good[1]))):
            fail("MetaCarries", "a key acknowledged with 761 * before 001 is not in a burst batch before "
                 f"{cmd(motd)}")
    # NickIgnoredOn433
    if nick001:
        refused = {W[i][2] for i in range(len(lines)) if not C(i) and cmd(i) == "433" and len(W[i]) > 2}
        if nick001 in refused:
            last433 = max(i for i in range(len(lines)) if not C(i) and cmd(i) == "433" and W[i][2] == nick001)
            if not any(C(j) and cmd(j) == "NICK" and W[j][1] == nick001 for j in range(last433 + 1, idx001)):
                fail("NickIgnoredOn433", f"001 for {nick001}, which got 433")
    # PassRefusalSaid
    if any(C(i) and cmd(i) == "PASS" for i in range(len(lines))) and idx001 is None:
        if not any(not C(i) and cmd(i) in ("464", "ERROR") for i in range(len(lines))):
            fail("PassRefusalSaid", "PASS sent, no 001, and neither 464 nor ERROR")
    # NothingAfterError
    err = next((i for i in range(len(lines)) if not C(i) and cmd(i) == "ERROR"), None)
    if err is not None:
        after = [i for i in range(err + 1, len(lines)) if not C(i) and not lines[i]["raw"].startswith("<")]
        if after:
            fail("NothingAfterError", f"{len(after)} line(s) read after ERROR")
    return out


def main():
    total = 0
    for f in sys.argv[1:]:
        meta = None
        print(f"## {f}")
        for row in open(f):
            r = json.loads(row)
            if r["kind"] == "meta":
                meta = r
                continue
            if not r["lines"]:
                print(f"  {r['name']:26} (no lines: {'; '.join(r.get('note', []))})")
                continue
            for conn in sorted({l["conn"] for l in r["lines"]}):
                res = check([l for l in r["lines"] if l["conn"] == conn])
                if not res:
                    print(f"  {r['name']:26} {conn:4} ok")
                for rule, why in res.items():
                    probe = (r["name"], rule) in PROBES
                    if not probe:
                        total += 1
                    print(f"  {r['name']:26} {conn:4} {rule}: {'client probe: ' if probe else ''}{'; '.join(why)}")
    print(f"\n{total} finding(s) outside the client probes")


if __name__ == "__main__":
    main()
