#!/usr/bin/env node
// Split a Stryker JSON report's survivors (Survived + NoCoverage) into N
// lists balanced by count, one Markdown file per group, each mutant with its
// id, place, mutator, original text and replacement — the input the
// classification brief (docs/projects/mutation-testing/tier23/BRIEF.md) reads.
//
//   node tools/mutation/survivors.mjs reports/tier23.json out-dir [groups=5]
import fs from "node:fs";
import path from "node:path";

const [report, outDir, groupArg = "5"] = process.argv.slice(2);

if (!report || !outDir) {
	console.error("usage: survivors.mjs <report.json> <out-dir> [groups]");
	process.exit(1);
}

const {files} = JSON.parse(fs.readFileSync(report, "utf8"));
const byFile = new Map();

for (const [file, {source, mutants}] of Object.entries(files)) {
	const lines = source.split("\n");

	for (const m of mutants) {
		if (m.status !== "Survived" && m.status !== "NoCoverage") {
			continue;
		}

		const {start, end} = m.location;
		const span = lines.slice(start.line - 1, end.line);
		const original =
			span.length === 1
				? span[0].slice(start.column - 1, end.column - 1)
				: `${span[0].slice(start.column - 1)} … ${span[span.length - 1].slice(
						0,
						end.column - 1
				  )}`;
		const row =
			`- [${m.id}] ${m.status} L${start.line}:${start.column} ${m.mutatorName}: ` +
			`\`${original.trim().slice(0, 160)}\` → \`${(m.replacement ?? "")
				.trim()
				.slice(0, 160)}\`` +
			`  (tests run: ${(m.coveredBy ?? []).length})`;
		byFile.set(file, [...(byFile.get(file) ?? []), row]);
	}
}

const count = Number(groupArg);
const groups = Array.from({length: count}, () => ({files: [], size: 0}));

for (const file of [...byFile.keys()].sort((a, b) => byFile.get(b).length - byFile.get(a).length)) {
	const smallest = groups.reduce((a, b) => (b.size < a.size ? b : a));
	smallest.files.push(file);
	smallest.size += byFile.get(file).length;
}

fs.mkdirSync(outDir, {recursive: true});

for (const [i, group] of groups.entries()) {
	const body = group.files
		.map(
			(file) => `\n## ${file} (${byFile.get(file).length})\n${byFile.get(file).join("\n")}\n`
		)
		.join("");
	fs.writeFileSync(path.join(outDir, `group${i + 1}.md`), body);
	console.log(`group${i + 1}: ${group.size} mutants in ${group.files.length} files`);
}
