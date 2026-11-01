import {expect} from "chai";
import {colourReading} from "../../../client/js/helpers/ircmessageparser/colours";

// style.css's `.irc-fgN` defaults, 0–98, as the module is meant to draw them.
const PALETTE = (
	"fff 000 001f3f 2ecc40 ff4136 85144b b10dc9 ff851b ffdc00 01ff70 39cccc 7fdbff " +
	"0074d9 f012be aaa ddd 470000 472100 474700 324700 004700 00472c 004747 002747 " +
	"000047 2e0047 470047 47002a 740000 743a00 747400 517400 007400 007449 007474 " +
	"004074 000074 4b0074 740074 740045 b50000 b56300 b5b500 7db500 00b500 00b571 " +
	"00b5b5 0063b5 0000b5 7500b5 b500b5 b5006b f00 ff8c00 ff0 b2ff00 0f0 00ffa0 0ff " +
	"008cff 00f a500ff f0f ff0098 ff5959 ffb459 ffff71 cfff60 6fff6f 65ffc9 6dffff " +
	"59b4ff 5959ff c459ff f6f ff59bc ff9c9c ffd39c ffff9c e2ff9c 9cff9c 9cffdb 9cffff " +
	"9cd3ff 9c9cff dc9cff ff9cff ff94d3 000 131313 282828 363636 4d4d4d 656565 818181 " +
	"9f9f9f bcbcbc e2e2e2 fff"
).split(" ");

const six = (hex: string) =>
	(hex.length === 3 ? [...hex].map((c) => c + c).join("") : hex).toUpperCase();

const hexPair = (fg: string, bg: string) => colourReading({hexColor: fg, hexBgColor: bg});

describe("colourReading", function () {
	it("is plain when the sender set no colour", function () {
		expect(colourReading({})).to.equal("plain");
	});

	it("is unknown when only one of the two colours is set", function () {
		expect(colourReading({textColor: "4"})).to.equal("unknown");
		expect(colourReading({bgColor: "4"})).to.equal("unknown");
		expect(colourReading({hexColor: "FF0000"})).to.equal("unknown");
		expect(colourReading({hexBgColor: "FF0000"})).to.equal("unknown");
	});

	it("reads palette codes and hex colours alike, in either slot", function () {
		expect(colourReading({textColor: "0", bgColor: "1"})).to.equal("readable");
		expect(colourReading({textColor: "1", bgColor: "1"})).to.equal("hidden");
		expect(hexPair("FFFFFF", "000000")).to.equal("readable");
		expect(colourReading({textColor: "0", hexBgColor: "000000"})).to.equal("readable");
		expect(colourReading({hexColor: "000000", bgColor: "0"})).to.equal("readable");
		expect(colourReading({hexColor: "000000", bgColor: "1"})).to.equal("hidden");
	});

	it("draws every code 0–98 as style.css does", function () {
		PALETTE.forEach((hex, code) => {
			expect(
				colourReading({textColor: String(code), hexBgColor: six(hex)}),
				`code ${code}`
			).to.equal("hidden");
		});
	});

	it("knows no code past 98", function () {
		expect(colourReading({textColor: "99", bgColor: "1"})).to.equal("unknown");
	});

	it("reads a six-digit hex colour as written", function () {
		// Red on yellow reads; doubled digits would make it yellow on white.
		expect(hexPair("FF0000", "FFFF00")).to.equal("readable");
	});

	// WCAG relative luminance, around the 2:1 line the module draws.
	it("draws the 2:1 line where WCAG's luminance puts it", function () {
		expect(hexPair("000000", "404040")).to.equal("readable"); // 2.03
		expect(hexPair("000000", "3A3A3A")).to.equal("hidden"); // 1.85
		expect(hexPair("777777", "FFFFFF")).to.equal("readable"); // 4.48
		expect(hexPair("000000", "0A0A0A")).to.equal("hidden"); // 1.06
		expect(hexPair("000000", "0000FF")).to.equal("readable"); // 2.44
		expect(hexPair("0000FF", "000000")).to.equal("readable");
	});
});
