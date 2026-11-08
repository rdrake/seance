// Raw TCP/TLS IRC connections for the page (client/js/irc/shellSocket.ts),
// for networks with no WebSocket listener. The page's WsTransport keeps its
// whole connection policy; this only moves lines: CRLF framing out, lines
// split and decoded in, TLS against Mozilla's roots (webpki-roots).
//
// Unlike the shell's other calls this does something a web page cannot, so
// every limit is enforced here, not trusted to the page: ports on the Fetch
// spec's bad-ports list (SMTP, POP, IMAP, …) are refused, a sent line may
// hold no CR, LF or NUL, lines and queues are capped, and there are at most
// MAX_SOCKETS at once.
//
// `Socket.open {id, host, port, tls}` → events `open {id}`, `lines {id,
// lines}` (one per read), `close {id, code, reason}`: 1000 when the server
// ended the connection, 1006 for any failure. `Socket.send {id, lines}`.
// `Socket.close {id}`: the queued lines are written (a QUIT gets out), the
// socket shut, and no event follows. A page load closes every socket.

use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Manager};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::sync::mpsc;

use crate::ShellError;

const PLUGIN: &str = "Socket";
const MAX_SOCKETS: usize = 16;
/// Queued outbound lines per socket; past it the socket is closed.
const SEND_QUEUE: usize = 512;
/// A sent line, before CRLF. The page caps lines at 500 bytes already.
const MAX_SEND_LINE: usize = 4096;
/// A received line; an ircd's own limit is 8191 + 512 bytes of tags.
pub const MAX_LINE: usize = 16 * 1024;
const ADDRESS_TIMEOUT: Duration = Duration::from_secs(5);
const DIAL_DEADLINE: Duration = Duration::from_secs(20);
const DRAIN_TIMEOUT: Duration = Duration::from_secs(2);

/// The Fetch spec's bad ports (https://fetch.spec.whatwg.org/#port-blocking),
/// less the IRC ones on it (6665–6669, 6679, 6697).
const BAD_PORTS: &[u16] = &[
    0, 1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79, 87, 95, 101,
    102, 103, 104, 109, 110, 111, 113, 115, 117, 119, 123, 135, 137, 139, 143, 161, 179, 389, 427,
    465, 512, 513, 514, 515, 526, 530, 531, 532, 540, 548, 554, 556, 563, 587, 601, 636, 989, 990,
    993, 995, 1719, 1720, 1723, 2049, 3659, 4045, 4190, 5060, 5061, 6000, 6566, 10080,
];

/// The live sockets: each one's queue of lines to write. Dropping a sender
/// is how a socket is closed — its task drains what is queued and ends.
#[derive(Default)]
pub struct Sockets(Mutex<HashMap<String, mpsc::Sender<String>>>);

impl Sockets {
    /// A page load: the old page's sockets go with it.
    pub fn close_all(&self) {
        self.0.lock().unwrap().clear();
    }
}

fn refuse(message: impl Into<String>) -> ShellError {
    ShellError {
        message: message.into(),
        code: "refused".into(),
    }
}

fn str_option<'a>(options: &'a Value, key: &str) -> Option<&'a str> {
    options.get(key).and_then(Value::as_str)
}

pub fn call(app: &AppHandle, method: &str, options: &Value) -> Result<Value, ShellError> {
    let sockets = app.state::<Sockets>();
    let id = str_option(options, "id")
        .filter(|id| !id.is_empty() && id.len() <= 64)
        .ok_or_else(|| refuse("no socket id"))?
        .to_owned();

    match method {
        "open" => {
            let host = str_option(options, "host")
                .map(clean_host)
                .unwrap_or_default();
            let port = options.get("port").and_then(Value::as_u64).unwrap_or(0);
            let tls = options.get("tls").and_then(Value::as_bool).unwrap_or(false);

            if host.is_empty() || host.len() > 255 {
                return Err(refuse("no host"));
            }

            let port = u16::try_from(port)
                .ok()
                .filter(|p| port_allowed(*p))
                .ok_or_else(|| refuse(format!("port {port} is not allowed")))?;
            let (tx, rx) = mpsc::channel(SEND_QUEUE);

            {
                let mut map = sockets.0.lock().unwrap();

                if map.contains_key(&id) {
                    return Err(refuse("socket id in use"));
                }

                if map.len() >= MAX_SOCKETS {
                    return Err(refuse("too many connections"));
                }

                // In the map before the task starts: a close that comes
                // while it dials finds it, and the dial is abandoned.
                map.insert(id.clone(), tx.clone());
            }

            let app = app.clone();
            tauri::async_runtime::spawn(run(app, id, host, port, tls, tx, rx));
            Ok(json!({}))
        }
        "send" => {
            let lines = options
                .get("lines")
                .and_then(Value::as_array)
                .ok_or_else(|| refuse("no lines"))?;
            let tx = sockets
                .0
                .lock()
                .unwrap()
                .get(&id)
                .cloned()
                .ok_or_else(|| refuse("no such socket"))?;

            for line in lines {
                let line = line.as_str().ok_or_else(|| refuse("a line is not text"))?;

                if let Err(reason) = check_send_line(line) {
                    drop_socket(app, &id, 1006, reason);
                    return Err(refuse(reason));
                }

                if tx.try_send(line.to_owned()).is_err() {
                    drop_socket(app, &id, 1006, "send queue full");
                    return Err(refuse("send queue full"));
                }
            }

            Ok(json!({}))
        }
        "close" => {
            sockets.0.lock().unwrap().remove(&id);
            Ok(json!({}))
        }
        _ => Err(ShellError {
            message: format!("{PLUGIN}.{method} is not implemented"),
            code: "unimplemented".into(),
        }),
    }
}

/// Close a socket the page did not ask to close, and tell it why.
fn drop_socket(app: &AppHandle, id: &str, code: u16, reason: &str) {
    if app
        .state::<Sockets>()
        .0
        .lock()
        .unwrap()
        .remove(id)
        .is_some()
    {
        crate::emit(
            app,
            PLUGIN,
            "close",
            json!({"id": id, "code": code, "reason": reason}),
            false,
        );
    }
}

/// Our socket ended on its own (the server, the network): tell the page,
/// unless the page closed it or a newer page owns the map.
fn finished(app: &AppHandle, id: &str, tx: &mpsc::Sender<String>, code: u16, reason: &str) {
    let sockets = app.state::<Sockets>();
    let mut map = sockets.0.lock().unwrap();

    if map.get(id).is_some_and(|ours| ours.same_channel(tx)) {
        map.remove(id);
        drop(map);
        crate::emit(
            app,
            PLUGIN,
            "close",
            json!({"id": id, "code": code, "reason": reason}),
            false,
        );
    }
}

trait Stream: AsyncRead + AsyncWrite + Send + Unpin {}
impl<T: AsyncRead + AsyncWrite + Send + Unpin> Stream for T {}

async fn run(
    app: AppHandle,
    id: String,
    host: String,
    port: u16,
    tls: bool,
    tx: mpsc::Sender<String>,
    mut rx: mpsc::Receiver<String>,
) {
    // Our own sender is held only to recognise our map entry; the page's
    // close is the map dropping its copy, seen as `recv()` → None below
    // once this one is gone too.
    let marker = tx.downgrade();
    drop(tx);

    let dial = tokio::time::timeout(DIAL_DEADLINE, dial(&host, port, tls));
    let stream = tokio::select! {
        result = dial => match result {
            Ok(Ok(stream)) => stream,
            Ok(Err(reason)) => return end(&app, &id, &marker, 1006, &reason),
            Err(_) => return end(&app, &id, &marker, 1006, "connect timed out"),
        },
        // Closed by the page while dialling: give up quietly.
        None = rx.recv() => return,
    };

    crate::emit(&app, PLUGIN, "open", json!({ "id": id }), false);
    let (mut reader, mut writer) = tokio::io::split(stream);
    let mut buf: Vec<u8> = Vec::new();
    let mut chunk = vec![0u8; 16 * 1024];

    loop {
        tokio::select! {
            read = reader.read(&mut chunk) => match read {
                Ok(0) => return end(&app, &id, &marker, 1000, "the server closed the connection"),
                Ok(n) => {
                    buf.extend_from_slice(&chunk[..n]);

                    match take_lines(&mut buf) {
                        Ok(lines) if lines.is_empty() => {}
                        Ok(lines) => crate::emit(&app, PLUGIN, "lines", json!({"id": id, "lines": lines}), false),
                        Err(reason) => return end(&app, &id, &marker, 1006, reason),
                    }
                }
                // Most ircds drop the connection without TLS's close_notify.
                Err(e) if e.kind() == std::io::ErrorKind::UnexpectedEof => {
                    return end(&app, &id, &marker, 1000, "the server closed the connection")
                }
                Err(e) => return end(&app, &id, &marker, 1006, &e.to_string()),
            },
            line = rx.recv() => match line {
                Some(line) => {
                    let mut bytes = line.into_bytes();
                    bytes.extend_from_slice(b"\r\n");

                    if let Err(e) = writer.write_all(&bytes).await {
                        return end(&app, &id, &marker, 1006, &e.to_string());
                    }
                }
                // Closed by the page (or a page load): everything queued has
                // been written by now; flush, shut down, quietly.
                None => {
                    let _ = tokio::time::timeout(DRAIN_TIMEOUT, async {
                        let _ = writer.flush().await;
                        let _ = writer.shutdown().await;
                    })
                    .await;
                    return;
                }
            },
        }
    }
}

fn end(app: &AppHandle, id: &str, marker: &mpsc::WeakSender<String>, code: u16, reason: &str) {
    if let Some(tx) = marker.upgrade() {
        finished(app, id, &tx, code, reason);
    }
}

async fn dial(host: &str, port: u16, tls: bool) -> Result<Box<dyn Stream>, String> {
    let addrs: Vec<_> = tokio::net::lookup_host((host, port))
        .await
        .map_err(|e| format!("cannot resolve {host}: {e}"))?
        .collect();
    let mut last = format!("{host} has no address");
    let mut tcp = None;

    // One address at a time, each with its own timeout: a dead IPv6 route
    // must not use up the whole wait before IPv4 is tried.
    for addr in addrs {
        match tokio::time::timeout(ADDRESS_TIMEOUT, TcpStream::connect(addr)).await {
            Ok(Ok(stream)) => {
                tcp = Some(stream);
                break;
            }
            Ok(Err(e)) => last = e.to_string(),
            Err(_) => last = format!("{addr} timed out"),
        }
    }

    let tcp = tcp.ok_or(last)?;
    let _ = tcp.set_nodelay(true);

    if !tls {
        return Ok(Box::new(tcp));
    }

    let name = rustls::pki_types::ServerName::try_from(host.to_owned())
        .map_err(|_| format!("{host} is not a valid TLS server name"))?;
    let stream = tls_connector()?
        .connect(name, tcp)
        .await
        .map_err(|e| e.to_string())?;
    Ok(Box::new(stream))
}

fn tls_connector() -> Result<tokio_rustls::TlsConnector, String> {
    let roots = rustls::RootCertStore {
        roots: webpki_roots::TLS_SERVER_ROOTS.to_vec(),
    };
    let config = rustls::ClientConfig::builder_with_provider(Arc::new(
        rustls::crypto::ring::default_provider(),
    ))
    .with_safe_default_protocol_versions()
    .map_err(|e| e.to_string())?
    .with_root_certificates(roots)
    .with_no_client_auth();
    Ok(tokio_rustls::TlsConnector::from(Arc::new(config)))
}

/// `[::1]` → `::1`; anything else as given, trimmed.
pub fn clean_host(host: &str) -> String {
    let host = host.trim();
    host.strip_prefix('[')
        .and_then(|h| h.strip_suffix(']'))
        .unwrap_or(host)
        .to_owned()
}

pub fn port_allowed(port: u16) -> bool {
    !BAD_PORTS.contains(&port)
}

pub fn check_send_line(line: &str) -> Result<(), &'static str> {
    if line.bytes().any(|b| b == b'\r' || b == b'\n' || b == 0) {
        Err("a line may not hold CR, LF or NUL")
    } else if line.len() > MAX_SEND_LINE {
        Err("line too long")
    } else {
        Ok(())
    }
}

/// The complete lines in `buf` (LF-terminated, a trailing CR stripped, empty
/// ones dropped), decoded; the unterminated rest stays in `buf`. A line over
/// MAX_LINE, finished or not, is an error.
pub fn take_lines(buf: &mut Vec<u8>) -> Result<Vec<String>, &'static str> {
    let mut lines = Vec::new();
    let mut start = 0;

    while let Some(at) = buf[start..].iter().position(|&b| b == b'\n') {
        let end = start + at;
        let mut line = &buf[start..end];

        if let [rest @ .., b'\r'] = line {
            line = rest;
        }

        if line.len() > MAX_LINE {
            return Err("line too long");
        }

        if !line.is_empty() {
            lines.push(decode(line));
        }

        start = end + 1;
    }

    buf.drain(..start);

    // The rest may still end in the CR of a CRLF split across reads.
    if buf.len() > MAX_LINE + 1 {
        return Err("line too long");
    }

    Ok(lines)
}

/// UTF-8, or Latin-1 for a line that is not (older networks and clients).
pub fn decode(bytes: &[u8]) -> String {
    match std::str::from_utf8(bytes) {
        Ok(text) => text.to_owned(),
        Err(_) => bytes.iter().map(|&b| b as char).collect(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splits_crlf_and_lf_and_keeps_the_rest() {
        let mut buf = b"PING :a\r\nNOTICE x :y\n\r\n:part".to_vec();
        assert_eq!(
            take_lines(&mut buf).unwrap(),
            vec!["PING :a", "NOTICE x :y"]
        );
        assert_eq!(buf, b":part");
        buf.extend_from_slice(b"ial\r\n");
        assert_eq!(take_lines(&mut buf).unwrap(), vec![":partial"]);
        assert!(buf.is_empty());
    }

    #[test]
    fn refuses_overlong_lines_finished_or_not() {
        let mut long = vec![b'a'; MAX_LINE + 2];
        assert!(take_lines(&mut long.clone()).is_err());
        long.truncate(MAX_LINE + 1);
        long.push(b'\n');
        assert!(take_lines(&mut long).is_err());
        let mut ok = vec![b'a'; MAX_LINE];
        ok.extend_from_slice(b"\r\n");
        assert_eq!(take_lines(&mut ok).unwrap()[0].len(), MAX_LINE);
    }

    #[test]
    fn decodes_utf8_or_latin1() {
        assert_eq!(decode("café".as_bytes()), "café");
        assert_eq!(decode(b"caf\xe9"), "café");
        assert_eq!(decode(b"\x01ACTION waves\x01"), "\u{1}ACTION waves\u{1}");
    }

    #[test]
    fn checks_sent_lines() {
        assert!(check_send_line("PRIVMSG #a :hi").is_ok());
        assert!(check_send_line("PRIVMSG #a :hi\r\nQUIT").is_err());
        assert!(check_send_line("a\0b").is_err());
        assert!(check_send_line(&"a".repeat(MAX_SEND_LINE + 1)).is_err());
    }

    #[test]
    fn allows_irc_ports_and_refuses_bad_ones() {
        for port in [6665, 6667, 6669, 6679, 6697, 7000, 994, 443, 8067] {
            assert!(port_allowed(port), "{port}");
        }

        for port in [0, 22, 25, 110, 143, 587, 993] {
            assert!(!port_allowed(port), "{port}");
        }
    }

    #[test]
    fn strips_ipv6_brackets() {
        assert_eq!(clean_host(" [::1] "), "::1");
        assert_eq!(clean_host("irc.example.org"), "irc.example.org");
    }

    #[tokio::test]
    async fn dials_plain_tcp_and_frames_lines() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let server = tokio::spawn(async move {
            let (mut sock, _) = listener.accept().await.unwrap();
            sock.write_all(b":srv 001 me :hi\r\n").await.unwrap();
            let mut got = vec![0u8; 64];
            let n = sock.read(&mut got).await.unwrap();
            got.truncate(n);
            got
        });
        let mut stream = dial("127.0.0.1", port, false).await.unwrap();
        let mut buf = Vec::new();
        let mut chunk = [0u8; 64];
        let n = stream.read(&mut chunk).await.unwrap();
        buf.extend_from_slice(&chunk[..n]);
        assert_eq!(take_lines(&mut buf).unwrap(), vec![":srv 001 me :hi"]);
        stream.write_all(b"NICK me\r\n").await.unwrap();
        assert_eq!(server.await.unwrap(), b"NICK me\r\n");
    }

    #[tokio::test]
    async fn reports_a_refused_dial() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        drop(listener);
        assert!(dial("127.0.0.1", port, false).await.is_err());
    }

    #[test]
    fn tls_config_builds_with_ring() {
        assert!(tls_connector().is_ok());
    }
}
