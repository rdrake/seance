#!/usr/bin/env python3
"""Drive a real IRC server's CHATHISTORY and record what it answers.

Server-agnostic: everything about the server comes from flags.  Nothing here
knows which ircd it talks to.

  drive.py HOST PORT OUT.jsonl [--tls] [--insecure] [--sni NAME]
           [--pass PW] [--sasl ROLE=account:password ...] [--runid ID]
           [--gap SECONDS] [--pace SECONDS] [--server-label NAME]

Roles: q (the querier), a, b, c (senders), l (a late joiner).  Each role is
one connection with nick <runid><role>.  Channels are <#><runid><suffix>, so a
server with persistent history never mixes runs.

What it does (the jsonl records, one per line, in order):
  meta   - caps, ISUPPORT, the version reply, run id, channel names
  msg    - every seeded line: sender, text, the echo's msgid and time (the
           store's ground truth), and the querier's relayed copy
  query  - each CHATHISTORY the querier sent, the raw command, what the
           querier knew of each channel's store when it sent it (known) and
           once the answer had arrived (known_after), and every line between
           the command and a PING/PONG sentinel
  join   - the late joiner's JOIN, with every line up to its sentinel (CH:41)

The checker (check.py) needs nothing else.
"""
import argparse, json, os, random, sys, time
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ircwire import Conn, parse  # noqa: E402


def ts2ms(s):
    d = datetime.strptime(s.rstrip("Z")[:23], "%Y-%m-%dT%H:%M:%S.%f")
    return int(d.replace(tzinfo=timezone.utc).timestamp() * 1000 + 0.5)


def ms2ts(ms):
    d = datetime.fromtimestamp(ms / 1000, tz=timezone.utc)
    return d.strftime("%Y-%m-%dT%H:%M:%S.") + f"{ms % 1000:03d}Z"


class Run:
    def __init__(self, a):
        self.a = a
        self.out = open(a.out, "w")
        self.rid = a.runid or "h" + "".join(random.choice("abcdefghjkmnpqrstuvwxyz") for _ in range(5))
        sasl = dict(s.split("=", 1) for s in a.sasl)
        self.sasl = sasl
        mk = lambda role: Conn(a.host, a.port, self.rid + role, tls=a.tls, insecure=a.insecure,
                               sni=a.sni, password=a.password, sasl=sasl.get(role))
        self.mk = mk
        self.c = {r: mk(r) for r in "qabc"}
        self.q = self.c["q"]
        self.ch = {k: f"#{self.rid}{k}" for k in ("hist", "tlc", "empty", "other", "nojoin", "nosuch")}
        self.store = {}            # chan -> list of msg records, in the querier's relay order
        self.n = 0
        self.qi = 0
        self.qstash = []

    def rec(self, r):
        self.out.write(json.dumps(r) + "\n")
        self.out.flush()

    # -- setup
    def join(self, role, chans):
        c = self.c[role]
        c.send("JOIN " + ",".join(chans))
        for ch in chans:
            lines, _ = c.until(lambda m, ch=ch: m["cmd"] == "366" and m["params"][1].lower() == ch.lower())
            if role == "q":
                self.qstash += lines

    def events(self):
        """Channel events the querier saw before seeding (JOINs).  A server
        may store them and replay them in a chathistory batch even without
        draft/event-playback (CH:73 allows only PRIVMSG/NOTICE lines, so it
        would replay them as PRIVMSG/NOTICE); the checker decides per
        channel whether they belong to the store."""
        lines = self.qstash + self.q.sync("joined")
        self.qstash = []
        k = 0
        for l in lines:
            m = parse(l)
            if m["cmd"] in ("JOIN", "PART", "MODE", "TOPIC") and m["params"] and m["params"][0].startswith("#"):
                k += 1
                self.rec({"kind": "event", "k": k, "chan": m["params"][0], "cmd": m["cmd"],
                          "nick": (m["source"] or "").split("!")[0], "msgid": m["tags"].get("msgid"),
                          "time": m["tags"].get("time"), "line": l})

    def meta(self):
        self.q.send("VERSION")
        vl = self.q.sync("version")
        version = [l for l in vl if parse(l)["cmd"] == "351"]
        self.rec({"kind": "meta", "server_label": self.a.server_label, "runid": self.rid,
                  "host": self.a.host, "port": self.a.port, "tls": self.a.tls,
                  "caps": sorted(self.q.caps), "offered": self.q.offered,
                  "isupport": self.q.isupport, "version": version, "channels": self.ch,
                  "nicks": {r: c.nick for r, c in self.c.items()},
                  "sasl_roles": sorted(self.sasl), "started": time.time()})

    # -- seeding
    def say(self, chan, roles_texts, together=False):
        """Each (role, target, text) is sent; with together, all are written
        before any echo is awaited (one write per connection), to provoke
        lines stored in the same millisecond."""
        sent = []
        for role, target, text in roles_texts:
            sent.append((role, target, text))
        if together:
            by = {}
            for role, target, text in sent:
                by.setdefault(role, []).append(f"PRIVMSG {target} :{text}")
            for role, ls in by.items():
                self.c[role].send(*ls)
        echoes = {}
        for role, target, text in sent:
            if not together:
                self.c[role].send(f"PRIVMSG {target} :{text}")
            c = self.c[role]
            lines, m = c.until(lambda m, text=text: m["cmd"] == "PRIVMSG" and m["params"][-1] == text
                               and (m["source"] or "").split("!")[0].lower() == c.nick.lower())
            echoes[text] = (lines[-1], m)
            if role == "q":
                self.qstash += lines      # relays the querier read while waiting
            if not together and self.a.gap:
                time.sleep(self.a.gap)
        for role, target, text in sent:
            l, m = echoes[text]
            self.n += 1
            r = {"kind": "msg", "n": self.n, "chan": chan, "target": target, "sender": self.c[role].nick,
                 "role": role, "text": text, "msgid": m["tags"].get("msgid"), "time": m["tags"].get("time"),
                 "echo": l, "together": together}
            self.pending.append(r)
        if together and self.a.gap:
            time.sleep(self.a.gap)

    def settle(self):
        """Collect the querier's relayed copies and fix the relay order."""
        lines = self.qstash + self.q.sync(f"seed{self.n}")
        self.qstash = []
        idx = {}
        for k, l in enumerate(lines):
            m = parse(l)
            if m["cmd"] == "PRIVMSG":
                idx[m["params"][-1]] = (k, l, m)
        for r in self.pending:
            own = r["role"] == "q"
            k, l, m = idx.get(r["text"], (None, None, None))
            r["relay"] = l
            r["relay_k"] = k
            if own:
                r["relay"] = r["echo"]
        # the querier's relay order; its own lines (DMs) in echo order
        self.pending.sort(key=lambda r: (r["relay_k"] is None, r["relay_k"] or 0, r["n"]))
        for r in self.pending:
            self.store.setdefault(r["chan"], []).append(r)
            self.rec(r)
        self.pending = []

    def seed(self):
        self.pending = []
        H, T, O, N = self.ch["hist"], self.ch["tlc"], self.ch["other"], self.ch["nojoin"]
        txt = lambda tag: f"{self.rid} {tag}"
        # #hist: distinct times, one same-sender burst, one cross-sender burst
        for role, tag in (("a", "h01"), ("b", "h02"), ("a", "h03")):
            self.say(H, [(role, H, txt(tag))])
        self.say(H, [("a", H, txt(f"h0{k}")) for k in range(4, 8)], together=True)
        self.say(H, [("c", H, txt("h08"))])
        self.say(H, [("b", H, txt("h09")), ("c", H, txt("h10"))], together=True)
        for role, tag in (("a", "h11"), ("b", "h12"), ("c", "h13"), ("a", "h14")):
            self.say(H, [(role, H, txt(tag))])
        # #tlc: four lines, the middle two in one burst
        self.say(T, [("a", T, txt("t1"))])
        self.say(T, [("a", T, txt("t2")), ("a", T, txt("t3"))], together=True)
        self.say(T, [("a", T, txt("t4"))])
        self.say(O, [("a", O, txt("o1"))])
        self.say(N, [("a", N, txt("n1"))])
        # a direct conversation between the querier and a
        qa = self.c["a"].nick
        self.say("dm", [("a", self.q.nick, txt("d1"))])
        self.say("dm", [("q", qa, txt("d2"))])
        self.settle()

    # -- queries
    def ask(self, cmd, note, followup_of=None, chan=None, racing=None):
        self.qi += 1
        i = self.qi
        label = f"L{i}" if ("labeled-response" in self.q.caps or
                             "draft/labeled-response-0.2" in self.q.caps) else None
        known = {k: len(v) for k, v in self.store.items()}
        line = (f"@label={label} " if label else "") + cmd
        self.q.send(line)
        lines = self.q.sync(f"Q{i}")
        r = {"kind": "query", "i": i, "cmd": cmd, "label": label, "note": note, "chan": chan,
             "followup_of": followup_of, "known": known,
             "known_after": {k: len(v) + (1 if k == racing else 0) for k, v in self.store.items()},
             "lines": lines}
        self.rec(r)
        if self.a.pace:
            time.sleep(self.a.pace)
        return r

    @staticmethod
    def page(r):
        """The messages of the first chathistory batch in a response, and its
        end tag; None when there is no such batch."""
        open_, ref, end, ms = {}, None, False, []
        for l in r["lines"]:
            m = parse(l)
            if m["cmd"] == "BATCH" and m["params"] and m["params"][0].startswith("+"):
                if len(m["params"]) >= 2 and m["params"][1] == "chathistory" and ref is None:
                    ref, end = m["params"][0][1:], "draft/chathistory-end" in m["tags"]
            elif m["tags"].get("batch") == ref and ref and m["cmd"] in ("PRIVMSG", "NOTICE"):
                ms.append(m)
        return None if ref is None else (ms, end)

    def matrix(self, chan, deep=True, lean=False):
        S = self.store[chan]
        N = len(S)
        mid, ts = (lambda r: f"msgid={r['msgid']}"), (lambda r: f"timestamp={r['time']}")
        times = [ts2ms(r["time"]) for r in S]
        tie = [k for k in range(1, N) if times[k] == times[k - 1]]
        # anchors: oldest, second, middle, tie members, second newest, newest
        picks = sorted({0, 1, N // 2, N - 2, N - 1} | set(tie) | {k - 1 for k in tie})
        if not deep:
            picks = sorted({0, N // 2, N - 1} | set(tie) | {k - 1 for k in tie})
        lims = sorted({1, 2, 3, N, N + 5}) if deep else sorted({1, 2, N + 3})
        gaps = [ms2ts((times[k] + times[k + 1]) // 2) for k in range(N - 1) if times[k + 1] - times[k] >= 2]
        tsx = [ms2ts(times[0] - 1000), ms2ts(times[-1] + 1000)] + gaps[:2]
        A = lambda sub, sel, lim, note: self.ask(f"CHATHISTORY {sub} {chan} {sel} {lim}", note, chan=chan)
        out = []
        for lim in sorted({1, 2, 3, N - 1, N, N + 1, N + 5, 100}):
            out.append(A("LATEST", "*", lim, f"LATEST * {lim}"))
        for k in picks:
            for lim in lims:
                for sub in ("LATEST", "BEFORE", "AFTER", "AROUND"):
                    out.append(A(sub, mid(S[k]), lim, f"{sub} msgid=#{k}"))
                    out.append(A(sub, ts(S[k]), lim, f"{sub} ts=#{k}"))
        for t in tsx:
            for sub in ("LATEST", "BEFORE", "AFTER", "AROUND"):
                out.append(A(sub, f"timestamp={t}", 3, f"{sub} ts=off-message"))
        # BETWEEN, both directions, msgid/ts/mixed
        pairs = [(0, N - 1), (1, N - 2), (0, 1), (N // 2, N // 2)] + [(k - 1, k + 1) for k in tie if k + 1 < N]
        pairs += [(k - 1, k) for k in tie]
        combos = [(mid, mid), (ts, ts), (mid, ts)] if lean else [(fx, fy) for fx in (mid, ts) for fy in (mid, ts)]
        for x, y in pairs:
            for lim in ((2,) if lean else (1, 2, N + 5) if deep else (2, N + 5)):
                for fx, fy in combos:
                    if True:
                        out.append(self.ask(f"CHATHISTORY BETWEEN {chan} {fx(S[x])} {fy(S[y])} {lim}",
                                            f"BETWEEN #{x} #{y} fwd", chan=chan))
                        out.append(self.ask(f"CHATHISTORY BETWEEN {chan} {fy(S[y])} {fx(S[x])} {lim}",
                                            f"BETWEEN #{y} #{x} back", chan=chan))
        return out

    def followups(self, rs):
        """CH:136's "next page": for every non-empty page of a directional
        query, ask the next page in the same direction (msgid anchors, as
        CH:208 does)."""
        for r in rs:
            p = self.page(r)
            if not p or not p[0]:
                continue
            ms, end = p
            w = r["cmd"].split()
            sub, chan = w[1].upper(), w[2]
            first, last = ms[0]["tags"].get("msgid"), ms[-1]["tags"].get("msgid")
            if not first or not last:
                continue
            lim = w[-1]
            if sub == "LATEST" and w[3] != "*":
                # LATEST <sel>'s next page stays bounded by <sel>
                cmd = f"CHATHISTORY BETWEEN {chan} msgid={first} {w[3]} {lim}"
            elif sub in ("LATEST", "BEFORE"):
                cmd = f"CHATHISTORY BEFORE {chan} msgid={first} {lim}"
            elif sub == "AFTER":
                cmd = f"CHATHISTORY AFTER {chan} msgid={last} {lim}"
            elif sub == "BETWEEN":
                # direction from the page's own order is not known here; the
                # checker derives it; ask both continuations it might mean
                cmd = None
                for anchor in (first, last):
                    self.ask(f"CHATHISTORY BETWEEN {chan} msgid={anchor} {w[4]} {lim}",
                             f"next page of #{r['i']} ({sub}, end={end})", followup_of=r["i"], chan=chan)
            else:
                cmd = None
            if cmd:
                self.ask(cmd, f"next page of #{r['i']} ({sub}, end={end})", followup_of=r["i"], chan=chan)

    def walk(self, chan, lim, form):
        """CH:192-208's loop (no floor): LATEST *, then BEFORE <first> until
        an empty page or the end tag; msgid or timestamp anchors."""
        r = self.ask(f"CHATHISTORY LATEST {chan} * {lim}", f"walk-{form} {lim} page 1", chan=chan)
        for k in range(2, 20):
            p = self.page(r)
            if not p or not p[0] or p[1]:
                return
            first = p[0][0]["tags"]
            sel = f"msgid={first['msgid']}" if form == "msgid" else f"timestamp={first['time']}"
            r = self.ask(f"CHATHISTORY BEFORE {chan} {sel} {lim}", f"walk-{form} {lim} page {k}", chan=chan)

    def run(self):
        H, T = self.ch["hist"], self.ch["tlc"]
        self.join("q", [H, T, self.ch["empty"], self.ch["other"]])
        self.join("a", [H, T, self.ch["other"], self.ch["nojoin"]])
        self.join("b", [H])
        self.join("c", [H])
        self.events()
        self.meta()
        self.seed()
        rs = self.matrix(H, deep=not self.a.small, lean=self.a.small)
        rs += self.matrix(T, deep=False, lean=self.a.small)
        # anchors on the oldest and newest line as the server replays them
        # (it may store lines the harness did not send, e.g. channel events)
        for ch in (H, T):
            full = self.page(self.ask(f"CHATHISTORY LATEST {ch} * 100", "full store", chan=ch))
            if full and full[0]:
                for which, m in (("oldest", full[0][0]), ("newest", full[0][-1])):
                    mid = m["tags"].get("msgid")
                    if not mid:
                        continue
                    for sub in ("LATEST", "BEFORE", "AFTER", "AROUND"):
                        for lim in (1, 3):
                            rs.append(self.ask(f"CHATHISTORY {sub} {ch} msgid={mid} {lim}",
                                               f"{sub} msgid=replayed-{which}", chan=ch))
        self.followups(rs)
        for form in ("msgid", "ts"):
            for lim in (3, 4):
                self.walk(H, lim, form)
        # unknown and foreign msgids, empty / unjoined / missing targets
        other = self.store[self.ch["other"]][0]["msgid"]
        dm1 = self.store["dm"][0]["msgid"]
        for ch in (H, T):
            for sel, note in (("msgid=zzzz-not-a-msgid-0000", "unknown msgid"),
                              (f"msgid={other}", "msgid from another channel"),
                              (f"msgid={dm1}", "msgid of a DM line")):
                for sub in ("LATEST", "BEFORE", "AFTER", "AROUND"):
                    self.ask(f"CHATHISTORY {sub} {ch} {sel} 5", note, chan=ch)
                self.ask(f"CHATHISTORY BETWEEN {ch} {sel} msgid={self.store[ch][-1]['msgid']} 5", note, chan=ch)
                self.ask(f"CHATHISTORY BETWEEN {ch} msgid={self.store[ch][0]['msgid']} {sel} 5", note, chan=ch)
        now = ms2ts(int(time.time() * 1000) + 60000)
        for key, note in (("empty", "empty target (joined, no lines)"), ("nojoin", "target not joined"),
                          ("nosuch", "target does not exist")):
            ch = self.ch[key]
            self.ask(f"CHATHISTORY LATEST {ch} * 10", note, chan=ch)
            self.ask(f"CHATHISTORY BEFORE {ch} timestamp={now} 10", note, chan=ch)
        # a direct-message target (CH:65: self messages included)
        an = self.c["a"].nick
        self.ask(f"CHATHISTORY LATEST {an} * 10", "DM target", chan="dm")
        # TARGETS (draft/chathistory-targets), both directions
        lo = ms2ts(ts2ms(self.store[H][0]["time"]) - 60000)
        for lim in (1, 2, 10):
            self.ask(f"CHATHISTORY TARGETS timestamp={lo} timestamp={now} {lim}", "TARGETS fwd", chan="*")
            self.ask(f"CHATHISTORY TARGETS timestamp={now} timestamp={lo} {lim}", "TARGETS back", chan="*")
        # snapshot: more lines arrive, then the same queries again
        self.pending = []
        old_newest = self.store[H][-1]["msgid"]
        self.say(H, [("a", H, f"{self.rid} h15")])
        self.say(H, [("b", H, f"{self.rid} h16")])
        self.settle()
        for cmd, note in ((f"CHATHISTORY LATEST {H} * 3", "after more lines"),
                          (f"CHATHISTORY AFTER {H} msgid={old_newest} 10", "after more lines"),
                          (f"CHATHISTORY LATEST {H} msgid={old_newest} 10", "after more lines"),
                          (f"CHATHISTORY BEFORE {H} msgid={self.store[H][-1]['msgid']} 3", "after more lines")):
            self.ask(cmd, note, chan=H)
        # a line racing a query: sent by a in the same instant as the query
        self.pending = []
        self.c["a"].send(f"PRIVMSG {H} :{self.rid} h17")
        r = self.ask(f"CHATHISTORY LATEST {H} * 5", "racing a new line", chan=H, racing=H)
        self.say_wait_only("a", H, f"{self.rid} h17")
        self.settle()
        # #tlc: one more line (the model's StoreLive), then queries
        self.pending = []
        self.say(T, [("a", T, f"{self.rid} t5")])
        self.settle()
        S = self.store[T]
        for cmd in (f"CHATHISTORY LATEST {T} * 2", f"CHATHISTORY LATEST {T} * 10",
                    f"CHATHISTORY BEFORE {T} msgid={S[-1]['msgid']} 2",
                    f"CHATHISTORY BEFORE {T} timestamp={S[-1]['time']} 3"):
            self.ask(cmd, "tlc after live", chan=T)
        # CH:41: a late joiner that negotiated chathistory gets no automatic playback
        l = self.mk("l")
        l.send(f"JOIN {H}")
        lines = l.sync("lj")
        self.rec({"kind": "join", "role": "l", "chan": H, "caps": sorted(l.caps), "lines": lines})
        l.close()
        for c in self.c.values():
            c.close()

    def say_wait_only(self, role, chan, text):
        c = self.c[role]
        lines, m = c.until(lambda m: m["cmd"] == "PRIVMSG" and m["params"][-1] == text)
        self.n += 1
        self.pending.append({"kind": "msg", "n": self.n, "chan": chan, "target": chan, "sender": c.nick,
                             "role": role, "text": text, "msgid": m["tags"].get("msgid"),
                             "time": m["tags"].get("time"), "echo": lines[-1], "together": False,
                             "raced": True})


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("host")
    ap.add_argument("port", type=int)
    ap.add_argument("out")
    ap.add_argument("--tls", action="store_true")
    ap.add_argument("--insecure", action="store_true", help="TLS without certificate checks")
    ap.add_argument("--sni")
    ap.add_argument("--pass", dest="password")
    ap.add_argument("--sasl", action="append", default=[], metavar="ROLE=ACCOUNT:PASSWORD",
                    help="SASL PLAIN for one role (q, a, b, c, l); repeatable")
    ap.add_argument("--runid", help="nick/channel prefix (default: random)")
    ap.add_argument("--gap", type=float, default=0.005, help="pause after each lone line (s)")
    ap.add_argument("--pace", type=float, default=0.0, help="pause after each query (s)")
    ap.add_argument("--small", action="store_true",
                    help="a smaller query matrix on the main channel (for servers with fake lag)")
    ap.add_argument("--server-label", default="", help="free text recorded in meta, e.g. ergo-fd87086")
    a = ap.parse_args()
    Run(a).run()


if __name__ == "__main__":
    main()
