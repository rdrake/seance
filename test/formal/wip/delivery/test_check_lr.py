#!/usr/bin/env python3
"""Cases check_lr.py must reject or accept, from the D39 reviews.

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
        f.write(json.dumps({"server_label": "t", "echo": echo, "nicks": ["me"]}) + "\n")
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
    # second review
    ("echo from another sender",
     "@label=L PRIVMSG bob :hi", ["@label=L :bob!u@h PRIVMSG me :hi"], True, "case", True),
    ("one echo for a two-target message",
     "@label=L PRIVMSG bob,carol :hi", ["@label=L " + E], True, "case", True),
    ("self scene: ACK and only the delivered copy, echo on",
     "@label=L PRIVMSG me :hi", ["@label=L :s ACK", ":me!u@h PRIVMSG me :hi"],
     True, "privmsg-self", True),
    ("301 after the labeled batch closed",
     "@label=L PRIVMSG bob :hi",
     ["@label=L :s BATCH +o labeled-response", "@batch=o " + E, ":s BATCH -o",
      ":s 301 me bob :away"], True, "case", True),
    ("ACK after the labeled batch closed",
     "@label=L PRIVMSG bob :hi",
     ["@label=L :s BATCH +o labeled-response", "@batch=o " + E, ":s BATCH -o",
      ":s ACK"], True, "case", True),
    ("ACK in a nested batch beside the echo",
     "@label=L PRIVMSG bob :hi",
     ["@label=L :s BATCH +o labeled-response", "@batch=o " + E,
      "@batch=o :s BATCH +i example/x", "@batch=i :s ACK", "@batch=o :s BATCH -i",
      ":s BATCH -o"], True, "case", True),
    ("a line naming a closed batch",
     "@label=L PRIVMSG bob :hi",
     ["@label=L :s BATCH +o labeled-response", "@batch=o " + E, ":s BATCH -o",
      "@batch=o :s 301 me bob :away"], True, "case", True),
    ("a nested end tagged with the wrong batch",
     "@label=L PRIVMSG bob :hi",
     ["@label=L :s BATCH +o labeled-response", "@batch=o :s BATCH +i example/x",
      "@batch=i " + E, "@batch=i :s BATCH -i", ":s BATCH -o"], True, "case", True),
    ("a batch type that only ends in multiline",
     "@label=L BATCH +m draft/multiline bob",
     ["@label=L :me!u@h BATCH +i example.com/notmultiline bob", "@batch=i " + E,
      ":me!u@h BATCH -i"], True, "case", True),
    ("a multiline echo with a NOTICE to someone else",
     "@label=L BATCH +m draft/multiline bob",
     ["@label=L :me!u@h BATCH +i draft/multiline bob", "@batch=i " + E,
      "@batch=i :me!u@h NOTICE carol :x", ":me!u@h BATCH -i"], True, "case", True),
    ("two batched 301s with echo off",
     "@label=L PRIVMSG bob,carol :hi",
     ["@label=L :s BATCH +o labeled-response", "@batch=o :s 301 me bob :away",
      "@batch=o :s 301 me carol :away", ":s BATCH -o"], False, "case", False),
    ("an echo inside a nested labeled-response batch",
     "@label=L PRIVMSG bob :hi",
     ["@label=L :s BATCH +o labeled-response", "@batch=o :s BATCH +i labeled-response",
      "@batch=i " + E, "@batch=o :s BATCH -i", ":s BATCH -o"], True, "case", False),
    ("someone else's message in the same window",
     "@label=L PRIVMSG bob :hi", ["@label=L " + E, ":carol!u@h PRIVMSG me :hello"],
     True, "case", False),
    ("echoes to both targets and a 301",
     "@label=L PRIVMSG bob,#c :hi",
     ["@label=L :s BATCH +o labeled-response", "@batch=o " + E,
      "@batch=o :s 301 me bob :away", "@batch=o :me!u@h PRIVMSG #c :hi", ":s BATCH -o"],
     True, "case", False),
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
     ["@label=L :s BATCH +o labeled-response", "@batch=o :me!u@h BATCH +i draft/multiline bob",
      "@batch=i " + E, "@batch=o :me!u@h BATCH -i", "@batch=o :s 301 me bob :away",
      ":s BATCH -o"],
     True, "case", False),
    ("multiline echo labeled itself",
     "@label=L BATCH +m draft/multiline bob",
     ["@label=L :me!u@h BATCH +i draft/multiline bob", "@batch=i " + E, ":me!u@h BATCH -i"],
     True, "case", False),
    ("empty multiline batch is no echo",
     "@label=L BATCH +m draft/multiline bob",
     ["@label=L :me!u@h BATCH +i draft/multiline bob", ":me!u@h BATCH -i"], True, "case", True),
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
