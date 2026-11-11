# Decisions review 6: D16-D21 for Delivery v2

Read `DECISIONS.md` (D1, D2, D12, D13, D15 and the new D16-D21), `DESIGN.md`, `MODEL-REVIEW-2.md`,
and the spec text under `../formal-spec/specs-src/` (labeled-response, echo-message, batch,
chathistory). D19 describes Seance's code. You may read `../../client/js/irc/pending.ts` and
`../../client/js/irc/handlers/privmsg.ts` (around `settleEcho` and `client.replaying`) to check
that description. Read nothing else, and do not run TLC.

Please, briefly and adversarially, with file:line:
1. Is each class right (guaranteed / allowed / adversarial / client restriction)? Check:
   - interleaving and nesting (D16);
   - competing lines (D17);
   - close (D18);
   - history replay (D19);
   - the self-copy order, NOTICE and modified echoes (D20).
2. Is anything required or allowed by the text missing, or anything forbidden let in?
3. D19: does Seance's code do what it says? Are there history-like lines that do reach
   `settleEcho`, for example a replay outside a chathistory batch, or `draft/multiline`?
4. D21: are the obligations stated correctly, and strong enough to catch a client that ignores
   ACK or a 4xx?

Write the report to `DECISIONS-REVIEW-6.md`, verdict first. Edit no other file.
