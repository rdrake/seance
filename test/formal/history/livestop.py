#!/usr/bin/env python3
"""Live-stop fixture and control for Seance's reconnect catch-up (D27, after
HISTORY-REVIEW-5).  Builds a mocha file from the target checkout's own
test/irc/history.ts harness (everything before its first describe), runs it
there, and prints one JSON line per case: the CHATHISTORY requests sent, the
rows the catch-up delivered, live rows, and historyFilled.

  livestop.py CHECKOUT [OUT.jsonl]

The checkout must have been built (pnpm build) and installed.  The generated
file is removed afterwards; nothing in the checkout is changed.
"""
import json, os, subprocess, sys

FIXTURE = r'''
describe("formal/history live-stop fixture", function () {
	beforeEach(function () {
		installSpy();
		clock = sinon.useFakeTimers({now: new Date("2026-08-25T12:00:00.000Z"), toFake: ["setTimeout", "clearTimeout", "Date"]});
	});
	afterEach(function () {
		clock.restore();
		removeSpy();
	});

	const ISUP = "CHATHISTORY=2 MSGREFTYPES=timestamp,msgid";
	const at = (m: string) => `2026-08-25T12:${m}:00.000Z`;
	const line = (id: string, m: string, nick = "bob") =>
		`@time=${at(m)};msgid=${id} :${nick}!${nick}@host PRIVMSG #seance :${id}`;

	function reconnect(h: Harness): string[] {
		h.transport.closed();
		dispatch.resetHistory();
		h.client.connect();
		h.transport.open();
		h.transport.line("@time=x :irc.test CAP * LS :draft/chathistory=100 labeled-response batch message-tags server-time");
		const req = h.transport.sent.find((l, i) => i >= h.transport.sent.length - 4 && l.startsWith("CAP REQ :"));
		h.transport.line(`:irc.test CAP alice ACK :${(req as string).slice("CAP REQ :".length)}`);
		h.transport.lines(
			":irc.test 001 alice :Welcome back",
			`:irc.test 005 alice CHANTYPES=#& PREFIX=(ov)@+ CHANMODES=b,k,l,imnpst CASEMAPPING=rfc1459 ${ISUP} :are supported by this server`,
			":irc.test 422 alice :MOTD File is missing"
		);
		h.sent();
		h.transport.lines(
			"@time=2026-08-25T12:30:00.000Z;msgid=join-2 :alice!alice@host JOIN #seance",
			":irc.test 353 alice = #seance :@alice bob",
			":irc.test 366 alice #seance :End of /NAMES list."
		);
		return h.sent();
	}

	function record(name: string, h: Harness, requests: string[]): void {
		const all = payloads<MsgPayload>("msg");
		const rows = (replay: boolean) => all.filter((p) => !!p.replay === replay && p.msg.msgid && !p.msg.msgid.startsWith("join"))
			.map((p) => ({id: p.msg.msgid, time: new Date(p.msg.time).toISOString()}));
		console.log("LIVESTOP " + JSON.stringify({
			name,
			requests: requests.filter((l) => l.includes("CHATHISTORY")).map((l) => l.replace(/^@label=[^ ]+ /, "")),
			replayed: rows(true),
			live: rows(false),
			historyFilled: h.client.findChannel("#seance")!.historyFilled,
		}));
	}

	for (const relayFirst of [true, false]) {
		const name = relayFirst ? "liveStop" : "liveStopControl";
		it(name, function () {
			const h = setup({isupport: ISUP, chathistory: true});
			joined(h);
			h.transport.line(line("h", "10"));        // held before the reconnect
			const requests: string[] = [];
			let sent = reconnect(h);
			requests.push(...sent);
			if (relayFirst) h.transport.line(line("l", "31", "carol"));   // RelayLive before the page
			reply(h, sent, [line("b", "16"), line("l", "31", "carol")]);   // SrvAnswer LATEST, no end tag
			sent = h.sent();
			requests.push(...sent);
			if (sent.some((l) => l.includes("CHATHISTORY"))) {
				reply(h, sent, [line("h", "10"), line("a", "12")]);
				requests.push(...h.sent());
			}
			if (!relayFirst) h.transport.line(line("l", "31", "carol"));  // RelayLive after the walk
			record(name, h, requests);
		});
	}
});
'''

def main():
    co = os.path.abspath(sys.argv[1])
    out = sys.argv[2] if len(sys.argv) > 2 else None
    src = open(os.path.join(co, "test/irc/history.ts")).read()
    harness = src[:src.index("\ndescribe(")]
    gen = os.path.join(co, "test/irc/zz-formal-livestop.ts")
    open(gen, "w").write(harness + "\n" + FIXTURE)
    try:
        p = subprocess.run(["pnpm", "exec", "mocha", "--config=test/.mocharc.yml", gen],
                           cwd=co, env=dict(os.environ, NODE_ENV="test"), capture_output=True, text=True)
    finally:
        os.remove(gen)
    rows = [l[l.index("LIVESTOP ") + len("LIVESTOP "):] for l in p.stdout.splitlines() if "LIVESTOP {" in l]
    sha = subprocess.run(["git", "rev-parse", "--short=9", "HEAD"], cwd=co, capture_output=True, text=True).stdout.strip()
    recs = [dict(json.loads(r), sha=sha) for r in rows]
    if not recs:
        sys.stderr.write(p.stdout[-3000:] + p.stderr[-3000:])
        sys.exit(1)
    text = "".join(json.dumps(r) + "\n" for r in recs)
    if out:
        open(out, "w").write(text)
    sys.stdout.write(text)

main()
