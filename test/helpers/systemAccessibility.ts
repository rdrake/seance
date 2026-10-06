import {expect} from "chai";
import {fromAndroidSettings} from "../../client/js/helpers/systemAccessibility";

describe("systemAccessibility", function () {
	describe("fromAndroidSettings", function () {
		const defaults = {highTextContrast: 0, contrast: 0, animatorDurationScale: 1};

		it("is neither at Android's defaults", function () {
			expect(fromAndroidSettings(defaults)).to.deep.equal({
				highContrast: false,
				reduceMotion: false,
			});
		});

		it("takes High contrast text as high contrast", function () {
			expect(fromAndroidSettings({...defaults, highTextContrast: 1}).highContrast).to.equal(
				true
			);
		});

		it("takes only the top Contrast step as high contrast, as Chromium does", function () {
			expect(fromAndroidSettings({...defaults, contrast: 1}).highContrast).to.equal(true);
			expect(fromAndroidSettings({...defaults, contrast: 0.5}).highContrast).to.equal(false);
			expect(fromAndroidSettings({...defaults, contrast: -1}).highContrast).to.equal(false);
		});

		it("takes only Remove animations (scale 0) as reduced motion", function () {
			expect(
				fromAndroidSettings({...defaults, animatorDurationScale: 0}).reduceMotion
			).to.equal(true);
			expect(
				fromAndroidSettings({...defaults, animatorDurationScale: 0.5}).reduceMotion
			).to.equal(false);
		});
	});
});
