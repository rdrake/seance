#!/usr/bin/env python3
"""Standalone fake P10 services (svc.example.net) for running irctest against
nefarious2.  Like drive.Services, but the accounts come from a JSON file
({account: password}) re-read on every login, so a controller's
registerUser can add them, and the PLAIN response may be chunked
(400-byte AUTHENTICATE lines arrive as several C messages; a chunk shorter
than 400 bytes, or "+", ends it).  A mechanism other than PLAIN gets
`M PLAIN` and `D F`, as X3 does.

Usage: services_daemon.py HOST:PORT ACCOUNTS.json
"""
import base64, json, sys, time

import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import drive


class Daemon(drive.Services):
    def __init__(self, host, port, accounts):
        super().__init__(host, port)
        self.accounts, self.buf = accounts, {}

    def on(self, p):
        if len(p) > 4 and p[1] == "SASL":
            tok, sub = p[3], p[4]
            srv = tok.split("!")[0]
            if sub == "S":
                mech = p[5].lstrip(":") if len(p) > 5 else ""
                if mech.upper() != "PLAIN":
                    self.tx(f"SV SASL {srv} {tok} M PLAIN")
                    self.tx(f"SV SASL {srv} {tok} D F")
                    return
                self.buf[tok] = ""
                self.tx(f"SV SASL {srv} {tok} C +")
                return
            if sub == "C":
                chunk = p[5].lstrip(":") if len(p) > 5 else "+"
                if chunk != "+":
                    self.buf[tok] = self.buf.get(tok, "") + chunk
                if chunk != "+" and len(chunk) >= 400:
                    return                      # more to come
                data = self.buf.pop(tok, "")
                try:
                    parts = base64.b64decode(data, validate=True).split(b"\0")
                    acct, pw = parts[1].decode(), parts[2].decode()
                    ok = json.load(open(self.accounts)).get(acct) == pw and acct != ""
                except Exception:
                    ok = False
                if ok:
                    self.tx(f"SV SASL {srv} {tok} L {acct} {int(time.time())}")
                    self.tx(f"SV SASL {srv} {tok} D S")
                else:
                    self.tx(f"SV SASL {srv} {tok} D F")
                return
            if sub == "D":
                self.buf.pop(tok, None)
                return
        super().on(p)


def main():
    h, p = sys.argv[1].rsplit(":", 1)
    d = Daemon(h, int(p), sys.argv[2])
    d.link()
    print("linked", flush=True)
    while True:
        time.sleep(3600)


if __name__ == "__main__":
    main()
