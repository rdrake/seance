# Model queue

## Status at 2026-11-10 (Richard away; work may continue from the wip branch)

- **Handshake spec model v7:** regression all OK. Big runs on gpu05: 10066 Small no error;
  10065 RefLiveness and 10067 TwoAttempts running; 10068-10071 queued. Results land in
  `/project/def-rdrake/rdrake/formal/spec-handshake/v7/` (README.md, "v7 regression").
- **nefarious2 at a5911f29:** N2, N3 and N6 reproduced directly (NEFARIOUS.md, "Direct
  reproductions at HEAD"). **Hold: nothing is filed upstream to evilnet/nefarious2 until
  Richard says so.**
- **Delivery model v1** (`../formal-history/model/`): 27/27 as expected, gpu05 job 10082, run
  tree `/project/def-rdrake/rdrake/formal/delivery-v2/`. Codex MODEL-REVIEW-2: correct within
  scope, not yet a base for History. v2 work is listed in `../formal-history/model/README.md`,
  "Still open".
- Next: Delivery v2, then History.tla.

> **TODO (Richard, 2026-11-10): move the formal-verification files off the Mac, or delete them, soon.**
> Nothing has been moved yet. Sizes are as of 2026-11-10.
>
> **What is still on the Mac**
>
> | What | Where | Size |
> | --- | --- | --- |
> | Spec model, decisions, reviews, prompts, findings (`*.md`, `model/`, `specs-src/`, `hpc/`, `ergo-issues/`) | `seance/tmp/formal-spec/` | about 1.2 MB |
> | Traces, recordings and summaries | `seance/tmp/formal-spec/conformance/results/` | 14 MB |
> | History and delivery model (rules, design, decisions, reviews) | `seance/tmp/formal-history/` | 76 KB |
> | v7 per-trace TLC work dirs (Ergo, nefarious2, Seance) | session scratchpad `v7/traces/` | 406 MB |
> | v7 witness runs | scratchpad `v7/wit/` | 522 MB |
> | irctest checkout, venv, recordings | scratchpad `irctest-run/` | 89 MB |
> | Ergo binary and its config | scratchpad `ergo/` | 99 MB |
> | Older work dirs (`refine/`, `w-W_LoggedIn/`) | scratchpad | 600 MB |
> | Superseded TLC state, approved for deletion but blocked by the permission check (`v3-Small/`, `v3-Reauth/`, `v7/st-ProbeLost903/`, state dirs in `v5/`, `v6/`, `mut/`) | scratchpad | about 18 GB |
>
> The scratchpad is `<scratchpad>`.
> It is session temporary space and may be cleared without warning, so anything worth keeping
> there moves first.
>
> **Proposed destinations**
> - **Data** goes to gpu05, under `/project/def-rdrake/rdrake/formal/`: traces, recordings, TLC logs
>   and summaries, and witness traces. Proposed layout: `spec-handshake/` and `traces-v7/` (both
>   already exist), plus `history/`.
> - **Small, durable sources** go into the seance repo under `test/formal/`, next to the existing
>   `test/formal/handshake/`:
>   - `model/*.tla` and the configs;
>   - `RULES.md`, `DECISIONS.md` and `QUEUE.md`;
>   - `conformance/*.py`;
>   - `hpc/*.sbatch`;
>   - a small sample of traces.
>
>   That is a commit on the rdrake fork, made only with Richard's go-ahead.
> - Review reports, prompts and server write-ups (`NEFARIOUS.md`, `ERGO.md`, `CODE-FINDINGS.md`)
>   name unfiled server bugs. They go to the cluster, not the repo, unless Richard decides
>   otherwise.
> - Everything else in the scratchpad is regenerable and gets deleted.
>
> **From now on:** new runs write their outputs straight to the cluster. Recorded traces are copied
> to `/project/def-rdrake/rdrake/formal/` as soon as a recording ends, and the TLC work dirs live
> only there. The Mac keeps only what it must to drive live servers.


Agreed 2026-11-10. Each model uses the same method as the spec model: RULES.md with
file:line, DECISIONS.md, mutants and witnesses, Codex rounds, trace validation against
Ergo and nefarious2, then refinement of our code model.

## Where model checking runs (standing rule, Richard, 2026-11-10)

All TLC and other model checking runs on gpu05: the OTU HPC scavenge tier, Apptainer, CPU only,
within 64 CPUs and 320G in total, never disturbing the training jobs. That includes the small
configs, probes, mutants, witnesses and the per-trace checks (`conformance/check.py`). Nothing
runs locally on the Mac.

The only local work is what has to be local: driving the live servers (testnet, Ergo, irctest)
to record traces. Copy the recorded traces to the cluster and check them there, batching many
traces per job.

In flight: step 1 (nefarious2 with services), step 2 (irctest through the harness),
step 3 (Seance's Handshake.tla against the v6 spec model).

Then, in order:

1. (a) History and delivery: chathistory, batch, labeled-response, echo-message, msgid.
   **Added:** labeled-response with batch, including the ACK-only case.
2. (b) Wider SASL: multiple mechanisms with 908 and retry, 400-byte chunking, reauth after
   registration.
   **Added:** cap values changing (NEW carrying a new value, e.g. a sasl mechanism list),
   which Seance reads.
3. (c) Bouncer sessions and P10 burst (nefarious2).
   **Added:** account state after login (account-notify, extended-join, account-tag)
   staying consistent across a netsplit and burst.
4. (d) Seance reconnect policy.
   **Added:** STS, the upgrade-and-persist policy as well as the reconnect.
Candidates after the four, not started:

5. **New:** pre-registration metadata (`metadata-2=before-connect`) and its ordering
   against CAP END.
6. **New:** the rest of registration: PASS, the PING cookie, 433 during registration, and
   the registration timeout.

Skipped for now (Richard, 2026-11-10): the CRDT mesh model.
