# Group 1 verdict

166 mutants: **45 equivalent, 100 untested, 20 weak-test, 1 possible-bug.**

Behind many of these survivors is one thing: `IrcClient.handleMessage` (`client/js/irc/client.ts:2516`) wraps every handler in `try/catch` → `console.error`. Take out a `!nick` / `!data` / `!chan` guard and the handler throws a TypeError (`casefold(undefined)` reads `.length`, `undefined.type`, `pushMessage(undefined, …)`). The catch swallows it, and the user sees the same thing the guard gave them. A test that asserts only "nothing shown" can never kill these mutants. Below, they are **weak-test** where a test is named for the guard and **untested** where no test feeds the guard's input. Either way, the only way to kill them is to fail on `console.error` (see Weak tests).

## client/js/irc/handlers/whois.ts (77)

| ids                                                                                                                                                    | class            | reason / test                                                                                                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 7120, 7121 (record `!nick`), 7140, 7141 (finish `!nick`), 7175, 7176 (whoisUser `!data`), 7280, 7281 (whoisSpecial `!data`), 7334, 7335 (away `!nick`) | weak-test        | `test/irc/handlers/whois.ts` "lines that name no nick add nothing and show nothing" checks only `lobbyMsgs == []`. Without the guard, `casefold(undefined)` throws and handleMessage swallows it, so the test still passes.         |
| 7134, 7191, 7197, 7208, 7213, 7258, 7263 (`if (data)` → true), 7226, 7228 (`data && match` → true / `\|\|`), 7246 (`data \|\| ip`)                     | untested         | `data` is undefined only when the line has no nick. No test sends a nick-less 3xx for these numerics, and the throw is swallowed anyway, so killing them needs a console.error spy.                                                 |
| 7243, 7244                                                                                                                                             | untested         | A 338 whose user@host has an empty host (`~u@ 10.0.0.9`): the original ignores it, the mutant stores `actual_hostname = ""`.                                                                                                        |
| 7248                                                                                                                                                   | **possible-bug** | `>= 4` should be `>= 5`. See Possible bugs.                                                                                                                                                                                         |
| 7187, 7189, 7195, 7201, 7217                                                                                                                           | untested         | Fallbacks for truncated replies: 311 with no user/host (`?? ""`), 312 with no server, 317 with no idle (`"0"`; the mutant's `""` gives `idleTime` NaN), 330 with no account.                                                        |
| 7291–7330 (40 ids)                                                                                                                                     | untested         | The 672 websocket origin, 325 webirc, 339 marks (prefix strip, `,\s*` split, `filter(Boolean)`, appending across repeats), 343 kill-listed and 344 country (`country_code` only with 4 params) handlers: no test feeds any of them. |
| 7342                                                                                                                                                   | untested         | A 301 outside a WHOIS with an empty trailing shows "is away".                                                                                                                                                                       |
| 7126                                                                                                                                                   | equivalent       | `{nick}` → `{}`: a card is shown only once `ident` is set, and only 311/314 sets it, overwriting `nick` at the same time.                                                                                                           |
| 7219, 7220                                                                                                                                             | equivalent       | The greedy `.*` before `$` matches anyway. `.*@` vs `.@` differ only for a host containing `@`, which hosts can't.                                                                                                                  |
| 7245                                                                                                                                                   | equivalent       | `ip = params[len-2]` is a middle param, and the parser never yields an empty one.                                                                                                                                                   |
| 7286                                                                                                                                                   | equivalent       | Already gated by `/^has a bouncer session\b/`, so the first "has a " is the one at the start.                                                                                                                                       |
| 7131, 7233, 7236                                                                                                                                       | equivalent       | `?? ""` fallbacks that are either never read (guarded by `length >= 4`) or give no match either way.                                                                                                                                |

## client/js/irc/scripting/storage.ts (21)

| ids                                | class      | reason / test                                                                                                                                                                                                                                                                                                                      |
| ---------------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 8724                               | weak-test  | `test/irc/scripting-storage.ts` "lists Unsorted last, whatever order the scripts come in". The mutant makes the comparator return -1 for every non-Unsorted pair, which leaves named folders in reverse input order. All three inputs have `zeta` before `alpha`, so the reverse looks sorted. `of("alpha","zeta")` would kill it. |
| 8785, 8791, 8794                   | weak-test  | "checks every field" uses `5` for a bad id/name/code, and a number already fails the following `.length` / pattern check. An array (`["a"]`) has a length, coerces through `NAME_PATTERN.test`, and gets through under the mutant.                                                                                                 |
| 8878                               | weak-test  | "cuts a long last error to 500 characters" uses 600 and "short", never exactly 500. At 500 the mutant (`>=`) adds an "…".                                                                                                                                                                                                          |
| 8892–8896                          | untested   | `getScript(id)` (used by `scripting/manager.ts` onError and `ScriptEdit.vue`) has no test.                                                                                                                                                                                                                                         |
| 8745, 8746                         | equivalent | Case-equal folders are excluded at line 95, and `localeCompare`'s primary order ignores case, so `toUpperCase` gives the same order.                                                                                                                                                                                               |
| 8755, 8756                         | equivalent | `NAME_PATTERN` needs at least one character anyway.                                                                                                                                                                                                                                                                                |
| 8765                               | equivalent | A primitive destructures to `id === undefined` and is rejected. Only `undefined` itself would throw, and no caller passes it (input comes from JSON).                                                                                                                                                                              |
| 8806, 8807, 8815, 8923, 8924, 8934 | equivalent | `JSON.parse(null)` / `JSON.parse("")` / `Object.entries(null)` all end at the same `[]` / `{}` through the catch. The "not a list" message is swallowed.                                                                                                                                                                           |

## client/js/irc/commands/investigate.ts (17)

| ids                                           | class    | reason / test                                                                                                                                                                                                                                                                                                                  |
| --------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 3147, 3149, 3151, 3154–3164, 3166, 3167, 3171 | untested | The only test is `/investigate bob` (commands.ts "/quit, /ignorelist, /lua and /investigate work while disconnected"). Nothing covers: a bare `/investigate` taking the channel or query name, the usage error in the lobby, `kind: "channel"` for `#chan`, or skipping an empty arg from a double space (`/investigate bob`). |

## client/js/irc/handlers/persistence.ts (11)

| ids                         | class      | reason / test                                                                                                                                                                         |
| --------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 5830                        | untested   | Another subcommand during registration, with a cursor offered, must not set `serverReplay` (e.g. `PERSISTENCE REPLAY …` before 001).                                                  |
| 5835                        | untested   | `attachCursor` is cleared only on reconnect (`client.ts:1029`), so an ATTACH ack after registration (the user's own `/persistence attach`) must print rather than set `serverReplay`. |
| 5746–5749, 5752, 5792, 5857 | untested   | `""` defaults for a truncated SESSION / STATUS / SET line. They show up in the session list and in the lobby text.                                                                    |
| 5733                        | equivalent | Any `sub` default falls through to the same "Persistence: …" line.                                                                                                                    |
| 5762                        | equivalent | `filter(Boolean)` removes the empties a single-char split leaves.                                                                                                                     |

## client/js/irc/handlers/who.ts (10)

| ids              | class      | reason / test                                                                                                                     |
| ---------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------- |
| 7013, 7014       | untested   | A 352 that has a nick but no flags/trailing. The "cut short" test drops the nick too, so it returns before the defaults are read. |
| 7085             | untested   | A 315 with no mask and an untitled query should read "No one matched WHO \*".                                                     |
| 6980             | equivalent | Differs only for a `354` with no token param at all.                                                                              |
| 6989             | equivalent | Flag strings start with H/G, never a prefix character.                                                                            |
| 7021, 7023, 7041 | equivalent | Positional: if params[5] (nick) exists, params[2..4] do too.                                                                      |
| 7027, 7031       | equivalent | `parseInt` stops at the space.                                                                                                    |

## client/js/irc/handlers/batch.ts (6)

| ids        | class      | reason / test                                                                                                                                                                                          |
| ---------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 4325, 4326 | weak-test  | `test/irc/batch.ts` "ignores malformed markers and closes for unknown references": without the guard, `deliver(client, undefined)` throws on `.type`, the throw is swallowed, and the test can't tell. |
| 4270, 4271 | equivalent | `Map.get(undefined)` → no batch → returns false anyway.                                                                                                                                                |
| 4300, 4315 | equivalent | The marker default fails the `+`/`-` check either way. No batch handler is registered for a junk type name.                                                                                            |

## client/js/irc/operprefs.ts (6)

| ids                    | class      | reason / test                                                                |
| ---------------------- | ---------- | ---------------------------------------------------------------------------- |
| 7513, 7515, 7541, 7548 | equivalent | Without the `undefined` checks the code just deletes a key that isn't there. |
| 7528                   | equivalent | `JSON.parse("")` throws and the catch returns `{}`.                          |
| 7679                   | equivalent | `changed` is always overwritten by the synchronous `update` callback.        |

## client/js/helpers/platformDefaults.ts (4)

| ids       | class    | reason / test                                                                |
| --------- | -------- | ---------------------------------------------------------------------------- |
| 1719–1722 | untested | `currentPlatform()` (iOS / Android / web from the shell checks) has no test. |

## client/js/helpers/ircmessageparser/parseStyle.ts (4)

| ids        | class      | reason / test                                                                                                                                                                                                                        |
| ---------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1349       | untested   | `"file"` in STYLE_KEYS. Proven with `/tmp/triage-group1/md2.ts`: two back-to-back fences ` ```js:a.js ` / ` ```js:b.js ` give fragments `x`/a.js and `y`/b.js. With the key removed they merge into one `xy` fragment carrying a.js. |
| 1353, 1354 | equivalent | Every math/mathBlock fragment also carries a unique `mathId`, which keeps them apart. Same probe: no merge.                                                                                                                          |
| 1279       | equivalent | One extra pass with `text[length]` undefined matches no case, and the final slice is the same.                                                                                                                                       |

## client/js/irc/handlers/kick.ts (4)

| ids              | class     | reason / test                                                                                                                                                                         |
| ---------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 4579, 4580, 4583 | weak-test | `test/irc/handlers/join.ts` "a KICK naming nobody is ignored": without the guard, `isSelf(undefined)` / `pushMessage(undefined)` throws, the throw is swallowed, and the test passes. |
| 4577             | untested  | A KICK with no prefix (`kicker ""`). The "from the server" case has a source.                                                                                                         |

## client/js/helpers/ircmessageparser/findNames.ts (2)

| ids      | class      | reason / test                                                                                                                             |
| -------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| 913, 915 | equivalent | The early return is a shortcut only: with no nicks the loop matches nothing, and the regex's `lastIndex` resets when `exec` returns null. |

## client/js/irc/commands/connect.ts (2)

| ids  | class      | reason / test                                                                          |
| ---- | ---------- | -------------------------------------------------------------------------------------- |
| 2833 | equivalent | `dispatchInput` defaults `opts = {}`, so `opts?.auto` and `opts.auto` behave the same. |
| 2836 | equivalent | The junk port default fails `/^\d+$/` just as `""` does, giving the same default port. |

## client/js/irc/commands/ban.ts (1)

| ids  | class    | reason / test                                                                                                                                                                                                                                               |
| ---- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2750 | untested | `/ban bob` (two spaces) gives `args[0] === ""`, and the original then answers with the usage error. Note that this rejects a real nick: `/connect` and `/investigate` skip empty args, `/ban` doesn't. Neither the original nor the mutant handles it well. |

## client/js/irc/commands/part.ts (1)

| ids  | class    | reason / test                                                                                                                                                                                                                                                |
| ---- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 3889 | untested | Closing a query that has no line from the server should write no tombstone. Under the mutant, `close(name, undefined)` stores `at: NaN` and runs `writeClosed()`. "closes queries and parted channels locally" never checks the closed list or the metadata. |

## Possible bugs

- **whois.ts:233, 338 with 4 params.** The check is `msg.params.length >= 4`, but `userHost = params[len-3]` only lands after the nick when there are at least 5 params. Hybrid/ratbox-family servers send `338 <me> <nick> <ip> :actually using host` (I believe Charybdis/Solanum do too; not checked against their source).
  - Input: `:irc.test 338 alice bob 10.0.0.9 :actually using host`. Wrong outcome: the card gets `actual_hostname = "bob"` (the nick) and `actual_ip = 10.0.0.9`. Proven with `/tmp/triage-group1/whois338.ts`.
  - The mutant (`> 4`) ignores the line instead, which is no worse.
  - Fix: a 4-param branch that sets only `actual_ip = params[2]`.

## Weak tests

- **Harness-wide** (`test/irc/support.ts` `setup`): nothing fails on `console.error`, so any handler guard whose absence only throws is invisible. This one gap accounts for the whois, batch and kick weak-tests below, and for the untested `data`-guard mutants. Stubbing `console.error` in the harness and failing on it would kill the whole class.
- `test/irc/handlers/whois.ts` "lines that name no nick add nothing and show nothing": asserts only an empty lobby, so it can't see the swallowed throw (7120, 7121, 7140, 7141, 7175, 7176, 7280, 7281, 7334, 7335).
- `test/irc/batch.ts` "ignores malformed markers and closes for unknown references": same blind spot for the `!open` guard (4325, 4326).
- `test/irc/handlers/join.ts` "a KICK naming nobody is ignored": same blind spot (4579, 4580, 4583).
- `test/irc/scripting-storage.ts` "lists Unsorted last, whatever order the scripts come in": the named folders always come in reverse-sorted order, so a comparator that always says "a first" passes (8724).
- `test/irc/scripting-storage.ts` "checks every field": bad types are tested only with numbers, never arrays (8785, 8791, 8794).
- `test/irc/scripting-storage.ts` "cuts a long last error to 500 characters": never tests exactly 500 (8878).
