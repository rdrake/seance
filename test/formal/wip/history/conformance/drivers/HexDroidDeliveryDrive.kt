package com.boxlabs.hexdroid

/*
 * Delivery conformance driver (not part of HexDroid; untracked, not for upstream).
 *
 * Feeds the scenarios of seance/tmp/formal-history/conformance/scenarios.jsonl to the real
 * IrcClient over a local socket and records how each of the client's own sends settles, in the
 * observation format of that directory's SCHEMA.md. Outcomes are read from the core's events:
 *   confirmed: a ChatMessage with ownSendId == the send's id, or SendResolved(failed=false)
 *              emitted in the same step as some matched own echo (the confirmEcho sweep that
 *              finishes earlier sends to the same target, IrcCore.kt confirmEcho);
 *   failed:    SendResolved(failed=true);
 *   accepted:  SendResolved(failed=false) with no matched own echo in that step;
 *   pending:   none of these.
 * The first settle wins; later ones are noted.
 *
 * Run: ./gradlew :app:testDebugUnitTest --rerun --tests com.boxlabs.hexdroid.HexDroidDeliveryDrive
 */

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import org.junit.Test
import java.io.BufferedReader
import java.io.BufferedWriter
import java.io.File
import java.io.InputStreamReader
import java.io.OutputStreamWriter
import java.net.ServerSocket
import java.net.Socket
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit
import kotlin.concurrent.thread

private const val CONFORMANCE = "/Users/rdrake/workspace/afternet/seance/tmp/formal-history/conformance"
private const val CHAN = "#chan"
private const val ME = "dex"
private const val CAPS = "echo-message labeled-response batch"
private const val CAPS_NOLABEL = "echo-message batch"
private const val WAIT_MS = 8_000L

// ---------------------------------------------------------------- minimal JSON

private class JsonReader(private val s: String) {
    private var i = 0
    fun parse(): Any? { val v = value(); ws(); require(i == s.length) { "trailing data at $i" }; return v }
    private fun ws() { while (i < s.length && s[i].isWhitespace()) i++ }
    private fun value(): Any? {
        ws()
        return when (val c = s[i]) {
            '{' -> obj()
            '[' -> arr()
            '"' -> str()
            't' -> { i += 4; true }
            'f' -> { i += 5; false }
            'n' -> { i += 4; null }
            else -> if (c == '-' || c.isDigit()) num() else error("bad json at $i: $c")
        }
    }
    private fun obj(): Map<String, Any?> {
        val m = LinkedHashMap<String, Any?>(); i++; ws()
        if (s[i] == '}') { i++; return m }
        while (true) {
            ws(); val k = str(); ws(); require(s[i] == ':'); i++
            m[k] = value(); ws()
            if (s[i] == ',') { i++; continue }
            require(s[i] == '}'); i++; return m
        }
    }
    private fun arr(): List<Any?> {
        val l = ArrayList<Any?>(); i++; ws()
        if (s[i] == ']') { i++; return l }
        while (true) {
            l += value(); ws()
            if (s[i] == ',') { i++; continue }
            require(s[i] == ']'); i++; return l
        }
    }
    private fun str(): String {
        require(s[i] == '"'); i++
        val b = StringBuilder()
        while (true) {
            val c = s[i++]
            when (c) {
                '"' -> return b.toString()
                '\\' -> when (val e = s[i++]) {
                    'n' -> b.append('\n'); 't' -> b.append('\t'); 'r' -> b.append('\r')
                    'b' -> b.append('\b'); 'f' -> b.append('\u000c')
                    'u' -> { b.append(s.substring(i, i + 4).toInt(16).toChar()); i += 4 }
                    else -> b.append(e)
                }
                else -> b.append(c)
            }
        }
    }
    private fun num(): Any {
        val st = i
        while (i < s.length && (s[i].isDigit() || s[i] in "+-.eE")) i++
        val t = s.substring(st, i)
        return t.toLongOrNull() ?: t.toDouble()
    }
}

private fun jsonOf(v: Any?): String = when (v) {
    null -> "null"
    is String -> buildString {
        append('"')
        for (c in v) when {
            c == '"' -> append("\\\""); c == '\\' -> append("\\\\")
            c == '\n' -> append("\\n"); c == '\r' -> append("\\r"); c == '\t' -> append("\\t")
            c < ' ' -> append("\\u%04x".format(c.code))
            else -> append(c)
        }
        append('"')
    }
    is Boolean, is Int, is Long -> v.toString()
    is Map<*, *> -> v.entries.joinToString(",", "{", "}") { jsonOf(it.key.toString()) + ":" + jsonOf(it.value) }
    is List<*> -> v.joinToString(",", "[", "]") { jsonOf(it) }
    else -> error("cannot encode ${v::class}")
}

// ---------------------------------------------------------------- fake server

/** A one-connection IRC server: offers [CAPS], welcomes [ME], answers PING, can drop the connection. */
private class DriveServer(private val caps: String) {
    private val listener = ServerSocket(0)
    val port: Int get() = listener.localPort
    @Volatile private var conn: Socket? = null
    @Volatile private var out: BufferedWriter? = null
    val received = LinkedBlockingQueue<String>()

    init {
        thread(isDaemon = true) {
            val s = runCatching { listener.accept() }.getOrNull() ?: return@thread
            conn = s
            val reader = BufferedReader(InputStreamReader(s.getInputStream(), Charsets.UTF_8))
            out = BufferedWriter(OutputStreamWriter(s.getOutputStream(), Charsets.UTF_8))
            while (true) handle(runCatching { reader.readLine() }.getOrNull() ?: break)
        }
    }

    fun send(line: String) = synchronized(this) { out!!.write(line + "\r\n"); out!!.flush() }

    private fun handle(line: String) {
        val cmd = line.split(' ').dropWhile { it.startsWith("@") || it.startsWith(":") }.firstOrNull()
        when {
            line.startsWith("CAP LS") -> send(":srv CAP * LS :$caps")
            line.startsWith("CAP REQ") -> send(":srv CAP * ACK :${line.substringAfter(':')}")
            line == "CAP END" -> {
                send(":srv 001 $ME :Welcome")
                send(":srv 005 $ME CHANTYPES=# PREFIX=(ov)@+ :are supported")
                send(":srv 376 $ME :End of MOTD")
            }
            cmd == "PING" -> send(":srv PONG srv :${line.substringAfter(':')}")
            else -> received.add(line)
        }
    }

    fun expect(pred: (String) -> Boolean): String {
        val deadline = System.currentTimeMillis() + WAIT_MS
        while (true) {
            val left = deadline - System.currentTimeMillis()
            check(left > 0) { "no matching line from the client" }
            val line = received.poll(left, TimeUnit.MILLISECONDS) ?: continue
            if (pred(line)) return line
        }
    }

    /** Transport close, no QUIT. */
    fun dropConnection() { runCatching { conn?.close() } }

    fun close() { runCatching { conn?.close() }; runCatching { listener.close() } }
}

// ---------------------------------------------------------------- driver

private class Req(val i: Int, val tgt: String, val cmd: String, val txt: String) {
    var id: Long? = null
    var label: String? = null
    var outcome = "pending"
    val buffer: String get() = if (tgt == "self") ME else CHAN
}

class HexDroidDeliveryDrive {

    private fun waitFor(ms: Long = WAIT_MS, cond: () -> Boolean): Boolean {
        val deadline = System.currentTimeMillis() + ms
        while (!cond()) {
            if (System.currentTimeMillis() > deadline) return false
            Thread.sleep(5)
        }
        return true
    }

    private fun awaitingIds(client: IrcClient): List<Long> {
        val f = IrcClient::class.java.getDeclaredField("awaitingEchoes").apply { isAccessible = true }
        val dq = f.get(client) as ArrayDeque<*>
        return synchronized(dq) { dq.map { (it as IrcClient.SendTrack).id } }
    }

    private fun gitSha(): String {
        val p = ProcessBuilder("git", "rev-parse", "HEAD").redirectErrorStream(true).start()
        return p.inputStream.bufferedReader().readText().trim().also { p.waitFor() }
    }

    private fun subst(raw: String, reqs: Map<Int, Req>): String =
        raw.replace(Regex("""\{L(\d+)\}""")) { m -> reqs[m.groupValues[1].toInt()]?.label ?: "nolabel${m.groupValues[1]}" }
            .replace("{me}", ME)
            .replace("{chan}", CHAN)

    @Suppress("UNCHECKED_CAST")
    private fun runScenario(sc: Map<String, Any?>, sha: String, labelled: Boolean): Map<String, Any?> {
        val name = sc["name"] as String
        val labelsRequired = sc["labels"] as Boolean
        val steps = sc["steps"] as List<Map<String, Any?>>
        val notes = mutableListOf<String>()
        val reqs = LinkedHashMap<Int, Req>()
        val snap = mutableListOf<Map<String, Any?>>()
        var skipped: String? = null

        val server = DriveServer(if (labelled) CAPS else CAPS_NOLABEL)
        val client = IrcClient(
            IrcConfig(
                host = "127.0.0.1", port = server.port, useTls = false, allowInvalidCerts = false,
                nick = ME, altNick = null, username = "u", realname = "r",
            )
        )
        client.strings = { id, _ -> "s$id" }
        client.plurals = { id, q, _ -> "p$id/$q" }
        val events = CopyOnWriteArrayList<IrcEvent>()
        val scope = CoroutineScope(Dispatchers.IO)
        val collector: Job = scope.launch { client.events().collect { events.add(it) } }
        var syncN = 0
        fun sync() {
            val marker = "__sync${++syncN}"
            server.send(":srv NOTICE $ME :$marker")
            check(waitFor { events.any { it is IrcEvent.Notice && it.text == marker } }) { "$name: sync $marker lost" }
        }

        try {
            check(waitFor { client.hasCap("echo-message") && client.hasCap("labeled-response") == labelled && client.hasCap("batch") &&
                events.any { it is IrcEvent.ISupport } }) { "$name: caps not negotiated" }
            server.send(":$ME!u@h JOIN $CHAN")
            server.send(":srv 353 $ME = $CHAN :@$ME bob")
            server.send(":srv 366 $ME $CHAN :End of /NAMES list.")
            sync()
            Thread.sleep(50)
            server.received.clear()
            val base = events.size
            var closed = false

            stepLoop@ for ((index, step) in steps.withIndex()) {
                val start = events.size
                var echoLine = false
                when {
                    "send" in step -> {
                        val s = step["send"] as Map<String, Any?>
                        val r = Req((s["i"] as Long).toInt(), s["tgt"] as String, s["cmd"] as String, s["txt"] as String)
                        reqs[r.i] = r
                        val target = r.buffer
                        val wire: String
                        if (r.cmd == "NOTICE") {
                            // The UI path: /notice, as typed in the channel (IrcSlashCommands.kt "notice").
                            val before = awaitingIds(client).toSet()
                            runBlocking { client.handleSlashCommand("notice $target ${r.txt}", CHAN) }
                            wire = server.expect { Regex("""(^| )NOTICE \Q$target\E :""").containsMatchIn(it) }
                            r.id = awaitingIds(client).firstOrNull { it !in before }
                            notes += "req ${r.i}: NOTICE via /notice (suppressEcho=true: no SendResolved, no ownSendId)"
                        } else {
                            // The UI path: IrcViewModelInput sendMessage -> IrcClient.privmsg(buffer, chunk).
                            r.id = runBlocking { client.privmsg(target, r.txt) }
                            wire = server.expect { Regex("""(^| )PRIVMSG \Q$target\E :""").containsMatchIn(it) }
                        }
                        r.label = Regex("""^@(?:[^ ]*;)?label=([^ ;]+)""").find(wire)?.groupValues?.get(1)
                        if (r.id == null) notes += "req ${r.i}: no send id"
                        if (labelsRequired && r.label == null) { skipped = "no-label"; break@stepLoop }
                    }
                    "line" in step -> {
                        val raw = subst((step["line"] as Map<String, Any?>)["raw"] as String, reqs)
                        echoLine = Regex("""^(@\S+ )?:\Q$ME\E!\S+ (PRIVMSG|NOTICE) """).containsMatchIn(raw) ||
                            raw.contains("BATCH -")
                        server.send(raw)
                        sync()
                    }
                    "timeout" in step -> notes += "step $index: no-timeout"
                    "close" in step -> {
                        val before = awaitingIds(client)
                        server.dropConnection()
                        closed = true
                        if (!waitFor { events.any { it is IrcEvent.Disconnected } }) notes += "step $index: no Disconnected event"
                        if (!waitFor(3_000) { collector.isCompleted }) notes += "step $index: events() flow still open after close"
                        notes += "close: awaitingEchoes ${before.size} -> ${awaitingIds(client).size}, no SendResolved"
                    }
                }

                // Attribute this step's events.
                val stepEvents = events.subList(start, events.size).toList()
                val matchedEchoes = stepEvents.filterIsInstance<IrcEvent.ChatMessage>().mapNotNull { it.ownSendId }
                fun reqFor(id: Long) = reqs.values.firstOrNull { it.id == id }
                fun settle(r: Req, outcome: String) {
                    if (r.outcome == "pending") r.outcome = outcome
                    else notes += "step $index: req ${r.i} settled again ($outcome after ${r.outcome})"
                }
                for (ev in stepEvents) {
                    when (ev) {
                        is IrcEvent.ChatMessage -> {
                            val own = ev.ownSendId
                            if (own != null) {
                                val r = reqFor(own)
                                if (r == null) { notes += "step $index: echo for unknown send $own"; continue }
                                settle(r, "confirmed")
                                if (ev.text != r.txt) notes += "req ${r.i} confirmed by text \"${ev.text}\""
                            } else if (ev.from.equals(ME, ignoreCase = true)) {
                                notes += "step $index: own line \"${ev.text}\" in ${ev.target} with no ownSendId" +
                                    (if (ev.isHistory) " (history)" else "")
                            }
                        }
                        is IrcEvent.SendResolved -> for (id in ev.ids) {
                            val r = reqFor(id)
                            if (r == null) { notes += "step $index: SendResolved for unknown send $id"; continue }
                            when {
                                ev.failed -> settle(r, "failed")
                                matchedEchoes.isNotEmpty() && echoLine -> {
                                    val by = matchedEchoes.mapNotNull { e -> reqFor(e)?.i }
                                    notes += "step $index: req ${r.i} finished as delivered by the echo of req ${by.joinToString(",")} (confirmEcho sweep)"
                                    settle(r, "confirmed")
                                }
                                else -> settle(r, "accepted")
                            }
                        }
                        else -> {}
                    }
                }
                snap += mapOf("after" to index, "out" to reqs.values.associate { it.i.toString() to it.outcome })
                if (closed) { /* nothing more can arrive */ }
            }

            // shown: own ChatMessage/Notice lines with the request's text in the request's buffer.
            val all = events.subList(base, events.size).toList()
            val shown = LinkedHashMap<String, Any?>()
            for (r in reqs.values) {
                val n = all.count { ev ->
                    when (ev) {
                        is IrcEvent.ChatMessage -> ev.from.equals(ME, true) && ev.target.equals(r.buffer, true) && ev.text == r.txt
                        is IrcEvent.Notice -> ev.from.equals(ME, true) && ev.target.equals(r.buffer, true) && ev.text == r.txt
                        else -> false
                    }
                }
                shown[r.i.toString()] = n
            }
            if (skipped == null) {
                notes += "shown counts the core's own-nick ChatMessage/Notice events with the request's exact text in its buffer, " +
                    "matched or not, history included; the ViewModel's local copy, its failed flag and any dedup there are not observed"
            }

            return linkedMapOf(
                "name" to name,
                "client" to if (labelled) "hexdroid" else "hexdroid-nolabel",
                "sha" to sha,
                "labels" to reqs.values.associate { it.i.toString() to it.label },
                "snap" to if (skipped != null) emptyList() else snap,
                "shown" to shown,
                "notes" to notes.joinToString("; "),
                "skipped" to skipped,
            )
        } finally {
            scope.cancel()
            runCatching { client.forceClose() }
            server.close()
        }
    }

    @Test
    fun drive() = driveAll(labelled = true)

    /** echo-message and batch only: HexDroid then sends no labels (IrcCore.kt privmsg). */
    @Test
    fun driveNoLabel() = driveAll(labelled = false)

    @Suppress("UNCHECKED_CAST")
    private fun driveAll(labelled: Boolean) {
        val sha = gitSha()
        val scenarios = File("$CONFORMANCE/scenarios.jsonl").readLines().filter { it.isNotBlank() }
            .map { JsonReader(it).parse() as Map<String, Any?> }
        val results = scenarios.map { runScenario(it, sha, labelled) }
        val out = File("$CONFORMANCE/results/hexdroid-${sha.take(7)}${if (labelled) "" else "-nolabel"}.jsonl")
        out.parentFile.mkdirs()
        out.writeText(results.joinToString("\n", postfix = "\n") { jsonOf(it) })
        println("wrote $out (${results.size} scenarios)")
        for (r in results) {
            val last = (r["snap"] as List<Map<String, Any?>>).lastOrNull()?.get("out") ?: emptyMap<String, Any?>()
            println("ROW ${(r["name"] as String).padEnd(17)} ${jsonOf(last).padEnd(36)} shown=${jsonOf(r["shown"])} ${r["skipped"] ?: ""} | ${r["notes"]}")
        }
        if (!labelled) return
        val want = mapOf("echo1" to "confirmed", "err1" to "failed", "ack1" to "accepted", "fail1" to "failed")
        for ((n, w) in want) {
            val r = results.first { it["name"] == n }
            val got = ((r["snap"] as List<Map<String, Any?>>).last()["out"] as Map<String, Any?>)["1"]
            println("SELFCHECK $n want=$w got=$got ${if (got == w) "ok" else "MISMATCH"}")
        }
    }
}
