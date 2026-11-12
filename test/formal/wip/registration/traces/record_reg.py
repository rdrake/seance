#!/usr/bin/env python3
"""Record how a server runs connection registration, for ../DECISIONS.md Q1-Q5.

Server-agnostic: everything about the server comes from flags.

  record_reg.py HOST PORT OUT.jsonl --server-label NAME
                [--only s1,s2] [--timeout-wait SECS] [--pass RIGHT]

No SASL (on some servers a login attaches the connection to a bouncer
session and changes the nick). PING is never answered automatically: each
scenario says when it answers, and with which token, so the server's cookie
behaviour is visible. Every line sent and received is recorded raw, in order,
with ms since the scenario started. --pass is the server's connection
password for the PASS scenarios (they are skipped without it); it never
reaches the output.

One JSON object per line: a meta record, then one trace per scenario
(name, question, note, lines [{conn, dir C|S, ms, raw}]).
"""
import argparse, json, random, select, socket, string, time

ap = argparse.ArgumentParser()
ap.add_argument("host"); ap.add_argument("port", type=int); ap.add_argument("out")
ap.add_argument("--server-label", required=True)
ap.add_argument("--only")
ap.add_argument("--timeout-wait", type=float, default=150.0)
ap.add_argument("--pass", dest="password")
ap.add_argument("--quiet", type=float, default=3.0)
args = ap.parse_args()
RUN = "rg" + "".join(random.choice(string.ascii_lowercase) for _ in range(4))
SECRETS = {args.password} if args.password else set()


def words(line):
    if line.startswith("@"):
        line = line.partition(" ")[2]
    return line.split(" ")


class Conn:
    n = 0

    def __init__(self, log, t0):
        Conn.n += 1
        self.tag, self.log, self.t0 = f"c{Conn.n}", log, t0
        self.s = socket.create_connection((args.host, args.port), timeout=30)
        self.buf = b""
        self.pings = []          # tokens of PINGs read and not yet answered

    def _rec(self, d, raw):
        for s in SECRETS:
            assert s not in raw
        self.log.append({"conn": self.tag, "dir": d, "ms": round((time.time() - self.t0) * 1000), "raw": raw})

    def send(self, line, shown=None):
        self.s.sendall((line + "\r\n").encode())
        self._rec("C", shown if shown is not None else line)

    def sendmany(self, lines):
        """Several lines in one write, as a pipelining client sends them."""
        self.s.sendall("".join(l + "\r\n" for l in lines).encode())
        for l in lines:
            self._rec("C", l)

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
        w = words(l)
        if w[0] == "PING":
            self.pings.append(l.split(" ", 1)[1].lstrip(":") if " " in l else "")
        return l

    def until(self, pred, wait=None):
        """Read until pred(words), or `wait` s of silence, or the close.
        Returns the matching line, None on silence, "EOF" on close."""
        wait = args.quiet if wait is None else wait
        try:
            while True:
                l = self.read(wait)
                if pred(words(l)):
                    return l
        except TimeoutError:
            return None
        except (EOFError, ConnectionResetError):
            self._rec("S", "<connection closed>")
            return "EOF"

    def quiet(self, wait=None):
        return self.until(lambda w: False, wait)

    def numeric(self, *nums, wait=None):
        return self.until(lambda w: len(w) > 1 and w[1] in nums, wait)

    def pong_all(self, token=None):
        while self.pings:
            t = self.pings.pop(0)
            self.send(f"PONG :{token if token is not None else t}")

    def caps(self, want):
        """CAP LS 302 (and REQ of what is offered from `want`); returns the LS value map."""
        self.send("CAP LS 302")
        offered = {}
        while True:
            l = self.until(lambda w: len(w) > 4 and w[1] == "CAP" and w[3] == "LS", 15)
            if l in (None, "EOF"):
                return offered
            for c in (l.split(" :", 1)[1] if " :" in l else "").split():
                k, _, v = c.partition("=")
                offered[k] = v
            if words(l)[4] != "*":
                break
        req = [c for c in want if c in offered]
        if req:
            self.send("CAP REQ :" + " ".join(req))
            self.until(lambda w: len(w) > 3 and w[1] == "CAP" and w[3] in ("ACK", "NAK"), 15)
        return offered

    def finish(self, wait=20):
        """Answer PINGs as they come until 001 and the end of the MOTD."""
        end = time.time() + wait
        got001 = False
        while time.time() < end:
            l = self.until(lambda w: w[0] == "PING" or len(w) > 1 and w[1] in ("001", "376", "422", "433", "464"), 5)
            self.pong_all()
            if l in (None, "EOF"):
                return got001
            w = words(l)
            if len(w) > 1 and w[1] == "001":
                got001 = True
            if len(w) > 1 and w[1] in ("376", "422", "433", "464"):
                return got001
        return got001

    def close(self):
        try:
            self.pong_all()
            self.send("QUIT :done")
            self.quiet(1)
        except Exception:
            pass
        self.s.close()


SCEN = []


def scenario(name, question):
    def deco(f):
        SCEN.append((name, question, f))
        return f
    return deco


def nick(tag):
    return f"{RUN}{tag}"


@scenario("cookie-unanswered", "Q3 (cookie PING: is 001 held until the PONG?)")
def _(new, note):
    c = new()
    c.caps([])
    c.sendmany([f"NICK {nick('a')}", "USER u 0 * :u", "CAP END"])
    note.append("no PONG for 12 s")
    r = c.numeric("001", wait=12)
    note.append("001 without a PONG" if r and r != "EOF" else "no 001 in 12 s without a PONG")
    if c.pings:
        note.append("now the PONG")
        c.pong_all()
    c.finish()
    c.close()


@scenario("cookie-wrong-token", "Q3 (a PONG with another token)")
def _(new, note):
    c = new()
    c.caps([])
    c.sendmany([f"NICK {nick('b')}", "USER u 0 * :u", "CAP END"])
    l = c.until(lambda w: w[0] == "PING" or len(w) > 1 and w[1] == "001", 8)
    if c.pings:
        c.pings.pop(0)
        c.send("PONG :not-the-token")
        note.append("PONG with a wrong token, then 8 s")
        r = c.numeric("001", wait=8)
        note.append("001 after the wrong PONG" if r and r != "EOF" else "no 001 after the wrong PONG")
        c.finish()
    else:
        note.append("no PING before 001: nothing to answer wrongly")
    c.close()


@scenario("nick-taken-after-end", "D3 (433 after the client's CAP END)")
def _(new, note):
    a = new()
    a.caps([])
    a.sendmany([f"NICK {nick('x')}", "USER u 0 * :u", "CAP END"])
    a.finish()
    b = new()
    b.caps([])
    b.sendmany([f"NICK {nick('x')}", "USER u 0 * :u", "CAP END"])
    r = b.until(lambda w: w[0] == "PING" or len(w) > 1 and w[1] in ("433", "001"), 10)
    b.pong_all()
    if r and r != "EOF" and words(r)[1] != "433":
        b.numeric("433", "001", wait=10)
    note.append("then the next nick")
    b.send(f"NICK {nick('y')}")
    b.finish()
    b.close(); a.close()


@scenario("nick-taken-before-end", "D3 (433 while registration is suspended)")
def _(new, note):
    a = new()
    a.caps([])
    a.sendmany([f"NICK {nick('p')}", "USER u 0 * :u", "CAP END"])
    a.finish()
    b = new()
    b.caps([])
    b.sendmany([f"NICK {nick('p')}", "USER u 0 * :u"])
    b.numeric("433", wait=10)
    b.pong_all()
    b.send(f"NICK {nick('q')}")
    b.quiet(2)
    b.pong_all()
    b.send("CAP END")
    b.finish()
    b.close(); a.close()


@scenario("meta-prereg-set", "D6 (METADATA * SET before registration, and the burst batch)")
def _(new, note):
    c = new()
    off = c.caps(["batch", "message-tags", "draft/metadata-2"])
    note.append("metadata-2=" + off.get("draft/metadata-2", "<absent>"))
    c.send("METADATA * SET display-name :pre reg value")
    c.quiet(2)
    c.pong_all()
    c.sendmany([f"NICK {nick('m')}", "USER u 0 * :u", "CAP END"])
    c.finish()
    c.quiet(2)
    c.close()


@scenario("meta-prereg-none", "D6 (metadata negotiated, nothing set: empty batch?)")
def _(new, note):
    c = new()
    c.caps(["batch", "message-tags", "draft/metadata-2"])
    c.sendmany([f"NICK {nick('n')}", "USER u 0 * :u", "CAP END"])
    c.finish()
    c.quiet(2)
    c.close()


@scenario("meta-prereg-nicktarget", "Q1 (METADATA aimed at the requested nick before registration)")
def _(new, note):
    c = new()
    c.caps(["batch", "message-tags", "draft/metadata-2"])
    c.send(f"NICK {nick('t')}")
    c.send(f"METADATA {nick('t')} SET display-name :nick target")
    c.quiet(2)
    c.pong_all()
    c.sendmany(["USER u 0 * :u", "CAP END"])
    c.finish()
    c.quiet(2)
    c.close()


@scenario("meta-after-end", "Q2 (METADATA * SET after CAP END, in the same write)")
def _(new, note):
    c = new()
    c.caps(["batch", "message-tags", "draft/metadata-2"])
    c.sendmany([f"NICK {nick('e')}", "USER u 0 * :u", "CAP END",
                "METADATA * SET display-name :after end"])
    c.finish()
    c.quiet(2)
    c.close()


@scenario("meta-prereg-nocap", "D5 (METADATA before registration without the cap)")
def _(new, note):
    c = new()
    c.caps([])
    c.send("METADATA * SET display-name :no cap")
    c.quiet(2)
    c.pong_all()
    c.sendmany([f"NICK {nick('c')}", "USER u 0 * :u", "CAP END"])
    c.finish()
    c.close()


@scenario("rereg-after-001", "D8 (PASS and USER after registration: 462)")
def _(new, note):
    c = new()
    c.caps([])
    c.sendmany([f"NICK {nick('r')}", "USER u 0 * :u", "CAP END"])
    c.finish()
    c.send("PASS :whatever")
    c.send("USER u 0 * :u")
    c.quiet()
    c.close()


@scenario("pass-wrong", "Q5 (a wrong connection password: 464, ERROR, or both)")
def _(new, note):
    if not args.password:
        note.append("skipped: no --pass (the server needs no connection password)")
        return
    c = new()
    c.caps([])
    c.sendmany(["PASS :wrong-" + RUN, f"NICK {nick('w')}", "USER u 0 * :u", "CAP END"])
    c.finish()
    c.quiet(5)
    c.close()


@scenario("pass-right", "Q5 (the right connection password)")
def _(new, note):
    if not args.password:
        note.append("skipped: no --pass")
        return
    c = new()
    c.caps([])
    c.send("PASS :" + args.password, "PASS :<password>")
    c.sendmany([f"NICK {nick('k')}", "USER u 0 * :u", "CAP END"])
    c.finish()
    c.close()


@scenario("timeout-silent", "Q4 (registration timeout: connect, CAP LS, NICK, never USER)")
def _(new, note):
    c = new()
    c.caps([])
    c.send(f"NICK {nick('s')}")
    t = time.time()
    note.append(f"then silent, answering PINGs, up to {args.timeout_wait:.0f} s")
    while time.time() - t < args.timeout_wait:
        r = c.until(lambda w: w[0] in ("PING", "ERROR"), 10)
        c.pong_all()
        if r == "EOF" or (r and words(r)[0] == "ERROR"):
            c.quiet(2)
            note.append(f"ended after {time.time() - t:.0f} s")
            break
    else:
        note.append("still open at the end of the wait")
    c.close()


meta = {"kind": "meta", "server_label": args.server_label, "runid": RUN,
        "pass_scenarios": bool(args.password), "timeout_wait_s": args.timeout_wait}
recs = [meta]
only = set(args.only.split(",")) if args.only else None
for name, q, f in SCEN:
    if only and name not in only:
        continue
    log, note, t0 = [], [], time.time()
    conns = []

    def new():
        c = Conn(log, t0)
        conns.append(c)
        return c
    try:
        f(new, note)
    except Exception as e:
        note.append(f"stopped: {type(e).__name__}: {e}")
    for c in conns:
        try:
            c.s.close()
        except Exception:
            pass
    recs.append({"kind": "trace", "name": name, "question": q, "note": note, "lines": log})
    print(f"  {name:26} {len(log):4} lines  {'; '.join(note)}", flush=True)
with open(args.out, "w") as fh:
    for r in recs:
        fh.write(json.dumps(r) + "\n")
print(args.out)
