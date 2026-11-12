---- MODULE HSrv_1524 ----
\* CHATHISTORY BEFORE #hckmattlc msgid=zzzz-not-a-msgid-0000 5  (observation #1524)
EXTENDS History
VARIABLE ti
TimesV == 1..4
T0 == <<1, 2, 2, 3>>
O0 == <<1, 2, 3, 4>>
QQ == [NoQ EXCEPT !.k = "before", !.form = "msgid", !.sel = 8]
Page == <<>>
TInit == time = T0 /\ ord = O0 /\ Init /\ ti = 0
Ask == /\ ti = 0 /\ q = NoQ /\ q' = QQ /\ ti' = 1
       /\ UNCHANGED <<time, ord, liveSt, liveRel, s2c, buf, pgSeen, liveSeen, phase, anchor, pages, got, why, pg1, unkEmpty>>
MNext ==
    \/ Ask
    \/ ti = 1 /\ SrvFail /\ s2c'[Len(s2c')].k = "fail" /\ ti' = 2
INext ==
    \/ Ask
    \/ ti = 1 /\ ti' = 2
       /\ SrvFail
MSpec == TInit /\ [][MNext]_<<vars, ti>>
ISpec == TInit /\ [][INext]_<<vars, ti>>
TDone == ti = 2
NotDone == ~TDone
====
