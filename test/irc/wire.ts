import {expect} from "chai";
import {tagPrefix, trailingLine} from "../../client/js/irc/wire";

describe("irc/wire", function () {
	describe("tagPrefix", function () {
		it("is the escaped @tags block with its space, or nothing", function () {
			expect(tagPrefix({"+draft/reply": "a b"})).to.equal("@+draft/reply=a\\sb ");
			expect(tagPrefix({})).to.equal("");
			expect(tagPrefix(undefined)).to.equal("");
		});
	});

	describe("trailingLine", function () {
		it("always writes the last parameter as a trailing one", function () {
			expect(trailingLine("PRIVMSG", ["#a", "hi"])).to.equal("PRIVMSG #a :hi");
			expect(trailingLine("PART", ["#a", ""])).to.equal("PART #a :");
			expect(trailingLine("QUIT", ["bye now"], {label: "x"})).to.equal(
				"@label=x QUIT :bye now"
			);
		});

		it("writes a bare command when there are no parameters", function () {
			expect(trailingLine("AWAY", [])).to.equal("AWAY");
		});

		it("rejects CR, LF and NUL in the trailing parameter", function () {
			for (const bad of ["a\rb", "a\nb", "a\0b"]) {
				expect(() => trailingLine("PRIVMSG", ["#a", bad])).to.throw(/CR, LF or NUL/);
			}
		});
	});
});
