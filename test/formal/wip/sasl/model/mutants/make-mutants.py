#!/usr/bin/env python3
"""Write the mutants of ../SpecSasl.tla, and a config for each, into this directory.

Run from here:  python3 make-mutants.py   (rerun after ANY change to SpecSasl.tla)
Then, from here, for each mutant:
  java -XX:+UseParallelGC -cp tla2tools.jar tlc2.TLC -workers 8 -config <M>.cfg <M>.tla
Each must FAIL; the unmutated model passes the same base config (../<Base>.cfg).
Expected (predictions; nothing has been run):
  MU_EarlyVerdict   (TinyChunks) server decides on a 400-byte chunk, before the
                                 response's last line          -> RuleVerdictAfterLast
  MU_NoPlusAfter400 (TinyChunks) client omits "+" after an exact multiple of
                                 400 (chunking off by one)     -> RuleClientFraming
  MU_Chunk401       (TinyChunks) client sends a 400-byte payload as one over-long
                                 line instead of chunk + "+"   -> RuleClientLineLen
  MU_KeepAfterDel   (TinyNotify) client keeps its exchange (and keeps sending)
                                 after DEL sasl                -> RuleClientAuthOnlyEnabled
  MU_SrvKeepAfterDel(TinyNotify) server keeps the exchange after DEL sasl -> DelCancels
  MU_DelKeepOwed    (TinyNotify) v0.1: DEL leaves an owed 903 alive (CN:456-457)
                                                               -> DelCancels
  MU_FinalShort     (TinyChunks) v0.1: client sends SHORT where the empty final
                                 response "+" is due (S1-9)    -> RuleClientEmptyFinal
                                 (RuleClientFraming and the v0 plan-based check pass)
  MU_ExactShort     (TinyChunks) v0.1: client ends an exact-400 payload with SHORT
                                 instead of "+"                 -> RuleClientSendsPayload
                                 (RuleClientFraming passes: SHORT ends a response)
  MU_PostRegWrongErr(TinyS1)     v0.1: S1 server answers an unauthenticated opener
                                 after 001 with 906, not an error -> RuleReauthRefused
                                 (RuleOpenerAnswered passes: something was sent)
  MU_ChangeOn907    (TinyS1)     server logs the client out while sending 907
                                                               -> Rule907NoChange
  MU_No907          (TinyS1)     S1 server lets an authenticated client
                                 authenticate again            -> Rule907
"""
import re
src = open('../SpecSasl.tla').read()
cfgs = {}

def mut(name, base, old, new):
    assert src.count(old) == 1, (name, src.count(old))
    out = src.replace(old, new).replace('MODULE SpecSasl', 'MODULE ' + name, 1)
    assert 'MODULE ' + name + ' ' in out
    open(name + '.tla', 'w').write(out)
    cfg = open('../%s.cfg' % base).read()
    open(name + '.cfg', 'w').write('\\* mutant %s on the constants of %s\n' % (name, base) + cfg)

mut('MU_EarlyVerdict', 'TinyChunks',
    "ELSE sout' = sout /\\ srv' = [srv EXCEPT !.got = @ + 1]       \\* more to come",
    "ELSE sout' = sout /\\ srv' = [srv EXCEPT !.sasl = \"decide\", !.got = 0]")
mut('MU_NoPlusAfter400', 'TinyChunks',
    'ELSE IF p.full THEN Fulls(p.n) \\o <<"PLUS">>   \\* cli-exact',
    'ELSE IF p.full THEN Fulls(p.n)')
mut('MU_Chunk401', 'TinyChunks',
    'ELSE IF p.full THEN Fulls(p.n) \\o <<"PLUS">>   \\* cli-exact',
    'ELSE IF p.full THEN Fulls(p.n - 1) \\o <<"LONG">>')
mut('MU_KeepAfterDel', 'TinyNotify',
    '!.sasl = IF InExchange THEN "idle" ELSE @, !.out = IF InExchange THEN <<>> ELSE @,',
    '!.sasl = @, !.out = @,')
mut('MU_SrvKeepAfterDel', 'TinyNotify',
    '!.cout = <<>>, !.sasl = "idle", !.got = 0,',
    '!.got = @,')
mut('MU_DelKeepOwed', 'TinyNotify',
    '!.owe903 = FALSE, !.owe904 = FALSE, !.owe908 = FALSE]',
    '!.owe904 = FALSE, !.owe908 = FALSE]')
mut('MU_FinalShort', 'TinyChunks',
    "/\\ c2s' = Append(c2s, M(Head(cli.out)))",
    "/\\ c2s' = Append(c2s, M(IF Head(cli.out) = \"PLUS\" /\\ cli.mech \\in TwoRound\n"
    "                                     /\\ cli.round = 2 THEN \"SHORT\" ELSE Head(cli.out)))")
mut('MU_ExactShort', 'TinyChunks',
    'ELSE IF p.full THEN Fulls(p.n) \\o <<"PLUS">>   \\* cli-exact',
    'ELSE IF p.full THEN Fulls(p.n) \\o <<"SHORT">>')
mut('MU_PostRegWrongErr', 'TinyS1',
    "ELSE IF srv.reg /\\ Reauth = \"none\"\n    THEN sout' = Append(sout, M(\"904\"))",
    "ELSE IF srv.reg /\\ Reauth = \"none\"\n    THEN sout' = Append(sout, M(\"906\"))")
mut('MU_ChangeOn907', 'TinyS1',
    "THEN sout' = Append(sout, M(\"907\")) /\\ srv' = srv  \\* opener-907",
    "THEN sout' = Append(sout, M(\"907\")) /\\ srv' = [srv EXCEPT !.account = \"\"]")
mut('MU_No907', 'TinyS1',
    'ELSE IF srv.succeeded /\\ Reauth = "none"',
    'ELSE IF FALSE')
print('ok')
