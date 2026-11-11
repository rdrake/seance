# Review of v7.1: `AUTHENTICATE *` in answer to the challenge (D27), and the env split (D26)

Read only these, and do not run TLC:
- `model/SpecHandshake.tla` (v7.1), and `model/.SpecHandshake-v7.tla.ref` (v7). Diff them first.
- `DECISIONS.md`: D26 and D27, and any earlier decision they touch.
- `hpc/split-env.py`.
- `specs-src/`, for the SASL 3.1/3.2 text: S1-4, S1-10 and S1-14.

Please be brief and adversarial, and cite file:line for every finding.

1. Does D27's change permit exactly what the spec allows, no more and no less? Check the server's
   handling of `*` in `await` and `decide` (SrvAbort), the client's `abort` state, CGiveUp, and
   the 906 that follows. Check every property and Rule* action property that the new branch
   could make vacuous or break. Is W_AbortChal a sound witness?
2. Is D26's liveness split sound, as `split-env.py --liveness` implements it?
   - Do the slices cover Init exactly, including with `--offered` (the 48 slices pin
     `srv.offered`)?
   - Is fairness kept intact?
   - Does `--drop-fair` really drop only the one WF conjunct?
3. Anything else the diff gets wrong.

Write the report to `SPEC-REVIEW-9.md`, verdict first. Edit no other file.
