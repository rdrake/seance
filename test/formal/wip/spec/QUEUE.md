# Model queue

## Status at 2026-11-10 (Richard away; work may continue from the wip branch)

**Cluster rule (Richard, 2026-11-10 21:43):** the scavenge tier has no CPU cap; drop the old
64 CPU / 320G self-budget. Still CPU only, still never touch the `mt2-*` GPU jobs. Chain jobs only
for real data dependencies, never for a CPU budget. Checked: the `scavenge` QOS and partition set
no group or per-user TRES limit (`sacctmgr show qos`, `scontrol show partition scavenge`).

- **RefLiveness (10065)** was cancelled at 21:43 after 8 h 15 m: 310.85M distinct, level 36,
  66.36M still queued, no violation. The bound was not exhausted.
  Stopped deliberately. Not resubmitted; it is a candidate for a later run with no CPU cap if we want it to finish.
- **Textual-NG scripted traces (10087):** 57 of 60 match. T1 is confirmed (2 traces), and so is T4 (nonplus-challenge cannot settle).
- **Live traces (10088):** 14 of 16 match. The 2 divergences are the two split-ACK runs, HexDroid H1
  and Textual-NG T1, as expected. The liveness findings match, as expected.

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
- **Testnet repro list, next time it is up:**
  - Self-message, same text twice (Seance policy, D15 and W_SelfCopy). Send two identical
    PRIVMSGs to our own nick with echo-message and labeled-response on. Record whether each
    labeled echo comes back, whether each delivered copy comes back unlabeled, and in which
    order. With the content fallback, the first delivered copy can settle the second pending
    copy. This needs no loss and no other session.
  - Seance's late-echo case is fixed in evilnet/seance#277 (draft); nothing to repro.

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
> The scratchpad is `/private/tmp/claude-501/-Users-rdrake-workspace-afternet/666f6d50-96db-4eed-be70-73e9aaf86c06/scratchpad`.
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

## 2026-11-11 11:40 EST: v7 originals, last numbers (cancelled as superseded by v7.1)

No violation in any of them:

| Run | Last progress | Distinct states | Queue |
| --- | --- | --- | --- |
| Reauth (10068) | 11:40:41, level 49 | 350,875,850 | 6.61M |
| Split (10070) | 10:42:13, level 26 | 321,773,969 | 105.9M |
| SplitInOrder (10071) | 11:40:15, level 26 | 323,481,074 | 108.6M |
| RefLiveness_e10 (10103) | 11:40:37, level 43 | 397,167,250 | 51.0M |
| RefLiveness_e12 (10105) | 11:40:16, level 44 | 396,233,724 | 46.2M |

v7.1 at the same time, all no error:
- Small: 185.7M distinct states.
- TwoAttempts: 208.8M.
- CapNotify: 17.4M.
- Reauth: 48 of 48 slices, the largest 94.8M.
- RefLiveness: 44 of 48 slices, the largest so far 108.9M.
- Split: 24 of 48 slices.
- SplitInOrder: queued.

Delivery v2.2 (list-d4, job 10467): all 69 checks as expected.
