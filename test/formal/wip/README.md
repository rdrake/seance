# Formal models, work in progress

A snapshot of the TLA+ work, so it can carry on away from the Mac where it was written. It is
not wired into the build or the tests. The finished parts will move to `test/formal/` proper.

- `spec/`: the handshake spec model (CAP 302, cap-notify, SASL 3.1/3.2, pre-registration),
  built from the IRCv3 spec text.
  - `model/SpecHandshake.tla`, its configs and `mutants/`;
  - `RULES.md` (rules and citations), `DECISIONS.md`, `README.md` (results), `QUEUE.md` (plan);
  - `conformance/`: trace recording and trace checking (`check.py`);
  - `hpc/`: the Slurm scripts.
- `bouncer/`: account state across a netsplit and a P10 burst in nefarious2, with a bouncer
  session (`model/Bouncer.tla`); `DECISIONS.md`, `DESIGN.md`, `NOTES.md` (results, and the
  configs left for the cluster).
- `history/`: the history and delivery work.
  - `RULES.md`, `DECISIONS.md`, `DESIGN.md`, the Codex reviews and their prompts;
  - `model/Delivery.tla` (v1), its configs, the lists `list-d*`, and `mkmut.py`, which
    regenerates the `DM_*` and `DS_*` mutants from `Delivery.tla`.

Citations such as `CN:355` or `BA:55` are line numbers in the IRCv3 specification sources
(`extensions/capability-negotiation.md`, `extensions/batch.md`, and so on). The reviews read
them from a local copy at `../formal-spec/specs-src/`; clone `ircv3/ircv3-specifications`
there to follow them.

All model checking runs on the cluster, never on a laptop or in a cloud container. A bundle of
checks is one `sbatch` of `spec/hpc/tlc-bundle.sbatch` with `RUN_ROOT` set to the run
directory, which holds the `.tla`, `.cfg`, list, `tla2tools.jar` and `temurin21.sif`:

    RUN_ROOT=$PWD sbatch -c 16 --mem=64G --export=ALL,RUN_ROOT=$PWD tlc-bundle.sbatch list-d2

Each list line is `<module> <config> <pass|fail>`. The job writes one `tlc-<config>@<module>.log`
per check and `bundle-<list>.summary`.
