---- MODULE HSrv_2222 ----
\* CHATHISTORY LATEST #hnvchetlc * 10  (observation #2222)
EXTENDS History
VARIABLE ti
TimesV == 1..7
T0 == <<1, 2, 3, 4, 4, 5, 6>>
O0 == <<1, 2, 3, 4, 5, 6>>
QQ == [NoQ EXCEPT !.k = "latest", !.form = "star"]
Page == <<1, 2, 3, 4, 5, 6, 7>>
TInit == time = T0 /\ ord = O0 /\ Init /\ ti = 0
Ask == /\ ti = 1 /\ q = NoQ /\ q' = QQ /\ ti' = 2
       /\ UNCHANGED <<time, ord, liveSt, liveRel, s2c, buf, pgSeen, liveSeen, phase, anchor, pages, got, why, pg1, unkEmpty>>
MNext ==
    \/ ti = 0 /\ StoreLive /\ ti' = 1
    \/ Ask
    \/ ti = 2 /\ SrvAnswer /\ s2c'[Len(s2c')].ms = Page /\ s2c'[Len(s2c')].end = TRUE /\ ti' = 3
INext ==
    \/ ti = 0 /\ StoreLive /\ ti' = 1
    \/ Ask
    \/ ti = 2 /\ ti' = 3
       /\ s2c' = Append(s2c, [k |-> "page", ms |-> Page, end |-> TRUE,
                          qq |-> q, el |-> Elig(q, ord), so |-> ord])
       /\ q' = NoQ
       /\ UNCHANGED <<time, ord, liveSt, liveRel, buf, pgSeen, liveSeen, phase, anchor, pages, got, why, pg1, unkEmpty>>
MSpec == TInit /\ [][MNext]_<<vars, ti>>
ISpec == TInit /\ [][INext]_<<vars, ti>>
TDone == ti = 3
NotDone == ~TDone
====
