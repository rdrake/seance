# Interpretation decisions for the reconnect / STS model

Written before `model/StsReconnect.tla`. Each entry quotes the spec (`sts.md` at `9ff58d13`, cited `STS:n`; `capability-negotiation.md`, `CN:n`) or Seance's code at `4f5a4bd12` (`file:line`), says what the model does, and why. Rule IDs refer to `RULES.md`. Questions marked **Open** are for Richard; the model's choice stands until then.

The model is spec-first: its client obeys the STS rules, and Seance's own reconnect design (SC rules) where the spec says nothing. Where Seance's code departs from a spec rule, a `Seance*` switch reproduces the code; a config with the switch on must fail the named property (findings F1-F4 at the end).

## D1. One host, several networks, one shared policy store

> "it then MUST only use a secure transport to connect to the server at the requested hostname in future" (STS:53); "An STS policy is imposed for all connections to a hostname." (STS:191)

**Model:** one host `H`. `Nets` are Seance networks (or tabs: every tab reads the same `localStorage`, ST:132-160) that all dial `H`, each with its own saved scheme and port (`PlainNets` are saved as `ws://`). `pol` is the store entry for `H`: `[has, port, exp, dur]`.

**Why:** ST:48-50 keys the store by the lower-cased host name, so networks on one host share one entry; that sharing is where F1 lives. Several hosts would only repeat the single-host case.

## D2. Certificates and what makes a secure dial fail

> "Clients MUST use sufficient certificate verification" (STS:27)

**Model:** a dial opens or fails; the env decides through `netUp`, `secUp` (secure ports that accept) and the IPcheck chain (D11). Certificate refusals are one reason among others for "a secure dial fails"; the shell's untrusted-certificate prompt (CL:1894-1900) is out.

## D3. The cap value is abstracted to its parts

The server's advertisement is `srvUpg` (an upgrade port in `SecPorts`, or `"none"`) and `srvDur` (a duration in `Durs`, or `-1` for none). `preload` is not a separate variable: it only rides on a stored policy and is ignored over plain (STS:87), which `RulePolicyOnlyFromSecure` already covers. Parsing (unknown keys, repeated keys, bad numbers), multiline LS (CN:282-288) and `CAP REQ sts` (STS:57) are out: they are local to `parseStsValue` / `checkSts` / `caps.ts` and covered by `test/irc/sts.ts` and `test/irc/caps.ts`.

## D4. Time and its scale

Time is an integer `now` advanced by `Tick`. Seance counts in milliseconds; the model counts in abstract units. Limited configs use a scaled schedule that keeps every ordering Seance relies on (checked by `ASSUME`):
- `Unreached > Window` (TR:126-131: 42 s past IPcheck's 40 s window);
- `lo(Cap) > Window`, `lo(b) = ceil(3b/4)` (TR:532-543: 45 s floor at the 60 s cap);
- `Stable < Window` (30 s < 40 s: a stable connection's immediate retry can sit inside the window).

The trace check (D14) runs the real scale: one unit per second, `Init 1, Cap 60, Quick <<1,2,4>>, Unreached 42, UJit 5, Stable 30, Window 40`.

Jitter is two choices, the low and the high end of each range. Every property about spacing is a lower bound (the low end) or a bounded-response upper bound (the high end), so the ends are where they can fail.

**Urgency:** `Tick` is disabled while a due retry is pending or an opened socket has not read its `CAP LS` reply. The client acts on its timers in the unit they fall due, and the server answers a registration within a unit. Env events are not urgent.

## D5. Upgrade policy: close first, then dial securely

> "When a client sees an STS upgrade policy over an insecure connection, it MUST first establish a secure connection ... and confirm that the STS persistence policy is present." (STS:51)
> "it MUST close the insecure connection and reconnect securely on the stated port." (STS:67)

**Model:** reading an upgrade policy on a plain socket closes it and dials TLS on the advertised port. Nothing is stored from the plain connection. STS:51 read alone could mean "keep the plain socket until the secure one is confirmed", but STS:67 says close and reconnect, and the example (STS:227-230) disconnects first. Seance does the same (CL:1199-1205).

## D6. "Only secure connections" covers every dial, not only the first

> "it then MUST only use a secure transport to connect to the server at the requested hostname in future ... MUST refuse to connect if a secure connection cannot be established" (STS:53)

**Model:** `RuleNoPlainDialWithPolicy` is checked on every dial: the user's connect, the foreground poke, the upgrade, a reload's autoconnect and the transport's own timer-driven retries. A policy may become valid while a network sits on a plain socket or in a reconnect wait: another network or tab on the same host learns it (D1). The conforming client applies the policy at each dial.

**Seance:** only `IrcClient.connect()` applies it (CL:882, `applyStsPolicy`). The automatic retry is the transport's timer calling `dial()` on the URL it was built with (TR:517-529), and `redial()` / the probe's loss do the same (TR:333-353, 446-474). Switch `SeanceRetry` = TRUE dials the stored options on a timer retry. Finding F1.

## D7. After reading the upgrade policy, the plain socket carries nothing but QUIT

> "it MUST close the insecure connection and reconnect securely on the stated port." (STS:67)
> "Upon receiving either a `CAP LS` or `CAP REQ` command during connection registration, the server MUST not complete registration until the client sends a `CAP END`" (CN:69-72)

**Model:** this is a reading. STS does not literally forbid more lines before the close, but a client told to leave a connection that goes on to negotiate caps and end registration on it is using the insecure connection after it knew not to. `CAP END` is the sharp case: by CN:69-72 it is what lets the server register the client on the plain connection (`UpgradeBeforeRegistration`), with whatever goes in that flush (`AWAY`, CL:1586-1609). A QUIT is allowed: closing politely is part of closing.

**Seance:** `handleMessage` runs the CAP handler first and `checkSts` after it (CL:3111, 3117). On the final LS the handler has already sent `CAP REQ :…` and, with no SASL, the pipelined `CAP END` (caps.ts:346-386). Switch `SeanceStsAfterCaps`. Finding F2. Credentials are not affected: the SASL opener waits for the ACK (caps.ts:367-370), which never comes, and `PASS` went out before the LS reply, when nothing was known (D13).

## D8. Rescheduling on close applies to an expired expiry too, and to a page unload

> "When a client activates an STS persistence policy for a hostname on a long-lived connection, the expiry time might be reached by the time the connection closes. However, the server might still have an STS policy in place. To avoid an early STS policy expiry, clients MUST reschedule the expiry time when closing connections. The new expiry time is calculated by adding the policy duration as last advertised by the server to the time the connection is closed." (STS:111-113)

**Model:** closing an opened TLS connection whose server advertised a duration `d > 0` (and did not since remove it with 0) leaves `pol.exp = now + d`, whether or not the old expiry has passed. The text names exactly that case ("the expiry time might be reached by the time the connection closes"). Every way the connection ends counts: a drop, the user's disconnect, a throttle, and the page going away (`Reload`).

**Seance:** `refreshPolicy` reads the policy through `getPolicy`, which returns nothing once the expiry has passed (ST:176-179, 245-251), so an expired policy is left to lapse at the close: finding F3. The page's `pagehide` handler sends QUIT and does not reschedule at all (MG:353-363): finding F4. Switch `SeanceReschedule` reproduces both.

Seance also refreshes on the close of a TLS dial that never opened (CL:1804-1806). The spec does not ask for it; keeping the policy longer only delays when plain dials become allowed, which STS:81 lets the client do anyway ("MAY continue to connect securely"). The model allows it in both modes (free).

## D9. A session is a client's lifetime; a reload starts new ones

> "the client SHOULD continue using the secure connection for that session." (STS:55)

**Model:** a session is an `IrcClient`'s lifetime; `Reload` replaces every client with one built from the saved network. After an upgrade, every dial of the session is TLS (`SessionStaysSecure`), so a session upgrades at most once (`UpgradeOncePerSession`), whatever the secure port does. A reload of a plain saved network with no valid policy may go plain again and upgrade again: one upgrade per session is the bound on loops (no persistence was verified, so STS:53 does not apply).

**Seance:** the upgrade reconfigures the live client to TLS (CL:1204) and the transport retries that URL; only a connect-time policy upgrade is saved with the network (CL:1139, MG:183-190), the port-key upgrade is not. Both match the model.

## D10. What the user can do

The user connects (`Connect`: attempt 0, dial now, SC-1) and disconnects (`Disconnect`: QUIT, close, no retry, SC-8). Editing the endpoint (`applySettings`) is out: CL:1001-1045 sends any edit through `connect()`, which applies the policy, so an edit to `ws://` cannot bypass a valid one. The foreground poke (`Poke`) is `connect()` on a network in a short reconnect wait (MG:463-466).

## D11. The server's two throttles

- **Connection throttle (IPcheck).** Seance's notes describe it as: the n-th connection from an address is refused when each gap is within the window, and a refusal renews the window (IL:35, TR:16-19). nefarious2's `ip_registry_check_local` (`ircd/IPcheck.c:282-345`, branch `mesh` at `a59d1bf7`) does that: `attempts` restarts when the last connect is more than `IPCHECK_CLONE_PERIOD` (40) ago, the `IPCHECK_CLONE_LIMIT`-th (4) is refused, and with `FEAT_IPCHECK_COUNT_REFUSALS` (default on, `ircd_features.c:1046`) a refusal moves `last_connect` too; when the address's last connection closes, `last_connect` moves to the close (`IPcheck.c:470-485`). The model keeps that chain per host over the dials of every network that reach the server (a dial while the host is down never does): within `Window` of the last it extends, else restarts at 1; at `IpLimit` it is refused before it opens. `IpCountRefusals` is the feature; env kind `"ip"` turns the check on. The SASL refund (`IPcheck.c:580-618`) is out: it only lowers the count after a login. The `ERROR … throttled` from an open socket is env action `Throttled` (SC-5).
- **Fake lag** is per connection after 001 and does not affect dialing; it is in `ConnectPath.tla` with the restore wait and the "nothing before 001" rule (D15).

The connect timeout, offline waits and the probe are out: they keep the schedule or restart it in ways SC-1 and SC-3 already exercise (TR:446-474).

## D12. "Eventually reconnects" as bounded response

Time is bounded (`MaxTime`), so a temporal `<>` would be met by stuttering at the end. The model checks a bounded response instead: `ReconnectsWithin` says a network the user wants, on a host whose network and every secure port are up, with no env event for `Bound` units, has a socket open or registered. `Bound` is the longest wait the schedule can choose after a quiet start, plus room for an IPcheck refusal and its quick retries (the config generator derives it from the schedule constants). This is SC-11: Seance's own goal, not an IRCv3 rule.

## D13. What counts as a registration or credential line

`PASS`, `NICK`, `USER` and `CAP LS` go out when the socket opens (CL:1334-1344): before the LS reply, so before anything about STS can be known on that connection. The model folds them into the dial: a plain dial while a policy is valid is exactly the case where they leak (`RuleNoPlainDialWithPolicy`). `AUTHENTICATE` and services logins come after the ACK or after 001, never on a plain socket the client is about to leave (D7). The model's `act` record for an upgrade lists what went out after the policy was read (`sent`).

## D14. Trace check

`conformance/drive.ts` drives Seance's own `IrcClient` and `WsTransport` (a fake `WebSocket`, fake timers, `Math.random` pinned to the high end) through a few scenarios, records the abstract events (dials with scheme and port, what each socket sent, policy store snapshots, closes and their retry delays) and writes JSONL. `conformance/trace_check.py` turns each scenario into a TLA module that pins the env's choices and steps the model through the observed events, at the real time scale, under the conforming switches; a scenario that cannot be followed shows where Seance and the model part, and the same scenario is then checked with the matching `Seance*` switch.

## D15. ConnectPath: one connection after 001

`ConnectPath.tla` models a single connection from registration to close: the server's fake-lag clock (`2 + bytes/120` s per line after 001, nothing parsed past 10 s ahead), the background queue (sends only while the clock leaves `Budget`), the user's lines (sent at once), a timer-driven sender (a debounced MARKREAD) that may fall due before 001, and the restore wait (`STATUS ON`: wait for the batch, or `Wait`, extended by `Quiet` after each sign of restoration, never past `MaxWait` from registration; cancelled by the close). Costs are whole seconds: 2 for a short line, 3 or more for a long one (FL:107-110).

## D16. The "eventually reconnects" bound holds for one dialer per address, not two (finding F5)

The scaled `LockoutTwoIp` config fails `ReconnectsWithin`, and so does Seance's own code at the real scale (trace `lockout`): two networks on one address whose retries are in their long waits (42-47 s) interleave, so the gap between consecutive dials from the address alternates around 20 and 27 s; every gap stays inside the 40 s window, each refusal renews it, and neither gets back in. Seance's notes argue that waits above 40 s let the window lapse (IL:35, TR:16-19, 126-131); that holds per dialer, but IPcheck counts per address. With `IpCountRefusals` off (`TwoIpNoCount`) the bound holds. Random jitter makes the phases drift, so in practice the lockout ends when the two dials happen to fall within about 2-7 s of each other (one gap then exceeds 40 s); the model pins the jitter ends, so it shows that no bound exists rather than how long it lasts. `TwoIp` checks every other property; `ReconnectsWithin` on two dialers is left to `LockoutTwoIp`.

## Open questions

- **Q1 (D7).** Is "nothing after the upgrade policy but QUIT" the reading we want, or only "no `CAP END`"? The model checks both, as `RuleNothingAfterUpgrade` and `UpgradeBeforeRegistration`.
- **Q2 (D8).** Should Seance reschedule while connected (STS:147-151) so a killed tab does not lose the policy? `pagehide` does not fire when a phone kills a hidden page.
- **Q4 (D16).** Should Seance coordinate retries across networks and tabs on one host (one dialer per address in a long wait, or a wait that grows with the number of dialers), or is the drift of random jitter enough?
- **Q3 (D6).** Multiple tabs: a policy learned in one tab is in the shared store, but another tab's live client only reads it at its next `connect()`. The conforming model reads it at every dial.

## Findings against Seance (4f5a4bd12; unchanged on develop ef782edf1)

- **F1 (STS-7, D6).** The transport's automatic retry ignores a policy that became valid since the last `connect()`. Two networks on one host, one `ws://` and one `wss://`: once the secure one stores a policy, the plain one's next retry dials `ws://` and sends `CAP LS`, `NICK`, `USER` (and `PASS` if set) in clear.
- **F2 (STS-12, D7).** On an insecure connection, the final `CAP LS` with `sts=port=…` is answered with `CAP REQ :…` and, without SASL, `CAP END` before the QUIT, so the server may register the client on the plain connection.
- **F3 (STS-18, D8).** A policy whose expiry passed during a long connection is dropped at the close instead of rescheduled.
- **F4 (STS-18, D8).** A page unload sends QUIT but does not reschedule the expiry.
- **F5 (SC-11, D16).** Two networks (or tabs) on one address can keep nefarious2's IPcheck window open for each other indefinitely: the long wait after unreached dials spaces one dialer's retries past the window, not the address's.
