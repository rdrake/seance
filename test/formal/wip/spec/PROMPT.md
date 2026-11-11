# Review request: is this TLA+ model faithful to the IRCv3 specifications?

`model/SpecHandshake.tla` is meant to model connection registration (CAP 302
negotiation with cap-notify, SASL 3.1 and 3.2) exactly as the IRCv3 specs allow
it: a client and a server that each may do anything the spec text permits and
nothing it forbids. The spec text is in `specs-src/` (ircv3-specifications at
commit 9ff58d1); the relevant files are `specs-src/extensions/capability-negotiation.md`,
`sasl-3.1.md` and `sasl-3.2.md`. `RULES.md` lists the normative sentences and
how each is encoded; `DECISIONS.md` records interpretation choices.

Judge the model ONLY against the spec text. Do not read anything outside this
directory; in particular do not look at any client or server implementation.
TLC and Java are available (`java -cp ~/tools/formal/tla2tools.jar tlc2.TLC`),
and `model/Small.cfg` takes about 70 s with `-workers 8`; `model/MC.cfg` is too
large to run here. You may run TLC with small, modified configs in a scratch
copy, but do not edit the existing files.

Please review adversarially and report, with file:line references to both the
model and the spec:

1. Rules in RULES.md that are mis-encoded: the guard or property says something
   different from the spec sentence.
2. Normative sentences in scope that RULES.md misses, or rules marked "out" that
   matter for registration correctness.
3. Places where the model's client or server is MORE restrictive than the spec
   (it forbids something the spec permits) or LESS restrictive (it permits
   something the spec forbids). Over-restriction is the more dangerous error,
   because code checked against the model would be wrongly accepted.
4. Interpretation choices in DECISIONS.md you disagree with, with the spec text
   that argues otherwise.
5. Properties that are vacuous, too weak, or wrong, including the fairness
   assumptions behind `Terminates`, and whether the `W_*` witnesses show what
   their comments claim.
6. Whether this model is a sound reference for checking implementations against:
   what would a code model need to map onto it, and what in this model would make
   such a check pass wrongly.

Be concrete. Do not rewrite the model; list findings, most severe first. Write
the report to SPEC-REVIEW.md in this directory.
