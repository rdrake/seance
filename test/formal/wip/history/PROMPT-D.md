# Review: history and delivery decisions, before any TLA+

This is the first review of a new model, made with the same method as the handshake spec model.

**What to read.**
- In this directory: `RULES.md`, `DESIGN.md` and `DECISIONS.md` (D1-D9).
- The spec text: `../formal-spec/specs-src/extensions/{chathistory,batch,labeled-response,echo-message,message-ids,server-time,message-tags}.md`
  and `../formal-spec/specs-src/batches/chathistory.md`, at commit 9ff58d1.
- Judge ONLY against that text. Read nothing else: no Seance code and no other files under
  `../formal-spec/`.

Please, briefly and adversarially:

1. **RULES.md.** Is any normative sentence in scope missing, misquoted, or at the wrong level
   (MUST, SHOULD, MAY, or descriptive)? Check the file:line references you rely on.
2. **D1-D9.** For each decision:
   - Is the reading supported by the text it cites?
   - Is it no wider or narrower than the text allows?
   - Does the model it describes allow every behaviour the text allows, within the stated
     bounds?
   Look hardest at D5 (strict timestamp exclusion), D6 (where a live message may fall) and D7
   (what CH-19's "single connection" means for the reconnect, and whether the pseudocode really
   anchors only on the current connection).
3. **Properties (DESIGN.md).** Is any property stated with no switch it needs, or would any be
   vacuous at the bounds? Is any witness unable to show what it claims?
4. **Missing decisions.** What open reading would change what the model accepts and is not
   listed?

Write the report to `DECISIONS-REVIEW-1.md`, with the verdict first, then findings numbered by
section. Cite file:line for every claim. Do not edit any other file.
