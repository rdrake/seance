#!/usr/bin/env python3
"""Write History.tla's configs, mutants and list-h0.  Run from model/.

Each witness is the positive config Tiny with the named changes; its comment
says why it is reachable (DESIGN.md).  Mutants: History.tla with one anchor
replaced (the anchor must occur exactly once).
"""
BASE = dict(NHeld=1, NGap=2, LiveOn="TRUE", Times="{1, 3}", Fuzz=0, Limit=1,
            BudgetKind='"pages"', BudgetN=5, ExactCount="TRUE", Contiguous="TRUE",
            TimeOrdered="TRUE", BatchAgrees="TRUE", StableAcrossReconnect="FALSE",
            SendsEnd="TRUE", Dedupe="TRUE", MsgidAnchor="TRUE", StopOnHeld="FALSE",
            InsertMerge="TRUE")
SAFE = "TypeOK NoLoss NoDup ContentOnce ReplayIdStable Order PageEligible EndTruthful"
CFGS = {
  # positives
  "HTiny": ({}, SAFE, "Terminates", "pass"),
  "HTiny2": (dict(NHeld=2, Limit=2), SAFE, "Terminates", "pass"),
  "HHeldStop": (dict(NHeld=2, NGap=2, StopOnHeld="TRUE", StableAcrossReconnect="TRUE"), SAFE, "Terminates", "pass"),
  "HMsgs": (dict(BudgetKind='"msgs"', BudgetN=4), SAFE, "Terminates", "pass"),
  # witnesses: each breaks NoLoss, NoDup or Order with one switch flipped
  "W_EmptyPage": (dict(ExactCount="FALSE"), "NoLoss", None, "fail"),
  "W_TimeOrdered": (dict(NHeld=2, NGap=1, TimeOrdered="FALSE"), "NoLoss", None, "fail"),
  "W_D7Reorder": (dict(NHeld=2, NGap=2, Limit=2, StopOnHeld="TRUE"), "NoLoss", None, "fail"),
  "W_TsTie": (dict(MsgidAnchor="FALSE"), "NoLoss", None, "fail"),
  "W_Budget": (dict(NGap=3, Limit=1, BudgetN=2, LiveOn="FALSE"), "NoLoss", None, "fail"),
  "W_Holes": (dict(Contiguous="FALSE", Limit=2), "NoLoss", None, "fail"),
  # v0 finding: with msgid anchors, Contiguous and ExactCount, a batch in another
  # order costs pages but skips nothing; with pages(5) that loses nothing here.
  # W_BatchBudget pairs it: with pages(2) the wasted pages lose a gap message.
  "HNoBatchAgrees": (dict(BatchAgrees="FALSE", Limit=2, NGap=3), SAFE, "Terminates", "pass"),
  # the same budget with batches in order recovers everything (the pair's positive)
  # (v0.2 run: without Stable, a reconnect may order a gap message before the
  # held one at a time tie, and pages(2) then misses it; the pair pins Stable)
  "HBatchAgreesBudget": (dict(Limit=2, NGap=3, BudgetN=2, StableAcrossReconnect="TRUE"), SAFE, "Terminates", "pass"),
  "W_BatchBudget": (dict(BatchAgrees="FALSE", Limit=2, NGap=3, BudgetN=2, StableAcrossReconnect="TRUE"), "NoLoss", None, "fail"),
  # the live message relayed and also replayed in a page, held twice
  "W_NoDedupe": (dict(Dedupe="FALSE"), "NoDupLive", None, "fail"),
  # an append client puts older history after newer held or received messages
  # (DESIGN's live-at-time-1 story cannot occur: store times are non-decreasing)
  "W_Append": (dict(InsertMerge="FALSE"), "Order", None, "fail"),
  "HFuzz": (dict(Fuzz=1, NHeld=2), SAFE, "Terminates", "pass"),
  # covers on the positive configs (each must be violated)
  "CoverDone": ({}, "CoverDone", None, "fail"),
  "CoverMultiPage": ({}, "CoverMultiPage", None, "fail"),
  # the floor stop needs a held message older than the newest held one
  "CoverFloor": (dict(NHeld=2), "CoverFloor", None, "fail"),
  "CoverEmpty": ({}, "CoverEmpty", None, "fail"),
  "CoverEnd": ({}, "CoverEnd", None, "fail"),
  "CoverLiveInPage": ({}, "CoverLiveInPage", None, "fail"),
  "CoverLiveBoth": ({}, "CoverLiveBoth", None, "fail"),
  "CoverBudget": (dict(BudgetN=1), "CoverBudget", None, "fail"),
  "CoverHeldStop": (dict(NHeld=2, NGap=2, StopOnHeld="TRUE", StableAcrossReconnect="TRUE"), "CoverHeldStop", None, "fail"),
}
MUTS = {
  # CH-18: the server mints a new msgid on replay; a deduping client then
  # holds the same content twice
  "HS_NewId": ('Replay(c) == c ', 'Replay(c) == c + N ', "HTiny", "ContentOnce"),
  "HS_NewIdR": ('Replay(c) == c ', 'Replay(c) == c + N ', "HTiny", "ReplayIdStable"),
  # server puts the anchor itself in a BEFORE page (CH:83 excludes it)
  "HS_Anchor": ('    /\\ LET E == Elig(q, ord)\n', '    /\\ LET E == Elig(q, ord) \\cup (IF q.sel # 0 THEN {q.sel} ELSE {})\n', "HTiny", "PageEligible"),
  # server tags chathistory-end whatever remains (D9)
  "HS_FalseEnd": ('(IF SendsEnd /\\ EndOK(E, p, ord) THEN BOOLEAN ELSE {FALSE})', '(IF SendsEnd THEN BOOLEAN ELSE {FALSE})', "HTiny", "EndTruthful"),
  # client ignores the floor and stops after the first page
  "HC_OnePage": ('ELSE "none"', 'ELSE "floor"', "HTiny", "NoLoss"),
  # client stops at the floor on a tie (<= instead of <, CH-23)
  "HC_FloorLe": ('ELSE IF T(ms[1]) < Floor THEN "floor"', 'ELSE IF T(ms[1]) <= Floor THEN "floor"', "HTiny", "NoLoss"),
}
def cfg(over, inv, prop, spec_fair):
    c = dict(BASE, **over)
    out = ["SPECIFICATION " + ("FairSpec" if spec_fair else "Spec"), "CONSTANTS"]
    out += [f"  {k} = {v}" for k, v in c.items()]
    out += ["INVARIANT " + inv]
    if prop: out += ["PROPERTY " + prop]
    out += ["CHECK_DEADLOCK FALSE", ""]
    return "\n".join(out)
# HISTORY-REVIEW-2: completion with every gap message held, on every positive
for pos in ["HTiny2", "HHeldStop", "HMsgs", "HFuzz", "HNoBatchAgrees", "HBatchAgreesBudget"]:
    CFGS["CoverDone_" + pos] = (CFGS[pos][0], "CoverDone", None, "fail")
lst = []
for n, (over, inv, prop, exp) in CFGS.items():
    open(n + ".cfg", "w").write(cfg(over, inv, prop, prop is not None))
    lst.append(f"History {n} {exp}")
src = open("History.tla").read()
for n, (old, new, base, prop) in MUTS.items():
    assert src.count(old) == 1, (n, src.count(old))
    open(n + ".tla", "w").write(src.replace(old, new).replace("MODULE History", "MODULE " + n))
    over, _, _, _ = CFGS[base]
    open(n + "_" + base + ".cfg", "w").write(cfg(over, prop, None, False))
    lst.append(f"{n} {n}_{base} fail")
open("list-h0", "w").write("\n".join(lst) + "\n")
print(len(lst), "checks")
