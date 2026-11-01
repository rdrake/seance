import {expect} from "chai";
import {appUrlFromScope, networkFromScope, pushScopePath} from "../../client/js/push/scope";

// A push-only service-worker registration lives at `<app>/push/<uuid>/`;
// the page builds that scope and the worker reads its network back from it.
describe("push scope — pushScopePath", () => {
	it("is the relative scope under the app base", () => {
		expect(pushScopePath("6f9c1e2a-1")).to.equal("push/6f9c1e2a-1/");
	});

	it("escapes anything that is not scope-safe", () => {
		expect(pushScopePath("a/b c")).to.equal("push/a%2Fb%20c/");
	});
});

describe("push scope — networkFromScope", () => {
	it("reads the uuid out of a push-only scope", () => {
		expect(networkFromScope("https://irc.example/push/6f9c1e2a-1/")).to.equal("6f9c1e2a-1");
		expect(networkFromScope("https://irc.example/seance/push/x/")).to.equal("x");
	});

	it("unescapes what pushScopePath escaped", () => {
		expect(networkFromScope("https://irc.example/push/a%2Fb%20c/")).to.equal("a/b c");
	});

	it("is undefined for the root registration and anything else", () => {
		expect(networkFromScope("https://irc.example/")).to.equal(undefined);
		expect(networkFromScope("https://irc.example/push/")).to.equal(undefined);
		expect(networkFromScope("https://irc.example/push/x")).to.equal(undefined);
		expect(networkFromScope("https://irc.example/push/x/y/")).to.equal(undefined);
	});
});

describe("push scope — appUrlFromScope", () => {
	it("strips the push suffix so deep links open the app", () => {
		expect(appUrlFromScope("https://irc.example/push/6f9c1e2a-1/")).to.equal(
			"https://irc.example/"
		);
		expect(appUrlFromScope("https://irc.example/seance/push/x/")).to.equal(
			"https://irc.example/seance/"
		);
	});

	it("leaves the root scope alone", () => {
		expect(appUrlFromScope("https://irc.example/seance/")).to.equal(
			"https://irc.example/seance/"
		);
	});
});

describe("push scope — edges", () => {
	it("leaves a scope that only looks pushed-to in the middle alone", () => {
		expect(appUrlFromScope("https://a.test/push/x/")).to.equal("https://a.test/");
		expect(appUrlFromScope("https://a.test/push/x/y/")).to.equal("https://a.test/push/x/y/");
		expect(appUrlFromScope("https://a.test/push/x/push/y/")).to.equal("https://a.test/push/x/");
	});

	it("reads nothing from a scope without the push tail", () => {
		expect(networkFromScope("https://a.test/push/")).to.equal(undefined);
		expect(networkFromScope("https://a.test/push/%E0%A4%A/")).to.equal(undefined);
	});
});
