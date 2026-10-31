import {expect} from "chai";
import {defaultFontSizeOn} from "../../client/js/helpers/platformDefaults";
import {
	defaultFontSize,
	fontSizeIndex,
	fontSizeScale,
	fontSizes,
	normalizeFontSize,
} from "../../client/js/helpers/fontSize";

// The scale itself is the contract: Appearance.vue's slider maps positions to
// names through this module, settings.ts normalizes whatever localStorage
// held, and style.css keys the root font-size off the names.
describe("fontSize", () => {
	it("is an ordered scale, large being the default", () => {
		expect(fontSizes).to.deep.equal(["tiny", "small", "medium", "large", "xlarge", "huge"]);
		expect(defaultFontSize).to.equal("large");
	});

	it("grows monotonically through medium = the browser default", () => {
		expect(fontSizeScale.medium).to.equal(100);

		for (let i = 1; i < fontSizes.length; i++) {
			expect(fontSizeScale[fontSizes[i]]).to.be.greaterThan(fontSizeScale[fontSizes[i - 1]]);
		}
	});

	it("passes values on the scale through", () => {
		for (const size of fontSizes) {
			expect(normalizeFontSize(size)).to.equal(size);
		}
	});

	it("turns anything else into the default", () => {
		expect(normalizeFontSize("gigantic")).to.equal(defaultFontSize);
		expect(normalizeFontSize("")).to.equal(defaultFontSize);
		expect(normalizeFontSize(undefined)).to.equal(defaultFontSize);
		expect(normalizeFontSize(null)).to.equal(defaultFontSize);
		expect(normalizeFontSize(14)).to.equal(defaultFontSize);
	});

	it("maps values to slider positions, unknowns to the default's", () => {
		expect(fontSizeIndex("tiny")).to.equal(0);
		expect(fontSizeIndex("huge")).to.equal(fontSizes.length - 1);
		expect(fontSizeIndex("nonsense")).to.equal(fontSizes.indexOf(defaultFontSize));
	});
});

describe("defaultFontSizeOn", function () {
	it("starts a desktop window at the browser's own size, and the rest at large", function () {
		for (const platform of ["macos", "windows", "linux"] as const) {
			expect(defaultFontSizeOn(platform)).to.equal("medium");
		}

		for (const platform of ["web", "ios", "android"] as const) {
			expect(defaultFontSizeOn(platform)).to.equal("large");
		}
	});
});
