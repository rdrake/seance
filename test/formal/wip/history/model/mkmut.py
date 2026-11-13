"""Generate the Delivery mutants from Delivery.tla.  Each is one textual edit
(plus the module name); the assert fails if an anchor no longer matches once,
so rerun this after any change to Delivery.tla."""
src = open("Delivery.tla").read()
M = {
    # client mutants
    "DM_IgnoreEcho": ('m.k = "echo" /\\ lab # NoLabel -> Settle(s, lab, "confirmed", m, oa)',
                      'm.k = "echo" /\\ lab # NoLabel -> s'),
    "DM_WrongLabel": ('m.k = "echo" /\\ lab # NoLabel -> Settle(s, lab, "confirmed", m, oa)',
                      'm.k = "echo" /\\ lab # NoLabel -> Settle(s, Oldest(s.p, m.txt, m.tgt, m.cmd, s.sp), "confirmed", m, oa)'),
    "DM_Early": ("[] m.ref # 0 /\\ Deferred ->", "[] FALSE ->"),
    "DM_Flip": ("IF l # NoLabel /\\ Pending(s.p, l)", "IF l # NoLabel /\\ l \\in LabelsUsed"),
    "DM_FirstOnly": ("Apply(HandleAll(buf[m.id], Now))",
                     "Apply(IF buf[m.id] = << >> THEN Now ELSE Handle(Head(buf[m.id]).m, Head(buf[m.id]).lab, Head(buf[m.id]).hist, FALSE, Now))"),
    "DM_Reverse": ("Apply(HandleAll(buf[m.id], Now))", "Apply(HandleAll(Rev(buf[m.id]), Now))"),
    "DM_IgnoreAck": ('[] m.k = "ack" -> Settle(s, lab, "accepted", m, oa)', '[] m.k = "ack" -> s'),
    "DM_IgnoreErr": ('[] m.k \\in {"fail", "err"} ->', '[] m.k \\in {"fail"} ->'),
    "DM_HistorySettles": ("    IF hist THEN s\n", "    IF FALSE THEN s\n"),
    "DM_KindBlind": ("/\\ pendTgt[order[i]] = g /\\ pendCmd[order[i]] = c}", "/\\ pendTgt[order[i]] = g}"),
    # v2.2: "highest reference", not "last opened" (MODEL-REVIEW-3 §3)
    "DM_HighestRef": ("ELSE IF m.ref # 0 /\\ ob[m.ref].on THEN ob[m.ref].lab ELSE NoLabel",
                      "ELSE IF m.ref # 0 /\\ ob[m.ref].on THEN ob[LastOpen].lab ELSE NoLabel"),
    # v2.2: a client that treats every line as history while any history batch is open
    "DM_GlobalHist": ("HistOf(m) == m.ref # 0 /\\ ob[m.ref].on /\\ ob[m.ref].hist",
                      "HistOf(m) == \\E r \\in RefIds : ob[r].on /\\ ob[r].hist"),
    # D40: Seance before #297, a 301 that carries the label spends nothing
    "DM_NoSpent": ('[] m.k = "note" /\\ m.lab \\in Labels -> [s EXCEPT !.sp = @ \\cup {m.lab}]\n', ''),
    # server mutants
    "DS_Twice": ("/\\ owed' = owed \\ {l}", "/\\ owed' = owed"),
    "DS_AfterSettle": ("/\\ ~closed /\\ l \\in owed /\\ out[l] = << >>",
                       "/\\ ~closed /\\ (l \\in owed \\/ (l \\in LabelsUsed /\\ pend[l] # \"pending\")) /\\ out[l] = << >>"),
    "DS_InnerLabel": ('batch == << bs, M("echo", et), be >>',
                      'batch == << bs, L("echo", l, et, 0, r, "none"), be >>'),
}
for name, (a, b) in M.items():
    assert src.count(a) == 1, (name, src.count(a))
    out = src.replace(a, b).replace("MODULE Delivery ", "MODULE %s " % name, 1)
    open(name + ".tla", "w").write(out)
    print(name, "ok")
