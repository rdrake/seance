"""Direct reproductions of N2, N3 and N6 on the testnet (nefarious2 a5911f29,
SASL_LOCAL via Keycloak).  Every line read is logged with its UTC receive
time, so it can be set against nefarious2's own log line
"SASL LOCAL: Keycloak became unreachable ... removing SASL".

  A  CAP LS 302, NICK/USER, no END: registration held open (N2 subject)
  R  CAP LS 302, REQ cap-notify, END: registered (N2 control: should get DEL)
  B  forces a token request with Keycloak stopped, so the server detects it
  C  after detection: LS 302, then REQ sasl (N3)
  D  plain CAP LS, no version (N6)
"""
import base64, datetime, socket, subprocess, sys, threading, time

HOST, PORT = "127.0.0.1", 26667
LOG = []


def now():
    return datetime.datetime.now(datetime.timezone.utc).strftime("%H:%M:%S.%f")[:-3]


class Conn:
    def __init__(self, tag):
        self.tag, self.lines, self.buf = tag, [], b""
        self.s = socket.create_connection((HOST, PORT))
        self.s.settimeout(0.2)
        self.stop = False
        threading.Thread(target=self.reader, daemon=True).start()

    def reader(self):
        while not self.stop:
            try:
                d = self.s.recv(65536)
            except socket.timeout:
                continue
            except OSError:
                return
            if not d:
                LOG.append((now(), self.tag, "<closed>"))
                return
            self.buf += d
            while b"\r\n" in self.buf:
                l, self.buf = self.buf.split(b"\r\n", 1)
                t = l.decode(errors="replace")
                self.lines.append(t)
                LOG.append((now(), self.tag, "<- " + t))
                if t.startswith("PING"):
                    self.send("PONG " + t.split(" ", 1)[1])

    def send(self, line):
        LOG.append((now(), self.tag, "-> " + line))
        self.s.sendall((line + "\r\n").encode())

    def wait(self, pred, secs):
        end = time.time() + secs
        while time.time() < end:
            if any(pred(l) for l in self.lines):
                return True
            time.sleep(0.1)
        return False

    def close(self):
        self.stop = True
        self.s.close()


def ls_has_sasl(c):
    return any(" LS " in l and "sasl" in l for l in c.lines)


def main():
    # 0. sasl must be advertised before we start.
    for _ in range(60):
        p = Conn("probe")
        p.send("CAP LS 302")
        p.wait(lambda l: " LS :" in l or " LS * :" in l, 4)
        time.sleep(0.5)
        ok = ls_has_sasl(p)
        p.close()
        if ok:
            break
        time.sleep(5)
    else:
        sys.exit("sasl never advertised")
    LOG.clear()

    # N6 first (no state needed): plain CAP LS.
    d = Conn("D")
    d.send("CAP LS")
    time.sleep(2)
    d.close()

    # N2 subject and control.
    a = Conn("A")
    a.send("CAP LS 302")
    a.send("NICK reproA")
    a.send("USER a 0 * :a")
    a.wait(lambda l: " LS :" in l, 5)
    r = Conn("R")
    r.send("CAP LS 302")
    r.send("CAP REQ :cap-notify")
    r.send("NICK reproR")
    r.send("USER r 0 * :r")
    r.send("CAP END")
    r.wait(lambda l: " 001 " in l, 15)

    # Take the backend down, then force a token request so the server notices.
    LOG.append((now(), "harness", "docker stop keycloak"))
    subprocess.run(["docker", "stop", "keycloak"], capture_output=True)
    LOG.append((now(), "harness", "keycloak stopped"))
    b = Conn("B")
    b.send("CAP LS 302")
    b.send("NICK reproB")
    b.send("USER b 0 * :b")
    b.wait(lambda l: " LS :" in l, 5)
    b.send("CAP REQ :sasl")
    b.wait(lambda l: " ACK " in l or " NAK " in l, 5)
    b.send("AUTHENTICATE PLAIN")
    b.wait(lambda l: l.startswith("AUTHENTICATE") or " 904 " in l, 10)
    cred = base64.b64encode(b"never-seen\0never-seen\0wrong").decode()
    b.send("AUTHENTICATE " + cred)
    b.wait(lambda l: " 90" in l, 40)
    time.sleep(3)

    # N3: a new client after detection.
    c = Conn("C")
    c.send("CAP LS 302")
    c.send("NICK reproC")
    c.send("USER c 0 * :c")
    c.wait(lambda l: " LS :" in l, 5)
    time.sleep(1)
    c.send("CAP REQ :sasl")
    c.wait(lambda l: " ACK " in l or " NAK " in l, 5)

    # Give A and R time to receive any DEL.
    time.sleep(10)
    LOG.append((now(), "harness", "docker start keycloak"))
    subprocess.run(["docker", "start", "keycloak"], capture_output=True)
    for x in (a, r, b, c):
        x.close()
    for t, tag, line in LOG:
        print(t, tag.ljust(7), line)


main()
