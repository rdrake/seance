"""Line-level IRC proxy between a real client app and a real ircd, injecting
exactly one server move per scenario.  Everything else passes through
untouched.  Both directions are logged with UTC timestamps.

  python3 inject_proxy.py --scenario split-ack --listen 7000 [--tls-listen 7001]
        --upstream 127.0.0.1:26667 --log results/live/hexdroid-split-ack.jsonl

Scenarios (one per proxy process; every accepted connection gets it):
  none           pass-through control
  split-ack      the ircd's CAP ACK holding sasl is split at a cap boundary into
                 two ACK lines, `sasl` first, no `*` marker.  The second part is
                 written once the client has sent something after the first, or
                 after --split-wait seconds.
  del-opener     inject `CAP <nick> DEL :sasl` right after the client's
                 `AUTHENTICATE <mech>`; swallow the ircd's later SASL replies
                 (AUTHENTICATE, 900-908) on that connection.
  del-response   the same, right after the client's first response line.
  new-before-001 hide --new-cap from the ircd's LS.  After the client's CAP END,
                 hold every ircd line and inject `CAP <nick> NEW :<cap>`.  A client
                 REQ naming the cap is not forwarded (the ircd never offered it);
                 it is answered with an injected ACK.  The held lines are released
                 when the client sends another CAP END, or after --hold seconds.
  nonplus        replace the ircd's first `AUTHENTICATE +` with `AUTHENTICATE Zm9v`.

--mask-close S: if the ircd closes first, drop its ERROR and keep the client's
socket open up to S seconds, so a client-side timer can be told from the ircd's.

Pacing (--quiet, default 0.3 s): before writing a server line the model sees
(drive.model_of), the proxy waits until the client has been silent that long,
so a client line's `r` (model lines written before it) is what it had read.

Log records (JSON lines): {"ts","conn","ev",...}
  ev=c      line from the client;  fwd: what went to the ircd (null = swallowed)
  ev=s      line from the ircd;    act: pass|mod|drop|hold
  ev=out    line written to the client;  inj: true if the proxy made it up
  ev=note   free text (connect, close, release decisions)

--to-trace LOG OUT --name-prefix P converts a log to results/*.jsonl traces.
"""
import argparse, asyncio, datetime, json, os, ssl, subprocess, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from drive import model_of, parse  # noqa: E402
from spec_server import client_model, mcaps  # noqa: E402

SASL_NUMERICS = {str(n) for n in range(900, 909)}


def now():
    return datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def split_prefix(line):
    """-> (tags+prefix part incl. trailing space, rest)."""
    head, rest = "", line
    if rest.startswith("@"):
        t, rest = rest.split(" ", 1)
        head += t + " "
    if rest.startswith(":"):
        p, rest = rest.split(" ", 1)
        head += p + " "
    return head, rest


class Conn:
    def __init__(self, px, cr, cw, n):
        self.px, self.cr, self.cw, self.n = px, cr, cw, n
        self.sc = px.args.scenario
        self.q = asyncio.Queue()
        self.last_crx = 0.0
        self.client_seq = 0          # client lines received
        self.nick = "*"
        self.server_prefix = ":proxy.invalid "
        self.done_split = self.done_del = self.done_nonplus = False
        self.swallow = False
        self.saw_mech = self.saw_plus = False
        self.ended = 0               # CAP ENDs from the client
        self.holding = False
        self.held = []
        self.released = None
        self.injected_new = False
        self.closed = False

    def log(self, **kw):
        self.px.log(conn=self.n, **kw)

    # ------------------------------------------------------------- plumbing
    async def run(self):
        host, port = self.px.args.upstream.rsplit(":", 1)
        self.sr, self.sw = await asyncio.open_connection(host, int(port))
        self.log(ev="note", text=f"connected; scenario {self.sc}; tls={self.px.tls_conn(self.cw)}")
        tasks = [asyncio.create_task(x) for x in (self.c2s(), self.s2c(), self.writer())]
        done, _ = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
        if self.px.args.mask_close and tasks[1] in done and tasks[0] not in done:
            # the ircd closed first: keep the client's socket open, so only the
            # client can end the connection (separates its own timer from the ircd's)
            self.log(ev="note", text=f"ircd closed; masking it, client socket held open up to "
                                     f"{self.px.args.mask_close}s")
            t0 = time.time()
            await asyncio.wait([tasks[0]], timeout=self.px.args.mask_close)
            self.log(ev="note", text=("client closed %.1fs after the masked ircd close" % (time.time() - t0))
                     if tasks[0].done() else "mask window over; client never closed")
        self.closed = True
        for t in tasks:
            t.cancel()
        for w in (self.cw, self.sw):
            try:
                w.close()
            except Exception:
                pass
        self.log(ev="note", text="closed")

    async def lines(self, r, who):
        while True:
            raw = await r.readline()
            if not raw:
                self.log(ev="note", text=f"{who} closed")
                return
            yield raw.rstrip(b"\r\n").decode("utf-8", errors="replace")

    def out(self, line, inj=False, orig=None):
        self.q.put_nowait(("line", line, inj, orig))

    async def writer(self):
        Q = self.px.args.quiet
        while True:
            kind, *rest = await self.q.get()
            if kind == "wait_client":
                seq0, secs = self.client_seq, rest[0]
                end = time.time() + secs
                while self.client_seq == seq0 and time.time() < end:
                    await asyncio.sleep(0.02)
                self.log(ev="note", text="split: client spoke after part 1" if self.client_seq != seq0
                         else f"split: client silent {secs}s after part 1")
                continue
            line, inj, orig = rest
            if Q and model_of(line) is not None:
                while time.time() - self.last_crx < Q:
                    await asyncio.sleep(0.02)
            self.cw.write((line + "\r\n").encode())
            await self.cw.drain()
            wcmd, wp = parse(line)
            if wp and (wcmd == "001" or (wcmd == "CAP" and len(wp) >= 2)):
                self.nick = wp[0]          # injected lines address the client as the ircd last did
            rec = dict(ev="out", line=line)
            if inj:
                rec["inj"] = True
            if orig is not None:
                rec["orig"] = orig
            self.log(**rec)

    # ------------------------------------------------------------- client -> ircd
    async def c2s(self):
        async for line in self.lines(self.cr, "client"):
            self.last_crx = time.time()
            self.client_seq += 1
            fwd = self.on_client(line)
            self.log(ev="c", line=line, fwd=fwd)
            if fwd is not None and not self.sw.is_closing():
                self.send_up(fwd)
                try:
                    await self.sw.drain()
                except ConnectionError:
                    pass
            self.after_client(line)

    def on_client(self, line):
        """-> the line to forward (None = swallow)."""
        cmd, p = parse(line)
        if self.sc == "new-before-001" and self.injected_new and cmd == "CAP" and p and p[0].upper() == "REQ":
            cap = self.px.args.new_cap
            toks = p[-1].split()
            if cap in toks:
                rest = [t for t in toks if t != cap]
                self.out(f"{self.server_prefix}CAP {self.nick} ACK :{cap}", inj=True)
                return ("CAP REQ :" + " ".join(rest)) if rest else None
        return line

    def after_client(self, line):
        cmd, p = parse(line)
        if cmd == "CAP" and p and p[0].upper() == "END":
            self.ended += 1
            if self.sc == "new-before-001":
                if self.ended == 1 and not self.injected_new:
                    self.holding = True
                    self.injected_new = True
                    self.out(f"{self.server_prefix}CAP {self.nick} NEW :{self.px.args.new_cap}", inj=True)
                    asyncio.get_running_loop().call_later(self.px.args.hold, self.release, "timeout")
                elif self.holding:
                    self.release("second CAP END")
        if cmd == "AUTHENTICATE" and p:
            a = p[0]
            is_mech = a.upper() in ("PLAIN", "EXTERNAL", "SCRAM-SHA-256", "SCRAM-SHA-1", "OAUTHBEARER")
            if self.sc == "del-opener" and is_mech and not self.done_del:
                self.inject_del()
            elif (self.sc == "del-response" and not is_mech and a != "*" and self.saw_plus
                  and not self.done_del):
                self.inject_del()

    def inject_del(self):
        self.done_del = True
        self.swallow = True
        self.out(f"{self.server_prefix}CAP {self.nick} DEL :sasl", inj=True)

    def release(self, why):
        if not self.holding or self.closed:
            return
        self.holding = False
        self.released = why
        self.log(ev="note", text=f"release held burst ({len(self.held)} lines): {why}")
        for l in self.held:
            self.out(l)
        self.held = []

    # ------------------------------------------------------------- ircd -> client
    async def s2c(self):
        async for line in self.lines(self.sr, "ircd"):
            self.on_server(line)

    def send_up(self, line):
        if self.sw.is_closing():
            return
        self.sw.write((line + "\r\n").encode())

    def on_server(self, line):
        head, rest = split_prefix(line)
        cmd, p = parse(line)
        if head.strip().startswith(":") and "!" not in head:
            self.server_prefix = head if not head.startswith("@") else head.split(" ", 1)[1]
        if self.px.args.mask_close and cmd == "ERROR":
            self.log(ev="s", line=line, act="drop")
            return
        if self.holding:
            self.held.append(line)
            self.log(ev="s", line=line, act="hold")
            return
        if self.swallow and (cmd == "AUTHENTICATE" or cmd in SASL_NUMERICS):
            self.log(ev="s", line=line, act="drop")
            return
        if cmd == "AUTHENTICATE" and p and p[0] == "+":
            self.saw_plus = True
            if self.sc == "nonplus" and not self.done_nonplus:
                self.done_nonplus = True
                new = line.replace("AUTHENTICATE +", "AUTHENTICATE Zm9v", 1)
                self.log(ev="s", line=line, act="mod")
                self.out(new, orig=line)
                return
        if cmd == "CAP" and len(p) >= 3:
            sub = p[1].upper()
            if self.sc == "split-ack" and sub == "ACK" and not self.done_split:
                caps = p[-1].split()
                if "sasl" in caps and len(caps) > 1:
                    self.done_split = True
                    rest_caps = [c for c in caps if c != "sasl"]
                    pre = line[: len(line) - len(rest)]
                    self.log(ev="s", line=line, act="mod")
                    self.out(f"{pre}CAP {p[0]} ACK :sasl", orig=line)
                    self.q.put_nowait(("wait_client", self.px.args.split_wait))
                    self.out(f"{pre}CAP {p[0]} ACK :{' '.join(rest_caps)}", orig=line)
                    return
            if self.sc == "new-before-001" and sub == "LS":
                cap = self.px.args.new_cap
                toks = p[-1].split()
                keep = [t for t in toks if t.split("=", 1)[0] != cap]
                if len(keep) != len(toks):
                    i = line.rfind(" :")
                    new = line[: i + 2] + " ".join(keep)
                    self.log(ev="s", line=line, act="mod")
                    self.out(new, orig=line)
                    return
        self.log(ev="s", line=line, act="pass")
        self.out(line)


class Proxy:
    def __init__(self, args):
        self.args = args
        self.n = 0
        os.makedirs(os.path.dirname(os.path.abspath(args.log)), exist_ok=True)
        self.f = open(args.log, "a")
        self.tls_writers = set()

    def log(self, **kw):
        rec = {"ts": now(), "scenario": self.args.scenario, "tag": self.args.tag, **kw}
        self.f.write(json.dumps(rec) + "\n")
        self.f.flush()
        if not self.args.silent:
            print(json.dumps(rec), flush=True)

    def tls_conn(self, w):
        return w.get_extra_info("ssl_object") is not None

    async def handle(self, r, w):
        self.n += 1
        await Conn(self, r, w, self.n).run()

    async def main(self):
        servers = [await asyncio.start_server(self.handle, "127.0.0.1", self.args.listen)]
        if self.args.tls_listen:
            ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
            ctx.load_cert_chain(self.args.cert, self.args.key)
            servers.append(await asyncio.start_server(self.handle, "127.0.0.1", self.args.tls_listen, ssl=ctx))
        self.log(ev="note", conn=0, text=f"listening plain {self.args.listen} tls {self.args.tls_listen} "
                 f"-> {self.args.upstream}")
        await asyncio.gather(*(s.serve_forever() for s in servers))


# ----------------------------------------------------------------- traces
def to_traces(log_path, out_path, prefix, creds=True, after_reg=1.0, extra_key="live", meta=None):
    """One trace per (tag, scenario, conn) in the log.  Format as spec_server.to_trace."""
    recs = [json.loads(l) for l in open(log_path)]
    groups, run = {}, {}
    for r in recs:
        k = (r.get("tag"), r["scenario"])
        if r.get("conn", 0) == 0:
            run[k] = run.get(k, 0) + 1          # one proxy process = one run
            continue
        groups.setdefault((r.get("tag"), r["scenario"], run.get(k, 1), r["conn"]), []).append(r)
    out = []
    for (tag, sc, nrun, n), rs in groups.items():
        obs, cli, raw, notes = [], [], [], []
        cstate = {"ls": False}
        initial, t001, tls = [], None, None
        for r in rs:
            ts = datetime.datetime.fromisoformat(r["ts"].replace("Z", "+00:00")).timestamp()
            if t001 is not None and ts - t001 > after_reg:
                break
            if r["ev"] == "note":
                notes.append(r["text"])
                if "tls=" in r["text"]:
                    tls = "tls=True" in r["text"]
                if r["text"].startswith("release held") and r["text"].endswith("timeout"):
                    # the released 001 is the proxy's timeout, not a server move: a server
                    # that follows CN:355 (the model's hold, D13) would still be holding
                    notes.append("trace cut at the proxy's timeout release; the released burst "
                                 "(001 ...) is left out of obs")
                    break
                continue
            if r["ev"] == "out":
                raw.append("S " + r["line"] + ("    [injected]" if r.get("inj") else "")
                           + ("    [modified]" if "orig" in r else ""))
                m = model_of(r["line"])
                cmd, p = parse(r["line"])
                if cmd == "CAP" and len(p) >= 3 and p[1].upper() == "LS" and not t001:
                    initial += p[-1].split()
                if cmd == "001" and t001 is None:
                    t001 = ts
                if m is None:
                    continue
                if m["t"] in ("ACK", "NAK", "NEW", "DEL") and not m["caps"]:
                    continue
                if m["t"] == "ERROR":
                    notes.append("ircd ERROR left out of obs (its registration timer, not a "
                                 "SASL failure close): " + r["line"])
                    continue
                obs.append(m)
            elif r["ev"] == "c":
                raw.append("C " + r["line"] + ("" if r["fwd"] == r["line"] else
                           "    [not forwarded]" if r["fwd"] is None else f"    [forwarded as: {r['fwd']}]"))
                m = client_model(r["line"], cstate)
                if m is None or (m["t"] == "REQ" and not m["caps"]):
                    continue
                cli.append({"m": m, "r": len(obs)})
        if not raw:
            continue
        nls = sum(1 for m in obs if m["t"] == "LS")
        assert nls <= 2, (tag, sc, n)
        name = f"{prefix}/{tag or ''}/{sc}".replace("//", "/")
        if any("masking it" in x for x in notes):
            name += "/mask-close"
        if sum(1 for k in groups if k[0] == tag and k[1] == sc and k[2] == nrun) > 1:
            name += f"/conn{n}"
        tr = {"name": name,
              "env": {"creds": creds, "wantSasl": True, "required": False, "svcOk": True},
              "offered": sorted(set(mcaps(initial)) - {"cap-notify"}),
              "obs": obs, "cli": cli, "raw": raw, "dropAt": None,
              extra_key: {"stalled": t001 is None, "notes": notes, "tls": bool(tls),
                          "release": next((x.split(": ", 1)[1] for x in notes if x.startswith("release held")), None),
                          "scenario": sc, **(meta or {})}}
        out.append(tr)
    with open(out_path, "a") as f:
        for tr in out:
            f.write(json.dumps(tr) + "\n")
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--scenario", choices=["none", "split-ack", "del-opener", "del-response",
                                           "new-before-001", "nonplus"])
    ap.add_argument("--tag", default="", help="free label stored in every record (app/server/variant)")
    ap.add_argument("--listen", type=int, default=7000)
    ap.add_argument("--tls-listen", type=int, default=0)
    ap.add_argument("--cert"), ap.add_argument("--key")
    ap.add_argument("--upstream", default="127.0.0.1:26667")
    ap.add_argument("--log", default=os.path.join(HERE, "results", "live", "proxy.jsonl"))
    ap.add_argument("--quiet", type=float, default=0.3)
    ap.add_argument("--split-wait", type=float, default=3.0)
    ap.add_argument("--hold", type=float, default=30.0)
    ap.add_argument("--new-cap", default="server-time")
    ap.add_argument("--silent", action="store_true")
    ap.add_argument("--mask-close", type=float, default=0.0,
                    help="if the ircd closes first, drop its ERROR and hold the client socket open this long")
    ap.add_argument("--to-trace", nargs=2, metavar=("LOG", "OUT"))
    ap.add_argument("--name-prefix", default="live")
    ap.add_argument("--meta", default="{}", help="JSON merged into the trace's extra key")
    a = ap.parse_args()
    if a.to_trace:
        for tr in to_traces(a.to_trace[0], a.to_trace[1], a.name_prefix, meta=json.loads(a.meta)):
            print(tr["name"], len(tr["obs"]), "obs", len(tr["cli"]), "cli", "stalled" if tr["live"]["stalled"] else "")
        return
    if a.tls_listen and not a.cert:
        d = os.path.join(os.path.dirname(os.path.abspath(a.log)), "cert")
        os.makedirs(d, exist_ok=True)
        a.cert, a.key = os.path.join(d, "proxy.crt"), os.path.join(d, "proxy.key")
        if not os.path.exists(a.cert):
            subprocess.run(["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "3",
                            "-subj", "/CN=localhost", "-keyout", a.key, "-out", a.cert],
                           check=True, capture_output=True)
    asyncio.run(Proxy(a).main())


if __name__ == "__main__":
    main()
