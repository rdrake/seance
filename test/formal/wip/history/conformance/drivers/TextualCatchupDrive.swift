// Chathistory reconnect catch-up conformance driver for Textual-NG
// (research tooling; throwaway; never committed to Textual-NG).
//
// Drives the fixtures of seance test/formal/history/catchup_fixtures.py
// through the real `Client` over an `InMemoryTransport` with an in-memory
// `MessageStore`: session 1 registers and joins #seance, the held lines arrive
// live, the transport drops, the SAME Client reconnects (real CAP/001/005/JOIN),
// and the client's own reconnect catch-up (self-JOIN -> backfillChannel ->
// BackfillCursor -> scheduleGapFill -> requestGapFill) is answered page by page
// with the fixture's pages, in order. Nothing is mocked above the transport.
//
// Placed temporarily (untracked) at
// TextualCore/Tests/TextualCoreTests/Client/TextualCatchupDrive.swift and run:
//   CATCHUP_FIXTURES=<fixtures.json> CATCHUP_OUT=<raw.jsonl> \
//     swift test --filter TextualCatchupDrive
// where fixtures.json is catchup_fixtures.FIXTURES dumped as JSON (minus
// expect/wire/model). The raw rows carry {name, requests, store, notes, ...};
// violations are added afterwards in Python with catchup_fixtures.check.
//
// "store" is the focused transcript's view model: Client.conversationSnapshot
// (.channel("#seance")).messages (what ClientStore re-snapshots for the pane),
// display order = ORDER BY server_time, sort_seq, id; id = MessageRowID.value
// (the client's own SQLite row id). JOIN/PART/etc. and pending rows left out.

import Foundation
import GRDB
import Testing
@testable import TextualCore

private let me = "alice"
private let chan = "#seance"

private func at(_ m: String) -> String {
    m.contains(":") ? "2026-08-25T\(m):00.000Z" : "2026-08-25T12:\(m):00.000Z"
}

private func line(_ id: String, _ m: String, nick: String = "bob", batch: String? = nil) -> String {
    let b = batch.map { "batch=\($0);" } ?? ""
    return "@\(b)time=\(at(m));msgid=\(id) :\(nick)!\(nick)@host PRIVMSG \(chan) :\(id)"
}

nonisolated(unsafe) private let iso: ISO8601DateFormatter = {
    let f = ISO8601DateFormatter()
    f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    f.timeZone = TimeZone(identifier: "UTC")
    return f
}()

@Suite("Textual catch-up conformance drive", .serialized)
struct TextualCatchupDrive {

    static func sentLines(_ t: InMemoryTransport) async -> [String] {
        await t.sentBytes.flatMap {
            String(decoding: $0, as: UTF8.self)
                .split(separator: "\r\n", omittingEmptySubsequences: true)
                .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
        }
    }

    static func isHistory(_ l: String) -> Bool { l.range(of: #"(^| )CHATHISTORY "#, options: .regularExpression) != nil }
    /// A request for #seance's own history (the ones the fixture's pages answer).
    static func isChanHistory(_ l: String) -> Bool {
        l.range(of: #"(^| )CHATHISTORY (LATEST|BEFORE|AFTER|AROUND|BETWEEN) #seance "#, options: .regularExpression) != nil
    }
    static func isTargets(_ l: String) -> Bool { l.range(of: #"(^| )CHATHISTORY TARGETS "#, options: .regularExpression) != nil }

    /// Answer each not-yet-answered CHATHISTORY TARGETS (the client's DM catch-up)
    /// with an empty targets batch: the fixtures hold no DMs.
    static func answerTargets(_ client: Client, _ t: InMemoryTransport, from: Int, done: inout Int) async {
        let ts = await sentLines(t).dropFirst(from).filter(isTargets)
        while done < ts.count {
            let lbl = label(of: ts[ts.startIndex + done]).map { "@label=\($0) " } ?? ""
            await client.feedInboundForTest("\(lbl):irc.test BATCH +t\(done) draft/chathistory-targets")
            await client.feedInboundForTest(":irc.test BATCH -t\(done)")
            done += 1
        }
    }

    static func label(of l: String) -> String? {
        guard l.hasPrefix("@") else { return nil }
        for t in l.dropFirst().prefix(while: { $0 != " " }).split(separator: ";") where t.hasPrefix("label=") {
            return String(t.dropFirst("label=".count))
        }
        return nil
    }

    static func stripLabel(_ l: String) -> String {
        guard l.hasPrefix("@"), let sp = l.firstIndex(of: " ") else { return l }
        let tags = l[l.index(after: l.startIndex)..<sp].split(separator: ";").filter { !$0.hasPrefix("label=") }
        let rest = String(l[l.index(after: sp)...])
        return tags.isEmpty ? rest : "@\(tags.joined(separator: ";")) \(rest)"
    }

    /// Real registration on whatever connection is current: CAP LS offer, ACK
    /// each REQ whole, 001, 005, 422. `from` = sent-line offset of this session.
    static func register(_ client: Client, _ t: InMemoryTransport, from: Int, isupport: String,
                         notes: inout [String]) async {
        _ = await eventually(timeout: .seconds(5)) {
            await sentLines(t).dropFirst(from).contains { $0.hasPrefix("CAP LS") }
        }
        await client.feedInboundForTest(
            ":irc.test CAP * LS :draft/chathistory batch server-time message-tags labeled-response")
        var acked = 0
        for _ in 0..<5 {
            _ = await eventually(timeout: .milliseconds(500)) {
                await sentLines(t).dropFirst(from).filter { $0.hasPrefix("CAP REQ") }.count > acked
            }
            let reqs = Array(await sentLines(t).dropFirst(from).filter { $0.hasPrefix("CAP REQ") })
            if reqs.count <= acked { break }
            for r in reqs[acked...] {
                let list = r.split(separator: ":", maxSplits: 1).last.map(String.init) ?? ""
                await client.feedInboundForTest(":irc.test CAP \(me) ACK :\(list)")
            }
            acked = reqs.count
        }
        _ = await eventually(timeout: .seconds(2)) {
            await sentLines(t).dropFirst(from).contains { $0.hasPrefix("CAP END") }
        }
        await client.feedInboundForTest(":irc.test 001 \(me) :Welcome")
        await client.feedInboundForTest(
            ":irc.test 005 \(me) CHANTYPES=#& PREFIX=(ov)@+ CHANMODES=b,k,l,imnpst CASEMAPPING=rfc1459 \(isupport) :are supported by this server")
        await client.feedInboundForTest(":irc.test 422 \(me) :MOTD File is missing")
        _ = await eventually { await client.networkSnapshot().phase == .registered }
        let want: Set<String> = ["draft/chathistory", "batch", "server-time", "message-tags", "labeled-response"]
        let enabled = await client.registry.enabled
        if !want.isSubset(of: enabled) {
            notes.append("negotiation left \(enabled.sorted())")
        }
    }

    static func joinLines(time: String, msgid: String) -> [String] {
        ["@time=\(time);msgid=\(msgid) :\(me)!\(me)@host JOIN \(chan)",
         ":irc.test 353 \(me) = \(chan) :@\(me) bob",
         ":irc.test 366 \(me) \(chan) :End of /NAMES list."]
    }

    static func reply(_ client: Client, to req: String, ref: String, members: [String]) async {
        let lbl = label(of: req).map { "@label=\($0) " } ?? ""
        await client.feedInboundForTest("\(lbl):irc.test BATCH +\(ref) chathistory \(chan)")
        for m in members { await client.feedInboundForTest(m) }
        await client.feedInboundForTest(":irc.test BATCH -\(ref)")
    }

    static func dbOrder(_ store: MessageStore, _ client: Client) async throws -> [Int64] {
        try await store.requireDatabase().read { db in
            try Int64.fetchAll(db, sql: """
                SELECT m.id FROM messages m JOIN conversations c ON c.id = m.conversation_id
                WHERE c.network_id = ? AND c.target_key = ? AND m.kind = 0
                ORDER BY m.server_time ASC, m.sort_seq ASC, m.id ASC
                """, arguments: [client.networkID, chan])
        }
    }

    /// Wait until the sent-line count stops changing for `quiet`.
    static func quiesce(_ t: InMemoryTransport, quiet: Duration = .milliseconds(500)) async {
        var last = -1
        let deadline = ContinuousClock.now + .seconds(5)
        while ContinuousClock.now < deadline {
            let n = await sentLines(t).count
            if n == last { return }
            last = n
            try? await Task.sleep(for: quiet)
        }
    }

    static func run(_ fx: [String: Any]) async throws -> [String: Any] {
        let name = fx["name"] as! String
        let limit = fx["limit"] as! Int
        let held = fx["held"] as! [[String]]
        let pages = fx["pages"] as! [[[String]]]
        let live = fx["live"] as? [String]
        let liveWhen = fx["liveWhen"] as? String
        let typed = fx["typedWhileDown"] as? Bool ?? false
        let isup = "CHATHISTORY=\(limit) MSGREFTYPES=timestamp,msgid"
        var notes: [String] = []

        var cfg = IRCConnectionConfig(connectionName: "drive", nickname: me, username: me, realName: "r")
        cfg.floodControlMaximumMessages = 1000
        cfg.floodControlDelayInterval = 60
        cfg.autoReconnect = false
        let store = try await InMemoryMessageStore.make()
        let t = InMemoryTransport()
        let client = Client(config: cfg, identity: ClientIdentity(nickname: me, realName: "r", username: me),
                            transport: t, store: store,
                            autoJoinChannels: ProcessInfo.processInfo.environment["CATCHUP_AUTOJOIN"] != nil ? [chan] : [])

        // Session 1.
        try await client.connect()
        await t.feedLifecycle(.secured(protocolVersion: 0x0304, cipherSuite: 0x1301))
        await register(client, t, from: 0, isupport: isup, notes: &notes)
        let s1JoinFrom = await sentLines(t).count
        for l in joinLines(time: "2026-08-25T12:00:00.000Z", msgid: "join-1") { await client.feedInboundForTest(l) }
        await client.floodControlResetForTest()
        _ = await eventually { await client.conversationSummaries().contains { $0.name == chan } }
        await client.focus(.channel(chan))
        // Cold start: no cursor yet, so the first JOIN asks LATEST; answer it empty.
        if await eventually(timeout: .seconds(2), { await sentLines(t).dropFirst(s1JoinFrom).contains(where: isHistory) }) {
            for r in await sentLines(t).dropFirst(s1JoinFrom).filter(isHistory) {
                notes.append("session 1: \(stripLabel(r)) answered empty")
                await reply(client, to: r, ref: "s1", members: [])
            }
        }
        for h in held { await client.feedInboundForTest(line(h[0], h[1])) }
        await quiesce(t)
        let cursor = try? await store.lastSeenMsgidForTesting(network: client.networkID, target: chan)
        notes.append("cursor before drop: \(cursor ?? "none")")

        // Drop.
        await t.feedLifecycle(.disconnected(reason: "closed by driver"))
        if !(await eventually(timeout: .seconds(5)) { await client.networkSnapshot().phase == .disconnected }) {
            notes.append("phase \(await client.networkSnapshot().phase) after drop")
        }
        if typed {
            let before = try await dbOrder(store, client).count
            await client.send(message: "anyone?", to: chan)
            try? await Task.sleep(for: .milliseconds(200))
            let after = try await dbOrder(store, client).count
            notes.append("typedWhileDown: Client.send refused while disconnected (sendWhileDisconnected, no offline queue); "
                         + "\(after - before) row(s) added; clock not moved to 12:40 (no injectable clock, nothing to stamp)")
        }

        // Reconnect: same Client, same store.
        let from = await sentLines(t).count
        try await client.connect()
        await t.feedLifecycle(.secured(protocolVersion: 0x0304, cipherSuite: 0x1301))
        if await t.openCount != 2 { notes.append("openCount \(await t.openCount)") }
        await register(client, t, from: from, isupport: isup, notes: &notes)
        for l in joinLines(time: "2026-08-25T12:30:00.000Z", msgid: "join-2") { await client.feedInboundForTest(l) }
        await client.floodControlResetForTest()
        let viewing = await client.conversations.isViewing(foldedKey: chan)
        notes.append("viewing #seance after rejoin: \(viewing)")
        let cursor2 = try? await store.lastSeenMsgidForTesting(network: client.networkID, target: chan)
        notes.append("cursor after rejoin JOIN: \(cursor2 ?? "none")")

        func reqs() async -> [String] { await sentLines(t).dropFirst(from).filter(isChanHistory) }
        var answered = 0
        var targetsDone = 0
        var relayed = false
        let relay = { (c: Client) async in await c.feedInboundForTest(line(live![0], live![1], nick: "carol")) }
        for (i, page) in pages.enumerated() {
            let got = await eventually(timeout: .seconds(i == 0 ? 8 : 3)) {
                await client.floodControlResetForTest()
                await answerTargets(client, t, from: from, done: &targetsDone)
                return await reqs().count > answered
            }
            if !got { break }
            if i == 0, live != nil, liveWhen == "beforePage" { await relay(client); relayed = true }
            let r = await reqs()[answered]
            await reply(client, to: r, ref: "p\(i)", members: page.map { line($0[0], $0[1], batch: "p\(i)") })
            answered += 1
        }
        await client.floodControlResetForTest()
        await quiesce(t)
        await answerTargets(client, t, from: from, done: &targetsDone)
        await quiesce(t)
        if targetsDone > 0 { notes.append("\(targetsDone) CHATHISTORY TARGETS answered with an empty targets batch") }
        let all = await reqs()
        if all.count > answered {
            notes.append("\(all.count - answered) request(s) left unanswered (pages ran out): "
                         + all[answered...].map(stripLabel).joined(separator: " | "))
        }
        if live != nil, liveWhen == "beforePage", !relayed {
            notes.append("no request came, so the beforePage live line was relayed after the rejoin anyway")
            await relay(client)
        }
        if live != nil, liveWhen == "afterWalk" { await relay(client) }
        await quiesce(t, quiet: .milliseconds(300))

        let view = await client.conversationSnapshot(.channel(chan))?.messages ?? []
        let rows = view.filter { $0.kind == .privmsg && !$0.isPending }
        let dbIDs = try await dbOrder(store, client)
        let viewIDs = rows.map(\.id.value)
        if dbIDs.suffix(viewIDs.count) != viewIDs[...] {
            notes.append("view order \(viewIDs) differs from DB order \(dbIDs)")
        }
        let storeOut: [[String: Any]] = rows.map {
            ["id": $0.id.value, "msgid": $0.msgid ?? NSNull(), "time": iso.string(from: $0.timestamp)]
        }
        let pag = await client.paginationState(for: .channel(chan))
        await client.disconnect()
        return [
            "name": name, "client": "textual-ng",
            "requests": await sentLines(t).dropFirst(from).filter(isHistory).map(stripLabel),
            "store": storeOut, "storeId": "MessageRowID (SQLite messages.id)",
            "pagination": String(describing: pag),
            "notes": notes.joined(separator: "; "),
        ]
    }

    @Test("drive catch-up fixtures")
    func drive() async throws {
        let env = ProcessInfo.processInfo.environment
        guard let outPath = env["CATCHUP_OUT"], let fxPath = env["CATCHUP_FIXTURES"] else { return }
        let fxs = try JSONSerialization.jsonObject(with: Data(contentsOf: URL(fileURLWithPath: fxPath))) as! [[String: Any]]
        var out: [String] = []
        for fx in fxs {
            if let only = env["CATCHUP_ONLY"], !only.split(separator: ",").contains(Substring(fx["name"] as! String)) { continue }
            let o = try await Self.run(fx)
            let d = try JSONSerialization.data(withJSONObject: o, options: [.sortedKeys, .withoutEscapingSlashes])
            out.append(String(decoding: d, as: UTF8.self))
        }
        try (out.joined(separator: "\n") + "\n").write(toFile: outPath, atomically: true, encoding: .utf8)
    }
}
