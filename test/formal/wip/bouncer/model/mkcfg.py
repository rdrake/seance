#!/usr/bin/env python3
"""Write Bouncer.tla's configs, mutants and lists.  Run from model/.

Each config is BASE with the named changes.  `list-limited` holds the checks
run here (each a few minutes at most); `list-big` the comprehensive ones, for
gpu05 later.  A mutant is Bouncer.tla with one anchor replaced (the anchor must
occur exactly once); its config is the named base config with the property
that must catch it as the only invariant.
"""
import os

BASE = dict(InitPrim='"dA"', POrigin='"home"', SessSwitch="TRUE", AliasFirst="TRUE",
            AliasReauth="FALSE", SessLogout="TRUE", Joins="FALSE", LossAtSplit="FALSE",
            PromoteNotify="FALSE", BxcName='"device"', ReauthInBurst="FALSE", MaxChanges=2, MaxMsgs=1, MaxSplits=1)
# the code's values (DECISIONS.md, switch table)
CODE = dict(POrigin='"both"', AliasReauth="TRUE", LossAtSplit="TRUE",
            PromoteNotify="FALSE", BxcName='"session"', ReauthInBurst="TRUE")

SAFE = ("TypeOK ViewMatchesServer ViewConverges TagAgreesView TagAtSendPlain"
        " AliasesAgree CopiesAgree OneFace VerdictsAgree NoUnexpected")
NOPLAIN = SAFE.replace(" TagAtSendPlain", "")

# name: (overrides, invariants, expect, list)
CFGS = {
  # positives: every restriction named in BASE, each switch varied alone
  "Base":        ({}, SAFE, "pass", "limited"),
  "BaseB":       (dict(InitPrim='"dB"'), SAFE, "pass", "limited"),
  "BaseJoins":   (dict(Joins="TRUE"), SAFE, "pass", "limited"),
  "BaseOrder":   (dict(AliasFirst="FALSE"), SAFE, "pass", "limited"),
  "BaseMsgs":    (dict(MaxMsgs=2), SAFE, "pass", "limited"),
  "BaseChg3":    (dict(MaxChanges=3), SAFE, "pass", "limited"),
  "Mid":         (dict(MaxChanges=3, MaxMsgs=2, Joins="TRUE"), SAFE, "pass", "limited"),
  "MidB":        (dict(InitPrim='"dB"', MaxChanges=3, MaxMsgs=2, Joins="TRUE"), SAFE, "pass", "limited"),
  "Split2":      (dict(MaxSplits=2, MaxChanges=3), SAFE, "pass", "limited"),
  "MidLossFix":  (dict(LossAtSplit="TRUE", PromoteNotify="TRUE", MaxChanges=3, MaxMsgs=2), SAFE, "pass", "limited"),
  "MidRemote":   (dict(POrigin='"services"', MaxChanges=3, MaxMsgs=2, Joins="TRUE"), NOPLAIN, "pass", "limited"),
  # the candidate change: a lossy split with the promote announcing the account
  "BaseLossFix": (dict(LossAtSplit="TRUE", PromoteNotify="TRUE"), SAFE, "pass", "limited"),
  # services' server may change P first: everything but P4 (P4 is W_RemoteTag's)
  "BaseRemote":  (dict(POrigin='"services"'), NOPLAIN, "pass", "limited"),
  # witnesses: one switch at the code's value, the property it breaks
  "W_AliasReauth": (dict(AliasReauth="TRUE"), "ViewMatchesServer", "fail", "limited"),
  "W_AliasReauthTag": (dict(AliasReauth="TRUE"), "TagAgreesView", "fail", "limited"),
  "W_AliasReauthAgree": (dict(AliasReauth="TRUE"), "AliasesAgree", "fail", "limited"),
  "W_SplitLoss":   (dict(LossAtSplit="TRUE"), "ViewMatchesServer", "fail", "limited"),
  "W_SplitLossConv": (dict(LossAtSplit="TRUE"), "ViewConverges", "fail", "limited"),
  "W_BxcSession":  (dict(BxcName='"session"'), "AliasesAgree", "fail", "limited"),
  "W_BurstReauth": (dict(ReauthInBurst="TRUE"), "VerdictsAgree", "fail", "limited"),
  "W_BurstReauthAgree": (dict(ReauthInBurst="TRUE"), "AliasesAgree", "fail", "limited"),
  "W_BothOrigins": (dict(POrigin='"both"'), "CopiesAgree", "fail", "limited"),
  "W_TagAtSend":   ({}, "TagAtSend", "fail", "limited"),
  "W_RemoteTag":   (dict(POrigin='"services"'), "TagAtSendPlain", "fail", "limited"),
  "W_Code":        (CODE, "ViewMatchesServer", "fail", "limited"),
  # covers on positives (each must be violated)
  "CoverPromote":   ({}, "CoverPromote", "fail", "limited"),
  "CoverMerge":     ({}, "CoverMerge", "fail", "limited"),
  "CoverClassic":   ({}, "CoverClassic", "fail", "limited"),
  "CoverSplitLogoutHealed": ({}, "CoverSplitLogoutHealed", "fail", "limited"),
  "CoverAliasMsg":  ({}, "CoverAliasMsg", "fail", "limited"),
  "CoverReauthLinked": ({}, "CoverReauthLinked", "fail", "limited"),
  "CoverPromoteB":  (dict(InitPrim='"dB"'), "CoverPromote", "fail", "limited"),
  "CoverMergeLossFix": (dict(LossAtSplit="TRUE", PromoteNotify="TRUE"), "CoverMerge", "fail", "limited"),
  # comprehensive, not run here
  "BigBase":    (dict(MaxChanges=4, MaxMsgs=2, MaxSplits=2, Joins="TRUE"), SAFE, "pass", "big"),
  "BigB":       (dict(InitPrim='"dB"', MaxChanges=4, MaxMsgs=2, MaxSplits=2, Joins="TRUE"), SAFE, "pass", "big"),
  "BigLossFix": (dict(LossAtSplit="TRUE", PromoteNotify="TRUE", MaxChanges=4, MaxMsgs=2, MaxSplits=2,
                      Joins="TRUE"), SAFE, "pass", "big"),
  "BigRemote":  (dict(POrigin='"services"', MaxChanges=4, MaxMsgs=2, MaxSplits=2, Joins="TRUE"),
                 NOPLAIN, "pass", "big"),
  "BigCode":    (dict(CODE, MaxChanges=4, MaxMsgs=2, MaxSplits=2, Joins="TRUE"), "TypeOK NoUnexpected",
                 "pass", "big"),
}

# mutant: ([(old, new)], base config, invariant that must catch it)
MUTS = {
  "M_KeepReplica": ([(
    "               IF Home(c) = v THEN acc[v][c] ELSE NOREP]]",
    "               IF Home(c) = v \\/ c = \"P\" THEN acc[v][c] ELSE NOREP]]"), (
    "IF n = \"P\" THEN (IF v = Home(\"P\") THEN view[o][\"P\"] ELSE GONE)",
    "IF n = \"P\" THEN view[o][\"P\"]")], "BaseChg3", "ViewConverges"),
  "M_NoLocalNotify": ([(
    "  /\\ view' = IF chan[o] THEN [view EXCEPT ![ObsAt(o)][\"P\"] = a] ELSE view",
    "  /\\ view' = view")], "Base", "ViewMatchesServer"),
  "M_NoRelayAC": ([(
    "  /\\ Enq(o, <<L(\"AC\", \"P\", a, FALSE, FALSE)>>)",
    "  /\\ UNCHANGED q")], "Base", "ViewConverges"),
  "M_TagFromHome": ([(
    "TagAt(v, c) == acc[v][Src(v, c)]",
    "TagAt(v, c) == acc[Home(Src(v, c))][Src(v, c)]")], "BaseMsgs", "TagAgreesView"),
  "M_NoBXU": ([(
    "      bxu == IF hasAlias THEN <<L(\"BXU\", d, a, FALSE, FALSE)>> ELSE <<>>",
    "      bxu == <<>>")], "Base", "AliasesAgree"),
  "M_MergeBothKeep": ([(
    "         /\\ IF win.merge = v",
    "         /\\ IF TRUE")], "Base", "OneFace"),
  "M_ClassicNoKill": ([(
    "                   /\\ alive' = [alive EXCEPT ![f] = FALSE]\n"
    "                   /\\ inSess' = [inSess EXCEPT ![f] = FALSE]\n"
    "                   /\\ face' = [face EXCEPT ![v] = c]",
    "                   /\\ alive' = alive\n"
    "                   /\\ inSess' = [inSess EXCEPT ![f] = FALSE]\n"
    "                   /\\ face' = [face EXCEPT ![v] = c]"), (
    "                   /\\ Pop(v, <<L(\"KILL\", f, NONE, FALSE, FALSE)>>)",
    "                   /\\ Pop(v, <<>>)"), (
    "                   /\\ Pop(v, <<L(\"KILL\", c, NONE, FALSE, FALSE)>>)",
    "                   /\\ Pop(v, <<>>)")], "Base", "OneFace"),
  "M_JoinStar": ([(
    "             ELSE [view EXCEPT ![ObsAt(v)][\"P\"] = IF l.ch THEN l.a ELSE GONE]",
    "             ELSE [view EXCEPT ![ObsAt(v)][\"P\"] = IF l.ch THEN NONE ELSE GONE]")],
    "Base", "ViewMatchesServer"),
  "M_PromoteQuit": ([(
    "               ELSE IF Promotes(v) /\\ PromoteNotify THEN acc[v][Dev(v)]",
    "               ELSE IF Promotes(v) THEN GONE")], "BaseB", "ViewMatchesServer"),
  "M_BurstStale": ([(
    "BurstP(v) == IF v = Home(\"P\") THEN <<L(\"N\", \"P\", acc[v][\"P\"], FALSE, chan[v])>> ELSE <<>>",
    "BurstP(v) == IF v = Home(\"P\") THEN <<L(\"N\", \"P\", preSplit, FALSE, chan[v])>> ELSE <<>>")],
    "Base", "ViewConverges"),
}


def cfg(over, inv):
    c = dict(BASE, **over)
    out = ["\\* generated by mkcfg.py", "SPECIFICATION Spec", "CONSTANTS"]
    out += [f"  {k} = {v}" for k, v in c.items()]
    out += ["INVARIANT " + inv, "CHECK_DEADLOCK FALSE", ""]
    return "\n".join(out)


lists = {"limited": [], "big": []}
for n, (over, inv, exp, lst) in CFGS.items():
    open(n + ".cfg", "w").write(cfg(over, inv))
    lists[lst].append(f"Bouncer {n} {exp}")

src = open("Bouncer.tla").read()
for n, (reps, base, prop) in MUTS.items():
    m = src
    for old, new in reps:
        assert m.count(old) == 1, (n, old, m.count(old))
        m = m.replace(old, new)
    open(n + ".tla", "w").write(m.replace("MODULE Bouncer", "MODULE " + n))
    over = CFGS[base][0]
    open(f"{n}_{base}.cfg", "w").write(cfg(over, prop))
    lists["limited"].append(f"{n} {n}_{base} fail")

for k, v in lists.items():
    open("list-" + k, "w").write("\n".join(v) + "\n")
print(sum(len(v) for v in lists.values()), "checks")
