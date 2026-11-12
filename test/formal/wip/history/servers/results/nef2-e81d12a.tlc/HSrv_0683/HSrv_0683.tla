---- MODULE HSrv_0683 ----
\* CHATHISTORY BEFORE #hckmattlc timestamp=2026-11-12T15:00:04.833Z 2  (observation #683)
EXTENDS History
VARIABLE ti
TimesV == 1..4
T0 == <<1, 2, 2, 3>>
O0 == <<1, 2, 3, 4>>
QQ == [NoQ EXCEPT !.k = "before", !.form = "ts", !.ts = 1]
Page == <<>>
TInit == time = T0 /\ ord = O0 /\ Init /\ ti = 0
Ask == /\ ti = 0 /\ q = NoQ /\ q' = QQ /\ ti' = 1
       /\ UNCHANGED <<time, ord, liveSt, liveRel, s2c, buf, pgSeen, liveSeen, phase, anchor, pages, got, why, pg1, unkEmpty>>
MNext ==
    \/ Ask
    \/ ti = 1 /\ SrvAnswer /\ s2c'[Len(s2c')].ms = Page /\ s2c'[Len(s2c')].end = TRUE /\ ti' = 2
INext ==
    \/ Ask
    \/ ti = 1 /\ ti' = 2
       /\ s2c' = Append(s2c, [k |-> "page", ms |-> Page, end |-> TRUE,
                          qq |-> q, el |-> Elig(q, ord), so |-> ord])
       /\ q' = NoQ
       /\ UNCHANGED <<time, ord, liveSt, liveRel, buf, pgSeen, liveSeen, phase, anchor, pages, got, why, pg1, unkEmpty>>
MSpec == TInit /\ [][MNext]_<<vars, ti>>
ISpec == TInit /\ [][INext]_<<vars, ti>>
TDone == ti = 2
NotDone == ~TDone
====
