---------------------------- MODULE DM_HistorySettles ----------------------------
(***************************************************************************)
(* Delivery of the client's own messages: labeled-response (LR),          *)
(* echo-message (EM) and batch (BA), with the checked client's pending    *)
(* copies (D15).  Decisions: ../DECISIONS.md D1, D2, D12, D13, D15-D21.    *)
(*                                                                         *)
(* v2.2 (MODEL-REVIEW-3): history lines are queued and emitted one at a   *)
(* time, the label ledger counts emitted lines, the obligations use the   *)
(* wire's own provenance, and a late echo may be altered under Modify.    *)
(*                                                                         *)
(* v2 (after MODEL-REVIEW-2):                                              *)
(*   - responses are queued and emitted line by line, so they interleave   *)
(*     (D16); the client keeps a map of open batches keyed by reference;   *)
(*   - a labeled batch may hold one inner batch (depth 2): a multiline     *)
(*     echo, or a history replay (D19);                                    *)
(*   - competing settling lines (D17), connection close (D18), NOTICE and  *)
(*     modified echoes (D20), consumption obligations (D21).               *)
(***************************************************************************)
EXTENDS Naturals, Sequences, FiniteSets, TLC

CONSTANTS
    Labels,        \* the label pool, fresh per request, never recycled (D12)
    Texts,         \* message texts; two, so the content fallback can confuse
    MaxReq,        \* requests the client sends
    MaxLate,       \* late unlabeled replies over the whole run (D20 bounds)
    Lossy,         \* D1, adversarial
    Deferred,      \* D2: process a batch at its outermost end (BA:55, BA:63)
    Fallback,      \* D15: an unlabeled echo settles the oldest copy with the same text
    OtherSession,  \* D15: another session may send the same text
    SelfMsg,       \* LR-5: the client may message its own nick
    TimeoutOn,     \* D13: the client's timeout exists
    Competing,     \* D17, adversarial: a response holding both an echo and a FAIL
    CloseOn,       \* D18: the connection may close
    History,       \* D19: the server may replay a same-text line in a history batch
    Notice,        \* D20: requests may be NOTICE as well as PRIVMSG
    Modify         \* D20, EM-2: the server may alter the echoed text

NoLabel == "none"
HistLabel == "h"          \* the label of a CHATHISTORY request; never a pending copy's
ModText == "mod"          \* an altered echo text, matching no copy
Outcomes == {"pending", "confirmed", "accepted", "failed", "timedout"}
Targets == IF SelfMsg THEN {"chan", "self"} ELSE {"chan"}
Cmds == IF Notice THEN {"PRIVMSG", "NOTICE"} ELSE {"PRIVMSG"}
Settling == {"echo", "ack", "fail", "err"}
RefIds == 1..(2 * MaxReq + 2)

\* A server-to-client line.  `id` is the batch's own reference (bstart/bend
\* only, else 0); `ref` the batch the line belongs to (0 = none; BA:51-52: a
\* start or end never belongs to its own batch); `bt` the batch type; `who`
\* (ghost) the request it answers, "other" or "hist"; `role` (ghost) "resp",
\* "deliv" (a self-message's delivered copy), "late", "other" or "hist".
Ln(k, lab, txt, tgt, cmd, id, ref, bt, who, role) ==
    [k |-> k, lab |-> lab, txt |-> txt, tgt |-> tgt, cmd |-> cmd, id |-> id,
     ref |-> ref, bt |-> bt, who |-> who, role |-> role]

NoRec == [on |-> FALSE, lab |-> NoLabel, root |-> 0, hist |-> FALSE]

Rev(s) == [i \in 1..Len(s) |-> s[Len(s) - i + 1]]

VARIABLES
    sent,        \* client: requests sent, a sequence of [lab, txt, tgt, cmd]
    pend,        \* client: label -> outcome
    pendTxt, pendTgt, pendCmd,  \* client: label -> what was sent
    order,       \* client: labels in send order (for "the oldest copy")
    ob,          \* client: reference -> open batch record, or NoRec
    buf,         \* client: root reference -> lines buffered under Deferred
    closed,      \* the connection has closed (D18)
    owed,        \* server: labels of requests not yet answered
    out,         \* server: label -> response lines not yet emitted
    late,        \* server: labels whose unlabeled late reply is still to come (Lossy)
    lateUsed,    \* server: late replies chosen so far
    s2c,         \* the wire
    nextRef,     \* server: batch references
    otherDone,   \* environment: the other session has spoken (once)
    histDone,    \* environment: the history replay's form, or "none" (once)
    hout,        \* server: history lines not yet emitted (v2.2)
    closeBuf,    \* ghost: the connection closed with buffered lines (v2.2)
    labeledN,    \* ghost: label -> labeled lines emitted for it, whole run (D2)
    firstK,      \* ghost: label -> kind of the first settling line of its response
    compet,      \* ghost: labels answered with a competing response
    by,          \* ghost: label -> whose line settled it ("own", a label, "other", "hist", "none")
    cause,       \* ghost: label -> the kind of line or event that settled it
    role,        \* ghost: label -> the role of the line that settled it
    modConf,     \* ghost: labels confirmed by an altered echo
    early,       \* ghost: a copy was settled while its line's root batch was open (Deferred)
    crossTimed,  \* ghost: a timed-out request's line settled another copy
    crossDeliv,  \* ghost: a delivered copy settled another copy after its own echo confirmed its own
    histSettled, \* ghost: a history line settled a copy
    kindCross    \* ghost: a line of the other kind settled a copy

vars == <<sent, pend, pendTxt, pendTgt, pendCmd, order, ob, buf, closed, owed, out, late,
          lateUsed, s2c, nextRef, otherDone, histDone, hout, closeBuf, labeledN, firstK, compet, by, cause,
          role, modConf, early, crossTimed, crossDeliv, histSettled, kindCross>>
client == <<pend, by, cause, role, modConf, early, crossTimed, crossDeliv, histSettled, kindCross>>
server == <<owed, out, late, lateUsed, nextRef, labeledN, firstK, compet>>

LabelsUsed == {sent[i].lab : i \in 1..Len(sent)}

Init ==
    /\ sent = << >> /\ order = << >>
    /\ pend = [l \in Labels |-> "pending"]
    /\ pendTxt = [l \in Labels |-> CHOOSE t \in Texts : TRUE]
    /\ pendTgt = [l \in Labels |-> "chan"]
    /\ pendCmd = [l \in Labels |-> "PRIVMSG"]
    /\ ob = [r \in RefIds |-> NoRec]
    /\ buf = [r \in RefIds |-> << >>]
    /\ closed = FALSE
    /\ owed = {} /\ out = [l \in Labels |-> << >>] /\ late = {} /\ lateUsed = 0
    /\ s2c = << >> /\ nextRef = 1 /\ otherDone = FALSE /\ histDone = "none"
    /\ hout = << >> /\ closeBuf = FALSE
    /\ labeledN = [l \in Labels |-> 0] /\ firstK = [l \in Labels |-> "none"] /\ compet = {}
    /\ by = [l \in Labels |-> "none"] /\ cause = [l \in Labels |-> "none"]
    /\ role = [l \in Labels |-> "none"] /\ modConf = {}
    /\ early = FALSE /\ crossTimed = FALSE /\ crossDeliv = FALSE
    /\ histSettled = FALSE /\ kindCross = FALSE

-----------------------------------------------------------------------------
(* Client sends a PRIVMSG or NOTICE with a fresh label (D12).              *)
CSend(t, g, c) ==
    /\ ~closed /\ Len(sent) < MaxReq
    /\ \E l \in Labels \ LabelsUsed :
         /\ sent' = Append(sent, [lab |-> l, txt |-> t, tgt |-> g, cmd |-> c])
         /\ order' = Append(order, l)
         /\ pendTxt' = [pendTxt EXCEPT ![l] = t]
         /\ pendTgt' = [pendTgt EXCEPT ![l] = g]
         /\ pendCmd' = [pendCmd EXCEPT ![l] = c]
         /\ pend' = [pend EXCEPT ![l] = "pending"]
         /\ owed' = owed \cup {l}
    /\ UNCHANGED <<ob, buf, closed, out, late, lateUsed, s2c, nextRef, otherDone, histDone,
                   labeledN, firstK, compet, by, cause, role, modConf, early, crossTimed,
                   crossDeliv, histSettled, kindCross>>
    /\ UNCHANGED <<hout, closeBuf>>

NLabeled(resp, l) == Len(SelectSeq(resp, LAMBDA m : m.lab = l))

FirstK(resp) ==
    LET I == {i \in 1..Len(resp) : resp[i].k \in Settling /\ resp[i].role = "resp"}
    IN IF I = {} THEN "none" ELSE resp[CHOOSE i \in I : \A j \in I : i <= j].k

(* Server answers a request by queueing its response; SEmit sends it line  *)
(* by line, so responses interleave (D16).  Conforming (LR-2/3/4, EM-1): a *)
(* labeled echo; a labeled batch holding the echo, after a note or not, or *)
(* inside an inner multiline batch (depth 2); a labeled FAIL or 4xx, alone *)
(* or in a batch.  A NOTICE gets no error reply.  A self-message adds an   *)
(* unlabeled delivered copy, before or after the response (LR-5, D20).     *)
(* Modify: the echo's text may be altered (EM-2), even to another copy's.  Competing (adversarial):*)
(* echo and FAIL in one batch, either order (D17).  Lossy (adversarial): a *)
(* lone ACK, a batch with no settling line, nothing, or nothing now and an *)
(* unlabeled echo later (D1).                                              *)
SAnswer(l) ==
    LET t == pendTxt[l]
        g == pendTgt[l]
        c == pendCmd[l]
        r == nextRef
        r2 == nextRef + 1
        L(k, lab, tx, id, ref, bt) == Ln(k, lab, tx, g, c, id, ref, bt, l, "resp")
    IN /\ ~closed /\ l \in owed /\ out[l] = << >>
       /\ owed' = owed \ {l}
       /\ nextRef' = nextRef + 2
       /\ \E et \in (IF Modify THEN Texts \cup {ModText} ELSE {t}), pre \in BOOLEAN :
          LET self == IF g = "self" THEN << Ln("echo", NoLabel, et, g, c, 0, 0, "none", l, "deliv") >>
                      ELSE << >>
              Wrap(core) == IF pre THEN self \o core ELSE core \o self
              bs == L("bstart", l, t, r, 0, "lr")
              be == L("bend", NoLabel, t, r, 0, "lr")
              M(k, tx) == L(k, NoLabel, tx, 0, r, "none")
              echo1 == << L("echo", l, et, 0, 0, "none") >>
              batch == << bs, M("echo", et), be >>
              noteB == << bs, M("note", t), M("echo", et), be >>
              nestB == << bs, L("bstart", NoLabel, t, r2, r, "multiline"),
                          L("echo", NoLabel, et, 0, r2, "none"),
                          L("bend", NoLabel, t, r2, r, "multiline"), be >>
              fail1 == << L("fail", l, t, 0, 0, "none") >>
              err1 == << L("err", l, t, 0, 0, "none") >>
              failB == << bs, M("fail", t), be >>
              noteFB == << bs, M("note", t), M("err", t), be >>
              echoFail == << bs, M("echo", et), M("fail", t), be >>
              failEcho == << bs, M("fail", t), M("echo", et), be >>
              ack1 == << L("ack", l, t, 0, 0, "none") >>
              partial == << bs, be >>
              Ok == {Wrap(echo1), Wrap(batch), Wrap(noteB), Wrap(nestB)}
              Bad == IF c = "NOTICE" THEN {} ELSE {fail1, err1, failB, noteFB}
              Comp == IF Competing /\ c # "NOTICE" THEN {Wrap(echoFail), Wrap(failEcho)} ELSE {}
              Lost == IF Lossy THEN {partial, ack1, << >>} ELSE {}
          IN \/ \E resp \in Ok \cup Bad \cup Comp \cup Lost :
                  /\ out' = [out EXCEPT ![l] = resp]
                  /\ firstK' = [firstK EXCEPT ![l] = FirstK(resp)]
                  /\ compet' = IF resp \in Comp THEN compet \cup {l} ELSE compet
                  /\ UNCHANGED <<late, lateUsed>>
             \/ /\ Lossy /\ lateUsed < MaxLate
                /\ late' = late \cup {l} /\ lateUsed' = lateUsed + 1
                /\ UNCHANGED <<out, firstK, compet>>
       /\ UNCHANGED <<sent, pendTxt, pendTgt, pendCmd, order, ob, buf, closed, s2c, otherDone,
                      histDone, labeledN>>
       /\ UNCHANGED client
    /\ UNCHANGED <<hout, closeBuf>>

(* The server emits the next line of a queued response.                     *)
SEmit(l) ==
    /\ ~closed /\ out[l] # << >>
    /\ s2c' = Append(s2c, Head(out[l]))
    /\ out' = [out EXCEPT ![l] = Tail(@)]
    /\ labeledN' = [labeledN EXCEPT ![l] = @ + (IF Head(out[l]).lab = l THEN 1 ELSE 0)]
    /\ UNCHANGED <<sent, pendTxt, pendTgt, pendCmd, order, ob, buf, closed, owed, late, lateUsed,
                   nextRef, otherDone, histDone, firstK, compet>>
    /\ UNCHANGED client
    /\ UNCHANGED <<hout, closeBuf>>

(* The late reply of LR:81: the echo, with no label.                       *)
SLate(l) ==
    /\ ~closed /\ l \in late
    /\ late' = late \ {l}
    /\ \E et \in (IF Modify THEN {pendTxt[l], ModText} ELSE {pendTxt[l]}) :     \* EM-2, D20
         s2c' = Append(s2c, Ln("echo", NoLabel, et, pendTgt[l], pendCmd[l], 0, 0, "none", l, "late"))
    /\ UNCHANGED <<sent, pendTxt, pendTgt, pendCmd, order, ob, buf, closed, owed, out, lateUsed,
                   nextRef, otherDone, histDone, labeledN, firstK, compet>>
    /\ UNCHANGED client
    /\ UNCHANGED <<hout, closeBuf>>

(* Another session of the account says the same text to the channel (D15). *)
SOther(t) ==
    /\ ~closed /\ OtherSession /\ ~otherDone
    /\ otherDone' = TRUE
    /\ s2c' = Append(s2c, Ln("echo", NoLabel, t, "chan", "PRIVMSG", 0, 0, "none", "other", "other"))
    /\ UNCHANGED <<sent, pendTxt, pendTgt, pendCmd, order, ob, buf, closed, owed, out, late,
                   lateUsed, nextRef, histDone, labeledN, firstK, compet>>
    /\ UNCHANGED client
    /\ UNCHANGED <<hout, closeBuf>>

(* A history replay holding a same-text line from our nick (D19): an         *)
(* unlabeled history batch, one nested in the labeled response to a           *)
(* CHATHISTORY request, or a history batch carrying that request's label.     *)
SHistory(t, form) ==
    LET r == nextRef
        r2 == nextRef + 1
        H(k, lab, id, ref, bt) == Ln(k, lab, t, "chan", "PRIVMSG", id, ref, bt, "hist", "hist")
        lines == CASE form = "nested" ->
                        << H("bstart", HistLabel, r, 0, "lr"), H("bstart", NoLabel, r2, r, "history"),
                           H("echo", NoLabel, 0, r2, "none"), H("bend", NoLabel, r2, r, "history"),
                           H("bend", NoLabel, r, 0, "lr") >>
                   [] form = "direct" ->
                        << H("bstart", HistLabel, r, 0, "history"), H("echo", NoLabel, 0, r, "none"),
                           H("bend", NoLabel, r, 0, "history") >>
                   [] OTHER ->
                        << H("bstart", NoLabel, r, 0, "history"), H("echo", NoLabel, 0, r, "none"),
                           H("bend", NoLabel, r, 0, "history") >>
    IN /\ ~closed /\ History /\ histDone = "none"
       /\ histDone' = form /\ nextRef' = nextRef + 2
       /\ hout' = lines /\ UNCHANGED <<s2c, closeBuf>>
       /\ UNCHANGED <<sent, pendTxt, pendTgt, pendCmd, order, ob, buf, closed, owed, out, late,
                      lateUsed, otherDone, labeledN, firstK, compet>>
       /\ UNCHANGED client

(* The server emits the next history line (v2.2: so live lines can fall     *)
(* between them, BA:93-98).                                                *)
SEmitHist ==
    /\ ~closed /\ hout # << >>
    /\ s2c' = Append(s2c, Head(hout))
    /\ hout' = Tail(hout)
    /\ UNCHANGED <<sent, pendTxt, pendTgt, pendCmd, order, ob, buf, closed, owed, out, late,
                   lateUsed, nextRef, otherDone, histDone, closeBuf, labeledN, firstK, compet>>
    /\ UNCHANGED client

-----------------------------------------------------------------------------
(* The client's handling of lines (D15, D16, D19).                          *)
Pending(p, l) == l \in LabelsUsed /\ p[l] = "pending"

\* The oldest pending copy with text t, target g and kind c, or NoLabel.
Oldest(p, t, g, c) ==
    LET I == {i \in 1..Len(order) : Pending(p, order[i]) /\ pendTxt[order[i]] = t
                                    /\ pendTgt[order[i]] = g /\ pendCmd[order[i]] = c}
    IN IF I = {} THEN NoLabel ELSE order[CHOOSE i \in I : \A j \in I : i <= j]

\* The most recently opened batch (used only by the mutant DM_LastOpened).
LastOpen == CHOOSE r \in RefIds : ob[r].on /\ \A q \in RefIds : ob[q].on => q <= r

\* A line's label: its own, else that of the batch it is in (inherited at open).
EffLab(m) == IF m.lab # NoLabel THEN m.lab
             ELSE IF m.ref # 0 /\ ob[m.ref].on THEN ob[m.ref].lab ELSE NoLabel
\* Whether a line is inside a history batch, at any depth.
HistOf(m) == m.ref # 0 /\ ob[m.ref].on /\ ob[m.ref].hist

\* The client's state the handling of one line updates.
Now == [p |-> pend, b |-> by, c |-> cause, r |-> role, mc |-> modConf, e |-> early,
        x |-> crossTimed, d |-> crossDeliv, h |-> histSettled, kc |-> kindCross]

\* Settle l as outcome o by line m; terminal outcomes absorb (D13).  `oa`: the
\* line's root batch is still open after this step.
Settle(s, l, o, m, oa) ==
    IF l # NoLabel /\ Pending(s.p, l)
    THEN [p  |-> [s.p EXCEPT ![l] = o],
          b  |-> [s.b EXCEPT ![l] = IF m.who = l THEN "own" ELSE m.who],
          c  |-> [s.c EXCEPT ![l] = m.k],
          r  |-> [s.r EXCEPT ![l] = m.role],
          mc |-> IF o = "confirmed" /\ m.txt # pendTxt[l] THEN s.mc \cup {l} ELSE s.mc,
          e  |-> s.e \/ (Deferred /\ oa),
          x  |-> s.x \/ (m.who \in Labels /\ m.who # l /\ s.p[m.who] = "timedout"),
          d  |-> s.d \/ (m.role = "deliv" /\ m.who \in Labels /\ m.who # l
                         /\ s.p[m.who] = "confirmed" /\ s.b[m.who] = "own" /\ s.r[m.who] = "resp"),
          h  |-> s.h \/ (m.role = "hist"),
          kc |-> s.kc \/ (m.k = "echo" /\ m.cmd # pendCmd[l])]
    ELSE s

\* Handle one line with effective label `lab`.  History lines settle nothing (D19).
Handle(m, lab, hist, oa, s) ==
    IF FALSE THEN s
    ELSE CASE m.k = "echo" /\ lab # NoLabel -> Settle(s, lab, "confirmed", m, oa)
           [] m.k = "echo" /\ Fallback -> Settle(s, Oldest(s.p, m.txt, m.tgt, m.cmd), "confirmed", m, oa)
           [] m.k = "ack" -> Settle(s, lab, "accepted", m, oa)
           [] m.k \in {"fail", "err"} -> Settle(s, lab, "failed", m, oa)
           [] OTHER -> s

\* Deferred: process every buffered line, in order (BA:55, BA:63).
RECURSIVE HandleAll(_, _)
HandleAll(items, s) ==
    IF items = << >> THEN s
    ELSE HandleAll(Tail(items), Handle(Head(items).m, Head(items).lab, Head(items).hist, FALSE, s))

Apply(s) ==
    /\ pend' = s.p /\ by' = s.b /\ cause' = s.c /\ role' = s.r /\ modConf' = s.mc
    /\ early' = s.e /\ crossTimed' = s.x /\ crossDeliv' = s.d /\ histSettled' = s.h
    /\ kindCross' = s.kc

(* The client reads the next line.                                         *)
CRecv ==
    /\ ~closed /\ s2c # << >>
    /\ LET m == Head(s2c) IN
       /\ s2c' = Tail(s2c)
       /\ CASE m.k = "bstart" ->
                 /\ ob' = [ob EXCEPT ![m.id] =
                             [on |-> TRUE, lab |-> EffLab(m),
                              root |-> IF m.ref = 0 THEN m.id ELSE ob[m.ref].root,
                              hist |-> m.bt = "history" \/ HistOf(m)]]
                 /\ UNCHANGED buf
                 /\ UNCHANGED client
            [] m.k = "bend" ->
                 /\ ob' = [ob EXCEPT ![m.id] = NoRec]
                 /\ IF Deferred /\ ob[m.id].root = m.id
                    THEN /\ Apply(HandleAll(buf[m.id], Now))
                         /\ buf' = [buf EXCEPT ![m.id] = << >>]
                    ELSE /\ UNCHANGED buf
                         /\ UNCHANGED client
            [] m.ref # 0 /\ Deferred ->
                 /\ buf' = [buf EXCEPT ![ob[m.ref].root] =
                              Append(@, [m |-> m, lab |-> EffLab(m), hist |-> HistOf(m)])]
                 /\ UNCHANGED ob
                 /\ UNCHANGED client
            [] OTHER ->
                 /\ Apply(Handle(m, EffLab(m), HistOf(m), m.ref # 0, Now))
                 /\ UNCHANGED <<ob, buf>>
    /\ UNCHANGED <<sent, pendTxt, pendTgt, pendCmd, order, closed, otherDone, histDone>>
    /\ UNCHANGED server
    /\ UNCHANGED <<hout, closeBuf>>

(* The client's timeout fires for a pending copy (D13).                    *)
CTimeout(l) ==
    /\ ~closed /\ TimeoutOn /\ Pending(pend, l)
    /\ pend' = [pend EXCEPT ![l] = "timedout"]
    /\ cause' = [cause EXCEPT ![l] = "timeout"]
    /\ UNCHANGED <<sent, pendTxt, pendTgt, pendCmd, order, ob, buf, closed, s2c, otherDone, histDone>>
    /\ UNCHANGED server
    /\ UNCHANGED <<by, role, modConf, early, crossTimed, crossDeliv, histSettled, kindCross>>
    /\ UNCHANGED <<hout, closeBuf>>

(* The connection closes (D18): pending copies fail; nothing more arrives. *)
CClose ==
    /\ CloseOn /\ ~closed
    /\ closed' = TRUE
    /\ pend' = [l \in Labels |-> IF Pending(pend, l) THEN "failed" ELSE pend[l]]
    /\ cause' = [l \in Labels |-> IF Pending(pend, l) THEN "close" ELSE cause[l]]
    /\ s2c' = << >>
    /\ out' = [l \in Labels |-> << >>]
    /\ ob' = [r \in RefIds |-> NoRec]
    /\ buf' = [r \in RefIds |-> << >>]
    /\ hout' = << >>
    /\ closeBuf' = \E r \in RefIds : buf[r] # << >>
    /\ UNCHANGED <<sent, pendTxt, pendTgt, pendCmd, order, owed, late, lateUsed, nextRef,
                   otherDone, histDone, labeledN, firstK, compet>>
    /\ UNCHANGED <<by, role, modConf, early, crossTimed, crossDeliv, histSettled, kindCross>>

-----------------------------------------------------------------------------
Next ==
    \/ \E t \in Texts, g \in Targets, c \in Cmds : CSend(t, g, c)
    \/ \E t \in Texts : SOther(t) \/ \E f \in {"plain", "nested", "direct"} : SHistory(t, f)
    \/ \E l \in Labels : SAnswer(l) \/ SEmit(l) \/ SLate(l) \/ CTimeout(l)
    \/ SEmitHist
    \/ CRecv
    \/ CClose

\* D13 fairness: per request, the server's answer, its emission, the late
\* reply and the timeout; and the client's reading.  Restrictions, not text
\* guarantees.  Close has no fairness: it may never happen.
Fairness ==
    /\ \A l \in Labels : WF_vars(SAnswer(l)) /\ WF_vars(SEmit(l)) /\ WF_vars(SLate(l))
                         /\ WF_vars(CTimeout(l))
    /\ WF_vars(SEmitHist) /\ WF_vars(CRecv)

Spec == Init /\ [][Next]_vars /\ Fairness

-----------------------------------------------------------------------------
(* Properties (DESIGN.md).                                                 *)
Kinds == {"bstart", "bend", "echo", "ack", "fail", "err", "note"}
TypeOK ==
    /\ \A l \in Labels : pend[l] \in Outcomes /\ labeledN[l] \in 0..3
    /\ Len(sent) <= MaxReq /\ lateUsed <= MaxLate
    /\ owed \subseteq Labels /\ late \subseteq Labels
    /\ \A i \in 1..Len(s2c) : s2c[i].k \in Kinds /\ s2c[i].ref \in {0} \cup RefIds
    /\ \A r \in RefIds : ob[r].on => (ob[r].root \in RefIds /\ ob[ob[r].root].on)
    /\ \A r \in RefIds : ~ob[r].on => buf[r] = << >>
    /\ closed => s2c = << >>

\* D2: at most one labeled line per label over the whole run.
LabelOnce == \A l \in Labels : labeledN[l] <= 1

\* D15: a copy is confirmed only by a line answering its own request.
ConfirmedByOwn == \A l \in LabelsUsed : pend[l] = "confirmed" => by[l] = "own"

\* Each outcome matches the kind of line or event that settled it (D18: close).
OutcomeMatchesCause ==
    \A l \in LabelsUsed :
        /\ pend[l] = "confirmed" => cause[l] = "echo"
        /\ pend[l] = "failed"    => cause[l] \in {"fail", "err", "close"}
        /\ pend[l] = "accepted"  => cause[l] = "ack"
        /\ pend[l] = "timedout"  => cause[l] = "timeout"

\* D17: settled by its own response, the outcome follows its first settling line.
FirstWins ==
    \A l \in LabelsUsed :
        (pend[l] \in {"confirmed", "failed", "accepted"} /\ by[l] = "own" /\ role[l] = "resp")
            => cause[l] = firstK[l]

\* BA:55/63: under Deferred, nothing is settled while its root batch is open.
DeferredWaits == ~early
NoCrossFromTimedOut == ~crossTimed
\* D15 self-copy chronology: A's own echo confirmed A, then A's delivered copy settled B.
NoCrossFromConfirmedDeliv == ~crossDeliv
\* D19.
HistoryNeverSettles == ~histSettled
\* D20.
SameKind == ~kindCross

\* D13: terminal outcomes absorb (an action property).
Absorbing == [][\A l \in Labels : pend[l] # "pending" => pend'[l] = pend[l]]_vars

\* The outcome each settling kind must give (D15).
Expect(k) == CASE k = "echo" -> "confirmed" [] k = "ack" -> "accepted" [] OTHER -> "failed"

\* D21: reading a settling line of a pending copy's own response gives that
\* copy the line's outcome in that step.  v2.2: the response is told from the
\* wire's provenance (who, role), not from the client's EffLab or HistOf.
ImmediateObligation ==
    [][ ( ~closed /\ ~closed' /\ s2c # << >> /\ s2c' = Tail(s2c)
          /\ Head(s2c).k \in Settling /\ (Head(s2c).ref = 0 \/ ~Deferred)
          /\ Head(s2c).role = "resp" /\ Pending(pend, Head(s2c).who) )
        => pend'[Head(s2c).who] = Expect(Head(s2c).k) ]_vars

\* D21: at the root batch's end, every pending copy with a buffered eligible
\* settling line gets the outcome of the first such line, in that step.
Eligible(it, l) == it.lab = l /\ it.m.k \in Settling /\ ~it.hist
DeferredObligation ==
    [][ ( Deferred /\ ~closed /\ ~closed' /\ s2c # << >> /\ s2c' = Tail(s2c)
          /\ Head(s2c).k = "bend" /\ ob[Head(s2c).id].on /\ ob[Head(s2c).id].root = Head(s2c).id )
        => LET B == buf[Head(s2c).id] IN
           \A l \in LabelsUsed :
             LET I == {i \in 1..Len(B) : Eligible(B[i], l)}
             IN (pend[l] = "pending" /\ I # {})
                => pend'[l] = Expect(B[CHOOSE i \in I : \A j \in I : i <= j].m.k) ]_vars

\* Every sent copy eventually leaves "pending".
PendingResolves == \A l \in Labels : (l \in LabelsUsed) ~> (pend[l] # "pending")

\* With Lossy, close and timeout off: resolved by its response, confirmed or failed.
ResolvedByResponse ==
    \A l \in Labels : (l \in LabelsUsed) ~> (pend[l] \in {"confirmed", "failed"})

\* Cover invariants: each must be violated in some config.
OpenRefs == {r \in RefIds : ob[r].on}
CoverBatchOpen  == OpenRefs = {}
CoverLateQueued == late = {}
CoverTimedOut   == \A l \in Labels : pend[l] # "timedout"
CoverOtherSaid  == ~otherDone
CoverEchoInOpenBatch == ~\E r \in RefIds : \E i \in 1..Len(buf[r]) : buf[r][i].m.k = "echo"
CoverCrossTimed == ~crossTimed
CoverSelfSent   == \A i \in 1..Len(sent) : sent[i].tgt # "self"
CoverTwoOpen    == ~\E r1, r2 \in OpenRefs : ob[r1].root # ob[r2].root
                                             /\ ob[r1].lab \in Labels /\ ob[r2].lab \in Labels
CoverNested     == ~\E r \in OpenRefs : ob[r].root # r
CoverClosedPending == ~\E l \in LabelsUsed : cause[l] = "close"
CoverHistorySeen == ~\E r \in OpenRefs : ob[r].hist
CoverCompeting  == ~\E l \in compet : pend[l] # "pending" /\ role[l] = "resp"
CoverModified   == modConf = {}
CoverDelivFirst == ~\E l \in LabelsUsed : role[l] = "deliv" /\ by[l] = "own"
CoverNotice     == \A i \in 1..Len(sent) : sent[i].cmd # "NOTICE"
CoverTimeoutInOpenBatch == ~\E r \in OpenRefs : ob[r].lab \in Labels /\ pend[ob[r].lab] = "timedout"
\* v2.2 covers (MODEL-REVIEW-3).
Drained(l) == out[l] = << >> /\ (~\E i \in 1..Len(s2c) : s2c[i].who = l)
              /\ \A r \in RefIds : ~\E j \in 1..Len(buf[r]) : buf[r][j].m.who = l
CoverEchoInHist == ~\E r \in OpenRefs : ob[r].hist /\ s2c # << >> /\ Head(s2c).k = "echo"
                                         /\ Head(s2c).role = "resp" /\ Head(s2c).ref = 0
HistConsumed(f) == histDone = f /\ hout = << >> /\ ~\E i \in 1..Len(s2c) : s2c[i].role = "hist"
CoverHistPlain  == ~HistConsumed("plain")
CoverHistNested == ~HistConsumed("nested")
CoverHistDirect == ~HistConsumed("direct")
CoverCompEchoFirst == ~\E l \in compet : firstK[l] = "echo" /\ Drained(l) /\ pend[l] = "confirmed"
CoverCompFailFirst == ~\E l \in compet : firstK[l] = "fail" /\ Drained(l) /\ pend[l] = "failed"
CoverTimeoutBuffered == ~\E r \in RefIds : \E i \in 1..Len(buf[r]) :
                           buf[r][i].lab \in Labels /\ pend[buf[r][i].lab] = "timedout"
CoverCloseBuf == ~closeBuf
CoverModLate == ~\E i \in 1..Len(s2c) : s2c[i].role = "late" /\ s2c[i].txt = ModText
=============================================================================
