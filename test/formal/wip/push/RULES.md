# Push model: rules

Each rule has a source and a tag:
- **MUST / SHOULD**: from a spec.
- **platform**: what a browser enforces.
- **convention**: ours, chosen from the prior art (`PRIOR-ART.md` §2-3).

The model's names are in brackets.

## From the specs and the platforms

- **Read markers only rise.** "The last read timestamp of a target MUST only ever increase", and an older one is answered with the newer stored value ([read-marker](https://github.com/ircv3/ircv3-specifications/blob/master/extensions/read-marker.md), MUST). The model's `marker` only takes the maximum.
- **The server pushes "a server-defined subset of IRC messages", one message per push.** (soju.im/webpush draft, `doc/ext/webpush.md`.) So relaying `MARKREAD` over push is allowed, and *where* it goes is the server's choice. That choice is what `RelayTo`, `OutPer` and `StrictRelay` vary.
- **A push service may lose a push or deliver pushes out of order.** RFC 8030 has TTL expiry and no ordering guarantee. The model's `chan` is a set, and `Drop` loses a push when `Lossy`.
- **WebKit: every push must show a notification.** A push handed to the worker that shows none within about 30 s is silent. The third silent push removes every subscription of the origin ([PRIOR-ART §1 Apple/WebKit], platform). [`RuleNeverRevoked`]
- **WebKit: a tag filters, it does not replace,** and a close within 30 s of a show is refused (platform). The model shows a card under its conversation's tag as a replacement, which is what the worker's `tidy` does by hand. The refused close is the `Close` action of a stub, which comes later.
- **Chrome: when no window is visible, a push that leaves nothing on screen spends budget** (platform, not modelled as a counter). Seance's lax worker shows a brief stub only then (`keepChromeCount`), and the model does the same.

## Conventions (the candidate rules)

- **No self-relay (R1).** No relay is ever headed for the subscription of the device that read. [`RuleNoSelfRelay`, server]
- **No "Marked as read" for your own read.** This is the user-visible form of R1, and the report that started this model. [`RuleNoOwnReadStub`, the whole system]
- **Relay only where a message push went (R2).** A relay to a subscription needs a message push for that conversation to have gone there since the last relay there. [`RuleRelayWherePushed`, server]
- **No relays to WebKit (R3).** This is a server choice (`StrictRelay = "skip"`), not a rule. What it costs is `W_StaleCard`.
- **Open sweeps (R5).** Once the app opens, no card whose messages are all read is left. [`RuleOpenClean`, client]
- **Close only what is read (R10).** A relay or the opening sweep closes a message card only when every message in it is covered by the marker the device knows, or a card that holds them replaces it. [`RuleCloseOnlyRead`, client]
- **No alert for a read message.** A message push the device already knows is read shows no fresh card, only the quiet stub WebKit needs. [`RuleNoAlertForRead`, client]

Not in v0: R4 (read state carried on the next message push), R6's Chrome budget as a count, R7 (`Topic`, `Urgency`, `TTL` headers), R8 (delay and re-check), R9 (declarative push). `DECISIONS.md` Q1-Q3 has these.
