import {expect} from "chai";
import {casefold, namesEqual, parseCaseMapping} from "../../client/js/irc/casemap";

describe("irc/casemap", function () {
	describe("casefold", function () {
		it("lowercases ASCII letters under every mapping", function () {
			expect(casefold("NiCk", "ascii")).to.equal("nick");
			expect(casefold("NiCk", "rfc1459")).to.equal("nick");
			expect(casefold("NiCk", "rfc1459-strict")).to.equal("nick");
		});

		it("folds A and Z but not the characters either side of them", function () {
			expect(casefold("@AZ[", "ascii")).to.equal("@az[");
		});

		it("defaults to rfc1459", function () {
			expect(casefold("A[]\\~")).to.equal("a{}|^");
		});

		it("folds []\\~ to {}|^ under rfc1459", function () {
			expect(casefold("[]\\~", "rfc1459")).to.equal("{}|^");
			expect(casefold("{}|^", "rfc1459")).to.equal("{}|^");
		});

		it("does not fold ~ under rfc1459-strict", function () {
			expect(casefold("[]\\~", "rfc1459-strict")).to.equal("{}|~");
		});

		it("folds nothing but A-Z under ascii", function () {
			expect(casefold("[]\\~", "ascii")).to.equal("[]\\~");
		});

		it("leaves non-ASCII characters alone", function () {
			expect(casefold("Éé İ Σσς 🎉", "rfc1459")).to.equal("Éé İ Σσς 🎉");
		});

		it("leaves digits and other punctuation alone", function () {
			expect(casefold("#Chan-1_2.3`", "rfc1459")).to.equal("#chan-1_2.3`");
		});
	});

	describe("namesEqual", function () {
		it("compares case-insensitively per mapping", function () {
			expect(namesEqual("Nick", "nick", "ascii")).to.equal(true);
			expect(namesEqual("Nick[]", "nick{}", "rfc1459")).to.equal(true);
			expect(namesEqual("Nick[]", "nick{}", "ascii")).to.equal(false);
			expect(namesEqual("a~", "a^", "rfc1459")).to.equal(true);
			expect(namesEqual("a~", "a^", "rfc1459-strict")).to.equal(false);
		});

		it("is false for different lengths", function () {
			expect(namesEqual("nick", "nick2")).to.equal(false);
			expect(namesEqual("", "a")).to.equal(false);
		});

		it("is true for two empty strings", function () {
			expect(namesEqual("", "")).to.equal(true);
		});
	});

	describe("parseCaseMapping", function () {
		it("recognises the known values case-insensitively", function () {
			expect(parseCaseMapping("rfc1459")).to.equal("rfc1459");
			expect(parseCaseMapping("RFC1459")).to.equal("rfc1459");
			expect(parseCaseMapping("rfc1459-strict")).to.equal("rfc1459-strict");
			expect(parseCaseMapping("ascii")).to.equal("ascii");
		});

		it("returns undefined for unknown values", function () {
			expect(parseCaseMapping("rfc7613")).to.equal(undefined);
			expect(parseCaseMapping("")).to.equal(undefined);
		});
	});
});
