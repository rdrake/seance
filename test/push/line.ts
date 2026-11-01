import {expect} from "chai";
import {lineIndexOf, parsePushLine, parseTags, unescapeTagValue} from "../../client/js/push/line";

describe("push/line", function () {
	describe("unescapeTagValue", function () {
		it("undoes the message-tags escapes", function () {
			expect(unescapeTagValue("a\\:b\\sc\\\\d\\r\\n")).to.equal("a;b c\\d\r\n");
		});

		it("drops a trailing lone backslash and keeps unknown escapes' character", function () {
			expect(unescapeTagValue("x\\")).to.equal("x");
			expect(unescapeTagValue("\\q")).to.equal("q");
		});
	});

	describe("parseTags", function () {
		it("reads values and flags", function () {
			expect(
				parseTags("msgid=abc;draft/multiline-concat;time=2026-09-04T00:00:00.000Z")
			).to.deep.equal({
				msgid: "abc",
				"draft/multiline-concat": true,
				time: "2026-09-04T00:00:00.000Z",
			});
		});

		it("ignores empty pairs", function () {
			expect(parseTags(";a=1;;")).to.deep.equal({a: "1"});
		});
	});

	describe("parsePushLine", function () {
		it("parses a PM line", function () {
			const line = parsePushLine(
				"@msgid=abc123;time=2026-09-04T10:20:30.123Z;account=alice :alice!u@h.example PRIVMSG bob :hi there"
			);
			expect(line).to.deep.equal({
				tags: {msgid: "abc123", time: "2026-09-04T10:20:30.123Z", account: "alice"},
				nick: "alice",
				command: "PRIVMSG",
				target: "bob",
				text: "hi there",
			});
		});

		it("parses a line without tags and upper-cases the command", function () {
			expect(parsePushLine(":alice!u@h notice #chan :x")).to.deep.equal({
				tags: {},
				nick: "alice",
				command: "NOTICE",
				target: "#chan",
				text: "x",
			});
		});

		it("keeps a trailing text that starts with a colon or is empty", function () {
			expect(parsePushLine(":a!u@h PRIVMSG b ::-)")?.text).to.equal(":-)");
			expect(parsePushLine(":a!u@h PRIVMSG b :")?.text).to.equal("");
		});

		it("keeps CTCP ACTION bytes verbatim", function () {
			expect(parsePushLine(":a!u@h PRIVMSG #c :\x01ACTION waves\x01")?.text).to.equal(
				"\x01ACTION waves\x01"
			);
		});

		it("parses a later line of a multiline message: batch, ordering and concat tags, no msgid", function () {
			const line = parsePushLine(
				"@batch=base1;time=T;account=alice;evilnet.github.io/line=2/3/5;draft/multiline-concat :alice!u@h PRIVMSG #chan : continued"
			);
			expect(line?.tags).to.deep.equal({
				batch: "base1",
				time: "T",
				account: "alice",
				"evilnet.github.io/line": "2/3/5",
				"draft/multiline-concat": true,
			});
			expect(line?.text).to.equal(" continued");
		});

		it("parses a MARKREAD line from the server", function () {
			expect(
				parsePushLine(":irc.example MARKREAD #chan timestamp=2026-09-04T10:20:30.123Z")
			).to.deep.equal({
				tags: {},
				nick: "irc.example",
				command: "MARKREAD",
				target: "#chan",
				text: "",
				timestamp: "2026-09-04T10:20:30.123Z",
			});
			expect(parsePushLine(":irc.example MARKREAD bob *")?.timestamp).to.equal(undefined);
		});

		it("returns null for anything that is not a prefixed line", function () {
			expect(parsePushLine("")).to.equal(null);
			expect(parsePushLine("PING :x")).to.equal(null);
			expect(parsePushLine("@only=tags")).to.equal(null);
			expect(parsePushLine(":prefixonly")).to.equal(null);
			expect(parsePushLine('{"t":"msg"}')).to.equal(null);
		});
	});

	describe("lineIndexOf", function () {
		it("reads index/sent/total", function () {
			expect(lineIndexOf({"evilnet.github.io/line": "2/3/5"})).to.deep.equal({
				index: 2,
				sent: 3,
				total: 5,
			});
		});

		it("rejects a missing, malformed or inconsistent tag", function () {
			expect(lineIndexOf({})).to.equal(null);
			expect(lineIndexOf({"evilnet.github.io/line": true})).to.equal(null);
			expect(lineIndexOf({"evilnet.github.io/line": "2/3"})).to.equal(null);
			expect(lineIndexOf({"evilnet.github.io/line": "0/1/1"})).to.equal(null);
			expect(lineIndexOf({"evilnet.github.io/line": "4/3/5"})).to.equal(null);
			expect(lineIndexOf({"evilnet.github.io/line": "1/6/5"})).to.equal(null);
		});
	});
});

describe("push/line: edges", function () {
	it("reads an empty tag block", function () {
		expect(parsePushLine("@ :bob!b@h PRIVMSG #c :hi")).to.deep.equal({
			tags: {},
			nick: "bob",
			command: "PRIVMSG",
			target: "#c",
			text: "hi",
		});
	});

	it("reads a command with no parameters", function () {
		expect(parsePushLine(":srv PING")).to.deep.equal({
			tags: {},
			nick: "srv",
			command: "PING",
			target: "",
			text: "",
		});
		expect(parsePushLine(":srv ")).to.equal(null);
	});

	it("reads a trailing parameter that comes first", function () {
		expect(parsePushLine(":bob PRIVMSG :hello world")).to.deep.include({
			target: "",
			text: "hello world",
		});
	});

	it("skips empty words between parameters", function () {
		expect(parsePushLine(":bob PRIVMSG  #c :hi")).to.deep.include({target: "#c", text: "hi"});
	});

	it("takes a MARKREAD timestamp from the middle parameters only", function () {
		expect(parsePushLine(":srv MARKREAD #c :x timestamp=2026")).not.to.have.property(
			"timestamp"
		);
		expect(parsePushLine(":bob PRIVMSG timestamp=2026 :hi")).not.to.have.property("timestamp");
	});

	it("reads several digits in each part of the line tag, and nothing around them", function () {
		expect(lineIndexOf({"evilnet.github.io/line": "10/12/15"})).to.deep.equal({
			index: 10,
			sent: 12,
			total: 15,
		});
		expect(lineIndexOf({"evilnet.github.io/line": "1/1/1"})).to.deep.equal({
			index: 1,
			sent: 1,
			total: 1,
		});
		expect(lineIndexOf({"evilnet.github.io/line": "x1/2/3"})).to.equal(null);
		expect(lineIndexOf({"evilnet.github.io/line": "1/2/3x"})).to.equal(null);
	});
});
