import {expect} from "chai";
import type {IrcClient} from "../../client/js/irc/client";
import {MAX_LINE_BYTES, parseLine} from "../../client/js/irc/message";
import {
	dropQuietLine,
	fitsQuiet,
	quietLabel,
	sendQuiet,
	takeQuietLabel,
} from "../../client/js/irc/quiet";

/** Just what quiet.ts reads of a client. */
function stub(labeled = true): IrcClient & {sent: string[]} {
	const sent: string[] = [];
	return {
		sent,
		caps: {hasCapability: (name: string) => labeled && name === "labeled-response"},
		isSelf: (nick: string) => nick.toLowerCase() === "alice",
		send(text: string) {
			sent.push(text);
			return true;
		},
	} as unknown as IrcClient & {sent: string[]};
}

function line(raw: string) {
	return parseLine(raw)!;
}

describe("irc/quiet", function () {
	it("fits a line exactly as long as a quiet label leaves room for", function () {
		const room = MAX_LINE_BYTES - "@label=svc99999 ".length;

		expect(fitsQuiet("x".repeat(room))).to.equal(true);
		expect(fitsQuiet("x".repeat(room + 1))).to.equal(false);
	});

	it("sends plain, with nothing remembered, without labeled-response", function () {
		const client = stub(false);

		expect(quietLabel(client)).to.equal(undefined);
		sendQuiet(client, "PRIVMSG O3 :whois bob");
		expect(client.sent).to.deep.equal(["PRIVMSG O3 :whois bob"]);
	});

	it("labels what it sends and drops that line's echo and ACK", function () {
		const client = stub();

		sendQuiet(client, "PRIVMSG O3 :whois bob");
		sendQuiet(client, "PRIVMSG O3 :whois carol");
		expect(client.sent).to.deep.equal([
			"@label=svc1 PRIVMSG O3 :whois bob",
			"@label=svc2 PRIVMSG O3 :whois carol",
		]);
		const [first, second] = ["svc1", "svc2"];

		expect(
			dropQuietLine(client, line(`@label=${first} :alice!a@h PRIVMSG O3 :whois bob`))
		).to.equal(true);
		expect(dropQuietLine(client, line(`@label=${second} :irc.test ACK`))).to.equal(true);
		// Each label answers once.
		expect(dropQuietLine(client, line(`@label=${second} :irc.test ACK`))).to.equal(false);
	});

	it("drops our own NOTICE echo but not somebody else's line carrying the label", function () {
		const client = stub();
		const a = quietLabel(client)!;
		const b = quietLabel(client)!;

		expect(dropQuietLine(client, line(`@label=${a} :alice!a@h NOTICE O3 :x`))).to.equal(true);
		expect(dropQuietLine(client, line(`@label=${b} :bob!b@h PRIVMSG alice :x`))).to.equal(
			false
		);
	});

	it("shows a numeric carrying the label, and forgets the label", function () {
		const client = stub();
		const label = quietLabel(client)!;

		expect(
			dropQuietLine(client, line(`@label=${label} :irc.test 401 alice O3 :No such nick`))
		).to.equal(false);
		expect(takeQuietLabel(client, label)).to.equal(false);
	});

	it("keeps the label of a labeled batch's opener for its close", function () {
		const client = stub();
		const label = quietLabel(client)!;

		expect(
			dropQuietLine(client, line(`@label=${label} :irc.test BATCH +b labeled-response`))
		).to.equal(false);
		expect(takeQuietLabel(client, label)).to.equal(true);
	});

	it("remembers the newest 64 labels", function () {
		const client = stub();
		const labels = Array.from({length: 65}, () => quietLabel(client)!);

		expect(takeQuietLabel(client, labels[0])).to.equal(false);
		expect(takeQuietLabel(client, labels[1])).to.equal(true);
		expect(takeQuietLabel(client, labels[64])).to.equal(true);
	});

	it("knows no label on a client it never labeled for, nor an empty one", function () {
		expect(takeQuietLabel(stub(), "svc1")).to.equal(false);
		expect(takeQuietLabel(stub(), undefined)).to.equal(false);
	});
});
