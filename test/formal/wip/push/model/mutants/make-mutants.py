#!/usr/bin/env python3
"""Write the SpecPush mutants.  Each must FAIL its base config (which the
unmutated model passes).  Run make-configs.py in .. first.

  MU_SilentRelay   (R1DevLossy3) a WebKit worker closes on a relay and shows
                                 nothing -> RuleNeverRevoked
  MU_CloseAll      (R1Dev)       a relay closes its conversation's cards
                                 whatever their time -> RuleCloseOnlyRead
  MU_AlertRead     (R1Dev)       the worker shows a fresh card for a message
                                 it knows is read -> RuleNoAlertForRead
  MU_RelayAll      (R1Dev)       the server relays to the reader too
                                 -> RuleNoSelfRelay
  MU_NoSubGate     (R1R2Late)    per-subscription gate ignored
                                 -> RuleRelayWherePushed
  MU_OpenNoSweep   (R1Dev)       the opening app sweeps only stubs
                                 -> RuleOpenClean
"""
src = open('../SpecPush.tla').read()


def mut(name, base, *pairs):
    out = src
    for old, new in pairs:
        assert out.count(old) == 1, (name, old, out.count(old))
        out = out.replace(old, new)
    out = out.replace('MODULE SpecPush', 'MODULE ' + name, 1)
    open(name + '.tla', 'w').write(out)
    cfg = open('../%s.cfg' % base).read()
    open(name + '.cfg', 'w').write('\\* mutant %s on the constants of %s\n' % (name, base) + cfg)


mut('MU_SilentRelay', 'R1DevLossy3',
    ('    IN IF d \\in Strict \\/ (left = {} /\\ d \\notin open)\n'
     '       THEN [after |-> left \\cup {stub}, shown |-> TRUE]',
     '    IN IF d \\notin Strict /\\ left = {} /\\ d \\notin open\n'
     '       THEN [after |-> left \\cup {stub}, shown |-> TRUE]'))
mut('MU_CloseAll', 'R1Dev',
    ('    LET left == {y \\in cards[d] : ~(y.c = p.c /\\ y.n <= p.n)}',
     '    LET left == {y \\in cards[d] : y.c # p.c}'))
mut('MU_AlertRead', 'R1Dev',
    ('    IF p.n <= known[d][p.c]\n    THEN IF d \\in Strict',
     '    IF FALSE\n    THEN IF d \\in Strict'))
mut('MU_RelayAll', 'R1Dev',
    ('/\\ (RelayTo = "others" => e # w)', '/\\ TRUE'))
mut('MU_NoSubGate', 'R1R2Late',
    ('/\\ (OutPer = "sub" => outS[e][c])}', '/\\ TRUE}'))
mut('MU_OpenNoSweep', 'R1Dev',
    ('{x \\in @ : x.k = "msg" /\\ x.n > marker[x.c]}]\n    /\\ step\' = "open"',
     '{x \\in @ : x.k = "msg"}]\n    /\\ step\' = "open"'))
print('wrote 6 mutants')
