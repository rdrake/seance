import {expect} from "chai";
import {
	describeThemePairs,
	effectiveTheme,
	themePartner,
	THEME_PAIRS,
} from "../../client/js/helpers/themeAppearance";

describe("themeAppearance", function () {
	it("pairs each light theme with its dark one, both ways", function () {
		for (const [a, b] of [
			["coffee", "creama"],
			["cobalt", "frost"],
			["princess_", "princess"],
			["keeki", "keekiblush"],
			["morning", "day"],
		]) {
			expect(themePartner(a)).to.equal(b);
			expect(themePartner(b)).to.equal(a);
		}

		expect(themePartner("molokai")).to.equal(null);
	});

	it("shows the chosen theme when not following the system", function () {
		expect(effectiveTheme("coffee", false, false)).to.equal("coffee");
		expect(effectiveTheme("creama", false, true)).to.equal("creama");
	});

	it("swaps to the partner whose mode matches the system", function () {
		expect(effectiveTheme("coffee", true, true)).to.equal("coffee");
		expect(effectiveTheme("coffee", true, false)).to.equal("creama");
		expect(effectiveTheme("creama", true, true)).to.equal("coffee");
		expect(effectiveTheme("frost", true, true)).to.equal("cobalt");
		expect(effectiveTheme("princess_", true, false)).to.equal("princess");
		expect(effectiveTheme("day", true, true)).to.equal("morning");
		expect(effectiveTheme("keeki", true, false)).to.equal("keekiblush");
		expect(effectiveTheme("keekiblush", true, true)).to.equal("keeki");
	});

	it("names every pair in the settings hint, dark first", function () {
		const label = (name: string) => name.charAt(0).toUpperCase() + name.slice(1);
		expect(describeThemePairs(label)).to.equal(
			"Coffee/Creama, Cobalt/Frost, Princess_/Princess, Keeki/Keekiblush and Morning/Day"
		);
		expect(THEME_PAIRS).to.have.length(5);
	});

	it("leaves a theme without a partner alone", function () {
		expect(effectiveTheme("molokai", true, false)).to.equal("molokai");
		expect(effectiveTheme("gates", true, true)).to.equal("gates");
	});
});
