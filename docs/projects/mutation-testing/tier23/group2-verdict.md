# Group 2 verdicts

166 mutants: **equivalent 85**, **untested 68**, **weak-test 10**, **known 3**, **possible-bug 0 from a mutant** (one bug found while reading the code; see "Possible bugs").

A note that applies to several handler rows: `IrcClient` runs every handler inside a try/catch (`client/js/irc/client.ts:2517-2520`, which logs with `console.error`). A mutant that turns an early `return` into a TypeError on `undefined` therefore has the same visible result as the original. Only the console differs. Those mutants are marked equivalent.

## client/js/irc/noticelog.ts

| ids                                                                                                                                         | class      | reason                                                                                                                                                                                                                                                              |
| ------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 7375 7376 7377 7378 7379 7380 7381 7382 7383 7384 7385 7386 7387 7388 7389 7390 7391 7392 7393 7394 7395 7396 7397 7398 7399 7400 7401 7402 | untested   | The IndexedDB backend (`openDb`, `transact`, `indexedDbBackend` load/save/remove, DB and store names, the transaction modes) has no test. Mocha has no IndexedDB and every test swaps in a fake backend.                                                            |
| 7407 7409 7413 7415                                                                                                                         | untested   | Picking the default backend: these mutants choose `noBackend` in a browser that has IndexedDB, so nothing is ever persisted. No test has IndexedDB present.                                                                                                         |
| 7408 7410 7414 7416                                                                                                                         | equivalent | These pick `indexedDbBackend` when IndexedDB is absent. `indexedDB.open` then throws a ReferenceError inside the Promise executor, and every caller swallows the rejection (load's try/catch, `.catch` on save and remove). The outcome is the same as `noBackend`. |
| 7404                                                                                                                                        | equivalent | `noBackend.load` returning `undefined` instead of a Promise: its only caller `await`s it.                                                                                                                                                                           |
| 7425                                                                                                                                        | untested   | The 2000-entry cap in `trim()`. No test passes more than 1000 entries, and `true` only differs above that, where it would wrongly slice off old entries (`slice(len-2000)` with a negative start).                                                                  |
| 7427                                                                                                                                        | equivalent | `>=` at exactly MAX_ENTRIES: `slice(0)` returns the same array.                                                                                                                                                                                                     |
| 7435 7439                                                                                                                                   | equivalent | `stored` is always reassigned. If the catch block is emptied, `stored` keeps its initial `[]`.                                                                                                                                                                      |
| 7438                                                                                                                                        | equivalent | `?? ["Stryker was here"]`: `trim()` filters the string out because its `time` is undefined, which gives NaN.                                                                                                                                                        |
| 7440                                                                                                                                        | untested   | `load()` when the backend rejects. The mutant returns a junk array, and no test makes the backend's load reject.                                                                                                                                                    |
| 7451 7452 7453 7454 7455 7456                                                                                                               | equivalent | The in-memory trim in `append()` only bounds memory. `all()` and `save()` both re-`trim()`. Trimming earlier or later gives the same result, because ageing is monotone and the cap keeps the newest entries.                                                       |

## client/js/helpers/ircmessageparser/highlighter.ts

| ids                      | class      | reason                                                                                                                                                                                                                |
| ------------------------ | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 956                      | equivalent | All four extra ids (cpp, csharp, fsharp, objectivec) exist in Prism's static `components.json`.                                                                                                                       |
| 970 971                  | equivalent | `Prism.languages[undefined]` is undefined, so `highlight` returns undefined anyway.                                                                                                                                   |
| 980                      | equivalent | When `id` is undefined, `loadLanguage(undefined)` resolves false. The only extra effect is a cache entry under the key `undefined`.                                                                                   |
| 1007 1008 1010 1012 1013 | equivalent | flourite always adds `Unknown` with 1 point, so `!language` can never be true. When `Unknown` wins, `confidence()` is 1, and `normalizeLang("Unknown")` is undefined because no Prism tag "unknown" exists (checked). |
| 1056 1057 1058           | equivalent | Unreachable guard: `loadLanguage` only ever gets ids from `idByTag` or a table entry's `require`, and both exist in the table.                                                                                        |
| 1088                     | equivalent | When two scores tie, `>=` sets the same `runnerUp`.                                                                                                                                                                   |
| 1077 1078 1080           | **known**  | The shebang bug. flourite returns `statistics: {}` for a `#!` line, so `points` is 0 and the guess is dropped. The mutants return the shebang's language, which is the right answer. Fixed on another branch.         |
| 1002                     | untested   | The flourite chunk failing to load. With the mutant, `guessLanguage` throws (detect is undefined) instead of resolving to undefined.                                                                                  |
| 1063 1064                | untested   | A grammar's `require` dependency failing to load should make `loadLanguage` resolve false.                                                                                                                            |
| 1069 1070                | untested   | The grammar chunk import failing: it should resolve false.                                                                                                                                                            |
| 1152 1153                | untested   | `highlight()` on code ending in `\n` should drop the trailing empty line. No test passes a trailing newline.                                                                                                          |
| 1003 1005                | untested   | `{heuristic: true}` only matters for blocks over 500 lines (flourite samples them). The other defaults are the same as `{}`. No test uses a block that long.                                                          |

## client/js/irc/handlers/chghost.ts

| ids                      | class      | reason / test                                                                                                                                                                                                    |
| ------------------------ | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 4351 4356 4359           | equivalent | Removing `?.` makes a sourceless line throw, and the catch at client.ts:2518 swallows it. The original returns at `!nick`, so nothing differs.                                                                   |
| 4352                     | equivalent | Default nick for a sourceless line: no user has that nick, so nothing is pushed.                                                                                                                                 |
| 4363 4364                | equivalent | With `nick` empty, `isSelf` is false and `findUser("")` finds nobody, so nothing happens.                                                                                                                        |
| 4355 4375 4376 4377 4378 | weak-test  | `test/irc/handlers/small.ts` "CHGHOST is shown where the user is" (`b@old` → `b new.example`) asserts only `[type, new_host]`. It never checks `new_ident`, which should be `""` because the ident is unchanged. |
| 4358 4379 4382           | untested   | When the host is unchanged, `new_host` should be `""`. The only test changes the host.                                                                                                                           |
| 4365 4366 4367           | untested   | Our own CHGHOST should update `client.ident`/`client.host` and set the `self` flag. Nobody else's CHGHOST should do that.                                                                                        |
| 4353 4354 4357 4360      | untested   | Defaults for a CHGHOST with missing params, or a source without user or host.                                                                                                                                    |

## client/js/irc/querylog.ts

| ids            | class                              | reason / test                                                                                                                                                                                                                                                                      |
| -------------- | ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 7755           | equivalent                         | `keys?.() ?? ["Stryker was here"]`: the junk key does not start with the prefix.                                                                                                                                                                                                   |
| 7791 7806 7812 | equivalent                         | These write `msgid`/`replyTo`/`fromAccount: undefined`. JSON drops undefined keys, every reader tests truthiness, and the `===` comparisons are always against a string.                                                                                                           |
| 7915           | equivalent                         | `read: undefined`: `readUpTo` checks `=== undefined` and `setRead` uses `?? 0`.                                                                                                                                                                                                    |
| 7869           | equivalent                         | A primitive entry still fails the following `e.time`/`e.type` checks, and JSON cannot produce `undefined` in an array.                                                                                                                                                             |
| 7896 7887 7888 | equivalent                         | `JSON.parse("null")` throws on `.v` and the catch returns `[]`. An empty or null raw value gives `[]` through the catch or `data?.v`.                                                                                                                                              |
| 7986 7988      | equivalent                         | `splice(0, n)` with `n <= 0` removes nothing.                                                                                                                                                                                                                                      |
| 8025           | equivalent                         | `?? +1` is only used when `query` is undefined, and the `query &&` guard catches that.                                                                                                                                                                                             |
| 8152           | equivalent                         | `clearTimeout(null)` is harmless.                                                                                                                                                                                                                                                  |
| 8180 8181      | equivalent                         | The loop condition: once `queries` is empty the JSON is about 20 characters, far under MAX_CHARS.                                                                                                                                                                                  |
| 8178           | untested                           | The boundary at exactly MAX_CHARS. With `>=`, a log that fits exactly would still be trimmed.                                                                                                                                                                                      |
| 8195 8197 8198 | untested (practically unreachable) | Dropping a lone query whose lines are all cut. This needs a single line longer than MAX_CHARS (about 300k). The mutant would save an empty query, which would come back as an empty window.                                                                                        |
| 8192           | weak-test                          | `test/irc/querylog.ts` "cuts a lone conversation too big for the budget from its old end": `kept.length` is `within(100, 150)`. The original keeps 135 (it cuts a quarter at a time). The mutant cuts one at a time and keeps about 145. Both pass, so the cut size is not pinned. |

## client/js/irc/commands/oper.ts

| ids                 | class      | reason / test                                                                                                                                                                                                                             |
| ------------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 3753 3766 3780 3823 | equivalent | `input()` already filters out empty args before `runStats`/`runCheck`/`runPrivs`/`sendPlain`, and nothing else calls them (grep).                                                                                                         |
| 3852                | equivalent | `formatLine` upper-cases the command (message.ts:378).                                                                                                                                                                                    |
| 3760                | untested   | Equivalent under the nefarious profile, which maps `""` to `*` itself. Under the `generic` profile a bare `/stats` would be titled `STATS ` instead of `STATS *`, and no test covers that.                                                |
| 3776                | untested   | `/check` with a silent server or a closed socket should keep the report and add the error note. There is no such test; coverage only leaks in from service-worker.ts.                                                                     |
| 3772 3773 3774      | weak-test  | `test/irc/commands/oper.ts` "/check an unbatched answer runs until the closing 291" lands on the `rawReport` fallback but asserts only `report.raw`. It does not check `kind === "raw"` or the title `CHECK irc.test`.                    |
| 3797                | weak-test  | `test/irc/commands/oper.ts` "/privs an error reply is the card's error, with no privileges" asserts only `title` is not `"Privileges of bob"`, never that it is `"PRIVS"`. The ACK and silent-server tests do not check the title either. |

## client/js/irc/handlers/names.ts

| ids                 | class      | reason                                                                                                            |
| ------------------- | ---------- | ----------------------------------------------------------------------------------------------------------------- |
| 5385 5386 5425 5426 | equivalent | 353/366 for a channel we do not hold: the mutant throws, and the handler catch makes that the same as the return. |
| 5397 5399           | equivalent | An empty token ends in `nick.length === 0`, which continues.                                                      |
| 5403 5404           | equivalent | Reading past the end of the token: `symbols.includes(undefined)` is false.                                        |
| 5393                | untested   | A 353 without the names parameter. The mutant would add a user named `Stryker was here!`.                         |

## client/js/irc/handlers/tagmsg.ts

| ids       | class               | reason                                                                                                                                                             |
| --------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 6704 6705 | equivalent          | A sourceless TAGMSG throws, and the catch treats it as a return.                                                                                                   |
| 6730      | equivalent          | A missing target falls back to a junk default, and no channel by that name exists, so it returns.                                                                  |
| 6715 6719 | equivalent          | The early exit is redundant: with neither a reaction nor typing, the later code dispatches nothing and returns at `!reaction`.                                     |
| 6726      | equivalent (unsure) | Inside a replay, `params[0]` names the same channel as `replayTarget`. The server stores reactions for channels only.                                              |
| 6758 6759 | equivalent          | On a typing-only TAGMSG, `reaction.parent` throws inside `afterReplay`, after the typing dispatch, and the catch swallows it. The only symptom is a console error. |

## client/js/irc/handlers/redact.ts

| ids       | class               | reason                                                                                                                                                         |
| --------- | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 6300      | equivalent          | A missing target implies a missing msgid, so it returns before anything happens.                                                                               |
| 6311      | equivalent (unsure) | Only an unloaded target is affected: it throws, and the catch swallows it. The skipped `settleEdit` only matters for own edits, which need a loaded channel.   |
| 6299      | untested            | The text of the "deleted a message" line for a sourceless REDACT. "drops the message from the inbox…" sends `REDACT #seance m3` but asserts only `inbox:drop`. |
| 6338 6339 | untested            | A replayed own REDACT must not release a pending edit (`settleEdit`).                                                                                          |

## client/js/irc/commands/join.ts

| ids  | class      | reason                                                                                                                                              |
| ---- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| 3239 | untested   | `/join ` with a trailing space (args `[""]`) should rejoin the current channel. The mutant sends `JOIN` with an empty name. See also Possible bugs. |
| 3251 | untested   | A bare `/join` in a channel with no key: nothing reaches the `[]` branch, so a junk key would be sent.                                              |
| 3271 | equivalent | The names always start with a chantype, so `findChannel` can only return a channel.                                                                 |
| 3282 | untested   | `noteJoinsSent` for a `/join` sent while catch-up targets are `asked`.                                                                              |

## client/js/helpers/pushKeys.ts

| ids       | class      | reason                                                                                                            |
| --------- | ---------- | ----------------------------------------------------------------------------------------------------------------- |
| 1739 1742 | equivalent | `atob` decodes forgiving-base64, so missing padding decodes the same.                                             |
| 1747 1777 | equivalent | One step past the end: a write beyond the end of a Uint8Array is ignored, and `undefined !== undefined` is false. |

## client/js/push/merge.ts

| ids       | class      | reason                                                                                                 |
| --------- | ---------- | ------------------------------------------------------------------------------------------------------ |
| 9196      | equivalent | `undefined > sent` is false.                                                                           |
| 9218      | equivalent | The initial text is overwritten by `joinLines` because `sent >= 1` (line.ts:159 enforces it).          |
| 9284 9285 | equivalent | `midEllipsis` caps a line at 67 characters, so two lines (at most 135) never exceed BODY_BUDGET (170). |

## client/js/helpers/lastChannel.ts

| ids  | class      | reason                                                           |
| ---- | ---------- | ---------------------------------------------------------------- |
| 1382 | equivalent | An emptied catch leaves `parsed` undefined, which returns null.  |
| 1389 | equivalent | Destructuring a primitive yields non-strings, which return null. |

## client/js/irc/commands/mode.ts

| ids  | class      | reason                                                                                                     |
| ---- | ---------- | ---------------------------------------------------------------------------------------------------------- |
| 3491 | equivalent | `parseInt` of the junk is NaN, which falls back to `params.length`.                                        |
| 3534 | equivalent | `markInfoAsked(nick)` is only ever consumed for channel names, so the only effect is a leftover set entry. |

## client/js/irc/commands/ignore.ts

| ids  | class    | reason                                                                                                         |
| ---- | -------- | -------------------------------------------------------------------------------------------------------------- |
| 2920 | untested | `.trim()` only matters for a tab or newline around the target (args are split on spaces), and no test has one. |

## client/js/irc/commands/react.ts

| ids  | class    | reason                                                                                      |
| ---- | -------- | ------------------------------------------------------------------------------------------- |
| 3951 | untested | `/react` in a query. Every `/react` test runs in `#seance`, and the mutant refuses queries. |

## Possible bugs

No surviving mutant showed one. One was found while judging 3239:

- **`/join` with a double space.** `client/js/irc/commands/join.ts:19`. The input `/join #foo` gives rest `" #foo"` and args `["", "#foo"]`. `args[0].length === 0` then makes it rejoin the _current_ channel (or print the usage error in the lobby), and `#foo` is never joined. `/check` deliberately drops empty words ("drops the empty words of a double space"), and so does `/react`. `/ignore bob` (`ignore.ts:16`) has the same shape: it reads `args[0]` and prints the usage error. Low severity.

## Weak tests

- `test/irc/handlers/small.ts`, "CHGHOST is shown where the user is": asserts only `new_host`. It never checks `new_ident` (should be `""` for the unchanged ident) or the `self` flag. Ids 4355 4375-4378.
- `test/irc/querylog.ts`, "cuts a lone conversation too big for the budget from its old end": `within(100, 150)` accepts both quarter cuts (135) and one-at-a-time cuts (about 145). Id 8192.
- `test/irc/commands/oper.ts`, "/check an unbatched answer runs until the closing 291": does not check the raw fallback's `kind` (`"raw"`) or title (`CHECK irc.test`). Ids 3772-3774.
- `test/irc/commands/oper.ts`, "/privs an error reply is the card's error, with no privileges": checks only that the title is not "Privileges of bob", never that it is `PRIVS`. Id 3797.
