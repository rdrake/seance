#!/usr/bin/env python3
"""Check record_lr.py traces against Delivery.tla's server obligations.

Every labeled command:
  LabelOnce  (D2)    exactly one line carries the label: a single reply,
                     the BATCH start of a batch, or ACK.
  BatchRef / BatchNest / BatchClosed (batch spec)
                     references are letters, digits and hyphens; a line
                     names only a batch that is open; a nested batch's start
                     and end name the same outer batch; every batch ends.
  BatchType (LR)     the labeled batch is labeled-response, or a type that
                     answers the whole command (RESPONSE_BATCHES, or the
                     multiline echo of a message).
  EmptyBatch (LR)    an empty labeled-response batch is no response.
  OneResponse (LR)   no reply outside the response: a response of more than
                     one message MUST be one labeled batch.  Lines from other
                     users, a message or multiline batch to ourselves (the
                     delivered copy), a server NOTICE, and a netsplit or
                     netjoin batch are not replies.
  AckOnlyAlone (LR)  ACK only as the whole response, never inside a batch,
                     and with no parameters.

Messages (PRIVMSG / NOTICE / TAGMSG / a multiline batch), D15:
  The response is flattened through nested batches; a multiline batch is
  one echo only if every line in it is from us, of the sent command (PRIVMSG
  for a multiline send), to its target; for a multiline send nothing else
  is an echo.
  EchoEach           with echo-message, every target has its echo or an
                     error about it (a param before the description); an
                     error about no param answers the whole command when the
                     response is errors alone;
                     301s may sit beside them.  A NOTICE answered by ACK
                     passes only in NOTICE_DROPS, an assumption about the
                     fixture.
  KindForEcho        without echo-message, no echo: ACK, 301s and errors.
  SelfDelivery (LR)  without echo-message, the copy delivered to yourself
                     MUST NOT carry the label.
  Settles            nothing else (another numeric, someone else's message)
                     is in the response.

D39 says why each acceptance is as wide as it is; test_check_lr.py holds
the cases it must reject and accept.

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


def split(raw):
    """(source, command, params) of a line, the trailing parameter last."""
    rest = body(raw)
    src = ""
    if rest.startswith(":"):
        src, _, rest = rest[1:].partition(" ")
    head, sep, trailing = rest.partition(" :")
    w = head.split()
    params = w[1:] + ([trailing] if sep else [])
    return src, (w[0].upper() if w else ""), params


def command(raw):
    return split(raw)[1]


def nick_of(src):
    return src.split("!", 1)[0] if "!" in src else None


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
# The draft forbids the unprefixed name.
MULTILINE = ("draft/multiline",)
# LR: a labeled response is a labeled-response batch, or a batch type that
# applies to the whole response of that command.
RESPONSE_BATCHES = {"CHATHISTORY": ("chathistory", "draft/chathistory-targets")}
# Batches that are traffic of their own, never a reply (batch spec).
ASYNC_BATCHES = ("netsplit", "netjoin")
REF_OK = re.compile(r"^[A-Za-z0-9-]+$")
# D39: scenes where the trace's setup makes the server drop a NOTICE
# silently, so ACK answers it even with echo-message on.  An assumption
# about the fixture, not a protocol rule: the scene name cannot prove the
# drop.  Any other NOTICE answered by ACK owes its echo.
NOTICE_DROPS = {"notice-chan-moderated"}
SELF_SCENES = ("privmsg-self", "privmsg-self-away")


def fold(x):
    return x.lower()


class Batches:
    """Every batch the row opens, in order (batch spec): a line may name a
    batch only while it is open; a batch's end, if tagged, names the batch
    its start named."""

    def __init__(self, lines):
        self.nodes, self.errors, self.member_of = {}, [], {}
        open_ = {}
        for i, x in enumerate(lines):
            src, cmd, params = split(x)
            ref = tags(x).get("batch")
            if ref is not None and ref not in open_:
                self.errors.append(f"BatchRef: {cmd} names batch {ref}, which is not open")
                ref = None
            if cmd == "BATCH" and params and params[0].startswith("+"):
                r = params[0][1:]
                if not REF_OK.match(r):
                    self.errors.append(f"BatchRef: reference {r!r} is not letters, digits and hyphens")
                node = {"ref": r, "type": params[1] if len(params) > 1 else "",
                        "args": params[2:], "src": src, "start": i, "parent": ref,
                        "members": [], "closed": False}
                open_[r] = self.nodes[(r, i)] = node
                if ref is not None:
                    open_[ref]["members"].append(node)
                self.member_of[i] = ref
            elif cmd == "BATCH" and params and params[0].startswith("-"):
                r = params[0][1:]
                node = open_.pop(r, None)
                if node is None:
                    self.errors.append(f"BatchRef: end of batch {r}, which is not open")
                else:
                    node["closed"] = True
                    node["end"] = i
                    if ref != node["parent"]:
                        # Either delimiter MAY name an outer batch; once one
                        # does, both name the same one.
                        self.errors.append(f"BatchNest: batch {r} starts in {node['parent']} "
                                           f"but ends in {ref}")
                self.member_of[i] = ("end", r)
            else:
                if ref is not None:
                    open_[ref]["members"].append(i)
                self.member_of[i] = ref
        for r in open_:
            self.errors.append(f"BatchClosed: batch {r} never ends")

    def at(self, i):
        return next(n for n in self.nodes.values() if n["start"] == i)


def subtree(node):
    """Line indices of a batch: its start, every member, every end."""
    out = {node["start"]}
    if "end" in node:
        out.add(node["end"])
    for m in node["members"]:
        out |= subtree(m) if isinstance(m, dict) else {m}
    return out


def all_closed(node):
    return node["closed"] and all(all_closed(m) for m in node["members"] if isinstance(m, dict))


def check(path):
    rows = [json.loads(l) for l in open(path)]
    meta, cmds = rows[0], rows[1:]
    echo = meta.get("echo")
    me = meta.get("nicks", [""])[0]
    res = []
    for r in cmds:
        label = r["label"]
        _, sent_cmd, sent_params = split(r["sent"])
        multiline = sent_cmd == "BATCH" and len(sent_params) > 2 \
            and sent_params[1] in MULTILINE
        is_msg = sent_cmd in MSG or multiline
        # the command its copies come back as: record_lr's multiline scenes
        # send PRIVMSG lines
        msg_cmd = sent_cmd if sent_cmd in MSG else "PRIVMSG" if multiline else None
        targets = ([fold(t) for t in sent_params[0].split(",")] if sent_cmd in MSG
                   else [fold(sent_params[2])] if multiline else [])
        lines = [x["raw"] if isinstance(x, dict) else x for x in r["recv"]]
        bt = Batches(lines)
        notes, fails = [], list(bt.errors)
        idx = [i for i, x in enumerate(lines) if tags(x).get("label") == label]
        if len(idx) != 1:
            fails.append(f"LabelOnce: {len(idx)} labeled lines")
        head = idx[0] if idx else None
        if head is not None and command(lines[head]) == "ACK" and split(lines[head])[2]:
            fails.append("AckOnlyAlone: ACK takes no parameters")

        def mine(i):
            return fold(nick_of(split(lines[i])[0]) or "") == fold(me)

        def item(i):
            """(kind, params) of one line of the response."""
            src, cmd, params = split(lines[i])
            k = kind(lines[i], sent_cmd)
            if multiline and cmd in ("PRIVMSG", "NOTICE"):
                # a multiline send is echoed only by a multiline batch
                k = "loose"
            elif is_msg and cmd == sent_cmd:
                k = "echo" if mine(i) else "foreign"
            if k == "numeric" and cmd == "301":
                k = "away"
            return k, [fold(p) for p in params]

        def items(node):
            """The response's lines, flattened through nested batches.  A
            multiline batch is one echo: from us, only PRIVMSG or only
            NOTICE, every line to the batch's target."""
            out = []
            for m in node["members"]:
                if not isinstance(m, dict):
                    out.append(item(m))
                elif m["type"] in MULTILINE:
                    out.append(multiline_item(m))
                else:
                    out.extend(items(m))
            return out

        def multiline_item(node):
            # The lines carry the sender; the BATCH line's source may be the
            # server.  Every line from us, of the sent command, to the target.
            msgs = [m for m in node["members"] if not isinstance(m, dict)]
            target = fold(node["args"][0]) if node["args"] else ""
            ok = (msgs and len(msgs) == len(node["members"])
                  and all(command(lines[m]) == msg_cmd and mine(m)
                          and fold(split(lines[m])[2][0]) == target for m in msgs))
            return ("echo", [target]) if ok else ("badmultiline", [target])

        response, its, shape = set(), [], None
        if head is not None:
            if command(lines[head]) == "BATCH" and split(lines[head])[2][0].startswith("+"):
                node = bt.at(head)
                response = subtree(node)
                if not all_closed(node):
                    fails.append("BatchClosed: the labeled batch, or one inside it, never ends")
                if node["type"] in MULTILINE and is_msg:
                    its, shape = [multiline_item(node)], "multiline"
                else:
                    if node["type"] != "labeled-response" \
                            and node["type"] not in RESPONSE_BATCHES.get(sent_cmd, ()):
                        fails.append(f"BatchType: a {node['type']} batch cannot be "
                                     f"the response to {sent_cmd}")
                    its, shape = items(node), "batch"
            else:
                response, its, shape = {head}, [item(head)], "single"

        # Replies outside the response.  A line from another user is their
        # traffic, not a reply; a message from us to us is the delivered
        # copy; a line inside a batch outside the response is counted by its
        # batch's start.
        outside = []
        for i, x in enumerate(lines):
            if i in response or command(x) in ("PING", "PONG"):
                continue
            src, cmd, params = split(x)
            n = nick_of(src)
            if n is not None and fold(n) != fold(me):
                continue
            if cmd in MSG and params and fold(params[0]) == fold(me) \
                    and (n is not None or cmd == "NOTICE"):
                # a message to us (the delivered copy of one to ourselves),
                # or a server NOTICE: traffic, not a reply
                continue
            if cmd == "BATCH" and len(params) > 2 and params[1] in MULTILINE \
                    and fold(params[2]) == fold(me):
                continue  # the delivered copy of a multiline message to us
            if cmd == "BATCH" and len(params) > 1 and params[1] in ASYNC_BATCHES:
                continue
            if bt.member_of.get(i) is not None:
                continue
            outside.append(x)
        if outside and head is not None:
            fails.append(f"OneResponse: unlabeled {command(outside[0])} outside the response")

        kinds = [k for k, _ in its]
        if shape == "batch" and not kinds and bt.at(head)["type"] == "labeled-response":
            # An empty chathistory batch is an answer (no lines); an empty
            # labeled-response batch is not.
            fails.append("EmptyBatch: an empty labeled batch is no response; ACK is")
        if "ack" in kinds and (shape != "single" or outside):
            fails.append("AckOnlyAlone: ACK beside another reply")

        if is_msg and head is not None:
            if "badmultiline" in kinds:
                fails.append("Multiline: an echo batch that is not one message kind to its target")
            if echo:
                drop = sent_cmd == "NOTICE" and kinds == ["ack"] and r["name"] in NOTICE_DROPS
                if drop:
                    notes.append("NoticeDropped: ACK, no echo")
                def subjects(k, ps):
                    """What an error is about: a numeric's params between its
                    recipient and its description; a FAIL's context between
                    its command and code and its description."""
                    return ps[1:-1] if k == "err" else ps[2:-1]

                def names(k, ps):
                    return set(subjects(k, ps)) & set(targets)

                # An error about nothing in particular (412, a FAIL with no
                # context) answers the whole command, but only when the
                # response is errors alone.
                wide = bool(kinds) and all(k in ("err", "fail") and not subjects(k, ps)
                                           for k, ps in its)
                for t in targets:
                    covered = drop or wide or any(
                        (k == "echo" and t in ps[:1]) or (k in ("err", "fail") and t in names(k, ps))
                        for k, ps in its)
                    if not covered:
                        what = "ACK" if kinds == ["ack"] else ", ".join(kinds) or "nothing"
                        fails.append(f"EchoEach: no echo or error for {t} ({what})")
                bad = [k for k in kinds if k not in ("echo", "away", "err", "fail", "ack")]
                if bad:
                    fails.append(f"Settles: unexpected {bad[0]} in the response")
            else:
                if "echo" in kinds and r["name"] in SELF_SCENES:
                    # labeled-response: the copy delivered to yourself MUST
                    # NOT carry the label; it is the only copy here.
                    fails.append("SelfDelivery: the delivered copy to self carries the label")
                elif "echo" in kinds:
                    fails.append("KindForEcho: an echo without echo-message")
                bad = [k for k in kinds if k not in ("ack", "away", "err", "fail", "echo")]
                if bad:
                    fails.append(f"Settles: {bad[0]} does not settle the message")
                elif "away" in kinds:
                    notes.append("AwayAccepts: 301 answers the message")
            if r["name"] in SELF_SCENES:
                copies = [i for i, x in enumerate(lines) if command(x) == sent_cmd]
                pos = next((n for n, i in enumerate(copies) if i == head), None)
                notes.append(f"SelfCopy: {len(copies)} copies, label on "
                             + (f"copy {pos + 1}" if pos is not None else command(lines[head])))
        lk = shape if not is_msg else ",".join(kinds) if kinds else None
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
