import Foundation

/// `Power`: Low Power Mode, for the ps scene's Auto (client/js/themeScene.ts).
/// WebKit holds a Safari page to 30 fps in Low Power Mode but not a shell's
/// web view (measured on iOS 2026-10-17), so the shell has to say it. macOS
/// has the mode from 12 on; an older Mac answers false.
///
/// - `status()`: `{lowPower}`.
/// - event `changed`: the same, whenever it changes.
final class Power {
    static let methods = ["status"]

    private var observer: NSObjectProtocol?

    init(changed: @escaping ([String: Any]) -> Void) {
        guard #available(macOS 12.0, *) else { return }
        // Posted on an arbitrary thread; answered on the main one.
        observer = NotificationCenter.default.addObserver(
            forName: .NSProcessInfoPowerStateDidChange, object: nil, queue: .main
        ) { _ in changed(Power.status()) }
    }

    deinit {
        if let observer { NotificationCenter.default.removeObserver(observer) }
    }

    static func status() -> [String: Any] {
        guard #available(macOS 12.0, *) else { return ["lowPower": false] }
        return ["lowPower": ProcessInfo.processInfo.isLowPowerModeEnabled]
    }
}
