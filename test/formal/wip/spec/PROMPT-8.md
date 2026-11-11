# Eighth review (short): the drop-point check in the trace harness

Your earlier reports are `SPEC-REVIEW.md` to `SPEC-REVIEW-7.md`. This one is not about the model.
It is about how `conformance/check.py` turns a recorded run into a constrained TLC module. The
runs are recorded by `conformance/drive.py`. Read those two files, `model/SpecHandshake.tla`,
and `DECISIONS.md`. Do not read `NEFARIOUS.md`, `ERGO.md`, `CODE-FINDINGS.md`, `hpc/` or other
`PROMPT*.md` files: the point is to judge the check without knowing the verdicts it produced.

**What is claimed.**
- A recording from a run where the auth backend was taken down carries `dropAt = k`. That is
  the number of server lines the client had read when the drop command finished. drive.py's
  `drop()` and its callers set it, and `beforeConnect` gives `k = 0`.
- check.py then adds the constraint `(ti' > k) => ("sasl" \notin srv'.offered)` and gives the
  module `MaxEnv >= 1`. A server that never withdraws sasl, by sending no `CAP DEL`, should
  therefore diverge at the first server line after the drop, on the server side.
- A clean run (no `dropAt`) is constrained exactly as before.

Please, briefly and adversarially:

1. Is that constraint the right encoding of "the backend went down after the k-th line"? Does it
   force the model to withdraw sasl via a real model action (an `EnvChange` that sends DEL), or
   can it be met vacuously? Consider:
   - an LS still in flight;
   - a DEL the model could send before line k;
   - `srv.offered` versus what the client has been told.
2. Off by one: could a server that did send DEL at line k+1 be wrongly rejected, or one that sent
   it only much later be wrongly accepted? Is "lines read when the drop command finished" the
   right anchor, given that the server may notice the drop later than that? Should the
   constraint allow some slack, and if so, how much does the text (CN:450-457, cap-notify) allow?
3. With a real backend (a `docker stop` of Keycloak), the server only learns of the drop when a
   request fails. Does that make a divergence at `k + 1` a server deviation at all, or an artefact
   of when the harness says the drop happened? What would a fair encoding be?
4. Anything else in check.py's constraint generation, the frontier diagnosis, or `nread` handling
   that could make a match or a divergence untrustworthy?

Write the report to `SPEC-REVIEW-8.md`, verdict first, citing file:line. Edit no other file.
