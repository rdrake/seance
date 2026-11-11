#!/usr/bin/env python3
"""Split a safety config by environment, one TLC job per slice.

For config BASE.cfg this writes, in OUTDIR, one module and config per
environment (creds x (wantSasl, required) x svcOk = 12 slices, optionally
x initial offered set = 48): <BASE>_eNN.tla EXTENDS SpecHandshake with Init
pinned to that slice, and <BASE>_eNN.cfg, a copy of BASE.cfg that uses the
pinned spec, adds VIEW SafetyView, and (with --symmetry) SYMMETRY over
OtherCaps.  Safety only: the slices drop fairness, and the cfg must not
list temporal properties.  The union of the slices' Init is exactly Init.

With --liveness the slices keep fairness (SrvFair and CliFair) and the
temporal properties, and never use the safety VIEW.  This is sound because
env and the initial offered set are fixed in Init: every behaviour of Spec
starts in exactly one slice, and a temporal property is a property of each
behaviour.  --drop-fair X (liveness only, repeatable) leaves out WF of
action X, as a negative control: a property that needs X must then fail in
some slice.

Usage: split-env.py BASE.cfg OUTDIR [--offered] [--no-view] [--symmetry]
                    [--module M] [--drop-liveness] [--liveness [--drop-fair X]...]
(--module: extend M, e.g. a mutant, instead of SpecHandshake)
"""
import itertools, os, re, sys

base, out = sys.argv[1], sys.argv[2]
by_offered = "--offered" in sys.argv
live = "--liveness" in sys.argv
view = "--no-view" not in sys.argv and not live
drop = [sys.argv[i + 1] for i, a in enumerate(sys.argv) if a == "--drop-fair"]
assert live or not drop, "--drop-fair needs --liveness"
SRV = ["SRecv", "SrvSend", "SrvLsRest", "SrvAnswer", "SrvAckRest", "SrvDecide", "SrvChallenge",
       "Srv900", "Srv903", "SrvRegister", "Srv001"]
CLI = ["CRecv", "CAbort", "CGiveUp", "CEnd", "CQuitOblig"]
assert all(d in SRV + CLI for d in drop), drop
symmetry = "--symmetry" in sys.argv
# SYMMETRY needs OtherCaps to be model values in the cfg (OtherCaps = {a, b},
# with CONSTANTS a = a, b = b), not quoted strings (SPEC-REVIEW-6 #3).
OTHER = ["a"] if "--two-other" not in sys.argv else ["a", "b"]
module = sys.argv[sys.argv.index("--module") + 1] if "--module" in sys.argv else "SpecHandshake"
name = os.path.splitext(os.path.basename(base))[0]
cfg = open(base).read()
assert "SPECIFICATION" in cfg
# SPEC-REVIEW-9 #1: liveness slices never carry a VIEW or a SYMMETRY.
if live:
    assert not re.search(r"^\s*(VIEW|SYMMETRY)\b", cfg, re.M), "VIEW/SYMMETRY in a liveness base cfg"
    assert not symmetry, "--symmetry with --liveness"
# SPEC-REVIEW-9 #2: --offered enumerates subsets of {"sasl"} + OTHER, so the
# config's OtherCaps must be exactly OTHER (quoted strings).
if by_offered:
    m = re.search(r"OtherCaps\s*=\s*\{([^}]*)\}", cfg)
    got = sorted(x.strip() for x in m.group(1).split(",")) if m else None
    assert got == sorted(f'"{o}"' for o in OTHER), f"OtherCaps {got} does not match {OTHER}"
cfg = re.sub(r"SPECIFICATION\s+\w+", "SPECIFICATION SliceSpec", cfg)
liveness = {"RequiredQuits", "AnswersEventually", "OwedSent", "Terminates"}
props = set(re.findall(r"\w+", cfg.split("PROPERTIES", 1)[1].split("CHECK_DEADLOCK")[0])) if "PROPERTIES" in cfg else set()
if "--drop-liveness" in sys.argv:
    for p in liveness:
        cfg = re.sub(r"\b%s\b" % p, "", cfg)
    props -= liveness
assert live or not (props & liveness), f"liveness properties in a safety slice: {props & liveness}"
if drop:
    fair = " /\\ ".join(f"WF_vars(G({a}))" for a in SRV + CLI if a not in drop)
elif live:
    fair = "SrvFair /\\ CliFair"
else:
    fair = None
extra = ("VIEW SafetyView\n" if view else "") + ("SYMMETRY CapPerms\n" if symmetry else "")
cfg = cfg.replace("CHECK_DEADLOCK", extra + "CHECK_DEADLOCK")
os.makedirs(out, exist_ok=True)
b = lambda v: "TRUE" if v else "FALSE"
envs = [(c, w, r, s) for c, (w, r), s in itertools.product(
    (False, True), ((False, False), (True, False), (True, True)), (False, True))]
# every initial offered set: each subset of Caps (SPEC-REVIEW-6 #4)
offs = [None] if not by_offered else ["{}"] + [
    "{" + ", ".join(f'"{c}"' for c in sorted(set(x))) + "}"
    for k in range(1, 4) for x in itertools.combinations(["sasl"] + OTHER, k)][:]
n = 0
for (c, w, r, s), off in itertools.product(envs, offs):
    n += 1
    m = f"{name}_{module}_e{n:02d}" if module != "SpecHandshake" else f"{name}_e{n:02d}"
    pin = f'    /\\ srv.offered = {off}\n' if off else ""
    open(os.path.join(out, m + ".tla"), "w").write(f"""---- MODULE {m} ----
\\* {name} slice {n}: creds={b(c)} wantSasl={b(w)} required={b(r)} svcOk={b(s)}{' offered=' + off if off else ''}
EXTENDS {module}, TLC
SliceInit ==
    /\\ Init
    /\\ env = [creds |-> {b(c)}, wantSasl |-> {b(w)}, required |-> {b(r)}, svcOk |-> {b(s)}]
{pin}SliceSpec == SliceInit /\\ [][Next]_vars{(" /\\ " + fair) if fair else ""}
CapPerms == Permutations(OtherCaps)
====
""")
    open(os.path.join(out, m + ".cfg"), "w").write(cfg)
print(n, "slices written to", out)
