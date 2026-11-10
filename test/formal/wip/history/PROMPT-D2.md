# Second review: history and delivery decisions v2

Your first report is `DECISIONS-REVIEW-1.md`. v1 is kept as `.DECISIONS-v1.md.ref` and
`.DESIGN-v1.md.ref`; `diff` them against `DECISIONS.md` and `DESIGN.md`. `RULES.md` was also
revised: rows fixed and an out-of-scope table added at the end.

About the commit: `specs-src/` is a plain copy, not a git checkout, so `9ff58d1` cannot be resolved
there. Review against the files as they are.

What to read and the limits are the same as in `PROMPT-D.md`: these files, the spec text
under `../formal-spec/specs-src/`, and nothing else.

Please, briefly and adversarially:

1. Does each finding of review 1 now have an adequate answer? List any that do not, by number.
2. Are the new decisions D10-D14 supported by the text, and no wider or narrower than it allows?
   Is each switch labelled correctly as guaranteed, allowed, adversarial or a restriction?
3. Can each property's witness be reached at the bounds in DESIGN.md? Is any property still
   missing a condition?
4. Is anything blocking writing `Delivery.tla` and `History.tla` from these decisions?

Write the report to `DECISIONS-REVIEW-2.md`, verdict first. Cite file:line. Edit no other file.
