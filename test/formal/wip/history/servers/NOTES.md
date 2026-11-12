# Servers against History's server obligations (chathistory conformance)

What a server must do for `../model/History.tla` to apply to it, checked on a real server. The
first server is Ergo. The same harness is meant to run against nefarious2 later. Nothing in
`drive.py` or `check.py` depends on the server; the only Ergo-specific file is `ergo/mkconf.py`
(the config, labelled as such).

Spec references are `extensions/chathistory.md` (CH), `extensions/batch.md` (BA) and
`extensions/labeled-response.md` (LR) at ircv3-specifications 9ff58d1, the same tree
DECISIONS.md cites. Line numbers match.

## Method

The house style is `../../spec/conformance/` (ERGO.md): drive the real server, reduce what it says
to the model's vocabulary, and check each run.

1. **Seed** (`drive.py`). Four connections (querier `q`, senders `a`, `b`, `c`) negotiate
   batch, server-time, message-tags, echo-message, labeled-response and draft/chathistory. They
   never negotiate event-playback (D3). Each run uses fresh nicks and channels (`<runid>…`), so a
   persistent store never mixes runs.
   - **Ground truth.** Each seeded PRIVMSG's msgid and time come from the sender's own echo. The
     querier's relayed copy is recorded too, with the order it arrived in.
   - **`#…hist`**, 14 lines from three senders:
     - lone lines 5 ms apart;
     - one sender's burst of four lines in a single write (`h04`..`h07`);
     - a two-sender burst (`h09`, `h10`).
   - **`#…tlc`**, kept small for TLC: four lines from one sender, two of them in one write.
   - **Others:** `#…other` (one line, for a foreign msgid), `#…empty` (joined, nothing said),
     `#…nojoin` (the querier is not in it), `#…nosuch` (never created), and one DM each way
     between `q` and `a`.
   - **Channel events.** The querier records every channel event it saw, such as a JOIN with
     its msgid and time. A server may store these and replay them without event-playback.
2. **Query matrix** (`drive.py`). Each query carries a fresh label, followed by a
   `PING`/`PONG` sentinel. Every line up to the sentinel is recorded.
   - **LATEST, BEFORE, AFTER, AROUND** with msgid and timestamp anchors:
     - anchors at the oldest, second, middle, second-newest and newest line, at every member
       of a tie, and at the line just before each tie;
     - limits 1, 2, 3, N and N+5;
     - timestamps that hit no line: before everything, after everything, and between two lines.
   - **LATEST \*** at limits 1, 2, 3, N-1, N, N+1, N+5 and 100.
   - **BETWEEN** in both directions, with msgid/msgid, ts/ts and both mixed forms. Pairs: the
     whole range, the range less one at each end, adjacent lines, the same line twice, across
     each tie, and inside each tie.
   - **Replayed anchors.** Anchors on the oldest and the newest line as the server replays them,
     which may be a stored event.
   - **Unknown selectors**, on both channels, under every subcommand: an unknown msgid, a msgid
     from another channel, and a DM line's msgid.
   - **Empty, unjoined and missing targets;** the DM target; TARGETS in both directions at
     limits 1, 2 and 10.
   - **Snapshot.** Two new lines, then LATEST, AFTER and BEFORE again. Then one line sent at the
     same instant as a LATEST (either snapshot is accepted, D6). Then one more line on `#…tlc`
     (the model's StoreLive) and four modelled queries.
   - **Follow-ups.** For every non-empty page of a directional query, the next page in the same
     direction, as CH:208 builds it from msgids:
     - BEFORE or LATEST \*: `BEFORE <first>`;
     - LATEST with a selector: `BETWEEN <first> <selector>`;
     - AFTER: `AFTER <last>`;
     - BETWEEN: both continuations.
   - **CH:192-208's walk,** without a floor: msgid anchors and timestamp anchors, limits 3
     and 4.
   - **A late joiner** that negotiated chathistory, to check CH:41.
3. **Record**: `results/<server>-<version>.jsonl`. The records are `meta`, `event`, `msg`,
   `query` and `join`.
4. **Check** (`check.py`). Python properties for every query, then TLC trace validation of
   every modelled query (below).

**The store each query sees** is the seeded lines the querier knew of when it sent the query.
If the server replays any channel event in a channel, that channel's events count as stored
lines too.

**The connection's order** is time order. Within a tie it is the server's own order in its
first full answer (`LATEST * 100`), held fixed after that (CH:128). ORDER then checks every other
page against it.

### Python properties (what each mirrors)

| Property | Mirrors | Text |
|---|---|---|
| FRAME | the reply is one labeled FAIL or one `chathistory` batch (type, target param, every inner line tagged, closed), maybe inside a labeled-response batch; inner lines PRIVMSG/NOTICE only; msgid and time on every line; the end tag only on the history BATCH start | LR:53-58, BA:37-54, CH:71, CH:73, CH:136, D11 |
| ELIG | PageEligible (D3): only eligible lines; anchor excluded; a timestamp selects by time (`< t`, `> t`) and a msgid by position (D5) | CH:83, CH:89, CH:95, CH:111 |
| EXACT | ExactCount (D3): `min(limit, eligible)` | CH:69 (a server MAY return more or fewer) |
| CONTIG | Contiguous (D10): the eligible lines nearest the selector | CH:111's counting rule; D10 |
| ORDER | BatchAgrees and TimeOrdered (D7, D8) | CH:126-128 (SHOULDs) |
| END | EndNext (D26), against the snapshot | CH:136 |
| ENDLIVE | the same, measured: the next-page query actually sent returns no eligible line | CH:136 |
| UNKNOWN | UnknownEmpty (MI-5, D5): an empty batch or FAIL | D5 |
| MSGID | a replayed line carries its original msgid (MUST), time (SHOULD) and text | CH:126 |
| AROUND, AROUNDEMPTY | AROUND (not modelled): a contiguous run around the selector, at most `limit` lines; flags an empty answer while lines exist | CH:103, CH:69 |
| TARGETS | targets with latest message inside the bounds, the `limit` nearest the first bound, each with its latest time, ordered by time | CH:113-123 |
| NOAUTO | no playback on JOIN once chathistory is negotiated | CH:41 |
| ISUPPORT | `CHATHISTORY=` (MUST) and `MSGREFTYPES` (SHOULD) | CH:49, CH:51 |

### TLC trace validation

`check.py --tlc DIR` writes one module per modelled query: LATEST \*, BEFORE msgid= and
BEFORE timestamp= on `#…tlc`, including unknown and foreign msgids. Each module EXTENDS History,
in the style of `../../spec/conformance/check.py`.

- **What it pins.** Mode is `"join"`, and `NGap` is the store size.
  - `time` is the rank of each line's wire millisecond. Ties stay ties.
  - `ord` is the server's order.
  - A timestamp selector maps to the rank bound with the same `<` meaning. An unknown msgid
    maps to `2N`, which no stored line has.
  - After the extra line, `LiveOn` is TRUE and the module takes `StoreLive` first, which is
    D6's snapshot.
- **The query is injected,** not chosen by the model client (`Ask`). The client is not under
  test.
- **M (match).** Can `SrvAnswer` (or `SrvFail`) produce exactly the observed page and end tag
  under the strict switches (ExactCount, Contiguous, BatchAgrees, SendsEnd)? The invariant
  `NotDone` being violated means it can. When strict fails, the loose run (all three off) is
  tried as well.
- **I (inject).** The observed page is appended as is, with `el`/`so` from the model's `Elig`.
  Do PageEligible, UnknownEmpty, EndNext and EndTruthful hold? It also checks that the
  injection step was reached (state count ≥ steps + 1).
- **Controls.** Five tampered copies of real cases must be rejected:
  - a reversed batch;
  - the anchor included in its own BEFORE page;
  - a false end tag;
  - an unknown msgid answered with a line;
  - a hole in a LATEST page.
- **Settings.** `-workers 1`. Every module is small: at most 7 stored lines and pages of at
  most 7, at 2-4 states each (the controls stop at 2).

## Ergo: version and config

- **Ergo** `fd87086a02093d0f0910e574d1bf644095bba4ed` (2026-11-09; `ergo-2.20.0-unreleased`),
  cloned with `--depth 1` into `/tmp/claude-0/ergo`, unmodified.
- **Build.** `go build` with `/usr/local/go/bin/go`, which is go1.24 with `GOTOOLCHAIN=auto`.
  Ergo's go.mod asks for go 1.27, so the go1.27.0 toolchain was downloaded and used.
- **Run** on `127.0.0.1:16680`, plain TCP, with the config `ergo/mkconf.py` writes. That is
  Ergo's own `default.yaml` with these changes:
  - one listener, and no TLS listener;
  - fakelag off;
  - the ip-limits throttle, login throttling and client-throttle off;
  - the datastore and language paths made absolute.
- **History** is as `default.yaml` has it:
  - in memory (`persistent.enabled: false`);
  - `channel-length 2048`, `chathistory-maxmessages 1000`;
  - `autoreplay-on-join 0`, `query-cutoff none`.
- **Not run: MySQL-backed persistent history.**
  - From the code alone: selector parsing, the rounding and the end tag live in
    `irc/handlers.go`, shared by both backends. So the BETWEEN finding below should be the same
    there.
  - The MySQL store keeps nanosecond times (`irc/mysql/history.go`), so the tie behaviour is
    probably the same too.
  - Neither is measured.

Reproduce:

```
python3 ergo/mkconf.py /tmp/claude-0/ergo ergo-hist.yaml 16680
/tmp/claude-0/ergo/ergo initdb --conf ergo-hist.yaml && /tmp/claude-0/ergo/ergo run --conf ergo-hist.yaml &
python3 drive.py 127.0.0.1 16680 results/ergo-fd87086.jsonl --server-label ergo-fd87086
python3 check.py results/ergo-fd87086.jsonl --json results/ergo-fd87086.check.json --tlc WORKDIR -j 3
```

## Results on Ergo fd87086

The run is `results/ergo-fd87086.jsonl`. It made 2224 queries: 1193 from the matrix and 1031
follow-ups.

| Subcommand | Matrix queries | Follow-ups |
|---|---|---|
| BETWEEN | 444 | 716 |
| LATEST | 202 | 0 |
| BEFORE | 196 | 175 |
| AFTER | 173 | 140 |
| AROUND | 172 | 0 |
| TARGETS | 6 | 0 |

The checker's output is `results/ergo-fd87086.check.txt` (a summary) and `.check.json` (every
deviation).

**Ties were achieved.**
- `h04`..`h07` (one sender's burst) share one millisecond.
- `h09`/`h10` (two senders) share one millisecond.
- `t2`/`t3` share one millisecond.
- The JOINs of `a`, `b` and `c` share one millisecond.

Ergo's order within every tie matched the querier's relay order. In an earlier trial run the
cross-sender pair arrived as `h10, h09`, and the server's order was `h10, h09` too.

Ties depend on timing, so the matrix (which anchors on tie members) varies a little between
runs. A later run gave 2012 queries.

| Property | Pass | Fail | n/a | Verdict |
|---|---|---|---|---|
| FRAME | 2224 | 0 | 0 | holds. The label sits on the `chathistory` BATCH itself, with no labeled-response wrapper. |
| ELIG (PageEligible) | 1711 | 303 | 2 | **fails, BETWEEN only** (finding 1) |
| EXACT | 1829 | 349 | 2 | fails: the same BETWEEN queries, plus AROUND (findings 1, 3) |
| CONTIG | 1709 | 303 | 2 | fails on exactly the ELIG queries (finding 1) |
| ORDER | 2014 | 0 | 2 | holds. Ascending; the full store is in time order; ties in insertion order, the same on every page. |
| END (EndNext) | 1232 | 0 | 846 | holds. Never a false end tag. |
| ENDLIVE | 297 | 0 | 0 | holds |
| UNKNOWN (UnknownEmpty) | 36 | 0 | 2 | holds. An unknown, foreign-channel or DM msgid always gets an empty batch. |
| MSGID | 3810 | 477 | 0 | fails only on replayed channel events (finding 2). Every seeded line keeps its msgid, time and text. |
| AROUND | 166 | 0 | 0 | holds |
| AROUNDEMPTY | 0 | 6 | 0 | latitude (finding 3) |
| TARGETS | 6 | 0 | 0 | holds. Ascending by time; the `limit` nearest the first bound; an unjoined channel never listed. |
| NOAUTO | 1 | 0 | 0 | holds (with `autoreplay-on-join 0`, the default) |
| ISUPPORT | 2 | 0 | 0 | `CHATHISTORY=1000`, `MSGREFTYPES=msgid,timestamp` |

- **Snapshot.** The four queries after new lines matched the extended store. The racing LATEST
  matched the snapshot before the racing line; in a trial run it matched the snapshot after.
  Both are D6-consistent.
- **`chathistory-end` coverage.** Ergo tags a page exactly when it is shorter than the limit.
  219 last pages went untagged because they were exactly full. That is SendsEnd latitude
  (CH:136 is a SHOULD), and Ergo's handler says so (handlers.go, at the TARGETS end tag).
- **FAIL.** The two FAIL replies are `INVALID_TARGET` for the channel the querier is not in and
  for the channel that does not exist. Those match CH:150. FAIL is a completion (CH-7), not a
  deviation.

### TLC (local, `~/tools/formal/tla2tools.jar`, `-workers 1`)

The modules and cfgs are in `results/ergo-fd87086.tlc/` (`summary.json` per case). The total
wall time was about 2 minutes, at `-j 3`.

| What | Runs | Result |
|---|---|---|
| Real observations, M_strict | 115 | **115 match** (3 distinct states each; 4 after StoreLive) |
| Real observations, I | 115 | **115 hold** (PageEligible, UnknownEmpty, EndNext, EndTruthful) |
| Controls, M_strict | 5 | 5 NO MATCH, as expected |
| Controls, I | 5 | anchor-included and unknown-answered violate PageEligible; false-end violates EndNext; reversed and hole hold, as expected (they break switches, not invariants) |
| Controls, M_loose | 5 | reversed and hole match (BatchAgrees and Contiguous off); the other three do not |

- **What the 115 observations cover:**
  - 111 before and 4 after the extra line (StoreLive);
  - pages of 0 to 7 lines;
  - BEFORE msgid on each tie member;
  - BEFORE timestamp at a tied millisecond;
  - unknown, foreign and DM msgids;
  - the replayed (HistServ) msgids as anchors.
- **Nothing was left for the cluster.** The largest module, LATEST \* 10 after the extra
  line, finished in under a second.
- **So for LATEST \* and BEFORE (msgid and timestamp),** Ergo is a model server in the
  strictest environment: ExactCount, Contiguous, TimeOrdered, BatchAgrees, and SendsEnd used
  only truthfully.

## Findings

Each finding is given as selector, expected (with cite), and observed. The classes follow
ERGO.md:

- (a) breaks a MUST;
- (b) goes against a SHOULD;
- (c) a choice the spec leaves open;
- (d) not a deviation;
- (W) a client-side witness.

### 1. BETWEEN with one timestamp bound, or two equal ones, includes lines at that timestamp. Class (a).

- **Selector.** One of these:
  - `BETWEEN <target> msgid=X timestamp=t N`, either order and either direction;
  - `BETWEEN <target> timestamp=t timestamp=t N`.
- **Expected.** CH:111: "counted starting from and excluding the first message selector, while
  finishing on and excluding the second" (MUST).
  - A timestamp selector excludes by time (D5's reading, and Ergo's own BEFORE, AFTER, LATEST
    and distinct-timestamp BETWEEN all do this).
  - So a line whose `time` is `t` is not eligible.
  - `BETWEEN t t` has nothing eligible.
- **Observed.** The lines stamped `t` are returned and counted toward the limit. Examples:
  - `BETWEEN msgid=h14 timestamp=<h01's time> 19` returns `h01..h13` (h01 is ineligible).
  - `BETWEEN timestamp=<h08's time> timestamp=<same> 1` returns `[h08]`.
  - With a tie at `t`, every tied line comes back (`BETWEEN msgid=h06 timestamp=<the tie> 19` →
    `h04, h05`).
- **Scale.**
  - 120 of the 216 mixed-form matrix queries;
  - all 60 equal-timestamp matrix queries;
  - 123 follow-ups.
  - Every one of the 465 ineligible lines sits exactly at a timestamp bound (checked).
  - EXACT and CONTIG fail on the same queries, as a consequence.
- **Why** (`irc/handlers.go:929-936`). Ergo rounds a BETWEEN bound up by 1 ms only when both
  bounds are timestamps, and only the chronologically first. With one msgid bound nothing is
  rounded, so the timestamp end compares as `item.Time.After(t)` on nanosecond times
  (`irc/history/history.go:192`), and a line at `t + 0.3 ms` passes. With equal timestamps, the
  `else` branch rounds the end, giving `(t, t+1ms)`.
- **Classification.** This is a real deviation from CH:111's exclusion, not latitude.
  - It is inconsistent with Ergo's other paths, which use whole-millisecond semantics.
  - One could argue that a line at `t + 0.3 ms` is "after `t`". But the client only sees `t`,
    so it cannot use such a reading.
  - Out of History's scope: D26 does not model BETWEEN, so there is no TLC case.
  - It matters to CH:220's infinite-scroll `BETWEEN` when one bound comes from a timestamp.
  - Not filed.

### 2. Channel events stored and replayed as HistServ PRIVMSG with a derived msgid. Class (c), and outside D3.

- **Selector.** Any query whose range covers a JOIN, without event-playback.
- **Expected.** D3 (a restriction) has the store hold only PRIVMSG. CH:73 lets a server without
  event-playback send only PRIVMSG/NOTICE. CH:126: a replayed msgid "MUST be the msgid tag as
  originally sent".
- **Observed.** Each JOIN comes back as
  `:HistServ!HistServ@localhost PRIVMSG #c :<nick> joined the channel` at the JOIN's original
  time, with msgid `_<the JOIN's msgid>` (`irc/channel.go:1155`).
  - These lines count toward the limit and fill pages.
  - `#…empty` is therefore never empty.
  - The `_` id works as an anchor, because Ergo strips it before lookup (`NormalizeMsgid`).
- **Classification.** CH:73 is met literally: they are PRIVMSGs. CH:126 is arguable, since the
  line is a synthesized notice, not the original message.
  - So this is (c): the spec does not address synthesized lines.
  - For the model, these are ordinary store lines, and every History property held with them
    in the store.
  - For a client: a gap fill shows "X joined" lines, and they use up the page budget (D14).

### 3. AROUND returns fewer than it could, and nothing at the oldest line. Class (c), latitude.

- **Selector.** `AROUND msgid=X N` or `AROUND timestamp=t N`.
- **Expected.** CH:103: "a number of messages before and after … not exceeding limit; the
  implementation may decide how many to include before and after". CH:69: servers "should
  attempt" (lower case) to return `limit`, and "MAY return more or fewer".
- **Observed.** Ergo takes the `ceil(N/2)` lines before the selector, then returns `N` lines
  *after the oldest of those*, which drops that oldest one (`irc/history/queries.go:33-46`).
  - So a page holds one line fewer than it could whenever more history exists (52 queries).
  - When nothing is older than the selector, the answer is an empty batch tagged
    chathistory-end (6 queries). That happens at the oldest stored line, or at a timestamp
    before everything. Ergo's code says so: "TODO: this fails if we're doing an AROUND on the
    first message".
- **Classification.** Latitude, not a violation.
  - The end tag on an AROUND has no defined "next page" (CH:136 speaks of a direction).
  - AROUND is not modelled (D26).

### 4. `chathistory-end` only on short pages. Class (d).

- **Expected.** CH:136 SHOULD; D9 / SendsEnd allows tagging or omitting per response.
- **Observed.** Ergo tags a page exactly when it is shorter than the limit. A page that exhausts
  history exactly is untagged (219 cases). No false tag ever (END 0 / ENDLIVE 0 failures, and
  TLC's EndNext and EndTruthful hold on all 115).

### 5. msgid selectors resolve to a hidden nanosecond time. Class (d) as observed; latent.

- **Expected.** D5: a msgid selector excludes just that message, by position.
- **Observed.** It does. `BEFORE msgid=h06` returns `h04, h05`, its wire-millisecond tie
  siblings, and TLC matched every tie-member anchor.
- **The latent case (code only).** Ergo turns a msgid into its stored time and selects by time
  (`irc/history/history.go:172-195`). The page is right only because no two stored lines share
  a nanosecond. If two lines ever had the same stored time, a msgid selector would drop its tie
  siblings, which is D5's timestamp witness applied to msgids. Not reachable on one server in
  practice; not observed.

### 6. Timestamp paging across a tie loses lines (W, client side, confirms D5's witness on a real server)

- **The walk.** CH:192-208's walk with `BEFORE timestamp=<first>`:
  - at limit 3 it missed `h04, h05`;
  - at limit 4 it missed `h04, h05, h06` and two JOIN lines.
- **The cause.** The tied lines straddle a page boundary, and `< t` skips the rest of the tie.
- **The msgid walk** retrieved all 18 lines at both limits, with no duplicates.
- **Classification.** Not a server deviation: Ergo answers each timestamp query correctly.

### Nothing else

- **No violation found** in LATEST (\*, msgid, timestamp), BEFORE, AFTER, BETWEEN msgid/msgid,
  BETWEEN with distinct timestamps, unknown selectors, TARGETS or framing.
- **Spec latitude seen:**
  - limit above `CHATHISTORY=` is clamped (code; not exercised past 100);
  - `BEFORE *` is accepted as LATEST (code, a compatibility hack; not exercised).

## What was not done

- **Persistent (MySQL) history** was not set up. The notes above are code reading only.
- **StableAcrossReconnect** was not exercised: all queries ran on one connection. A second
  querier connection comparing tie order would test D7's cross-connection switch.
- **TLS, SASL, server passwords and WebSocket.** `ircwire.py` supports TLS, SASL PLAIN and
  PASS, but none was exercised against Ergo.
- **draft/event-playback** is never negotiated (D3).
- **History expiry and the `limit` clamp** were not exercised.
- **History.tla's catch-up client** (reconnect/more) was not driven against Ergo. That is a
  client check (Seance's replay adapter), not a server one.
- **BETWEEN, AFTER, AROUND, TARGETS and LATEST with a selector** have Python checks only. The
  model has no action for them (D26).

## Running against another server (nefarious2)

```
python3 drive.py HOST PORT results/<server>-<version>.jsonl --server-label <server>-<version> \
    [--tls [--insecure] [--sni NAME]] [--pass PW] \
    [--sasl q=acct:pw --sasl a=acct2:pw2 --sasl b=… --sasl c=… --sasl l=…] \
    [--pace 2.1] [--small]
python3 check.py results/<server>-<version>.jsonl --json results/<server>-<version>.check.json \
    > results/<server>-<version>.check.txt
python3 check.py results/<server>-<version>.jsonl --tlc WORKDIR -j 2      # TLC, small, local
```

- **Required.** The server must offer `draft/chathistory` (or `chathistory`) and
  `echo-message`. The seed's ground truth is the echo, so without echo-message the seed times
  out. `batch`, `server-time`, `message-tags` and `labeled-response` are used when offered.
  Without labels, the reply is taken to be the first BATCH or FAIL before the PING sentinel.
- **Accounts.** If the server keeps history only for logged-in users, pass `--sasl` for each
  role. With one account for several roles, a bouncer-style server may merge the connections;
  use separate accounts.
- **Fake lag.** nefarious2 charges about 2 s per command. `--small` cuts the run to about 780
  queries (measured on Ergo: 779), and `--pace` spaces them. The full matrix is about 2200.
- **Persistent stores.** Nicks and channels carry a random run id (`--runid` to fix it). The
  channels are left behind.
- **TLC** uses the `#…tlc` channel only, and needs `History.tla` at `../model/`. No cluster wrapper
  was written or used: every module finished locally.

## Files

- `ircwire.py`: the minimal IRCv3 client (TCP/TLS, CAP 302, SASL PLAIN, tag parsing).
- `drive.py`: seed, matrix, follow-ups and walks; writes the observation jsonl.
- `check.py`: the Python properties, plus TLC module generation and the TLC runs, with
  controls.
- `ergo/mkconf.py`: the Ergo config (Ergo-specific).
- `results/ergo-fd87086.jsonl`: the observations.
- `results/ergo-fd87086.check.txt` and `.check.json`: the checker's verdicts.
- `results/ergo-fd87086.tlc/`: one TLC module and its cfgs per modelled query, plus
  `summary.json`.
