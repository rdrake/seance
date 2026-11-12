---- MODULE HSrv_0908 ----
\* CHATHISTORY BEFORE #hckmattlc msgid=ABAAAaHQRehyLJ 1  (observation #908)
EXTENDS History
VARIABLE ti
TimesV == 1..4
T0 == <<1, 2, 2, 3>>
O0 == <<1, 2, 3, 4>>
QQ == [NoQ EXCEPT !.k = "before", !.form = "msgid", !.sel = 4]
Page == <<3>>
TInit == time = T0 /\ ord = O0 /\ Init /\ ti = 0
Ask == /\ ti = 0 /\ q = NoQ /\ q' = QQ /\ ti' = 1
       /\ UNCHANGED <<time, ord, liveSt, liveRel, s2c, buf, pgSeen, liveSeen, phase, anchor, pages, got, why, pg1, unkEmpty>>
MNext ==
    \/ Ask
    \/ ti = 1 /\ SrvAnswer /\ s2c'[Len(s2c')].ms = Page /\ s2c'[Len(s2c')].end = FALSE /\ ti' = 2
INext ==
    \/ Ask
    \/ ti = 1 /\ ti' = 2
       /\ s2c' = Append(s2c, [k |-> "page", ms |-> Page, end |-> FALSE,
                          qq |-> q, el |-> Elig(q, ord), so |-> ord])
       /\ q' = NoQ
       /\ UNCHANGED <<time, ord, liveSt, liveRel, buf, pgSeen, liveSeen, phase, anchor, pages, got, why, pg1, unkEmpty>>
MSpec == TInit /\ [][MNext]_<<vars, ti>>
ISpec == TInit /\ [][INext]_<<vars, ti>>
TDone == ti = 2
NotDone == ~TDone
====
