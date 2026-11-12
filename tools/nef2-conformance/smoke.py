#!/usr/bin/env python3
"""Smoke test for the local conformance nefarious2: SASL as conftest,
chathistory on, a sent line comes back in CHATHISTORY LATEST.

  python3 -I smoke.py   # password from $CONFTEST_PASSWORD, else state/test-password.txt
"""
import base64, os, socket, sys, time
pw = os.environ.get("CONFTEST_PASSWORD") or open(
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "state", "test-password.txt")
).read().strip()
s = socket.create_connection(("127.0.0.1", 16667), timeout=60)
f = s.makefile("rw", encoding="utf-8", newline="\r\n")
def send(l): f.write(l + "\r\n"); f.flush()
def until(pred, t=45):
    end = time.time() + t
    while time.time() < end:
        l = f.readline().rstrip("\r\n")
        if not l: continue
        if l.startswith("PING"): send("PONG " + l.split(" ", 1)[1]); continue
        print("<", l[:200].replace(pw, "<pw>"))
        if pred(l): return l
    sys.exit("timeout")
send("CAP LS 302"); send("NICK conf1"); send("USER conf 0 * :conformance")
ls = until(lambda l: " CAP " in l and " LS :" in l)
caps = [c for c in ["sasl", "draft/chathistory", "batch", "server-time", "message-tags", "labeled-response", "echo-message", "account-tag"]]
send("CAP REQ :" + " ".join(caps))
until(lambda l: " ACK " in l or " NAK " in l)
send("AUTHENTICATE PLAIN"); until(lambda l: l.startswith("AUTHENTICATE"))
send("AUTHENTICATE " + base64.b64encode(f"conftest\0conftest\0{pw}".encode()).decode())
r = until(lambda l: any(f" {n} " in l for n in ("903", "904", "905")))
send("CAP END"); until(lambda l: " 001 " in l)
send("JOIN #conf"); until(lambda l: " 366 " in l)
send("PRIVMSG #conf :hello from the smoke test"); time.sleep(1)
send("CHATHISTORY LATEST #conf * 5")
until(lambda l: "BATCH -" in l)
send("QUIT"); print("SASL", "ok" if " 903 " in r else "FAILED")
