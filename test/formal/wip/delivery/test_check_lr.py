#!/usr/bin/env python3
"""Cases check_lr.py must reject or accept, from the D33 review.

    python3 test_check_lr.py
"""
import json
import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import check_lr  # noqa: E402


def run(sent, recv, echo, name="case"):
    with tempfile.NamedTemporaryFile("w", suffix=".jsonl", delete=False) as f:
        f.write(json.dumps({"server_label": "t", "echo": echo}) + "\n")
        f.write(json.dumps({"name": name, "shape": "x", "label": "L",
                            "sent": sent, "recv": recv}) + "\n")
    try:
        return check_lr.check(f.name)[1][0][3]
    finally:
        os.unlink(f.name)


E = ":me!u@h PRIVMSG bob :hi"
CASES = [
    # (what, sent, recv, echo, scene, must fail)
    ("NOTICE ACK outside a drop scene, echo on",
     "@label=L NOTICE bob :hi", ["@label=L :s ACK"], True, "case", True),
    ("NOTICE ACK in the moderated scene, echo on",
     "@label=L NOTICE #m :hi", ["@label=L :s ACK"], True, "notice-chan-moderated", False),
    ("empty nested batch is no echo",
     "@label=L PRIVMSG bob :hi",
     ["@label=L :s BATCH +o labeled-response", "@batch=o :s BATCH +i example/empty",
      "@batch=o :s BATCH -i", ":s BATCH -o"], True, "case", True),
    ("labeled batch never ends",
     "@label=L PRIVMSG bob :hi",
     ["@label=L :s BATCH +o labeled-response", "@batch=o " + E], True, "case", True),
    ("ACK inside a labeled batch",
     "@label=L PRIVMSG bob :hi",
     ["@label=L :s BATCH +o labeled-response", "@batch=o :s ACK",
      "@batch=o :s 301 me bob :away", ":s BATCH -o"], False, "case", True),
    ("member after the batch closed",
     "@label=L PRIVMSG bob :hi",
     ["@label=L :s BATCH +o labeled-response", "@batch=o :s 301 me bob :away",
      ":s BATCH -o", "@batch=o " + E], True, "case", True),
    ("two unbatched 301s for two targets",
     "@label=L PRIVMSG bob,carol :hi",
     ["@label=L :s 301 me bob :away", ":s 301 me carol :away"], False, "case", True),
    ("a non-301 numeric does not accept",
     "@label=L PRIVMSG bob :hi", ["@label=L :s 276 me bob :cert"], False, "case", True),
    # accepted shapes
    ("lone labeled echo", "@label=L PRIVMSG bob :hi", ["@label=L " + E], True, "case", False),
    ("lone 301 accepts with echo off",
     "@label=L PRIVMSG bob :hi", ["@label=L :s 301 me bob :away"], False, "case", False),
    ("echo and 301 in a closed batch",
     "@label=L PRIVMSG bob :hi",
     ["@label=L :s BATCH +o labeled-response", "@batch=o " + E,
      "@batch=o :s 301 me bob :away", ":s BATCH -o"], True, "case", False),
    ("multiline echo nested in a labeled batch",
     "@label=L BATCH +m draft/multiline bob",
     ["@label=L :s BATCH +o labeled-response", "@batch=o :me BATCH +i draft/multiline bob",
      "@batch=i " + E, ":me BATCH -i", "@batch=o :s 301 me bob :away", ":s BATCH -o"],
     True, "case", False),
    ("multiline echo labeled itself",
     "@label=L BATCH +m draft/multiline bob",
     ["@label=L :me BATCH +i draft/multiline bob", "@batch=i " + E, ":me BATCH -i"],
     True, "case", False),
    ("empty multiline batch is no echo",
     "@label=L BATCH +m draft/multiline bob",
     ["@label=L :me BATCH +i draft/multiline bob", ":me BATCH -i"], True, "case", True),
]


def main():
    bad = 0
    for what, sent, recv, echo, scene, must_fail in CASES:
        fails = run(sent, recv, echo, scene)
        ok = bool(fails) == must_fail
        bad += not ok
        print(f"{'ok  ' if ok else 'BAD '} {what}: {fails or 'holds'}")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
