#!/usr/bin/env python3
"""Record how a server runs SASL, for the open questions Q1-Q7 in ../DECISIONS.md.

Server-agnostic: everything about the server comes from flags.

  record_sasl.py HOST PORT OUT.jsonl --server-label NAME
                 --acct1 USER:PASS --acct2 USER:PASS
                 [--only s1,s2,...] [--hook-cmd-down CMD --hook-cmd-up CMD]

Each scenario opens its own connection(s) and records every line sent and
received, raw and in order, with ms since the scenario started. Client
AUTHENTICATE payloads are redacted ("<payload N bytes>"); mechanism names,
"+" and "*" are kept. The account passwords never reach the output.

--hook-cmd-down / --hook-cmd-up are shell commands that take the server's
SASL backend away and bring it back (for nefarious2: stop/start the services
container). With them, the cap-notify scenarios (mechanism list changes,
DEL mid-exchange) run; without them they are skipped and say so.

One JSON object per line: a meta record, then one trace record per scenario
with `name`, `question` (the Q it bears on), `lines` [{dir, ms, raw}] and
`note` (what the scenario did, not what it means).
"""
import argparse, base64, json, random, select, socket, string, subprocess, time

ap = argparse.ArgumentParser()
ap.add_argument("host"); ap.add_argument("port", type=int); ap.add_argument("out")
ap.add_argument("--server-label", required=True)
ap.add_argument("--acct1", required=True)
ap.add_argument("--acct2", required=True)
ap.add_argument("--only")
ap.add_argument("--hook-cmd-down")
ap.add_argument("--hook-cmd-up")
ap.add_argument("--quiet", type=float, default=4.0, help="seconds of silence that end a read")
args = ap.parse_args()

A1 = tuple(args.acct1.split(":", 1))
A2 = tuple(args.acct2.split(":", 1))
RUN = "sa" + "".join(random.choice(string.ascii_lowercase) for _ in range(4))
SECRETS = {A1[1], A2[1]}


def plain(acct, pw):
    return base64.b64encode(f"{acct}\0{acct}\0{pw}".encode()).decode()


def words(line):
    if line.startswith("@"):
        line = line.partition(" ")[2]
    return line.split(" ")


class Conn:
    n = 0

    def __init__(self, log, t0):
        Conn.n += 1
        self.tag = f"c{Conn.n}"
        self.log, self.t0 = log, t0
        self.s = socket.create_connection((args.host, args.port), timeout=30)
        self.buf = b""
        self.nick = f"{RUN}{Conn.n}"

    def _rec(self, d, raw):
        for s in SECRETS:
            assert s not in raw
        self.log.append({"conn": self.tag, "dir": d, "ms": round((time.time() - self.t0) * 1000), "raw": raw})

    def send(self, line, shown=None):
        self.s.sendall((line + "\r\n").encode())
        self._rec("C", shown if shown is not None else line)

    def payload(self, b64):
        """Send a (possibly chunked) AUTHENTICATE payload, redacted in the log."""
        chunks = [b64[i:i + 400] for i in range(0, len(b64), 400)] or [""]
        if len(chunks[-1]) == 400:
            chunks.append("")
        for c in chunks:
            if c == "":
                self.send("AUTHENTICATE +")
            else:
                self.send("AUTHENTICATE " + c, f"AUTHENTICATE <payload {len(c)} bytes>")

    def read(self, wait):
        while b"\n" not in self.buf:
            if not select.select([self.s], [], [], wait)[0]:
                raise TimeoutError
            chunk = self.s.recv(65536)
            if not chunk:
                raise EOFError
            self.buf += chunk
        l, _, self.buf = self.buf.partition(b"\n")
        l = l.decode(errors="replace").rstrip("\r")
        self._rec("S", l)
        if l.startswith("PING "):
            self.send("PONG " + l[5:])
        return l

    def until(self, pred, wait=None):
        """Read until pred(words) or `wait` (default --quiet) s of silence; return the matching line or None."""
        wait = args.quiet if wait is None else wait
        try:
            while True:
                l = self.read(wait)
                if pred(words(l)):
                    return l
        except (TimeoutError, EOFError):
            return None

    def quiet(self, wait=None):
        self.until(lambda w: False, wait)

    def numeric(self, *nums, wait=None):
        return self.until(lambda w: len(w) > 1 and w[1] in nums, wait)

    def register(self, caps=("sasl",), end=False):
        """CAP LS 302, NICK/USER, REQ caps; returns the sasl value from LS (None if absent)."""
        self.send("CAP LS 302")
        self.send(f"NICK {self.nick}")
        self.send(f"USER {self.nick} 0 * :{self.nick}")
        offered = ""
        while True:
            l = self.until(lambda w: len(w) > 3 and w[1] == "CAP" and w[3] == "LS", 15)
            if l is None:
                raise RuntimeError("no CAP LS")
            w = words(l)
            offered += " " + (l.split(" :", 1)[1] if " :" in l else "")
            if w[4] != "*":
                break
        have = {c.split("=")[0]: (c.split("=", 1)[1] if "=" in c else None) for c in offered.split()}
        want = [c for c in caps if c in have]
        if want:
            self.send("CAP REQ :" + " ".join(want))
            self.until(lambda w: len(w) > 3 and w[1] == "CAP" and w[3] in ("ACK", "NAK"), 15)
        if end:
            self.welcome()
        return have.get("sasl", "<absent>") if "sasl" in have else None

    def welcome(self):
        self.send("CAP END")
        l = self.numeric("001", wait=20)
        if l:
            self.nick = words(l)[2]
        self.numeric("376", "422", wait=20)
        self.quiet(1.5)

    def login(self, acct, mech="PLAIN"):
        self.send(f"AUTHENTICATE {mech}")
        self.until(lambda w: w[0] == "AUTHENTICATE" or len(w) > 1 and w[1] in ("904", "907", "908"), 15)
        self.payload(plain(*acct))
        return self.numeric("903", "904", "905", "906", "907", wait=15)

    def whoami(self):
        """WHOIS self; the 330 line (if any) carries the account."""
        self.send(f"WHOIS {self.nick}")
        self.numeric("318", wait=15)

    def close(self):
        try:
            self.send("QUIT :done")
            self.quiet(1)
        except Exception:
            pass
        self.s.close()


SCEN = []


def scenario(name, question, needs_hooks=False):
    def deco(f):
        SCEN.append((name, question, needs_hooks, f))
        return f
    return deco


@scenario("prereg-ok", "D3 (900/903 order)")
def _(c, note):
    c.register(("sasl",))
    c.login(A1)
    c.quiet()
    c.welcome()
    c.whoami()


@scenario("prereg-bad-then-ok", "D10/retry after 904")
def _(c, note):
    c.register(("sasl",))
    c.login((A1[0], "wrong-" + RUN))
    c.quiet()
    c.login(A1)
    c.quiet()


@scenario("unknown-mech", "Q1 (908 with or without 904)")
def _(c, note):
    c.register(("sasl",))
    c.send("AUTHENTICATE FOOBAR-MECH")
    c.quiet()
    note.append("then PLAIN, to see a retry after the unknown mechanism")
    c.login(A1)
    c.quiet()


@scenario("external-no-cert", "Q1 (a listed mechanism that cannot work here)")
def _(c, note):
    c.register(("sasl",))
    c.send("AUTHENTICATE EXTERNAL")
    c.until(lambda w: w[0] == "AUTHENTICATE" or len(w) > 1 and w[1] in ("904", "907", "908"), 10)
    c.send("AUTHENTICATE +")
    c.quiet()


@scenario("line-too-long", "D6 (905 per line)")
def _(c, note):
    c.register(("sasl",))
    c.send("AUTHENTICATE PLAIN")
    c.quiet(3)
    c.send("AUTHENTICATE " + "A" * 404, "AUTHENTICATE <404 x A>")
    c.quiet()


@scenario("total-too-long", "Q2 (over-long total payload)")
def _(c, note):
    c.register(("sasl",))
    c.send("AUTHENTICATE PLAIN")
    c.quiet(3)
    for i in range(64):
        c.send("AUTHENTICATE " + "A" * 400, f"AUTHENTICATE <400 x A> #{i + 1}")
        l = c.until(lambda w: len(w) > 1 and w[1] in ("904", "905", "906"), 0.3)
        if l:
            note.append(f"server ended it after {i + 1} full chunks ({(i + 1) * 400} bytes)")
            break
    else:
        note.append("64 full chunks (25600 bytes) sent without an error; sending '+' to end it")
        c.send("AUTHENTICATE +")
    c.quiet()


@scenario("abort", "D15 (906)")
def _(c, note):
    c.register(("sasl",))
    c.send("AUTHENTICATE PLAIN")
    c.quiet(3)
    c.send("AUTHENTICATE *")
    c.quiet()


@scenario("postreg-unauth", "Q3 (AUTHENTICATE after 001, not logged in)")
def _(c, note):
    c.register(("sasl", "account-notify"), end=True)
    c.login(A1)
    c.quiet()
    c.whoami()


@scenario("postreg-same", "Q4 (logged in, reauth as the same account)")
def _(c, note):
    c.register(("sasl", "account-notify"))
    c.login(A1)
    c.quiet(2)
    c.welcome()
    c.login(A1)
    c.quiet()
    c.whoami()


@scenario("postreg-diff", "Q4 (logged in, reauth as another account)")
def _(c, note):
    c.register(("sasl", "account-notify"))
    c.login(A1)
    c.quiet(2)
    c.welcome()
    note.append("opener alone first, to see whether a refusal comes at the opener")
    c.send("AUTHENTICATE PLAIN")
    c.quiet()
    c.payload(plain(*A2))
    c.quiet()
    c.whoami()


@scenario("postreg-fail", "Q5 (failed reauth: is the login kept?)")
def _(c, note):
    c.register(("sasl", "account-notify"))
    c.login(A1)
    c.quiet(2)
    c.welcome()
    c.login((A1[0], "wrong-" + RUN))
    c.quiet()
    c.whoami()


@scenario("postreg-fail-oauth", "Q5 (failed OAUTHBEARER reauth: is the login kept?)")
def _(c, note):
    v = c.register(("sasl", "account-notify"))
    if not v or "OAUTHBEARER" not in v:
        note.append("server does not list OAUTHBEARER; skipped")
        return
    c.login(A1)
    c.quiet(2)
    c.welcome()
    note.append("OAUTHBEARER with a token that is not valid")
    c.send("AUTHENTICATE OAUTHBEARER")
    c.until(lambda w: w[0] == "AUTHENTICATE" or len(w) > 1 and w[1] in ("904", "907", "908"), 10)
    c.payload(base64.b64encode(f"n,a={A1[0]},\x01auth=Bearer not-a-valid-token\x01\x01".encode()).decode())
    c.quiet()
    note.append("if the server sent an error challenge, the client acknowledges with AUTHENTICATE *")
    c.send("AUTHENTICATE *")
    c.quiet()
    c.whoami()


@scenario("postreg-no-cap", "D7 (AUTHENTICATE after 001 without the sasl cap)")
def _(c, note):
    c.register(("account-notify",), end=True)
    c.send("AUTHENTICATE PLAIN")
    c.quiet()


def hook(cmd, note, label):
    note.append(f"{label}: ran the hook")
    subprocess.run(cmd, shell=True, check=False, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


@scenario("notify-backend-cycle", "Q6 (does a mechanism-list change come with NEW?)", True)
def _(c, note):
    c.register(("sasl", "cap-notify", "account-notify"), end=True)
    hook(args.hook_cmd_down, note, "backend down")
    c.quiet(20)
    note.append("AUTHENTICATE PLAIN with the backend down")
    c.send("AUTHENTICATE PLAIN")
    c.quiet(8)
    c.send("AUTHENTICATE *")
    c.quiet(4)
    hook(args.hook_cmd_up, note, "backend up")
    c.quiet(40)
    c.send("CAP LS 302")
    c.quiet()


@scenario("notify-del-mid-exchange", "Q7 (sasl DEL / backend loss mid-exchange)", True)
def _(c, note):
    c.register(("sasl", "cap-notify", "account-notify"))
    c.send("AUTHENTICATE PLAIN")
    c.until(lambda w: w[0] == "AUTHENTICATE", 10)
    hook(args.hook_cmd_down, note, "backend down mid-exchange (after the server's '+')")
    c.quiet(20)
    note.append("now the payload")
    c.payload(plain(*A1))
    c.quiet(10)
    c.welcome()
    hook(args.hook_cmd_up, note, "backend up")
    c.quiet(40)


meta = {"kind": "meta", "server_label": args.server_label, "runid": RUN,
        "accounts": [A1[0], A2[0]], "hooks": bool(args.hook_cmd_down)}
recs = [meta]
only = set(args.only.split(",")) if args.only else None
for name, q, needs, f in SCEN:
    if only and name not in only:
        continue
    log, note, t0 = [], [], time.time()
    if needs and not (args.hook_cmd_down and args.hook_cmd_up):
        recs.append({"kind": "trace", "name": name, "question": q, "skipped": "no backend hooks for this server", "lines": []})
        continue
    c = Conn(log, t0)
    try:
        f(c, note)
    except Exception as e:
        note.append(f"stopped: {type(e).__name__}: {e}")
    c.close()
    recs.append({"kind": "trace", "name": name, "question": q, "note": note, "lines": log})
    print(f"  {name:26} {len(log):4} lines  {'; '.join(note)}")
with open(args.out, "w") as fh:
    for r in recs:
        fh.write(json.dumps(r) + "\n")
print(args.out)
