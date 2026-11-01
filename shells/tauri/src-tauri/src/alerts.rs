// LocalNotifications on Windows and Linux: the message alerts the page hands
// the OS (client/js/helpers/nativeAlerts.ts), in the shapes the Apple shells'
// plugin takes, shown through notify-rust. macOS has the Apple plugin itself
// (src/apple.rs).
//
// Not tauri-plugin-notification: it puts a script of its own into every page
// that swaps `window.Notification` for calls into commands this page may not
// use (capabilities/default.json), and on Windows reports the permission as
// granted.
//
// What the desktop notification servers allow:
// - a click opens the conversation: on Windows only while the toast is on
//   screen, not from the Action Center; on Linux as far as the server reports
//   it.
// - one alert per conversation on Linux, where a new one replaces the last
//   and reading the conversation takes it back; Windows cannot take a shown
//   toast back.
// - no permission to ask: a desktop app may always notify (the user turns it
//   off in the OS).

use notify_rust::{Notification, NotificationResponse};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

use crate::{emit, ShellError};

/// An alert on screen, by the page's id for its conversation.
struct Live {
    /// What the alert was about: a click hands it back to the page as the
    /// Apple plugin's `extra`.
    extra: Value,
    /// Which showing of the conversation's alert this is; a replaced one's
    /// waiting thread reports nothing.
    generation: u64,
    /// The notification server's id for it (Linux), once shown.
    server: Option<u32>,
}

#[derive(Default)]
pub struct Shown {
    live: Mutex<HashMap<i32, Live>>,
    next: Mutex<u64>,
}

pub fn setup(app: &AppHandle) {
    app.manage(Shown::default());
}

/// The body as text. Freedesktop servers read a body as markup (links, images,
/// bold), and an alert's body is what someone on IRC wrote: unescaped, a
/// `<img src=…>` would have the desktop fetch it. Windows toasts take text.
#[cfg(not(windows))]
fn body_text(body: &str) -> String {
    body.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

#[cfg(windows)]
fn body_text(body: &str) -> String {
    body.to_owned()
}

fn ids(options: &Value) -> Vec<i32> {
    options
        .get("notifications")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|n| n.get("id").and_then(Value::as_i64))
        .filter_map(|id| i32::try_from(id).ok())
        .collect()
}

fn show(app: &AppHandle, alert: &Value) {
    let Some(id) = alert
        .get("id")
        .and_then(Value::as_i64)
        .and_then(|id| i32::try_from(id).ok())
    else {
        return;
    };
    let text = |key: &str| alert.get(key).and_then(Value::as_str).unwrap_or("");

    let mut notification = Notification::new();
    notification
        .appname(&app.package_info().name)
        .summary(text("title"))
        .body(&body_text(text("body")));

    #[cfg(windows)]
    {
        // The toast takes the app's name and icon from the Start menu entry
        // the installer made; a build run from target/ has none, and a toast
        // under an unknown id never shows, so it goes out under PowerShell's.
        let installed = tauri::utils::platform::current_exe()
            .ok()
            .and_then(|exe| exe.parent().map(|dir| dir.to_path_buf()))
            .is_some_and(|dir| !dir.ends_with("target/debug") && !dir.ends_with("target/release"));

        if installed {
            notification.app_id(&app.config().identifier);
        }

        // The page names the Apple shells' bundled file; any sound asked for
        // is the instant-message ping here. Without one a toast is silent.
        if alert.get("sound").is_some_and(|s| !s.is_null()) {
            notification.sound_name("IM");
        }
    }

    // A click on the bubble is the "default" action; without it a
    // freedesktop server reports none.
    #[cfg(not(windows))]
    notification.action("default", "");

    let shown = app.state::<Shown>();
    let generation = {
        let mut next = shown.next.lock().unwrap();
        *next += 1;
        *next
    };
    let replaces = shown
        .live
        .lock()
        .unwrap()
        .insert(
            id,
            Live {
                extra: alert.get("extra").cloned().unwrap_or(Value::Null),
                generation,
                server: None,
            },
        )
        .and_then(|old| old.server);

    // The conversation's last alert, replaced in place.
    #[cfg(not(windows))]
    if let Some(server) = replaces {
        notification.id(server);
    }
    #[cfg(windows)]
    let _ = replaces;

    let app = app.clone();
    // Showing waits on the notification server, and the handle then waits
    // for the user: a thread of its own, until the alert is gone.
    std::thread::spawn(move || {
        let handle = match notification.show() {
            Ok(handle) => handle,
            Err(e) => {
                eprintln!("alert {id}: {e}");
                return;
            }
        };

        #[cfg(not(windows))]
        if let Some(live) = app.state::<Shown>().live.lock().unwrap().get_mut(&id) {
            if live.generation == generation {
                live.server = Some(handle.id());
            }
        }

        let _ = handle.wait_for_response(|response: &NotificationResponse| {
            // Still this showing's alert: a replaced one reports nothing.
            let extra = {
                let state = app.state::<Shown>();
                let mut live = state.live.lock().unwrap();
                let current = live.get(&id).is_some_and(|l| l.generation == generation);
                current.then(|| live.remove(&id)).flatten().map(|l| l.extra)
            };

            if let (NotificationResponse::Default, Some(extra)) = (response, extra) {
                emit(
                    &app,
                    "LocalNotifications",
                    "localNotificationActionPerformed",
                    json!({ "actionId": "tap", "notification": { "id": id, "extra": extra } }),
                    true,
                );
            }
        });
    });
}

/// Take the server's notifications back (Linux; Windows has no way to).
#[cfg(not(windows))]
fn close(servers: Vec<u32>) {
    if servers.is_empty() {
        return;
    }

    std::thread::spawn(move || {
        let Ok(bus) = zbus::blocking::Connection::session() else {
            return;
        };

        for server in servers {
            let _ = bus.call_method(
                Some("org.freedesktop.Notifications"),
                "/org/freedesktop/Notifications",
                Some("org.freedesktop.Notifications"),
                "CloseNotification",
                &(server,),
            );
        }
    });
}

#[cfg(windows)]
fn close(_: Vec<u32>) {}

pub fn call(app: &AppHandle, method: &str, options: &Value) -> Result<Value, ShellError> {
    match method {
        "checkPermissions" | "requestPermissions" => Ok(json!({ "display": "granted" })),
        "schedule" => {
            for alert in options
                .get("notifications")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
            {
                show(app, alert);
            }
            Ok(json!({}))
        }
        "removeDeliveredNotifications" => {
            let servers = {
                let state = app.state::<Shown>();
                let mut live = state.live.lock().unwrap();
                ids(options)
                    .iter()
                    .filter_map(|id| live.remove(id))
                    .filter_map(|l| l.server)
                    .collect()
            };
            close(servers);
            Ok(json!({}))
        }
        _ => Err(ShellError {
            message: format!("LocalNotifications.{method} is not implemented"),
            code: "unimplemented".into(),
        }),
    }
}

#[cfg(test)]
mod tests {
    #[cfg(not(windows))]
    #[test]
    fn a_body_is_never_markup() {
        assert_eq!(
            super::body_text(r#"<img src="https://x.test/a.png"> & <b>hi</b>"#),
            r#"&lt;img src="https://x.test/a.png"&gt; &amp; &lt;b&gt;hi&lt;/b&gt;"#
        );
    }
}
