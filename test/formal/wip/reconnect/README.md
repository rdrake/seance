# Reconnect policy and IRCv3 STS (StsReconnect, ConnectPath)

A spec-first TLA+ model of IRCv3 Strict Transport Security together with Seance's reconnect policy, checked against Seance's code. It sits beside the History, Delivery, Edit, Session, Handshake, SASL and Bouncer models.

- `RULES.md`: every rule in scope with file:line and its encoding (guard/prop/switch/free/out): STS (`extensions/sts.md` at `9ff58d13`), the capability-negotiation rules STS relies on, and Seance's own reconnect design (SC rules, from `docs/resources/irc-layer.md` and the code).
- `DECISIONS.md`: readings D1-D16, written before the model (D16 after the first runs), open questions Q1-Q4, and the findings F1-F5.
- `model/StsReconnect.tla`: STS and the reconnect schedule over several networks on one host sharing one policy store, the server's two throttles (IPcheck and `ERROR … throttled`), the user, the foreground poke and a page reload.
- `model/ConnectPath.tla`: one connection after 001: fake lag, the background queue, the user's lines, "nothing before 001" and the restore wait.
- `model/make-configs.py`: the single source of every `.cfg` and of `runs.txt` (module, config, expected verdict). It checks each config against its module. `model/mutants/make-mutants.py` writes the mutants and `runs-mutants.txt`.
- `model/run1.sh`, `model/runall.sh`: one TLC run, and every limited run with its verdict against the expectation (`model/results.summary`). `model/trace.py` prints a counterexample one step a line.
- `conformance/drive.ts`: drives Seance's own `IrcClient` and `WsTransport` (fake WebSocket and server, fake timers, jitter pinned high) through 13 scenarios and records them (`conformance/results/seance-4f5a4bd12.jsonl`). `conformance/trace_check.py` checks each recording against the model with TLC (`conformance/results/trace-check-4f5a4bd12.txt`). `conformance/findings.ts`: one failing mocha test per Seance finding.

Seance's code is the branch base `4f5a4bd12`; evilnet `develop` at `ef782edf1` changes none of `sts.ts`, `transport.ts`, the reconnect and STS paths of `client.ts`, or the restore wait in `persistence.ts`.

## Spec-first, and Seance's switches

The model's client obeys the STS rules. Where Seance's code departs from one, a switch reproduces the code (all FALSE in the positive configs):

| Switch | Seance's code | Property it breaks | Finding |
| --- | --- | --- | --- |
| `SeanceRetry` | the transport's timer retry dials the URL it was built with; only `IrcClient.connect()` applies a policy | `RuleNoPlainDialWithPolicy` | F1 |
| `SeanceStsAfterCaps` | the CAP handler answers the final LS (REQ, and END without SASL) before `checkSts` runs | `UpgradeBeforeRegistration`, `RuleNothingAfterUpgrade` | F2 |
| `SeanceReschedule` | an expired policy is not rescheduled at the close; a page unload reschedules nothing | `RuleRescheduleOnClose` | F3, F4 |

The `SeanceRest*` configs turn every switch on and check every other property: they hold.

## Configurations

Time is scaled in the limited configs (`Init 1, Cap 6, Quick 1,2, Unreached 5+{0,1}, Stable 3, Throttle 5, Window 4, IpLimit 3`), keeping the orderings Seance relies on (D4). The trace check and `RefReal` use the real scale in seconds.

| Config | Run | What it exercises |
| --- | --- | --- |
| `Upgrade` | limited | one `ws://` network: upgrade on `port=`, persistence over TLS, the secure port failing, upgrade port changes, duration changes, NEW, DEL, a reload |
| `UpgradeSasl` | limited | the same with SASL (the LS flush holds `CAP END`) |
| `Secure` | limited | one `wss://` network: expiry, reset, `duration=0`, reschedule at every kind of close, the server's throttle, the user, a reload |
| `Schedule` | limited | the reconnect schedule: drops, the host going down, IPcheck, the poke, the throttle; `ReconnectsWithin` is live |
| `Two` | limited | a `ws://` and a `wss://` network on one host sharing the policy (D1, D6) |
| `TwoIp` | limited | two `wss://` networks sharing IPcheck's chain: everything but `ReconnectsWithin` |
| `TwoIpNoCount` | limited | the same with `FEAT_IPCHECK_COUNT_REFUSALS` off: everything, `ReconnectsWithin` included |
| `LockoutTwoIp` | limited, must FAIL | `ReconnectsWithin` with two dialers on one address (F5) |
| `SeanceRetry`, `SeanceAfterCaps`, `SeanceAfterCapsSasl`, `SeanceReschedule`, `SeanceRescheduleExpired` | limited, must FAIL | each Seance switch against its property |
| `SeanceAfterCapsSaslEnd` | limited | with SASL, Seance's upgrade flush has no `CAP END` |
| `SeanceRest<base>` | limited | every switch on, every other property |
| `CPHeld`, `CPNotHeld` | limited | ConnectPath with and without a held session |
| `Reference` | **comprehensive, not now** | two networks (plain+SASL, secure), every env kind, MaxEnv 5, MaxTime 24 |
| `RefReal` | **comprehensive, not now** | one plain network at the real scale, MaxTime 400 |
| `LockoutTwoIpReal` | **comprehensive, not now** (must FAIL) | F5 at the real scale; over 60M states in 9 minutes |
| `TwoIpRealNoCount` | **comprehensive, not now** | the same with refusals not counted |
| `CPReal` | **comprehensive, not now** | ConnectPath with the real waits |

Every witness (`W_*`, 27 of them) is a limited config whose invariant must FAIL, showing the feature is reached. Every mutant (`MU_*`, 25) must FAIL the one property named in its config.

### Commands

From `model/` (`run1.sh` takes the module, the config and a cap in minutes; TLC is `java -XX:+UseParallelGC -cp ~/tools/formal/tla2tools.jar tlc2.TLC -workers $WORKERS`, 3 unless `WORKERS` is set):

    python3 make-configs.py && (cd mutants && python3 make-mutants.py)
    ./runall.sh            # every limited config, witness and mutant -> results.summary

Comprehensive (later):

    for C in Reference RefReal LockoutTwoIpReal TwoIpRealNoCount; do ./run1.sh StsReconnect $C 600; done
    ./run1.sh ConnectPath CPReal 600

Trace check (from the repository root, then `conformance/`):

    SEANCE_RECONNECT_DRIVE=1 SEANCE_SHA=<sha> NODE_ENV=test npx mocha --config=test/.mocharc.yml \
      test/formal/wip/reconnect/conformance/drive.ts
    python3 trace_check.py results/seance-<sha>.jsonl <workdir>

Findings tests (fail until fixed):

    SEANCE_RECONNECT_FINDINGS=1 NODE_ENV=test npx mocha --config=test/.mocharc.yml \
      test/formal/wip/reconnect/conformance/findings.ts

## Results

See `RESULTS.md`: every limited run, witness and mutant (`model/results.summary`), the trace check, and the findings with their tests.
