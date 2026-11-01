# Brief: triage surviving mutants (tiers 2–3)

You are triaging StrykerJS mutation-testing results for Seance, a browser IRC client (TypeScript; see CLAUDE.md at the repo root for architecture). Worktree: /Users/rdrake/workspace/afternet/seance/tmp/mutation (branch chore/mutation-testing). Your list is docs/projects/mutation-testing/tier23/groupN.md (N given in your prompt): every mutant that survived (tests ran, none failed) or had NoCoverage (no test runs that code), with id, line:column in the source file, mutator, original code → replacement, and how many tests ran it. Line numbers refer to the file as it is in this worktree. The full report is reports/tier23.json if you need more (e.g. `coveredBy` test ids, matched against `testFiles` in that json).

## Classify every mutant into exactly one of

- **equivalent** — the mutant cannot change observable behaviour (e.g. a guard that a later check makes redundant, a default that is always overwritten, a log string). Say why in a few words.
- **untested** — real behaviour no test pins. Name the behaviour.
- **weak-test** — a test exists whose name (or obvious intent) covers this behaviour, yet its assertions would not notice the mutant. Name the test (file + `it(...)` title) and what its assertion misses. This category matters most to the user: tests that say they test something but don't.
- **possible-bug** — reading the code to judge the mutant shows the original code looks wrong (the mutant is as correct or more correct, dead code that should be live, a check that can never fire, a type confusion like iterating a Map with Object.entries). Give a concrete input and wrong outcome.

Group mutants that share a cause (e.g. ten StringLiteral survivors in one untested error message) into one row with all their ids.

## Rules

- Do NOT edit any file under client/, shared/ or test/ — other agents work in this same tree concurrently. Reading is fine. You may run single mocha files: `npx cross-env NODE_ENV=test TS_NODE_PROJECT='./test/tsconfig.json' npx mocha --config=test/.mocharc.yml <file>`. If you need to prove a possible bug, write a throwaway spec under /tmp/triage-groupN/ only if it can import by absolute path; otherwise reason from the code.
- Never run yarn install/add (node_modules is a symlink). Never git stash, commit, or checkout.
- Be honest about uncertainty: if you cannot tell equivalent from untested, say "unsure" and why.

## Output

Write docs/projects/mutation-testing/tier23/groupN-verdict.md: a table per source file (ids | class | one-line reason / test name), then at the end a section "Possible bugs" (each with input → wrong outcome, file:line) and a section "Weak tests" (test file, it-title, what it fails to assert). Then reply with: counts per class, the possible bugs, and the weak tests — terse.
