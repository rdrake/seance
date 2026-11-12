------------------------------ MODULE MU_CPJoinEarly ------------------------------
(***************************************************************************)
(* One connection of Seance's, from registration to close (D15): the       *)
(* server's fake-lag clock, the background queue, the user's own lines, a  *)
(* timer-driven sender that can fall due before 001, and the restore wait  *)
(* for a held session's restoration batch.                                 *)
(*                                                                         *)
(* Sources (4f5a4bd12): fakelag.ts (FL) 53-68, 69-140, 241-300;            *)
(* persistence.ts (PE) 57-62, 105-191; client.ts 1960-2035 (registration,  *)
(* restorationSettled); docs/resources/irc-layer.md 51, 55.                *)
(* Times are whole seconds; a short line costs 2, a long one more.         *)
(***************************************************************************)
EXTENDS Integers

CONSTANTS
    MaxTime,
    Costs,       \* what a background job may cost (FL:107-110)
    Budget,      \* BACKGROUND_BUDGET_MS / 1000 (FL:68)
    Ceiling,     \* the server stops parsing past this many seconds ahead
    UserMax,     \* user lines the budget keeps room for (FL:64-66: three)
    MaxBg,       \* background jobs in a behaviour
    MaxUser,     \* user lines in a behaviour
    Wait,        \* RESTORE_WAIT_MS / 1000 (PE:58)
    Quiet,       \* RESTORE_QUIET_MS (PE:60), whole units
    MaxWait,     \* RESTORE_MAX_WAIT_MS / 1000 (PE:62)
    Held,        \* the server said PERSISTENCE STATUS ON
    MaxActivity  \* signs of restoration in a behaviour

Line == 2        \* a short line: min 2 s + bytes/120 (FL:107-110)
Min(a, b) == IF a < b THEN a ELSE b
Max(a, b) == IF a > b THEN a ELSE b

ASSUME /\ Budget + UserMax * Line <= Ceiling
       /\ Wait <= MaxWait /\ Quiet <= MaxWait
       /\ \A c \in Costs : c >= Line

VARIABLES now, phase, clock, bgLeft, users, deferred, restore, timer, deadline,
          joined, regAt, run, activity, act

cpvars == <<now, phase, clock, bgLeft, users, deferred, restore, timer, deadline,
            joined, regAt, run, activity, act>>

A(k, cls, why, c) == [k |-> k, cls |-> cls, why |-> why, c |-> c]

(* A line the client sends directly (not through the queue): run counts
   them since the clock was last within the budget. *)
Direct(cost) ==
    /\ clock' = clock + cost
    /\ run' = IF clock <= Budget THEN 1 ELSE run + 1

CPInit ==
    /\ now = 0 /\ phase = "pre" /\ clock = 0 /\ bgLeft = MaxBg /\ users = 0
    /\ deferred = FALSE /\ restore = "none" /\ timer = 0 /\ deadline = 0 /\ joined = 0
    /\ regAt = 0 /\ run = 0 /\ activity = 0
    /\ act = A("init", "none", "none", 0)

(* 001 ... MOTD end: the clock starts (FL:76-80); a deferred marker goes now
   (flushDeferredMarkRead); a held session waits for its restoration. *)
Reg ==
    /\ phase = "pre"
    /\ phase' = "reg" /\ regAt' = now
    /\ deferred' = FALSE
    /\ LET flush == IF deferred THEN Line ELSE 0
       IN IF FALSE
            THEN /\ restore' = "wait" /\ deadline' = now + MaxWait
                 /\ timer' = now + Min(Wait, MaxWait)
                 /\ clock' = flush /\ run' = IF deferred THEN 1 ELSE 0
                 /\ UNCHANGED joined
                 /\ act' = A("reg", IF deferred THEN "marker" ELSE "none", "held", flush)
            ELSE /\ joined' = 1 /\ clock' = flush + Line /\ run' = IF deferred THEN 2 ELSE 1
                 /\ UNCHANGED <<restore, timer, deadline>>
                 /\ act' = A("send", "join", "nothold", Line)
    /\ UNCHANGED <<now, bgLeft, users, activity>>

(* A sign of restoration: the wait becomes a quiet period, never past the
   deadline (PE:134-155). *)
Activity ==
    /\ phase = "reg" /\ restore = "wait" /\ activity < MaxActivity
    /\ activity' = activity + 1
    /\ timer' = now + Max(0, Min(Quiet, deadline - now))
    /\ act' = A("activity", "none", "none", 0)
    /\ UNCHANGED <<now, phase, clock, bgLeft, users, deferred, restore, deadline, joined, regAt, run>>

Settle(why) ==
    /\ restore' = "done" /\ joined' = joined + 1
    /\ Direct(Line)
    /\ act' = A("send", "join", why, Line)

(* The restoration batch: applied, then the autojoin (PE:172-191). *)
Batch ==
    /\ phase = "reg" /\ restore = "wait"
    /\ Settle("batch")
    /\ UNCHANGED <<now, phase, bgLeft, users, deferred, timer, deadline, regAt, activity>>

TimerFire ==
    /\ phase = "reg" /\ restore = "wait" /\ timer <= now
    /\ Settle("timer")
    /\ UNCHANGED <<now, phase, bgLeft, users, deferred, timer, deadline, regAt, activity>>

(* BackgroundQueue.pump: a job goes when the clock leaves room for it under
   the budget, or, costing more than the budget, when it has drained (FL:131-138). *)
BgSend(c) ==
    /\ phase = "reg" /\ bgLeft > 0
    /\ clock <= Max(0, Budget - c)
    /\ bgLeft' = bgLeft - 1
    /\ clock' = clock + c
    /\ act' = A("send", "bg", "none", c)
    /\ UNCHANGED <<now, phase, users, deferred, restore, timer, deadline, joined, regAt, run, activity>>

UserSend ==
    /\ phase = "reg" /\ users < MaxUser
    /\ users' = users + 1
    /\ Direct(Line)
    /\ act' = A("send", "user", "none", Line)
    /\ UNCHANGED <<now, phase, bgLeft, deferred, restore, timer, deadline, joined, regAt, activity>>

(* A debounced MARKREAD falls due: before 001 it is kept (IL:51). *)
MarkerDue ==
    /\ phase # "closed" /\ ~deferred
    /\ IF phase = "reg"
         THEN /\ Direct(Line) /\ UNCHANGED deferred
              /\ act' = A("send", "marker", "none", Line)
         ELSE /\ deferred' = TRUE /\ UNCHANGED <<clock, run>>
              /\ act' = A("defer", "marker", "none", 0)
    /\ UNCHANGED <<now, phase, bgLeft, users, restore, timer, deadline, joined, regAt, activity>>

(* The socket closes: a pending autojoin dies with it (PE:157-160). *)
Close ==
    /\ phase # "closed"
    /\ phase' = "closed" /\ restore' = IF restore = "wait" THEN "none" ELSE restore
    /\ clock' = 0
    /\ act' = A("close", "none", IF restore = "wait" THEN "waiting" ELSE "none", 0)
    /\ UNCHANGED <<now, bgLeft, users, deferred, timer, deadline, joined, regAt, run, activity>>

Tick ==
    /\ now < MaxTime
    /\ ~(phase = "reg" /\ restore = "wait" /\ timer <= now)
    /\ now' = now + 1
    /\ clock' = Max(0, clock - 1)
    /\ act' = A("tick", "none", "none", 0)
    /\ UNCHANGED <<phase, bgLeft, users, deferred, restore, timer, deadline, joined, regAt, run, activity>>

CPNext == Reg \/ Activity \/ Batch \/ TimerFire \/ (\E c \in Costs : BgSend(c))
          \/ UserSend \/ MarkerDue \/ Close \/ Tick

CPSpec == CPInit /\ [][CPNext]_cpvars

CPTypeOK == /\ phase \in {"pre", "reg", "closed"} /\ restore \in {"none", "wait", "done"}
            /\ clock \in 0..(Ceiling * 3) /\ joined \in 0..3

(* SC-13 *)
BackgroundLeavesRoom ==
    (act.k = "send" /\ act.cls = "bg") => (clock <= Budget \/ (act.c > Budget /\ clock = act.c))
UserLinesParsed ==
    (act.k = "send" /\ act.cls # "bg" /\ run <= UserMax) => clock <= Ceiling

(* SC-14 *)
AutojoinOnce == joined <= 1
AutojoinBounded == (phase = "reg" /\ now - regAt >= MaxWait) => joined = 1
NoAutojoinAfterClose == [][act'.cls = "join" => phase = "reg" \/ (phase = "pre" /\ ~Held)]_cpvars
AutojoinNotEarly ==
    [][act'.cls = "join" /\ act'.k = "send" => (Held => act'.why \in {"batch", "timer"})]_cpvars

(* SC-12 *)
RuleNothingBefore001 == [][act'.k = "send" /\ act'.cls # "join" => phase = "reg"]_cpvars

(* Witnesses *)
W_CPBatchJoin == ~(act.cls = "join" /\ act.why = "batch")
W_CPTimerJoin == ~(act.cls = "join" /\ act.why = "timer" /\ activity = 0)
W_CPDeadline == ~(act.cls = "join" /\ act.why = "timer" /\ activity > 0 /\ now = regAt + MaxWait)
W_CPDeferred == ~(act.k = "reg" /\ act.cls = "marker")
W_CPBgWaited == ~(act.k = "send" /\ act.cls = "bg" /\ clock = Budget)
W_CPClosedWaiting == ~(act.k = "close" /\ act.why = "waiting")
=============================================================================
