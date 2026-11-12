#!/usr/bin/env python3
"""Check record_lr.py traces against Delivery.tla's server obligations.

Every labeled command:
  LabelOnce  (D2)    exactly one line carries the label: a single reply,
                     the BATCH start of a labeled-response batch, or ACK.
  AckOnlyAlone (LR)  ACK only when nothing else answers the command: an
                     unlabeled line sent for the command next to an ACK is
                     a reply that should have carried the label.

Messages (PRIVMSG / NOTICE / TAGMSG), the client's pending copies (D15):
  Settles            the labeled line is a settling kind (Settling ==
                     {"echo", "ack", "fail", "err"}).
  KindForEcho        with echo-message the copy is confirmed by its echo;
                     without it, accepted by ACK; an error fails it.  The
                     model's Expect(k) gives the outcome.
  SelfCopy           messaging your own nick yields two copies (LR-5); the
                     model allows either to carry the label (role "resp" or
                     "deliv"), so this is reported, not judged.

    python3 check_lr.py traces/*.jsonl
"""
import json
import re
import sys

TAG = re.compile(r"^@(\S+) ")


def tags(raw):
    m = TAG.match(raw)
    if not m:
        return {}
    out = {}
    for kv in m.group(1).split(";"):
        k, _, v = kv.partition("=")
        out[k] = v
    return out


def body(raw):
    return TAG.sub("", raw, count=1)


def command(raw):
    w = body(raw).split()
    if w and w[0].startswith(":"):
        w = w[1:]
    return w[0].upper() if w else ""


def kind(raw, sent_cmd):
    cmd = command(raw)
    if cmd == "ACK":
        return "ack"
    if cmd == "FAIL":
        return "fail"
    if cmd == "BATCH":
        return "batch"
    if cmd.isdigit():
        return "err" if cmd[0] in "45" else "numeric"
    if cmd == sent_cmd:
        return "echo"
    return cmd.lower()


def check(path):
    rows = [json.loads(l) for l in open(path)]
    meta, cmds = rows[0], rows[1:]
    echo = meta.get("echo")
    res = []
    for r in cmds:
        label = r["label"]
        sent_cmd = command(r["sent"])
        lines = [x["raw"] if isinstance(x, dict) else x for x in r["recv"]]
        labeled = [x for x in lines if tags(x).get("label") == label]
        notes, fails = [], []
        if len(labeled) != 1:
            fails.append(f"LabelOnce: {len(labeled)} labeled lines")
        lk = kind(labeled[0], sent_cmd) if labeled else None
        others = [x for x in lines if tags(x).get("label") != label
                  and not tags(x).get("batch") and command(x) not in ("PING", "PONG")]
        if r["name"] == "privmsg-self":
            # the delivered copy is a message to us, not a reply to the command
            others = [x for x in others if command(x) != sent_cmd]
        if lk == "ack" and others:
            fails.append(f"AckOnlyAlone: ACK plus unlabeled {command(others[0])}")
        if sent_cmd in ("PRIVMSG", "NOTICE", "TAGMSG") and labeled:
            if lk not in ("echo", "ack", "fail", "err"):
                fails.append(f"Settles: labeled line is {lk}")
            else:
                errs = lk in ("fail", "err")
                want = "echo" if echo else "ack"
                self_msg = r["name"] == "privmsg-self"
                if not errs and lk != want and not self_msg:
                    fails.append(f"KindForEcho: {lk}, the model expects {want}")
                if self_msg:
                    copies = [x for x in lines if command(x) == sent_cmd]
                    pos = next((i for i, x in enumerate(copies) if tags(x).get("label") == label), None)
                    notes.append(f"SelfCopy: {len(copies)} copies, label on "
                                 + ("an ACK" if lk == "ack" else f"copy {pos + 1}" if pos is not None else "none"))
        res.append((r["name"], r["shape"], lk, fails, notes))
    return meta, res


def main():
    total = 0
    for path in sys.argv[1:]:
        meta, res = check(path)
        bad = [x for x in res if x[3]]
        total += len(bad)
        print(f"== {meta['server_label']} echo={'on' if meta.get('echo') else 'off'}: "
              f"{len(res) - len(bad)}/{len(res)} commands hold")
        for name, shape, lk, fails, notes in res:
            for f in fails:
                print(f"  FAIL {name} ({shape}, labeled {lk}): {f}")
            for n in notes:
                print(f"  note {name}: {n}")
    return 1 if total else 0


if __name__ == "__main__":
    sys.exit(main())
