"""Minimal IRCv3 client for the History server check (stdlib only).

Server-agnostic: plain TCP or TLS, optional server password, optional SASL
PLAIN.  Requests only the caps the check needs, and only those the server
offers (CAP LS 302).  Never requests draft/event-playback (D3).
"""
import base64, select, socket, ssl, time

WANT = ["batch", "server-time", "message-tags", "echo-message", "labeled-response",
        "draft/chathistory", "chathistory", "draft/labeled-response-0.2", "sasl"]


def unescape_tag(v):
    out, i = [], 0
    while i < len(v):
        c = v[i]
        if c == "\\" and i + 1 < len(v):
            n = v[i + 1]
            out.append({":": ";", "s": " ", "\\": "\\", "r": "\r", "n": "\n"}.get(n, n))
            i += 2
        else:
            out.append(c)
            i += 1
    return "".join(out)


def parse(line):
    """-> dict(tags, source, cmd, params).  Tag values unescaped; a tag
    without a value maps to ""."""
    tags, source, rest = {}, None, line
    if rest.startswith("@"):
        t, rest = rest[1:].split(" ", 1)
        for kv in t.split(";"):
            if not kv:
                continue
            k, _, v = kv.partition("=")
            tags[k] = unescape_tag(v)
        rest = rest.lstrip(" ")
    if rest.startswith(":"):
        source, rest = rest[1:].split(" ", 1)
        rest = rest.lstrip(" ")
    params = []
    while rest:
        if rest.startswith(":"):
            params.append(rest[1:])
            break
        p, _, rest = rest.partition(" ")
        params.append(p)
        rest = rest.lstrip(" ")
    cmd = params.pop(0).upper() if params else ""
    return {"tags": tags, "source": source, "cmd": cmd, "params": params}


class Conn:
    def __init__(self, host, port, nick, tls=False, insecure=False, sni=None,
                 password=None, sasl=None, timeout=15.0, log=None):
        self.nick = nick
        self.buf = b""
        self.log = log
        self.timeout = timeout
        raw = socket.create_connection((host, port), timeout=timeout)
        if tls:
            ctx = ssl.create_default_context()
            if insecure:
                ctx.check_hostname = False
                ctx.verify_mode = ssl.CERT_NONE
            raw = ctx.wrap_socket(raw, server_hostname=sni or host)
        self.sock = raw
        self.caps, self.isupport, self.offered = set(), {}, {}
        self._register(password, sasl)

    # -- raw io
    def send(self, *lines):
        data = "".join(l + "\r\n" for l in lines).encode()
        self.sock.sendall(data)

    def readline(self, timeout=None):
        """Next line or None on timeout."""
        deadline = time.monotonic() + (self.timeout if timeout is None else timeout)
        while b"\r\n" not in self.buf and b"\n" not in self.buf:
            left = deadline - time.monotonic()
            if left <= 0:
                return None
            r, _, _ = select.select([self.sock], [], [], left)
            if not r and not (isinstance(self.sock, ssl.SSLSocket) and self.sock.pending()):
                return None
            chunk = self.sock.recv(65536)
            if not chunk:
                raise ConnectionError(f"{self.nick}: connection closed")
            self.buf += chunk
        line, _, self.buf = self.buf.partition(b"\n")
        line = line.rstrip(b"\r").decode("utf-8", "replace")
        m = parse(line)
        if m["cmd"] == "PING" and m["source"] is None:
            self.send("PONG :" + (m["params"][-1] if m["params"] else ""))
        return line

    def until(self, pred, timeout=None):
        """Read lines until pred(parsed) is true.  Returns (lines, last)."""
        got = []
        deadline = time.monotonic() + (self.timeout if timeout is None else timeout)
        while True:
            l = self.readline(max(0.0, deadline - time.monotonic()))
            if l is None:
                raise TimeoutError(f"{self.nick}: timeout; last lines: {got[-5:]}")
            got.append(l)
            m = parse(l)
            if pred(m):
                return got, m

    # -- registration
    def _register(self, password, sasl):
        if password:
            self.send("PASS " + password)
        self.send("CAP LS 302", f"NICK {self.nick}", f"USER {self.nick} 0 * :{self.nick}")
        while True:
            _, m = self.until(lambda m: m["cmd"] in ("CAP", "001", "433", "ERROR"))
            if m["cmd"] in ("001", "433", "ERROR"):
                raise RuntimeError(f"{self.nick}: unexpected {m}")
            if len(m["params"]) >= 3 and m["params"][1] == "LS":
                more = m["params"][2] == "*"
                for tok in m["params"][-1].split():
                    k, _, v = tok.partition("=")
                    self.offered[k] = v
                if not more:
                    break
        want = [c for c in WANT if c in self.offered and (c != "sasl" or sasl)]
        # prefer the final labeled-response name when both are offered
        if "labeled-response" in want and "draft/labeled-response-0.2" in want:
            want.remove("draft/labeled-response-0.2")
        if "chathistory" in want and "draft/chathistory" in want:
            want.remove("chathistory")
        self.send("CAP REQ :" + " ".join(want))
        _, m = self.until(lambda m: m["cmd"] == "CAP" and len(m["params"]) >= 2 and m["params"][1] in ("ACK", "NAK"))
        if m["params"][1] == "NAK":
            raise RuntimeError(f"{self.nick}: CAP NAK {m['params'][-1]}")
        self.caps = set(m["params"][-1].split())
        if sasl and "sasl" in self.caps:
            acct, _, pw = sasl.partition(":")
            self.send("AUTHENTICATE PLAIN")
            self.until(lambda m: m["cmd"] == "AUTHENTICATE")
            tok = base64.b64encode(f"{acct}\0{acct}\0{pw}".encode()).decode()
            self.send("AUTHENTICATE " + tok)
            _, m = self.until(lambda m: m["cmd"] in ("903", "904", "905", "906", "902"))
            if m["cmd"] != "903":
                raise RuntimeError(f"{self.nick}: SASL failed: {m}")
        self.send("CAP END")
        _, m = self.until(lambda m: m["cmd"] in ("001", "433", "ERROR", "432"))
        if m["cmd"] != "001":
            raise RuntimeError(f"{self.nick}: registration failed: {m}")
        self.nick = m["params"][0]
        lines, _ = self.until(lambda m: m["cmd"] in ("376", "422"), timeout=30)
        for l in lines:
            m = parse(l)
            if m["cmd"] == "005":
                for tok in m["params"][1:-1]:
                    k, _, v = tok.partition("=")
                    self.isupport[k] = v

    def sync(self, token, timeout=None):
        """PING the server and collect every line up to its PONG."""
        self.send(f"PING :{token}")
        lines, _ = self.until(lambda m: m["cmd"] == "PONG" and m["params"] and m["params"][-1] == token,
                              timeout)
        return lines[:-1]

    def close(self):
        try:
            self.send("QUIT :done")
            self.sock.close()
        except OSError:
            pass
