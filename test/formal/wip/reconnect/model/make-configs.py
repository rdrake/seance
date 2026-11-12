#!/usr/bin/env python3
"""Write the .cfg files of StsReconnect.tla and ConnectPath.tla, and check them.

Run from here:  python3 make-configs.py
It writes the limited configs (run now), the comprehensive ones (labelled,
not for now), one W_*.cfg per witness and one Seance*.cfg per Seance switch,
and checks that every config assigns every CONSTANT of its module and names
only operators the module defines. It runs no model checker. The list of
what to run, and what each run should report, is written to `runs.txt`
(`<module> <config> <pass|fail> [property]`).
"""
import re, sys

SRC = {m: open(m + '.tla').read() for m in ('StsReconnect', 'ConnectPath')}


def constants(m):
    block = SRC[m].split('CONSTANTS', 1)[1].split('\n\n', 1)[0]
    block = re.sub(r'\\\*.*', '', block)
    return re.findall(r'\b([A-Z][A-Za-z0-9]*)\b', block)


def defined(m, name):
    return re.search(r'^%s(\(.*\))?\s*==' % re.escape(name), SRC[m], re.M) is not None


S = lambda *xs: '{' + ', '.join('"%s"' % x for x in xs) + '}'
B = lambda b: 'TRUE' if b else 'FALSE'

# --- StsReconnect -----------------------------------------------------------
# The scaled schedule (D4): Unreached > Window, lo(Cap) > Window, Stable < Window.
SCALED = dict(Init=1, Cap=6, NQuick=2, Unreached=5, UJit=1, Stable=3, Throttle=5,
              Window=4, IpLimit=3, IpCountRefusals=True)
# The real one, in seconds (TR:116-140, 532-543; IL:35).
REAL = dict(Init=1, Cap=60, NQuick=3, Unreached=42, UJit=5, Stable=30, Throttle=42,
            Window=40, IpLimit=4, IpCountRefusals=True)


def lo(b):
    return (3 * b + 3) // 4


def bound(sch):
    """D12: the longest wait after a quiet start, then an IPcheck refusal's
    quick retries and the long wait after them, plus a unit for each dial."""
    quick = [2 ** i for i in range(sch['NQuick'])]
    longest = max(sch['Cap'], sch['Unreached'] + sch['UJit'], sch['Throttle'], max(quick))
    return longest + sum(quick) + sch['Unreached'] + sch['UJit'] + len(quick) + 2


SW = dict(SeanceRetry=False, SeanceStsAfterCaps=False, SeanceReschedule=False)

def base(**kw):
    d = dict(Nets=S('n1'), PlainNets='{}', SaslNets='{}', SecPorts=S('S1', 'S2'),
             SavedPort='"S1"', Durs='{0, 4}', InitUpg='"none"', InitDur='{}', MaxTime=10,
             EnvKinds='{}', MaxEnv=0, **SCALED)
    d.update(SW)
    d.update(kw)
    d.setdefault('Bound', bound({k: d[k] for k in SCALED}))
    return d

BASE = {
    # Upgrade policy over plain: port changes, the secure port failing, NEW/DEL,
    # duration changes, a reload of the plain saved network.
    'Upgrade': base(PlainNets=S('n1'), InitUpg='"S1"', InitDur='{4}', MaxTime=12,
                    EnvKinds=S('drop', 'port', 'upg', 'dur', 'new', 'del', 'reload'), MaxEnv=4),
    # Persistence policy over TLS: expiry, reset, duration 0, reschedule on
    # every kind of close, throttle, the user, a reload.
    'Secure': base(InitDur='{4}', MaxTime=12,
                   EnvKinds=S('drop', 'throttle', 'user', 'dur', 'new', 'reload', 'port'), MaxEnv=4),
    # The reconnect schedule alone: drops, the network going down, IPcheck,
    # the poke, the server's throttle. ReconnectsWithin is live here.
    'Schedule': base(MaxTime=24, EnvKinds=S('drop', 'net', 'ip', 'poke', 'throttle'), MaxEnv=4),
    # Two networks on one host, one ws:// one wss:// (D1, D6).
    'Two': base(Nets=S('n1', 'n2'), PlainNets=S('n1'), InitDur='{4}', MaxTime=10,
                EnvKinds=S('drop', 'dur', 'new', 'user', 'reload'), MaxEnv=3),
    # Two secure networks sharing IPcheck's chain.
    'TwoIp': base(Nets=S('n1', 'n2'), MaxTime=20, EnvKinds=S('drop', 'net', 'ip'), MaxEnv=2),
}
BASE['UpgradeSasl'] = dict(BASE['Upgrade'], SaslNets=S('n1'))
# Comprehensive: NOT for now.
BASE['Reference'] = base(Nets=S('n1', 'n2'), PlainNets=S('n1'), SaslNets=S('n2'),
                         InitUpg='"S1"', InitDur='{4}', MaxTime=24, MaxEnv=5,
                         EnvKinds=S('drop', 'throttle', 'user', 'poke', 'net', 'port', 'ip',
                                    'upg', 'dur', 'new', 'del', 'reload'))
BASE['RefReal'] = dict(base(Nets=S('n1'), PlainNets=S('n1'), InitUpg='"S1"', InitDur='{600}',
                            Durs='{0, 600}', MaxTime=400, MaxEnv=4,
                            EnvKinds=S('drop', 'throttle', 'net', 'port', 'ip', 'dur', 'reload')),
                       **REAL)
BASE['RefReal']['Bound'] = bound(REAL)
# Two networks (or tabs) on one address at the real scale: IPcheck's chain (D11).
BASE['TwoIpReal'] = dict(base(Nets=S('n1', 'n2'), MaxTime=200, EnvKinds=S('drop', 'ip'), MaxEnv=3),
                         **REAL)
BASE['TwoIpReal']['Bound'] = bound(REAL)
# The same with FEAT_IPCHECK_COUNT_REFUSALS off: a refusal leaves no trace.
BASE['TwoIpRealNoCount'] = dict(BASE['TwoIpReal'], IpCountRefusals=False)
BASE['TwoIpNoCount'] = dict(BASE['TwoIp'], IpCountRefusals=False)

INV = ['TypeOK', 'SessionStaysSecure', 'UpgradeOncePerSession', 'RuleCapFloor',
       'RuleSpacing', 'RuleThrottleWait', 'NoStorm', 'ReconnectsWithin']
PROP = ['RuleNoPlainDialWithPolicy', 'RulePolicyPort', 'RuleUpgradeToPort',
        'RulePortIgnoredOnSecure', 'RuleIgnoreWithoutPort', 'RuleUpgradeWhenPort', 'RuleNothingAfterUpgrade',
        'UpgradeBeforeRegistration', 'RuleUpgradeNoPenalty', 'RulePolicyOnlyFromSecure',
        'RuleSecureNoDurKeeps', 'RuleResetExpiry', 'RuleDurationZero', 'RuleIgnoreDel',
        'RuleRescheduleOnClose', 'RuleDisconnectFinal', 'RuleAskRestarts']
LIMITED = ['Upgrade', 'UpgradeSasl', 'Secure', 'Schedule', 'Two', 'TwoIpNoCount']
# Two dialers on one address with refusals counted: ReconnectsWithin fails
# (finding F5), so these check everything else, and Lockout* expect the failure.
SHARED = ['TwoIp']

# name -> (module, constants, spec, invariants, properties, header, expect, property-to-fail)
CFGS = {}
for b in LIMITED:
    CFGS[b] = ('StsReconnect', BASE[b], 'Spec', INV, PROP, 'LIMITED run (now)', 'pass', None)
for b in SHARED:
    CFGS[b] = ('StsReconnect', BASE[b], 'Spec', [i for i in INV if i != 'ReconnectsWithin'], PROP,
               'LIMITED run (now): ReconnectsWithin left to Lockout%s' % b, 'pass', None)
    CFGS['Lockout' + b] = ('StsReconnect', BASE[b], 'Spec', ['ReconnectsWithin'], [],
                           'LIMITED: expected to FAIL ReconnectsWithin (F5)', 'fail', 'ReconnectsWithin')
# Real scale, two dialers: too big for a limited run (over 60M states at 9 min).
CFGS['LockoutTwoIpReal'] = ('StsReconnect', BASE['TwoIpReal'], 'Spec', ['ReconnectsWithin'], [],
                            'COMPREHENSIVE: not for now; expected to FAIL ReconnectsWithin (F5)',
                            'fail', 'ReconnectsWithin')
CFGS['TwoIpRealNoCount'] = ('StsReconnect', BASE['TwoIpRealNoCount'], 'Spec', INV, PROP,
                            'COMPREHENSIVE: not for now', 'pass', None)
for b in ('Reference', 'RefReal'):
    CFGS[b] = ('StsReconnect', BASE[b], 'Spec', INV, PROP, 'COMPREHENSIVE: not for now',
               'pass', None)

# The Seance switches: each must fail its property (findings F1-F4) ...
SEANCE = {
    'SeanceRetry': ('Two', dict(SeanceRetry=True), 'RuleNoPlainDialWithPolicy'),
    'SeanceAfterCaps': ('Upgrade', dict(SeanceStsAfterCaps=True), 'UpgradeBeforeRegistration'),
    'SeanceAfterCapsSasl': ('UpgradeSasl', dict(SeanceStsAfterCaps=True), 'RuleNothingAfterUpgrade'),
    'SeanceReschedule': ('Secure', dict(SeanceReschedule=True), 'RuleRescheduleOnClose'),
    # F3 alone: no reload, so only an expired policy at a close can fail it.
    'SeanceRescheduleExpired': ('Secure', dict(SeanceReschedule=True,
                                               EnvKinds=S('drop', 'throttle', 'user', 'dur', 'new', 'port')),
                                'RuleRescheduleOnClose'),
}
for name, (b, sw, prop) in SEANCE.items():
    kind = 'invariants' if prop in INV else 'properties'
    CFGS[name] = ('StsReconnect', dict(BASE[b], **sw), 'Spec', [], [prop],
                  'Seance switch: expected to FAIL %s' % prop, 'fail', prop)
# ... and everything else must hold with every switch on.
FAILS = {'RuleNoPlainDialWithPolicy', 'UpgradeBeforeRegistration', 'RuleNothingAfterUpgrade',
         'RuleRescheduleOnClose', 'RulePolicyPort'}
ALLSW = dict(SeanceRetry=True, SeanceStsAfterCaps=True, SeanceReschedule=True)
for b in LIMITED:
    CFGS['SeanceRest' + b] = ('StsReconnect', dict(BASE[b], **ALLSW), 'Spec', INV,
                              [p for p in PROP if p not in FAILS],
                              'LIMITED: every Seance switch on, the other properties', 'pass', None)
# With SASL the upgrade's flush has no CAP END: UpgradeBeforeRegistration holds.
CFGS['SeanceAfterCapsSaslEnd'] = ('StsReconnect', dict(BASE['UpgradeSasl'], SeanceStsAfterCaps=True),
                                  'Spec', [], ['UpgradeBeforeRegistration'],
                                  'LIMITED: SASL holds CAP END back', 'pass', None)

WIT = {
    'W_UpgradeRegistered': 'Upgrade', 'W_PolicyDial': 'Two', 'W_ExpiredPlain': 'Two',
    'W_DurZero': 'Secure', 'W_NewDur': 'Secure', 'W_PortChange': 'Upgrade',
    'W_NoFallback': 'Upgrade', 'W_UpgradeFailsSecure': 'Upgrade', 'W_Throttled': 'Schedule',
    'W_QuickThenHold': 'Schedule', 'W_StableAtOnce': 'Schedule', 'W_CapWait': 'Schedule',
    'W_IpRefused': 'TwoIp', 'W_CancelWait': 'Secure', 'W_Reschedule': 'Secure',
    'W_RescheduleExpired': 'Secure', 'W_TwoNets': 'Two', 'W_SavedUpgrade': 'Upgrade',
    'W_Poke': 'Schedule', 'W_UpgradeByNew': 'Upgrade', 'W_Reconnected': 'Schedule',
}
for w, b in WIT.items():
    CFGS[w] = ('StsReconnect', BASE[b], 'Spec', [w], [], 'witness: expected to FAIL (%s)' % w,
               'fail', w)

# --- ConnectPath --------------------------------------------------------------
CP = dict(MaxTime=12, Costs='{2, 3}', Budget=4, Ceiling=10, UserMax=3, MaxBg=3, MaxUser=3,
          Wait=2, Quiet=1, MaxWait=8, Held='TRUE', MaxActivity=3)
CP_INV = ['CPTypeOK', 'BackgroundLeavesRoom', 'UserLinesParsed', 'AutojoinOnce',
          'AutojoinBounded']
CP_PROP = ['RuleNothingBefore001', 'AutojoinNotEarly', 'NoAutojoinAfterClose']
CFGS['CPHeld'] = ('ConnectPath', CP, 'CPSpec', CP_INV, CP_PROP, 'LIMITED run (now)', 'pass', None)
CFGS['CPNotHeld'] = ('ConnectPath', dict(CP, Held='FALSE'), 'CPSpec', CP_INV, CP_PROP,
                     'LIMITED run (now)', 'pass', None)
CFGS['CPReal'] = ('ConnectPath', dict(CP, MaxTime=40, Wait=20, Quiet=8, MaxWait=80, Costs='{2, 3, 6}',
                                      MaxBg=6, MaxActivity=6),
                  'CPSpec', CP_INV, CP_PROP, 'COMPREHENSIVE: not for now (real waits)', 'pass', None)
for w in ['W_CPBatchJoin', 'W_CPTimerJoin', 'W_CPDeadline', 'W_CPDeferred', 'W_CPBgWaited',
          'W_CPClosedWaiting']:
    CFGS[w] = ('ConnectPath', CP, 'CPSpec', [w], [], 'witness: expected to FAIL (%s)' % w,
               'fail', w)


def render(name):
    mod, consts, spec, inv, props, note, _, _ = CFGS[name]
    missing = set(constants(mod)) - set(consts)
    extra = set(consts) - set(constants(mod))
    assert not missing and not extra, (name, missing, extra)
    for op in [spec] + inv + props:
        assert defined(mod, op), (name, op)
        if op in inv:
            assert '[]' not in re.search(r'^%s\s*==(.*?)(?=^\S|\Z)' % op, SRC[mod],
                                         re.M | re.S).group(1), (name, op, 'temporal as invariant')
    out = ['\\* %s.cfg for %s.tla -- %s' % (name, mod, note), '\\* written by make-configs.py',
           'SPECIFICATION ' + spec, 'CONSTANTS']
    for k in constants(mod):
        v = consts[k]
        v = B(v) if isinstance(v, bool) else v
        out.append('    %s = %s' % (k, v))
    out += ['INVARIANT ' + i for i in inv] + ['PROPERTY ' + p for p in props]
    out.append('CHECK_DEADLOCK FALSE')
    return '\n'.join(out) + '\n'


def main():
    runs = []
    for name in CFGS:
        open(name + '.cfg', 'w').write(render(name))
        mod, _, _, _, _, note, expect, prop = CFGS[name]
        if 'COMPREHENSIVE' in note:
            continue
        runs.append('%s %s %s%s' % (mod, name, expect, ' ' + prop if prop else ''))
    open('runs.txt', 'w').write('\n'.join(runs) + '\n')
    print('%d configs, %d limited runs' % (len(CFGS), len(runs)))


if __name__ == '__main__':
    main()
