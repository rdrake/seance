#!/usr/bin/env python3
"""Write the .cfg files of SpecSasl.tla into this directory, and check them.

Run from here:  python3 make-configs.py
It writes the limited configs (run now), the comprehensive ones (labelled,
not for now), one W_*.cfg per witness, and checks that every config assigns
every CONSTANT of SpecSasl.tla and names only operators the module defines.
It runs no model checker.
"""
import re, sys

TLA = open('SpecSasl.tla').read()

def constants():
    block = TLA.split('CONSTANTS', 1)[1].split('ASSUME', 1)[0]
    return re.findall(r'^\s+([A-Z][A-Za-z0-9]*),?\s*(?:\\\*|$)', block, re.M)

def defined(name):
    return re.search(r'^%s(\(.*\))?\s*==' % re.escape(name), TLA, re.M) is not None

S = lambda *xs: '{' + ', '.join('"%s"' % x for x in xs) + '}'

# Defaults for the v0.1 switches; a base overrides what it exercises.
V01 = dict(AnyOrder908='FALSE', AcctEarly='FALSE', NoAbandon='FALSE')

BASE = {
    # Mechanism lists, 908 (before or after its 904), retry with another mechanism.
    'TinyMechs': dict(Mechs=S('P', 'E', 'X'), CliMechs=S('P', 'E'), TwoRound='{}',
                      Accounts=S('a1'), MaxChunks=1, MaxLen=2, MaxAtt=2, MaxReq=1,
                      MaxEnv=0, Reauth='"none"', ClientReauth='FALSE', AdvertValue='TRUE',
                      Send908='TRUE', PickListed='FALSE', SilentChange='FALSE',
                      **dict(V01, AnyOrder908='TRUE')),
    # Chunking both ways, the length limit (MaxLen 1), a SCRAM-shaped mechanism.
    'TinyChunks': dict(Mechs=S('P', 'S'), CliMechs=S('P', 'S'), TwoRound=S('S'),
                       Accounts=S('a1'), MaxChunks=2, MaxLen=1, MaxAtt=1, MaxReq=1,
                       MaxEnv=0, Reauth='"none"', ClientReauth='FALSE', AdvertValue='TRUE',
                       Send908='FALSE', PickListed='TRUE', SilentChange='FALSE', **V01),
    # Reauthentication allowed (S2-6 SHOULD), account changes, 901; the account
    # may be set before a late 900 (AcctEarly, R1).
    'TinyReauth': dict(Mechs=S('P'), CliMechs=S('P'), TwoRound='{}',
                       Accounts=S('a1', 'a2'), MaxChunks=1, MaxLen=2, MaxAtt=2, MaxReq=1,
                       MaxEnv=1, Reauth='"full"', ClientReauth='TRUE', AdvertValue='TRUE',
                       Send908='FALSE', PickListed='TRUE', SilentChange='FALSE',
                       **dict(V01, AcctEarly='TRUE')),
    # S1 server (907), with a client that tries to reauthenticate.
    'TinyS1': dict(Mechs=S('P'), CliMechs=S('P'), TwoRound='{}',
                   Accounts=S('a1', 'a2'), MaxChunks=1, MaxLen=2, MaxAtt=2, MaxReq=1,
                   MaxEnv=1, Reauth='"none"', ClientReauth='TRUE', AdvertValue='TRUE',
                   Send908='FALSE', PickListed='TRUE', SilentChange='FALSE', **V01),
    # cap-notify: NEW/DEL of sasl, silent changes (stale lists), 908.
    'TinyNotify': dict(Mechs=S('P', 'E'), CliMechs=S('P', 'E'), TwoRound='{}',
                       Accounts=S('a1'), MaxChunks=1, MaxLen=2, MaxAtt=2, MaxReq=2,
                       MaxEnv=2, Reauth='"none"', ClientReauth='FALSE', AdvertValue='TRUE',
                       Send908='TRUE', PickListed='TRUE', SilentChange='TRUE', **V01),
}
# v0.1 (#6): sasl advertised with NO value (S2:44-46).
BASE['TinyNoValue'] = dict(BASE['TinyMechs'], AdvertValue='FALSE', PickListed='TRUE',
                           AnyOrder908='FALSE')
# v0.1 (#7): list updates by NEW only, so MechListAgrees is live.
BASE['TinyNotifyList'] = dict(BASE['TinyNotify'], SilentChange='FALSE', Send908='FALSE')
# v0.1 (#12): room for FULL + SHORT to be accepted (MaxLen 2).
BASE['TinyChunks2'] = dict(BASE['TinyChunks'], MaxLen=2)
# v0.1 (#15): server-driven completion: no abort, give-up or quit.
BASE['TinyNoAbandon'] = dict(BASE['TinyMechs'], NoAbandon='TRUE')
# Rests on D9 (an open question): limited, but in its own list.
BASE['TinySame'] = dict(BASE['TinyReauth'], Reauth='"same"')
# Comprehensive: NOT for now (see README).
BASE['Reference'] = dict(Mechs=S('P', 'S', 'X'), CliMechs=S('P', 'S'), TwoRound=S('S'),
                         Accounts=S('a1', 'a2'), MaxChunks=2, MaxLen=2, MaxAtt=3, MaxReq=2,
                         MaxEnv=2, Reauth='"full"', ClientReauth='TRUE', AdvertValue='TRUE',
                         Send908='TRUE', PickListed='FALSE', SilentChange='TRUE',
                         **dict(V01, AnyOrder908='TRUE', AcctEarly='TRUE'))
BASE['RefNone'] = dict(BASE['Reference'], Reauth='"none"')

INV = ['TypeOK', 'DelCancels', 'SuccAccounting', 'RuleClientFraming',
       'ClientPayloadDone', 'AccountAgrees', 'EnabledAgrees', 'MechListAgrees']
SAFE = ['Rule907', 'Rule907NoChange', 'RuleAccountNotified', 'Rule906',
        'RuleReauthRefused', 'RuleOpenerAnswered', 'RuleVerdictAfterLast',
        'RuleSrvChalFramed', 'Rule908', 'RuleValueIsMechs', 'RuleNakIfDown',
        'RuleFailCloseReason', 'RuleDelCancelsOutput',
        'RuleClientAuthOnlyEnabled', 'RuleClientPostReg', 'RuleClientLineLen',
        'RuleClientSendsPayload', 'RuleClientEmptyFinal', 'RuleClientMech',
        'RuleExitByServerLine']
LIVE = ['ExchangeEnds', 'OwedEventuallyClears']

LIMITED = ['TinyMechs', 'TinyChunks', 'TinyChunks2', 'TinyReauth', 'TinyS1',
           'TinyNotify', 'TinyNotifyList', 'TinyNoValue', 'TinyNoAbandon', 'TinySame']

# name -> (base constants, spec, invariants, properties, view, header comment)
CFGS = {}
for b in LIMITED:
    CFGS[b] = (b, 'Spec', INV, SAFE + LIVE, None, 'LIMITED run (now)')
CFGS['TinyEnv'] = ('TinyMechs', 'EnvSpec', INV, SAFE + ['OwedEventuallyClears'], None,
                   'LIMITED run (now): server fairness only')
CFGS['Reference'] = ('Reference', 'Spec', INV, SAFE + LIVE, None,
                     'COMPREHENSIVE: not for now')
CFGS['RefSafety'] = ('Reference', 'EnvSpec', INV, SAFE, 'SafetyView',
                     'COMPREHENSIVE: not for now (safety only, VIEW)')
CFGS['RefNone'] = ('RefNone', 'Spec', INV, SAFE + LIVE, None,
                   'COMPREHENSIVE: not for now')

# Witnesses: W_x -> base config whose constants make it reachable.
WIT = {
    'W_LoggedIn': 'TinyMechs', 'W_Retry908': 'TinyMechs', 'W_Late908': 'TinyMechs',
    'W_MultiChunk': 'TinyChunks2', 'W_ExactPlus': 'TinyChunks', 'W_Limit': 'TinyChunks',
    'W_TwoRound': 'TinyChunks', 'W_ChalChunked': 'TinyChunks', 'W_AbortMid': 'TinyChunks',
    'W_AccountChange': 'TinyReauth', 'W_PostReg': 'TinyReauth',
    'W_FailLogout': 'TinyReauth', 'W_Relogin': 'TinyReauth', 'W_903First': 'TinyReauth',
    'W_AcctEarly': 'TinyReauth',
    'W_Late907': 'TinyS1', 'W_PostRegErr': 'TinyS1',
    'W_NewList': 'TinyNotifyList', 'W_NewThenAuth': 'TinyNotify', 'W_DelMid': 'TinyNotify',
    'W_StaleList': 'TinyNotify',
    'W_NoValueLogin': 'TinyNoValue',
    'W_Refuse907': 'TinySame',
}
for w, b in WIT.items():
    CFGS[w] = (b, 'Spec', [w], [], None, 'witness: expected to FAIL (%s)' % w)

def render(name):
    base, spec, inv, props, view, note = CFGS[name]
    out = ['\\* %s: %s; constants of %s' % (name, note, base), 'SPECIFICATION ' + spec, 'CONSTANTS']
    out += ['  %s = %s' % (k, v) for k, v in BASE[base].items()]
    if view:
        out.append('VIEW ' + view)
    if inv:
        out += ['INVARIANTS', '  ' + ' '.join(inv)]
    if props:
        out += ['PROPERTIES', '  ' + ' '.join(props)]
    out.append('CHECK_DEADLOCK FALSE')
    return '\n'.join(out) + '\n'

def check():
    consts = set(constants())
    assert len(consts) == 18, consts
    errs = []
    for name, (base, spec, inv, props, view, _) in CFGS.items():
        if set(BASE[base]) != consts:
            errs.append('%s: constants %s' % (name, consts ^ set(BASE[base])))
        for op in [spec] + inv + props + ([view] if view else []):
            if not defined(op):
                errs.append('%s: %s not defined' % (name, op))
        for op in inv:
            if re.search(r'^%s\s*==\s*\n?\s*\[\]' % op, TLA, re.M):
                errs.append('%s: %s is temporal, not an invariant' % (name, op))
    for w in re.findall(r'^(W_[A-Za-z0-9]+)\s*==', TLA, re.M):
        if w not in WIT:
            errs.append('witness %s has no config' % w)
    return errs

if __name__ == '__main__':
    errs = check()
    if errs:
        print('\n'.join(errs)); sys.exit(1)
    for name in CFGS:
        open(name + '.cfg', 'w').write(render(name))
    print('wrote %d configs' % len(CFGS))
