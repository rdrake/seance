import AppKit
import Foundation
import SeanceTranslate

// `AppleTranslate` for the macOS shell, over the shared `SeanceTranslate`
// package (shells/apple), which documents the methods. Reached from Rust
// (src/apple.rs) through one C entry point: the method and its options as
// JSON in, `{"ok": result}` or `{"err": {code, message}}` as JSON out, through
// a callback that may come on any thread.
//
// The framework's sessions are macOS 26; on anything older every pair is
// `unsupported` and the page keeps its own engines.

public typealias SeanceAppleDone = @convention(c) (UnsafeMutableRawPointer?, UnsafePointer<CChar>) -> Void

@_cdecl("seance_apple_call")
public func seanceAppleCall(
    _ method: UnsafePointer<CChar>,
    _ options: UnsafePointer<CChar>,
    _ context: UnsafeMutableRawPointer?,
    _ done: SeanceAppleDone
) {
    let method = String(cString: method)
    let json = String(cString: options)
    let answer: (Any) -> Void = { value in
        let data = (try? JSONSerialization.data(withJSONObject: value)) ?? Data("{\"err\":{\"code\":\"failed\",\"message\":\"unencodable\"}}".utf8)
        String(decoding: data, as: UTF8.self).withCString { done(context, $0) }
    }
    let reject: (String, String) -> Void = { code, message in answer(["err": ["code": code, "message": message]]) }

    guard let options = (try? JSONSerialization.jsonObject(with: Data(json.utf8))) as? [String: Any] else {
        reject("badRequest", "options must be a JSON object")
        return
    }

    guard #available(macOS 26.0, *) else {
        switch method {
        case "availability", "prepare": answer(["ok": ["status": "unsupported"]])
        case "languages": answer(["ok": ["languages": [String]()]])
        default: reject("unsupported", "Apple Translation needs macOS 26")
        }
        return
    }

    Task {
        do {
            answer(["ok": try await Shared.engine.call(method, options)])
        } catch let failure as AppleTranslate.Failure {
            reject(failure.code, failure.message)
        } catch {
            reject("failed", error.localizedDescription)
        }
    }
}

@available(macOS 26.0, *)
private enum Shared {
    /// The download sheet goes over the app's window.
    static let engine = AppleTranslate {
        (NSApp.keyWindow ?? NSApp.mainWindow ?? NSApp.windows.first)?.contentView
    }
}
