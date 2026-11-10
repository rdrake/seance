---------------------------- MODULE DS_Twice ----------------------------
(***************************************************************************)
(* Delivery of the client's own messages: labeled-response (LR),          *)
(* echo-message (EM) and batch (BA), with the checked client's pending    *)
(* copies (D15).  Decisions: ../DECISIONS.md D1, D2, D12, D13, D15.        *)
(*                                                                         *)
(* v1 (after MODEL-REVIEW-1):                                              *)
(*   - every request is a PRIVMSG, to the channel or (SelfMsg) to the     *)
(*     client's own nick, with a fresh label;                              *)
(*   - a multi-line response is one `labeled-response` batch (depth 1);    *)
(*     two interleaved open batches, connection close and NOTICE are v2;   *)
(*   - another session of the same account may send the same text (D15).   *)
(* Responses are appended whole, so batches never interleave in v1.        *)
(***************************************************************************)
EXTENDS Naturals, Sequences, FiniteSets, TLC

CONSTANTS
    Labels,        \* the label pool, fresh per request, never recycled (D12)
    Texts,         \* message texts; two, so the content fallback can confuse
    MaxReq,        \* requests the client sends
    Lossy,         \* D1, adversarial
    Deferred,      \* D2: process a batch at its end, not line by line (BA:55)
    Fallback,      \* D15: an unlabeled echo settles the oldest copy with the same text
    OtherSession,  \* D15: another session may send the same text
    SelfMsg,       \* LR-5: the client may message its own nick
    TimeoutOn      \* D13: the client's timeout exists

NoLabel == "none"
Outcomes == {"pending", "confirmed", "accepted", "failed", "timedout"}
Targets == IF SelfMsg THEN {"chan", "self"} ELSE {"chan"}

\* Server-to-client lines.  `lab` is the label tag; `ref` is the batch the line
\* belongs to (0 = none), or for bstart/bend the batch's own reference; `tgt`
\* the buffer it lands in; `who` is the ghost: the request it answers, or "other".
Line(k, lab, txt, tgt, ref, who) ==
    [k |-> k, lab |-> lab, txt |-> txt, tgt |-> tgt, ref |-> ref, who |-> who]

VARIABLES
    sent,       \* client: requests sent, a sequence of [lab, txt, tgt]
    pend,       \* client: label -> outcome
    pendTxt,    \* client: label -> text
    pendTgt,    \* client: label -> target buffer
    order,      \* client: labels in send order (for "the oldest copy")
    open,       \* client: the open batch [ref, lab, lines], or NoBatch
    owed,       \* server: labels of requests not yet answered
    late,       \* server: labels whose unlabeled late reply is still to come (Lossy)
    s2c,        \* the wire
    nextRef,    \* server: batch references
    labeledN,   \* ghost: label -> labeled lines sent for it, whole run (D2)
    by,         \* ghost: label -> whose line settled it ("own", a label, "other", "none")
    cause,      \* ghost: label -> the kind of line or event that settled it
    early,      \* ghost: a copy was settled by a line of a batch still open (Deferred)
    crossTimed, \* ghost: a timed-out request's line settled another copy
    otherDone   \* environment: the other session has spoken (once)

vars == <<sent, pend, pendTxt, pendTgt, order, open, owed, late, s2c, nextRef,
          labeledN, by, cause, early, crossTimed, otherDone>>
ghosts == <<labeledN, by, cause, early, crossTimed>>

NoBatch == [ref |-> 0, lab |-> NoLabel, lines |-> << >>]

LabelsUsed == {sent[i].lab : i \in 1..Len(sent)}

Init ==
    /\ sent = << >> /\ order = << >>
    /\ pend = [l \in Labels |-> "pending"]
    /\ pendTxt = [l \in Labels |-> CHOOSE t \in Texts : TRUE]
    /\ pendTgt = [l \in Labels |-> "chan"]
    /\ open = NoBatch
    /\ owed = {} /\ late = {} /\ s2c = << >> /\ nextRef = 1
    /\ labeledN = [l \in Labels |-> 0] /\ by = [l \in Labels |-> "none"]
    /\ cause = [l \in Labels |-> "none"] /\ early = FALSE /\ crossTimed = FALSE
    /\ otherDone = FALSE

-----------------------------------------------------------------------------
(* Client sends a PRIVMSG with a fresh label (D12).                        *)
CSend(t, g) ==
    /\ Len(sent) < MaxReq
    /\ \E l \in Labels \ LabelsUsed :
         /\ sent' = Append(sent, [lab |-> l, txt |-> t, tgt |-> g])
         /\ order' = Append(order, l)
         /\ pendTxt' = [pendTxt EXCEPT ![l] = t]
         /\ pendTgt' = [pendTgt EXCEPT ![l] = g]
         /\ pend' = [pend EXCEPT ![l] = "pending"]
         /\ owed' = owed \cup {l}
    /\ UNCHANGED <<open, late, s2c, nextRef, otherDone>> /\ UNCHANGED ghosts

\* Labeled lines in a response, for the D2 count.
NLabeled(resp, l) == Len(SelectSeq(resp, LAMBDA m : m.lab = l))

(* Server answers a request.  Conforming responses (LR-2/3/4, EM-1): one   *)
(* labeled echo; a labeled batch holding the echo; a labeled FAIL, alone   *)
(* or in a batch; either of those batches with a non-settling line first.  A message to one's own nick is also delivered, as an    *)
(* unlabeled copy (LR-5).  Lossy (adversarial) adds: a lone ACK, a partial *)
(* batch with no echo, nothing, or nothing now and an unlabeled echo later *)
(* (D1).                                                                   *)
SAnswer(l) ==
    LET t == pendTxt[l]
        g == pendTgt[l]
        r == nextRef
        selfCopy == IF g = "self" THEN << Line("echo", NoLabel, t, g, 0, l) >> ELSE << >>
        echo1 == << Line("echo", l, t, g, 0, l) >> \o selfCopy
        batch == << Line("bstart", l, t, g, r, l), Line("echo", NoLabel, t, g, r, l),
                    Line("bend", NoLabel, t, g, r, l) >> \o selfCopy
        partial == << Line("bstart", l, t, g, r, l), Line("bend", NoLabel, t, g, r, l) >>
        fail1 == << Line("fail", l, t, g, 0, l) >>
        failB == << Line("bstart", l, t, g, r, l), Line("fail", NoLabel, t, g, r, l),
                    Line("bend", NoLabel, t, g, r, l) >>
        \* A non-settling inner line (a numeric or NOTE) ahead of the settling one,
        \* so deferred handling must process past the first buffered line.
        noteB == << Line("bstart", l, t, g, r, l), Line("note", NoLabel, t, g, r, l),
                    Line("echo", NoLabel, t, g, r, l), Line("bend", NoLabel, t, g, r, l) >> \o selfCopy
        noteFB == << Line("bstart", l, t, g, r, l), Line("note", NoLabel, t, g, r, l),
                     Line("fail", NoLabel, t, g, r, l), Line("bend", NoLabel, t, g, r, l) >>
        ack1 == << Line("ack", l, t, g, 0, l) >>
        Full == {echo1, batch, fail1, failB, noteB, noteFB}
        Lost == {partial, ack1, << >>}
    IN /\ l \in owed
       /\ owed' = owed
       /\ \/ \E resp \in Full \cup (IF Lossy THEN Lost ELSE {}) :
                /\ s2c' = s2c \o resp
                /\ labeledN' = [labeledN EXCEPT ![l] = @ + NLabeled(resp, l)]
                /\ UNCHANGED late
          \/ /\ Lossy
             /\ late' = late \cup {l}
             /\ UNCHANGED <<s2c, labeledN>>
       /\ nextRef' = nextRef + 1
       /\ UNCHANGED <<sent, pend, pendTxt, pendTgt, order, open, by, cause, early, crossTimed, otherDone>>

(* The late reply of LR:81: the echo, with no label.                       *)
SLate(l) ==
    /\ l \in late
    /\ late' = late \ {l}
    /\ s2c' = Append(s2c, Line("echo", NoLabel, pendTxt[l], pendTgt[l], 0, l))
    /\ UNCHANGED <<sent, pend, pendTxt, pendTgt, order, open, owed, nextRef, otherDone>>
    /\ UNCHANGED ghosts

(* Another session of the account says the same text to the channel (D15). *)
SOther(t) ==
    /\ OtherSession /\ ~otherDone
    /\ otherDone' = TRUE
    /\ s2c' = Append(s2c, Line("echo", NoLabel, t, "chan", 0, "other"))
    /\ UNCHANGED <<sent, pend, pendTxt, pendTgt, order, open, owed, late, nextRef>>
    /\ UNCHANGED ghosts

-----------------------------------------------------------------------------
(* The client's handling of lines (D15).                                    *)
Pending(p, l) == l \in LabelsUsed /\ p[l] = "pending"

\* The oldest pending copy with text t in buffer g, or NoLabel.
Oldest(p, t, g) ==
    LET c == {i \in 1..Len(order) : Pending(p, order[i]) /\ pendTxt[order[i]] = t
                                    /\ pendTgt[order[i]] = g}
    IN IF c = {} THEN NoLabel ELSE order[CHOOSE i \in c : \A j \in c : i <= j]

\* The client's state the handling of one line updates.
St(p, b, c, x) == [p |-> p, b |-> b, c |-> c, x |-> x]

\* Settle label l as outcome o by line m; terminal outcomes absorb (D13).
Settle(s, l, o, m) ==
    IF l # NoLabel /\ Pending(s.p, l)
    THEN St([s.p EXCEPT ![l] = o],
            [s.b EXCEPT ![l] = IF m.who = l THEN "own" ELSE m.who],
            [s.c EXCEPT ![l] = m.k],
            s.x \/ (m.who \in Labels /\ m.who # l /\ s.p[m.who] = "timedout"))
    ELSE s

\* Process one line; an inner line takes its batch's label (`blab`).
Handle(m, blab, s) ==
    LET lab == IF m.lab # NoLabel THEN m.lab ELSE blab
    IN CASE m.k = "echo" /\ lab # NoLabel -> Settle(s, lab, "confirmed", m)
         [] m.k = "echo" /\ Fallback -> Settle(s, Oldest(s.p, m.txt, m.tgt), "confirmed", m)
         [] m.k = "ack" -> Settle(s, lab, "accepted", m)
         [] m.k = "fail" -> Settle(s, lab, "failed", m)  \* inside a batch: the batch's label
         [] OTHER -> s

\* Deferred: process every buffered line, in order (BA:55), at the batch end.
RECURSIVE HandleAll(_, _, _)
HandleAll(ls, blab, s) ==
    IF ls = << >> THEN s ELSE HandleAll(Tail(ls), blab, Handle(Head(ls), blab, s))

Now == St(pend, by, cause, crossTimed)

Apply(s) == /\ pend' = s.p /\ by' = s.b /\ cause' = s.c /\ crossTimed' = s.x

(* The client reads the next line.                                         *)
CRecv ==
    /\ s2c # << >>
    /\ LET m == Head(s2c) IN
       /\ s2c' = Tail(s2c)
       /\ CASE m.k = "bstart" ->
                 /\ open' = [ref |-> m.ref, lab |-> m.lab, lines |-> << >>]
                 /\ UNCHANGED <<pend, by, cause, early, crossTimed>>
            [] m.k = "bend" ->
                 /\ open' = NoBatch
                 /\ Apply(IF Deferred THEN HandleAll(open.lines, open.lab, Now) ELSE Now)
                 /\ UNCHANGED early
            [] m.ref # 0 /\ Deferred ->
                 /\ open' = [open EXCEPT !.lines = Append(@, m)]
                 /\ UNCHANGED <<pend, by, cause, early, crossTimed>>
            [] OTHER ->
                 /\ LET s == Handle(m, IF m.ref # 0 THEN open.lab ELSE NoLabel, Now)
                    IN /\ Apply(s)
                       /\ early' = (early \/ (Deferred /\ m.ref # 0 /\ s.p # pend))
                 /\ UNCHANGED open
    /\ UNCHANGED <<sent, pendTxt, pendTgt, order, owed, late, nextRef, labeledN, otherDone>>

(* The client's timeout fires for a pending copy (D13).                    *)
CTimeout(l) ==
    /\ TimeoutOn /\ Pending(pend, l)
    /\ pend' = [pend EXCEPT ![l] = "timedout"] /\ cause' = [cause EXCEPT ![l] = "timeout"]
    /\ UNCHANGED <<sent, pendTxt, pendTgt, order, open, owed, late, s2c, nextRef, otherDone>>
    /\ UNCHANGED <<labeledN, by, early, crossTimed>>

-----------------------------------------------------------------------------
Next ==
    \/ \E t \in Texts : (\E g \in Targets : CSend(t, g)) \/ SOther(t)
    \/ \E l \in Labels : SAnswer(l) \/ SLate(l) \/ CTimeout(l)
    \/ CRecv

\* D13 fairness: per request, the server's answer, the late reply and the
\* timeout; and the client's reading.  All restrictions, not text guarantees.
Fairness ==
    /\ \A l \in Labels : WF_vars(SAnswer(l)) /\ WF_vars(SLate(l)) /\ WF_vars(CTimeout(l))
    /\ WF_vars(CRecv)

Spec == Init /\ [][Next]_vars /\ Fairness

-----------------------------------------------------------------------------
(* Properties (DESIGN.md).                                                 *)
TypeOK ==
    /\ \A l \in Labels : pend[l] \in Outcomes /\ labeledN[l] \in 0..3
    /\ Len(sent) <= MaxReq
    /\ owed \subseteq Labels /\ late \subseteq Labels

\* D2: at most one labeled line per label over the whole run.  A batch's
\* label is on its start only, so this is one labeled logical response.
LabelOnce == \A l \in Labels : labeledN[l] <= 1

\* D15: a copy is confirmed only by a line answering its own request.
ConfirmedByOwn == \A l \in LabelsUsed : pend[l] = "confirmed" => by[l] = "own"

\* Review 5: each outcome matches the kind of line or event that settled it.
OutcomeMatchesCause ==
    \A l \in LabelsUsed :
        /\ pend[l] = "confirmed" => cause[l] = "echo"
        /\ pend[l] = "failed"    => cause[l] = "fail"
        /\ pend[l] = "accepted"  => cause[l] = "ack"
        /\ pend[l] = "timedout"  => cause[l] = "timeout"

\* BA:55: under Deferred, nothing is settled by a line of a batch still open.
DeferredWaits == ~early

\* Review 1 of the model: no timed-out request's line settled another copy.
NoCrossFromTimedOut == ~crossTimed

\* D13: terminal outcomes absorb (an action property).
Absorbing == [][\A l \in Labels : pend[l] # "pending" => pend'[l] = pend[l]]_vars

\* Every sent copy eventually leaves "pending".
PendingResolves == \A l \in Labels : (l \in LabelsUsed) ~> (pend[l] # "pending")

\* With Lossy off and no timeout: resolved by its response, confirmed or failed.
ResolvedByResponse ==
    \A l \in Labels : (l \in LabelsUsed) ~> (pend[l] \in {"confirmed", "failed"})

\* Cover invariants: each must be violated in some config.
CoverBatchOpen  == open.ref = 0
CoverLateQueued == late = {}
CoverTimedOut   == \A l \in Labels : pend[l] # "timedout"
CoverOtherSaid  == ~otherDone
CoverEchoInOpenBatch == ~(open.ref # 0 /\ \E i \in 1..Len(open.lines) : open.lines[i].k = "echo")
CoverCrossTimed == ~crossTimed
CoverSelfSent   == \A i \in 1..Len(sent) : sent[i].tgt # "self"
=============================================================================
