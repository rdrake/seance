------------------------------- MODULE Session -------------------------------
(***************************************************************************)
(* Cold start against a held session (draft/persistence): when Seance     *)
(* sends its own JOIN and its own catch-up, relative to the server's       *)
(* restoration batch.  The race behind D34 item 2 / #282.                  *)
(*                                                                         *)
(* Client = Seance develop febe817b6 (#282):                                *)
(*   client/js/irc/persistence.ts  awaitRestoration, noteRestorationActivity,*)
(*     arm (the clamp to the deadline), persistenceBatch, serverReplayCovers*)
(*   client/js/irc/handlers/batch.ts  interceptBatchLine, the BATCH opener *)
(*     and closer (each one restoration activity when inRestoration)       *)
(*   client/js/irc/client.ts  the end of registration (awaitRestoration),  *)
(*     restorationSettled, autojoin (one JOIN, prefetch for the active     *)
(*     channel), handleMessage's selfJoin -> enqueueCatchup unless         *)
(*     serverReplayCovers                                                  *)
(*   client/js/irc/handlers/join.ts, standard-replies.ts (NOTE BOUNCER):   *)
(*     noteRestorationActivity                                              *)
(*   client/js/irc/catchup.ts  prefetchCatchup, enqueueCatchup (a channel  *)
(*     prefetched with its JOIN is not walked again at the echo)           *)
(* Server = nefarious2 bounce_setup_local_alias / bounce_send_channel_state*)
(*   (NOTE BOUNCER, then BATCH +p draft/persistence: per channel JOIN,     *)
(*   topic, MARKREAD, NAMES; BATCH -p) and replay.c (the ATTACH cursor's   *)
(*   evilnet.github.io/bouncer-replay batch, after the restoration).       *)
(*                                                                         *)
(* Time is discrete: one Tick is one unit (250 ms in the real-ratio        *)
(* configs: Quiet 3 = 750 ms, InitialWait 8 = 2 s, Cap 32 = 8 s).  Network *)
(* delay is the interleaving of Tick and Deliver, bounded by MaxGap: at    *)
(* most MaxGap ticks pass between two server lines (and before the first) *)
(* unless the server stalls (StallOK) or never closes the batch (Endless).*)
(* A timer due at tick t fires at t, before time moves on, but a line     *)
(* arriving at t may be read before or after it (same-ms event order).    *)
(*                                                                         *)
(* Message contents are abstract: a line is its kind, its channel and     *)
(* whether it sits in a nested batch.  Only what decides when the client  *)
(* acts is kept.                                                           *)
(*                                                                         *)
(* Rule switches (the real code is Rule = "pr282", CloseActivity, HasCap):*)
(*   Rule "pre282": only NOTE BOUNCER (and processed JOINs) count as       *)
(*     activity; lines inside the batch do not (develop before #282).     *)
(*   Rule "open":   the timer may not fire while the restoration batch is *)
(*     open (until the cap): open-batch tracking, which #282 does not do. *)
(*   CloseActivity FALSE: a nested batch's closer is not activity (#282's *)
(*     review finding).                                                    *)
(*   HasCap FALSE: no RESTORE_MAX_WAIT_MS.                                 *)
(***************************************************************************)
EXTENDS Integers, Sequences, FiniteSets

CONSTANTS
    Chans,        \* the autojoin channels (all PARTED at the cold start)
    RestoredSeq,  \* the channels the server restores, in its order
    Nested,       \* restored channels whose lines come in a nested batch
    Active,       \* the channel the user is looking at, or "none"
    Alias,        \* NOTE BOUNCER ALIAS_ATTACHED precedes the batch
    Cursor,       \* ATTACH cursor taken: serverReplay, and a bouncer-replay follows
    Quiet,        \* RESTORE_QUIET_MS in ticks
    InitialWait,  \* RESTORE_WAIT_MS (held) or RESTORE_QUIET_MS (STATUS ON OFF)
    Cap,          \* RESTORE_MAX_WAIT_MS in ticks
    MaxGap,       \* most ticks between two server lines
    StallOK,      \* the server may stop sending before the batch closes
    Endless,      \* the batch never closes; restoration lines keep coming
    Rule,         \* "pr282" | "pre282" | "open"
    CloseActivity,\* a nested batch's closer counts as activity
    HasCap        \* the 8 s ceiling exists

Restored == {RestoredSeq[i] : i \in 1..Len(RestoredSeq)}

ASSUME Restored \subseteq Chans /\ Nested \subseteq Restored
ASSUME Active \in Chans \cup {"none"}
ASSUME Quiet >= 1 /\ InitialWait >= 1 /\ Cap >= 1 /\ MaxGap >= 1
ASSUME Rule \in {"pr282", "pre282", "open"}

Min(a, b) == IF a < b THEN a ELSE b

(* --- the server's script ------------------------------------------------ *)
L(k, c, n) == [k |-> k, c |-> c, nested |-> n]

ChanLines(c) ==
    IF c \in Nested
    THEN << L("open_n", c, TRUE), L("join", c, TRUE), L("body", c, TRUE),
            L("close_n", c, TRUE) >>
    ELSE << L("join", c, FALSE), L("body", c, FALSE) >>

RECURSIVE Cat(_)
Cat(i) == IF i > Len(RestoredSeq) THEN << >>
          ELSE ChanLines(RestoredSeq[i]) \o Cat(i + 1)

Pre    == IF Alias THEN << L("note", "-", FALSE) >> ELSE << >>
Script == Pre \o << L("open_p", "-", FALSE) >> \o Cat(1)
              \o << L("close_p", "-", FALSE) >>
              \o (IF Cursor THEN << L("replay", "-", FALSE) >> ELSE << >>)

OpenPIdx  == Len(Pre) + 1
ClosePIdx == Len(Script) - (IF Cursor THEN 1 ELSE 0)

VARIABLES
    pc,          \* server lines the client has read (Script[1..pc])
    stalled,     \* the server stopped sending
    elapsed,     \* ticks since registration, saturating at Cap
    gap,         \* ticks since the last server line, saturating at MaxGap
    timer,       \* ticks until the autojoin timer fires; -1 = null
    settled,     \* restorationSettled ran (once per connection)
    how,         \* "none" | "timer" | "cap" | "close" | "closeNested"
    st,          \* channel -> "parted" | "joined" (the client's view)
    pre,         \* channels with catchupPrefetched set
    walks,       \* channel -> client catch-up walks started
    replayed,    \* channels the server's cursor replay covered
    echoes,      \* channels whose JOIN we sent and the server has yet to answer
    raced,       \* (a) a JOIN/walk for a restored channel went out while the batch was open, cap live
    racedEarly,  \* (a') ... before the batch closed (open or not yet opened), cap live
    capRaced,    \* the same, but after the cap expired (the inherent limit)
    sinceOuter   \* ticks since the last line outside a nested batch, saturating at Quiet

vars == <<pc, stalled, elapsed, gap, timer, settled, how, st, pre, walks,
          replayed, echoes, raced, racedEarly, capRaced, sinceOuter>>

OpenP       == pc >= OpenPIdx /\ pc < ClosePIdx
BeforeClose == pc < ClosePIdx
CapExpired  == HasCap /\ elapsed >= Cap
CapLive     == ~CapExpired

\* arm(): min(delay, deadline - now), the timer kept only while waiting
Clamp(d) == IF HasCap THEN Min(d, Cap - elapsed) ELSE d
Arm(d)   == IF timer = -1 THEN -1 ELSE Clamp(d)

\* What noteRestorationActivity is called for, per rule.
Activity(k) ==
    CASE k = "note"    -> TRUE
      [] k = "replay"  -> TRUE
      [] k = "close_n" -> Rule /= "pre282" /\ CloseActivity
      [] OTHER         -> Rule /= "pre282"   \* open_p, open_n, join, body

FireAllowed == Rule /= "open" \/ ~OpenP \/ CapExpired
Due         == timer = 0 /\ ~settled /\ FireAllowed

Init ==
    /\ pc = 0
    /\ stalled = FALSE
    /\ elapsed = 0
    /\ gap = 0
    /\ timer = (IF HasCap THEN Min(InitialWait, Cap) ELSE InitialWait)
    /\ settled = FALSE
    /\ how = "none"
    /\ st = [c \in Chans |-> "parted"]
    /\ pre = {}
    /\ walks = [c \in Chans |-> 0]
    /\ replayed = {}
    /\ echoes = {}
    /\ raced = FALSE
    /\ racedEarly = FALSE
    /\ capRaced = FALSE
    /\ sinceOuter = 0

(* restorationSettled -> autojoin, on the channel states s and prefetch set p *)
(* given; returns the updates as a record so the close can compose it.     *)
AutojoinFrom(s, w, p) ==
    LET joining == {c \in Chans : s[c] = "parted"}
        hit     == joining \cap Restored /= {}
    IN [ echoes |-> echoes \cup joining,
         walks  |-> IF Active \in joining
                    THEN [w EXCEPT ![Active] = @ + 1] ELSE w,
         pre    |-> IF Active \in joining THEN p \cup {Active} ELSE p,
         raced  |-> raced \/ (OpenP /\ CapLive /\ hit),
         early  |-> racedEarly \/ (BeforeClose /\ CapLive /\ hit),
         capR   |-> capRaced \/ (BeforeClose /\ CapExpired /\ hit) ]

Tick ==
    /\ ~Due
    /\ pc = Len(Script) \/ stalled \/ gap < MaxGap
    /\ elapsed' = Min(elapsed + 1, Cap)
    /\ gap' = Min(gap + 1, MaxGap)
    /\ timer' = IF timer > 0 THEN timer - 1 ELSE timer
    /\ sinceOuter' = Min(sinceOuter + 1, Quiet)
    /\ UNCHANGED <<pc, stalled, settled, how, st, pre, walks, replayed, echoes,
                   raced, racedEarly, capRaced>>

Fire ==
    /\ Due
    /\ LET a == AutojoinFrom(st, walks, pre) IN
       /\ timer' = -1
       /\ settled' = TRUE
       /\ how' = IF CapExpired THEN "cap" ELSE "timer"
       /\ echoes' = a.echoes
       /\ walks' = a.walks
       /\ pre' = a.pre
       /\ raced' = a.raced
       /\ racedEarly' = a.early
       /\ capRaced' = a.capR
    /\ UNCHANGED <<pc, stalled, elapsed, gap, st, replayed, sinceOuter>>

(* BATCH -p: persistenceBatch.  The restored JOINs are handled in restoring *)
(* mode: each starts a catch-up unless serverReplayCovers (cursor; the     *)
(* channel holds history, assumed) or it was prefetched with our JOIN.     *)
(* Then, if the autojoin was still waiting, restorationSettled.           *)
CloseP ==
    LET waiting == timer /= -1
        newly   == {c \in Restored : st[c] = "parted"}
        walkers == IF Cursor THEN {} ELSE newly \ pre
        s1      == [c \in Chans |-> IF c \in Restored THEN "joined" ELSE st[c]]
        w1      == [c \in Chans |-> IF c \in walkers THEN walks[c] + 1 ELSE walks[c]]
        p1      == IF Cursor THEN pre ELSE pre \ newly
        a       == AutojoinFrom(s1, w1, p1)
    IN /\ timer' = -1
       /\ st' = s1
       /\ IF waiting
          THEN /\ settled' = TRUE
               /\ how' = IF sinceOuter >= Quiet THEN "closeNested" ELSE "close"
               /\ echoes' = a.echoes
               /\ walks' = a.walks
               /\ pre' = a.pre
               \* evaluated with pc still before the close: the batch is in
               \* by now, so no race is recorded here
               /\ UNCHANGED <<raced, racedEarly, capRaced>>
          ELSE /\ UNCHANGED <<settled, how, echoes, raced, racedEarly, capRaced>>
               /\ walks' = w1
               /\ pre' = p1
       /\ UNCHANGED replayed

Deliver ==
    /\ pc < Len(Script)
    /\ ~stalled
    /\ ~(Endless /\ pc + 1 = ClosePIdx)
    /\ LET line == Script[pc + 1] IN
       /\ pc' = pc + 1
       /\ gap' = 0
       /\ sinceOuter' = IF line.nested THEN sinceOuter ELSE 0
       /\ CASE line.k = "close_p" -> CloseP
            [] line.k = "replay" ->
                 /\ replayed' = Restored
                 /\ timer' = Arm(Quiet)
                 /\ UNCHANGED <<settled, how, st, pre, walks, echoes, raced,
                                racedEarly, capRaced>>
            [] OTHER ->
                 /\ timer' = IF Activity(line.k) THEN Arm(Quiet) ELSE timer
                 /\ UNCHANGED <<settled, how, st, pre, walks, replayed, echoes,
                                raced, racedEarly, capRaced>>
    /\ UNCHANGED <<stalled, elapsed>>

(* A restoration line of a batch that never closes (Endless). *)
More ==
    /\ Endless /\ ~stalled /\ pc = ClosePIdx - 1 /\ gap >= 1
    /\ gap' = 0
    /\ sinceOuter' = 0
    /\ timer' = IF Activity("body") THEN Arm(Quiet) ELSE timer
    /\ UNCHANGED <<pc, stalled, elapsed, settled, how, st, pre, walks, replayed,
                   echoes, raced, racedEarly, capRaced>>

Stall ==
    /\ StallOK /\ ~stalled /\ pc < ClosePIdx
    /\ stalled' = TRUE
    /\ UNCHANGED <<pc, elapsed, gap, timer, settled, how, st, pre, walks,
                   replayed, echoes, raced, racedEarly, capRaced, sinceOuter>>

(* The server's answer to our JOIN, read after its restoration batch (it  *)
(* wrote the batch before it read our line; one TCP stream).  A restored  *)
(* channel is already joined: echoed or ignored, either way alreadyJoined.*)
(* Any other channel: joined, and its catch-up starts unless prefetched.  *)
Echo(c) ==
    /\ c \in echoes /\ pc >= ClosePIdx
    /\ echoes' = echoes \ {c}
    /\ IF st[c] = "joined"
       THEN UNCHANGED <<st, walks, pre>>
       ELSE /\ st' = [st EXCEPT ![c] = "joined"]
            \* serverReplayCovers: restoring is false and the wait is over
            /\ IF c \in pre
               THEN /\ pre' = pre \ {c} /\ UNCHANGED walks
               ELSE /\ walks' = [walks EXCEPT ![c] = @ + 1] /\ UNCHANGED pre
    /\ UNCHANGED <<pc, stalled, elapsed, gap, timer, settled, how, replayed,
                   raced, racedEarly, capRaced, sinceOuter>>

Next == Tick \/ Fire \/ Deliver \/ More \/ Stall \/ \E c \in Chans : Echo(c)

Spec == Init /\ [][Next]_vars
        /\ WF_vars(Tick) /\ WF_vars(Fire) /\ WF_vars(Deliver) /\ WF_vars(More)
        /\ WF_vars(\E c \in Chans : Echo(c))

(* --- properties ---------------------------------------------------------- *)
TypeOK ==
    /\ pc \in 0..Len(Script)
    /\ elapsed \in 0..Cap /\ gap \in 0..MaxGap
    /\ timer \in -1..(InitialWait + Quiet)
    /\ how \in {"none", "timer", "cap", "close", "closeNested"}
    /\ st \in [Chans -> {"parted", "joined"}]
    /\ pre \subseteq Chans /\ replayed \subseteq Restored /\ echoes \subseteq Chans
    /\ walks \in [Chans -> 0..3]
    /\ (timer = -1) <=> settled \/ pc >= ClosePIdx
    /\ HasCap => (timer = -1 \/ timer <= Cap - elapsed)

\* (a) no JOIN and no catch-up for a channel the restore will still cover
\*     while the restoration batch is open and the cap has not expired.
NoRace == ~raced
\* (a') the same from registration on: before the batch opens too.
NoEarlyJoin == ~racedEarly
\* (b) one catch-up per channel: the client's walks plus the server's replay.
NoDouble == \A c \in Chans : walks[c] + (IF c \in replayed THEN 1 ELSE 0) <= 1
\* (c) the autojoin goes out.
Settles == <>settled
\* (d) every channel is caught up, by the client or the server's replay.
CaughtUp == <>(\A c \in Chans : walks[c] >= 1 \/ c \in replayed)

\* Covers: each is violated when the path is reachable.
NotClosedFirst == how /= "close"
NotNestedHeld  == how /= "closeNested"
NotCapFired    == ~(how = "cap" /\ pc < ClosePIdx)
NotCapRaced    == ~capRaced
=============================================================================
