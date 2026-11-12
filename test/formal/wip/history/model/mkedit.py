"""Generate Edit.tla's configs and mutants (D37).  Rerun after any change to
Edit.tla: each mutant is one textual edit, and the assert fails if its
anchor no longer matches exactly once."""
BASE = dict(People='{"a", "m"}', Nicks='{"n1", "n2", "n3"}', Me='"none"', MaxMsgs=3,
            MaxRen=2, MaxAcc=1, AccountsOn="TRUE", Mentions="FALSE", TrimOn="FALSE",
            PageOn="TRUE")
SAFE = ["TypeOK", "AuthorOnly", "CountOnce", "LateSilent", "OriginalKept"]
# name: (comment, overrides, invariants)
CFG = {
    "E_Base": ("positive: accounts, pages, no mentions", {}, SAFE),
    "E_NoLogin": ("positive: accounts fixed from the start (MaxAcc 0)", {"MaxAcc": 0}, SAFE),
    "E_NoAcc": ("positive: no accounts", {"AccountsOn": "FALSE"}, SAFE),
    "E_LiveOnly": ("positive: every line read live (b holds)", {"PageOn": "FALSE"},
                   SAFE + ["ImpostorIsLine", "NoSideBySide"]),
    "E_Mentions": ("positive: mentions and the inbox, no trim", {"Mentions": "TRUE"},
                   ["TypeOK", "AuthorOnly", "LateSilent", "OriginalKept"]),
    "E_MeLive": ("positive: one speaker is us, every line live", {"Me": '"a"', "PageOn": "FALSE"},
                 SAFE + ["ImpostorIsLine"]),
    "E_Me": ("finding: one speaker is us, no accounts", {"Me": '"a"', "AccountsOn": "FALSE"}, SAFE),
    "E_MeAcc": ("finding: one speaker is us, accounts may be off", {"Me": '"a"'}, SAFE),
    "E_CountOnce": ("CountOnce alone, to see whether it separates EM_LateCounts", {}, ["CountOnce"]),
    "E_LateSilent": ("LateSilent alone, mentions on", {"Mentions": "TRUE"}, ["LateSilent"]),
    "W_ImpostorFirst": ("known weakness: someone else's edit before the original", {}, ["ImpostorIsLine"]),
    "W_SideBySide": ("finding: an author's edit beside its original", {}, ["NoSideBySide"]),
    "W_Silent": ("finding: a message that never counts", {}, ["AtLeastOnce"]),
    "W_SamePerson": ("by design: without accounts a nick is the identity", {"AccountsOn": "FALSE"}, ["SamePerson"]),
    "W_InboxNick": ("finding: the inbox drop matches nicks", {"Mentions": "TRUE"}, ["InboxFollowsEdit"]),
    "W_InboxTrim": ("finding: an impostor drops a trimmed original's inbox entry",
                    {"Mentions": "TRUE", "TrimOn": "TRUE"}, ["OriginalKept"]),
    "W_InboxTakeover": ("finding: the same, by a nick takeover (no login changes)",
                        {"Mentions": "TRUE", "TrimOn": "TRUE", "MaxAcc": 0}, ["OriginalKept"]),
    "CoverNickChangeAccount": ("cover", {}, ["CoverNickChangeAccount"]),
    "CoverTakeoverRefused": ("cover", {}, ["CoverTakeoverRefused"]),
    "CoverLateHidden": ("cover", {}, ["CoverLateHidden"]),
    "CoverInboxDrop": ("cover", {"Mentions": "TRUE", "TrimOn": "TRUE"}, ["CoverInboxDrop"]),
    "CoverPageJudged": ("cover", {}, ["CoverPageJudged"]),
    "CoverImpostorWaits": ("cover", {}, ["CoverImpostorWaits"]),
}
for name, (comment, ov, inv) in CFG.items():
    c = dict(BASE, **ov)
    with open(name + ".cfg", "w") as f:
        f.write("\\* %s: %s\nSPECIFICATION Spec\nCONSTANTS\n" % (name, comment))
        for k, v in c.items():
            f.write("  %s = %s\n" % (k, v))
        f.write("INVARIANTS\n" + "".join("  %s\n" % i for i in inv) + "CHECK_DEADLOCK FALSE\n")
src = open("Edit.tla").read()
ISA = "IsAuthor(au, by) == IF au.acc # NoAcc \\/ by.acc # NoAcc THEN au.acc # NoAcc /\\ by.acc # NoAcc /\\ au.acc = by.acc ELSE IF au.self /\\ by.self THEN TRUE ELSE au.nick = by.nick"
M = {
    "EM_NickOnly": (ISA, "IsAuthor(au, by) == au.nick = by.nick"),
    "EM_NoCheck": (ISA, "IsAuthor(au, by) == TRUE"),
    "EM_LateCounts": ("HiddenCounts == FALSE", "HiddenCounts == TRUE"),
    # one account against none taken as a match (the pre-6c0f3c1 rule)
    "EM_OneAccount": (ISA, "IsAuthor(au, by) == IF au.acc # NoAcc /\\ by.acc # NoAcc THEN au.acc = by.acc ELSE IF au.self /\\ by.self THEN TRUE ELSE au.nick = by.nick"),
}
for name, (a, b) in M.items():
    assert src.count(a) == 1, (name, src.count(a))
    open(name + ".tla", "w").write(src.replace(a, b).replace("MODULE Edit ", "MODULE %s " % name, 1))
print("ok")
