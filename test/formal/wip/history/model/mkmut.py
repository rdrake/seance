import sys
src = open("Delivery.tla").read()
M = {
 "DM_IgnoreEcho": ('m.k = "echo" /\\ lab # NoLabel -> Settle(s, lab, "confirmed", m)',
                   'm.k = "echo" /\\ lab # NoLabel -> s'),
 "DM_WrongLabel": ('m.k = "echo" /\\ lab # NoLabel -> Settle(s, lab, "confirmed", m)',
                   'm.k = "echo" /\\ lab # NoLabel -> Settle(s, Oldest(s.p, m.txt, m.tgt), "confirmed", m)'),
 "DM_Early": ('[] m.ref # 0 /\\ Deferred ->', '[] FALSE ->'),
 "DM_Flip": ('IF l # NoLabel /\\ Pending(s.p, l)', 'IF l # NoLabel /\\ l \\in LabelsUsed'),
 "DS_Twice": ("/\\ owed' = owed \\ {l}", "/\\ owed' = owed"),
 "DM_FirstOnly": ("HandleAll(open.lines, open.lab, Now)",
                  "(IF open.lines = << >> THEN Now ELSE Handle(Head(open.lines), open.lab, Now))"),
 "DS_InnerLabel": ('batch == << Line("bstart", l, t, g, r, l), Line("echo", NoLabel, t, g, r, l)', 'batch == << Line("bstart", l, t, g, r, l), Line("echo", l, t, g, r, l)'),
}
for name, (a, b) in M.items():
    assert src.count(a) == 1, (name, src.count(a))
    out = src.replace(a, b).replace("MODULE Delivery ", "MODULE %s " % name, 1)
    open(name + ".tla", "w").write(out)
    print(name, "ok")
