#!/usr/bin/env python3
"""Catch-up fixtures for Seance's reconnect walk, checked with History.tla's
properties in Python (D27 approach, D30).  Each fixture is one whole-page model
schedule: held messages, a gap, pages answered, an optional live line.

  catchup_fixtures.py CHECKOUT [OUT.jsonl]

The mocha file is built from the checkout's own test/irc/history.ts harness
(everything before its first describe) and removed afterwards.  The store is
simulated with the checkout's own helpers/messageUpdates.ts insertMessage, fed
the channel's `msg` events in dispatch order.

Properties (History.tla, applied to the observation):
  Requests  the client's CHATHISTORY lines equal the model client's for this
            schedule (CQuery: LATEST, then BEFORE msgid=<oldest of the page>
            while no held msgid, no floor line, no end tag)
  NoLoss    every gap message is in the store
  NoDup     no msgid is in the store twice (NoDupLive)
  Order     server-stamped rows are in time order in the store
  IdsRise   (UI, not the model) row ids rise with row order: the unread marker
"""
import json, os, re, subprocess, sys

FIXTURE = r'''
import {insertMessage} from "../../client/js/helpers/messageUpdates";

describe("formal/history catch-up fixtures", function () {
	beforeEach(function () {
		installSpy();
		clock = sinon.useFakeTimers({now: new Date("2026-08-25T12:00:00.000Z"), toFake: ["setTimeout", "clearTimeout", "Date"]});
	});
	afterEach(function () {
		clock.restore();
		removeSpy();
	});

	const at = (m: string) => (m.includes(":") ? `2026-08-25T${m}:00.000Z` : `2026-08-25T12:${m}:00.000Z`);
	const line = (id: string, m: string, nick = "bob") =>
		`@time=${at(m)};msgid=${id} :${nick}!${nick}@host PRIVMSG #seance :${id}`;

	interface Fx {
		name: string;
		limit: number;
		held: [string, string][];
		pages: [string, string][][];
		live?: [string, string];
		liveWhen?: "beforePage" | "afterWalk";
		typedWhileDown?: boolean;
	}

	const FIXTURES: Fx[] = __FIXTURES__;

	function reconnect(h: Harness, isup: string, whileDown?: () => void): string[] {
		h.transport.closed();
		whileDown?.();
		h.client.connect();
		h.transport.open();
		h.transport.line("@time=x :irc.test CAP * LS :draft/chathistory=100 labeled-response batch message-tags server-time");
		const req = h.transport.sent.find((l, i) => i >= h.transport.sent.length - 4 && l.startsWith("CAP REQ :"));
		h.transport.line(`:irc.test CAP alice ACK :${(req as string).slice("CAP REQ :".length)}`);
		h.transport.lines(
			":irc.test 001 alice :Welcome back",
			`:irc.test 005 alice CHANTYPES=#& PREFIX=(ov)@+ CHANMODES=b,k,l,imnpst CASEMAPPING=rfc1459 ${isup} :are supported by this server`,
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

	for (const fx of FIXTURES) {
		it(fx.name, function () {
			const isup = `CHATHISTORY=${fx.limit} MSGREFTYPES=timestamp,msgid`;
			const h = setup({isupport: isup});
			const id = joined(h);
			const store: SharedMsg[] = [];
			let seen = 0;
			const sync = () => {
				const all = dispatch.getCalls().filter((c) => c.args[0] === "msg").map((c) => c.args[1] as MsgPayload);
				if (all.length < seen) seen = 0;
				for (const p of all.slice(seen)) if (p.chan === id) insertMessage(store, {...p.msg});
				seen = all.length;
			};
			for (const [mid, m] of fx.held) h.transport.line(line(mid, m));
			sync();
			const down = fx.typedWhileDown
				? () => {
						sync();
						clock.setSystemTime(new Date("2026-08-25T12:40:00.000Z"));
						socket.emit("input", {target: id, text: "anyone?"});
						sync();
					}
				: undefined;
			const requests: string[] = [];
			let sent = reconnect(h, isup, down);
			requests.push(...sent);
			const relay = () => h.transport.line(line(fx.live![0], fx.live![1], "carol"));
			if (fx.live && fx.liveWhen === "beforePage") relay();
			for (const page of fx.pages) {
				if (!sent.some((l) => l.includes("CHATHISTORY"))) break;
				reply(h, sent, page.map(([mid, m]) => line(mid, m)));
				sent = h.sent();
				requests.push(...sent);
			}
			if (fx.live && fx.liveWhen === "afterWalk") relay();
			sync();
			console.log("CATCHUP " + JSON.stringify({
				name: fx.name,
				requests: requests.filter((l) => l.includes("CHATHISTORY")).map((l) => l.replace(/^@label=[^ ]+ /, "")),
				store: store.filter((m) => !m.pending).map((m) => ({id: m.id, msgid: m.msgid ?? null, time: new Date(m.time).toISOString()})),
				historyFilled: h.client.findChannel("#seance")!.historyFilled,
			}));
		});
	}
});
'''

# Each fixture: the model schedule, and what History.tla's client does on it.
FIXTURES = [
    # #279: a live line relayed before LATEST's page, which also holds it.
    dict(name="liveStop", limit=2, held=[["h", "10"]], gap=["a", "b"],
         pages=[[["b", "16"], ["l", "31"]], [["h", "10"], ["a", "12"]]],
         live=["l", "31"], liveWhen="beforePage",
         expect=["CHATHISTORY LATEST #seance * 2", "CHATHISTORY BEFORE #seance msgid=b 2"],
         wire="Q S R C A C Q A C"),
    # control: the same store, the live line relayed only after the walk.
    dict(name="liveStopControl", limit=2, held=[["h", "10"]], gap=["a", "b"],
         pages=[[["b", "16"], ["l", "31"]], [["h", "10"], ["a", "12"]]],
         live=["l", "31"], liveWhen="afterWalk",
         expect=["CHATHISTORY LATEST #seance * 2", "CHATHISTORY BEFORE #seance msgid=b 2"],
         wire="Q S A C Q A C R C"),
    # #281: a live line relayed during the walk, not in any page; the gap
    # must sort above it.
    dict(name="gapOrder", limit=3, held=[["h", "10"]], gap=["a", "b"],
         pages=[[["h", "10"], ["a", "12"], ["b", "16"]]],
         live=["l", "31"], liveWhen="beforePage",
         expect=["CHATHISTORY LATEST #seance * 3"],
         # the page leaves out the live line it was stored before: only a
         # server without Contiguous can answer that (a lagging store)
         wire="Q S R C A C", model=dict(Contiguous="FALSE")),
    # #280: our clock ahead: a local line at 12:40 is the newest row; the
    # floor must stay at h (12:10), so the 12:16 page does not end the walk.
    dict(name="clockFloor", limit=2, held=[["h", "10"]], gap=["a", "b", "c"],
         pages=[[["b", "16"], ["c", "17"]], [["h", "10"], ["a", "15"]]],
         typedWhileDown=True,
         expect=["CHATHISTORY LATEST #seance * 2", "CHATHISTORY BEFORE #seance msgid=b 2"],
         wire="Q A C Q A C"),
    # #282: the page reaches below everything held (o, 11:55, is older than
    # our JOIN at 12:00 and was never loaded). It is history, not gap: it
    # must not be appended above the rejoin. Tonight's phone trace (D33).
    dict(name="belowHeld", limit=3, held=[["h", "10"]], gap=["a"],
         pages=[[["o", "11:55"], ["h", "10"], ["a", "12"]]],
         expect=["CHATHISTORY LATEST #seance * 3"],
         # TLC trace: o is History's Old (NOld = 1, D35)
         wire="Q A C"),
]

def check(fx, obs):
    v = []
    if obs["requests"] != fx["expect"]:
        v.append("Requests: %s, model %s" % (obs["requests"], fx["expect"]))
    rows = [r for r in obs["store"] if r["msgid"] and not r["msgid"].startswith("join")]
    ids = [r["msgid"] for r in rows]
    lost = [g for g in fx["gap"] if g not in ids]
    if lost:
        v.append("NoLoss: %s missing" % ",".join(lost))
    dup = sorted({i for i in ids if ids.count(i) > 1})
    if dup:
        v.append("NoDup: %s shown twice" % ",".join(dup))
    times = [r["time"] for r in rows]
    if times != sorted(times):
        v.append("Order: %s" % ",".join(ids))
    rid = [r["id"] for r in obs["store"]]
    if rid != sorted(rid):
        v.append("IdsRise: ids %s" % rid)
    return v

def main():
    co = os.path.abspath(sys.argv[1])
    out = sys.argv[2] if len(sys.argv) > 2 else None
    src = open(os.path.join(co, "test/irc/history.ts")).read()
    harness = src[:src.index("\ndescribe(")]
    fxs = [{k: f[k] for k in f if k not in ("gap", "expect", "wire", "model")} for f in FIXTURES]
    body = FIXTURE.replace("__FIXTURES__", json.dumps(fxs))
    # the fixture's import goes after the harness's own imports
    imp, body = body.split("\n", 2)[1], body.split("\n", 2)[2]
    gen = os.path.join(co, "test/irc/zz-formal-catchup.ts")
    open(gen, "w").write(imp + "\n" + harness + "\n" + body)
    try:
        p = subprocess.run(["pnpm", "exec", "mocha", "--config=test/.mocharc.yml", gen],
                           cwd=co, env=dict(os.environ, NODE_ENV="test"), capture_output=True, text=True)
    finally:
        os.remove(gen)
    obs = {}
    for l in p.stdout.splitlines():
        if "CATCHUP {" in l:
            o = json.loads(l[l.index("CATCHUP ") + 8:])
            obs[o["name"]] = o
    if not obs:
        sys.stderr.write(p.stdout[-3000:] + p.stderr[-3000:])
        sys.exit(1)
    sha = subprocess.run(["git", "rev-parse", "--short=9", "HEAD"], cwd=co, capture_output=True, text=True).stdout.strip()
    lines = []
    for fx in FIXTURES:
        o = obs.get(fx["name"])
        if not o:
            lines.append(dict(name=fx["name"], sha=sha, error="no observation"))
            continue
        o["sha"] = sha
        o["violations"] = check(fx, o)
        lines.append(o)
        print("%-16s %s  %s" % (fx["name"], "PASS" if not o["violations"] else "FAIL", "; ".join(o["violations"])))
    if out:
        open(out, "w").write("".join(json.dumps(r) + "\n" for r in lines))

if __name__ == "__main__":
    main()
