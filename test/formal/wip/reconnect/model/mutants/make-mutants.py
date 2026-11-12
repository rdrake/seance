#!/usr/bin/env python3
"""Write the mutants of StsReconnect.tla and ConnectPath.tla, and their configs.

Run from here (model/mutants):  python3 make-mutants.py
Each mutant is its module with one or two exact replacements (each must match
exactly once), renamed MU_<name>; its config is the named base config of
../make-configs.py with only the property that must catch it. Appends the
runs to ../runs.txt is NOT done: the mutant list is runs-mutants.txt here.
"""
import os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
os.chdir(os.path.dirname(HERE))
import importlib.util
spec = importlib.util.spec_from_file_location('mc', 'make-configs.py')
mc = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mc)
os.chdir(HERE)

# name -> (module, base config, property that must catch it, [(old, new), ...], what it breaks)
MUT = {
    'PlainFallback': ('StsReconnect', 'Secure', 'RuleNoPlainDialWithPolicy',
        [('IF SeanceRetry THEN nw[n] ELSE Connected(nw[n]),',
          'IF nw[n].why \\in {"quick", "long"} THEN [nw[n] EXCEPT !.tls = FALSE, !.port = PlainPort] ELSE Connected(nw[n]),')],
        'a secure dial that failed is retried in plain under a valid policy (STS-7)'),
    'UpgradeLoop': ('StsReconnect', 'Upgrade', 'SessionStaysSecure',
        [('IF SeanceRetry THEN nw[n] ELSE Connected(nw[n]),',
          'IF nw[n].upg > 0 /\\ nw[n].why = "quick" THEN [nw[n] EXCEPT !.tls = FALSE, !.port = PlainPort] ELSE Connected(nw[n]),')],
        'after an upgrade whose secure dial failed, back to plain (STS-8, D9)'),
    'StorePlainDur': ('StsReconnect', 'Two', 'RulePolicyOnlyFromSecure',
        [("/\\ pol' = IF r.tls THEN PolLearn(r) ELSE pol\n                 /\\ act' = Act(\"ls\"",
          "/\\ pol' = PolLearn(r)\n                 /\\ act' = Act(\"ls\"")],
        'a duration read over plain is stored (STS-5)'),
    'PortOnSecure': ('StsReconnect', 'Upgrade', 'RulePortIgnoredOnSecure',
        [('IF ~r.tls /\\ srvUpg # NoPort\n            THEN Upgrade(n, srvUpg, LsFlush(n), "ls")',
          'IF srvUpg # NoPort /\\ r.port # srvUpg\n            THEN Upgrade(n, srvUpg, LsFlush(n), "ls")')],
        'a TLS connection follows port= to another port (STS-5)'),
    'IgnorePort': ('StsReconnect', 'Upgrade', 'RuleUpgradeWhenPort',
        [('IF ~r.tls /\\ srvUpg # NoPort\n            THEN Upgrade(n, srvUpg, LsFlush(n), "ls")',
          'IF FALSE\n            THEN Upgrade(n, srvUpg, LsFlush(n), "ls")')],
        'an upgrade policy over plain is not acted on (STS-12)'),
    'UpgradeOnDur': ('StsReconnect', 'Two', 'RuleIgnoreWithoutPort',
        [('IF ~r.tls /\\ srvUpg # NoPort\n            THEN Upgrade(n, srvUpg, LsFlush(n), "ls")',
          'IF ~r.tls /\\ (srvUpg # NoPort \\/ srvDur > 0)\n            THEN Upgrade(n, IF srvUpg # NoPort THEN srvUpg ELSE SavedPort, LsFlush(n), "ls")')],
        'a plain LS with a duration but no port upgrades (STS-4)'),
    'IgnoreZero': ('StsReconnect', 'Secure', 'RuleDurationZero',
        [('ELSE IF srvDur = 0 THEN [NoPol EXCEPT !.dur = 0]', 'ELSE IF srvDur = 0 THEN pol')],
        'duration=0 does not remove the policy (STS-14)'),
    'NoReset': ('StsReconnect', 'Secure', 'RuleResetExpiry',
        [('ELSE [has |-> TRUE, port |-> r.port, exp |-> now + srvDur, dur |-> srvDur]',
          'ELSE IF Valid(pol) THEN pol ELSE [has |-> TRUE, port |-> r.port, exp |-> now + srvDur, dur |-> srvDur]')],
        'a valid policy is not reset by a new duration (STS-13)'),
    'NoRescheduleClose': ('StsReconnect', 'Secure', 'RuleRescheduleOnClose',
        [('ELSE IF Valid(pol) \\/ (opened /\\ ~SeanceReschedule) THEN', 'ELSE IF FALSE THEN')],
        'no reschedule at any close (STS-18)'),
    'DelRemoves': ('StsReconnect', 'Upgrade', 'RuleIgnoreDel',
        [('/\\ act\' = Act("del", n, nw[n], "none", {})\n    /\\ UNCHANGED <<now, pol, ',
          '/\\ act\' = Act("del", n, nw[n], "none", {})\n    /\\ pol\' = NoPol\n    /\\ UNCHANGED <<now, ')],
        'CAP DEL sts removes the policy (STS-11)'),
    'PolicyKeepsPort': ('StsReconnect', 'Two', 'RulePolicyPort',
        [('THEN [r EXCEPT !.tls = TRUE, !.port = p.port, !.sTls = TRUE, !.sPort = p.port]',
          'THEN [r EXCEPT !.tls = TRUE, !.sTls = TRUE]')],
        'a policy upgrade switches the scheme but keeps the plain port, not the policy port (STS-1)'),
    'UpgradeBackoff': ('StsReconnect', 'Upgrade', 'RuleUpgradeNoPenalty',
        [('Wait(r, 0, "upgrade", 0, 0, FALSE)',
          'Wait(r, Base(Min(r.att + 1, AttCap)), "upgrade", Min(r.att + 1, AttCap), r.qf, FALSE)')],
        'the upgrade is charged as a failure (SC-9)'),
    'NoHold': ('StsReconnect', 'Schedule', 'RuleSpacing',
        [('{Wait(r, Unreached + j, "long", a1, q0, TRUE) : j \\in {0, UJit}}',
          '{Wait(r, Quick[1] + j, "long", a1, q0, TRUE) : j \\in {0, UJit}}')],
        'after the quick retries, no long wait (SC-4)'),
    'NoHoldStorm': ('StsReconnect', 'Schedule', 'NoStorm',
        [('{Wait(r, Unreached + j, "long", a1, q0, TRUE) : j \\in {0, UJit}}',
          '{Wait(r, Quick[1] + j, "long", a1, q0, TRUE) : j \\in {0, UJit}}')],
        'the same, caught by the dial count (SC-4)'),
    'CapLow': ('StsReconnect', 'Schedule', 'RuleCapFloor',
        [('d \\in {lo(b), b}', 'd \\in {b \\div 2, b}')],
        'jitter down to half the cap (SC-2)'),
    'NoThrottleWait': ('StsReconnect', 'Schedule', 'RuleThrottleWait',
        [('{Wait(r, Throttle, "throttle", a1, Len(Quick), TRUE)}',
          '{Wait(r, lo(Base(a1)), "throttle", a1, Len(Quick), TRUE)}')],
        "the server's throttle is not waited out (SC-5)"),
    'DisconnectRetry': ('StsReconnect', 'Secure', 'RuleDisconnectFinal',
        [('[r EXCEPT !.st = "closed", !.want = FALSE,', '[r EXCEPT !.st = "wait", !.want = FALSE,')],
        'a user disconnect leaves a retry scheduled (SC-8)'),
    'PokeKeepsAttempt': ('StsReconnect', 'Schedule', 'RuleAskRestarts',
        [('/\\ DoDial(n, [Connected(nw[n]) EXCEPT !.att = 0], "poke")',
          '/\\ DoDial(n, Connected(nw[n]), "poke")')],
        'the foreground poke keeps the built-up attempt count (SC-1)'),
    'AfterCapsAlways': ('StsReconnect', 'UpgradeSasl', 'RuleNothingAfterUpgrade',
        [('LsFlush(n) == IF ~SeanceStsAfterCaps THEN {}', 'LsFlush(n) == IF FALSE THEN {}')],
        'the CAP handler runs before checkSts (STS-12; the F2 code path as a mutant)'),
    'CPNoBudget': ('ConnectPath', 'CPHeld', 'BackgroundLeavesRoom',
        [('/\\ clock <= Max(0, Budget - c)', '/\\ clock <= Ceiling')],
        'background work ignores the budget (SC-13)'),
    'CPNoDeadline': ('ConnectPath', 'CPHeld', 'AutojoinBounded',
        [("/\\ timer' = now + Max(0, Min(Quiet, deadline - now))", "/\\ timer' = now + Quiet")],
        'signs of restoration extend the wait past the deadline (SC-14)'),
    'CPNoCancel': ('ConnectPath', 'CPHeld', 'NoAutojoinAfterClose',
        [('/\\ phase = "reg" /\\ restore = "wait" /\\ timer <= now', '/\\ restore = "wait" /\\ timer <= now'),
         ("restore' = IF restore = \"wait\" THEN \"none\" ELSE restore", "restore' = restore")],
        'the close leaves the restore timer armed (SC-14)'),
    'CPDoubleJoin': ('ConnectPath', 'CPHeld', 'AutojoinOnce',
        [('/\\ phase = "reg" /\\ restore = "wait"\n    /\\ Settle("batch")',
          '/\\ phase = "reg" /\\ restore # "none"\n    /\\ Settle("batch")')],
        'a batch after the timer joins again (SC-14)'),
    'CPPre001': ('ConnectPath', 'CPHeld', 'RuleNothingBefore001',
        [('    /\\ IF phase = "reg"\n         THEN /\\ users < MaxUser', '    /\\ IF phase # "closed"\n         THEN /\\ users < MaxUser')],
        'a timer-driven sender goes before 001 (SC-12)'),
    'CPJoinEarly': ('ConnectPath', 'CPHeld', 'AutojoinNotEarly',
        [('       IN IF Held\n', '       IN IF FALSE\n')],
        'the autojoin does not wait for a held session (SC-14)'),
}


def main():
    runs = []
    for name, (mod, base, prop, reps, _) in MUT.items():
        src = open(os.path.join('..', mod + '.tla')).read()
        for old, new in reps:
            n = src.count(old)
            assert n == 1, (name, n, old)
            src = src.replace(old, new)
        mname = 'MU_' + name
        src = src.replace('MODULE %s ' % mod, 'MODULE %s ' % mname, 1)
        open(mname + '.tla', 'w').write(src)
        _, consts, specname, inv, props, _, _, _ = mc.CFGS[base]
        kind = 'INVARIANT' if prop in mc.INV + mc.CP_INV else 'PROPERTY'
        out = ['\\* %s.cfg -- mutant of %s on %s: expected to FAIL %s' % (mname, mod, base, prop),
               '\\* written by make-mutants.py', 'SPECIFICATION ' + specname, 'CONSTANTS']
        for k in mc.constants(mod):
            v = consts[k]
            out.append('    %s = %s' % (k, mc.B(v) if isinstance(v, bool) else v))
        out += ['%s %s' % (kind, prop), 'CHECK_DEADLOCK FALSE']
        open(mname + '.cfg', 'w').write('\n'.join(out) + '\n')
        runs.append('%s %s fail %s' % (mname, mname, prop))
    open('runs-mutants.txt', 'w').write('\n'.join(runs) + '\n')
    print('%d mutants' % len(MUT))


if __name__ == '__main__':
    main()
