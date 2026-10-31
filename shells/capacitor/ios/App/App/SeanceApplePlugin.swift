import Capacitor
import SeanceApple

/// The Apple shells' plugins for the iOS shell (shells/apple, which documents
/// them): one Capacitor plugin per name in `SeanceApple.plugins`, every call
/// answered by one `SeanceApple`. This adapter only passes a call's options in
/// and its answer back, shows sheets over the bridge's view controller and
/// hands events to the plugin they belong to.
final class SeanceAppleShell: ShellHost {
    private weak var bridge: CAPBridgeProtocol?
    private var plugins: [String: SeanceApplePlugin] = [:]
    private lazy var apple = SeanceApple(host: self)

    /// Registers every plugin on `bridge`. The bridge's view controller keeps
    /// the result.
    init(bridge: CAPBridgeProtocol) {
        self.bridge = bridge
        for (name, methods) in SeanceApple.plugins {
            let plugin = SeanceApplePlugin(name: name, methods: methods, shell: self)
            plugins[name] = plugin
            bridge.registerPluginInstance(plugin)
        }
        _ = apple
    }

    @MainActor func presenter() -> Presenter? {
        bridge?.viewController
    }

    func emit(_ plugin: String, _ event: String, _ data: [String: Any]) {
        plugins[plugin]?.notifyListeners(event, data: data)
    }

    fileprivate func run(_ plugin: String, _ call: CAPPluginCall) {
        var options: [String: Any] = [:]
        for (key, value) in call.options {
            if let key = key as? String { options[key] = value }
        }

        Task {
            do {
                call.resolve(try await apple.call(plugin, call.methodName, options))
            } catch let failure as Failure {
                call.reject(failure.message, failure.code)
            } catch {
                call.reject(error.localizedDescription, "failed", error)
            }
        }
    }
}

/// One plugin's name and methods, every method routed to `run`.
final class SeanceApplePlugin: CAPPlugin, CAPBridgedPlugin {
    let identifier: String
    let jsName: String
    let pluginMethods: [CAPPluginMethod]
    private unowned let shell: SeanceAppleShell

    init(name: String, methods: [String], shell: SeanceAppleShell) {
        identifier = name + "Plugin"
        jsName = name
        pluginMethods = methods.map { method in
            let entry: CAPPluginMethod = CAPPluginMethod(name: method, returnType: CAPPluginReturnPromise)
            entry.selector = #selector(SeanceApplePlugin.run(_:))
            return entry
        }
        self.shell = shell
        super.init()
    }

    @objc func run(_ call: CAPPluginCall) {
        shell.run(jsName, call)
    }
}
