import {expect} from "chai";

describe("prism-manual", () => {
	it("tells Prism to stay out of the page, keeping what the global already held", () => {
		const scope = globalThis as unknown as {Prism?: Record<string, unknown>};
		const had = "Prism" in scope;
		const before = scope.Prism;
		const path = require.resolve("../../../client/js/helpers/ircmessageparser/prism-manual");
		const kept = require.cache[path];

		scope.Prism = {plugins: "kept"};
		delete require.cache[path];

		try {
			require(path);

			expect(scope.Prism).to.deep.equal({
				plugins: "kept",
				manual: true,
				disableWorkerMessageHandler: true,
			});
		} finally {
			require.cache[path] = kept;

			if (had) {
				scope.Prism = before;
			} else {
				delete scope.Prism;
			}
		}
	});
});
