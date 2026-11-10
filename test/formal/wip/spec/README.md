# IRCv3 spec model of connection registration

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


An independent TLA+ model of CAP 302 negotiation and SASL 3.1/3.2, written only
from the IRCv3 specification text, to check the Seance and nefarious2 code
models against.

- `specs-src/`: ircv3/ircv3-specifications, commit 9ff58d1 (2026-08-03), unmodified.
- `RULES.md`: every normative sentence in scope, with file:line and how the model handles it.
- `DECISIONS.md`: interpretation choices (D1-D21).
- `CODE-FINDINGS.md`: what the spec model says about Seance, nefarious2 and the code model.
- `SPEC-REVIEW.md` .. `SPEC-REVIEW-4.md`: Codex's reviews of this model against the spec text alone.
- `model/SpecHandshake.tla`: the model, a bounded reference peer for the pre-registration,
  single-mechanism subset. SHOULD/MAY choices are CONSTANT switches.

## Where model checking runs (standing rule, Richard, 2026-11-10)

All TLC and other model checking runs on gpu05: the OTU HPC scavenge tier, Apptainer, CPU only,
within 64 CPUs and 320G in total, never disturbing the training jobs. That includes the small
configs, probes, mutants, witnesses and the per-trace checks (`conformance/check.py`). Nothing
runs locally on the Mac.

The only local work is what has to be local: driving the live servers (testnet, Ergo, irctest)
to record traces. Copy the recorded traces to the cluster and check them there, batching many
traces per job.

## v7 regression (gpu05, 2026-11-10)

Bundles 10059-10061 and 10064 (`hpc/tlc-bundle.sbatch`), all **OK**:
- **Probes:** ProbeLost903 28.4M distinct, ProbeReorder 76K, ProbeSplitCross 35.7K,
  ProbeDelSplit 8.60M, ProbeTwoSplits 23.4M. No error.
- **Tiny and TinyEnv:** 20.2M each. No error.
- **Mutants:** all 7 caught by the same properties as before. The unmutated controls (M1, M2,
  OverlapSafety, DelSplitSafety) pass.
- **Witnesses:** all 19 fail as intended, including the 4 new ones (W_LsAllFirst, W_FailBeforeChal,
  W_StrayOpen, W_EarlyEnd).
  - W_Interleave first passed, because its config had `ReqCapNotify = FALSE`, which leaves only
    two cap names, so no second REQ can be answered inside a split. That was a config error,
    not a model change.
  - With `ReqCapNotify = TRUE` (job 10064) it fails: 410K distinct.

Queued on v7, at the v6 footprint (24 CPUs, 120G each):
- **Chain 1:** RefLiveness (10065).
- **Chain 2,** one after another: Small (10066), TwoAttempts (10067), Reauth (10068),
  CapNotify (10069), Split (10070), SplitInOrder (10071).

At 48 CPUs that stays under the 64-CPU limit.

Status at 2026-11-10 15:36 (Eastern):
- **Small (10066): no error,** 175.31M distinct states, queue empty, 1 h 54 min.
- **RefLiveness (10065):** running, 240.7M distinct at level 35, 54.7M on the queue, no
  violation yet.
- **TwoAttempts (10067):** running, 34.5M distinct.
- Reauth, CapNotify, Split and SplitInOrder (10068-10071) wait behind it.

Each job writes `tlc-<Config>.log` and `tlc-spec-<job>.out` in
`/project/def-rdrake/rdrake/formal/spec-handshake/v7/` on gpu05. Collect a verdict with
`grep -E "No error|violated|distinct states found" tlc-<Config>.log | tail -2`.

## Configurations (v5) and results

Every config except SplitInOrder keeps `ReorderReplies = TRUE`. `OtherCaps = {"a"}` everywhere except
`ProbeTwoSplits.cfg` (`{"a", "b"}`): two split ACKs can be open at once only with four cap names. Probe configs are SPEC-REVIEW-3's
counterexamples, which v3 failed. "Mac" = 8 workers locally; the rest go to the HPC scavenge tier
(`hpc/tlc-scavenge.sbatch`).

| Config | Spec | Bounds (REQ/attempts/NEW-DEL) and switches | v4 result |
| --- | --- | --- | --- |
| `ProbeLost903.cfg` | Spec | 1/2/0, Reauth | 9.86M distinct, no error (Mac); v3 broke the 903 obligation |
| `ProbeReorder.cfg` | Spec | 2/0/0, single-line, reordered | 75.9K, no error (Mac); v3 broke `CapsAgree` |
| `ProbeSplitCross.cfg` | Spec | 1/0/0, multi-line, in order | 26.7K, no error (Mac) |
| `ProbeTwoSplits.cfg` | Spec | 2/0/0, caps a, b, multi-line, reordered, cap-notify REQs | 23.4M, no error (Mac) |
| `ProbeDelSplit.cfg` | Spec | 2/0/2, multi-line, reordered | 7.37M, no error (Mac) |
| `Tiny.cfg` | Spec | 1/1/1, every switch on | 10.8M, no error (Mac) |
| `TinyEnv.cfg` | EnvSpec | as Tiny; safety + server liveness | 10.8M, no error (Mac) |
| `Small.cfg` | Spec | 2/1/1, single-line | HPC, after review |
| `TwoAttempts.cfg` | Spec | 1/2/1 (907 reachable) | HPC, after review |
| `Reauth.cfg` | Spec | 1/2/1, Reauth | HPC, after review |
| `CapNotify.cfg` | Spec | 1/1/1, cap-notify listed and requested | HPC, after review |
| `Split.cfg` | Spec | 2/1/1, multi-line, reordered | HPC, after review (was D17's failure in v3) |
| `SplitInOrder.cfg` | Spec | as Split, in order | HPC, after review |
| `Reference.cfg` | EnvSpec | 2/2/2, every server choice on, Reauth, reordered | HPC (split into the two below) |
| `RefSafety.cfg` | EnvSpec | Reference bounds; invariants and Rule* properties | v5, job 9607 (40 CPUs, gpu05): cancelled after 16h21 to protect /project. Bound: 11.44B distinct states, BFS levels 1-29 complete and level 30 in progress, 4.50B states left on the queue, no violation. Superseded by the split v6 runs. |
| `RefLiveness.cfg` | Spec | 1/2/1, Reference switches; liveness | v5, job 9608 (24 workers, 84g heap, gpu05), started 2026-11-09 15:39 EST; cancelled 2026-11-10 after about 22h30 because v7 supersedes v5. Bound: no violation. Last progress line (13:03:55): 363.98M distinct states, BFS level 40, 38.92M states left on the queue. Last periodic liveness check passed (4 branches of temporal properties, over the 1.356B behaviour-graph nodes of the 346.57M-distinct-state space, 06:51-09:32). To be rerun on v7. |

`Rule907` is vacuous when `Reauth = TRUE` (Reference); TwoAttempts covers the 907 path.
`RequiredQuits` and `Terminates` need the client's fairness, so they are checked only under `Spec`
(they are design properties, not guarantees of the environment). `AnswersEventually`, `OwedSent`
and the Rule* action properties hold under `EnvSpec`.

### Mutation checks (`model/mutants/make-mutants.py`)

Each mutant must fail; the unmutated model passes the same config.

| Mutant | Change | Caught by |
| --- | --- | --- |
| M1Discard | `SrvAnswer` may drop a REQ silently | `RuleAckWhole` |
| M2Owe | a reauth opener clears the owed 903 (v3's bug) | `SuccAccounting` |
| M6NoInc | a success owes no 903 | `SuccAccounting` |
| M7WrongRest | a split's last part lists the wrong caps | `CapsAgree` (checked first; `RuleAckWhole` also forbids it) |
| M3Overlap | client may pipeline overlapping REQs | `CapsAgree` (D17's ambiguity) |
| M4NoDel | client ignores a DEL inside a split ACK | `CapsAgree` (D18) |
| M5SrvNoDel | server ignores a DEL inside a split ACK | `TypeOK` (D18) |

For checking a **client** against the model server, use `EnvSpec` (server fairness only)
with `Reference.cfg`'s switches. The model client then stands for the client under test:
replace its actions with the implementation's, and keep client obligations as properties.

Against a code model of a **server**, the model client is an under-approximation
(fixed opening, no repeated LS, no LIST, no "-cap" removals, no blind REQ, no
overlapping pipelined REQs), so a pass says less in that direction. Out of scope
everywhere: SASL after 001, 901, values and mechanism lists, payload chunking (see
the module header).

Send boundary (D19): appending to `sout` is sending; `SrvSend` is delivery; ERROR only after every owed line.

Run (from `model/`):

    java -XX:+UseParallelGC -cp ~/tools/formal/tla2tools.jar tlc2.TLC -workers 8 -config Small.cfg SpecHandshake.tla

Witnesses (`W_*` in the module) are invariants that are expected to FAIL; check each
alone with `INVARIANT W_x` to see a behaviour the model permits.
