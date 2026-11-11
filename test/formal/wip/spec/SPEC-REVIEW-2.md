**Not yet fit as the reference server environment**, even for the declared pre-registration, one-mechanism subset. Several direct repairs are sound; documenting missing server traces does not make them safe to omit when checking a client.

Reviewed only this directory; specification checkout verified as `9ff58d1342af67aff88753388f568542820c4bfe`. No implementation findings were read. Aliases below are file:line references: **M** = `model/SpecHandshake.tla`; **CN** = `specs-src/extensions/capability-negotiation.md`; **S1** = `specs-src/extensions/sasl-3.1.md`; **S2** = `specs-src/extensions/sasl-3.2.md`.

1. **High — #2 still blocks the proposed server role.** Atomic sends preserve individual reads but exclude legal *message orderings*. For example, `900; NEW a; 903` cannot be emitted by M:181–188, although S1:79 imposes no adjacency and CN:416–418 permits NEW at any time. Likewise, a client can send END during a split ACK and receive `ACK(part); 001; ACK(rest)`; CN:69–75,380–382 requires delayed capability commitment, not delayed registration. M:103,118–119 excludes that send interval. Immediate, FIFO REQ replies also exclude deferred/reordered replies (D9, `DECISIONS.md:63–65`; CN:370–382). D15 still supplies an underived ACK-completion oracle (M:53–60,258–263; CN:373–381). Split output into scheduled sends and derive completion from actual ACK contents/outstanding requests; do not give the checked client a synthetic wire marker. The header's assurance at M:13–15 is too strong.

2. **Medium — #10 remains wrong with `Reauth = TRUE`.** TLC found a wholly pre-registration trace: successful authentication with 900/903 unread; client aborts/gives up; server DELs sasl; client sends its second opener before reading DEL; server silently consumes it. M:133–138 still allows silence when reauthentication is unavailable, contrary to S2:62–65. M:411–412 checks only `~Reauth`. The FALSE path is repaired. Require an appropriate error on this TRUE-path refusal too, or explicitly exclude that server policy from the reference.

3. **New coverage/checking gaps, rather than new evidence of conformance:**
   - **Optional cap-notify advertisement is newly coupled to client request policy** (M:98–103). With `ReqCapNotify = FALSE`, Small cannot produce an LS containing cap-notify, although CN:481–483 permits it independently of whether the client requests it. `README.md:19` overstates this configuration's server coverage. Use TRUE for the reference environment, or decouple these choices.
   - **The strengthened 907 check is vacuous in Small and CapNotify.** Both allow only one opener (`model/Small.cfg:4`, `model/CapNotify.cfg:4`); authentication cannot have succeeded before that opener is consumed (M:181–185,316–322,411–412; S1:81–82). Guard-mutation failures with other bounds do not establish coverage in these configurations.
   - **The repaired failure witness still does not require failure before END/registration.** M:298–300,438 remembers any received 904 during an exchange. TLC reaches END, an in-flight opener, 001, then the first 904; consuming that 904 satisfies the witness. Thus `DECISIONS.md:38` still overclaims the failed-login-then-END example (S1:77–87; S2:33–34). Record the ordered failure → subsequent END → welcome events. `W_LateReply` still establishes no old-reply/new-exchange correlation (M:299,441).

Disposition of every original finding:

| # | Judgment | Model and specification evidence |
| --- | --- | --- |
| 1 | **Fixed by explicit scope reduction**, not added behavior. | M:23–27,316–322; S2:60–65,100–108; S1:203–205. |
| 2 | **Not fixed**; documentation only. | M:53–60,103,118–119,181–188,258–263; CN:280–288,373–382; S1:79. See 1 above. |
| 3 | **Fixed with `ReqCapNotify = TRUE`**; Small's new coverage gap is above. | M:98–122,224–234,305–308,401–403; CN:475–485. Implicit enablement is represented functionally, not in the enabled sets. |
| 4 | **Partly fixed**: scope/claim corrected; restrictions remain. | M:9–18,77,307–308; CN:62–67,180,336–356. |
| 5 | **Partly fixed**: budgets no longer define inability; recovery/retry coverage remains bounded and service association availability stays fixed. | M:64,74–76,140–144,224,248–249; all configs:3–5; S1:45–48,77–78; S2:53–65. No supplied DEL→NEW run (`MaxEnv = 1`). |
| 6 | **Partly fixed**: labels corrected; `RULES.md:36` still presents Terminates as CN-22 coverage. | M:362–372,422–432; CN:459–460; S1:39–40. When checking client liveness, assuming its own eventual END/abort would be circular. |
| 7 | **Fixed.** Entirely redundant requests cannot be NAKed. | M:111–122,401–403; CN:345–349. |
| 8 | **Fixed.** LS is handled and advertisements sent before notifications become enabled. | M:100–104,224; CN:413–414,447–451. |
| 9 | **Fixed under D4's stated event interpretation.** Sticky obligation plus eventual disconnect. | M:248–249,257,267,276,353,370,420; S2:33–34. |
| 10 | **Partly fixed**: FALSE repaired; TRUE refusal still permits silence. | M:133–138,411–412; S1:81–82; S2:62–65. See 2 above. |
| 11 | **Partly fixed.** END while awaiting an abort reply is admitted, but reaching `abort` first sends AUTHENTICATE-star; END alone to abort an active exchange remains excluded with RecommendEnd. | M:325–345; S1:37–39,84–87. |
| 12 | **Partly fixed**: exclusions now documented, not verified or proved irrelevant. | M:23–27; `RULES.md:73–80`; CN:158–160,270–271,420,426–428; S1:55–70,203–233; S2:38–49. |
| 13 | **Partly fixed.** ACK/NAK exclusivity and required NAK/907 improved; synchronous monitors and other weak consequences remain. | M:379–417; CN:349,380–388; S2:67–69. In particular, `failed` alone does not monitor prior transmission of a failure reason. |
| 14 | **Partly fixed.** 904 is now required, but event ordering/provenance is not. | M:298–300,436–442; S1:77–87; S2:33–34. See 3 above. |

Before using this as the reference server: repair the output scheduling/ordering and ACK abstraction; cover optional advertisement, retries and loss/restoration with suitable configurations; and separate server fairness assumptions from properties required of the checked client. Either repair the TRUE reauthentication-refusal path or restrict the supported policy to FALSE. Wire details already excluded from scope need explicit mapping/separate checks. Until then, this supports a bounded experiment, not acceptance of a client throughout the claimed subset.

Validation used scratch copies only, with eight-worker TLC and Small's switches unless noted: the welcome-before-first-failure prefix was found with 1 REQ/1 attempt/0 changes; the silent authenticated opener with 1/2/1 and `Reauth = TRUE` (19-state trace). A no-authenticated-opener invariant passed 50,556 distinct states at 1/1/0; with two attempts its trigger was reachable. These are targeted probes, not a rerun of Small/MC or the author's mutation suite. Existing files were not edited.
