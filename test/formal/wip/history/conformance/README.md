# Delivery client checks

These files check a client's handling of its own sent messages against `../model/Delivery.tla`
(v2.2): labels, echo-message, batches, failures, timeouts and close. Formats are in `SCHEMA.md`.

- `scenarios.py` writes `scenarios.jsonl`, the 39 scenarios. It needs no server: each driver
  feeds the scenario's lines straight to the client.
- `drivers/` holds the Textual-NG and HexDroid drivers. Seance's driver is
  `test/formal/delivery/drive.ts`.
- `check_delivery.py` turns one observation file into TLC trace checks against the model, under
  every Fallback × Deferred config, and also runs the Python property checks.
- `hpc/` holds the Slurm wrappers. `dcheck.sbatch` checks one observation file, and `mutants.sh`
  runs the mutant controls.
- `results/` holds the observations, one file per client and sha.

## Rerunning the Seance check

1. Record the observations. This writes `results/seance-<sha>.jsonl` and `-nolabel.jsonl`:

       pnpm build
       SEANCE_DELIVERY_DRIVE=1 NODE_ENV=test pnpm exec mocha --config=test/.mocharc.yml test/formal/delivery/drive.ts

   The driver is skipped unless `SEANCE_DELIVERY_DRIVE=1`, so `pnpm test` never runs it. It
   prints each scenario's final outcomes, and then any self-check mismatch against echo1,
   fail1, ack1, silence and close. Until fail1 is fixed, that mismatch is fail1.

2. Check them with TLC. That runs on the cluster, never on a laptop. The run directory holds
   `check_delivery.py`, `scenarios.jsonl`, the observation file, `model/*.tla`, `tla2tools.jar`
   and `temurin21.sif`:

       RUN_ROOT=$PWD sbatch hpc/dcheck.sbatch seance-<sha>.jsonl work-seance
       grep -v 'props=ok' work-seance/summary.txt

   Each line of `summary.txt` gives a scenario, its tag, the configs it matches (`match=`, or
   `-` for none) and its property verdicts. A guaranteed scenario that matches no config, or
   fails a property, is a bug.

## Seance at 4f5a4bd12 (the baseline before fixes)

Scenarios that fail now and should pass once fixed:

| Scenario | Now |
| --- | --- |
| fail1, failB, noteFB | no match; still pending at the end |
| failEcho | no match; confirmed by a FAIL line |
| interleavedSwap | no match; each copy confirmed by the other's echo |
| modBatch | no match |
| W_Other, W_SelfCopy, U_other | confirmed by a line that isn't its own |
| W_LateTimedOut | confirmed by an earlier request's late echo |
| U_err, U_errTwo | still pending after the 404 |

The model does not cover what is displayed, so it does not see messages shown twice: messages to
self, and an echo plus its history replay (histOpen). Each observation's `shown` field counts
them.
