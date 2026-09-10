import {expect} from "chai";
import sinon from "sinon";
import {
	SETTLE_MAX_MS,
	SETTLE_POLL_MS,
	SETTLE_QUIET_MS,
	createViewportSizer,
	type ViewportEnv,
} from "../../client/js/helpers/viewport";

function fakeEnv(overrides: Partial<ViewportEnv> = {}) {
	const state = {height: 800, innerHeight: 800, offsetTop: 0, scrollY: 0, focused: true};
	const published: number[] = [];
	const scrollToTop = sinon.spy();
	const dropFocus = sinon.spy();

	const env: ViewportEnv = {
		height: () => state.height,
		innerHeight: () => state.innerHeight,
		textFieldFocused: () => state.focused,
		offsetTop: () => state.offsetTop,
		scrollY: () => state.scrollY,
		publish: (px) => void published.push(px),
		scrollToTop,
		dropFocus,
		dismissesKeyboardOnHide: true,
		...overrides,
	};

	return {
		env,
		state,
		published,
		scrollToTop,
		dropFocus,
		last: () => published[published.length - 1],
	};
}

describe("visual viewport sizing (helpers/viewport.ts)", function () {
	let clock: sinon.SinonFakeTimers;

	beforeEach(function () {
		clock = sinon.useFakeTimers();
	});

	afterEach(function () {
		clock.restore();
	});

	it("re-reads until the height holds still, then stops", function () {
		const {env, state, published, last} = fakeEnv();
		const sizer = createViewportSizer(env);

		state.height = 780;
		sizer.settle();

		for (const h of [720, 640, 560, 500]) {
			state.height = h;
			clock.tick(SETTLE_POLL_MS);
		}

		clock.tick(SETTLE_MAX_MS);
		expect(last()).to.equal(500);
		expect(published.length).to.equal(5 + SETTLE_QUIET_MS / SETTLE_POLL_MS);
	});

	it("gives up after SETTLE_MAX_MS on a height that never holds still", function () {
		const {env, state, published} = fakeEnv();
		const sizer = createViewportSizer(env);

		sizer.settle();

		for (let t = 0; t < SETTLE_MAX_MS * 2; t += SETTLE_POLL_MS) {
			state.height -= 1;
			clock.tick(SETTLE_POLL_MS);
		}

		expect(published.length).to.equal(1 + SETTLE_MAX_MS / SETTLE_POLL_MS);
	});

	it("scrolls back to the top when iOS scrolled the header away", function () {
		const {env, state, scrollToTop} = fakeEnv();
		const sizer = createViewportSizer(env);

		sizer.apply();
		expect(scrollToTop.called).to.equal(false);

		state.offsetTop = 40;
		sizer.apply();
		expect(scrollToTop.callCount).to.equal(1);
	});

	it("drops the composer's focus on iOS as the page goes to the background", function () {
		const {env, dropFocus} = fakeEnv();

		createViewportSizer(env).hidden();
		expect(dropFocus.callCount).to.equal(1);
	});

	it("leaves focus alone elsewhere", function () {
		const {env, dropFocus} = fakeEnv({dismissesKeyboardOnHide: false});

		createViewportSizer(env).hidden();
		expect(dropFocus.called).to.equal(false);
	});

	it("takes the layout viewport when nothing is focused and the visual one is stuck", function () {
		// iOS 27 after an app switch: visualViewport.height stays at the
		// keyboard-up 400 while innerHeight is back at 793.
		const {env, state, last} = fakeEnv();
		const sizer = createViewportSizer(env);

		state.height = 400;
		state.innerHeight = 793;
		state.focused = false;
		sizer.visible();
		clock.tick(SETTLE_MAX_MS);

		expect(last()).to.equal(793);
	});

	it("trusts the visual viewport while a text field has focus", function () {
		// iOS before 27 keeps innerHeight at full height under the keyboard.
		const {env, state} = fakeEnv();

		state.height = 424;
		state.innerHeight = 793;
		expect(createViewportSizer(env).apply()).to.equal(424);
	});
});
