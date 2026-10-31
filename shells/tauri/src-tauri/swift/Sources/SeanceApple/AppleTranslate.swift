import AppKit
import Foundation
import SwiftUI
import Translation

// `AppleTranslate` for the macOS shell: Apple's Translation framework for the
// page's translator (client/js/translate/engines/apple.ts), the same four
// methods as the iOS shell's plugin
// (shells/capacitor/ios/App/App/AppleTranslatePlugin.swift), which documents
// them. Reached from Rust (src/apple.rs) through one C entry point: the method
// and its options as JSON in, `{"ok": result}` or `{"err": {code, message}}`
// as JSON out, through a callback that may come on any thread.
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
        let text = String(decoding: data, as: UTF8.self)
        text.withCString { done(context, $0) }
    }
    let resolve: ([String: Any]) -> Void = { answer(["ok": $0]) }
    let reject: (String, String) -> Void = { code, message in answer(["err": ["code": code, "message": message]]) }

    guard let options = (try? JSONSerialization.jsonObject(with: Data(json.utf8))) as? [String: Any] else {
        reject("badRequest", "options must be a JSON object")
        return
    }

    guard #available(macOS 26.0, *) else {
        switch method {
        case "availability", "prepare": resolve(["status": "unsupported"])
        case "languages": resolve(["languages": [String]()])
        default: reject("unsupported", "Apple Translation needs macOS 26")
        }
        return
    }

    AppleTranslate.shared.call(method, options, resolve: resolve, reject: reject)
}

@available(macOS 26.0, *)
final class AppleTranslate {
    static let shared = AppleTranslate()
    private let translator = SerialTranslator()

    func call(_ method: String, _ options: [String: Any], resolve: @escaping ([String: Any]) -> Void, reject: @escaping (String, String) -> Void) {
        let high = options["strategy"] as? String == "high"

        if method == "languages" {
            Task {
                let supported = await LanguageAvailability().supportedLanguages
                var seen = Set<String>()
                let codes = supported.compactMap { $0.languageCode?.identifier }.filter { seen.insert($0).inserted }
                resolve(["languages": codes.sorted()])
            }
            return
        }

        guard ["availability", "translate", "prepare"].contains(method) else {
            reject("unimplemented", "AppleTranslate.\(method) is not implemented")
            return
        }
        guard let from = options["from"] as? String, let to = options["to"] as? String else {
            reject("badRequest", "from and to are required")
            return
        }
        let source = Locale.Language(identifier: from)
        let target = Locale.Language(identifier: to)

        switch method {
        case "availability":
            Task { resolve(["status": await Self.status(from: source, to: target, high: high)]) }
        case "translate":
            guard let lines = options["lines"] as? [String] else {
                reject("badRequest", "lines must be an array of strings")
                return
            }
            let skip = options["skip"] as? Bool ?? false
            Task {
                do {
                    resolve(["lines": try await translator.translate(lines, from: source, to: target, high: high, skip: skip)])
                } catch {
                    let (code, message) = Self.describe(error)
                    reject(code, message)
                }
            }
        case "prepare":
            prepare(from: source, to: target, high: high, resolve: resolve, reject: reject)
        default:
            break
        }
    }

    /// The download question: `.translationTask` hands its action a session
    /// that may ask to download, and `prepareTranslation()` shows the system's
    /// sheet. It needs a SwiftUI view in a window, so a 1×1 clear one joins the
    /// app's window for the length of the question.
    private func prepare(from: Locale.Language, to: Locale.Language, high: Bool, resolve: @escaping ([String: Any]) -> Void, reject: @escaping (String, String) -> Void) {
        DispatchQueue.main.async {
            guard let content = (NSApp.keyWindow ?? NSApp.mainWindow ?? NSApp.windows.first)?.contentView else {
                reject("noView", "no window to present from")
                return
            }

            var host: NSView?
            let view = PrepareView(source: from, target: to, high: high) { error in
                DispatchQueue.main.async {
                    host?.removeFromSuperview()
                    host = nil
                }
                Task {
                    let status = await Self.status(from: from, to: to, high: high)
                    if let error, status != "installed" {
                        let (code, message) = Self.describe(error)
                        resolve(["status": status, "error": code, "message": message])
                    } else {
                        resolve(["status": status])
                    }
                }
            }
            let hosting = NSHostingView(rootView: view)
            hosting.frame = NSRect(x: 0, y: 0, width: 1, height: 1)
            content.addSubview(hosting)
            host = hosting
        }
    }

    static func status(from: Locale.Language, to: Locale.Language, high: Bool) async -> String {
        let availability: LanguageAvailability
        if #available(macOS 26.4, *) {
            availability = LanguageAvailability(preferredStrategy: high ? .highFidelity : .lowLatency)
        } else {
            availability = LanguageAvailability()
        }
        switch await availability.status(from: from, to: to) {
        case .installed: return "installed"
        case .supported: return "supported"
        case .unsupported: return "unsupported"
        @unknown default: return "unsupported"
        }
    }

    static func describe(_ error: Error) -> (String, String) {
        let code: String
        if TranslationError.notInstalled ~= error {
            code = "notInstalled"
        } else if TranslationError.unsupportedLanguagePairing ~= error
            || TranslationError.unsupportedSourceLanguage ~= error
            || TranslationError.unsupportedTargetLanguage ~= error {
            code = "unsupported"
        } else if TranslationError.nothingToTranslate ~= error {
            code = "nothingToTranslate"
        } else if TranslationError.unableToIdentifyLanguage ~= error {
            code = "unableToIdentifyLanguage"
        } else if error is CancellationError || TranslationError.alreadyCancelled ~= error {
            code = "cancelled"
        } else {
            code = "failed"
        }
        return (code, error.localizedDescription)
    }
}

/// One request at a time, in the order they came, with a session kept per
/// pair and strategy (the iOS plugin's, which says why).
@available(macOS 26.0, *)
actor SerialTranslator {
    private var sessions: [String: TranslationSession] = [:]
    private var tail: Task<Void, Never>?

    func translate(_ lines: [String], from: Locale.Language, to: Locale.Language, high: Bool, skip: Bool) async throws -> [String] {
        let previous = tail
        let job = Task { () throws -> [String] in
            await previous?.value
            return try await self.run(lines, from: from, to: to, high: high, skip: skip)
        }
        tail = Task { _ = try? await job.value }
        return try await job.value
    }

    private func session(from: Locale.Language, to: Locale.Language, high: Bool) -> TranslationSession {
        let key = "\(from.maximalIdentifier)>\(to.maximalIdentifier)>\(high)"
        if let session = sessions[key] { return session }
        let session: TranslationSession
        if #available(macOS 26.4, *) {
            session = TranslationSession(installedSource: from, target: to, preferredStrategy: high ? .highFidelity : .lowLatency)
        } else {
            session = TranslationSession(installedSource: from, target: to)
        }
        sessions[key] = session
        return session
    }

    private func run(_ lines: [String], from: Locale.Language, to: Locale.Language, high: Bool, skip: Bool) async throws -> [String] {
        let session = session(from: from, to: to, high: high)
        guard await session.isReady else { throw TranslationError.notInstalled }

        var requests: [TranslationSession.Request] = []
        for (i, line) in lines.enumerated() {
            if skip, #available(macOS 26.4, *) {
                requests.append(TranslationSession.Request(sourceText: protectPlaceholders(line), clientIdentifier: String(i)))
            } else {
                requests.append(TranslationSession.Request(sourceText: line, clientIdentifier: String(i)))
            }
        }

        var out = lines
        do {
            for response in try await session.translations(from: requests) {
                if let id = response.clientIdentifier, let i = Int(id) {
                    out[i] = response.targetText
                }
            }
        } catch {
            // One line the framework will not take fails the whole batch: the
            // lines go again one at a time, and a line with nothing to
            // translate stays as it is.
            if TranslationError.notInstalled ~= error { throw error }
            for (i, request) in requests.enumerated() {
                do {
                    out[i] = try await session.translations(from: [request]).first?.targetText ?? lines[i]
                } catch where TranslationError.nothingToTranslate ~= error {
                    out[i] = lines[i]
                }
            }
        }
        return out
    }
}

/// `⟦n⟧` runs marked `skipsTranslation`: the page's placeholders for nicks,
/// URLs, code and line prefixes (client/js/translate/spans.ts).
@available(macOS 26.4, *)
func protectPlaceholders(_ line: String) -> AttributedString {
    var text = AttributedString(line)
    for match in line.matches(of: #/⟦[0-9]+⟧/#) {
        if let lo = AttributedString.Index(match.range.lowerBound, within: text),
           let hi = AttributedString.Index(match.range.upperBound, within: text) {
            text[lo..<hi].translation.skipsTranslation = true
        }
    }
    return text
}

/// The download question's host (the iOS plugin's `PrepareView`).
@available(macOS 26.0, *)
struct PrepareView: View {
    let source: Locale.Language
    let target: Locale.Language
    let high: Bool
    let done: (Error?) -> Void
    @State private var configuration: TranslationSession.Configuration?

    var body: some View {
        Color.clear
            .frame(width: 1, height: 1)
            .translationTask(configuration) { session in
                do {
                    try await session.prepareTranslation()
                    done(nil)
                } catch {
                    done(error)
                }
            }
            .onAppear {
                if #available(macOS 26.4, *) {
                    configuration = .init(source: source, target: target, preferredStrategy: high ? .highFidelity : .lowLatency)
                } else {
                    configuration = .init(source: source, target: target)
                }
            }
    }
}
