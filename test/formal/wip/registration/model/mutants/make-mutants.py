#!/usr/bin/env python3
"""Write the SpecReg mutants.  Each must FAIL its base config; the unmutated
model passes the same config.  Run from this directory:
  java -XX:+UseParallelGC -cp tla2tools.jar tlc2.TLC -workers 8 -config <M>.cfg <M>.tla

  MU_PassLate        (TinyPass)     client sends PASS after NICK and USER -> RulePassBeforeLatter
  MU_PongWrong       (TinyCookie)   client answers the cookie with another token -> RulePongToken
                                    (Registers fails too)
  MU_MetaNick        (TinyMetaNick) client aims METADATA at its requested nick before 001
                                    -> RuleMetaStar
  MU_NoEmptyBatch    (TinyMeta)     server sends no batch when nothing was set -> RuleMetaBatch
  MU_BatchAfterMotd  (TinyMeta)     server sends the metadata batch after 376 -> RuleMetaBatch
  MU_DropPreReg      (TinyMeta)     server's batch leaves out the key set before 001
                                    -> RuleMetaCarries
  MU_BurstBefore001  (TinyMeta)     server sends the batch before 001 -> RuleBurstAfter001
  MU_NickOn433       (TinyNick)     server takes the nick it answered with 433 -> RuleNickIgnoredOn433
  MU_WelcomeOnEnd    (TinyNick)     client counts itself registered at CAP END -> RuleWelcomedBy001
  MU_WelcomeBadPass  (TinyPass)     server registers a client without the right password -> RulePassGate
  MU_SilentRefusal   (TinyPass)     server refuses a password without 464 or ERROR
                                    -> RulePassRefusalSaid
  MU_NoCookieGate    (TinyCookie)   server sends 001 before the cookie's PONG -> RuleCookieGate
  MU_SpeakAfterError (TinyTimeout)  server keeps reading (and answering) after ERROR
                                    -> RuleNothingAfterError
  MU_TrustDropped    (TinyMetaNoBatch) client counts a key acknowledged before 001 as held
                                    without batch (Seance before #299) -> RuleHeldIsKept
"""
src = open('../SpecReg.tla').read()

def mut(name, base, *pairs):
    out = src
    for old, new in pairs:
        assert out.count(old) == 1, (name, old, out.count(old))
        out = out.replace(old, new)
    out = out.replace('MODULE SpecReg', 'MODULE ' + name, 1)
    open(name + '.tla', 'w').write(out)
    cfg = open('../%s.cfg' % base).read()
    open(name + '.cfg', 'w').write('\\* mutant %s on the constants of %s\n' % (name, base) + cfg)

mut('MU_PassLate', 'TinyPass',
    ('PassFirst == cli.pass = "none" \\/ cli.passSent', 'PassFirst == TRUE'),
    ('/\\ ~(cli.ni >= 1 /\\ cli.user)                                    \\* cli-pass',
     '/\\ TRUE'))
mut('MU_PongWrong', 'TinyCookie',
    ('CSend(M("PONG", Head(cli.pings)))', 'CSend(M("PONG", "bad"))'))
mut('MU_MetaNick', 'TinyMetaNick',
    ('CSend(M("METASET", "*"))', 'CSend(M("METASET", NickList[1]))'))
mut('MU_NoEmptyBatch', 'TinyMeta',
    ('    \\o (IF Meta /\\ srv.batch\n        THEN <<M("BATCH+", n)>>', '    \\o (IF Meta /\\ srv.batch /\\ srv.meta = 1\n        THEN <<M("BATCH+", n)>>'))
mut('MU_BatchAfterMotd', 'TinyMeta',
    ('    \\o <<M("376", "")>>\n', '    \\o <<>>\n'),
    ('    <<M("001", n)>>\n', '    <<M("001", n), M("376", "")>>\n'))
mut('MU_DropPreReg', 'TinyMeta',
    ('(IF srv.meta = 1 THEN <<M("KV", "k")>> ELSE <<>>)', '<<>>'))
mut('MU_BurstBefore001', 'TinyMeta',
    ('    <<M("001", n)>>\n    \\o (IF Meta', '    <<>>\n    \\o (IF Meta'),
    ('    \\o <<M("376", "")>>\n', '    \\o <<M("001", n), M("376", "")>>\n'))
mut('MU_NickOn433', 'TinyNick',
    ('THEN s2c\' = Append(s2c, M("433", m.a)) /\\ srv\' = srv',
     'THEN s2c\' = Append(s2c, M("433", m.a)) /\\ srv\' = [srv EXCEPT !.nick = m.a]'))
mut('MU_WelcomeOnEnd', 'TinyNick',
    ('cli\' = [cli EXCEPT !.endSent = TRUE]                          \\* cli-end',
     'cli\' = [cli EXCEPT !.endSent = TRUE, !.welcomed = TRUE]'))
mut('MU_WelcomeBadPass', 'TinyPass',
    ('    /\\ Ready /\\ PassOK\n    /\\ srv\' = [srv EXCEPT !.phase = "burst"',
     '    /\\ Ready\n    /\\ srv\' = [srv EXCEPT !.phase = "burst"'))
mut('MU_SilentRefusal', 'TinyPass',
    ('\\/ s2c\' = Append(s2c, M("464", "*")) /\\ srv\' = [srv EXCEPT !.phase = "refused"]',
     '\\/ s2c\' = s2c /\\ srv\' = [srv EXCEPT !.phase = "refused"]'))
mut('MU_NoCookieGate', 'TinyCookie',
    ('/\\ (~Cookie \\/ srv.cookie = "ok")', '/\\ TRUE'))
mut('MU_SpeakAfterError', 'TinyTimeout',
    ('/\\ srv.phase # "closed" /\\ c2s # <<>>', '/\\ c2s # <<>>'))
mut('MU_TrustDropped', 'TinyMetaNoBatch',
    ('!.held = cli.acked /\\ cli.batch]', '!.held = cli.acked]'))
print('ok')
