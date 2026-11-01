import {expect} from "chai";
import {
	appendReaction,
	emojiForName,
	EmojiGroup,
	expandShortcodes,
	flatten,
	isEmojiOnly,
	isSingleEmoji,
	loadEmojiCatalog,
	MAX_REACTION_LENGTH,
	normalizeReaction,
	searchEmoji,
} from "../../client/js/helpers/emoji";

describe("emoji catalog and reaction text (helpers/emoji.ts)", function () {
	let catalog: EmojiGroup[];

	before(async function () {
		catalog = await loadEmojiCatalog();
	});

	describe("the catalog", function () {
		it("is the nine unicode groups, each with a tab icon and entries", function () {
			expect(catalog.map((group) => group.key)).to.deep.equal([
				"smileys",
				"people",
				"nature",
				"food",
				"activities",
				"places",
				"objects",
				"symbols",
				"flags",
			]);

			for (const group of catalog) {
				expect(group.label, group.key).to.be.a("string").and.not.empty;
				expect(group.icon, group.key).to.be.a("string").and.not.empty;
				expect(group.emoji.length, group.key).to.be.above(0);
			}
		});

		it("is loaded once and handed to every caller", async function () {
			const again = await loadEmojiCatalog();

			expect(again).to.be.an("array").with.lengthOf(9);
			expect(again).to.equal(catalog);
		});

		it("is fetched by the first caller and shared by the ones after", async function () {
			// A fresh copy of the module, so its memo starts empty.
			const path = require.resolve("../../client/js/helpers/emoji");
			const kept = require.cache[path];
			delete require.cache[path];
			// eslint-disable-next-line @typescript-eslint/no-var-requires
			const fresh = require(path) as typeof import("../../client/js/helpers/emoji");
			require.cache[path] = kept;

			const first = fresh.loadEmojiCatalog();
			const second = fresh.loadEmojiCatalog();

			expect(first).to.be.an.instanceOf(Promise);
			expect(second).to.equal(first);

			const groups = await first;
			expect(groups).to.be.an("array").with.lengthOf(9);
			expect(groups.map((group) => group.key)).to.deep.equal(
				catalog.map((group) => group.key)
			);
		});

		it("gives every entry a name, a description and a lowercase haystack", function () {
			const entries = flatten(catalog);
			expect(entries.length).to.be.above(1500);

			for (const entry of entries) {
				expect(entry.name, entry.emoji).to.match(/^[a-z0-9_+-]+$/);
				expect(entry.description, entry.emoji).to.be.a("string").and.not.empty;
				expect(entry.haystack, entry.emoji).to.equal(entry.haystack.toLowerCase());
				expect(entry.haystack, entry.emoji).to.include(` ${entry.name} `);
			}
		});
	});

	describe("searching", function () {
		const first = (query: string) => searchEmoji(catalog, query)[0]?.emoji;

		it("puts the emoji whose name was typed first", function () {
			expect(first("tada")).to.equal("🎉");
			expect(first("thumbsup")).to.equal("👍");
			expect(first("sweat_smile")).to.equal("😅");
		});

		it("reads a shortcode, spaces and capitals as the same query", function () {
			expect(first(":tada:")).to.equal("🎉");
			expect(first("Sweat Smile")).to.equal("😅");
			expect(first("  tada  ")).to.equal("🎉");
		});

		it("matches descriptions and keywords, and needs every word to match", function () {
			expect(first("party popper")).to.equal("🎉");
			expect(searchEmoji(catalog, "smiling")).to.not.be.empty;
			expect(searchEmoji(catalog, "tada nonsense")).to.be.empty;
		});

		it("knows an exact alias from a word that merely starts one", function () {
			// What the picker highlights first hangs off this: `tada` names an
			// emoji, `lol` is a word that happens to prefix `lollipop`.
			expect(emojiForName("tada")).to.equal("🎉");
			expect(emojiForName(":tada:")).to.equal("🎉");
			expect(emojiForName("  TADA ")).to.equal("🎉");
			expect(emojiForName("+1")).to.equal("👍");
			expect(emojiForName("lol")).to.be.undefined;
			expect(emojiForName("")).to.be.undefined;
			expect(emojiForName("::tada::")).to.equal("🎉");
			expect(emojiForName("ta:da")).to.be.undefined;
			expect(first("lol")).to.equal("🍭");
		});

		it("finds an emoji that was pasted in", function () {
			expect(first("🎉")).to.equal("🎉");
		});

		it("returns nothing for an empty query and honours the limit", function () {
			expect(searchEmoji(catalog, "")).to.be.empty;
			expect(searchEmoji(catalog, "   ")).to.be.empty;
			expect(searchEmoji(catalog, "face", 5)).to.have.lengthOf(5);
		});
	});

	describe("ranking", function () {
		const entry = (emoji: string, name: string, description: string) => ({
			emoji,
			name,
			description,
			keywords: "",
			haystack: ` ${name} ${description} `.toLowerCase(),
		});
		const rank = (entries: ReturnType<typeof entry>[], query: string) =>
			searchEmoji([{key: "test", label: "Test", icon: "x", emoji: entries}], query).map(
				(hit) => hit.emoji
			);

		it("ranks the whole query typed as a name above a closer word-by-word match", function () {
			// Word by word, "sweaty" (2 + 4) ties "sweat_smile" (2 + 4) and comes
			// first in the catalog; the whole query naming "sweat_smile" lifts it.
			const entries = [entry("C", "sweaty", "unsmiled"), entry("B", "sweat_smile", "grin")];

			expect(rank(entries, "sweat smile")).to.deep.equal(["B", "C"]);
			expect(rank(entries, " Sweat  Smile ")).to.deep.equal(["B", "C"]);
			expect(rank(entries, "sweat-smile")).to.deep.equal(["B", "C"]);
		});

		it("ranks a name typed in full above a name merely started", function () {
			const entries = [entry("E", "firework", "hot"), entry("D", "fire", "hot")];

			expect(rank(entries, "fire hot")).to.deep.equal(["D", "E"]);
		});

		it("ranks the start of a word above a fragment of one", function () {
			const entries = [entry("G", "bbb", "bzap"), entry("F", "aaa", "zapper")];

			expect(rank(entries, "zap")).to.deep.equal(["F", "G"]);
		});

		it("keeps catalog order between equal matches", function () {
			const entries = ["1", "2", "3", "4"].map((n) => entry(n, `x${n}`, "qq"));

			expect(rank(entries, "qq")).to.deep.equal(["1", "2", "3", "4"]);
		});

		it("strips the colons around a query, not inside it", function () {
			expect(searchEmoji(catalog, "::tada::")[0]?.emoji).to.equal("🎉");
			expect(searchEmoji(catalog, "ta:da")).to.be.empty;
		});
	});

	describe("reaction text", function () {
		it("expands the shortcodes it knows and leaves the rest alone", function () {
			expect(expandShortcodes("look :tada: here")).to.equal("look 🎉 here");
			expect(expandShortcodes(":not_an_emoji:")).to.equal(":not_an_emoji:");
			expect(expandShortcodes("10:30:45")).to.equal("10:30:45");
		});

		it("normalises what was typed", function () {
			expect(normalizeReaction("  :tada: ")).to.equal("🎉");
			expect(normalizeReaction("so\t very  cool")).to.equal("so very cool");
			expect(normalizeReaction("   ")).to.equal("");
			expect(normalizeReaction("bell\u0007ringer")).to.equal("bell ringer");
		});

		it("cuts an over-long reaction on a code point boundary", function () {
			const long = "🎉".repeat(MAX_REACTION_LENGTH + 10);
			const cut = normalizeReaction(long);

			expect(Array.from(cut)).to.have.lengthOf(MAX_REACTION_LENGTH);
			expect(cut).to.equal("🎉".repeat(MAX_REACTION_LENGTH));
		});

		it("trims a cut that ends on a space", function () {
			const text = "a".repeat(MAX_REACTION_LENGTH - 1) + " and more";

			expect(normalizeReaction(text)).to.equal("a".repeat(MAX_REACTION_LENGTH - 1));
		});

		it("builds a reaction up one pick at a time", function () {
			// Emoji sit flush against each other — that is the point of it —
			// and anything with a word in it keeps its spaces.
			expect(appendReaction("", "🎉")).to.equal("🎉");
			expect(appendReaction("🎉", "🔥")).to.equal("🎉🔥");
			expect(appendReaction("🎉🔥", "👍")).to.equal("🎉🔥👍");
			expect(appendReaction("so", "cool")).to.equal("so cool");
			expect(appendReaction("🎉", "nice")).to.equal("🎉 nice");
			expect(appendReaction("nice", "🎉")).to.equal("nice 🎉");
			expect(appendReaction("so ", "cool")).to.equal("so cool");
			expect(appendReaction("so  ", "cool")).to.equal("so cool");
			expect(appendReaction("so very", "cool")).to.equal("so very cool");
			expect(appendReaction("🎉", "   ")).to.equal("🎉");
		});

		it("refuses an addition that would not fit, keeping what is there", function () {
			const full = "🎉".repeat(MAX_REACTION_LENGTH);

			expect(appendReaction(full, "🔥")).to.equal(full);
			expect(appendReaction("🎉".repeat(MAX_REACTION_LENGTH - 1), "🔥")).to.have.lengthOf(
				("🎉".repeat(MAX_REACTION_LENGTH - 1) + "🔥").length
			);
		});

		it("tells emoji from words, however many there are", function () {
			expect(isEmojiOnly("👍")).to.equal(true);
			expect(isEmojiOnly("🎉🎉🎉")).to.equal(true);
			expect(isEmojiOnly("👍 ❤️")).to.equal(true);
			expect(isEmojiOnly("lol")).to.equal(false);
			expect(isEmojiOnly("👍 nice")).to.equal(false);
			expect(isEmojiOnly("")).to.equal(false);
			expect(isEmojiOnly("   ")).to.equal(false);
		});

		it("knows one emoji from several", function () {
			expect(isSingleEmoji("👍")).to.equal(true);
			expect(isSingleEmoji(" ❤️ ")).to.equal(true);
			expect(isSingleEmoji("🇨🇦")).to.equal(true);
			expect(isSingleEmoji("👨‍👩‍👧")).to.equal(true);
			expect(isSingleEmoji("🎉🎉🎉")).to.equal(false);
			expect(isSingleEmoji("👍 ❤️")).to.equal(false);
			expect(isSingleEmoji("lol")).to.equal(false);
			expect(isSingleEmoji("")).to.equal(false);
			expect(isSingleEmoji("x👍")).to.equal(false);
		});
	});
});
