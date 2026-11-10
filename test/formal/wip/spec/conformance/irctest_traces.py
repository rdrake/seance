#!/usr/bin/env python3
"""Turn irctest recordings (irc_recorder pytest plugin) into spec-model traces
for check.py.

One recording per irctest client connection.  A connection is checked only
when the irctest client stayed within what the model client may do; every
other connection is reported as out of scope with the first reason found
(the model client never does it, so the run says nothing about the server
against the model).

In scope:
- the first CAP line is `CAP LS 302`;
- REQs name only caps the server listed, never `-cap`, and the outstanding
  REQs are disjoint (the model client's rule);
- at most two caps besides sasl and cap-notify are ever REQed (they become
  the model's `a` and `b`);
- SASL: one mechanism line, at most one response line, or `*`, per attempt
  (single-step mechanisms such as PLAIN; chunked responses belong to the
  wider-SASL model);
- no client line other than CAP/AUTHENTICATE/NICK/USER/PASS/PING/PONG before
  001.  After 001 only CAP REQ and AUTHENTICATE count; other lines are
  dropped together with their replies, which the model does not see.

The environment (creds, wantSasl, required, svcOk) is left unpinned: TLC
tries every allowed combination.

Usage: irctest_traces.py RECORD.jsonl OUT.jsonl
"""
import base64, collections, json, re, sys

import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import drive

MECH = re.compile(r"^[A-Z][A-Z0-9_-]*$")
IGNORED_PRE = {"NICK", "USER", "PASS", "PING", "PONG"}


class OutOfScope(Exception):
    pass


def first_param(line):
    return drive.parse(line)


def convert(rec):
    ev = rec["events"]
    # caps: other caps the client REQs, in order of first appearance
    others = []
    for k, l in ev:
        if k == "c":
            cmd, p = drive.parse(l)
            if cmd == "CAP" and p and p[0].upper() == "REQ" and len(p) > 1:
                for t in p[-1].split():
                    n = t.lstrip("-").split("=", 1)[0]
                    if n not in ("sasl", "cap-notify") and n not in others:
                        others.append(n)
    if len(others) > 2:
        raise OutOfScope("REQs more than two caps besides sasl/cap-notify")
    capmap = {"sasl": "sasl", "cap-notify": "cap-notify"}
    for n, m in zip(others, ("a", "b")):
        capmap[n] = m
    drive.CAPMAP.clear()
    drive.CAPMAP.update(capmap)

    events, listed, welcomed, ls_seen = [], set(), False, False
    outstanding = []        # model cap sets of unanswered REQs
    sasl_state = "idle"     # idle | mech | data (a response or * was sent)
    sent_quit = False
    for k, l in ev:
        if k == "s":
            cmd, p = drive.parse(l)
            m = drive.model_of(l)
            if cmd == "CAP" and len(p) >= 3 and p[1].upper() == "LS":
                listed |= {t.split("=", 1)[0] for t in p[-1].split()}
            if cmd == "CAP" and len(p) >= 3 and p[1].upper() == "NEW":
                listed |= {t.split("=", 1)[0] for t in p[-1].split()}
            if cmd == "CAP" and len(p) >= 3 and p[1].upper() in ("ACK", "NAK") and outstanding:
                outstanding.pop(0)
            if cmd in ("900", "903", "904", "902", "905", "906", "907"):
                if cmd != "900":
                    sasl_state = "idle"
            if cmd == "001":
                welcomed = True
            if m and m["t"] == "ERROR" and sent_quit:
                m = None
            events.append(("s", l) if m else ("x", l))
            continue
        cmd, p = drive.parse(l)
        msg = None
        if cmd == "CAP":
            sub = p[0].upper() if p else ""
            if sub == "LS":
                if ls_seen:
                    raise OutOfScope("second CAP LS")
                if len(p) < 2 or p[1] != "302":
                    raise OutOfScope("CAP LS without 302")
                ls_seen = True
            elif not ls_seen:
                raise OutOfScope("CAP %s before CAP LS 302" % sub)
            elif sub == "REQ":
                toks = p[-1].split() if len(p) > 1 else []
                if not toks:
                    raise OutOfScope("empty REQ")
                if any(t.startswith("-") for t in toks):
                    raise OutOfScope("REQ removes a cap")
                names = {t.split("=", 1)[0] for t in toks}
                if not names <= listed:
                    raise OutOfScope("REQ of a cap the server did not list")
                caps = {capmap[n] for n in names}
                if any(caps & o for o in outstanding):
                    raise OutOfScope("REQ overlaps an unanswered REQ")
                outstanding.append(caps)
                msg = drive.M("REQ", caps)
            elif sub == "END":
                msg = drive.M("END")
            elif sub in ("LIST",):
                pass
            else:
                raise OutOfScope("CAP %s" % sub)
        elif cmd == "AUTHENTICATE":
            a = p[0] if p else ""
            if a == "*":
                msg = drive.M("AUTHSTAR")
                sasl_state = "data"
            elif sasl_state == "idle" and MECH.match(a):
                msg = drive.M("AUTHMECH")
                sasl_state = "mech"
            elif sasl_state == "mech":
                if len(a) >= 400:
                    raise OutOfScope("chunked SASL response")
                msg = drive.M("AUTHDATA")
                sasl_state = "data"
            else:
                raise OutOfScope("multi-step SASL exchange")
        elif cmd == "QUIT":
            sent_quit = True
            if not welcomed:
                raise OutOfScope("QUIT before registration")
        elif cmd in IGNORED_PRE:
            pass
        elif not welcomed:
            raise OutOfScope("%s before 001" % cmd)
        events.append(("c", l, msg))
    if not ls_seen:
        raise OutOfScope("no CAP LS 302")

    class C:
        pass
    c = C()
    c.events = [e for e in events if e[0] != "x"]
    c.raw = [e[1] for e in events]
    tr = drive.to_trace(c, {"name": rec["test"] + "#" + rec["client"], "sasl": []})
    tr["env"] = None
    tr["other"] = ["a", "b"][:len(others)] or ["a"]
    return tr


def main():
    recs = [json.loads(l) for l in open(sys.argv[1])]
    out = open(sys.argv[2], "w")
    why = collections.Counter()
    n = 0
    for r in recs:
        try:
            tr = convert(r)
        except OutOfScope as e:
            why[str(e)] += 1
            continue
        out.write(json.dumps(tr, default=sorted) + "\n")
        n += 1
    print(f"{len(recs)} connections: {n} in scope")
    for k, v in why.most_common():
        print(f"  {v:4d} out of scope: {k}")


if __name__ == "__main__":
    main()
