#!/usr/bin/env python3
"""Check record_lr.py traces against Delivery.tla's server obligations.

Every labeled command:
  LabelOnce  (D2)    exactly one line carries the label: a single reply,
                     the BATCH start of a batch, or ACK.
  BatchClosed (LR)   a labeled batch, and every batch inside it, ends; a
                     line counts as a member only while its batch is open.
  AckOnlyAlone (LR)  ACK only when nothing else answers the command: not
                     inside a labeled batch, and not beside an unlabeled
                     reply.
  OneResponse (LR)   a lone labeled line has no unlabeled, unbatched reply
                     beside it: a response of more than one message MUST be
                     a batch.

Messages (PRIVMSG / NOTICE / TAGMSG / multiline), the pending copies (D15):
  Settles            the response settles: a lone echo, ACK, FAIL or error;
                     a labeled-response batch whose first settling member is
                     one (a nested multiline batch with a message in it is an
                     echo); or, for a multiline send, its labeled multiline
                     echo.  Without echo-message a lone labeled 301 accepts.
  KindForEcho        with echo-message the copy is confirmed by its echo;
                     without it, accepted by ACK; an error fails it.  The
                     model's Expect(k) gives the outcome.  A NOTICE answered
                     by ACK passes with echo-message on only in NOTICE_DROPS.
  SelfDelivery (LR)  messaging your own nick: the delivered copy MUST NOT
                     carry the label.  With echo-message off the only copy is
                     the delivery, so a labeled copy fails; with it on the two
                     copies cannot be told apart, so that case is reported.

D39 says why each acceptance is as wide as it is; test_check_lr.py holds
the cases it must reject.

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


MSG = ("PRIVMSG", "NOTICE", "TAGMSG")
SETTLING = ("echo", "ack", "fail", "err")
# D39: scenes where the server drops a NOTICE silently, so ACK answers it
# even with echo-message on.  Only these; any other NOTICE ACK is checked as
# a message, and a delivered NOTICE owes its echo.
NOTICE_DROPS = {"notice-chan-moderated"}


def batch_start(raw):
    """(ref, type) for a BATCH +ref line, else None."""
    w = body(raw).split()
    if w and w[0].startswith(":"):
        w = w[1:]
    if len(w) > 1 and w[0].upper() == "BATCH" and w[1].startswith("+"):
        return w[1][1:], (w[2] if len(w) > 2 else "")
    return None


def batch_end(raw):
    w = body(raw).split()
    if w and w[0].startswith(":"):
        w = w[1:]
    if len(w) > 1 and w[0].upper() == "BATCH" and w[1].startswith("-"):
        return w[1][1:]
    return None


def collect(lines, i):
    """The batch that lines[i] opens: its members, top level first, as a
    tree of (line, children) and whether it and every nested batch closed.
    A line counts only while the batch it names is open."""
    ref, btype = batch_start(lines[i])
    node = {"line": lines[i], "type": btype, "members": [], "closed": False}
    open_ = {ref: node}
    for x in lines[i + 1:]:
        end = batch_end(x)
        if end in open_:
            open_.pop(end)["closed"] = True
            if end == ref:
                break
            continue
        parent = open_.get(tags(x).get("batch"))
        if parent is None:
            continue
        st = batch_start(x)
        if st:
            child = {"line": x, "type": st[1], "members": [], "closed": False}
            parent["members"].append(child)
            open_[st[0]] = child
        else:
            parent["members"].append(x)
    return node


def all_closed(node):
    return node["closed"] and all(all_closed(m) for m in node["members"] if isinstance(m, dict))


def is_multiline_echo(node):
    """A multiline batch holding at least one PRIVMSG or NOTICE."""
    return node["type"].endswith("multiline") and any(
        isinstance(m, str) and command(m) in ("PRIVMSG", "NOTICE") for m in node["members"])


def member_kind(m, msg_cmd):
    if isinstance(m, dict):
        return "echo" if msg_cmd and is_multiline_echo(m) else "batch"
    return kind(m, msg_cmd)


def check(path):
    rows = [json.loads(l) for l in open(path)]
    meta, cmds = rows[0], rows[1:]
    echo = meta.get("echo")
    res = []
    for r in cmds:
        label = r["label"]
        sent_cmd = command(r["sent"])
        multiline = sent_cmd == "BATCH" and "multiline" in r["sent"]
        # the command a copy of the message comes back as
        msg_cmd = sent_cmd if sent_cmd in MSG else "PRIVMSG" if multiline else None
        lines = [x["raw"] if isinstance(x, dict) else x for x in r["recv"]]
        idx = [i for i, x in enumerate(lines) if tags(x).get("label") == label]
        notes, fails = [], []
        if len(idx) != 1:
            fails.append(f"LabelOnce: {len(idx)} labeled lines")
        head = lines[idx[0]] if idx else None
        lk = kind(head, sent_cmd) if head else None
        if multiline and lk == "batch":
            lk = None  # decided below from the batch's content
        members = []
        if head and batch_start(head):
            node = collect(lines, idx[0])
            if not all_closed(node):
                fails.append("BatchClosed: the labeled batch, or one inside it, never ends")
            if multiline and is_multiline_echo(node):
                lk = "echo"  # the echo is itself the labeled multiline batch
            elif node["type"] == "labeled-response":
                members = node["members"]
                kinds = [member_kind(m, msg_cmd) for m in members]
                if "ack" in kinds:
                    fails.append("AckOnlyAlone: ACK inside a labeled batch")
                # LR:55-58: the batch is the response; the copy settles on
                # the first settling line in it (a nested multiline echo
                # counts as one).
                lk = next((k for k in kinds if k in SETTLING), "batch")
            else:
                lk = "batch"
        others = [x for x in lines if tags(x).get("label") != label
                  and not tags(x).get("batch") and command(x) not in ("PING", "PONG")
                  and not batch_end(x)]
        if r["name"] in ("privmsg-self", "privmsg-self-away"):
            # the delivered copy is a message to us, not a reply to the command
            others = [x for x in others if command(x) != sent_cmd]
        if head and not batch_start(head) and others:
            # LR: a response of more than one message MUST be a batch; an
            # unlabeled reply beside a lone labeled line breaks that.
            what = "AckOnlyAlone: ACK" if lk == "ack" else f"OneResponse: labeled {command(head)}"
            fails.append(f"{what} plus unlabeled {command(others[0])}")
        if msg_cmd and head and not echo and lk == "numeric" and command(head) == "301":
            # D39: without echo-message a lone labeled RPL_AWAY is the whole
            # response, and it accepts the message.  Only 301: it is the one
            # informational reply a message draws.
            notes.append("AwayAccepts: 301 answers the message")
            lk = "ack"
        if msg_cmd and head:
            if lk not in SETTLING:
                fails.append(f"Settles: labeled response is {lk}")
            elif sent_cmd == "NOTICE" and lk == "ack" and r["name"] in NOTICE_DROPS:
                notes.append("NoticeDropped: ACK, no echo")
            else:
                errs = lk in ("fail", "err")
                want = "echo" if echo else "ack"
                self_msg = r["name"] == "privmsg-self"
                if not errs and lk != want and not self_msg:
                    fails.append(f"KindForEcho: {lk}, the model expects {want}")
                if self_msg and not echo and lk == "echo":
                    # labeled-response: the copy delivered to yourself MUST NOT carry the
                    # label; with echo-message off the only copy is that delivery.
                    fails.append("SelfDelivery: the delivered copy to self carries the label")
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
