#!/usr/bin/env python3
"""Drive a live ircd through client schedules the spec model's client allows,
and record each run as a model trace for trace validation (check.py).

A schedule is a list of steps; each step sends some lines at once, then waits
until the server has been silent for SETTLE seconds.  Every server line is
reduced to the model's vocabulary (model_of); every client line is recorded
with r = the number of model-vocabulary server lines received before it was
sent (the client had read exactly those).

Usage: drive.py HOST PORT OUT.jsonl [--only NAME] [--grep SUBSTRING] [--settle SECONDS]
                [--services HOST:PORT]   (fake P10 services; adds link-drop schedules)
                [--svc-down CMD --svc-up CMD]  (real services: commands that take the auth layer down and up)
(--settle 2.5 for nefarious2, whose fake lag is about 2 s a command)
"""
import base64, json, socket, sys, time, itertools

SETTLE = 0.4
SEQ = 0
SERVICES = False
import os
ACCOUNT = os.environ.get("DRIVE_ACCOUNT", "tester")
GOOD = os.environ.get("DRIVE_PASSWORD", "goodpass")
BAD = "wrongpass"
# server cap name -> model cap name; every other cap is outside the model.
CAPMAP = {"sasl": "sasl", "server-time": "a", "cap-notify": "cap-notify"}
WIRE = {v: k for k, v in CAPMAP.items()}


def capname(tok):
    return tok.split("=", 1)[0]


def model_caps(text):
    return sorted({CAPMAP[capname(t)] for t in text.split() if capname(t) in CAPMAP})


def parse(line):
    """-> (command, params) of one IRC line, tags and prefix dropped."""
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


def model_of(line):
    """A server line as a model message dict, or None when outside the model.
    902/905 fold into 904 (D6); 908 is dropped (mechanism list)."""
    cmd, p = parse(line)
    if cmd == "CAP" and len(p) >= 3:
        sub = p[1].upper()
        if sub == "LS":
            more = len(p) >= 4 and p[2] == "*"
            return {"t": "LS", "caps": model_caps(p[-1]), "more": more}
        if sub in ("ACK", "NAK", "NEW", "DEL"):
            return {"t": sub, "caps": model_caps(p[-1]), "more": False}
        return None
    if cmd == "AUTHENTICATE" and p and p[0] == "+":
        return {"t": "AUTH+"}
    if cmd in ("900", "903", "906", "907", "001"):
        return {"t": cmd}
    if cmd in ("902", "904", "905"):
        return {"t": "904"}
    if cmd == "ERROR":
        return {"t": "ERROR"}
    return None


def collapse_ls(ms):
    """LS lines with no model cap that are not final carry nothing the model
    sees; drop them.  More than two LS lines are merged into one (the model's
    LS is one or two lines; D-entry: an observation-preserving merge)."""
    out, run = [], []
    def flush():
        if not run:
            return
        keep = [m for m in run[:-1] if m["caps"]] + [run[-1]]
        if len(keep) > 2:
            keep = [{"t": "LS", "caps": sorted({c for m in keep for c in m["caps"]}), "more": False}]
        out.extend(keep)
        run.clear()
    for m in ms:
        if m["t"] == "LS":
            run.append(m)
            if not m["more"]:
                flush()
        else:
            flush()
            out.append(m)
    flush()
    return out


class Services:
    """A fake P10 services server (svc.example.net) that answers SASL PLAIN
    like X3: ACCOUNT/GOOD succeeds, anything else fails.  Used for ircds
    (nefarious2) whose SASL goes to linked services.  drop() closes the link,
    which makes the ircd withdraw sasl (CAP DEL); link() brings it back."""

    def __init__(self, host, port):
        self.host, self.port, self.s = host, port, None

    def link(self):
        import threading
        self.s = socket.create_connection((self.host, self.port))
        self.s.settimeout(None)
        t = int(time.time())
        self.tx("PASS :pw")
        self.tx(f"SERVER svc.example.net 1 {t} {t} J10 SV]]] +s6 :svc")
        self.tx("SV EB")
        self.ready = threading.Event()
        threading.Thread(target=self._rd, args=(self.s,), daemon=True).start()
        if not self.ready.wait(15):
            raise RuntimeError("services link did not burst")
        time.sleep(1.0)

    def tx(self, l):
        self.s.sendall((l + "\r\n").encode())

    def _rd(self, sock):
        buf = b""
        while True:
            try:
                d = sock.recv(65536)
            except OSError:
                return
            if not d:
                return
            buf += d
            while b"\n" in buf:
                l, buf = buf.split(b"\n", 1)
                p = l.rstrip(b"\r").decode(errors="replace").split(" ")
                try:
                    self.on(p)
                except OSError:
                    return

    def on(self, p):
        if len(p) > 1 and p[1] == "G":
            self.tx("SV Z " + " ".join(p[2:]))
        if len(p) > 1 and p[1] == "EB":
            self.tx("SV EA")
            self.ready.set()
        if len(p) > 4 and p[1] == "SASL":
            tok, sub = p[3], p[4]
            srv = tok.split("!")[0]
            if sub == "S":
                self.tx(f"SV SASL {srv} {tok} C +")
            elif sub == "C":
                parts = base64.b64decode(p[5]).split(b"\0")
                acct, pw = parts[1].decode(), parts[2].decode()
                if acct == ACCOUNT and pw == GOOD:
                    self.tx(f"SV SASL {srv} {tok} L {acct} {int(time.time())}")
                    self.tx(f"SV SASL {srv} {tok} D S")
                else:
                    self.tx(f"SV SASL {srv} {tok} D F")

    def drop(self):
        try:
            self.s.close()
        except OSError:
            pass
        self.s = None


SVC = None


class CmdServices:
    """Real services (a testnet): drop() runs a command that takes the
    authentication layer down (e.g. `docker stop keycloak`), link() one that
    brings it back, then waits until a fresh connection's LS lists sasl."""

    def __init__(self, down, up, host, port):
        self.down, self.up, self.host, self.port = down, up, host, port
        self.s = True

    def drop(self):
        import subprocess
        subprocess.run(self.down, shell=True, capture_output=True)
        self.s = None

    def link(self):
        import subprocess
        subprocess.run(self.up, shell=True, capture_output=True)
        end = time.time() + 180
        while time.time() < end:
            time.sleep(5)
            try:
                k = socket.create_connection((self.host, self.port), timeout=5)
                k.sendall(b"CAP LS 302\r\n")
                buf, t0 = b"", time.time()
                while time.time() - t0 < 4 and b" LS :" not in buf:
                    try:
                        buf += k.recv(65536)
                    except socket.timeout:
                        break
                k.close()
                if b"sasl" in buf:
                    self.s = True
                    return
            except OSError:
                pass
        raise RuntimeError("sasl did not come back after " + self.up)


class Conn:
    def __init__(self, host, port):
        self.s = socket.create_connection((host, port))
        self.s.settimeout(SETTLE)
        self.buf, self.raw, self.events = b"", [], []   # events: ("s", line) / ("c", line, msg)
        self.closed = False
        self.on_auth = None      # (lines, msgs) sent the moment AUTHENTICATE + is read
        self.before_auth = None  # called just before that (drop services mid-exchange)

    def send(self, lines, msgs):
        for l, m in zip(lines, msgs):
            self.events.append(("c", l, m))
        self.s.sendall("".join(l + "\r\n" for l in lines).encode())

    def settle(self, limit=8.0):
        end = time.time() + limit
        while time.time() < end and not self.closed:
            try:
                d = self.s.recv(65536)
            except socket.timeout:
                return
            if not d:
                self.closed = True
                return
            self.buf += d
            while b"\n" in self.buf:
                l, self.buf = self.buf.split(b"\n", 1)
                l = l.rstrip(b"\r").decode(errors="replace")
                self.raw.append(l)
                self.events.append(("s", l))
                if self.on_auth and (model_of(l) or {}).get("t") == "AUTH+":
                    lines, msgs = self.on_auth
                    self.on_auth = None
                    if self.before_auth:
                        self.before_auth()
                        self.before_auth = None
                    self.send(lines, msgs)

    def seen(self, t):
        return [e for e in self.events if e[0] == "s" and (model_of(e[1]) or {}).get("t") == t]


def M(t, caps=(), more=False):
    return {"t": t, "caps": sorted(caps), "more": more}


def req(caps):
    return "CAP REQ :" + " ".join(WIRE[c] for c in sorted(caps)), M("REQ", caps)


def run(host, port, sched):
    """sched: dict(name, reqs=[[set, pipelined?]...], sasl=[...], end=...)."""
    drop = sched.get("drop")
    if drop == "beforeConnect" and SVC and SVC.s:
        SVC.drop()               # services gone before the client connects
        time.sleep(1.0)
    c = Conn(host, port)
    if drop == "beforeConnect":
        c.events.append(("d",))  # down from the start: before any server line
    global SEQ
    SEQ += 1
    nick = "t%05d" % SEQ
    c.send(["CAP LS 302", "NICK " + nick, "USER u 0 * :u"], [None, None, None])
    c.settle()
    def svc_drop():
        if SVC and SVC.s:
            SVC.drop()
            c.events.append(("d",))   # where the link went, among the lines read
    if drop == "afterLS":
        svc_drop()
        c.settle()
    first = True
    for caps, wait in sched["reqs"]:
        l, m = req(caps)
        batch = [(l, m)]
        if sched["end"] == "pipelined" and first:
            batch.append(("CAP END", M("END")))
        first = False
        c.send([b[0] for b in batch], [b[1] for b in batch])
        if wait:
            c.settle()
    c.settle()
    if drop == "afterACK":
        svc_drop()
        c.settle()
    ended = sched["end"] == "pipelined"
    acked = lambda: any("sasl" in (model_of(e[1]) or {}).get("caps", []) for e in c.seen("ACK"))
    for i, att in enumerate(sched["sasl"]):
        if not acked() or c.seen("001") or c.closed:
            break                     # the model client may not open (S1-1, S1-2)
        pw = GOOD if att["creds"] else BAD
        data = base64.b64encode(f"{ACCOUNT}\0{ACCOUNT}\0{pw}".encode()).decode()
        mech = [("AUTHENTICATE PLAIN", M("AUTHMECH"))]
        if att["abort"] == "before+":
            mech.append(("AUTHENTICATE *", M("AUTHSTAR")))
        if sched["end"] == "midexchange" and i == 0 and not ended:
            mech.append(("CAP END", M("END")))
            ended = True
        if att["abort"] != "before+":
            # The model client answers AUTHENTICATE + in the step that reads it.
            dat = [("AUTHENTICATE " + data, M("AUTHDATA"))]
            if att["abort"] == "afterdata":
                dat.append(("AUTHENTICATE *", M("AUTHSTAR")))
            c.on_auth = ([b[0] for b in dat], [b[1] for b in dat])
            if drop == "midexchange" and i == 0:
                c.before_auth = svc_drop
        c.send([b[0] for b in mech], [b[1] for b in mech])
        c.settle()
        c.on_auth = None
        if att["abort"] == "before+":
            continue
        if any(e for e in c.seen("900")):
            break
    if not ended and not c.closed:
        if sched.get("lateReq"):        # END, then a REQ before 001 (D13), END again
            l, m = req(sched["lateReq"])
            c.send(["CAP END", l, "CAP END"], [M("END"), m, M("END")])
        else:
            c.send(["CAP END"], [M("END")])
        c.settle()
    c.settle(2.0)
    c.s.close()
    if SVC and not SVC.s:
        time.sleep(1.0)
        SVC.link()               # back up for the next schedule
    return c


def to_trace(c, sched):
    """Reduce to model lines; client events with r = model server lines read."""
    srv_model, cli = [], []
    drop_raw = None
    for e in c.events:
        if e[0] == "d":
            drop_raw = len(srv_model)
            continue
        if e[0] == "s":
            m = model_of(e[1])
            if m:
                srv_model.append(m)
        elif e[2] is not None:
            cli.append({"m": e[2], "rawIdx": len(srv_model)})
    obs = collapse_ls(srv_model)
    # recompute r against the collapsed list: r counts collapsed lines whose
    # source index is below rawIdx.  Collapsing only touches the LS run before
    # any client event, so the LS run counts as its collapsed length.
    nls_raw = sum(1 for m in srv_model if m["t"] == "LS")
    nls_obs = sum(1 for m in obs if m["t"] == "LS")
    for ce in cli:
        raw = ce.pop("rawIdx")
        ce["r"] = raw - (nls_raw - nls_obs if raw >= nls_raw else 0)
    # dropAt: model server lines received before the services link went;
    # check.py requires sasl to be withdrawn before any later line.
    drop_at = None if drop_raw is None else (
        drop_raw - (nls_raw - nls_obs if drop_raw >= nls_raw else 0))
    wants = bool(sched["sasl"])
    creds = sched["sasl"][-1]["creds"] if sched["sasl"] else True
    return {"name": sched["name"], "env": {"creds": creds, "wantSasl": wants,
            "required": False, "svcOk": True},
            "offered": sorted({c for m in obs if m["t"] == "LS" for c in m["caps"]} - {"cap-notify"}),
            "obs": obs, "cli": cli, "raw": c.raw, "dropAt": drop_at}


def schedules():
    S, A, CN = "sasl", "a", "cap-notify"
    plans = {
        "sasl": [[{S}, True]],
        "a+sasl": [[{A, S}, True]],
        "sasl|a": [[{S}, False], [{A}, True]],
        "a": [[{A}, True]],
        "sasl+cn": [[{S, CN}, True]],
        "a.then.sasl": [[{A}, True], [{S}, True]],
        "cn|a+sasl": [[{CN}, False], [{A, S}, True]],
    }
    att = lambda creds, abort=None: {"creds": creds, "abort": abort}
    saslplans = {
        "none": [], "good": [att(True)], "bad": [att(False)],
        "abort-early.good": [att(True, "before+"), att(True)],
        "abort-late.good": [att(True, "afterdata"), att(True)],
        "bad.bad": [att(False), att(False)],
    }
    for (pn, p), (sn, sp), end in itertools.product(plans.items(), saslplans.items(),
                                                     ["after", "pipelined", "midexchange"]):
        has = any(S in caps for caps, _ in p)
        if not has and sn != "none":
            continue
        if end == "midexchange" and sn == "none":
            continue
        yield {"name": f"{pn}/{sn}/{end}", "reqs": p, "sasl": sp, "end": end}
    yield {"name": "a/none/after+lateReq", "reqs": plans["a"], "sasl": [], "end": "after",
           "lateReq": {S}}
    if SERVICES:
        # The services link drops during the handshake: the ircd withdraws
        # sasl (CAP DEL), the model's least-tested path (D5, CN-21).
        for pn, sn, dr in itertools.product(["sasl", "a+sasl", "sasl|a"], ["none", "good", "bad"],
                                            ["afterLS", "afterACK", "midexchange"]):
            if sn == "none" and dr == "midexchange":
                continue
            yield {"name": f"{pn}/{sn}/after+drop-{dr}", "reqs": plans[pn],
                   "sasl": saslplans[sn], "end": "after", "drop": dr}
        # Services down before the client connects: does LS still list sasl?
        for pn, sn in itertools.product(["sasl", "a+sasl"], ["none", "good"]):
            yield {"name": f"{pn}/{sn}/after+drop-beforeConnect", "reqs": plans[pn],
                   "sasl": saslplans[sn], "end": "after", "drop": "beforeConnect"}


def main():
    host, port, out = sys.argv[1], int(sys.argv[2]), sys.argv[3]
    only = sys.argv[sys.argv.index("--only") + 1] if "--only" in sys.argv else None
    grep = sys.argv[sys.argv.index("--grep") + 1] if "--grep" in sys.argv else None
    global SETTLE, SVC, SERVICES
    if "--services" in sys.argv:
        h, p_ = sys.argv[sys.argv.index("--services") + 1].rsplit(":", 1)
        SVC = Services(h, int(p_))
        SVC.link()
        SERVICES = True
    if "--svc-down" in sys.argv:
        SVC = CmdServices(sys.argv[sys.argv.index("--svc-down") + 1],
                          sys.argv[sys.argv.index("--svc-up") + 1], host, port)
        SERVICES = True
    if "--settle" in sys.argv:
        SETTLE = float(sys.argv[sys.argv.index("--settle") + 1])
    n = 0
    with open(out, "w") as f:
        for s in schedules():
            if only and s["name"] != only:
                continue
            if grep and grep not in s["name"]:
                continue
            c = run(host, port, s)
            f.write(json.dumps(to_trace(c, s), default=sorted) + "\n")
            n += 1
    print(n, "schedules run")


if __name__ == "__main__":
    main()
