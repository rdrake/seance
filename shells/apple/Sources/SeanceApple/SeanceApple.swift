import Foundation
#if os(iOS)
import UIKit
#elseif os(macOS)
import AppKit
#endif

/// Where a module shows a system sheet: a view controller (iOS) or a view in
/// a window (macOS).
#if os(iOS)
public typealias Presenter = UIViewController
#elseif os(macOS)
public typealias Presenter = NSView
#endif

/// What a module may ask of the shell around it.
public protocol ShellHost: AnyObject {
    /// Where a sheet is shown; nil when there is none.
    @MainActor func presenter() -> Presenter?
    /// Hands the page a plugin's event. Called on the main thread. A
    /// `retain`ed event is one the user caused outside the page (a click on an
    /// alert): it waits until the page listens, and the app comes forward.
    func emit(_ plugin: String, _ event: String, _ data: [String: Any], retain: Bool)
}

/// A refused call: the page's `NativeCallError` reads both.
public struct Failure: Error {
    public let code: String
    public let message: String

    public init(code: String, message: String) {
        self.code = code
        self.message = message
    }
}

/// Seance's Swift plugins for the Apple shells, by the name the page calls
/// them (client/js/helpers/shell.ts). Each shell keeps one adapter that hands
/// `call` the plugin, the method and its options and answers its page with
/// the result or the failure's code and message, and that implements
/// `ShellHost`. A new plugin is a file here and a line in `plugins`.
public final class SeanceApple {
    /// Every plugin and its methods, for an adapter that has to declare them.
    public static let plugins: [String: [String]] = [
        "AppleTranslate": ["availability", "translate", "prepare", "languages"],
        "LocalNotifications": Notifications.methods,
        "Power": Power.methods,
    ]

    private let power: Power
    private let notifications: Notifications
    /// `AppleTranslate` from 26 on, nil before.
    private let translate: AnyObject?

    public init(host: ShellHost) {
        power = Power { [weak host] data in host?.emit("Power", "changed", data, retain: false) }
        notifications = Notifications { [weak host] data in
            host?.emit("LocalNotifications", "localNotificationActionPerformed", data, retain: true)
        }

        if #available(iOS 26.0, macOS 26.0, *) {
            translate = AppleTranslate { [weak host] in host?.presenter() }
        } else {
            translate = nil
        }
    }

    public func call(_ plugin: String, _ method: String, _ options: [String: Any]) async throws -> [String: Any] {
        guard Self.plugins[plugin]?.contains(method) == true else {
            throw Failure(code: "unimplemented", message: "\(plugin).\(method) is not implemented")
        }

        switch plugin {
        case "Power":
            return Power.status()
        case "LocalNotifications":
            return try await notifications.call(method, options)
        default:
            if #available(iOS 26.0, macOS 26.0, *), let engine = translate as? AppleTranslate {
                return try await engine.call(method, options)
            }
            switch method {
            case "languages": return ["languages": [String]()]
            case "translate": throw Failure(code: "unsupported", message: "Apple Translation needs macOS 26")
            default: return ["status": "unsupported"]
            }
        }
    }
}
