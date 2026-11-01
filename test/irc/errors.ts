import {expect} from "chai";
import fs from "fs";
import path from "path";
import {errorSpec, isErrorNumeric} from "../../client/js/irc/errors";

const LIST_REPLIES = ["535", "536", "537", "542", "545", "546", "548", "549"];

function numerics(from: number, to: number): string[] {
	return Array.from({length: to - from + 1}, (_, i) => String(from + i));
}

describe("irc/errors", function () {
	describe("errorSpec", function () {
		it("gives every 4xx/5xx numeric a non-empty code", function () {
			for (const numeric of numerics(400, 599)) {
				expect(errorSpec(numeric)?.code, numeric).to.match(/^[a-z0-9_]+$/);
			}
		});

		it("names the parameters that carry the nick and the channel", function () {
			expect(errorSpec("401")).to.deep.equal({code: "no_such_nick", nick: 0});
			expect(errorSpec("433")).to.deep.equal({code: "nickname_in_use", nick: 0});
			expect(errorSpec("474")).to.deep.equal({code: "banned_from_channel", channel: 0});
			expect(errorSpec("441")).to.deep.equal({
				code: "user_not_in_channel",
				nick: 0,
				channel: 1,
			});
			expect(errorSpec("421")).to.deep.equal({code: "unknown_command", command: 0});
		});

		it("falls back to a generic code for an unknown error numeric", function () {
			expect(errorSpec("499")).to.deep.equal({code: "err_499"});
			expect(errorSpec("599")).to.deep.equal({code: "err_599"});
		});

		it("has nothing for numerics outside 4xx/5xx", function () {
			for (const numeric of ["001", "372", "600", "4011", "x401", "40"]) {
				expect(errorSpec(numeric), numeric).to.equal(undefined);
			}
		});

		it("produces every code the error message component phrases", function () {
			const vue = fs.readFileSync(
				path.join(__dirname, "../../client/components/MessageTypes/error.vue"),
				"utf8"
			);
			const phrased = [...vue.matchAll(/case "([a-z_]+)":/g)].map((m) => m[1]);
			const produced = new Set(numerics(400, 599).map((n) => errorSpec(n)?.code));

			expect(phrased).to.not.be.empty;

			for (const code of phrased) {
				expect(produced.has(code), code).to.equal(true);
			}
		});
	});

	describe("isErrorNumeric", function () {
		it("is true for 4xx and 5xx error replies", function () {
			expect(isErrorNumeric("401")).to.equal(true);
			expect(isErrorNumeric("599")).to.equal(true);
		});

		it("is false for the list replies nefarious2 puts in that range", function () {
			for (const numeric of LIST_REPLIES) {
				expect(isErrorNumeric(numeric), numeric).to.equal(false);
			}
		});

		it("is false for anything that is not exactly a 4xx/5xx numeric", function () {
			for (const numeric of ["001", "372", "4011", "1401", "40", "PRIVMSG"]) {
				expect(isErrorNumeric(numeric), numeric).to.equal(false);
			}
		});
	});
});
