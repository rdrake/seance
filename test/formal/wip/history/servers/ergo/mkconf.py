#!/usr/bin/env python3
"""ERGO-SPECIFIC CONFIG NOTE (not part of the server-agnostic harness).

Writes the Ergo config the History server check ran against: Ergo's own
default.yaml with
  - one plain-TCP listener on 127.0.0.1:<port> (no TLS, no WebSocket);
  - fakelag off and the per-IP connection throttle off (the harness opens
    several connections and sends bursts on purpose);
  - login throttling off (unused unless --sasl is given);
  - history as in default.yaml: enabled, in-memory (persistent: off),
    channel-length 2048, chathistory-maxmessages 1000, autoreplay-on-join 0,
    query-cutoff none.  Nothing about history is changed.

Usage: mkconf.py ERGO_SRC_DIR OUT.yaml [PORT]
Then:  ergo initdb --conf OUT.yaml && ergo run --conf OUT.yaml
"""
import os, sys

src, out = sys.argv[1], sys.argv[2]
port = sys.argv[3] if len(sys.argv) > 3 else "16680"
t = open(os.path.join(src, "default.yaml")).read()


def sub(old, new):
    global t
    assert t.count(old) == 1, (old, t.count(old))
    t = t.replace(old, new)


sub('''        "127.0.0.1:6667": # (loopback ipv4, localhost-only)
        "[::1]:6667":     # (loopback ipv6, localhost-only)''',
    f'''        "127.0.0.1:{port}":''')
# drop the TLS listener on :6697 (no certificate here)
i = t.index('        ":6697":')
j = t.index("min-tls-version: 1.2", i) + len("min-tls-version: 1.2")
t = t[:i] + t[j:]
sub("fakelag:\n    # whether to enforce fakelag\n    enabled: true",
    "fakelag:\n    # whether to enforce fakelag\n    enabled: false")
i = t.index("    ip-limits:")
j = t.index("        throttle: true", i)
t = t[:j] + "        throttle: false" + t[j + len("        throttle: true"):]
sub("    login-throttling:\n        enabled: true", "    login-throttling:\n        enabled: false")
sub("    client-throttle:\n        enabled: true", "    client-throttle:\n        enabled: false")
sub("    path: ircd.db", f"    path: {os.path.splitext(os.path.abspath(out))[0]}.db")
sub("    path: languages", f"    path: {os.path.join(os.path.abspath(src), 'languages')}")
open(out, "w").write(t)
print("wrote", out)
