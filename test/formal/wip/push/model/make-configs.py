#!/usr/bin/env python3
"""Write SpecPush's configs: limited runs (now), witnesses, and one comprehensive (later).

TLC stops at the first violation, so a rule a config is expected to break gets
a config of its own (`<config>__<Rule>`), and the config itself checks only
the rules expected to hold there.  EXPECT below is the table README.md shows.
"""
S = lambda *a: '{' + ', '.join(a) + '}'
Q = lambda s: '"%s"' % s

# nefarious2 and Seance as they are
TODAY = dict(Dev=S('d1', 'd2'), Strict=S('d2'), Conv=S('c1'), MaxMsg='2',
             InitSubbed=S('d1', 'd2'), Lossy='FALSE', Identity=Q('conn'),
             MergeTime=Q('last'), RelayTo=Q('all'), OutPer=Q('account'),
             StrictRelay=Q('send'))
BASE = {
    'Today': TODAY,
    # R1 bound to the connection that registered: misses the worker's Mark read
    'R1Conn': dict(TODAY, RelayTo=Q('others')),
    # R1 with a device id, and cards that carry their newest message's time (R10)
    'R1Dev': dict(TODAY, RelayTo=Q('others'), Identity=Q('device'), MergeTime=Q('newest')),
    # the same, with a device that subscribes after the first push
    'R1DevLate': dict(TODAY, RelayTo=Q('others'), Identity=Q('device'), MergeTime=Q('newest'),
                      InitSubbed=S('d1')),
    # R1 + R2: relays only where a message push went
    'R1R2Late': dict(TODAY, RelayTo=Q('others'), Identity=Q('device'), MergeTime=Q('newest'),
                     InitSubbed=S('d1'), OutPer=Q('sub')),
    # R1 + R2 + R3: no relays to WebKit at all; cards there go stale until opened
    'R1R2R3': dict(TODAY, RelayTo=Q('others'), Identity=Q('device'), MergeTime=Q('newest'),
                   OutPer=Q('sub'), StrictRelay=Q('skip')),
    # R1Dev with a lossy push service and three messages (for the silent-push mutant)
    'R1DevLossy3': dict(TODAY, RelayTo=Q('others'), Identity=Q('device'), MergeTime=Q('newest'),
                        Lossy='TRUE', MaxMsg='3'),
    # comprehensive: not for now
    'Reference': dict(Dev=S('d1', 'd2', 'd3'), Strict=S('d2', 'd3'), Conv=S('c1', 'c2'),
                      MaxMsg='4', InitSubbed=S('d1', 'd2'), Lossy='TRUE', Identity=Q('device'),
                      MergeTime=Q('newest'), RelayTo=Q('others'), OutPer=Q('sub'),
                      StrictRelay=Q('send')),
}
INVS = ['RuleNoSelfRelay', 'RuleNoOwnReadStub', 'RuleNeverRevoked', 'RuleNoAlertForRead']
PROPS = ['RuleCloseOnlyRead', 'RuleRelayWherePushed', 'RuleOpenClean']
ALL = INVS + PROPS
# the rules each config is expected to break
EXPECT = {
    'Today': ['RuleNoSelfRelay', 'RuleNoOwnReadStub', 'RuleCloseOnlyRead'],
    'R1Conn': ['RuleNoSelfRelay', 'RuleNoOwnReadStub', 'RuleCloseOnlyRead'],
    'R1Dev': [],
    'R1DevLate': ['RuleRelayWherePushed'],
    'R1R2Late': [],
    'R1R2R3': [],
    'R1DevLossy3': [],
    'Reference': [],
}
WIT = {  # witness -> base: each is expected to be violated (the situation is reachable)
    'W_OwnReadStub': 'Today',
    'W_ClosedUnread': 'Today',
    'W_OtherReadStub': 'R1Dev',
    'W_RelayNoCard': 'R1DevLate',
    'W_StaleCard': 'R1R2R3',
}

CFGS = {}
for b, broken in EXPECT.items():
    note = 'COMPREHENSIVE: not for now' if b == 'Reference' else 'LIMITED run (now)'
    CFGS[b] = (b, [r for r in ALL if r not in broken], note + ', expected to pass')
    for r in broken:
        CFGS['%s__%s' % (b, r)] = (b, [r], 'LIMITED run (now), expected to FAIL %s' % r)
for w, b in WIT.items():
    CFGS['%s__%s' % (b, w)] = (b, [w], 'witness: expected to FAIL %s (reachable)' % w)
# Does a card go stale on a WebKit device without R3?  (DECISIONS.md Q4; no expectation)
CFGS['R1Dev__W_StaleCard'] = ('R1Dev', ['W_StaleCard'], 'question: is W_StaleCard reachable?')


def render(name):
    base, rules, note = CFGS[name]
    out = ['\\* %s: %s; constants of %s' % (name, note, base), 'SPECIFICATION Spec', 'CONSTANTS']
    out += ['  %s = %s' % kv for kv in BASE[base].items()]
    inv = ['TypeOK'] + [r for r in rules if not r in PROPS]
    out += ['INVARIANTS', '  ' + ' '.join(inv)]
    props = [r for r in rules if r in PROPS]
    if props:
        out += ['PROPERTIES', '  ' + ' '.join(props)]
    out.append('CHECK_DEADLOCK FALSE')
    return '\n'.join(out) + '\n'


if __name__ == '__main__':
    for n in CFGS:
        open(n + '.cfg', 'w').write(render(n))
    print('wrote', len(CFGS), 'configs')
