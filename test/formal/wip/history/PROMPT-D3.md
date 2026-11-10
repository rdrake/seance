# Third review: history and delivery decisions v3

Your reports so far are `DECISIONS-REVIEW-1.md` and `DECISIONS-REVIEW-2.md`. v2 is kept as
`.DECISIONS-v2.md.ref`, `.DESIGN-v2.md.ref` and `.RULES-v2.md.ref`; `diff` them against the
current files. What to read and the limits are as in `PROMPT-D.md`: these files and the spec
text under `../formal-spec/specs-src/`, nothing else.

This is a short round. Please, briefly and adversarially:

1. Does each finding of review 2 now have an adequate answer? List any that do not, by number.
2. Is the new switch table in DECISIONS.md complete and correctly classified? Do the three
   order switches (`TimeOrdered`, `BatchAgrees`, `StableAcrossReconnect`) and the two page
   switches (`ExactCount`, `Contiguous`) compose without contradiction?
3. Order is now weakened to "non-decreasing in time". Is that the right property for a client
   with no oracle for server ranks, and are its conditions and witnesses right?
4. **Verdict:** can `Delivery.tla` and `History.tla` be written from these decisions now? If
   not, name exactly what blocks them.

Write the report to `DECISIONS-REVIEW-3.md`, verdict first. Cite file:line. Edit no other file.
