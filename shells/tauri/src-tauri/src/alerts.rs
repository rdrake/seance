// LocalNotifications on Windows and Linux: the message alerts the page hands
// the OS (client/js/helpers/nativeAlerts.ts), in the shapes the Apple shells'
// plugin takes, through tauri-plugin-notification. macOS has the Apple
// plugin itself (src/apple.rs).
//
// What the desktop notification servers allow:
// - a click opens the conversation: on Windows only while the toast is on
//   screen, not from the Action Center; on Linux as far as the server reports
//   it.
// - reading a conversation removes its alert on Linux only; Windows cannot
//   take a shown toast back.
// - no permission to ask: a desktop app may always notify (the user turns it
//   off in the OS).

use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::Mutex;
use tauri::{AppHandle, Manager};
use tauri_plugin_notification::NotificationExt;

use crate::{emit, ShellError};

/// The ping: Windows' instant-message toast sound and the freedesktop name
/// for the same. Without one a Windows toast is silent; most Linux servers
/// play nothing either way.
#[cfg(windows)]
const SOUND: &str = "IM";
#[cfg(not(windows))]
const SOUND: &str = "message-new-instant";

/// What each shown alert was about, by its id: a click hands it back to the
/// page as the Apple plugin's `extra`.
#[derive(Default)]
pub struct Shown(Mutex<HashMap<i32, Value>>);

pub fn setup(app: &AppHandle) {
    app.manage(Shown::default());
    let handle = app.clone();
    let _ = app.notification().on_action(move |performed| {
        let Some(id) = performed.notification().map(|n| n.id()) else {
            return;
        };
        let extra = handle.state::<Shown>().0.lock().unwrap().get(&id).cloned();

        if let Some(extra) = extra {
            emit(
                &handle,
                "LocalNotifications",
                "localNotificationActionPerformed",
                json!({ "actionId": "tap", "notification": { "id": id, "extra": extra } }),
                true,
            );
        }
    });
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
                let Some(id) = alert
                    .get("id")
                    .and_then(Value::as_i64)
                    .and_then(|id| i32::try_from(id).ok())
                else {
                    continue;
                };
                let text = |key: &str| alert.get(key).and_then(Value::as_str).unwrap_or("");
                let extra = alert.get("extra").cloned().unwrap_or(Value::Null);
                app.state::<Shown>().0.lock().unwrap().insert(id, extra);

                let mut builder = app
                    .notification()
                    .builder()
                    .id(id)
                    .title(text("title"))
                    .body(text("body"));

                // The page names the Apple shells' bundled file; any sound
                // asked for is the platform's own ping here.
                if alert.get("sound").is_some_and(|s| !s.is_null()) {
                    builder = builder.sound(SOUND);
                }

                builder.show().map_err(|e| ShellError {
                    message: e.to_string(),
                    code: "failed".into(),
                })?;
            }
            Ok(json!({}))
        }
        "removeDeliveredNotifications" => {
            let ids = ids(options);
            {
                let state = app.state::<Shown>();
                let mut shown = state.0.lock().unwrap();
                for id in &ids {
                    shown.remove(id);
                }
            }
            let _ = app.notification().remove_active(ids);
            Ok(json!({}))
        }
        _ => Err(ShellError {
            message: format!("LocalNotifications.{method} is not implemented"),
            code: "unimplemented".into(),
        }),
    }
}
