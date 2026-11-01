import {expect} from "chai";
import {
	DEFAULT_REACTIONS,
	MAX_RECENT,
	mergeRecent,
	QUICK_REACTIONS,
	quickReactions,
	RECENTS_CHANGED,
	recentReactions,
	rememberReaction,
	STORAGE_KEY,
	useStorageBackend,
} from "../../client/js/helpers/reactionRecents";
import eventbus from "../../client/js/eventbus";
import {MAX_REACTION_LENGTH} from "../../client/js/helpers/emoji";

describe("recently used reactions (helpers/reactionRecents.ts)", function () {
	let store: Map<string, string>;

	beforeEach(function () {
		store = new Map<string, string>();
		useStorageBackend({
			get: (key) => store.get(key) ?? null,
			set: (key, value) => void store.set(key, value),
			remove: (key) => void store.delete(key),
		});
	});

	afterEach(function () {
		useStorageBackend(null);
	});

	it("has defaults to show before anything has been used", function () {
		expect(recentReactions()).to.be.empty;
		expect(DEFAULT_REACTIONS).to.include("👍");
	});

	it("puts the newest first, without repeating one", function () {
		expect(mergeRecent(["👍", "🎉"], "🎉")).to.deep.equal(["🎉", "👍"]);
		expect(mergeRecent(["👍"], "lol")).to.deep.equal(["lol", "👍"]);
		expect(mergeRecent([], "👍")).to.deep.equal(["👍"]);
	});

	it("forgets the oldest once it is full", function () {
		const full = Array.from({length: MAX_RECENT}, (_, i) => `r${i}`);
		const merged = mergeRecent(full, "new");

		expect(merged).to.have.lengthOf(MAX_RECENT);
		expect(merged[0]).to.equal("new");
		expect(merged).to.not.include(`r${MAX_RECENT - 1}`);
	});

	it("remembers reactions across reads, words as well as emoji", function () {
		rememberReaction("👍");
		rememberReaction("lol");
		rememberReaction("🎉🎉🎉");
		rememberReaction("👍");

		expect(recentReactions()).to.deep.equal(["👍", "🎉🎉🎉", "lol"]);
		expect(store.get(STORAGE_KEY)).to.equal(JSON.stringify(["👍", "🎉🎉🎉", "lol"]));
	});

	it("ignores an empty reaction", function () {
		rememberReaction("");
		expect(store.has(STORAGE_KEY)).to.equal(false);
	});

	it("drops a stored list it cannot read", function () {
		store.set(STORAGE_KEY, "{not json");
		expect(recentReactions()).to.be.empty;
		expect(store.has(STORAGE_KEY)).to.equal(false);
	});

	it("skips entries that are not usable reactions", function () {
		store.set(STORAGE_KEY, JSON.stringify(["👍", 42, "", null, "🎉".repeat(500)]));
		expect(recentReactions()).to.deep.equal(["👍"]);
	});

	it("offers the newest single emoji as quick reactions, topped up from the defaults", function () {
		expect(quickReactions([])).to.deep.equal(DEFAULT_REACTIONS.slice(0, QUICK_REACTIONS));

		rememberReaction("🔥");
		rememberReaction("lol");
		rememberReaction("🎉🎉🎉");
		rememberReaction("👀");

		expect(quickReactions()).to.deep.equal(["👀", "🔥", "👍"]);
	});

	it("never repeats a quick reaction that is also a default", function () {
		expect(quickReactions(["👍", "❤️"])).to.deep.equal(["👍", "❤️", "😂"]);
	});

	it("announces the new list on the event bus", function () {
		const seen: string[][] = [];
		const handler = (list: string[]) => void seen.push(list);
		eventbus.on(RECENTS_CHANGED, handler);

		try {
			rememberReaction("👍");
			rememberReaction("");
			rememberReaction("❤️");
		} finally {
			eventbus.off(RECENTS_CHANGED, handler);
		}

		expect(seen).to.deep.equal([["👍"], ["❤️", "👍"]]);
	});

	it("keeps its names and defaults as other builds know them", function () {
		expect(STORAGE_KEY).to.equal("thelounge.reactions.recent");
		expect(RECENTS_CHANGED).to.equal("reactions:recent");
		expect(DEFAULT_REACTIONS).to.deep.equal(["👍", "❤️", "😂", "🎉", "😮", "😢", "🔥", "👀"]);
	});

	it(`reads at most ${MAX_RECENT} stored reactions`, function () {
		store.set(
			STORAGE_KEY,
			JSON.stringify(Array.from({length: MAX_RECENT + 4}, (_, i) => `r${i}`))
		);
		const list = recentReactions();
		expect(list).to.have.length(MAX_RECENT);
		expect(list[0]).to.equal("r0");
	});

	it(`keeps a reaction of exactly ${MAX_REACTION_LENGTH} characters, not one more`, function () {
		const at = "a".repeat(MAX_REACTION_LENGTH);
		store.set(STORAGE_KEY, JSON.stringify([at, `${at}a`]));
		expect(recentReactions()).to.deep.equal([at]);
	});

	it("leaves an empty stored value alone", function () {
		store.set(STORAGE_KEY, "");
		expect(recentReactions()).to.deep.equal([]);
		expect(store.get(STORAGE_KEY)).to.equal("");
	});
});
