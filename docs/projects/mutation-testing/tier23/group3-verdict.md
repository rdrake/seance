# Group 3 verdict (166 mutants)

Counts: **equivalent 86 · untested 69 · weak-test 7 · unsure 4 · possible-bug 0**

A note that applies to several rows: `IrcClient.handleMessage` (client.ts:2516) wraps every handler in try/catch and only `console.error`s a throw. A guard whose removal just makes the handler throw a TypeError before it has done anything therefore changes nothing a test can see except a console line. Those rows are marked "equivalent (wrapper)". Where the throw cuts off work the handler would otherwise have done, the row is not marked equivalent.

## client/js/irc/handlers/metadata.ts (41)

| ids                                                                                  | class                      | reason / test                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------------------------------------------------------------ | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 5055                                                                                 | equivalent                 | `OWN_KEYS.has(undefined)` is already false                                                                                                                                                                                                                                                                                                                                           |
| 5071 5073 5079 5084 5086 5097 5099 5117 5130 5140 5145 5156 5174 5179 5184 5194 5219 | equivalent                 | `?? ""` fallbacks for a missing target/visibility/key: `""` and `"Stryker was here!"` are both "not our nick", "not private" and not a key in SHARED                                                                                                                                                                                                                                 |
| 5121 5138 5149 5160                                                                  | untested (malformed only)  | 761 with no value param: a 761 always carries one. Low value                                                                                                                                                                                                                                                                                                                         |
| 5090 5103                                                                            | untested                   | a value-less `METADATA <me> seance/presence\|seance/mode\|seance/closed private` (a key cleared on another device) should be read as `""`. Tests send value-less lines only for the mute key                                                                                                                                                                                         |
| 5077                                                                                 | unsure (likely equivalent) | mute line with no value: `""` and `"Stryker…"` both parse to no entries. The difference is in `ownEcho`'s match against a pending clear, and "echoes of our own writes still in flight are not another device's" (pushMute.ts:413) did not notice it                                                                                                                                 |
| 5068                                                                                 | untested                   | L46 key check → true: every private/own METADATA line (presence, mode, closed) goes into `onMuteValue`. Example: while another device's DND is live, `METADATA alice seance/presence private :away <t>` replaces `muteValue` → `dnd:cleared` fires. No test checks that another key leaves the mute state alone                                                                      |
| 5091 5093 5094                                                                       | untested                   | L58 closed-key check → true, or `&&`→`\|\|`: other keys' values go into `onClosedValue`, and under `\|\|` another user's **public** `seance/closed` (`METADATA bob seance/closed * :…`) would be adopted, silencing queries. Untested                                                                                                                                                |
| 5114 5153                                                                            | untested                   | 761 dispatch → true: a 761 for one own key (presence/payload/closed) is also fed to `onMuteValue` / `onClosedValue(…, true)` (sets `closedKnown` and can trigger `writeClosed` before the real closed read). The cross-key isolation is not pinned                                                                                                                                   |
| 5168 5170 5171 5188 5190 5191                                                        | untested                   | 766 dispatch → true, or `&&`→`\|\|`: `766 … seance/presence :key not set` would count as "mute cleared" (a live DND adopted from another device ends with `dnd:cleared`) and as an empty closed read. Untested                                                                                                                                                                       |
| 5083 5085 5098                                                                       | untested                   | `ours()` for the shared and closed keys. 5083 drops "own legacy public value under our nick"; 5085/5098 drop "private value under another nick". The pushMute test "takes a private value under another nick, never a public one" pins this for the mute key only. presenceShare's `live()` and closedQueries' lines always use target `alice`, and the closed ones use `*` (public) |
| 5216                                                                                 | untested                   | a metadata batch not naming us ends the `shareUnread` hold early; only `BATCH +m1 metadata alice` is tested                                                                                                                                                                                                                                                                          |

## client/js/helpers/animatedImage.ts (31)

| ids                         | class      | reason / test                                                                                                                                                                               |
| --------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 425 426                     | untested   | the `catch` in `isAnimatedImage`: a Blob whose read rejects should give `false`                                                                                                             |
| 257 260 261 262             | equivalent | `fourcc` bounds: out-of-range bytes give `\0` characters, which never equal a 4-letter ASCII tag (the only `startsWith("PNG")` case still ends in `false` via isAnimatedPng's length check) |
| 288                         | equivalent | `bytes[20]` undefined → `& 2` is 0                                                                                                                                                          |
| 299 302                     | equivalent | the signature loop rejects a short buffer anyway                                                                                                                                            |
| 317                         | equivalent | past the end, `fourcc` is `""` and the loop just steps on to `undefined`                                                                                                                    |
| 386 387 394                 | equivalent | the downstream checks (fourcc length, isAnimatedAvif's own ftyp check) give the same answer                                                                                                 |
| 407 409 410 411 413 414 416 | equivalent | they only change how much of the file gets read. A re-read of the full file sniffs the same verdict (performance only)                                                                      |
| 441 468 472 474             | equivalent | GIF walk at the very end: `undefined`/NaN offsets end the loop with the same frames                                                                                                         |
| 485 486 488                 | equivalent | a truncated GCE has no image after it, so its delay never counts                                                                                                                            |
| 520 522 556 558             | equivalent | WebP/APNG loop bounds: an 8-byte header at the end can't be an ANMF/fcTL (they need +23/+24), and reads past the end give type `""`                                                         |

## client/js/helpers/emoji.ts (21)

| ids                                                 | class      | reason / test                                                                                                                   |
| --------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------- |
| 609                                                 | untested   | a failed catalog import is not cached (`pending = undefined`), so a retry loads again                                           |
| 610 611 612 613 614 615 616 617 618 619 621 622 623 | untested   | `prefetchEmojiCatalog` has no test at all: the memo skip, `requestIdleCallback` with its timeout, the 3 s `setTimeout` fallback |
| 636 638                                             | equivalent | an early return that the loop reproduces                                                                                        |
| 648                                                 | equivalent | each control character → a space, and `\s+` collapses them afterwards                                                           |
| 654 656                                             | equivalent | slice/join/trim of a string already within the limit and already trimmed is the identity                                        |
| 755                                                 | equivalent | `score += undefined` is NaN and gets filtered anyway                                                                            |
| 704                                                 | equivalent | splitting on single separators leaves empty tokens, which are filtered                                                          |

## client/js/irc/handlers/mode.ts (20)

| ids                                     | class                | reason / test                                                                                                                                                                                                                                                                                        |
| --------------------------------------- | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 5371 5373 5374 5376 5377 5378 5379 5380 | untested             | the 221 RPL_UMODEIS handler: `setOwnModes` plus the lobby MODE_USER line with `showInActive`. Never run                                                                                                                                                                                              |
| 5272 5273 5277                          | weak-test            | test/irc/handlers/mode.ts "a change no user's prefix depends on does not touch the list" sends `+o nobody` and asserts no `users` payload. Without the guard, `user.modes` throws (the wrapper logs it), so the test still passes. Missed consequence: in `MODE #c +oo nobody bob`, bob's op is lost |
| 5267 5275                               | equivalent           | the L70 guard already makes them redundant (a non-prefix mode has no `prefixForMode`, and a prefix mode always has a symbol)                                                                                                                                                                         |
| 5320 5321                               | equivalent (wrapper) | MODE for a channel not listed: `chan.userRef` throws before any state changes. No test, but the guard has no other effect                                                                                                                                                                            |
| 5298 5299                               | untested (malformed) | MODE with no params: without the guard, scripts get `dispatchMode` with `target: undefined`                                                                                                                                                                                                          |
| 5263 5290 5337                          | untested (malformed) | `+k` with no param; MODE/324 with no modes param                                                                                                                                                                                                                                                     |

## client/js/irc/handlers/join.ts (15)

| ids                           | class                | reason / test                                                                                                                                                                                                                                                                                                                                           |
| ----------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 4536                          | weak-test            | test/irc/handlers/join.ts "our JOIN for a channel we are already in changes no state" checks `channel:state`, the users and the messages, but not `modesKnown`. The mutant resets it, so the next open asks MODE again, which is exactly what CLAUDE.md's "no second MODE" rule forbids                                                                 |
| 4540                          | weak-test            | test/irc/persistence.ts "holds the autojoin through an unbatched burst and its bouncer note": the JOINs land 1 ms before the note's quiet timer and are meant to re-arm it, but the test ticks a full `RESTORE_QUIET_MS` before it asserts, so the hold ending at the note's timer instead goes unnoticed (`noteRestorationActivity` removed from JOIN) |
| 4531                          | untested             | another user's JOIN takes the `self` branch: `autoJoin = true`, `modesKnown = false` (MODE re-asked on the next open), and it re-arms the restoration hold. "someone else joining keeps the user list and its prefixes" asserts none of this                                                                                                            |
| 4460 4484                     | equivalent (wrapper) | 4460: a sourceless JOIN throws at L16. 4484: a replayed JOIN with no channel and no replayTarget throws at `chan.userRef`. In both cases nothing happened beforehand, so the result matches the guard. ("a JOIN with no one behind it is ignored" would catch 4460 only by also asserting no `console.error`)                                           |
| 4478 4479 4491 4494 4544 4547 | equivalent           | after `if (!nick) return`, `msg.source` is always defined                                                                                                                                                                                                                                                                                               |
| 4492 4495 4545 4548           | untested             | the hostmask when the prefix has no `user@host` (a nick-only source)                                                                                                                                                                                                                                                                                    |

## client/js/irc/handlers/topic.ts (9)

| ids                 | class                | reason / test                                                                                                                                                                                                                                                                                                                       |
| ------------------- | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 6832                | weak-test            | test/irc/handlers/membership.ts "a TOPIC change is shown, kept, announced and told to scripts" sends the sourceless `TOPIC #seance :by server` but asserts only `[type, text]` and the **first** `dispatchTopic` call. The sender of a server-set topic (nick `""`) is never checked: not in `from`, not in the second script event |
| 6835 6836 6911 6912 | equivalent (wrapper) | TOPIC/333 for a channel not listed: the throw at `chan.userRef` / `chan.topicQuiet` comes before any state changes. Note: the 331/332 unknown-channel paths are tested, the TOPIC and 333 ones are not                                                                                                                              |
| 6829 6848 6907 6908 | untested (malformed) | defaults for a missing topic/setter/time param                                                                                                                                                                                                                                                                                      |

## client/js/irc/handlers/part.ts (6)

| ids       | class                | reason / test                                                                                                                 |
| --------- | -------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| 5693      | equivalent (wrapper) | a sourceless PART throws at L13 before anything happens. "tells scripts live, never for a PART from nobody" passes either way |
| 5715      | equivalent           | `autoJoin = false` is a dead write: `removeChannel` drops the channel from `channels` and from the catch-up right after it    |
| 5721 5724 | equivalent           | the source is defined after the nick guard                                                                                    |
| 5722 5725 | untested             | the hostmask fallback for a nick-only prefix                                                                                  |

## client/js/push/strip.ts (5)

| ids            | class      | reason / test                                                                                                                                                                                                                          |
| -------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 9337 9342      | equivalent | the initial `afterBlock` only matters once `out !== ""`. A text node has no `wrap`, so `BLOCK_WRAPS.has(undefined)` is false                                                                                                           |
| 9350 9352 9353 | unsure     | the "skip an empty node" branch never runs (9353 is NoCoverage). An empty block wrap would add a stray `\n`, but I tried ` ``` ` empty, `# `, `>`, `****`, `$$ $$` and `- ` and none gives a different result. It may not be reachable |

## client/js/irc/handlers/cap.ts (4)

| ids                 | class    | reason / test                                                                                                                               |
| ------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| 4343 4344 4346 4347 | untested | the handler showing `result.error` ("Missing required capabilities: …") in the lobby. caps.ts tests check only the negotiator's `res.error` |

## client/js/helpers/pushStore.ts (4)

| ids  | class      | reason / test                                                                                                                                                                                                                                                                                                                              |
| ---- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1806 | weak-test  | test/helpers/pushStore.ts "drops an entry whose keys or endpoint are not what they should be" covers keys `null`, a string, and wrong field types, but not keys **absent**. Under the mutant, `{vapid, endpoint}` with no `keys` reaches `undefined.p256dh` and `parseStoredSubscriptions` throws, breaking its "never thrown on" contract |
| 1825 | equivalent | JSON values are never `undefined`, and `"x".endpoint` is undefined                                                                                                                                                                                                                                                                         |
| 1836 | equivalent | `parsed` left undefined fails the next typeof check                                                                                                                                                                                                                                                                                        |
| 1842 | equivalent | `Object.entries` of a primitive gives nothing usable that passes `isMaterial`                                                                                                                                                                                                                                                              |

## client/js/push/scope.ts (4)

| ids            | class      | reason / test                                                                                                                                                                                                           |
| -------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 9313 9314 9316 | equivalent | `m[1]` on null throws inside the `try` and returns `undefined`; an empty catch returns `undefined` too                                                                                                                  |
| 9319           | untested   | `appUrlFromScope` on a scope the replace regex matches but `networkFromScope` rejects: `…/xpush/a/` (no slash before `push`) or `…/push/%E0%A4%A/` (bad escape). These should be left alone, and the mutant strips them |

## client/js/helpers/messageUpdates.ts (2)

| ids       | class      | reason / test                                                                                                     |
| --------- | ---------- | ----------------------------------------------------------------------------------------------------------------- |
| 1607 1615 | equivalent | re-splicing a replacement that is already in place is a no-op. `at === originalAt` is impossible for distinct ids |

## client/js/irc/commands/redact.ts (2)

| ids       | class      | reason / test                                                                      |
| --------- | ---------- | ---------------------------------------------------------------------------------- |
| 4018 4020 | equivalent | an empty reason `""` is falsy in `client.redact`, so the same bare REDACT goes out |

## client/js/irc/commands/invite.ts (1)

| ids  | class    | reason / test                                                                                                                                     |
| ---- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| 3216 | untested | a bare `/invite` (no args) in a channel should give the usage error; the mutant sends `INVITE <undefined> #chan`. `/invite a b c` is untested too |

## client/js/irc/handlers/index.ts (1)

| ids  | class    | reason / test                                                                                                                                                                                   |
| ---- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 4403 | untested | the `bouncer-replay` batch handler: without it the batch is plain-unwrapped and loses `noteRestorationActivity` and `presenceResumed`. The attach-cursor tests use the batch but assert neither |

## Possible bugs

None. A minor point of low practical weight:

- topic.ts:13 vs mode.ts:89. A prefixless `TOPIC #seance :by server` gives `from = {nick: "", mode: ""}` (`Channel.userRef`), and scripts get `nick: ""`. A prefixless MODE uses `client.options.host` instead. No real ircd sends a prefixless TOPIC (only the test's line reaches this path), so this is not counted as a bug.

None of the test setup (`test/.mocharc.yml`, root hooks) stubs `console.error`, so the "equivalent (wrapper)" rows stand. That is 9 of the 86 equivalents: 5320 5321 4460 4484 6835 6836 6911 6912 5693. A test asserting "no console.error" would kill them, so read them as untested guards if the console counts as observable.

## Weak tests

1. test/irc/handlers/mode.ts, "a change no user's prefix depends on does not touch the list": `+o nobody` passes even when the handler throws. It should put a second change after the missing user (`+oo nobody bob`) and assert bob's prefix, or assert no `console.error`. (5272 5273 5277)
2. test/irc/handlers/join.ts, "our JOIN for a channel we are already in changes no state": doesn't assert `modesKnown` stays true, i.e. that no second MODE follows the next open. (4536)
3. test/irc/persistence.ts, "holds the autojoin through an unbatched burst and its bouncer note": the JOINs in the burst should extend the hold, but the test ticks a full quiet period before asserting, so it can't tell. It needs an assertion at the note's original deadline. (4540)
4. test/irc/handlers/membership.ts, "a TOPIC change is shown, kept, announced and told to scripts": sends a sourceless TOPIC but never asserts its sender or the second `dispatchTopic` call. (6832)
5. test/helpers/pushStore.ts, "drops an entry whose keys or endpoint are not what they should be": missing the "keys absent" case, so a `typeof === "object"` guard regression would make the parser throw. (1806)
