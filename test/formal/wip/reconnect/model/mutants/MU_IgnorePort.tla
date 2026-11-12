------------------------------ MODULE MU_IgnorePort ------------------------------
(***************************************************************************)
(* IRCv3 STS (extensions/sts.md at 9ff58d13) together with Seance's        *)
(* reconnect policy (transport.ts, client.ts, sts.ts at 4f5a4bd12).        *)
(*                                                                         *)
(* Spec-first: the client obeys the STS rules of ../RULES.md, and Seance's *)
(* own reconnect design (SC rules) where the spec is silent. Where         *)
(* Seance's code departs from a spec rule, a Seance* switch reproduces the *)
(* code (DECISIONS D6, D7, D8; findings F1-F4).                            *)
(*                                                                         *)
(* One host (D1): every network in Nets dials it and they share one        *)
(* policy entry, pol. Time is discrete and scaled (D4); the client acts on *)
(* due timers, and the server answers a registration, within the unit      *)
(* (urgency, D4). A dial resolves in the step that makes it.               *)
(*                                                                         *)
(* Out of scope (header of DECISIONS): value parsing and multiline LS      *)
(* (D3), certificates (D2), endpoint edits (D10), the connect timeout,     *)
(* offline waits and the probe (D11), SASL and services. Fake lag, the     *)
(* restore wait and "nothing before 001" are in ConnectPath.tla (D15).     *)
(***************************************************************************)
EXTENDS Integers, Sequences, FiniteSets

CONSTANTS
    Nets,          \* networks (or tabs) on the one host
    PlainNets,     \* those saved as ws:// on PlainPort; the rest wss:// on SavedPort
    SaslNets,      \* those that log in with SASL (what an upgrade's LS flush carries, D7)
    SecPorts,      \* secure ports the server may run
    SavedPort,     \* the saved port of the secure networks (in SecPorts)
    Durs,          \* durations the server may advertise; 0 removes the policy
    InitUpg,       \* the upgrade port advertised over plain at start, or "none"
    InitDur,       \* {d}: the duration advertised over TLS at start; {} for none
    MaxTime,
    Init, Cap, NQuick, Unreached, UJit, Stable, Throttle, Window, IpLimit,
    IpCountRefusals, \* FEAT_IPCHECK_COUNT_REFUSALS (default TRUE): a refusal renews the window
    EnvKinds,      \* which env events may happen (see Env below)
    MaxEnv,        \* how many env events in a behaviour
    Bound,         \* ReconnectsWithin's bound (D12)
    SeanceRetry,        \* TRUE: a timer retry dials the stored options (F1, D6)
    SeanceStsAfterCaps, \* TRUE: the CAP handler answers the LS before checkSts (F2, D7)
    SeanceReschedule    \* TRUE: no reschedule of an expired policy, none at unload (F3, F4, D8)

(* QUICK_RETRY_MS (TR:140): 1, 2, 4 s; doublings from one unit. *)
Quick == [i \in 1..NQuick |-> 2^(i - 1)]
PlainPort == "P"
NoPort == "none"
Ports == SecPorts \cup {PlainPort}
K == Len(Quick) + 3                \* NoStorm's window of dials
lo(b) == (3 * b + 3) \div 4        \* ceil(3b/4): the low end of the jitter (TR:537-543)
AttCap == CHOOSE a \in 1..30 : Init * 2^(a - 1) >= Cap /\ (a = 1 \/ Init * 2^(a - 2) < Cap)
Base(a) == IF Init * 2^(a - 1) >= Cap THEN Cap ELSE Init * 2^(a - 1)
Min(a, b) == IF a < b THEN a ELSE b
Max(a, b) == IF a > b THEN a ELSE b

ASSUME /\ PlainNets \subseteq Nets /\ SaslNets \subseteq Nets /\ SavedPort \in SecPorts
       /\ InitUpg \in SecPorts \cup {NoPort} /\ InitDur \subseteq Durs /\ Cardinality(InitDur) <= 1
       /\ \A d \in Durs : d >= 0
       \* the orderings Seance relies on, kept by the scaled configs (D4)
       /\ Unreached > Window /\ lo(Cap) > Window /\ Stable < Window
       /\ Throttle > 0 /\ \A i \in 1..Len(Quick) : Quick[i] > 0

VARIABLES
    now,     \* the clock
    pol,     \* the store entry for the host: [has, port, exp, dur]; dur = last advertised
    srvUpg,  \* the server's upgrade port for plain connections, or NoPort
    srvDur,  \* the server's duration for TLS connections, or -1
    netUp,   \* the host is reachable
    secUp,   \* the secure ports that accept
    ip,      \* IPcheck's chain over dials to the host: [last, chain] (D11)
    nw,      \* per network: the client and its transport (see Rec)
    hist,    \* per network: times of its last K automatic dials (NoStorm)
    env,     \* env events so far
    lastEnv, \* time of the last env event (ReconnectsWithin)
    act      \* the step just taken (properties, witnesses, trace check)

vars == <<now, pol, srvUpg, srvDur, netUp, secUp, ip, nw, hist, env, lastEnv, act>>

(* A network's record:
   st     "closed" | "wait" (reconnect wait) | "open" (socket open, LS reply
          not read) | "reg" (LS read: registering or registered)
   due    when a wait ends; dly the wait chosen; why its reason:
          "sched" backoff, "quick", "long" (unreached), "throttle", "atonce",
          "upgrade", "connect", "none"
   att    the transport's attempt counter; qf its quick failures; hold a long wait
   opened when the socket opened, or -1
   tls, port   the live options; sTls, sPort the saved ones
   thr    the server said it throttled this socket
   upg    STS upgrades in this session (D9)
   want   the user wants the network connected *)

Valid(p) == p.has /\ p.exp > now
NoPol == [has |-> FALSE, port |-> NoPort, exp |-> 0, dur |-> -1]

Act(k, n, r, how, sent) ==
    [k |-> k, n |-> n, tls |-> r.tls, port |-> r.port, how |-> how, sent |-> sent,
     valid |-> Valid(pol), a |-> r.att, op |-> r.st \in {"open", "reg"},
     pe |-> pol.exp, pp |-> pol.port, refused |-> FALSE]

(* IrcClient.connect(): applyStsPolicy upgrades plain options under a valid
   policy and saves the upgrade with the network (CL:1128-1140, MG:183-190). *)
ConnectedWith(r, p) ==
    IF ~r.tls /\ Valid(p)
    THEN [r EXCEPT !.tls = TRUE, !.port = p.port, !.sTls = TRUE, !.sPort = p.port]
    ELSE r
Connected(r) == ConnectedWith(r, pol)

(* nefarious2 ip_registry_check_local (IPcheck.c:282-345): the chain of
   connections from the address, each within Window of the last; the
   IpLimit-th is refused. Only a dial that reaches the server counts. *)
Chain == IF ip.last >= 0 /\ now - ip.last <= Window THEN ip.chain + 1 ELSE 1
Arrives(r) == netUp /\ (r.tls => r.port \in secUp)
Refused == "ip" \in EnvKinds /\ Chain >= IpLimit
Reach(r) == Arrives(r) /\ ~Refused
IpAfterDial(r) ==
    IF ~Arrives(r) \/ (Refused /\ ~IpCountRefusals) THEN ip ELSE [last |-> now, chain |-> Chain]
(* The address's last connection closes: last_connect moves to now
   (IPcheck.c:470-485). *)
IpAfterClose(n) ==
    IF \E m \in Nets \ {n} : nw[m].st \in {"open", "reg"} THEN ip
    ELSE [ip EXCEPT !.last = now]

Wait(r, d, why, a, q, h) ==
    [r EXCEPT !.st = "wait", !.due = now + d, !.dly = d, !.why = why, !.att = a,
              !.qf = q, !.hold = h, !.opened = -1, !.thr = FALSE]

(* The transport's handleClosed for a close it did not ask for (TR:446-512):
   the set of records the retry may leave, one per jitter end. *)
Closes(r, opened) ==
    LET stable == opened /\ now - r.opened >= Stable
        atOnce == stable /\ ~r.thr
        a0 == IF atOnce THEN 0 ELSE r.att
        q0 == IF opened THEN 0 ELSE r.qf
        a1 == Min(a0 + 1, AttCap)
        b == Base(a1)
    IN IF r.thr THEN {Wait(r, Throttle, "throttle", a1, Len(Quick), TRUE)}
       ELSE IF atOnce THEN {Wait(r, 0, "atonce", a1, q0, FALSE)}
       ELSE IF ~opened /\ q0 < Len(Quick) THEN {Wait(r, Quick[q0 + 1], "quick", a1, q0 + 1, FALSE)}
       ELSE IF ~opened THEN {Wait(r, Unreached + j, "long", a1, q0, TRUE) : j \in {0, UJit}}
       ELSE {Wait(r, d, "sched", a1, q0, FALSE) : d \in {lo(b), b}}

(* onClose's policy refresh (CL:1804-1806, D8). Both modes refresh a valid
   policy on any close of a TLS socket (free). The conforming client also
   reschedules an expired one when an opened connection closes (STS:111-113). *)
PolAfterClose(r, opened) ==
    IF ~r.tls \/ ~pol.has \/ pol.dur <= 0 THEN pol
    ELSE IF Valid(pol) \/ (opened /\ ~SeanceReschedule) THEN [pol EXCEPT !.exp = now + pol.dur]
    ELSE pol

(* A duration read on a TLS connection (LS or NEW): STS:73-79. *)
PolLearn(r) ==
    IF srvDur = -1 THEN pol
    ELSE IF srvDur = 0 THEN [NoPol EXCEPT !.dur = 0]
    ELSE [has |-> TRUE, port |-> r.port, exp |-> now + srvDur, dur |-> srvDur]

Push(s, t) == IF Len(s) < K THEN Append(s, t) ELSE Append(Tail(s), t)

EnvStep == /\ env < MaxEnv
           /\ env' = env + 1
           /\ lastEnv' = now

-----------------------------------------------------------------------------
(* Dialing. how: "auto" (the transport's timer), "connect" (the user),
   "poke" (the foreground poke). *)
DoDial(n, r, how) ==
    LET a == [Act("dial", n, r, how, {}) EXCEPT !.refused = Arrives(r) /\ Refused, !.op = FALSE]
    IN /\ ip' = IpAfterDial(r)
       /\ hist' = IF how = "auto" THEN [hist EXCEPT ![n] = Push(@, now)] ELSE hist
       /\ act' = a
       /\ IF Reach(r)
            THEN /\ nw' = [nw EXCEPT ![n] = [r EXCEPT !.st = "open", !.opened = now,
                                                     !.thr = FALSE, !.hold = FALSE]]
                 /\ UNCHANGED pol
            ELSE /\ \E r2 \in Closes([r EXCEPT !.hold = FALSE], FALSE) : nw' = [nw EXCEPT ![n] = r2]
                 /\ pol' = PolAfterClose(r, FALSE)

(* A due retry. Seance's timer dials the URL the transport was built with
   (TR:517-529); the conforming client applies a valid policy first (D6). *)
Dial(n) ==
    /\ nw[n].st = "wait"
    /\ nw[n].due <= now
    \* a dial connect() or an upgrade set up is not a timer retry
    /\ DoDial(n, IF SeanceRetry THEN nw[n] ELSE Connected(nw[n]),
              IF nw[n].why \in {"connect", "upgrade"} THEN nw[n].why ELSE "auto")
    /\ UNCHANGED <<now, srvUpg, srvDur, netUp, secUp, env, lastEnv>>

(* The CAP LS reply (CL:3110-3117 and checkSts CL:1149-1206). *)
Upgrade(n, p, sent, how) ==
    LET r == nw[n]
    IN /\ nw' = [nw EXCEPT ![n] = [Wait(r, 0, "upgrade", 0, 0, FALSE)
                                     EXCEPT !.tls = TRUE, !.port = p, !.upg = Min(r.upg + 1, 2)]]
       /\ act' = Act("upgrade", n, [r EXCEPT !.port = p], how, sent \cup {"QUIT"})
       /\ UNCHANGED <<pol, ip, hist>>

LsFlush(n) == IF ~SeanceStsAfterCaps THEN {}
              ELSE IF n \in SaslNets THEN {"REQ"} ELSE {"REQ", "END"}

ReadLS(n) ==
    LET r == nw[n]
    IN /\ r.st = "open"
       /\ IF FALSE
            THEN Upgrade(n, srvUpg, LsFlush(n), "ls")
            ELSE /\ nw' = [nw EXCEPT ![n].st = "reg"]
                 /\ pol' = IF r.tls THEN PolLearn(r) ELSE pol
                 /\ act' = Act("ls", n, r, "none", {})
                 /\ UNCHANGED <<ip, hist>>
       /\ UNCHANGED <<now, srvUpg, srvDur, netUp, secUp, env, lastEnv>>

Tick ==
    /\ now < MaxTime
    /\ \A n \in Nets : ~(nw[n].st = "wait" /\ nw[n].due <= now) /\ nw[n].st # "open"
    /\ now' = now + 1
    /\ act' = [act EXCEPT !.k = "tick", !.n = "none"]
    /\ UNCHANGED <<pol, srvUpg, srvDur, netUp, secUp, ip, nw, hist, env, lastEnv>>

-----------------------------------------------------------------------------
(* The user and the page. *)
UserConnect(n) ==
    /\ "user" \in EnvKinds /\ EnvStep
    /\ nw[n].st \in {"closed", "wait"}
    /\ DoDial(n, [Connected(nw[n]) EXCEPT !.want = TRUE, !.att = 0, !.upg = nw[n].upg], "connect")
    /\ UNCHANGED <<now, srvUpg, srvDur, netUp, secUp>>

Poke(n) ==
    /\ "poke" \in EnvKinds /\ EnvStep
    /\ nw[n].st = "wait" /\ ~nw[n].hold /\ nw[n].due > now
    /\ DoDial(n, [Connected(nw[n]) EXCEPT !.att = 0], "poke")
    /\ UNCHANGED <<now, srvUpg, srvDur, netUp, secUp>>

(* QUIT and close: no retry (CL:902-929, TR:380-388). *)
Disconnect(n) ==
    LET r == nw[n]
    IN /\ "user" \in EnvKinds /\ EnvStep
       /\ r.want /\ r.st # "closed"
       /\ nw' = [nw EXCEPT ![n] = [r EXCEPT !.st = "closed", !.want = FALSE, !.opened = -1,
                                            !.thr = FALSE, !.why = "none", !.dly = 0, !.due = 0]]
       /\ pol' = IF r.st \in {"open", "reg"} THEN PolAfterClose(r, TRUE) ELSE pol
       /\ act' = Act("disconnect", n, r, "none", {"QUIT"})
       /\ ip' = IF r.st \in {"open", "reg"} THEN IpAfterClose(n) ELSE ip
       /\ UNCHANGED <<now, srvUpg, srvDur, netUp, secUp, hist>>

(* The page goes away and comes back (pagehide MG:353-363, then createNetwork
   for each saved network). Seance sends QUIT and reschedules nothing (F4). *)
Reload ==
    /\ "reload" \in EnvKinds /\ EnvStep
    /\ LET live == {n \in Nets : nw[n].tls /\ nw[n].st \in {"open", "reg"}}
           p1 == IF ~SeanceReschedule /\ live # {} /\ pol.has /\ pol.dur > 0
                 THEN [pol EXCEPT !.exp = now + pol.dur] ELSE pol
           fresh(r) == [r EXCEPT !.st = IF r.want THEN "wait" ELSE "closed", !.due = now,
                                 !.dly = 0, !.why = "connect", !.att = 0, !.qf = 0,
                                 !.hold = FALSE, !.opened = -1, !.tls = r.sTls,
                                 !.port = r.sPort, !.thr = FALSE, !.upg = 0]
       IN /\ pol' = p1
          /\ nw' = [n \in Nets |-> IF nw[n].want THEN ConnectedWith(fresh(nw[n]), p1)
                                   ELSE fresh(nw[n])]
          /\ act' = [Act("reload", "none", [tls |-> live # {}, port |-> NoPort, att |-> 0,
                                            st |-> "reg"], "none", {"QUIT"})
                     EXCEPT !.op = live # {}]
    /\ UNCHANGED <<now, srvUpg, srvDur, netUp, secUp, ip, hist>>

-----------------------------------------------------------------------------
(* The server and the network. *)
Drop(n) ==
    /\ "drop" \in EnvKinds /\ EnvStep
    /\ nw[n].st \in {"open", "reg"}
    /\ \E r2 \in Closes(nw[n], TRUE) : nw' = [nw EXCEPT ![n] = r2]
    /\ pol' = PolAfterClose(nw[n], TRUE)
    /\ act' = Act("drop", n, nw[n], "none", {})
    /\ ip' = IpAfterClose(n)
    /\ UNCHANGED <<now, srvUpg, srvDur, netUp, secUp, hist>>

(* ERROR ... throttled, then the close (handlers/error.ts, TR:193-199). *)
Throttled(n) ==
    /\ "throttle" \in EnvKinds /\ EnvStep
    /\ nw[n].st \in {"open", "reg"}
    /\ \E r2 \in Closes([nw[n] EXCEPT !.thr = TRUE], TRUE) : nw' = [nw EXCEPT ![n] = r2]
    /\ pol' = PolAfterClose(nw[n], TRUE)
    /\ act' = Act("throttle", n, nw[n], "none", {})
    /\ ip' = IpAfterClose(n)
    /\ UNCHANGED <<now, srvUpg, srvDur, netUp, secUp, hist>>

(* CAP NEW sts=... after registration (STS:59, CN:420). *)
SrvNew(n) ==
    LET r == nw[n]
    IN /\ "new" \in EnvKinds /\ EnvStep
       /\ r.st = "reg"
       /\ IF ~r.tls /\ srvUpg # NoPort
            THEN Upgrade(n, srvUpg, {}, "new")
            ELSE /\ pol' = IF r.tls THEN PolLearn(r) ELSE pol
                 /\ act' = Act("new", n, r, "none", {})
                 /\ UNCHANGED <<nw, ip, hist>>
       /\ UNCHANGED <<now, srvUpg, srvDur, netUp, secUp>>

(* CAP DEL sts: ignored (STS:61). *)
SrvDel(n) ==
    /\ "del" \in EnvKinds /\ EnvStep
    /\ nw[n].st = "reg"
    /\ act' = Act("del", n, nw[n], "none", {})
    /\ UNCHANGED <<now, pol, srvUpg, srvDur, netUp, secUp, ip, nw, hist>>

EnvOnly == UNCHANGED <<now, pol, ip, nw, hist>> /\ act' = [act EXCEPT !.k = "env", !.n = "none"]

NetToggle ==
    /\ "net" \in EnvKinds /\ EnvStep
    /\ netUp' = ~netUp
    /\ EnvOnly /\ UNCHANGED <<srvUpg, srvDur, secUp>>

PortToggle(p) ==
    /\ "port" \in EnvKinds /\ EnvStep
    /\ secUp' = IF p \in secUp THEN secUp \ {p} ELSE secUp \cup {p}
    /\ EnvOnly /\ UNCHANGED <<srvUpg, srvDur, netUp>>

SetUpg(x) ==
    /\ "upg" \in EnvKinds /\ EnvStep
    /\ x # srvUpg /\ srvUpg' = x
    /\ EnvOnly /\ UNCHANGED <<srvDur, netUp, secUp>>

SetDur(d) ==
    /\ "dur" \in EnvKinds /\ EnvStep
    /\ d # srvDur /\ srvDur' = d
    /\ EnvOnly /\ UNCHANGED <<srvUpg, netUp, secUp>>

-----------------------------------------------------------------------------
Start(n) ==
    LET plain == n \in PlainNets
    IN [st |-> "wait", due |-> 0, dly |-> 0, why |-> "connect", att |-> 0, qf |-> 0,
        hold |-> FALSE, opened |-> -1, tls |-> ~plain,
        port |-> IF plain THEN PlainPort ELSE SavedPort, thr |-> FALSE, upg |-> 0,
        want |-> TRUE, sTls |-> ~plain, sPort |-> IF plain THEN PlainPort ELSE SavedPort]

InitState ==
    /\ now = 0
    /\ pol = NoPol
    /\ srvUpg = InitUpg
    /\ srvDur = IF InitDur = {} THEN -1 ELSE CHOOSE d \in InitDur : TRUE
    /\ netUp = TRUE
    /\ secUp = SecPorts
    /\ ip = [last |-> -1, chain |-> 0]
    /\ nw = [n \in Nets |-> Start(n)]
    /\ hist = [n \in Nets |-> <<>>]
    /\ env = 0
    /\ lastEnv = 0
    /\ act = [k |-> "init", n |-> "none", tls |-> FALSE, port |-> NoPort, how |-> "none",
              sent |-> {}, valid |-> FALSE, a |-> 0, op |-> FALSE, pe |-> 0, pp |-> NoPort,
              refused |-> FALSE]

Next ==
    \/ \E n \in Nets : Dial(n) \/ ReadLS(n) \/ UserConnect(n) \/ Poke(n) \/ Disconnect(n)
                       \/ Drop(n) \/ Throttled(n) \/ SrvNew(n) \/ SrvDel(n)
    \/ Tick \/ Reload \/ NetToggle
    \/ \E p \in SecPorts : PortToggle(p)
    \/ \E x \in SecPorts \cup {NoPort} : SetUpg(x)
    \/ \E d \in Durs \cup {-1} : SetDur(d)

Spec == InitState /\ [][Next]_vars

-----------------------------------------------------------------------------
(* Invariants *)
TypeOK ==
    /\ now \in 0..MaxTime
    /\ pol.has \in BOOLEAN /\ pol.port \in Ports \cup {NoPort}
    /\ \A n \in Nets : /\ nw[n].st \in {"closed", "wait", "open", "reg"}
                       /\ nw[n].port \in Ports
                       /\ nw[n].tls = (nw[n].port \in SecPorts)
                       /\ nw[n].att \in 0..AttCap /\ nw[n].qf \in 0..Len(Quick)

Calm == netUp /\ secUp = SecPorts

(* SC-11, D12 *)
ReconnectsWithin ==
    \A n \in Nets : (nw[n].want /\ Calm /\ now - lastEnv >= Bound) => nw[n].st \in {"open", "reg"}

(* STS-8, D9 *)
SessionStaysSecure == \A n \in Nets : nw[n].upg > 0 => nw[n].tls
UpgradeOncePerSession == \A n \in Nets : nw[n].upg <= 1

(* SC-2, SC-4, SC-5: the waits the schedule chooses *)
RuleCapFloor == \A n \in Nets : (nw[n].st = "wait" /\ nw[n].why = "sched" /\ nw[n].att = AttCap)
                                 => nw[n].dly > Window
RuleSpacing == \A n \in Nets : (nw[n].st = "wait" /\ nw[n].why = "long") => nw[n].dly > Window
RuleThrottleWait == \A n \in Nets : (nw[n].st = "wait" /\ nw[n].why = "throttle")
                                     => nw[n].dly = Throttle /\ nw[n].hold

(* SC-4: any K automatic dials of a network span more than the IP window *)
NoStorm == \A n \in Nets : Len(hist[n]) = K => hist[n][K] - hist[n][1] > Window

(* Action properties: act' is the step's record; nw, pol the state before it. *)
RuleNoPlainDialWithPolicy == [][act'.k = "dial" /\ ~act'.tls => ~act'.valid]_vars
RulePolicyPort ==
    [][act'.k = "dial" /\ act'.tls /\ act'.valid /\ ~nw[act'.n].tls => act'.port = pol.port]_vars
RuleUpgradeToPort ==
    [][act'.k = "upgrade" => nw'[act'.n].tls /\ nw'[act'.n].port = srvUpg /\ nw'[act'.n].st = "wait"]_vars
RulePortIgnoredOnSecure == [][act'.k = "upgrade" => ~act'.tls]_vars
RuleIgnoreWithoutPort == [][act'.k = "upgrade" => srvUpg # NoPort]_vars
RuleUpgradeWhenPort == [][act'.k = "ls" /\ ~act'.tls => srvUpg = NoPort]_vars
RuleNothingAfterUpgrade == [][act'.k = "upgrade" => act'.sent \subseteq {"QUIT"}]_vars
UpgradeBeforeRegistration == [][act'.k = "upgrade" /\ act'.how = "ls" => "END" \notin act'.sent]_vars
RuleUpgradeNoPenalty ==
    [][act'.k = "upgrade" => nw'[act'.n].att = 0 /\ nw'[act'.n].due = now /\ ~nw'[act'.n].hold]_vars
RulePolicyOnlyFromSecure ==
    [][pol' # pol => \/ act'.k = "reload"
                     \/ act'.tls /\ act'.k \in {"ls", "new", "dial", "drop", "throttle", "disconnect"}]_vars
RuleSecureNoDurKeeps ==
    [][act'.k \in {"ls", "new"} /\ act'.tls /\ srvDur = -1 => pol' = pol]_vars
RuleResetExpiry ==
    [][act'.k \in {"ls", "new"} /\ act'.tls /\ srvDur > 0
       => pol' = [has |-> TRUE, port |-> act'.port, exp |-> now + srvDur, dur |-> srvDur]]_vars
RuleDurationZero == [][act'.k \in {"ls", "new"} /\ act'.tls /\ srvDur = 0 => ~pol'.has]_vars
RuleIgnoreDel == [][act'.k = "del" => pol' = pol /\ nw' = nw]_vars
RuleRescheduleOnClose ==
    [][act'.k \in {"drop", "throttle", "disconnect", "reload"} /\ act'.tls /\ act'.op
       /\ pol.has /\ pol.dur > 0
       => pol'.has /\ pol'.exp = now + pol.dur]_vars
RuleDisconnectFinal == [][act'.k = "dial" => nw'[act'.n].want]_vars
RuleAskRestarts == [][act'.k = "dial" /\ act'.how \in {"connect", "poke"} => act'.a = 0]_vars

-----------------------------------------------------------------------------
(* Witnesses: each must be VIOLATED (the feature is reached). *)
W_UpgradeRegistered == ~\E n \in Nets : nw[n].upg > 0 /\ nw[n].st = "reg"
W_PolicyDial == ~(act.k = "dial" /\ act.n \in PlainNets /\ act.tls /\ act.valid
                  /\ nw[act.n].upg = 0)
W_ExpiredPlain == ~(act.k = "dial" /\ ~act.tls /\ pol.has /\ ~act.valid)
W_DurZero == ~(act.k \in {"ls", "new"} /\ act.tls /\ ~pol.has /\ pol.dur = 0 /\ act.pp # NoPort)
W_NewDur == ~(act.k = "new" /\ act.tls /\ pol.has /\ act.pe # pol.exp)
W_PortChange == ~(act.k = "ls" /\ act.tls /\ act.pp # NoPort /\ pol.has /\ act.pp # pol.port)
W_NoFallback == ~(act.k = "dial" /\ act.how = "auto" /\ act.tls /\ act.valid
                  /\ act.n \in PlainNets /\ nw[act.n].st = "wait" /\ act.a >= 1)
W_UpgradeFailsSecure == ~\E n \in Nets : nw[n].upg > 0 /\ nw[n].st = "wait"
                                       /\ nw[n].why \in {"quick", "long", "sched"}
W_Throttled == ~\E n \in Nets : nw[n].st = "wait" /\ nw[n].why = "throttle"
W_QuickThenHold == ~\E n \in Nets : nw[n].st = "wait" /\ nw[n].why = "long"
W_StableAtOnce == ~\E n \in Nets : nw[n].st = "wait" /\ nw[n].why = "atonce"
W_CapWait == ~\E n \in Nets : nw[n].st = "wait" /\ nw[n].why = "sched" /\ nw[n].att = AttCap
W_IpRefused == ~(act.k = "dial" /\ act.refused)
W_CancelWait == ~(act.k = "disconnect" /\ ~act.op)
W_Reschedule == ~(act.k \in {"drop", "disconnect", "throttle"} /\ act.tls /\ pol.has
                  /\ pol.exp > act.pe)
W_RescheduleExpired == ~(act.k \in {"drop", "disconnect", "throttle", "reload"} /\ act.tls
                         /\ pol.has /\ act.pe <= now /\ pol.exp > now)
W_TwoNets == ~(PlainNets # {} /\ Cardinality(Nets) > 1
               /\ \A n \in Nets : nw[n].st = "reg" /\ nw[n].tls /\ nw[n].upg = 0)
W_SavedUpgrade == ~\E n \in PlainNets : nw[n].sTls /\ nw[n].st = "reg"
W_Poke == ~(act.k = "dial" /\ act.how = "poke")
W_UpgradeByNew == ~(act.k = "upgrade" /\ act.how = "new")
W_Reconnected == ~\E n \in Nets : nw[n].st = "reg" /\ env > 0 /\ act.k = "ls" /\ act.n = n
                                 /\ act.a > 0

SafetyView == <<now, pol, srvUpg, srvDur, netUp, secUp, ip, nw, env>>
=============================================================================
