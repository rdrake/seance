import {expect} from "chai";
import {
	addMessage,
	joinLines,
	MergedMessage,
	midEllipsis,
	renderMergedBody,
} from "../../client/js/push/merge";

describe("push/merge", function () {
	describe("addMessage", function () {
		it("appends a plain message and reports it as new", function () {
			const {entries, isNew} = addMessage([], {from: "alice", text: "hi", msgid: "m1"});
			expect(isNew).to.equal(true);
			expect(entries).to.deep.equal([{from: "alice", text: "hi", msgid: "m1"}]);
		});

		it("adds a message pushed twice (same msgid) once, and does not count it as new", function () {
			const first = addMessage([], {from: "alice", text: "hi", msgid: "m1"});
			const again = addMessage(first.entries, {from: "alice", text: "hi", msgid: "m1"});

			expect(again.isNew).to.equal(false);
			expect(again.entries).to.deep.equal(first.entries);
		});

		it("never dedupes messages that carry no msgid", function () {
			const a = addMessage([], {from: "a", text: "x"});
			const b = addMessage(a.entries, {from: "a", text: "x"});

			expect(b.isNew).to.equal(true);
			expect(b.entries).to.have.length(2);
		});

		it("keeps only the newest `keep` messages", function () {
			let entries: MergedMessage[] = [];

			for (let i = 1; i <= 6; i++) {
				entries = addMessage(entries, {from: "a", text: `m${i}`}, 4).entries;
			}

			expect(entries.map((e) => e.text)).to.deep.equal(["m3", "m4", "m5", "m6"]);
		});

		it("does not mutate its input", function () {
			const before: MergedMessage[] = [{from: "a", text: "x"}];
			addMessage(before, {from: "b", text: "y"});
			expect(before).to.deep.equal([{from: "a", text: "x"}]);
		});

		it("creates one entry for the first line of a batch and joins later lines into it", function () {
			const first = addMessage([], {
				from: "alice",
				text: "line one",
				msgid: "b1",
				batch: "b1",
				line: {index: 1, sent: 3, total: 3},
			});
			expect(first.isNew).to.equal(true);

			// Later lines carry no msgid (draft/multiline's fallback form).
			const second = addMessage(first.entries, {
				from: "alice",
				text: " continued",
				batch: "b1",
				line: {index: 2, sent: 3, total: 3},
				concat: true,
			});
			expect(second.isNew).to.equal(false);

			const third = addMessage(second.entries, {
				from: "alice",
				text: "line two",
				batch: "b1",
				line: {index: 3, sent: 3, total: 3},
			});
			expect(third.isNew).to.equal(false);
			expect(third.entries).to.have.length(1);
			expect(third.entries[0].text).to.equal("line one continued\nline two");
			expect(third.entries[0].msgid).to.equal("b1");
		});

		it("takes the message's msgid from its first line whichever order the lines arrive in", function () {
			const later = addMessage([], {
				from: "x",
				text: "two",
				batch: "k",
				line: {index: 2, sent: 2, total: 2},
			});
			expect(later.entries[0].msgid).to.equal(undefined);

			const first = addMessage(later.entries, {
				from: "x",
				text: "one",
				msgid: "m1",
				batch: "k",
				line: {index: 1, sent: 2, total: 2},
			});
			expect(first.isNew).to.equal(false);
			expect(first.entries[0].msgid).to.equal("m1");
			expect(first.entries[0].text).to.equal("one\ntwo");
		});

		it("accepts lines out of order and a duplicate line without change", function () {
			const a = addMessage([], {
				from: "x",
				text: "two",
				batch: "b",
				line: {index: 2, sent: 2, total: 2},
			});
			expect(a.entries[0].text).to.equal("…\ntwo");

			const b = addMessage(a.entries, {
				from: "x",
				text: "one",
				batch: "b",
				line: {index: 1, sent: 2, total: 2},
			});
			expect(b.isNew).to.equal(false);
			expect(b.entries[0].text).to.equal("one\ntwo");

			const c = addMessage(b.entries, {
				from: "x",
				text: "one",
				batch: "b",
				line: {index: 1, sent: 2, total: 2},
			});
			expect(c.isNew).to.equal(false);
			expect(c.entries).to.deep.equal(b.entries);
		});

		it("takes the batch msgid from whichever line carries it (first line only, may arrive late)", function () {
			// draft/multiline's fallback form: msgid on the first line only.
			const late = addMessage([], {
				from: "x",
				text: "two",
				batch: "b1",
				line: {index: 2, sent: 2, total: 2},
			});
			expect(late.entries[0].msgid).to.equal(undefined);

			const first = addMessage(late.entries, {
				from: "x",
				text: "one",
				msgid: "b1",
				batch: "b1",
				line: {index: 1, sent: 2, total: 2},
			});
			expect(first.entries).to.have.length(1);
			expect(first.entries[0].msgid).to.equal("b1");
			expect(first.entries[0].text).to.equal("one\ntwo");

			// A line without one never clears it.
			const again = addMessage(first.entries, {
				from: "x",
				text: "two",
				batch: "b1",
				line: {index: 2, sent: 2, total: 2},
			});
			expect(again.entries[0].msgid).to.equal("b1");
		});

		it("marks a capped message as incomplete", function () {
			const {entries} = addMessage([], {
				from: "x",
				text: "one",
				batch: "b",
				line: {index: 1, sent: 1, total: 4},
			});
			expect(entries[0].text).to.equal("one\n…");
		});

		it("treats a line with a batch but no index as a plain message", function () {
			const {entries, isNew} = addMessage([], {from: "x", text: "one", batch: "b"});
			expect(isNew).to.equal(true);
			expect(entries[0].lines).to.equal(undefined);
		});

		it("keeps the largest sent/total seen", function () {
			const a = addMessage([], {
				from: "x",
				text: "three",
				batch: "b",
				line: {index: 3, sent: 3, total: 3},
			});
			expect(a.isNew).to.equal(true);
			expect(a.entries[0].text).to.equal("…\n…\nthree");

			const b = addMessage(a.entries, {
				from: "x",
				text: "two",
				batch: "b",
				line: {index: 2, sent: 2, total: 3},
			});
			expect(b.isNew).to.equal(false);
			expect(b.entries[0].text).to.equal("…\ntwo\nthree");
		});

		it("keeps an in-flight batch ahead of older messages", function () {
			let entries = addMessage([], {
				from: "x",
				text: "one",
				batch: "b",
				line: {index: 1, sent: 2, total: 2},
			}).entries;

			entries = addMessage(entries, {from: "a", text: "p1"}, 4).entries;
			entries = addMessage(entries, {from: "a", text: "p2"}, 4).entries;
			entries = addMessage(entries, {from: "a", text: "p3"}, 4).entries;

			const result = addMessage(
				entries,
				{
					from: "x",
					text: "two",
					batch: "b",
					line: {index: 2, sent: 2, total: 2},
				},
				4
			);

			expect(result.isNew).to.equal(false);

			const final = addMessage(result.entries, {from: "a", text: "p4"}, 4).entries;

			expect(final.map((e) => e.text)).to.deep.equal(["p2", "p3", "one\ntwo", "p4"]);
		});
	});

	describe("joinLines", function () {
		it("returns the text of a plain entry", function () {
			expect(joinLines({from: "a", text: "plain"})).to.equal("plain");
		});
	});

	describe("midEllipsis", function () {
		it("keeps how a long text starts and ends", function () {
			const long = "a".repeat(60) + "b".repeat(30);
			const out = midEllipsis(long, 48, 18);
			expect(out).to.have.length(48 + 1 + 18);
			expect(out.startsWith("a".repeat(48) + "…")).to.equal(true);
			expect(out.endsWith("b".repeat(18))).to.equal(true);
			expect(midEllipsis("short", 48, 18)).to.equal("short");
		});
	});

	describe("renderMergedBody", function () {
		it("prefixes channel lines with the sender and applies the renderer", function () {
			const body = renderMergedBody(
				[
					{from: "alice", text: "**hi**"},
					{from: "bob", text: "yo"},
				],
				true,
				(t) => t.replace(/\*\*/g, "")
			);
			expect(body).to.equal("alice: hi\nbob: yo");
		});

		it("shows bare text in a DM", function () {
			expect(renderMergedBody([{from: "alice", text: "hi"}], false)).to.equal("hi");
		});

		it("collapses the middle over the budget", function () {
			const entries = Array.from({length: 4}, (_, i) => ({
				from: "a",
				text: `${i}`.repeat(60),
			}));
			const body = renderMergedBody(entries, false);
			expect(body).to.include("… +2 more");
			expect(body.split("\n")).to.have.length(3);
		});
	});
});

describe("push/merge: edges", function () {
	const line = (index: number, sent: number, total: number) => ({index, sent, total});

	it("joinLines gives a plain entry's text, even with an empty line map", function () {
		expect(joinLines({from: "b", text: "orig", lines: {}})).to.equal("orig");
	});

	it("adds no trailing ellipsis when every line was sent", function () {
		expect(
			joinLines({
				from: "b",
				text: "",
				lines: {"1": {text: "a", concat: false}},
				sent: 1,
				total: 1,
			})
		).to.equal("a");
	});

	it("keeps two batches apart", function () {
		let entries: MergedMessage[] = [];
		entries = addMessage(entries, {
			from: "b",
			text: "a1",
			batch: "A",
			line: line(1, 2, 2),
		}).entries;
		entries = addMessage(entries, {
			from: "b",
			text: "b1",
			batch: "B",
			line: line(1, 2, 2),
		}).entries;
		expect(entries.map((e) => [e.batch, e.text])).to.deep.equal([
			["A", "a1\n…"],
			["B", "b1\n…"],
		]);
	});

	it("keeps the batch's first msgid once it has one", function () {
		let entries: MergedMessage[] = [];
		entries = addMessage(entries, {
			from: "b",
			text: "a1",
			msgid: "m1",
			batch: "A",
			line: line(1, 2, 2),
		}).entries;
		entries = addMessage(entries, {
			from: "b",
			text: "a2",
			msgid: "m2",
			batch: "A",
			line: line(2, 2, 2),
		}).entries;
		expect(entries).to.have.length(1);
		expect(entries[0].msgid).to.equal("m1");
	});

	it("a new batch keeps the plain message before it", function () {
		const {entries} = addMessage([{from: "c", text: "plain", msgid: "p"}], {
			from: "b",
			text: "a1",
			batch: "A",
			line: line(1, 1, 1),
		});
		expect(entries.map((e) => e.text)).to.deep.equal(["plain", "a1"]);
	});

	it("caps the list on every path, a batch line and a repeat included", function () {
		const five: MergedMessage[] = Array.from({length: 5}, (_, i) => ({
			from: "c",
			text: `t${i}`,
			msgid: `p${i}`,
		}));
		expect(
			addMessage(five, {from: "b", text: "a1", batch: "A", line: line(1, 1, 1)}).entries
		).to.have.length(4);
		const again = addMessage(five, {from: "c", text: "t4", msgid: "p4"});
		expect(again.isNew).to.equal(false);
		expect(again.entries.map((e) => e.msgid)).to.deep.equal(["p1", "p2", "p3", "p4"]);
	});

	it("leaves a text exactly at the ellipsis length alone", function () {
		const at = "x".repeat(48 + 18 + 1);
		expect(midEllipsis(at)).to.equal(at);
		expect(midEllipsis(`${at}y`)).to.equal(`${"x".repeat(48)}…${"x".repeat(17)}y`);
	});

	it("keeps three short lines, and drops lines only past the budget", function () {
		const entries = (lengths: number[]): MergedMessage[] =>
			lengths.map((n, i) => ({from: "", text: String(i).repeat(n)}));
		expect(renderMergedBody(entries([1, 2, 3]), false)).to.equal("0\n11\n222");
		// 67 + 67 + 34 and two newlines: exactly the budget.
		expect(renderMergedBody(entries([67, 67, 34]), false).split("\n")[1]).to.equal(
			"1".repeat(67)
		);
		// One more character: the middle line goes, its count before the newest.
		expect(renderMergedBody(entries([67, 67, 35]), false).split("\n")).to.deep.equal([
			"0".repeat(48 + 18 + 1),
			"… +1 more",
			"2".repeat(35),
		]);
	});
});
