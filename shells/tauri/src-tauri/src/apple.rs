// `AppleTranslate` (macOS): the Swift package under swift/ answers it with
// Apple's Translation framework through the package the iOS shell's plugin
// uses too (shells/apple), so the methods and shapes are the same. One C entry point: the method and its options as JSON in,
// and a callback, on any thread, with `{"ok": …}` or `{"err": {code, message}}`.

use serde_json::Value;
use std::ffi::{c_char, c_void, CStr, CString};
use std::sync::mpsc;

type Done = extern "C" fn(*mut c_void, *const c_char);

extern "C" {
    fn seance_apple_call(method: *const c_char, options: *const c_char, context: *mut c_void, done: Done);
}

extern "C" fn done(context: *mut c_void, json: *const c_char) {
    // SAFETY: `context` is the sender `call` boxed, and Swift calls back once.
    let sender = unsafe { Box::from_raw(context as *mut mpsc::Sender<String>) };
    let text = unsafe { CStr::from_ptr(json) }.to_string_lossy().into_owned();
    let _ = sender.send(text);
}

/// The method's result, or its error's `(code, message)`.
pub async fn call(method: &str, options: &Value) -> Result<Value, (String, String)> {
    let bad = |message: &str| ("badRequest".to_owned(), message.to_owned());
    let method = CString::new(method).map_err(|_| bad("bad method"))?;
    let options = CString::new(options.to_string()).map_err(|_| bad("bad options"))?;
    let (sender, receiver) = mpsc::channel::<String>();
    let context = Box::into_raw(Box::new(sender)) as *mut c_void;

    // SAFETY: Swift copies both strings before it returns.
    unsafe { seance_apple_call(method.as_ptr(), options.as_ptr(), context, done) };

    // Translation and the download sheet take seconds; wait off the runtime.
    let text = tauri::async_runtime::spawn_blocking(move || receiver.recv())
        .await
        .ok()
        .and_then(Result::ok)
        .ok_or_else(|| ("failed".to_owned(), "no answer from AppleTranslate".to_owned()))?;
    let mut answer: Value = serde_json::from_str(&text).map_err(|_| ("failed".to_owned(), text.clone()))?;

    if let Some(ok) = answer.get_mut("ok") {
        return Ok(ok.take());
    }

    let err = answer.get("err");
    let field = |key: &str| {
        err.and_then(|e| e.get(key))
            .and_then(Value::as_str)
            .unwrap_or("failed")
            .to_owned()
    };
    Err((field("code"), field("message")))
}
