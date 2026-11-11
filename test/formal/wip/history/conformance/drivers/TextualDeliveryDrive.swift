// Delivery conformance driver for Textual-NG (throwaway; not committed).
//
// Feeds seance/tmp/formal-history/conformance/scenarios.jsonl to the real
// `Client` over an `InMemoryTransport` with a real `MessageStore`, and records
// how each local pending copy of a sent message settles, in the observation
// format of that directory's SCHEMA.md.
//
// Placed temporarily at TextualCore/Tests/TextualCoreTests/Client/ and run:
//   DELIVERY_CLIENT=textual DELIVERY_SHA=<sha> DELIVERY_OUT=<path> \
//     swift test --filter TextualDeliveryDrive
//
// Outcomes are read from the request's own pending row (located by diffing the
// outbound ledger at send time and taking the receipt's rowID):
//   .sendFailed -> failed, .superseded -> confirmed, .pending -> pending,
//   none of these -> accepted. The receipt's presence is cross-checked.

import Foundation
import GRDB
import Testing
@testable import TextualCore

private let conformanceDir = ProcessInfo.processInfo.environment["CONFORMANCE_DIR"]
    ?? "/Users/rdrake/workspace/afternet/seance/tmp/formal-history/conformance"
private let me = "alice"
private let chan = "#chan"

private struct DReq {
    let i: Int
    let tgt: String
    let cmd: String
    let txt: String
    var label: String?
    var receiptID: OutboundReceiptID?
    var rowID: MessageRowID?
    var outcome = "pending"
    var failCause: String?
}

@Suite("Textual delivery conformance drive", .serialized)
struct TextualDeliveryDrive {

    // MARK: setup

    static func sentLines(_ t: InMemoryTransport) async -> [String] {
        await t.sentBytes.flatMap {
            String(decoding: $0, as: UTF8.self)
                .split(separator: "\r\n", omittingEmptySubsequences: true)
                .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
        }
    }

    static func make(notes: inout [String]) async throws
        -> (Client, InMemoryTransport, MessageStore)
    {
        var cfg = IRCConnectionConfig(
            connectionName: "drive", nickname: me, username: "u", realName: "r")
        cfg.floodControlMaximumMessages = 1000
        cfg.floodControlDelayInterval = 60
        cfg.autoReconnect = false
        let store = try await InMemoryMessageStore.make()
        let transport = InMemoryTransport()
        let client = Client(
            config: cfg,
            identity: ClientIdentity(nickname: me, realName: "r", username: "u"),
            transport: transport, store: store)

        try await client.connect()
        await transport.feedLifecycle(.secured(protocolVersion: 0x0304, cipherSuite: 0x1301))
        _ = await eventually { await client.networkSnapshot().phase == .connected }
        _ = await eventually { await sentLines(transport).contains { $0.hasPrefix("CAP LS") } }

        // Real negotiation: offer the caps, then ACK each REQ the client sends,
        // exactly and whole.
        await client.feedInboundForTest(
            ":srv CAP * LS :message-tags echo-message labeled-response batch")
        var acked = 0
        for _ in 0..<5 {
            _ = await eventually(timeout: .milliseconds(500)) {
                await sentLines(transport).filter { $0.hasPrefix("CAP REQ") }.count > acked
            }
            let reqs = await sentLines(transport).filter { $0.hasPrefix("CAP REQ") }
            if reqs.count <= acked { break }
            for r in reqs[acked...] {
                let list = r.split(separator: ":", maxSplits: 1).last.map(String.init) ?? ""
                await client.feedInboundForTest(":srv CAP \(me) ACK :\(list)")
            }
            acked = reqs.count
        }
        _ = await eventually(timeout: .seconds(2)) {
            await sentLines(transport).contains { $0.hasPrefix("CAP END") }
        }
        await client.feedInboundForTest(":srv 001 \(me) :welcome")
        _ = await eventually { await client.networkSnapshot().phase == .registered }

        let want: Set<String> = ["echo-message", "labeled-response", "batch"]
        var enabled = await client.registry.enabled
        if !want.isSubset(of: enabled) {
            notes.append("negotiation left \(enabled.sorted()); enabled the rest for testing")
            await client.enableCapabilitiesForTesting(Array(want.union(["message-tags"])))
            enabled = await client.registry.enabled
        }

        await client.feedInboundForTest(":\(me)!u@h JOIN \(chan)")
        await client.feedInboundForTest(":srv 353 \(me) = \(chan) :@\(me) bob")
        await client.feedInboundForTest(":srv 366 \(me) \(chan) :End of /NAMES list.")
        await client.floodControlResetForTest()
        return (client, transport, store)
    }

    // MARK: reading state

    static func allRows(_ store: MessageStore, _ client: Client) async throws -> [StoredMessage] {
        let ids = try await store.requireDatabase().read { db in
            try Int64.fetchAll(db, sql: """
                SELECT m.id FROM messages m
                JOIN conversations c ON c.id = m.conversation_id
                WHERE c.network_id = ?
                ORDER BY m.id ASC
                """, arguments: [client.networkID])
        }
        return try await store.rows(ids: ids.map { MessageRowID(value: $0) })
    }

    /// Fingerprint of everything an outcome is read from.
    static func fingerprint(_ store: MessageStore, _ client: Client) async -> String {
        let rows = (try? await allRows(store, client)) ?? []
        let r = rows.map { "\($0.id.value):\($0.flags.rawValue):\($0.body)" }.joined(separator: ",")
        let rc = await client.outboundLedger.receipts.keys.map(\.value).sorted()
        return "\(r)|\(rc)"
    }

    /// Read until two consecutive reads 20 ms apart agree (at least 3 reads).
    static func settle(_ store: MessageStore, _ client: Client) async {
        var last = ""
        var same = 0
        let deadline = ContinuousClock.now + .seconds(3)
        while ContinuousClock.now < deadline {
            try? await Task.sleep(for: .milliseconds(20))
            let fp = await fingerprint(store, client)
            if fp == last { same += 1; if same >= 2 { return } } else { same = 0; last = fp }
        }
    }

    // MARK: one scenario

    static func run(_ sc: [String: Any], client name: String, sha: String) async throws -> [String: Any] {
        let scName = sc["name"] as! String
        let labelsWanted = sc["labels"] as? Bool ?? false
        let steps = sc["steps"] as! [[String: Any]]
        var notes: [String] = []
        let (client, transport, store) = try await make(notes: &notes)
        var reqs: [Int: DReq] = [:]
        var snaps: [[String: Any]] = []
        var skipped: String?

        func substitute(_ raw: String) -> String {
            var s = raw.replacingOccurrences(of: "{me}", with: me)
                .replacingOccurrences(of: "{chan}", with: chan)
            for (i, r) in reqs { s = s.replacingOccurrences(of: "{L\(i)}", with: r.label ?? "nolabel\(i)") }
            return s
        }

        stepLoop: for (index, step) in steps.enumerated() {
            if let send = step["send"] as? [String: Any] {
                let i = send["i"] as! Int
                var r = DReq(i: i, tgt: send["tgt"] as! String, cmd: send["cmd"] as! String,
                             txt: send["txt"] as! String)
                let target = r.tgt == "self" ? me : chan
                let before = Set(await client.outboundLedger.receipts.keys)
                let wireBefore = await sentLines(transport).count
                if r.cmd == "NOTICE" {
                    await client.send(notice: r.txt, to: target)
                } else {
                    await client.send(message: r.txt, to: target)
                }
                let wire = await sentLines(transport).dropFirst(wireBefore)
                    .filter { $0.range(of: #"(^| )(PRIVMSG|NOTICE) "#, options: .regularExpression) != nil }
                if wire.count != 1 { notes.append("send \(i): \(wire.count) lines on the wire") }
                if let line = wire.first, line.hasPrefix("@") {
                    let tags = line.dropFirst().prefix { $0 != " " }
                    for t in tags.split(separator: ";") where t.hasPrefix("label=") {
                        r.label = String(t.dropFirst("label=".count))
                    }
                }
                let receipts = await client.outboundLedger.receipts
                let new = receipts.keys.filter { !before.contains($0) }
                if new.count != 1 { notes.append("send \(i): \(new.count) new receipts") }
                if let id = new.first {
                    r.receiptID = id
                    r.rowID = receipts[id]?.rowID
                    if receipts[id]?.state != .committed {
                        notes.append("send \(i): receipt not committed after send (\(String(describing: receipts[id]?.state)))")
                    }
                }
                if r.rowID == nil { notes.append("send \(i): no pending row") }
                reqs[i] = r
                if labelsWanted && r.label == nil {
                    skipped = "no-label"
                    break stepLoop
                }
            } else if let line = step["line"] as? [String: Any] {
                await client.feedInboundForTest(substitute(line["raw"] as! String))
            } else if step["timeout"] != nil {
                notes.append("step \(index): no-timeout")
            } else if step["close"] != nil {
                await transport.feedLifecycle(.disconnected(reason: "closed by driver"))
                let ok = await eventually(timeout: .seconds(5)) {
                    await client.networkSnapshot().phase == .disconnected
                }
                if !ok {
                    notes.append("close: phase \(await client.networkSnapshot().phase) after 5 s")
                }
            }

            await settle(store, client)

            // Read every request's outcome.
            let receipts = await client.outboundLedger.receipts
            var out: [String: String] = [:]
            for (i, var r) in reqs.sorted(by: { $0.key < $1.key }) {
                var outcome = "pending"
                let receiptLive = r.receiptID.map { receipts[$0] != nil } ?? false
                if let rowID = r.rowID, let row = try? await store.rows(ids: [rowID]).first {
                    if row.flags.contains(.sendFailed) {
                        outcome = "failed"
                    } else if row.flags.contains(.superseded) {
                        outcome = "confirmed"
                    } else if row.flags.contains(.pending) {
                        outcome = "pending"
                    } else {
                        outcome = "accepted"
                    }
                } else {
                    notes.append("step \(index): req \(i) has no readable row")
                }
                if (outcome == "pending") != receiptLive {
                    notes.append("step \(index): req \(i) is \(outcome) but its receipt is \(receiptLive ? "live" : "gone")")
                }
                if outcome != r.outcome {
                    if r.outcome != "pending" {
                        notes.append("step \(index): req \(i) went \(r.outcome) -> \(outcome)")
                    }
                    if outcome == "failed" {
                        let cause = step["close"] != nil ? "close" : "rejection"
                        r.failCause = cause
                        notes.append("req \(i) failed at step \(index): \(cause)")
                    }
                    r.outcome = outcome
                    reqs[i] = r
                }
                out[String(i)] = outcome
            }
            snaps.append(["after": index, "out": out])
        }

        // shown: settled own lines with the request's text, any conversation.
        var shown: [String: Int] = [:]
        var labels: [String: Any] = [:]
        let rows = (try? await allRows(store, client)) ?? []
        for (i, r) in reqs.sorted(by: { $0.key < $1.key }) {
            labels[String(i)] = r.label ?? NSNull()
            let mine = rows.filter {
                $0.flags.contains(.selfMessage) && $0.body == r.txt
                    && !$0.flags.contains(.superseded)
            }
            let settled = mine.filter { !$0.flags.contains(.pending) && !$0.flags.contains(.sendFailed) }
            shown[String(i)] = skipped == nil ? settled.count : 0
            if skipped == nil {
                let unsettled = mine.count - settled.count
                if unsettled > 0 && i == reqs.keys.min() {
                    notes.append("\(unsettled) visible pending/failed own row(s) with text \"\(r.txt)\"")
                }
                let convs = Set(settled.map(\.conversation.targetKey))
                if convs.count > 1 { notes.append("req \(i) shown in \(convs.sorted())") }
            }
        }
        if skipped != nil { snaps = [] }
        await client.disconnect()

        var seen = Set<String>()
        let uniq = notes.filter { seen.insert($0).inserted }
        return [
            "name": scName, "client": name, "sha": sha, "labels": labels,
            "snap": snaps, "shown": shown, "notes": uniq.joined(separator: "; "),
            "skipped": skipped ?? NSNull(),
        ]
    }

    @Test("drive delivery scenarios")
    func drive() async throws {
        let env = ProcessInfo.processInfo.environment
        guard let outPath = env["DELIVERY_OUT"] else { return }
        let name = env["DELIVERY_CLIENT"] ?? "textual"
        let sha = env["DELIVERY_SHA"] ?? "unknown"
        let text = try String(contentsOfFile: "\(conformanceDir)/scenarios.jsonl", encoding: .utf8)
        var lines: [String] = []
        for l in text.split(separator: "\n") where !l.isEmpty {
            let sc = try JSONSerialization.jsonObject(with: Data(l.utf8)) as! [String: Any]
            if let only = env["DELIVERY_ONLY"], !only.split(separator: ",").contains(Substring(sc["name"] as! String)) {
                continue
            }
            let obs = try await Self.run(sc, client: name, sha: sha)
            let data = try JSONSerialization.data(withJSONObject: obs, options: [.sortedKeys, .withoutEscapingSlashes])
            lines.append(String(decoding: data, as: UTF8.self))
        }
        try (lines.joined(separator: "\n") + "\n").write(toFile: outPath, atomically: true, encoding: .utf8)

        // Driver self-check.
        let byName = Dictionary(uniqueKeysWithValues: lines.map {
            let o = try! JSONSerialization.jsonObject(with: Data($0.utf8)) as! [String: Any]
            return (o["name"] as! String, o)
        })
        for (n, want) in [("U_echo", "confirmed"), ("U_err", "failed"), ("U_close", "failed")] {
            guard let o = byName[n], let snap = (o["snap"] as? [[String: Any]])?.last,
                  let out = snap["out"] as? [String: String] else { continue }
            #expect(out["1"] == want, "\(n): \(out)")
        }
    }
}
