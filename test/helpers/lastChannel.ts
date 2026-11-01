import {expect} from "chai";
import {ChanType} from "../../shared/types/chan";
import {
	STORAGE_KEY,
	beginLanding,
	cancelLanding,
	channelOpened,
	forgetIfLastChannel,
	forgetLastChannel,
	getLastChannel,
	matchesLanding,
	pendingLanding,
	rememberLastChannel,
	takeLanding,
	useStorageBackend,
} from "../../client/js/helpers/lastChannel";

describe("last opened channel (helpers/lastChannel.ts)", function () {
	let store: Map<string, string>;

	beforeEach(function () {
		store = new Map<string, string>();
		useStorageBackend({
			get: (key) => store.get(key) ?? null,
			set: (key, value) => void store.set(key, value),
			remove: (key) => void store.delete(key),
		});
		cancelLanding();
	});

	afterEach(function () {
		useStorageBackend(null);
		cancelLanding();
	});

	it("remembers nothing until a conversation is opened", function () {
		expect(getLastChannel()).to.equal(null);
		expect(beginLanding("net-1")).to.equal(null);
		expect(pendingLanding()).to.equal(null);
	});

	it("remembers the conversation by network uuid and name, across reads", function () {
		rememberLastChannel("net-1", "#seance");

		expect(getLastChannel()).to.deep.equal({network: "net-1", target: "#seance"});
		expect(store.get(STORAGE_KEY)).to.equal(
			JSON.stringify({network: "net-1", target: "#seance"})
		);

		rememberLastChannel("net-1", "bob");
		expect(getLastChannel()).to.deep.equal({network: "net-1", target: "bob"});

		forgetLastChannel();
		expect(getLastChannel()).to.equal(null);
		expect(store.has(STORAGE_KEY)).to.equal(false);
	});

	it("forgets the remembered conversation when it is closed, and only that one", function () {
		rememberLastChannel("net-1", "Bob");

		forgetIfLastChannel("net-2", "bob");
		forgetIfLastChannel("net-1", "carol");
		expect(getLastChannel()).to.deep.equal({network: "net-1", target: "Bob"});

		forgetIfLastChannel("net-1", "bob");
		expect(getLastChannel()).to.equal(null);
	});

	it("ignores an empty network or target, and a stored value it cannot read", function () {
		rememberLastChannel("", "#seance");
		rememberLastChannel("net-1", "");
		expect(store.has(STORAGE_KEY)).to.equal(false);

		store.set(STORAGE_KEY, "{not json");
		expect(getLastChannel()).to.equal(null);

		store.set(STORAGE_KEY, JSON.stringify({network: 5}));
		expect(getLastChannel()).to.equal(null);

		store.set(STORAGE_KEY, JSON.stringify(["net-1", "#seance"]));
		expect(getLastChannel()).to.equal(null);
	});

	it("keeps its key, and reads only a whole record", function () {
		expect(STORAGE_KEY).to.equal("thelounge.state.lastChannel");
		expect(getLastChannel()).to.equal(null);

		for (const value of [
			null,
			"x",
			{network: "net-1"},
			{network: "net-1", target: ""},
			{network: "net-1", target: 5},
			{network: "", target: "#seance"},
			{network: 5, target: "#seance"},
		]) {
			store.set(STORAGE_KEY, JSON.stringify(value));
			expect(getLastChannel(), JSON.stringify(value)).to.equal(null);
		}

		store.set(STORAGE_KEY, JSON.stringify({network: "net-1", target: "#seance", x: 1}));
		expect(getLastChannel()).to.deep.equal({network: "net-1", target: "#seance"});
	});

	it("channelOpened remembers channels and queries, never the lobby or a special window", function () {
		channelOpened("net-1", "SeanceDev", ChanType.LOBBY);
		expect(getLastChannel()).to.equal(null);

		channelOpened("net-1", "#seance", ChanType.CHANNEL);
		expect(getLastChannel()).to.deep.equal({network: "net-1", target: "#seance"});

		channelOpened("net-1", "Channel List", ChanType.SPECIAL);
		channelOpened("net-1", "SeanceDev", ChanType.LOBBY);
		expect(getLastChannel()).to.deep.equal({network: "net-1", target: "#seance"});

		channelOpened("net-1", "bob", ChanType.QUERY);
		expect(getLastChannel()).to.deep.equal({network: "net-1", target: "bob"});
	});

	describe("landing", function () {
		it("begins only on the network the conversation is remembered on", function () {
			rememberLastChannel("net-1", "#seance");

			expect(beginLanding("net-2")).to.equal(null);
			expect(pendingLanding()).to.equal(null);

			expect(beginLanding("net-1")).to.deep.equal({network: "net-1", target: "#seance"});
			expect(pendingLanding()).to.deep.equal({network: "net-1", target: "#seance"});
			expect(pendingLanding("net-1")).to.deep.equal({network: "net-1", target: "#seance"});
			expect(pendingLanding("net-2")).to.equal(null);
		});

		it("matches the arriving conversation case-insensitively, on its own network only", function () {
			rememberLastChannel("net-1", "#Seance");
			beginLanding("net-1");

			expect(matchesLanding("net-1", "#seance")).to.equal(true);
			expect(matchesLanding("net-2", "#seance")).to.equal(false);
			expect(matchesLanding("net-1", "#other")).to.equal(false);
			// Matching does not consume it.
			expect(matchesLanding("net-1", "#SEANCE")).to.equal(true);
		});

		it("is taken once", function () {
			rememberLastChannel("net-1", "#seance");
			beginLanding("net-1");

			expect(takeLanding()).to.deep.equal({network: "net-1", target: "#seance"});
			expect(takeLanding()).to.equal(null);
			expect(pendingLanding()).to.equal(null);
			expect(matchesLanding("net-1", "#seance")).to.equal(false);
		});

		it("is called off when the user opens another conversation first — the lobby is not that", function () {
			rememberLastChannel("net-1", "#seance");
			beginLanding("net-1");

			// The automatic switch while the network connects.
			channelOpened("net-1", "SeanceDev", ChanType.LOBBY);
			channelOpened("net-2", "OtherNet", ChanType.LOBBY);
			expect(pendingLanding()).to.not.equal(null);

			channelOpened("net-1", "#other", ChanType.CHANNEL);
			expect(pendingLanding()).to.equal(null);
			expect(getLastChannel()).to.deep.equal({network: "net-1", target: "#other"});
		});

		it("is called off by a conversation opened on another network too", function () {
			rememberLastChannel("net-1", "#seance");
			beginLanding("net-1");

			channelOpened("net-2", "#elsewhere", ChanType.CHANNEL);
			expect(pendingLanding()).to.equal(null);
		});

		it("landing on the remembered conversation keeps it remembered", function () {
			rememberLastChannel("net-1", "#seance");
			beginLanding("net-1");
			takeLanding();

			channelOpened("net-1", "#seance", ChanType.CHANNEL);
			expect(getLastChannel()).to.deep.equal({network: "net-1", target: "#seance"});
			expect(pendingLanding()).to.equal(null);
		});

		it("begins again for a network that comes up again (a later connect reads the current memory)", function () {
			rememberLastChannel("net-1", "#seance");
			beginLanding("net-1");
			takeLanding();
			rememberLastChannel("net-1", "#later");

			expect(beginLanding("net-1")).to.deep.equal({network: "net-1", target: "#later"});
		});
	});
});
