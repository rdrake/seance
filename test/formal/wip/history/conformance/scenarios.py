#!/usr/bin/env python3
"""Delivery client scenarios, derived from Delivery.tla v2.2's server (SAnswer,
SLate, SOther, SHistory, CClose) and its witnesses.  Writes scenarios.jsonl.

Each scenario is a list of steps (SCHEMA.md):
  {"send": {"i": 1, "tgt": "chan"|"self", "cmd": "PRIVMSG"|"NOTICE", "txt": "a"}}
  {"line": {"raw": "...", "m": {model line}}}   raw has {L1}/{L2}, {me}, {chan}
  {"timeout": i}     the client's timeout for request i fires
  {"close": true}    the connection closes
A scenario needs labels when any raw line holds {L<i>}; a client that did not
label request i gets only scenarios without {L<i>}.
"""
import json

CH = "#chan"

def M(k, lab, txt, tgt, cmd, id_, ref, bt, who, role):
    return dict(k=k, lab=lab, txt=txt, tgt=tgt, cmd=cmd, id=id_, ref=ref, bt=bt, who=who, role=role)

def target(tgt):
    return "{me}" if tgt == "self" else "{chan}"

def tags(lab=None, batch=None):
    t = []
    if lab: t.append("label={%s}" % lab)
    if batch: t.append("batch=r%d" % batch)
    return ("@" + ";".join(t) + " ") if t else ""

# Rendering of each model line kind (the label placeholder is the request's).
def echo(i, txt, tgt="chan", cmd="PRIVMSG", lab=True, ref=0, role="resp", who=None):
    who = who if who is not None else i
    L = "L%d" % i if lab else None
    raw = f"{tags(L, ref)}:{{me}}!u@h {cmd} {target(tgt)} :{txt}"
    return {"line": {"raw": raw, "m": M("echo", L or "none", txt, tgt, cmd, 0, ref, "none", who, role)}}

def bstart(i, rid, bt="lr", ref=0, lab=True, who=None, txt="a", role="resp"):
    L = "L%d" % i if lab else None
    btype = {"lr": "labeled-response", "multiline": "draft/multiline {chan}", "history": "chathistory {chan}"}[bt]
    raw = f"{tags(L, ref)}:srv BATCH +r{rid} {btype}"
    return {"line": {"raw": raw, "m": M("bstart", L or "none", txt, "chan", "PRIVMSG", rid, ref, bt, i if who is None else who, role)}}

def bend(i, rid, bt="lr", ref=0, who=None, txt="a", role="resp"):
    raw = f"{tags(None, ref)}:srv BATCH -r{rid}"
    return {"line": {"raw": raw, "m": M("bend", "none", txt, "chan", "PRIVMSG", rid, ref, bt, i if who is None else who, role)}}

def note(i, ref, txt="a"):
    raw = f"{tags(None, ref)}:srv NOTE PRIVMSG INFO :noted"
    return {"line": {"raw": raw, "m": M("note", "none", txt, "chan", "PRIVMSG", 0, ref, "none", i, "resp")}}

def fail(i, ref=0, lab=True, txt="a"):
    L = "L%d" % i if (lab and not ref) else None
    raw = f"{tags(L, ref)}:srv FAIL PRIVMSG CANNOT_SEND {{chan}} :Cannot send"
    return {"line": {"raw": raw, "m": M("fail", L or "none", txt, "chan", "PRIVMSG", 0, ref, "none", i, "resp")}}

def err(i, ref=0, lab=True, txt="a"):
    L = "L%d" % i if (lab and not ref) else None
    raw = f"{tags(L, ref)}:srv 404 {{me}} {{chan}} :Cannot send to channel"
    return {"line": {"raw": raw, "m": M("err", L or "none", txt, "chan", "PRIVMSG", 0, ref, "none", i, "resp")}}

def ack(i, txt="a"):
    raw = f"{tags('L%d' % i)}:srv ACK"
    return {"line": {"raw": raw, "m": M("ack", "L%d" % i, txt, "chan", "PRIVMSG", 0, 0, "none", i, "resp")}}

def send(i, txt="a", tgt="chan", cmd="PRIVMSG"):
    return {"send": {"i": i, "tgt": tgt, "cmd": cmd, "txt": txt}}

def hist(rid, txt="a", form="plain", r2=None):
    # D19: a same-text line from our nick replayed in a history batch
    H = lambda k, lab, id_, ref, bt: M(k, lab, txt, "chan", "PRIVMSG", id_, ref, bt, "hist", "hist")
    if form == "plain":
        return [{"line": {"raw": f":srv BATCH +r{rid} chathistory {{chan}}", "m": H("bstart", "none", rid, 0, "history")}},
                {"line": {"raw": f"@batch=r{rid} :{{me}}!u@h PRIVMSG {{chan}} :{txt}", "m": H("echo", "none", 0, rid, "none")}},
                {"line": {"raw": f":srv BATCH -r{rid}", "m": H("bend", "none", rid, 0, "history")}}]
    raise ValueError(form)

S = []
def sc(name, tag, steps, why):
    S.append({"name": name, "tag": tag, "why": why, "steps": steps})

# One request: every SAnswer form (D15 table).
r = 1
sc("echo1", "guaranteed", [send(1), echo(1, "a")], "labeled echo confirms")
sc("batch", "guaranteed", [send(1), bstart(1, r), echo(1, "a", lab=False, ref=r), bend(1, r)], "labeled batch holding the echo")
sc("noteB", "guaranteed", [send(1), bstart(1, r), note(1, r), echo(1, "a", lab=False, ref=r), bend(1, r)], "a non-settling line before the echo")
sc("nestB", "guaranteed", [send(1), bstart(1, 1), bstart(1, 2, "multiline", ref=1, lab=False),
                            echo(1, "a", lab=False, ref=2), bend(1, 2, "multiline", ref=1), bend(1, 1)], "echo inside a multiline batch inside the labeled batch")
sc("fail1", "guaranteed", [send(1), fail(1)], "labeled FAIL fails")
sc("err1", "guaranteed", [send(1), err(1)], "labeled 4xx fails")
sc("failB", "guaranteed", [send(1), bstart(1, r), fail(1, ref=r), bend(1, r)], "FAIL inside the labeled batch inherits its label")
sc("noteFB", "guaranteed", [send(1), bstart(1, r), note(1, r), err(1, ref=r), bend(1, r)], "4xx after a note inside the batch")
sc("modEcho", "allowed", [send(1), echo(1, "mod")], "EM-2: the server altered the text; the label still confirms")
sc("ack1", "adversarial", [send(1), ack(1)], "Lossy: a labeled ACK instead of the echo")
sc("partial", "adversarial", [send(1), bstart(1, r), bend(1, r), {"timeout": 1}], "Lossy: an empty labeled batch, then the timeout")
sc("silence", "adversarial", [send(1), {"timeout": 1}], "Lossy: no reply; the timeout resolves")
sc("lateAfterTimeout", "adversarial", [send(1), {"timeout": 1}, echo(1, "a", lab=False, role="late")], "a late unlabeled echo after the timeout settles nothing (absorbing)")
sc("echoFail", "adversarial", [send(1), bstart(1, r), echo(1, "a", lab=False, ref=r), fail(1, ref=r), bend(1, r)], "D17: echo then FAIL; the first wins")
sc("failEcho", "adversarial", [send(1), bstart(1, r), fail(1, ref=r), echo(1, "a", lab=False, ref=r), bend(1, r)], "D17: FAIL then echo; the first wins")
sc("close", "allowed", [send(1), {"close": True}], "D18: close fails the pending copy")
sc("closeInBatch", "allowed", [send(1), bstart(1, r), {"close": True}], "close with the response batch open")
sc("selfPre", "guaranteed", [send(1, tgt="self"), echo(1, "a", tgt="self", lab=False, role="deliv"), echo(1, "a", tgt="self")], "LR-5: delivered copy, then the labeled echo")
sc("selfPost", "guaranteed", [send(1, tgt="self"), echo(1, "a", tgt="self"), echo(1, "a", tgt="self", lab=False, role="deliv")], "LR-5: labeled echo, then the delivered copy")
sc("notice", "guaranteed", [send(1, cmd="NOTICE"), echo(1, "a", cmd="NOTICE")], "NOTICE with its labeled echo")
sc("histOpen", "allowed", [send(1), hist(9)[0], echo(1, "a"), hist(9)[1], hist(9)[2]],
   "BA:93-98: our labeled echo arrives while a history batch is open; it must still confirm")
sc("histBefore", "allowed", [send(1)] + hist(9) + [echo(1, "a")], "D19: a history replay of the same text must not settle the copy")

# Two requests: interleaving and the witnesses.
sc("twoEcho", "guaranteed", [send(1), send(2, "b"), echo(2, "b"), echo(1, "a")], "answers out of order, by label")
sc("interleaved", "guaranteed", [send(1), send(2, "a"), bstart(1, 1), bstart(2, 2), echo(2, "a", lab=False, ref=2),
                                  echo(1, "a", lab=False, ref=1), bend(1, 1), bend(2, 2)], "D16: two batches interleaved, same text")
sc("interleavedSwap", "guaranteed", [send(1), send(2, "a"), bstart(1, 1), bstart(2, 2), echo(1, "a", lab=False, ref=1),
                                      echo(2, "a", lab=False, ref=2), bend(2, 2), bend(1, 1)],
   "D16: two same-text batches; the second closes first and must settle its own copy")
sc("modBatch", "allowed", [send(1), bstart(1, r), echo(1, "mod", lab=False, ref=r), bend(1, r)],
   "EM-2 inside a labeled batch: the altered echo still answers the label")
sc("sameText", "guaranteed", [send(1), send(2, "a"), echo(2, "a"), echo(1, "a")], "same text twice, answered in reverse order")
sc("W_Other", "allowed", [send(1), echo(1, "a", lab=False, who="other", role="other"), echo(1, "a")],
   "another session says the same text before our echo")
sc("W_LateTimedOut", "adversarial", [send(1), send(2, "a"), {"timeout": 1}, echo(1, "a", lab=False, role="late"), echo(2, "a")],
   "a timed-out copy's late unlabeled echo arrives while a same-text copy waits")
sc("W_SelfCopy", "guaranteed", [send(1, tgt="self"), send(2, tgt="self"), echo(1, "a", tgt="self"),
                                echo(1, "a", tgt="self", lab=False, role="deliv"), echo(2, "a", tgt="self"),
                                echo(2, "a", tgt="self", lab=False, role="deliv")],
   "two identical self-messages; the first's delivered copy arrives while the second waits")
sc("kindCross", "allowed", [send(1, cmd="NOTICE"), send(2), echo(2, "a", lab=False, role="late"), echo(1, "a", cmd="NOTICE")],
   "a PRIVMSG's unlabeled echo while a same-text NOTICE waits")

# Without labels: the unlabeled family (clients that send no label).
sc("U_echo", "guaranteed", [send(1), echo(1, "a", lab=False)], "no labels: the echo confirms by content")
sc("U_sameText", "guaranteed", [send(1), send(2, "a"), echo(1, "a", lab=False), echo(2, "a", lab=False)], "no labels: same text twice")
sc("U_other", "allowed", [send(1), echo(1, "a", lab=False, who="other", role="other"), echo(1, "a", lab=False)], "no labels: another session's same text first")
sc("U_err", "guaranteed", [send(1), err(1, lab=False)], "no labels: a 404 for the target")
sc("U_errTwo", "guaranteed", [send(1), send(2, "b"), err(2, lab=False), echo(1, "a", lab=False)], "no labels: two pending, a 404 meant for the second")
sc("U_close", "allowed", [send(1), {"close": True}], "no labels: close")
sc("U_hist", "allowed", [send(1)] + hist(9) + [echo(1, "a", lab=False)], "no labels: a history replay of the same text")
sc("U_self", "guaranteed", [send(1, tgt="self"), echo(1, "a", tgt="self", lab=False), echo(1, "a", tgt="self", lab=False, role="deliv")],
   "no labels: a self-message's echo and delivered copy")

for s in S:
    s["labels"] = any("{L" in st.get("line", {}).get("raw", "") for st in s["steps"])
with open("scenarios.jsonl", "w") as f:
    for s in S:
        f.write(json.dumps(s) + "\n")
print(len(S), "scenarios;", sum(s["labels"] for s in S), "need labels")
