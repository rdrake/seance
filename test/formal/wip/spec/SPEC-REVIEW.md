# Specification review

The model is **not a sound exhaustive reference for the stated scope**. It is a useful bounded model of one registration strategy. It excludes legal peer behavior, admits some behavior contrary to the text, and relies on stronger progress assumptions than the specifications provide. Passing its current properties does not establish IRCv3 conformance.

I used only files in this directory as specification evidence. References below use these aliases, with the original file line numbers:

- **CN** = `specs-src/extensions/capability-negotiation.md`
- **S1** = `specs-src/extensions/sasl-3.1.md`
- **S2** = `specs-src/extensions/sasl-3.2.md`
- **M** = `model/SpecHandshake.tla`

Thus `CN:475–485` refers to those lines in `specs-src/extensions/capability-negotiation.md`, not to a different version online. “Over-restrictive” below means missing a permitted behavior. Such omissions are particularly dangerous when this model supplies the adversarial peer for checking an implementation.

## Findings, most severe first

### 1. High: SASL 3.2 reauthentication is excluded by the client, even with `Reauth = TRUE`

**Model:** `model/SpecHandshake.tla:279–285`, especially `~cli.welcomed` and `~cli.account`; `M:247–254`; scope exclusion of 901 at `M:18–19`. **Ledger/decisions:** `RULES.md:45,68`; `DECISIONS.md:17–29`. **Specification:** `specs-src/extensions/sasl-3.2.md:4–5,60–65,100–108`; `specs-src/extensions/sasl-3.1.md:89–90,199–205`.

S2 explicitly updates S1 and permits a new AUTHENTICATE “at any time,” for a client “authenticated or otherwise.” Its example describes SASL becoming available later through NEW, followed by authentication. S1 also explicitly says it does not specify AUTHENTICATE in registered state; that is precisely an area S2 extends.

The client can never initiate normal authentication after receiving 001, and can never initiate account-changing reauthentication after receiving 900. Changing `Reauth` affects only `SrvMech`; it does not remove either client guard. Nor is loss of an account representable, because there is no 901 handler or transition clearing `cli.account`/`srv.authed`.

A legal sequence missing from the model is:

```
CAP LS 302; negotiate; CAP END; 001
CAP NEW :sasl=PLAIN
CAP REQ :sasl; CAP ACK :sasl
AUTHENTICATE PLAIN; ...
```

D2 incorrectly preserves S1's restriction as an absolute client restriction while applying S2 only to the server. D3's switch does not actually select a complete reauthentication behavior. In addition, `Reauth = TRUE` always starts an exchange for an enabled, service-compatible opener, whereas S2 allows circumstance-dependent refusal with an appropriate error. A server that permits some reauthentications and refuses others is not captured by a single connection-wide Boolean policy.

**False acceptance risk:** a client that ignores NEW after registration, cannot reauthenticate, mishandles 901, or fails on a server's policy refusal is never exposed to the relevant ordinary sequence. This is not repaired by running a larger configuration.

### 2. High: multiline ACK relies on an unexplained “last line” oracle, and complete replies are sent atomically

**Model:** `model/SpecHandshake.tla:37–46,82–90,225–230`; also `M:152–159`. **Ledger/decisions:** `RULES.md:23,28`; `DECISIONS.md:62–64`. **Specification:** `specs-src/extensions/capability-negotiation.md:280–288,370–382`; `specs-src/extensions/sasl-3.1.md:56–57,77–79,199–213`.

There are two separate problems.

1. `Splits("ACK", R)` supplies the same `more` bit as LS, and the client commits solely on that bit. CN defines the `*` continuation parameter for **LS and LIST**. Its ACK grammar at CN:373–378 has no corresponding continuation parameter. CN:380–382 requires waiting for the last ACK, but does not grant a last-line marker on the wire. A client may need to determine completion from the outstanding request and acknowledged capabilities. This client never makes that determination: it trusts `m.more` and drops the oldest pending request. If `more` is intended as derived bookkeeping rather than a wire field, the derivation and its validity are missing. A refinement must not simply grant the implementation this knowledge.
2. `SrvLS` and `SrvReq` append **all** lines in one action. There is no state where the server has sent an initial ACK line but has not yet sent the final line. Client receipt of the first line is exercised, but partial server transmission is not. No client command, registration step, or capability change can be processed between those sends. CN:380–382 expressly distinguishes that interval and forbids the server from changing enabled capabilities during it. The model makes that requirement automatic by deleting the interval.

For example, a client may send END while a multiline ACK is incomplete, and a server may process it before transmitting the final ACK. There is no requirement to finish sending the ACK before processing END. The model cannot explore that ordering. It also enforces FIFO REQ replies by receiving and replying in a single action; D9 admits that the specification does not require that order. FIFO ordering **within the server's output stream** does not require replies to different requests to be generated in request order.

`SrvDecide` similarly makes 900 followed by 903 an indivisible send. S1 requires both on success but does not require adjacency or that particular ordering. Other messages and independent server actions between them are excluded. This is distinct from merely abstracting away irrelevant NOTICE messages: registration, DEL, account state, and terminal SASL handling are modeled observations.

**False acceptance risk:** clients tested only against pre-buffered replies, a supplied completion bit, FIFO answers, and adjacent success numerics may pass despite mishandling permitted fragmentation or interleaving. Servers are never checked in the partial-ACK interval. `MultiLine = TRUE` does not resolve either issue.

### 3. High: the cap-notify exception to ordinary REQ handling is entirely missing

**Model:** `model/SpecHandshake.tla:35,64–73,87–96,191–203,269–277`. **Ledger:** `RULES.md:37–38` covers only part of cap-notify. **Specification:** `specs-src/extensions/capability-negotiation.md:475–485`.

CN:481–485 is a missing normative sentence: a client MAY explicitly request cap-notify even when it is implicitly enabled, and a capable server **MUST accept and ACK it without side effects**. The server MAY omit it from LS/LIST. Consequently a correct CAP 302 client can request cap-notify even though it was not advertised.

The model has no cap-notify identifier and `CReq` can select only advertised identifiers. Its general server rule would reject an unoffered identifier, and `ArbitraryNak` permits NAK even for offered identifiers. Mapping abstract `"a"` to cap-notify does not fix this: `"a"` may be NAKed or removed by `EnvChange`, whereas implicit cap-notify MUST NOT be disabled (CN:478–479).

Treating cap-notify as a hidden always-on facility can be a legitimate restricted abstraction, but it does not encode the explicit-request obligation, optional advertisement, or non-disableability as properties that an implementation can be checked against. CN-23's “NEW/DEL always sent” is only one consequence of enabling cap-notify, not the full rule.

**False acceptance risk:** a server can reject an explicit cap-notify request, require it to have appeared in LS, or allow it to be disabled, without this reference ever testing the offending operation.

### 4. High: legal client inputs are excluded, including within an ordinary CAP 302 registration

**Model:** `model/SpecHandshake.tla:13–19,58–73,269–285,301–307`. **Ledger:** `RULES.md:15,19,26,34`. **Specification:** `specs-src/extensions/capability-negotiation.md:62–67,180,199–200,334–356,403–405`.

The following restrictions are model policy, not requirements of the cited text:

- The initial messages are permanently fixed to LS 302, NICK, USER. CN recommends either LS or blind REQ; it does not require this one choice. Even NICK-before-USER is not specified by CN:67.
- Every subsequent REQ requires the **final LS reply** and a nonempty subset of the client's current `avail`. The spec does not prohibit REQ before LS completes, a blind request after sending LS, or a request for a capability not in the current LS result. Explicit cap-notify is an unambiguous example; a stale positive REQ after a DEL also has no MUST NOT prohibition in the text. CN:452–453 recommends against sending a cancellation REQ for a deleted cap, not against every positive request concerning it.
- No client action sends another LS, LIST, or a negative capability request. CN:180 says CAP must be accepted at any time; CN:199–200 gives a registration-hold rule for LS; CN:336–347 explicitly permits disables and requires successful handling of an already-disabled capability. Those behaviors are relevant before 001, not merely to an unrelated post-registration extension.
- CN-12 turns a recommendation about **message size** into a finite **number of requests**. CN:351–353 provides no upper bound on how many REQs a connection may send. Neither the message-size recommendation nor its possible exceptions are represented by `MaxReq`.

The declared exclusions are honest scope notes, but they defeat the claim that the roles each do anything the spec permits. In particular, `SrvLS` existing as an action does not test acceptance of repeated LS: no such message is reachable after initialization. A server which mishandles a second pre-registration LS, a valid disable, or blind REQ can pass a check using this client.

### 5. High: finite budgets alter protocol decisions and eliminate the availability-recovery scenarios being claimed

**Model:** `model/SpecHandshake.tla:25–33,191–217,269–285,315`; `model/Small.cfg:3–10`; `model/MC.cfg:3–10`. **Decision:** `DECISIONS.md:31–37`. **Specification:** `specs-src/extensions/capability-negotiation.md:351–353,491–492`; `specs-src/extensions/sasl-3.1.md:45–48,77–79`; `specs-src/extensions/sasl-3.2.md:33–34,53–65,100–108`.

The bounds are not just exploration limits. `cli.reqs = MaxReq` changes `SaslUnobtainable`, which changes whether END is allowed and whether disconnection is obligatory. A client that spent its budget requesting `a`, with SASL still advertised and no SASL request ever attempted, is declared unable to obtain SASL. Increasing the bound can change the *meaning* of this condition. The specification supplies no such request budget.

D4 calls the budget a client's decision to stop trying. That may describe one client policy, but it is not equivalent to the normative condition “is unable to obtain” the capability. It cannot serve as an interpretation-independent encoding of S2-3.

Both supplied configurations have `MaxEnv = 1`: they cannot exercise SASL present → DEL → NEW, or repeated loss and restoration. `Small.cfg` also allows only one SASL opener; neither config permits normal post-001 reauthentication because of finding 1. An arbitrary amount of valid retrying and changing availability is excluded. `env.svcOk` is fixed for the whole behavior, so an immediate association failure cannot later turn into a successful association, even though retries and availability changes are precisely part of the source text.

These are reasonable finite experiments if explicitly scoped as such. Neither supplied configuration is an exhaustive conformance reference, and there is no cutoff argument showing that every larger or repeated interaction reduces to one of these bounded executions.

### 6. High: `Terminates` is a consequence of additional progress assumptions, not a property of every spec-permitted pair

**Model:** `model/SpecHandshake.tla:288–330,368–375`. **Ledger/decision:** `RULES.md:36,47,65`; `DECISIONS.md:72–74`. **Specification:** `specs-src/extensions/capability-negotiation.md:69–75,199–200,403–405,459–460`; `specs-src/extensions/sasl-3.1.md:37–40`; `specs-src/extensions/sasl-3.2.md:33–34`.

Transport/service scheduling assumptions should be distinguished from protocol obligations:

- `WF(SRecv)` and `WF(CRecv)` assume eventual processing of continuously available input.
- `WF(SrvDecide)` assumes an eventual service decision whenever its action remains enabled.
- `WF(SrvRegister)` assumes registration eventually succeeds once the modeled holds clear. The three source files do not promise this in the presence of all other registration requirements. The scope comment that other holds “only delay” registration is incompatible with assuming they eventually clear without stating that environmental assumption.
- `WF(CAbort)` and `WF(CGiveUp)` force the client to abandon a continuously stuck exchange. S1:39–40 recommends being *prepared* for timeouts; it does not require the client to choose these actions eventually, and certainly not all clients at all times as a MUST.
- `WF(CEnd)` forces a client with a continuously enabled END action to send END. CN says what END means and when registration is held, but provides no general MUST eventually send END.

With finite request/attempt/environment budgets, these assumptions force negotiation to stop accumulating work and drive it toward END or disconnection. That is useful as a conditional design property, but excludes spec-permitted waiting behaviors from `Spec` itself. Constants do not expose these fairness choices.

I confirmed the dependency with a scratch observational extension: removing **only `WF(CEnd)`**, keeping all other fairness conjuncts, and setting the three budgets to zero yields a `Terminates` counterexample. A non-required client receives the empty LS, the server processes NICK and USER, and the connection stutters forever under the CAP hold. All the retained fairness assumptions hold. The source provides no general rule ruling out this waiting behavior.

`Terminates` also requires only *one occurrence* of welcome or a disconnect flag. After 001, arbitrary later SASL or capability trouble is irrelevant to it. It is therefore not an adequate encoding of CN-22's requirement to handle capability removal gracefully, especially removal after registration.

### 7. High: arbitrary NAK contradicts successful handling of an already enabled capability

**Model:** `model/SpecHandshake.tla:87–96`; defaults in `model/Small.cfg:7` and `model/MC.cfg:7`. **Ledger/decision:** `RULES.md:24`; `DECISIONS.md:55–60`. **Specification:** `specs-src/extensions/capability-negotiation.md:345–349,370–388`.

CN requires an already enabled capability to be processed as though handling it was successful. The model permits:

```
REQ :sasl  -> ACK :sasl
REQ :sasl  -> NAK :sasl
```

with no availability change and SASL still enabled. There is no other member of that second request whose handling could fail. The “free” encoding of CN-10 implements the possibility of success, not the required successful handling. D8's argument that the specification does not enumerate all NAK causes cannot override CN:345–347, or the more explicit cap-notify ACK requirement in finding 3.

TLC found this trace with `MaxReq = 2, MaxSasl = 1, MaxEnv = 1`, all other switches as in Small.cfg. The second request was NAKed while its entire set was already enabled. None of the supplied properties rejects it: `RuleNakNoChange` is satisfied because the server leaves the capability enabled.

**False acceptance risk:** a server which rejects redundant enables for being redundant can be accepted by the reference's own server behavior.

### 8. Medium: NEW/DEL can be emitted before capability negotiation is processed, including DEL for a capability never advertised

**Model:** `model/SpecHandshake.tla:58–69,82–85,191–203`. **Ledger:** `RULES.md:31,35,37–38`. **Specification:** `specs-src/extensions/capability-negotiation.md:222–231,413–414,447–457,475–479`.

`EnvChange` requires only an open server and remaining environment budget. It is enabled in Init, while CAP LS 302 is still at the head of the client-to-server queue. There is no server-side version or cap-notify-enabled state.

TLC confirmed that the first transition may send NEW before `SrvLS` runs. The DEL branch is equally enabled when its selected capability starts in `srv.offered`: it can send DEL before sending **any advertisement** of that capability. CN:450–451 describes DEL as removing capabilities which have been advertised. Merely putting a capability in the private `offered` set is not an advertisement.

Under the documented interpretation of the queues as sent but not yet processed lines, the version gate is missing too: the server emits NEW/DEL before it has received/negotiated the client's CAP version. CN:413–414 and CN:447–448 require the recipient to have negotiated 302 or enabled cap-notify. Treating 302 as pre-negotiated in Init would be an additional modeling assumption, rather than an encoding of receiving LS during registration. The initial client has already *sent* LS, so the early-notification issue should be distinguished from a trace where a client never indicates 302 support at all; the latter is outside this model.

The ledger's assertion that these rules are guarded because “client is 302” overlooks the negotiation boundary and the advertised-capability precondition for DEL.

### 9. Medium: the required-client disconnection obligation can disappear without a disconnect

**Model:** `model/SpecHandshake.tla:213–217,234–236,301–315,327–330`. **Ledger/decision:** `RULES.md:65`; `DECISIONS.md:31–36`. **Specification:** `specs-src/extensions/sasl-3.2.md:33–34`.

Even accepting D4's definition of “unable to obtain,” its consequent is not implemented as an obligation once triggered. `CQuitOblig` is weakly fair only while the current predicate remains true; nothing remembers that the MUST-disconnect condition occurred.

A reachable trace is:

1. A required client receives an empty final LS. `SaslUnobtainable` is true.
2. Before it quits, the client receives NEW sasl.
3. `SaslUnobtainable` becomes false. The client can REQ SASL and continue this same connection, without ever disconnecting.

TLC confirmed the prefix with the Small switches and one request, attempt, and environment change. It has a fair continuation without quitting: obtain SASL, complete or abandon authentication, send END, and register. Weak fairness does not force a temporarily enabled action.

There is an interpretive question about when a dynamically unavailable capability should be classified as “unable to obtain.” However, the model has already answered that question by classifying an absent final LS as inability. Under **that** choice, it must preserve the resulting disconnection obligation. Alternatively, D4 needs a different definition; a changing present-state predicate plus weak fairness does not encode the stated MUST.

`RuleClientRequiredNoEnd` checks only that END is not sent while the current predicate holds. It does not check that any disconnect occurs after the trigger.

### 10. Medium: D7's “the spec is silent” misses the error requirement for unavailable reauthentication, and `Rule907` does not check 907

**Model:** `model/SpecHandshake.tla:104–116,359`; `M:279–299` for the retry race. **Ledger/decision:** `RULES.md:56,68`; `DECISIONS.md:24–29,50–53`. **Specification:** `specs-src/extensions/sasl-3.1.md:81–82,227–229`; `specs-src/extensions/sasl-3.2.md:62–65`.

`SrvMech` tests whether SASL is enabled **before** testing `srv.authed`. If the capability was removed while a conforming client still believed it enabled, the server may silently drop an opener, including an opener after a successful authentication. The text is not simply silent about every such case: S1 requires 907 for the already-successful case, and S2 requires an appropriate error when reauthentication is unavailable. D7 needs to address those clauses, rather than assert unrestricted silence.

This is reachable despite the restrictive client: the server succeeds, its 900/903 remain unread, it removes SASL, and the client times out, gives up, and opens another attempt before reading those lines or DEL. I checked this with two attempts and one environment change: TLC reaches `srv.authed = TRUE` and then consumes AUTHMECH without appending any response. The client still has SASL in its acknowledged set when it sends that opener.

At minimum this contradicts the model's claim to implement S1's mandatory 907 fallback when `Reauth = FALSE`. If cancellation after DEL is intended to take precedence over the reauthentication error rule, that conflict needs an explicit spec argument; D7 supplies none.

`Rule907` merely prohibits AUTH+ when `~Reauth /\ srv.authed`. A server that returns 904, returns no numeric, or disconnects instead of returning 907 satisfies this property. It never requires a 907 response or even looks for one.

### 11. Medium: the default END recommendation omits “needs to be aborted”

**Model:** `model/SpecHandshake.tla:208,288–307`. **Ledger:** `RULES.md:46`. **Specification:** `specs-src/extensions/sasl-3.1.md:36–40,84–87`.

The recommendation permits END when the exchange “is completed **or needs to be aborted**.” With `RecommendEnd = TRUE`, the guard permits END only in `idle` or `ok`. It excludes an active exchange the client wants to abort, including `cli.sasl = "abort"` while awaiting 906.

A client may choose CAP END to let registration abort the ongoing exchange; S1:84–87 expressly describes the server aborting it with 906 when registration completes. The model instead requires an AUTHENTICATE-star round trip, receipt of some other terminating event, or the separate `CGiveUp` transition before END can be sent under this switch. None is required by the quoted recommendation.

Setting `RecommendEnd = FALSE` admits this behavior, but incorrectly classifies a recommended case as one requiring deviation from the recommendation. Both supplied configurations use TRUE. The guard therefore mis-encodes S1-3 and removes a relevant registration/abort ordering from the default client.

### 12. Medium: several “out” rules require separate conformance checks; the abstraction does not verify them

**Model:** `model/SpecHandshake.tla:13–21,35–46,118–121,219–256`. **Ledger:** `RULES.md:18,22,34,51–52,54,66,70`. **Decision:** `DECISIONS.md:46–48`. **Specification:** the references in the table below.

Omitting serialization and mechanism detail can be appropriate for a registration control model. It is not proof that these omissions preserve all registration failures. In particular, reducing already-parsed input to sets, one mechanism, and one data line removes inputs which a conforming peer may send and which the other role MUST handle.

| Obligation or permitted input | Source | What the abstraction loses |
| --- | --- | --- |
| Process capability lists left to right; repeated values use the last occurrence; ignore trailing whitespace | CN:157–160 | Set union has no order, duplicates, values, or whitespace. A parser which ignores a cap or picks an old SASL mechanism list can stall registration without being tested. |
| REQ disables and redundant disables; ACK indicates requested disables | CN:336–347,377–382 | No negative requests or disabled ACK entries. Removing SASL or another cap during registration is untestable. |
| Values only on LS/NEW; NEW can update an existing value; values recommended on NEW | CN:270–271,420,426–428 | `EnvChange` only toggles presence. No value-only NEW, including changed mechanism lists while SASL stays offered. The last two sentences are absent from RULES.md. |
| Explicit cap-notify request MUST be ACKed without side effects | CN:481–485 | Missing from RULES.md and from the state/actions; see finding 3. |
| SASL value must be a comma-separated mechanism list; clients must tolerate absent values and unknown mechanisms | S2:38–49 | S2-4 omits the comma-separated MUST at S2:41–42 and the explicit unknown-mechanism requirement at S2:48–49 from its description/references. No values are exercised at all. |
| Selected mechanism becomes unavailable; initial association failure may be followed by trying another mechanism | S2:73–78; S1:45–51 | S2-8 labels this out. A single mechanism and fixed `svcOk` remove important retry/selection paths. There is a generic 904 path, but it does not test selecting or changing mechanisms. |
| Base64 response framing, 400-byte boundaries, exact-multiple terminating `+`; permitted interspersed messages | S1:55–67 | PLAIN-shaped exchanges can also require chunking. Making every AUTHDATA an already-complete response cannot expose premature service decisions or waits for a missing terminator. |
| Empty client response to a final nonempty server challenge | S1:69–70 | Declared outside the one client-first mechanism. This is a real necessary step for other legal mechanisms; failure to perform it can hang registration. |
| Specific failure numerics, optional 908, and account-unset 901 | S1:203–233 | Folding 902/904/905 may preserve an abstract “failure” observation, but does not prove a client recognizes all those wire inputs or a server sends the appropriate one. 901 also matters for the reauthentication scope. |

Other normative text omitted from the ledger includes server reply identifiers (CN:167–168), numeric CAP version comparison and remembered versions (CN:233–243), empty LIST replies (CN:321–322), and opaque/case-sensitive capability identifiers (CN:497–499). Wire-format and naming obligations need not become handshake state variables, but must be identified as separate obligations before claiming conformance. Repeated LS with version retention and LIST are relevant even during registration.

Some exclusions really are outside the explicitly chosen PLAIN/control-state subset. The defect is the stronger claim that this subset represents every permitted peer, and the lack of a proof that the excluded detail is irrelevant to the properties being used to accept code.

### 13. Medium: the rule properties are substantially weaker than their names and ledger entries

**Model:** `model/SpecHandshake.tla:337–375`. **Ledger:** `RULES.md:17,25,29,36,44–45,56,63–65,69`. **Specification:** references in the table.

These checks are not all vacuous: several have reachable antecedents and check useful local consequences. But most consequences are already guaranteed by the same action guards, and they are not independent encodings of the complete normative rule. Their current success must not be promoted to evidence about an arbitrary implementation model.

| Property | What it actually fails to establish | Relevant source |
| --- | --- | --- |
| `RuleNoWelcomeInHold` | Does not verify that receipt of LS/REQ sets/retains the hold, or that END was required. A code mapping that defines `hold` using its own buggy flag can make this implication pass. | CN:69–71,199–200,355–356 |
| `RuleAckWhole` | Accepts either union-of-ACK-caps or union-of-NAK-caps equaling the request. Does not require exactly one outcome, exclude mixed ACK/NAK, check enabled-set changes, or check multiline commit timing. Conversely, it requires the response in the same action as consuming REQ, rejecting a legitimate deferred response under a direct event mapping. | CN:349,370–388 |
| `RuleNakNoChange` | Checks only the action that appends NAK. Does not associate later capability mutations with the rejected request. The current server guard supplies the stronger behavior. | CN:387–388 |
| `RuleSaslAdvertOnlyIfUp` | Checks advertisements against `authUp`, but `authUp` is constrained by construction to equal presence in `offered`. It establishes no relationship to a separately modeled real authentication layer. It also does not test service outages invisible to that flag. | S2:27–28 |
| `RuleSaslAckOnlyIfUp` | Prevents a SASL ACK while down; does not require NAK for such a request. Silence would satisfy this property. | S2:30–31 |
| `Rule907` | Prohibits AUTH+, but does not require 907 or any response. | S1:81–82; S2:62–65 |
| `RuleClientAuthOnlyEnabled` | Applies only to AUTHMECH, not AUTHDATA or AUTHSTAR. Its registration test is the client's receipt of 001, not a general encoding of every AUTHENTICATE-use rule. S2's extension also means the unconditional post-001 restriction is itself unsuitable as a combined S1/S2 rule. | S1:31–40; S2:62–65 |
| `RuleClientRequiredNoEnd` | Does not assert eventual disconnection, and only tests the current, budget-dependent inability predicate. | S2:33–34 |
| `RuleFailCloseReason` | Checks a Boolean `srv.failed`, not that a failure explanation was sent before disconnection. The current actions happen to emit 904 before setting it, so this is not an assertion that the present model closes without a prior numeric. A code's internal “authentication failed” flag is insufficient as the refinement mapping. | S2:67–69 |
| `CapsAgree`, `AccountAgrees` | Check equality only when both queues are empty, both parties remain live, and welcome was seen. All pre-registration states, all closed/quit connections, and every busy state are excluded. They do not require reaching Quiet or recovering from removal. They are not wholly vacuous, but can be irrelevant to a failing registration. | CN:451–460; S1:77–87,199–205 |
| `Terminates` | Assumes forced progress and accepts a single welcome/disconnect occurrence, as explained in finding 6. It says nothing about later removal or SASL completion. | CN:459–460; S1:39–40 |

`TypeOK` (`M:342–348`) is also only a partial type invariant: it does not type the message sequences and most record fields. Its `authUp = ("sasl" \in srv.offered)` conjunct is a modeling identity, not an independently checked link between real availability and advertisement.

`NewS2C`/`NewC2S` (`M:337–338`) also infer sends solely from queue-length growth. That is correct for this model's separate append/consume actions, but can miss a send if a code-model step both consumes and appends on the same mapped queue. A code check needs send events or a mapping that preserves this action discipline.

A full refinement preserving wire observations can enforce more than this property list, because the actions constrain outputs and state changes. A check which merely runs these properties on a code model is much weaker. Those two kinds of checking must not be conflated.

### 14. Medium/low: the witnesses show reachability, but several do not show the motivating scenario

**Model:** `model/SpecHandshake.tla:74–75,91–96,263–264,377–384`. **Decisions:** `DECISIONS.md:35–37,76–85`. **Specification:** `specs-src/extensions/capability-negotiation.md:355–356,451–457`; `specs-src/extensions/sasl-3.1.md:77–82`; `specs-src/extensions/sasl-3.2.md:33–34,62–65`.

I checked all six witness invariants separately in scratch configurations. All fail, as intended. That is evidence about **this model**, not independent evidence that each trace satisfies the source. The `Witness*.cfg` files mentioned by the model comment are not present in the supplied `model/` directory.

| Witness | What its failure shows; limitation |
| --- | --- |
| `W_LoggedIn` | Welcome and a received 900 can coexist. It does not require receipt of 903, completion of SASL before 001, or even quiet registration. My counterexample registered first and reached the target while 903 was still queued. The narrow “success reachable” comment is reasonable; interpreting it as successful pre-authentication would be too strong. |
| `W_RequiredUnauth` | A required client can receive 001 with `account = FALSE`. It does **not** show D4's claimed authentication-failed-then-END scenario. TLC's short counterexample had SASL advertised, `reqs = 0`, `att = 0`, no SASL attempt or failure, and END followed by 001. There is no witness condition for 904, obtaining the cap, or exhausting authentication. |
| `W_NakSasl` | Some REQ containing SASL was NAKed. It does not distinguish mandatory NAK while unavailable from optional rejection while available, nor justify D8's entire NAK policy. |
| `W_StrayMech` | A client opener can land while the server has no SASL enabled. My trace had ACK sent, then DEL sent, then ACK received and AUTHMECH sent before DEL was read. This does demonstrate the intended in-flight race under D1. It does not justify every response in D7. |
| `W_LateReply` | A terminal numeric can be received outside a client exchange, exactly as its narrow comment says. It does not show an old numeric being attributed to a **new active exchange**, which is D12's motivating ambiguity. My trace used DEL followed by a stray-opener 904, with only one attempt and no abort/restart. It therefore cannot establish the exchange-correlation claim. |
| `W_ReHold` | REQ was processed after an END and before registration. My trace also set `srv.hold = TRUE`, as intended. This is good evidence for the narrow D13 path. It does not by itself demonstrate a hang, the necessity of the particular client repair, or correct subsequent END delivery. |

D4's narrower textual observation—that S2:33–34 specifically mandates disconnection for inability to obtain the **capability**, rather than explicitly spelling out a disconnection rule for every failed authentication—is defensible. I would not invent a new MUST-disconnect-after-904 rule. The witness simply does not prove the advertised failed-authentication example. Likewise D1's final-ACK interpretation and D13's renewed hold follow the quoted CAP text; I found no basis in these sources to reject them. D5's silent cancellation is not contradicted by a specified mandatory cancellation numeric, but choosing it does not establish that every permitted cancellation behavior is represented.

## What implementation checking would have to prove

A code model needs an explicit observable refinement mapping, plus a stated checking direction. At minimum it must relate:

- Ordered wire sends/receives and pending output to `c2s`/`s2c`, preserving observable commands, capability identifiers, ACK/NAK membership, terminal numerics, and disconnection reasons. Internal output enqueueing must not silently stand in for “last ACK sent” unless that equivalence is justified.
- Capability availability, negotiated CAP version, implicit cap-notify, server-enabled capabilities, the client's knowledge after final ACK, and DEL cancellation. The real authentication-layer state must be independent of whether code happens to advertise SASL; mapping `authUp` to `offered` would make an important correctness question disappear.
- Registration prerequisites, receipt of LS/REQ and END, the actual server registration event, and the client's observation of 001. A buggy implementation hold flag must not be accepted as the definition of the normative hold obligation.
- SASL mechanism/response completion, aborts, service outcomes, authenticated identity, account changes, and success/failure numerics. Mapping an internal failure Boolean to `failed` must additionally establish that the required explanation was already sent.
- Fixed client policy (`required`, desired SASL), credentials/service abstractions, bounds, and fairness. Preconditions such as reliable delivery or eventual resolution of other registration holds must be explicit assumptions on the environment, not inferred from a passing liveness check.

Parsing, chunking, values, unsupported mechanisms, identity-bearing numeric payloads, LIST, and negative REQ either need to be included in that relation or discharged by separate verified obligations. Projecting all these events to stuttering without proving their irrelevance can hide the registration defect being sought. Similarly, hiding Init's fixed command prefix can hide a wrong command order or missing registration command.

For a **client checked against the model server**, all permitted server behaviors must be covered by the environment: incomplete output, permitted response ordering, reauthentication refusal, capability/value changes, and all required numeric forms. For a **server checked against the model client**, valid client operations such as explicit cap-notify, repeated LS, disables, redundant enables, and post-registration authentication must be covered. The current peers under-approximate those environments, so the code can pass simply because its failing input is never generated.

For **trace refinement of the same role**, the direction differs: an over-restrictive reference tends to falsely reject valid implementations, while a too-permissive reference admits invalid ones. The arbitrary redundant NAK and the silent authenticated-opener branch are concrete examples of the latter risk. Composing two role models and finding some compatible execution is weaker still; conformance requires accounting for every allowed peer behavior under the declared assumptions, not existence of a cooperating schedule.

Consequently, the current artifact can support a bounded, explicitly qualified control-flow check. It cannot justify “implementation conforms to CAP 302 and SASL 3.1/3.2” without resolving the findings and supplying the missing abstraction/coverage obligations.

## Validation performed

Existing source/configuration files were not edited. TLC ran on scratch copies; MC.cfg was not run.

- Unmodified `Small.cfg`: **15,891,356 generated states; 6,947,704 distinct states; depth 31; no invariant or temporal-property errors; 75 seconds**, with eight workers.
- Separate witness checks: all six `W_*` invariants failed as expected. Scratch constants were `MaxReq = 1, MaxSasl = 1, MaxEnv = 1`, with the other constants matching Small.cfg.
- Added observational checks, without changing Init/Next: early NEW/DEL before processing LS (counterexample at depth 2); NAK of an entirely already-enabled request (two-request budget, depth 9); an authenticated opener silently consumed (two-attempt budget, depth 19); and a required client's inability predicate becoming false after NEW without a disconnect (depth 5).
- A separate fairness experiment omitted only `WF(CEnd)` from the fairness conjunction and used zero budgets. TLC found the waiting-under-hold counterexample to `Terminates` described above, over 1,248 distinct states.

These runs confirm the stated reachability and progress dependencies. They do not validate the textual interpretation merely because a model permits a trace, and they do not establish results for MC.cfg or all switch combinations.
