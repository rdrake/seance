# Local nefarious2 for the chathistory conformance harness

A nefarious2 of its own for the server checks against the History model
(`test/formal/wip/history/`). It runs on 127.0.0.1 only, and never against
AfterNET.

- **Image:** stock evilnet `ircv3.2-upgrade`. On 2026-11-12 that was
  e81d12aa, which includes the a428911b tag fix.

      git clone --branch ircv3.2-upgrade https://github.com/evilnet/nefarious2.git
      cd nefarious2 && docker build -t nefarious2:ircv3 .

  Set `NEFARIOUS_IMAGE` to use another tag.
- **Run:** `./run.sh` starts the container `nef2-conformance` detached. Ports:
  16667 plain IRC and 18067 `ws://`. Watch it with
  `docker logs -f nef2-conformance`.
- **Config:** `ircd.conf` includes the image's `base.conf`, this `local.conf`
  (a copy of `tools/nefarious-dev/local.conf`: chathistory on,
  `CHATHISTORY_REQUIRE_AUTH` FALSE) and an IAuth block for iauthd-ts.
- **Account:** `conftest`, which logs in with SASL PLAIN through iauthd-ts,
  with no services. The password comes from `$CONFTEST_PASSWORD`, or else from
  `state/test-password.txt`, which is random and made on first run. `run.sh`
  writes it to `state/saslusers`, the SASLDB file, as a plain-text password.
  `state/` is gitignored.
- **IAuth policy:** `SRTAWUwFr`.
- **Check:** `python3 -I smoke.py` logs in, registers, sends a line and reads
  it back with `CHATHISTORY LATEST`.
