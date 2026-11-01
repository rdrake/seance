import {expect} from "chai";
import {isPlatform, PLATFORM_DEFAULTS} from "../../client/js/helpers/platformDefaults";

describe("platform defaults (helpers/platformDefaults.ts)", function () {
	it("knows the three platforms and nothing else", function () {
		for (const platform of ["web", "ios", "android"]) {
			expect(isPlatform(platform), platform).to.equal(true);
		}

		for (const value of ["", "Web", "macos", undefined, null, 1]) {
			expect(isPlatform(value), String(value)).to.equal(false);
		}
	});

	it("follows the system in the shells only", function () {
		for (const name of ["matchSystemTextSize", "matchSystemAppearance"]) {
			expect(PLATFORM_DEFAULTS[name]("web"), name).to.equal(false);
			expect(PLATFORM_DEFAULTS[name]("ios"), name).to.equal(true);
			expect(PLATFORM_DEFAULTS[name]("android"), name).to.equal(true);
		}
	});
});
