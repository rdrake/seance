#!/usr/bin/env python3
"""Write the v4 mutants of ../SpecHandshake.tla into this directory.

Run from here:  python3 make-mutants.py, then for each mutant
  java -cp tla2tools.jar tlc2.TLC -workers 8 -config <cfg> <Mutant>.tla
Expected (each must FAIL; the unmutated model passes the same config):
  M1Discard  (M1.cfg)              SrvAnswer silently drops a REQ    -> RuleAckWhole
  M2Owe      (M2.cfg)              reauth opener clears owed 903     -> SuccAccounting
  M6NoInc    (M2.cfg)              success owes no 903               -> SuccAccounting
  M7WrongRest (DelSplitSafety.cfg) split's last part lists wrong caps -> RuleAckWhole
  M8NoAbort906 (Tiny.cfg)          an abort mid-exchange gets no 906  -> Rule906
  M3Overlap  (OverlapSafety.cfg)   client pipelines overlapping REQs -> CapsAgree (D17)
  M4NoDel    (DelSplitSafety.cfg)  client ignores DEL inside a split -> CapsAgree (D18)
  M5SrvNoDel (DelSplitSafety.cfg)  server ignores DEL inside a split -> TypeOK (D18)
"""
src = open('../SpecHandshake.tla').read()
def mut(name, old, new):
    assert src.count(old) == 1, (name, src.count(old))
    open(name + '.tla', 'w').write(
        src.replace(old, new).replace('MODULE SpecHandshake', 'MODULE ' + name))
mut('M1Discard', "         \\/ /\\ ~Ackable(R) \\/ (ArbitraryNak",
    "         \\/ /\\ sout' = sout /\\ srv' = [srv EXCEPT !.inbox = rest] /\\ gh' = ghI\n"
    "         \\/ /\\ ~Ackable(R) \\/ (ArbitraryNak")
mut('M2Owe', "                 /\\ srv' = [srv EXCEPT !.sasl = \"await\"]\n    ELSE IF",
    "                 /\\ srv' = [srv EXCEPT !.sasl = \"await\", !.owe903 = 0]\n    ELSE IF")
mut('M3Overlap', "/\\ \\A k \\in DOMAIN cli.pend : R \\cap cli.pend[k].R = {}", "/\\ TRUE")
mut('M4NoDel', "!.enabled = @ \\cup (p.R \\ p.del),", "!.enabled = @ \\cup p.R,")
mut('M5SrvNoDel', "[@[k] EXCEPT !.commit = @ \\ {c}]", "@[k]")
mut('M6NoInc', "!.owe900 = @ + 1, !.owe903 = @ + 1,", "!.owe900 = @ + 1,")
mut('M7WrongRest', "sout' = Append(sout, Msg(\"ACK\", p.rest, FALSE))", "sout' = Append(sout, Msg(\"ACK\", p.commit, FALSE))")
mut('M8NoAbort906', "       THEN /\\ sout' = Append(sout, M(\"906\"))             \\* S1-10",
    "       THEN /\\ sout' = sout")
