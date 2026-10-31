import AppKit
import Foundation
import SeanceApple

// The macOS shell's adapter for the Apple shells' plugins (shells/apple,
// which documents them), reached from Rust (src/apple.rs) through two C entry
// points:
//
// - `seance_apple_start(event)`, once at setup: makes the plugins and gives
//   them `event(plugin, name, json, retain)` for what they tell the page, on
//   the main thread (`retain`: ShellHost.emit).
// - `seance_apple_call(plugin, method, options, context, done)`: the options
//   as JSON in, `{"ok": result}` or `{"err": {code, message}}` as JSON out,
//   through `done(context, json)`, which may come on any thread.

public typealias SeanceAppleDone = @convention(c) (UnsafeMutableRawPointer?, UnsafePointer<CChar>) -> Void
public typealias SeanceAppleEvent = @convention(c) (UnsafePointer<CChar>, UnsafePointer<CChar>, UnsafePointer<CChar>, Bool) -> Void

@_cdecl("seance_apple_start")
public func seanceAppleStart(_ event: SeanceAppleEvent) {
    let host = TauriHost(event: event)
    Shared.host = host
    Shared.plugins = SeanceApple(host: host)
}

@_cdecl("seance_apple_call")
public func seanceAppleCall(
    _ plugin: UnsafePointer<CChar>,
    _ method: UnsafePointer<CChar>,
    _ options: UnsafePointer<CChar>,
    _ context: UnsafeMutableRawPointer?,
    _ done: SeanceAppleDone
) {
    let plugin = String(cString: plugin)
    let method = String(cString: method)
    let json = String(cString: options)
    let answer: (Any) -> Void = { value in
        String(decoding: encode(value), as: UTF8.self).withCString { done(context, $0) }
    }
    let reject: (String, String) -> Void = { code, message in answer(["err": ["code": code, "message": message]]) }

    guard let plugins = Shared.plugins else {
        reject("unavailable", "the Apple plugins have not started")
        return
    }
    guard let options = (try? JSONSerialization.jsonObject(with: Data(json.utf8))) as? [String: Any] else {
        reject("badRequest", "options must be a JSON object")
        return
    }

    Task {
        do {
            answer(["ok": try await plugins.call(plugin, method, options)])
        } catch let failure as Failure {
            reject(failure.code, failure.message)
        } catch {
            reject("failed", error.localizedDescription)
        }
    }
}

private func encode(_ value: Any) -> Data {
    (try? JSONSerialization.data(withJSONObject: value))
        ?? Data("{\"err\":{\"code\":\"failed\",\"message\":\"unencodable\"}}".utf8)
}

private enum Shared {
    static var host: TauriHost?
    static var plugins: SeanceApple?
}

private final class TauriHost: ShellHost {
    let event: SeanceAppleEvent

    init(event: @escaping SeanceAppleEvent) {
        self.event = event
    }

    /// A sheet goes over the app's window.
    @MainActor func presenter() -> Presenter? {
        (NSApp.keyWindow ?? NSApp.mainWindow ?? NSApp.windows.first)?.contentView
    }

    func emit(_ plugin: String, _ name: String, _ data: [String: Any], retain: Bool) {
        let json = String(decoding: encode(data), as: UTF8.self)
        plugin.withCString { p in name.withCString { n in json.withCString { d in event(p, n, d, retain) } } }
    }
}
