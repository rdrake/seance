import {expect} from "chai";
import sinon from "sinon";
import {PendingSwitches} from "../../client/js/helpers/pendingSwitches";

describe("pending switches (helpers/pendingSwitches.ts)", function () {
	let clock: sinon.SinonFakeTimers;
	let umodes: string;
	let changes: number;
	let switches: PendingSwitches;
	const has = (letter: string) => umodes.includes(letter);

	beforeEach(function () {
		clock = sinon.useFakeTimers();
		umodes = "o";
		changes = 0;
		switches = new PendingSwitches(4000, () => changes++);
	});

	afterEach(function () {
		switches.dispose();
		clock.restore();
	});

	it("shows the real mode when nothing was asked", function () {
		expect(switches.shown("I", has("I"))).to.equal(false);
		expect(switches.shown("o", has("o"))).to.equal(true);
	});

	it("holds the asked-for state until the server's MODE matches it", function () {
		switches.request("I", true);
		expect(changes).to.equal(1);
		expect(switches.shown("I", has("I"))).to.equal(true);
		umodes = "oI";
		switches.reconcile(has);
		expect(switches.isPending("I")).to.equal(false);
		expect(switches.shown("I", has("I"))).to.equal(true);
		expect(clock.countTimers()).to.equal(0);
	});

	it("goes back to the real mode when the server refuses in silence", function () {
		switches.request("I", true);
		clock.tick(3999);
		expect(switches.shown("I", has("I"))).to.equal(true);
		clock.tick(1);
		expect(switches.shown("I", has("I"))).to.equal(false);
		expect(changes).to.equal(2);
	});

	it("keeps waiting through an unrelated mode change", function () {
		switches.request("I", true);
		umodes = "ow";
		switches.reconcile(has);
		expect(switches.isPending("I")).to.equal(true);
		expect(changes).to.equal(1);
	});

	it("works for switching a mode off", function () {
		umodes = "oI";
		switches.request("I", false);
		expect(switches.shown("I", has("I"))).to.equal(false);
		clock.tick(4000); // refused: still on
		expect(switches.shown("I", has("I"))).to.equal(true);
	});

	it("a second tap restarts the wait with the new state", function () {
		switches.request("I", true);
		clock.tick(3000);
		switches.request("I", false);
		clock.tick(3000);
		expect(switches.shown("I", true)).to.equal(false);
		clock.tick(1000);
		expect(switches.isPending("I")).to.equal(false);
	});
});
