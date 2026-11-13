#!/usr/bin/env python3
"""Check record_lr.py traces against Delivery.tla's server obligations.

Every labeled command:
  LabelOnce  (D2)    exactly one line carries the label: a single reply,
                     the BATCH start of a batch, or ACK.
  BatchRef / BatchNest / BatchClosed / BatchSyntax (batch spec)
                     references are letters, digits and hyphens; a start
                     has a type, an end nothing after its reference; a line
                     names only a batch that is open; a nested batch's start
                     and end name the same outer batch; every batch ends,
                     and a reference does not start again while open.
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


_servers = set()
# Lines only a server sends (labeled-response ACK, standard replies, PING
# and PONG): their bare source is a server.
SERVER_ONLY = ("ACK", "FAIL", "WARN", "NOTE", "PING", "PONG")
# How many params name subjects after an error numeric's recipient; the
# rest is the description (Modern IRC, and nefarious2's 485-489 and 716).
# Any other error: at least one subject, then the description.
ERR_SUBJECTS = {"401": 1, "402": 1, "403": 1, "404": 1, "405": 1, "406": 1, "407": 1,
                "411": 0, "412": 0, "413": 1, "414": 1, "421": 1, "431": 0, "432": 1,
                "433": 1, "436": 1, "437": 1, "441": 2, "442": 1, "443": 2, "451": 0,
                "461": 1, "462": 0, "464": 0, "465": 0, "471": 1, "473": 1, "474": 1,
                "475": 1, "476": 1, "477": 1, "481": 0, "482": 1, "483": 0, "485": 1,
                "486": 1, "487": 1, "489": 1, "491": 0, "492": 1, "501": 0, "502": 0,
                "716": 1}


def set_servers(meta, rows):
    """The server names the trace shows: the recorder's (the source of 001),
    the source of the version reply, and the bare source of every numeric
    or other line only a server sends."""
    global _servers
    _servers = {meta["server"]} if meta.get("server") else set()
    lines = list(meta.get("version", []))
    for r in rows:
        lines += [x["raw"] if isinstance(x, dict) else x for x in r["recv"]]
    for x in lines:
        src, cmd, _ = split(x)
        if src and "!" not in src and "@" not in src and (cmd.isdigit() or cmd in SERVER_ONLY):
            _servers.add(src)


def nick_of(src):
    """The nick of a user source, or None for a server.  A user source may
    be the nick alone, and neither a nick nor a server name has to hold a
    dot (Modern IRC: SHOULD only), so a bare name is a server only when the
    trace shows it is one."""
    if "!" in src or "@" in src:
        return re.split("[!@]", src, maxsplit=1)[0]
    return src if src and src not in _servers else None


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
FEEDBACK = ("warn", "note")
REF_OK = re.compile(r"^[A-Za-z0-9-]+$")
# FAIL codes whose context is a limit, not a target: they refuse the whole
# message (multiline spec).
WIDE_FAILS = ("MULTILINE_MAX_BYTES", "MULTILINE_MAX_LINES", "MULTILINE_INVALID")
# D39: scenes where the trace's setup makes the server drop a NOTICE
# silently, so ACK answers it even with echo-message on.  An assumption
# about the fixture, not a protocol rule: the scene name cannot prove the
# drop.  Any other NOTICE answered by ACK owes its echo.
NOTICE_DROPS = {"notice-chan-moderated"}
SELF_SCENES = ("privmsg-self", "privmsg-self-away")


# ascii folds A-Z only; rfc1459 also folds []\~ to {}|^, and strict
# rfc1459 (spelled either way) leaves ~ alone.  The trace's ISUPPORT names
# the mapping; a server that names none uses rfc1459 (Modern IRC).  Any
# other mapping (rfc7613, precis) folds Unicode case.
_UPPER = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
CASEMAPS = {"ascii": str.maketrans(_UPPER, _UPPER.lower()),
            "rfc1459": str.maketrans(_UPPER + "[]\\~", _UPPER.lower() + "{}|^"),
            "strict-rfc1459": str.maketrans(_UPPER + "[]\\", _UPPER.lower() + "{}|")}
CASEMAPS["rfc1459-strict"] = CASEMAPS["strict-rfc1459"]
_casemap = CASEMAPS["rfc1459"]


def set_casemapping(isupport):
    global _casemap
    names = [t.split("=", 1)[1] for t in isupport or () if t.startswith("CASEMAPPING=")]
    _casemap = CASEMAPS.get(names[-1] if names else "rfc1459")


def fold(x):
    return x.translate(_casemap) if _casemap is not None else x.lower()


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
            if "multiline-concat" in tags(x):
                self.errors.append("Multiline: the unprefixed multiline-concat tag")
            if ref is not None and ref not in open_:
                self.errors.append(f"BatchRef: {cmd} names batch {ref}, which is not open")
                ref = None
            if cmd == "BATCH" and params and params[0].startswith("+"):
                r = params[0][1:]
                if len(params) > 1 and params[1] == "multiline":
                    self.errors.append("Multiline: the unprefixed multiline batch type")
                if not REF_OK.match(r):
                    self.errors.append(f"BatchRef: reference {r!r} is not letters, digits and hyphens")
                if len(params) < 2:
                    self.errors.append(f"BatchSyntax: batch {r} starts with no type")
                if r in open_:
                    self.errors.append(f"BatchClosed: batch {r} starts again while open")
                node = {"ref": r, "type": params[1] if len(params) > 1 else "",
                        "args": params[2:], "src": src, "start": i, "parent": ref,
                        "members": [], "closed": False}
                open_[r] = self.nodes[(r, i)] = node
                if ref is not None:
                    open_[ref]["members"].append(node)
                self.member_of[i] = ref
            elif cmd == "BATCH" and params and params[0].startswith("-"):
                r = params[0][1:]
                if len(params) != 1:
                    self.errors.append(f"BatchSyntax: the end of batch {r} has parameters")
                if "label" in tags(x):
                    # labeled-response: the label goes on the batch's start
                    self.errors.append(f"BatchSyntax: the end of batch {r} carries a label")
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
                if cmd == "BATCH":
                    self.errors.append("BatchSyntax: a BATCH line that neither starts nor ends a batch")
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
    set_casemapping(meta.get("isupport"))
    set_servers(meta, cmds)
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
                if k == "echo" and len(params) != (1 if cmd == "TAGMSG" else 2):
                    k = "malformed"
            if k == "numeric" and cmd == "301":
                k = "away"
            if k in ("fail",) + FEEDBACK:
                # A standard reply has a command, a code and a description,
                # and its command names the one it answers ("*": none).
                if len(params) < 3:
                    return "malformed", []
                if params[0].upper() not in (sent_cmd, "*"):
                    return "othercmd", []
            if k in ("err", "fail"):
                # What an error is about: the params between its recipient
                # (a numeric) or its command and code (a FAIL) and its
                # description, which is prose and names nothing.
                # Its position says which param is the description, not
                # the wire colon: a one-word last param may come without it.
                if k == "err":
                    n = ERR_SUBJECTS.get(cmd, max(len(params) - 2, 1))
                    if len(params) < n + 2:
                        # recipient, subjects and description, all required
                        return "malformed", []
                    about = params[1:1 + n]
                else:
                    about = params[2:-1]
                if k == "fail" and len(params) > 1 and params[1].upper() in WIDE_FAILS:
                    about = []
                return k, [fold(p) for p in about]
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

        def senders(node):
            return {fold(nick_of(split(lines[m])[0]) or "")
                    for m in node["members"] if not isinstance(m, dict)}

        def well_formed(node, cmd):
            """A multiline batch: exactly one parameter, its target; at
            least one line; every line a message of `cmd` with text, to the
            target, all from one sender (multiline spec).  The BATCH line's
            source may be the server; the lines carry the sender."""
            msgs = [m for m in node["members"] if not isinstance(m, dict)]
            if len(node["args"]) != 1 or len(senders(node)) != 1:
                return False
            target = fold(node["args"][0])
            return bool(msgs) and len(msgs) == len(node["members"]) and all(
                command(lines[m]) == cmd and len(split(lines[m])[2]) == 2
                and fold(split(lines[m])[2][0]) == target for m in msgs)

        def multiline_item(node):
            target = fold(node["args"][0]) if node["args"] else ""
            ok = well_formed(node, msg_cmd) and senders(node) == {fold(me)}
            return ("echo" if ok else "badmultiline", [target])

        # Every multiline batch in the row, wherever it is and whoever sent
        # it, is well formed, and only its start may carry a label.
        for node in bt.nodes.values():
            if node["type"] in MULTILINE:
                if not any(well_formed(node, c) for c in ("PRIVMSG", "NOTICE")):
                    fails.append("Multiline: a multiline batch that is not one sender, "
                                 "one message kind, to its one target")
                if any(not isinstance(m, dict) and "label" in tags(lines[m])
                       for m in node["members"]):
                    fails.append("Multiline: a line inside a multiline batch carries a label")

        response, its, shape = set(), [], None
        if head is not None:
            hp = split(lines[head])[2]
            if command(lines[head]) == "BATCH" and hp and hp[0].startswith("+"):
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
            # A server's PING is traffic; a PONG answers a PING of ours, and
            # the recorder's own sentinel PONG is never in the row.
            if i in response or command(x) == "PING":
                continue
            src, cmd, params = split(x)
            n = nick_of(src)
            if n is not None and fold(n) != fold(me):
                continue
            if cmd in MSG and params and (fold(params[0]) == fold(me)
                                          or (n is None and params[0].startswith("$"))):
                # a message to us (the delivered copy of one to ourselves),
                # a server's own NOTICE or PRIVMSG, or a server's $mask
                # broadcast: traffic, not a reply
                continue
            if cmd == "BATCH" and len(params) > 1 and params[0].startswith("+") \
                    and params[1] in MULTILINE:
                # A multiline message: someone else's is traffic, and so is
                # ours to ourselves (the delivered copy); ours to anyone else
                # is an echo outside the response.  Either way it must be
                # well formed.
                node = bt.at(i)
                who = senders(node)
                to_me = len(params) > 2 and fold(params[2]) == fold(me)
                if who and (fold(me) not in who or to_me):
                    continue
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

        if not is_msg and any(k in ("malformed", "othercmd") for k in kinds):
            fails.append("ReplySyntax: an error or standard reply missing its parameters "
                         "or about another command")
        if is_msg and head is not None:
            if "badmultiline" in kinds:
                fails.append("Multiline: an echo batch that is not one message kind to its target")
            if echo:
                drop = sent_cmd == "NOTICE" and kinds == ["ack"] and r["name"] in NOTICE_DROPS
                if drop:
                    notes.append("NoticeDropped: ACK, no echo")
                def names(k, ps):
                    return set(ps) & set(targets)

                # An error about nothing in particular (412, a FAIL with no
                # context) answers the whole command, but only when the
                # response is errors alone, beside any feedback.
                outcome = [(k, ps) for k, ps in its if k not in FEEDBACK]
                wide = bool(outcome) and all(k in ("err", "fail") and not ps for k, ps in outcome)
                for t in targets:
                    covered = drop or wide or any(
                        (k == "echo" and t in ps[:1]) or (k in ("err", "fail") and t in names(k, ps))
                        for k, ps in its)
                    if not covered:
                        what = "ACK" if kinds == ["ack"] else ", ".join(kinds) or "nothing"
                        fails.append(f"EchoEach: no echo or error for {t} ({what})")
                # WARN and NOTE are feedback beside the outcome (standard
                # replies): they neither settle nor spoil it.
                bad = [k for k in kinds if k not in ("echo", "away", "err", "fail", "ack") + FEEDBACK]
                if bad:
                    fails.append(f"Settles: unexpected {bad[0]} in the response")
            else:
                if "echo" in kinds and r["name"] in SELF_SCENES:
                    # labeled-response: the copy delivered to yourself MUST
                    # NOT carry the label; it is the only copy here.
                    fails.append("SelfDelivery: the delivered copy to self carries the label")
                elif "echo" in kinds:
                    fails.append("KindForEcho: an echo without echo-message")
                bad = [k for k in kinds if k not in ("ack", "away", "err", "fail", "echo") + FEEDBACK]
                if bad:
                    fails.append(f"Settles: {bad[0]} does not settle the message")
                elif kinds and all(k in FEEDBACK for k in kinds):
                    fails.append("Settles: WARN or NOTE alone does not settle the message")
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
