#!/usr/bin/env python3
"""Write SpecReg's configs: limited (run now), comprehensive (later), witnesses."""
S = lambda *a: '{' + ', '.join('"%s"' % x for x in a) + '}'
Q = lambda *a: {1: 'NL1', 2: 'NL2'}[len(a)]   # tuples are defined in SpecReg.tla
D = dict(NickList=Q('n1'), Taken='{}', PassReq='"none"', CliPasses=S('none'),
         Cookie='FALSE', Meta='FALSE', MetaVals='{0}', Timeout='FALSE', NoBatch='FALSE')
BASE = {
    'TinyNick': dict(D, NickList=Q('n1', 'n2'), Taken=S('n1')),          # 433, then the next nick
    'TinyPass': dict(D, PassReq='"need"', CliPasses=S('none', 'right', 'wrong')),
    'TinyCookie': dict(D, Cookie='TRUE'),
    'TinyMeta': dict(D, Meta='TRUE', MetaVals='{0, 1}'),
    'TinyTimeout': dict(D, Taken=S('n1'), Timeout='TRUE'),
    'TinyMetaNick': dict(D, Meta='TRUE', MetaVals='{0, 1}', NickList=Q('n1', 'n2'), Taken=S('n1')),
    'TinyMetaCookie': dict(D, Meta='TRUE', MetaVals='{1}', Cookie='TRUE'),
    'TinyMetaNoBatch': dict(D, Meta='TRUE', MetaVals='{0, 1}', NoBatch='TRUE'),   # D9
    # comprehensive: not for now
    'Reference': dict(NickList=Q('n1', 'n2'), Taken=S('n1'), PassReq='"need"',
                      CliPasses=S('none', 'right', 'wrong'), Cookie='TRUE', Meta='TRUE',
                      MetaVals='{0, 1}', Timeout='TRUE', NoBatch='TRUE'),
}
INV = ['TypeOK', 'RulePassBeforeLatter', 'RulePongToken', 'RuleMetaStar', 'RuleBurstAfter001',
       'RuleMetaBatch', 'RuleMetaCarries', 'RulePassGate', 'RuleCookieGate', 'RuleWelcomedBy001', 'RuleHeldIsKept',
       'RuleDropWithoutBatch', 'RuleNoMetaBatchWithoutBatch']
PROP = ['RuleNickIgnoredOn433', 'RulePassRefusalSaid', 'RuleNothingAfterError',
        'PingsAnswered', 'Registers', 'RuleWelcomeStore']
LIMITED = ['TinyNick', 'TinyPass', 'TinyCookie', 'TinyMeta', 'TinyTimeout', 'TinyMetaNick',
           'TinyMetaCookie', 'TinyMetaNoBatch']
WIT = {'W_433Then001': 'TinyNick', 'W_EndThen433': 'TinyNick', 'W_CookieThen001': 'TinyCookie',
       'W_MetaKV': 'TinyMeta', 'W_EmptyBatch': 'TinyMeta', 'W_MetaAfterEnd': 'TinyMeta',
       'W_Timeout': 'TinyTimeout', 'W_PassRefused': 'TinyPass', 'W_Refused464Only': 'TinyPass',
       'W_MetaDropped': 'TinyMetaNoBatch', 'W_MetaBeforeBatch': 'TinyMeta'}
CFGS = {b: (b, INV, PROP, 'LIMITED run (now)') for b in LIMITED}
CFGS['Reference'] = ('Reference', INV, PROP, 'COMPREHENSIVE: not for now')
for w, b in WIT.items():
    CFGS[w] = (b, [w], [], 'witness: expected to FAIL (%s)' % w)

def render(name):
    base, inv, props, note = CFGS[name]
    out = ['\\* %s: %s; constants of %s' % (name, note, base), 'SPECIFICATION Spec', 'CONSTANTS']
    out += ['  %s %s %s' % (k, '<-' if k == 'NickList' else '=', v) for k, v in BASE[base].items()]
    out += ['INVARIANTS', '  ' + ' '.join(inv)]
    if props:
        out += ['PROPERTIES', '  ' + ' '.join(props)]
    out.append('CHECK_DEADLOCK FALSE')
    return '\n'.join(out) + '\n'

if __name__ == '__main__':
    for n in CFGS:
        open(n + '.cfg', 'w').write(render(n))
    print('wrote', len(CFGS), 'configs')
