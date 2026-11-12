package com.boxlabs.hexdroid

/*
 * Chathistory reconnect catch-up conformance driver (not part of HexDroid; untracked, not for upstream).
 *
 * Runs the fixtures of seance-formal-wip/test/formal/history/catchup_fixtures.py (FIXTURES, dumped
 * to JSON by python3 so there is one source) against the real IrcClient over local sockets, and
 * writes one observation per fixture with violations from that file's check().
 *
 * Reconnect: IrcViewModel.connectNetwork builds a fresh IrcClient for every (re)connect
 * (IrcViewModel.kt ~4367-4492), and the per-client historyRequested set is what lets the new
 * session's self-JOIN fire CHATHISTORY LATEST again. So each fixture runs two IrcClients, one per
 * connection, each against its own one-shot ServerSocket; the channel store is carried across.
 *
 * Store: HexDroid's channel list is UiBuffer.messages, written only by IrcViewModel.append (tail
 * append, no re-sort; ChatScreen renders it in that order). IrcViewModel needs an Android Context
 * and SettingsRepository and the unit-test classpath has no Robolectric, so the ViewModel is NOT
 * run. Instead #seance ChatMessage events from the core are fed, in arrival order, through
 * CatchupStore below: a transcription of the ChatMessage branch of IrcViewModel.handleEvent
 * (empty-text drop, own-echo consumption) and of append()'s dedup (seenMsgIds, then the
 * "$ts|$from|${text.hashCode()}" content fingerprint) and tail append (IrcViewModel.kt ~9380-9460).
 * Row id = insertion index in that list. System lines (join line, chathistory marker,
 * "*** Not connected.") are not stored.
 *
 * Run: ./gradlew :app:testDebugUnitTest --rerun --tests com.boxlabs.hexdroid.HexDroidCatchupDrive
 */

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import org.junit.Test
import java.io.BufferedReader
import java.io.BufferedWriter
import java.io.File
import java.io.InputStreamReader
import java.io.OutputStreamWriter
import java.net.ServerSocket
import java.net.Socket
import java.time.Instant
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit
import kotlin.concurrent.thread

private const val FX_DIR = "/Users/rdrake/workspace/afternet/seance-formal-wip/test/formal/history"
private const val OUT_DIR = "/Users/rdrake/workspace/afternet/seance-formal-wip/test/formal/wip/history/conformance/results"
private const val CU_CHAN = "#seance"
private const val CU_ME = "alice"
private const val CU_CAPS = "draft/chathistory batch server-time message-tags labeled-response"
private const val CU_WAIT_MS = 8_000L
/** After a reply and its sync round trip, how long to wait for a further CHATHISTORY line. */
private const val CU_QUIET_MS = 1_200L

// ---------------------------------------------------------------- minimal JSON

private class CuJson(private val s: String) {
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
            when (val c = s[i++]) {
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

private fun cuJsonOf(v: Any?): String = when (v) {
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
    is Map<*, *> -> v.entries.joinToString(",", "{", "}") { cuJsonOf(it.key.toString()) + ":" + cuJsonOf(it.value) }
    is List<*> -> v.joinToString(",", "[", "]") { cuJsonOf(it) }
    else -> error("cannot encode ${v::class}")
}

// ---------------------------------------------------------------- fixture lines

private fun cuAt(m: String): String = if (':' in m) "2026-08-25T$m:00.000Z" else "2026-08-25T12:$m:00.000Z"
private fun cuLine(id: String, m: String, nick: String = "bob") =
    "@time=${cuAt(m)};msgid=$id :$nick!$nick@host PRIVMSG $CU_CHAN :$id"
private val CU_ISO: DateTimeFormatter = DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'").withZone(ZoneOffset.UTC)

// ---------------------------------------------------------------- fake server

/** A one-connection IRC server: offers [CU_CAPS], welcomes [CU_ME] with [isupport], answers PING. */
private class CatchupServer(private val isupport: String) {
    private val listener = ServerSocket(0)
    val port: Int get() = listener.localPort
    @Volatile private var conn: Socket? = null
    @Volatile private var out: BufferedWriter? = null
    val received = LinkedBlockingQueue<String>()
    val handshake = CopyOnWriteArrayList<String>()

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
        val offered = CU_CAPS.split(' ').toSet()
        when {
            line.startsWith("CAP LS") -> { handshake += line; send(":irc.test CAP * LS :$CU_CAPS") }
            line.startsWith("CAP REQ") -> {
                handshake += line
                val want = line.substringAfter(':').trim().split(' ').filter { it.isNotBlank() }
                if (want.all { it.removePrefix("-") in offered }) send(":irc.test CAP $CU_ME ACK :${want.joinToString(" ")}")
                else send(":irc.test CAP $CU_ME NAK :${want.joinToString(" ")}")
            }
            line == "CAP END" -> {
                handshake += line
                send(":irc.test 001 $CU_ME :Welcome back")
                send(":irc.test 005 $CU_ME CHANTYPES=#& PREFIX=(ov)@+ CHANMODES=b,k,l,imnpst CASEMAPPING=rfc1459 $isupport :are supported by this server")
                send(":irc.test 422 $CU_ME :MOTD File is missing")
            }
            cmd == "PING" -> send(":irc.test PONG irc.test :${line.substringAfter(':')}")
            else -> received.add(line)
        }
    }

    /** Lines the client has sent so far (after handshake), drained. */
    fun drain(): List<String> { val l = ArrayList<String>(); received.drainTo(l); return l }

    fun expect(ms: Long = CU_WAIT_MS, pred: (String) -> Boolean): String? {
        val deadline = System.currentTimeMillis() + ms
        while (true) {
            val left = deadline - System.currentTimeMillis()
            if (left <= 0) return null
            val line = received.poll(left, TimeUnit.MILLISECONDS) ?: continue
            if (pred(line)) return line
        }
    }

    /** Transport close, no QUIT, no ERROR. */
    fun drop() { runCatching { conn?.close() }; runCatching { listener.close() } }
}

// ---------------------------------------------------------------- store model

/**
 * Transcription of what IrcViewModel does with a channel ChatMessage (handleEvent's ChatMessage
 * branch, then append()), restricted to the parts that decide whether and where a row lands in
 * UiBuffer.messages. See the header for what is and is not modelled.
 */
private class CatchupStore {
    data class Row(val id: Int, val msgId: String?, val timeMs: Long, val from: String, val text: String, val isHistory: Boolean)

    val messages = ArrayList<Row>()
    private val seenMsgIds = HashSet<String>()
    private val seenFingerprints = HashSet<String>()
    val drops = ArrayList<String>()

    @Synchronized
    fun onEvent(ev: IrcEvent, myNick: String) {
        if (ev !is IrcEvent.ChatMessage) return
        if (!ev.target.equals(CU_CHAN, ignoreCase = true)) return
        if (ev.text.isEmpty()) return
        val fromMe = ev.from.equals(myNick, ignoreCase = true)
        if (fromMe) { drops += "own line ${ev.msgId}: not modelled (no local echo state)"; return }
        val ts = ev.timeMs ?: System.currentTimeMillis()
        val fp = "$ts|${ev.from}|${ev.text.hashCode()}"
        val mid = ev.msgId
        if (mid != null && mid in seenMsgIds) { drops += "${ev.msgId}: dup by msgid${if (ev.isHistory) " (history)" else ""}"; return }
        if (fp in seenFingerprints) { drops += "${ev.msgId}: dup by fingerprint${if (ev.isHistory) " (history)" else ""}"; return }
        messages += Row(messages.size, mid, ts, ev.from, ev.text, ev.isHistory)
        if (mid != null) seenMsgIds += mid
        seenFingerprints += fp
    }
}

// ---------------------------------------------------------------- driver

class HexDroidCatchupDrive {

    private fun waitFor(ms: Long = CU_WAIT_MS, cond: () -> Boolean): Boolean {
        val deadline = System.currentTimeMillis() + ms
        while (!cond()) {
            if (System.currentTimeMillis() > deadline) return false
            Thread.sleep(5)
        }
        return true
    }

    private fun run(vararg cmd: String, stdin: String? = null): String {
        val p = ProcessBuilder(*cmd).redirectErrorStream(true).start()
        if (stdin != null) p.outputStream.use { it.write(stdin.toByteArray()) } else p.outputStream.close()
        val out = p.inputStream.bufferedReader().readText()
        check(p.waitFor() == 0) { "${cmd.joinToString(" ")} failed:\n$out" }
        return out
    }

    /** One connection: a fresh IrcClient (as connectNetwork builds) against a fresh server. */
    private inner class Session(isupport: String, store: CatchupStore, val tag: String) {
        val server = CatchupServer(isupport)
        val client = IrcClient(
            IrcConfig(
                host = "127.0.0.1", port = server.port, useTls = false, allowInvalidCerts = false,
                nick = CU_ME, altNick = null, username = CU_ME, realname = "Alice",
                // historyLimit left at the shipped default (IrcConfig 50 == UiSettings.ircHistoryLimit 50)
            )
        )
        val events = CopyOnWriteArrayList<IrcEvent>()
        private val scope = CoroutineScope(Dispatchers.IO)
        val collector: Job
        private var syncN = 0

        init {
            collector = scope.launch { client.events().collect { events.add(it); store.onEvent(it, CU_ME) } }
            check(waitFor { client.hasCap("draft/chathistory") && client.hasCap("batch") && events.any { it is IrcEvent.ISupport } }) {
                "$tag: registration/caps not complete; handshake=${server.handshake}"
            }
        }

        fun sync() {
            val marker = "__sync_${tag}_${++syncN}"
            server.send(":irc.test NOTICE $CU_ME :$marker")
            check(waitFor { events.any { it is IrcEvent.Notice && it.text == marker } }) { "$tag: sync $marker lost" }
        }

        fun close() { scope.cancel(); runCatching { client.forceClose() }; server.drop() }
    }

    private fun batch(s: Session, ref: String, label: String?, lines: List<String>) {
        s.server.send("${if (label != null) "@label=$label " else ""}:irc.test BATCH +$ref chathistory $CU_CHAN")
        for (l in lines) s.server.send(if (l.startsWith("@")) "@batch=$ref;${l.substring(1)}" else "@batch=$ref $l")
        s.server.send(":irc.test BATCH -$ref")
    }

    private fun labelOf(line: String?): String? = line?.let { Regex("""^@(?:[^ ]*;)?label=([^ ;]+)""").find(it)?.groupValues?.get(1) }

    /** CHATHISTORY lines sent since the last call, after letting the client's queue settle. */
    private fun historyLines(s: Session, quietMs: Long = CU_QUIET_MS): List<String> {
        val got = ArrayList<String>()
        val deadline = System.currentTimeMillis() + quietMs
        while (System.currentTimeMillis() < deadline) {
            got += s.server.drain()
            Thread.sleep(20)
        }
        got += s.server.drain()
        return got.filter { it.contains("CHATHISTORY") }
    }

    @Suppress("UNCHECKED_CAST")
    private fun runFixture(fx: Map<String, Any?>): Map<String, Any?> {
        val name = fx["name"] as String
        val limit = (fx["limit"] as Long).toInt()
        val held = (fx["held"] as List<List<String>>)
        val pages = (fx["pages"] as List<List<List<String>>>)
        val live = fx["live"] as List<String>?
        val liveWhen = fx["liveWhen"] as String?
        val typedWhileDown = fx["typedWhileDown"] == true
        val isup = "CHATHISTORY=$limit MSGREFTYPES=timestamp,msgid"
        val notes = mutableListOf<String>()
        val store = CatchupStore()

        // -------- session 1: registered, joined, initial LATEST answered empty, held lines live
        val s1 = Session(isup, store, "$name/1")
        try {
            s1.server.send("@time=2026-08-25T12:00:00.000Z;msgid=join-1 :$CU_ME!$CU_ME@host JOIN $CU_CHAN")
            s1.server.send(":irc.test 353 $CU_ME = $CU_CHAN :@$CU_ME bob carol")
            s1.server.send(":irc.test 366 $CU_ME $CU_CHAN :End of /NAMES list.")
            val first = s1.server.expect { it.contains("CHATHISTORY") }
            if (first == null) notes += "session 1: no CHATHISTORY on first JOIN"
            else batch(s1, "hist0", labelOf(first), emptyList())
            s1.sync()
            for ((mid, m) in held.map { it[0] to it[1] }) s1.server.send(cuLine(mid, m))
            s1.sync()
            s1.server.drain()
            s1.server.drop()
            if (!waitFor { s1.events.any { it is IrcEvent.Disconnected } }) notes += "session 1: no Disconnected event"
        } finally {
            s1.close()
        }

        if (typedWhileDown) {
            notes += "typedWhileDown not run: HexDroid has no send-while-disconnected queue. " +
                "IrcViewModel.sendInputInternal (IrcViewModel.kt ~6176-6182) appends a system line \"*** Not connected.\" " +
                "(from=null, no msgid) and drops the text; nothing is queued or sent on reconnect. Read from source, " +
                "not observed (the ViewModel is not run); the system line is not in store"
        }

        // -------- session 2: fresh client, rejoin, walk
        val requests = ArrayList<String>()
        val s2 = Session(isup, store, "$name/2")
        try {
            s2.server.send("@time=2026-08-25T12:30:00.000Z;msgid=join-2 :$CU_ME!$CU_ME@host JOIN $CU_CHAN")
            s2.server.send(":irc.test 353 $CU_ME = $CU_CHAN :@$CU_ME bob")
            s2.server.send(":irc.test 366 $CU_ME $CU_CHAN :End of /NAMES list.")
            s2.sync()
            var sent = historyLines(s2)
            requests += sent
            val relay = { s2.server.send(cuLine(live!![0], live[1], "carol")); s2.sync() }
            if (live != null && liveWhen == "beforePage") relay()
            for ((pi, page) in pages.withIndex()) {
                if (sent.isEmpty()) break
                batch(s2, "hist${pi + 1}", labelOf(sent.first()), page.map { cuLine(it[0], it[1]) })
                s2.sync()
                sent = historyLines(s2)
                requests += sent
            }
            if (sent.isNotEmpty()) notes += "client still requesting after the fixture's last page: $sent"
            if (live != null && liveWhen == "afterWalk") relay()
            s2.sync()
        } finally {
            s2.close()
        }

        if (store.drops.isNotEmpty()) notes += "store drops: ${store.drops.joinToString(", ")}"
        notes += "history-flagged rows: " + store.messages.filter { it.isHistory }.joinToString(",") { it.msgId ?: "?" }
        notes += "store is a model of IrcViewModel.append (msgid set, content fingerprint, tail append) fed the core's " +
            "#seance ChatMessage events; the ViewModel itself is not run; id = insertion index in UiBuffer.messages"

        return linkedMapOf(
            "name" to name,
            "client" to "hexdroid",
            "requests" to requests.map { it.replace(Regex("""^@label=[^ ]+ """), "") },
            "store" to store.messages.map { mapOf("id" to it.id, "msgid" to it.msgId, "time" to CU_ISO.format(Instant.ofEpochMilli(it.timeMs))) },
            "note" to notes.joinToString("; "),
        )
    }

    @Test
    @Suppress("UNCHECKED_CAST")
    fun drive() {
        val sha = run("git", "rev-parse", "HEAD").trim()
        val fixtures = CuJson(
            run("python3", "-c", "import sys,json; sys.path.insert(0, sys.argv[1]); from catchup_fixtures import FIXTURES; print(json.dumps(FIXTURES))", FX_DIR).trim()
        ).parse() as List<Map<String, Any?>>
        val rows = fixtures.map { fx ->
            runCatching { runFixture(fx) }.getOrElse { e ->
                linkedMapOf("name" to fx["name"], "client" to "hexdroid", "error" to "driver: ${e.message}")
            }
        }
        val raw = File("build/catchup-raw-${sha.take(7)}.jsonl").absoluteFile
        raw.writeText(rows.joinToString("\n", postfix = "\n") { cuJsonOf(it) })
        val out = File("$OUT_DIR/catchup-hexdroid-${sha.take(7)}.jsonl")
        out.parentFile.mkdirs()
        val py = """
import sys, json
sys.path.insert(0, sys.argv[1])
from catchup_fixtures import FIXTURES, check
raw = {}
for l in open(sys.argv[2]):
    if l.strip():
        o = json.loads(l); raw[o["name"]] = o
lines = []
for fx in FIXTURES:
    o = raw.get(fx["name"]) or dict(name=fx["name"], client="hexdroid", error="no observation")
    r = dict(name=o["name"], client=o["client"])
    if "error" in o:
        r.update(sha=sys.argv[3], error=o["error"])
    else:
        r.update(requests=o["requests"], store=o["store"], sha=sys.argv[3], violations=check(fx, o), note=o["note"])
        print("%-16s %s  %s" % (fx["name"], "PASS" if not r["violations"] else "FAIL", "; ".join(r["violations"])))
    lines.append(r)
open(sys.argv[4], "w").write("".join(json.dumps(r) + "\n" for r in lines))
""".trimIndent()
        val report = run("python3", "-c", py, FX_DIR, raw.path, sha.take(7), out.path)
        println("wrote $out")
        for (l in report.lines().filter { it.isNotBlank() }) println("CATCHUP $l")
        for (r in rows) println("NOTE ${r["name"]}: ${r["note"] ?: r["error"]}")
    }
}
