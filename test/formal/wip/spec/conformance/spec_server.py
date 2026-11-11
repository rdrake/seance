#!/usr/bin/env python3
"""A scripted IRC server that plays behaviours the spec model's server allows,
to record a CLIENT's handshake as model traces for check.py.  The mirror of
drive.py: there the client is scripted and the server is real; here the
server is scripted and the client is real: HexDroid's IrcClient, run on the
JVM by a JUnit test (../HEXDROID.md), or Textual-NG's TextualCore Client, run
by a Swift Testing test (../TEXTUAL.md).

Each scenario is a small model server (srv state as in SpecHandshake.tla)
with its choice points fixed: how LS is split, how each REQ is answered
(ACK, NAK, split ACK), what the SASL backend does, and NEW/DEL injected at
named moments.  Pacing: before sending each line the server waits until the
client has been quiet for QUIET seconds, so the r of each client line (the
number of model-vocabulary server lines sent before it) is the number the
client had read.  The server never sends two lines in one burst.

Usage: spec_server.py OUT.jsonl [--client hexdroid|textual] [--hexdroid DIR]
                      [--textual DIR] [--grep SUBSTR] [--only NAME]
                      [--stall SECONDS] [--list]
  Starts the listener, writes a plan file, and serves one connection per
  scenario.  --client hexdroid (the default) runs
  `./gradlew :app:testDebugUnitTest --tests '*SpecHandshakeTraceTest' --rerun`
  in DIR with HEXDROID_SPEC_PLAN set.  --client textual runs
  `swift test --filter SpecHandshakeTraceTests` in DIR/TextualCore with
  TEXTUAL_SPEC_PLAN set; that client is plain TCP only, so no run is TLS.
"""
import base64, json, os, socket, ssl, subprocess, sys, tempfile, time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from drive import model_of, CAPMAP  # noqa: E402

QUIET = 0.3        # client silence before the server sends its next line
AFTER_REG = 1.0    # silence after 001 before the run is closed
STALL = 8.0        # silence with nothing owed and 001 held: the client is stuck
ACCOUNT, GOOD = "tester", "goodpass"
SRV = "spec.example"
Active = ("open", "await", "decide")


def parse(line):
    if line.startswith("@"):
        line = line.split(" ", 1)[1]
    if line.startswith(":"):
        line = line.split(" ", 1)[1] if " " in line else ""
    trail = None
    if " :" in line:
        line, trail = line.split(" :", 1)
    p = line.split()
    if trail is not None:
        p.append(trail)
    return (p[0].upper() if p else ""), p[1:]


def capname(t):
    return t.split("=", 1)[0].lower()


def mcaps(names):
    return sorted({CAPMAP[capname(t)] for t in names if capname(t) in CAPMAP})


MECHS = {"PLAIN", "EXTERNAL", "SCRAM-SHA-256", "SCRAM-SHA-1", "OAUTHBEARER"}


def client_model(line, state):
    """A client line as a model message, or None (outside the model)."""
    cmd, p = parse(line)
    if cmd == "CAP" and p:
        sub = p[0].upper()
        if sub == "LS" and not state["ls"]:
            state["ls"] = True
            return None                      # in the model's Init
        if sub == "REQ":
            return {"t": "REQ", "caps": mcaps(p[-1].split()), "more": False}
        if sub == "END":
            return {"t": "END", "caps": [], "more": False}
        return None
    if cmd == "AUTHENTICATE" and p:
        a = p[0]
        if a == "*":
            return {"t": "AUTHSTAR", "caps": [], "more": False}
        if a.upper() in MECHS:
            return {"t": "AUTHMECH", "caps": [], "more": False}
        return {"t": "AUTHDATA", "caps": [], "more": False}
    if cmd == "QUIT":
        return {"t": "QUIT", "caps": [], "more": False}
    return None


class Run:
    def __init__(self, sock, sc, nick):
        self.s, self.sc, self.want_nick = sock, sc, nick
        self.events, self.q = [], []
        self.buf = b""
        self.cstate = {"ls": False}
        self.closed = self.stalled = False
        self.last_rx = self.last_tx = time.time()
        ls = sc["ls"]
        self.offered = {capname(t) for line in ls for t in line if capname(t) != "cap-notify"}
        self.offered |= set(sc.get("hidden", []))
        self.initial = set(self.offered)
        self.tok = {capname(t): t for line in ls for t in line}
        self.enabled, self.inbox_n = set(), 0
        self.hold = self.reg = self.nick = self.user = False
        self.sasl, self.authed = "idle", False
        self.acking = []          # open split ACKs: dicts R, rest, commit
        self.part2 = None         # a split's last part held back (rest="afterReg")
        self.nickname = "*"
        self.nreq = 0
        self.notes = []

    # ---- wire ----
    def tx(self, line):
        self.s.sendall((line + "\r\n").encode())
        self.events.append(("s", line))
        self.last_tx = time.time()

    def rx(self):
        try:
            d = self.s.recv(65536)
        except (socket.timeout, ssl.SSLWantReadError):
            return
        except (OSError, ssl.SSLError):
            self.closed = True
            return
        if not d:
            self.closed = True
            return
        self.last_rx = time.time()
        self.buf += d
        while b"\n" in self.buf:
            l, self.buf = self.buf.split(b"\n", 1)
            l = l.rstrip(b"\r").decode(errors="replace")
            self.events.append(("c", l, client_model(l, self.cstate)))
            self.on_line(l)

    # ---- queue: callables returning the lines to send (lazy: decided when sent) ----
    def push(self, f, front=False):
        if front:
            self.q.insert(0, f)
        else:
            self.q.append(f)

    def fixed(self, line):
        return lambda: [line]

    def trigger(self, ev):
        acts = self.sc.get("on", {}).get(ev, [])
        for a in reversed(acts):
            kind, cap = a.split(":", 1)
            self.push(self.env_change(kind, cap), front=True)

    def env_change(self, kind, cap):
        def f():
            if kind == "del" and cap in self.offered:
                self.offered.discard(cap)
                self.enabled.discard(cap)
                if cap == "sasl" and self.sasl in Active:
                    self.sasl = "idle"           # D5: cancelled silently
                for a in self.acking:
                    a["commit"].discard(cap)     # D18
                if self.part2:
                    self.part2["commit"].discard(cap)
                return [f":{SRV} CAP {self.nickname} DEL :{cap}"]
            if kind == "new" and cap not in self.offered:
                self.offered.add(cap)
                return [f":{SRV} CAP {self.nickname} NEW :{self.tok.get(cap, cap)}"]
            return []
        return f

    # ---- client lines ----
    def on_line(self, l):
        cmd, p = parse(l)
        if cmd == "CAP" and p and p[0].upper() == "LS":
            self.hold = self.hold or not self.reg
            ls = self.sc["ls"]
            for i, toks in enumerate(ls):
                last = i == len(ls) - 1
                def f(toks=toks, last=last, i=i):
                    if last:
                        keep = [t for t in toks if capname(t) == "cap-notify" or capname(t) in self.offered]
                        out = [f":{SRV} CAP {self.nickname} LS :{' '.join(keep)}"]
                    else:
                        out = [f":{SRV} CAP {self.nickname} LS * :{' '.join(toks)}"]
                    if i == 0:
                        self.trigger("ls1")
                    return out
                self.push(f)
        elif cmd == "CAP" and p and p[0].upper() == "REQ":
            R = {capname(t) for t in p[-1].split()}
            self.nreq += 1
            if not self.reg:
                self.hold = True                       # CN-13, D13
            self.push(self.answer(R, self.nreq - 1))
            self.trigger("req%d" % self.nreq)
        elif cmd == "CAP" and p and p[0].upper() == "END":
            if not self.reg:
                self.hold = False
            self.push(self.register)
            self.trigger("end")
        elif cmd == "NICK" and p:
            if not self.nick:
                self.nickname = p[0]
                if p[0] != self.want_nick:
                    self.notes.append(f"unexpected nick {p[0]} (wanted {self.want_nick})")
            self.nick = True
        elif cmd == "USER":
            self.user = True
        elif cmd == "AUTHENTICATE" and p:
            self.on_auth(p[0])
        elif cmd == "PING":
            self.push(self.fixed(f":{SRV} PONG {SRV} :{p[-1] if p else ''}"))
        elif cmd == "QUIT":
            self.closed = True

    def answer(self, R, idx):
        pol = (self.sc.get("acks") or [])
        pol = pol[idx] if idx < len(pol) else "ack"
        def f():
            words = " ".join(sorted(R))
            ackable = all(c in self.offered or c == "cap-notify" for c in R)
            must = all(c in self.enabled or c == "cap-notify" for c in R)
            if not ackable or (pol == "nak" and not must):
                return [f":{SRV} CAP {self.nickname} NAK :{words}"]       # CN-11, CN-15, D8
            if isinstance(pol, dict) and "split" in pol:
                A = {c for c in pol["split"] if c in R}
                if A and A != R:
                    rest = R - A
                    part = {"R": R, "rest": rest, "commit": set(R) - {"cap-notify"}}
                    def last():
                        self.enabled |= part["commit"]                    # CN-14, D19
                        if part in self.acking:
                            self.acking.remove(part)
                        if self.part2 is part:
                            self.part2 = None
                        return [f":{SRV} CAP {self.nickname} ACK :{' '.join(sorted(part['rest']))}"]
                    part["send"] = last
                    self.acking.append(part)
                    if pol.get("rest") == "afterReg" and not self.reg:
                        self.part2 = part
                    else:
                        self.push(last, front=True)
                    return [f":{SRV} CAP {self.nickname} ACK :{' '.join(sorted(A))}"]
            self.enabled |= (R - {"cap-notify"})
            return [f":{SRV} CAP {self.nickname} ACK :{words}"]
        return f

    def on_auth(self, a):
        sp = self.sc.get("sasl", "ok")
        late907 = self.authed and self.sasl not in Active
        if a == "*":
            if late907:
                self.push(self.fixed(f":{SRV} 907 {self.nickname} :You have already authenticated using SASL"))
            elif self.sasl in Active:
                self.sasl = "idle"
                self.push(self.fixed(f":{SRV} 906 {self.nickname} :SASL authentication aborted"))
            return
        if a.upper() in MECHS:
            if self.authed:
                self.push(self.fixed(f":{SRV} 907 {self.nickname} :You have already authenticated using SASL"))
            elif "sasl" not in self.enabled:                                    # D7
                self.notes.append("AUTHENTICATE opener with sasl not enabled on the server")
                if self.sc.get("stray") == "904":
                    self.push(self.fixed(f":{SRV} 904 {self.nickname} :SASL authentication failed"))
            elif sp == "svcdown":                                               # S1-5
                self.push(self.fixed(f":{SRV} 904 {self.nickname} :SASL authentication failed"))
            else:
                self.sasl = "open"                                              # D23
                self.trigger("mech")
                if sp == "timeout":
                    self.push(self.timeout)
                elif sp == "908":
                    self.push(self.fixed(f":{SRV} 908 {self.nickname} EXTERNAL :are available SASL mechanisms"))
                    self.push(self.timeout)
                elif sp == "908-silent":
                    self.push(self.fixed(f":{SRV} 908 {self.nickname} EXTERNAL :are available SASL mechanisms"))
                elif sp == "challenge":
                    self.push(self.fixed("AUTHENTICATE Zm9vYmFy"))   # not a model line
                elif sp == "del-open":
                    self.push(self.env_change("del", "sasl"))
                else:
                    self.push(self.challenge)
            return
        # a response
        if late907:
            self.push(self.fixed(f":{SRV} 907 {self.nickname} :You have already authenticated using SASL"))
        elif self.sasl == "await":
            self.sasl = "decide"
            try:
                parts = base64.b64decode(a).split(b"\0")
                ok = parts[-1].decode() == GOOD
            except Exception:
                ok = False
            if sp == "del-await":
                self.push(self.env_change("del", "sasl"))
            elif sp == "timeout-decide" or not ok:
                self.push(self.timeout)
            else:
                self.push(self.decide_ok)
        # idle/open/decide: ignored (D24 lets the server ignore a stray response)

    def challenge(self):
        if self.sasl != "open":
            return []
        self.sasl = "await"
        return ["AUTHENTICATE +"]

    def timeout(self):
        if self.sasl not in Active:
            return []
        self.sasl = "idle"
        return [f":{SRV} 904 {self.nickname} :SASL authentication failed"]

    def decide_ok(self):
        if self.sasl != "decide":
            return []
        self.sasl, self.authed = "idle", True
        a = f":{SRV} 900 {self.nickname} {self.nickname}!u@h {ACCOUNT} :You are now logged in as {ACCOUNT}"
        b = f":{SRV} 903 {self.nickname} :SASL authentication successful"
        first, second = (b, a) if self.sc.get("order") == "903first" else (a, b)
        self.push(self.fixed(second), front=True)
        return [first]

    def register(self):
        if self.reg or self.hold or not (self.nick and self.user):
            return []
        if self.sasl in Active:
            if self.sc.get("regAbort") or not self.q:                        # S1-14
                self.sasl = "idle"
                self.reg = True
                self.push(self.welcome, front=True)
                return [f":{SRV} 906 {self.nickname} :SASL authentication aborted"]
            self.push(self.register)          # defer: never 001 during an exchange
            return []
        self.reg = True
        return self.welcome()

    def welcome(self):
        self.reg = True
        n = self.nickname
        for l in reversed([f":{SRV} 005 {n} CHANTYPES=# PREFIX=(ov)@+ :are supported",
                           f":{SRV} 376 {n} :End of MOTD"]):
            self.push(self.fixed(l), front=True)
        if self.part2:
            p, self.part2 = self.part2, None
            self.q.insert(2, p["send"])
        return [f":{SRV} 001 {n} :Welcome to the spec server {n}"]

    def owes(self):
        """A model server step the run still owes (Settled would fail)."""
        return bool(self.acking) or self.sasl in Active or (
            not self.reg and not self.hold and self.nick and self.user)

    def loop(self):
        self.s.settimeout(0.05)
        end = time.time() + 120
        while not self.closed and time.time() < end:
            self.rx()
            if self.closed:
                break
            now = time.time()
            idle = now - max(self.last_rx, self.last_tx)
            if idle < QUIET:
                continue
            if self.q:
                f = self.q.pop(0)
                for i, l in enumerate(f()):
                    if i:
                        raise RuntimeError("one line per queue item")
                    self.tx(l)
                continue
            if self.part2:
                p, self.part2 = self.part2, None
                self.push(p["send"])
                continue
            if self.reg and idle >= AFTER_REG:
                break
            if not self.reg and not self.hold and self.nick and self.user:
                self.push(self.register)
                continue
            if not self.reg and idle >= STALL:
                self.stalled = True
                break
        if self.owes():
            self.notes.append("closed while the server still owed a line")


def to_trace(run, sc, nread_all=True, client="hexdroid"):
    obs, cli, raw = [], [], []
    for e in run.events:
        if e[0] == "s":
            raw.append("S " + e[1])
            m = model_of(e[1])
            if m is None:
                continue
            if m["t"] in ("ACK", "NAK", "NEW", "DEL") and not m["caps"]:
                continue          # answers or changes of caps outside the model only
            obs.append(m)
        else:
            raw.append("C " + e[1])
            m = e[2]
            if m is None or (m["t"] == "REQ" and not m["caps"]):
                continue
            cli.append({"m": m, "r": len(obs)})
    nls = sum(1 for m in obs if m["t"] == "LS")
    assert nls <= 2, sc["name"]
    c = sc["client"]
    env = {"creds": c.get("pw", "good") == "good", "wantSasl": c.get("sasl", "plain") != "off",
           "required": False, "svcOk": sc.get("sasl") != "svcdown"}
    return {"name": sc["name"], "env": env,
            "offered": sorted(set(mcaps(run.initial)) - {"cap-notify"}),
            "obs": obs, "cli": cli, "raw": raw, "dropAt": None,
            client: {"stalled": run.stalled, "notes": run.notes,
                     "tls": bool(c.get("tls", True)) and client == "hexdroid"}}


# ---------------------------------------------------------------- scenarios
OTHER1, OTHER2, FILL = "message-tags", "echo-message", "example.org/filler"
FULL = ("message-tags server-time echo-message labeled-response batch utf8only draft/chathistory "
        "chathistory draft/event-playback account-notify away-notify chghost extended-join "
        "multi-prefix invite-notify sasl draft/read-marker monitor account-tag "
        "draft/standard-replies standard-replies draft/pre-away pre-away message-ids "
        "draft/channel-rename draft/extended-monitor extended-monitor draft/message-reactions "
        "draft/multiline multiline draft/message-redaction message-redaction").split()


def scenarios():
    C = lambda tls=True, sasl="plain", pw="good": {"tls": tls, "sasl": sasl, "pw": pw}
    one = lambda *caps: [list(caps) + [OTHER1, OTHER2]]
    std = one("sasl=PLAIN", "server-time", "cap-notify")
    out = []
    add = lambda name, **kw: out.append(dict(name=name, client=kw.pop("client", C()), **kw))

    # LS in two lines: each modelled cap on the first or the last line (D22).
    for bits in range(8):
        l1, l2 = [OTHER1], [OTHER2]
        tag = []
        for k, cap in enumerate(["sasl", "server-time", "cap-notify"]):
            first = bool(bits >> k & 1)
            (l1 if first else l2).append(cap)
            tag.append(f"{CAPMAP[cap]}{1 if first else 2}")
        add("ls2/" + "-".join(tag), ls=[l1, l2])
    add("ls2/all-last-filler-first", ls=[[FILL], ["sasl", "server-time", "cap-notify", OTHER1]])
    add("ls2/all-first-filler-last", ls=[["sasl", "server-time", "cap-notify", OTHER1], [FILL]])
    # LS in one line: sasl, cap-notify, server-time each listed or not.
    for s in (0, 1):
        for cn in (0, 1):
            for a in (0, 1):
                caps = (["sasl=PLAIN"] if s else []) + (["cap-notify"] if cn else []) + (["server-time"] if a else [])
                tag = f"sasl{s}-cn{cn}-a{a}"
                add("ls1/" + tag, ls=one(*caps))
                if s:
                    add("ls1/" + tag + "/client-nosasl", ls=one(*caps), client=C(sasl="off"))
    add("ls2/sasl1-a2/client-nosasl", ls=[["sasl", OTHER1], ["server-time", "cap-notify", OTHER2]],
        client=C(sasl="off"))
    add("ls1/no-model-caps", ls=[[OTHER1, OTHER2]])
    add("ls1/empty", ls=[[]])

    # SASL outcomes (TLS so that PLAIN sends the password).
    add("sasl/ok", ls=std)
    add("sasl/ok-903first", ls=std, order="903first")
    add("sasl/bad-password", ls=std, client=C(pw="bad"))
    add("sasl/timeout-before-challenge", ls=std, sasl="timeout")
    add("sasl/timeout-after-response", ls=std, sasl="timeout-decide")
    add("sasl/svc-down", ls=std, sasl="svcdown")
    add("sasl/908-then-904", ls=std, sasl="908")
    add("sasl/908-then-906-on-reg", ls=std, sasl="908-silent", regAbort=True)
    add("sasl/nonplus-challenge", ls=std, sasl="challenge")
    add("sasl/plaintext-abort", ls=std, client=C(tls=False))
    add("sasl/plaintext-abort-nopass", ls=std, client=C(tls=False, pw="none"))
    add("sasl/no-password", ls=std, client=C(pw="none"))
    add("sasl/value-external", ls=one("sasl=EXTERNAL", "server-time", "cap-notify"))
    add("sasl/value-scram-904", ls=one("sasl=SCRAM-SHA-256", "server-time", "cap-notify"))
    add("sasl/value-none", ls=one("sasl", "server-time"))
    add("sasl/full-caps-two-reqs", ls=[FULL + ["cap-notify"]])

    # ACK / NAK.
    add("req/nak", ls=std, acks=["nak"])
    add("req/nak/client-nosasl", ls=std, acks=["nak"], client=C(sasl="off"))
    add("req/split-sasl-first/stray-drop", ls=std, acks=[{"split": ["sasl"]}])
    add("req/split-sasl-first/stray-904", ls=std, acks=[{"split": ["sasl"]}], stray="904")
    add("req/split-sasl-last", ls=std, acks=[{"split": ["server-time", OTHER1, OTHER2]}])
    add("req/split-sasl-last/001-between", ls=std,
        acks=[{"split": ["server-time", OTHER1, OTHER2], "rest": "afterReg"}])
    add("req/split-other-first", ls=std, acks=[{"split": [OTHER1, OTHER2]}])
    add("req/split/client-nosasl", ls=std, acks=[{"split": ["server-time"]}], client=C(sasl="off"))
    add("req/full-caps-nak-second", ls=[FULL + ["cap-notify"]], acks=["ack", "nak"])

    # CAP DEL / NEW.
    lsdel = [["sasl", "cap-notify", OTHER1], ["server-time", OTHER2]]
    add("del/sasl-between-ls-lines", ls=lsdel, on={"ls1": ["del:sasl"]})
    add("del/sasl-crossing-req", ls=std, on={"req1": ["del:sasl"]})
    add("del/sasl-after-opener", ls=std, sasl="del-open")
    add("del/sasl-after-response", ls=std, sasl="del-await")
    add("del/a-mid-exchange", ls=std, on={"mech": ["del:server-time"]})
    add("new/sasl-before-ack", ls=one("server-time", "cap-notify"), hidden=[],
        on={"req1": ["new:sasl"]})
    add("new/a-mid-exchange", ls=one("sasl=PLAIN", "cap-notify"), on={"mech": ["new:server-time"]})
    add("new/a-after-end/client-nosasl", ls=one("cap-notify"), on={"end": ["new:server-time"]},
        client=C(sasl="off"))
    add("new/sasl-after-end", ls=one("server-time", "cap-notify"), on={"end": ["new:sasl"]})
    add("new/a-after-end/no-cap-notify", ls=one("sasl=PLAIN"), on={"end": ["new:server-time"]})
    return out


def make_cert(d):
    crt, key = os.path.join(d, "srv.crt"), os.path.join(d, "srv.key")
    subprocess.run(["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "2",
                    "-subj", "/CN=127.0.0.1", "-keyout", key, "-out", crt],
                   check=True, capture_output=True)
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    ctx.load_cert_chain(crt, key)
    return ctx


def main():
    global STALL
    a = sys.argv[1:]
    opt = lambda k, d=None: a[a.index(k) + 1] if k in a else d
    scs = scenarios()
    if opt("--grep"):
        scs = [s for s in scs if opt("--grep") in s["name"]]
    if opt("--only"):
        scs = [s for s in scs if s["name"] == opt("--only")]
    if "--list" in a:
        for s in scs:
            print(s["name"])
        return
    out = a[0]
    STALL = float(opt("--stall", STALL))
    client = opt("--client", "hexdroid")
    if client not in ("hexdroid", "textual"):
        sys.exit("--client must be hexdroid or textual")
    hexdroid = os.path.expanduser(opt("--hexdroid", "~/workspace/afternet/HexDroid-latest"))
    textual = os.path.expanduser(opt("--textual", "~/workspace/afternet/Textual-NG"))
    tls_ok = client == "hexdroid"           # SocketTransport (Textual) is plain TCP only
    pfx = "hx" if client == "hexdroid" else "tx"
    work = tempfile.mkdtemp(prefix="spec-server-")
    tlsctx = make_cert(work)
    ls = socket.socket()
    ls.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    ls.bind(("127.0.0.1", 0))
    ls.listen(4)
    port = ls.getsockname()[1]
    plan = os.path.join(work, "plan.tsv")
    with open(plan, "w") as f:
        f.write(f"port {port}\n")
        for i, s in enumerate(scs):
            c = s["client"]
            f.write("\t".join([s["name"], "1" if c.get("tls", True) else "0", c.get("sasl", "plain"),
                               c.get("pw", "good"), pfx + "%03d" % i]) + "\n")
    if client == "hexdroid":
        log = open(os.path.join(work, "gradle.log"), "w")
        env = dict(os.environ, HEXDROID_SPEC_PLAN=plan)
        print(f"port {port}, plan {plan}, gradle log {log.name}", flush=True)
        g = subprocess.Popen(["./gradlew", ":app:testDebugUnitTest", "--tests",
                              "com.boxlabs.hexdroid.SpecHandshakeTraceTest", "--rerun", "--console=plain"],
                             cwd=hexdroid, env=env, stdout=log, stderr=subprocess.STDOUT)
    else:
        log = open(os.path.join(work, "swift-test.log"), "w")
        env = dict(os.environ, TEXTUAL_SPEC_PLAN=plan)
        print(f"port {port}, plan {plan}, swift test log {log.name}", flush=True)
        g = subprocess.Popen(["swift", "test", "--filter", "SpecHandshakeTraceTests"],
                             cwd=os.path.join(textual, "TextualCore"), env=env,
                             stdout=log, stderr=subprocess.STDOUT)
    n = 0
    with open(out, "w") as f:
        for i, s in enumerate(scs):
            ls.settimeout(900 if i == 0 else 120)
            try:
                conn, _ = ls.accept()
            except socket.timeout:
                print("no connection for", s["name"], "-", "gradle" if client == "hexdroid" else "swift test", "exit", g.poll())
                break
            if tls_ok and s["client"].get("tls", True):
                conn.settimeout(10)
                conn = tlsctx.wrap_socket(conn, server_side=True)
            r = Run(conn, s, pfx + "%03d" % i)
            r.loop()
            try:
                conn.close()
            except OSError:
                pass
            tr = to_trace(r, s, client=client)
            f.write(json.dumps(tr) + "\n")
            f.flush()
            n += 1
            print(f"{i:3d} {s['name']:45s} obs={len(tr['obs']):2d} cli={len(tr['cli']):2d}"
                  f"{' STALLED' if r.stalled else ''} {'; '.join(r.notes)}", flush=True)
    rc = g.wait()
    print(n, "scenarios recorded;", "gradle" if client == "hexdroid" else "swift test", "exit", rc)


if __name__ == "__main__":
    main()
