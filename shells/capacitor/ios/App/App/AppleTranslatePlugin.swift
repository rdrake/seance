import Capacitor
import SeanceTranslate

/// `AppleTranslate` for the iOS shell: a Capacitor plugin over the shared
/// `SeanceTranslate` package (shells/apple), which documents the methods.
/// This adapter only passes a call's options in and its answer back, and
/// shows the download sheet over the bridge's view controller.
class AppleTranslatePlugin: CAPPlugin, CAPBridgedPlugin {
    let identifier = "AppleTranslatePlugin"
    let jsName = "AppleTranslate"
    let pluginMethods: [CAPPluginMethod] = AppleTranslate.methods.map { CAPPluginMethod(name: $0, returnType: CAPPluginReturnPromise) }

    private lazy var engine = AppleTranslate { [weak self] in self?.bridge?.viewController }

    @objc func availability(_ call: CAPPluginCall) { run("availability", call) }
    @objc func translate(_ call: CAPPluginCall) { run("translate", call) }
    @objc func prepare(_ call: CAPPluginCall) { run("prepare", call) }
    @objc func languages(_ call: CAPPluginCall) { run("languages", call) }

    private func run(_ method: String, _ call: CAPPluginCall) {
        var options: [String: Any] = [:]
        for (key, value) in call.options {
            if let key = key as? String { options[key] = value }
        }

        Task {
            do {
                call.resolve(try await engine.call(method, options))
            } catch let failure as AppleTranslate.Failure {
                call.reject(failure.message, failure.code)
            } catch {
                call.reject(error.localizedDescription, "failed", error)
            }
        }
    }
}
