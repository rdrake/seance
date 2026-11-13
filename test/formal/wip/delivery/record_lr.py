#!/usr/bin/env python3
"""Record how a server answers labeled commands: a labeled-response batch,
a single labeled line, or a bare ACK (labeled-response's three shapes).

Server-agnostic: everything about the server comes from flags.

  record_lr.py HOST PORT OUT.jsonl --server-label NAME
               [--sasl ACCOUNT:PASSWORD] [--no-echo]

One connection (nick <runid>a) with batch, labeled-response, message-tags,
server-time, draft/chathistory and, unless --no-echo, echo-message. A second
connection (<runid>b) joins the same channel so channel lines have a
recipient. After each labeled command the recorder reads until the label is
complete (a line carrying the label outside any batch, or the end of the
labeled batch), then sends a PING sentinel and reads until its PONG, so a
late or unlabeled reply is still recorded.

One JSON object per line:
  meta  - server label, caps, ISUPPORT, version reply, run id
  trace - scenario name, the raw line sent, its label, every received line
          up to the sentinel (raw, in order, with arrival ms since the send),
          and `shape`: "batch" | "single" | "ack" | "none" (no labeled
          completion before the sentinel), with `batch_type` for a batch.
"""
import argparse, base64, json, random, select, socket, string, time

ap = argparse.ArgumentParser()
ap.add_argument("host"); ap.add_argument("port", type=int); ap.add_argument("out")
ap.add_argument("--server-label", required=True)
ap.add_argument("--sasl")
ap.add_argument("--no-echo", action="store_true")
ap.add_argument("--timeout", type=float, default=5.0)
args = ap.parse_args()

RUN = "lr" + "".join(random.choice(string.ascii_lowercase) for _ in range(4))
CHAN = "#" + RUN


def tags_of(line):
    if not line.startswith("@"):
        return {}, line
    head, _, rest = line.partition(" ")
    out = {}
    for kv in head[1:].split(";"):
        k, _, v = kv.partition("=")
        out[k] = v
    return out, rest


def words(line):
    _, rest = tags_of(line)
    return rest.split(" ")


class Conn:
    def __init__(self, nick, want, sasl=None):
        self.s = socket.create_connection((args.host, args.port), timeout=30)
        self.buf = b""
        self.wait = 30.0
        self.nick, self.isupport, self.caps = nick, [], []
        self.send("CAP LS 302")
        self.send(f"NICK {nick}")
        self.send(f"USER {nick} 0 * :{nick}")
        offered = ""
        while True:
            l = self.read()
            w = words(l)
            if l.startswith("PING"):
                self.send("PONG" + l[4:])
            if len(w) > 3 and w[1] == "CAP" and w[3] == "LS":
                offered += " " + l.split(" :", 1)[1] if " :" in l else ""
                if w[4] != "*":
                    names = {c.split("=")[0] for c in offered.split()}
                    self.caps = [c for c in want if c in names]
                    if sasl:
                        self.caps.append("sasl")
                    if self.caps:
                        self.send("CAP REQ :" + " ".join(self.caps))
                    else:
                        self.send("CAP END")
            if len(w) > 3 and w[1] == "CAP" and w[3] == "ACK":
                if sasl:
                    self.send("AUTHENTICATE PLAIN")
                else:
                    self.send("CAP END")
            if l.startswith("AUTHENTICATE +"):
                acct, pw = sasl.split(":", 1)
                self.send("AUTHENTICATE " + base64.b64encode(f"{acct}\0{acct}\0{pw}".encode()).decode())
            if len(w) > 1 and w[1] in ("903", "904", "905"):
                self.send("CAP END")
            if len(w) > 2 and w[1] == "001":
                self.server = w[0].lstrip(":")
                self.nick = w[2]  # what the server calls us (a bouncer may differ)
            if len(w) > 1 and w[1] == "005":
                self.isupport += w[3:]
            if len(w) > 1 and w[1] == "376" or len(w) > 1 and w[1] == "422":
                break

    def send(self, line):
        self.s.sendall((line + "\r\n").encode())

    def read(self):
        """One line; raises TimeoutError after `self.wait` seconds of silence."""
        while b"\n" not in self.buf:
            if not select.select([self.s], [], [], self.wait)[0]:
                raise TimeoutError
            chunk = self.s.recv(65536)
            if not chunk:
                raise EOFError
            self.buf += chunk
        l, _, self.buf = self.buf.partition(b"\n")
        return l.decode(errors="replace").rstrip("\r")

    def settimeout(self, secs):
        self.wait = secs

    def drain(self, secs=0.5):
        self.wait = secs
        try:
            while True:
                self.read()
        except TimeoutError:
            pass
        self.wait = 30.0


seq = [0]


def run(c, name, cmd, tags="", follow=()):
    """Send `cmd` labeled (plus client `tags`) and then the `follow` lines
    unlabeled (a multiline batch's body); record until the label
    completes, then a sentinel."""
    seq[0] += 1
    label = f"L{seq[0]}"
    sent = f"@label={label}{';' + tags if tags else ''} {cmd}"
    t0 = time.time()
    c.send(sent)
    for f in follow:
        c.send(f)
    recv, shape, btype, open_ref, done = [], "none", None, None, False
    c.settimeout(args.timeout)
    try:
        while not done:
            l = c.read()
            recv.append({"ms": round((time.time() - t0) * 1000), "raw": l})
            t, rest = tags_of(l)
            w = rest.split(" ")
            if t.get("label") == label:
                if len(w) > 2 and w[1] == "BATCH" and w[2].startswith("+"):
                    shape, open_ref = "batch", w[2][1:]
                    btype = w[3] if len(w) > 3 else None
                elif len(w) > 1 and w[1] == "ACK":
                    shape, done = "ack", True
                else:
                    shape, done = "single", True
            elif open_ref and len(w) > 2 and w[1] == "BATCH" and w[2] == "-" + open_ref:
                done = True
    except TimeoutError:
        pass
    c.settimeout(30)
    tok = f"sentinel{seq[0]}"
    c.send(f"PING :{tok}")
    while True:
        l = c.read()
        if " PONG " in l and tok in l:
            break
        recv.append({"ms": round((time.time() - t0) * 1000), "raw": l, "after_label": True})
    rec = {"kind": "trace", "name": name, "sent": sent, "label": label, "shape": shape,
           "recv": recv}
    if btype:
        rec["batch_type"] = btype
    return rec


want = ["batch", "labeled-response", "message-tags", "server-time", "draft/chathistory",
        "draft/multiline", "draft/read-marker", "setname"]
if not args.no_echo:
    want.append("echo-message")
a = Conn(RUN + "a", want, args.sasl)
b = Conn(RUN + "b", ["message-tags", "server-time"])
a.send(f"JOIN {CHAN}")
time.sleep(1)  # a first, so a holds ops (KICK, INVITE)
b.send(f"JOIN {CHAN}")
time.sleep(1); a.drain(); b.drain()
a.send("VERSION")
ver = []
a.settimeout(3)
try:
    while True:
        l = a.read()
        if " 351 " in l:
            ver.append(l)
            break
except TimeoutError:
    pass
a.drain()

recs = [{"kind": "meta", "server_label": args.server_label, "runid": RUN, "caps": a.caps,
         "echo": not args.no_echo, "sasl": bool(args.sasl), "isupport": a.isupport,
         "version": ver, "chan": CHAN, "nicks": [a.nick, b.nick]}]

S = [
    ("privmsg-chan", f"PRIVMSG {CHAN} :hello one"),
    ("notice-chan", f"NOTICE {CHAN} :notice one"),
    ("privmsg-self", f"PRIVMSG {a.nick} :to myself"),
    ("privmsg-user", f"PRIVMSG {b.nick} :to b"),
    ("privmsg-nosuchnick", f"PRIVMSG {RUN}zz :nobody"),
    ("tagmsg-chan", f"TAGMSG {CHAN}", "+typing=active"),
    ("ping", "PING :labeled"),
    ("pong-noreply", "PONG :nothing"),
    ("mode-query", f"MODE {CHAN}"),
    ("whois", f"WHOIS {b.nick}"),
    ("names", f"NAMES {CHAN}"),
    ("topic-set", f"TOPIC {CHAN} :a topic"),
    ("away-set", "AWAY :gone"),
    ("away-unset", "AWAY"),
    ("chathistory-latest", f"CHATHISTORY LATEST {CHAN} * 10"),
    ("chathistory-empty", f"CHATHISTORY LATEST #{RUN}none * 10"),
    ("chathistory-before-unknown", f"CHATHISTORY BEFORE {CHAN} msgid=zzzz-unknown 5"),
    ("chathistory-targets", "CHATHISTORY TARGETS timestamp=2000-01-01T00:00:00.000Z timestamp=2100-01-01T00:00:00.000Z 10"),
    ("join-new", f"JOIN #{RUN}two"),
    ("part", f"PART #{RUN}two :bye"),
    ("unknown-command", "FROBNICATE x"),
]
for name, cmd, *tags in S:
    recs.append(run(a, name, cmd, *tags))

def scene(name, cmd, tags="", setup=(), undo=(), follow=()):
    """One scenario with its own state: `setup` lines are sent (as
    (connection, line) pairs) and both sides drained before the labelled
    command, and `undo` puts things back after it, so the next scenario
    starts from the plain state above."""
    for c, l in setup:
        c.send(l)
        time.sleep(0.2)
    if setup:
        a.drain(); b.drain()
    recs.append(run(a, name, cmd, tags, follow))
    for c, l in undo:
        c.send(l)
        time.sleep(0.2)
    if undo:
        a.drain(); b.drain()


B = b.nick
AWAY = [(b, "AWAY :b is away")]
BACK = [(b, "AWAY")]
LONG = "x" * 380  # near the line cap once the prefix is added

# The person you message, in each state they can be in.
# A message to someone away draws a 301 as well as the echo: two replies,
# which labeled-response wants in one labelled batch.
scene("privmsg-user-away", f"PRIVMSG {B} :to away b", setup=AWAY, undo=BACK)
# Controls: a NOTICE or TAGMSG draws no 301.
scene("notice-user-away", f"NOTICE {B} :notice to away b", setup=AWAY, undo=BACK)
scene("tagmsg-user-away", f"TAGMSG {B}", "+typing=active", setup=AWAY, undo=BACK)
# What a client really sends to someone away: /me, a reply, a long line.
scene("action-user-away", f"PRIVMSG {B} :\x01ACTION waves\x01", setup=AWAY, undo=BACK)
scene("reply-user-away", f"PRIVMSG {B} :a reply", "+draft/reply=zzzz", setup=AWAY, undo=BACK)
scene("privmsg-user-away-long", f"PRIVMSG {B} :{LONG}", setup=AWAY, undo=BACK)
scene("privmsg-user-away-twice", f"PRIVMSG {B} :second to away b",
      setup=AWAY + [(a, f"PRIVMSG {B} :first to away b")], undo=BACK)
# Two targets, one of them away: one labelled batch with both echoes.
scene("privmsg-two-targets", f"PRIVMSG {B},{CHAN} :to b and the channel")
scene("privmsg-two-targets-away", f"PRIVMSG {B},{CHAN} :to away b and the channel",
      setup=AWAY, undo=BACK)
scene("privmsg-user-at-server", f"PRIVMSG {B}@{a.server} :to b at server")
scene("privmsg-self-away", f"PRIVMSG {a.nick} :to myself while away",
      setup=[(a, "AWAY :a is away")], undo=[(a, "AWAY")])
scene("action-user", f"PRIVMSG {B} :\x01ACTION waves\x01")
scene("privmsg-user-long", f"PRIVMSG {B} :{LONG}")
scene("reply-user", f"PRIVMSG {B} :a reply", "+draft/reply=zzzz")
# The person refuses private messages (+D), takes them only from people
# sharing a channel (+q), or only from logged-in people (+R).
scene("privmsg-user-privdeaf", f"PRIVMSG {B} :to privdeaf b",
      setup=[(b, f"MODE {B} +D")], undo=[(b, f"MODE {B} -D")])
scene("tagmsg-user-privdeaf", f"TAGMSG {B}", "+typing=active",
      setup=[(b, f"MODE {B} +D")], undo=[(b, f"MODE {B} -D")])
scene("privmsg-user-commonchans", f"PRIVMSG {B} :no common channel",
      setup=[(b, f"PART {CHAN}"), (b, f"MODE {B} +q")],
      undo=[(b, f"MODE {B} -q"), (b, f"JOIN {CHAN}")])
scene("privmsg-user-accountonly", f"PRIVMSG {B} :from an unauthed sender",
      setup=[(b, f"MODE {B} +R")], undo=[(b, f"MODE {B} -R")])
# The person silences us: dropped without a word, so the sender still
# needs its echo (or ACK) to settle.
scene("privmsg-user-silenced", f"PRIVMSG {B} :to b who silenced a",
      setup=[(b, f"SILENCE +{a.nick}!*@*")], undo=[(b, f"SILENCE -{a.nick}!*@*")])
scene("tagmsg-user-silenced", f"TAGMSG {B}", "+typing=active",
      setup=[(b, f"SILENCE +{a.nick}!*@*")], undo=[(b, f"SILENCE -{a.nick}!*@*")])
# Deaf (+d) drops channel messages for that member only.
scene("privmsg-chan-deaf-member", f"PRIVMSG {CHAN} :b is deaf",
      setup=[(b, f"MODE {B} +d")], undo=[(b, f"MODE {B} -d")])
# The person changed nick or left between typing and sending.
scene("privmsg-old-nick", f"PRIVMSG {B} :to the old nick",
      setup=[(b, f"NICK {B}n")], undo=[(b, f"NICK {B}")])
scene("privmsg-user-quit", f"PRIVMSG {RUN}c :to someone who left",
      setup=[(Conn(RUN + "c", []), "QUIT :gone")])

# Channels in states that refuse or change a message. b owns each of these.
M, N, X, K, P = (f"#{RUN}{s}" for s in "mnxkp")
scene("privmsg-chan-moderated", f"PRIVMSG {M} :unvoiced",
      setup=[(b, f"JOIN {M}"), (b, f"MODE {M} +m"), (a, f"JOIN {M}")],
      undo=[(a, f"PART {M}")])
scene("tagmsg-chan-moderated", f"TAGMSG {M}", "+typing=active",
      setup=[(a, f"JOIN {M}")], undo=[(a, f"PART {M}")])
scene("privmsg-chan-outside", f"PRIVMSG {N} :from outside",
      setup=[(b, f"JOIN {N}"), (b, f"MODE {N} +n")])
scene("privmsg-chan-banned", f"PRIVMSG {X} :while banned",
      setup=[(b, f"JOIN {X}"), (a, f"JOIN {X}"), (b, f"MODE {X} +b {a.nick}!*@*")],
      undo=[(a, f"PART {X}")])
scene("privmsg-chan-nocolour", f"PRIVMSG {K} :\x0304red\x03 text",
      setup=[(b, f"JOIN {K}"), (b, f"MODE {K} +c"), (a, f"JOIN {K}")],
      undo=[(a, f"PART {K}")])
scene("privmsg-chan-parted", f"PRIVMSG {P} :after leaving",
      setup=[(a, f"JOIN {P}"), (a, f"PART {P}")])
scene("privmsg-statusmsg", f"PRIVMSG @{CHAN} :to the ops")
scene("notice-chan-moderated", f"NOTICE {M} :unvoiced notice",
      setup=[(a, f"JOIN {M}")], undo=[(a, f"PART {M}")])
scene("multiline-chan", f"BATCH +ml draft/multiline {CHAN}",
      follow=[f"@batch=ml PRIVMSG {CHAN} :line one",
              f"@batch=ml PRIVMSG {CHAN} :line two", "BATCH -ml"])
scene("multiline-user-away", f"BATCH +mu draft/multiline {B}",
      setup=AWAY, undo=BACK,
      follow=[f"@batch=mu PRIVMSG {B} :line one",
              f"@batch=mu PRIVMSG {B} :line two", "BATCH -mu"])

# Commands whose answer is more than one line.
J = f"#{RUN}j"
scene("join-existing", f"JOIN {J}",
      setup=[(b, f"JOIN {J}"), (b, f"TOPIC {J} :existing topic")],
      undo=[(a, f"PART {J}")])
scene("invite-user-away", f"INVITE {B} {CHAN}",
      setup=[(b, f"PART {CHAN}")] + AWAY, undo=BACK + [(b, f"JOIN {CHAN}")])
scene("whois-user-away", f"WHOIS {B}", setup=AWAY, undo=BACK)
scene("kick", f"KICK {CHAN} {B} :out", undo=[(b, f"JOIN {CHAN}")])
scene("monitor-online", f"MONITOR + {B}", undo=[(a, f"MONITOR - {B}")])
scene("nick-change", f"NICK {RUN}a2", undo=[(a, f"NICK {a.nick}")])
scene("setname", "SETNAME :a new realname")
scene("markread-set", f"MARKREAD {CHAN} timestamp=2026-01-01T00:00:00.000Z")
scene("markread-get", f"MARKREAD {CHAN}")

for c in (a, b):
    c.send("QUIT :done")
with open(args.out, "w") as f:
    for r in recs:
        f.write(json.dumps(r) + "\n")
print(args.out, len(recs) - 1, "traces")
for r in recs[1:]:
    print(f"  {r['name']:28} {r['shape']:7} {r.get('batch_type') or ''}")
