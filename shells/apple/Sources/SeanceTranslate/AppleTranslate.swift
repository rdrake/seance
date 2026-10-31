import SwiftUI
import Translation
#if os(iOS)
import UIKit
#elseif os(macOS)
import AppKit
#endif

/// `AppleTranslate`: Apple's Translation framework for the page's translator
/// (client/js/translate/engines/apple.ts), so a line is translated by the
/// system's own language packs instead of a model the page downloads.
///
/// - `availability({from, to, strategy?})`: `{status}` — `installed`,
///   `supported` (the pair exists, its pack is not downloaded) or
///   `unsupported`.
/// - `translate({lines, from, to, strategy?, skip?})`: `{lines}`, one
///   translation per line, in order. `skip` marks every `⟦n⟧` placeholder
///   `skipsTranslation`, so the engine never sees inside one (26.4+).
/// - `prepare({from, to, strategy?})`: asks the user to download the pair's
///   pack in the system's own sheet, then `{status}` as `availability` says it.
/// - `languages()`: `{languages}`, the language codes (ISO 639) the framework
///   translates, once each.
///
/// `strategy` is `low` (the default: the downloaded packs, ~80 ms a line) or
/// `high` (Apple's on-device 3B model, 13–27× slower). Before 26.4 there is no
/// strategy and the session takes the system's default.
///
/// Sessions are made with `installedSource`, which never downloads: a pair
/// without its pack fails with code `notInstalled` until `prepare` has run.
/// The translation daemon serves one request at a time (measured: parallel
/// requests took no less time), so every request waits for the one before.
///
/// A shell's adapter hands `call` the method and its options and answers its
/// page with the result or the error's code and message.
@available(iOS 26.0, macOS 26.0, *)
public final class AppleTranslate {
    /// Where `prepare`'s sheet is shown: a view controller (iOS) or a view in
    /// a window (macOS); nil when there is none.
    #if os(iOS)
    public typealias Host = UIViewController
    #elseif os(macOS)
    public typealias Host = NSView
    #endif

    public struct Failure: Error {
        public let code: String
        public let message: String
    }

    public static let methods = ["availability", "translate", "prepare", "languages"]

    private let translator = SerialTranslator()
    private let host: @MainActor () -> Host?

    public init(host: @escaping @MainActor () -> Host?) {
        self.host = host
    }

    public func call(_ method: String, _ options: [String: Any]) async throws -> [String: Any] {
        guard Self.methods.contains(method) else {
            throw Failure(code: "unimplemented", message: "AppleTranslate.\(method) is not implemented")
        }

        if method == "languages" {
            let supported = await LanguageAvailability().supportedLanguages
            var seen = Set<String>()
            let codes = supported.compactMap { $0.languageCode?.identifier }.filter { seen.insert($0).inserted }
            return ["languages": codes.sorted()]
        }

        guard let from = options["from"] as? String, let to = options["to"] as? String else {
            throw Failure(code: "badRequest", message: "from and to are required")
        }
        let source = Locale.Language(identifier: from)
        let target = Locale.Language(identifier: to)
        let high = options["strategy"] as? String == "high"

        switch method {
        case "availability":
            return ["status": await Self.status(from: source, to: target, high: high)]
        case "translate":
            guard let lines = options["lines"] as? [String] else {
                throw Failure(code: "badRequest", message: "lines must be an array of strings")
            }
            let skip = options["skip"] as? Bool ?? false
            do {
                return ["lines": try await translator.translate(lines, from: source, to: target, high: high, skip: skip)]
            } catch {
                throw Self.describe(error)
            }
        default:
            return try await prepare(from: source, to: target, high: high)
        }
    }

    /// The download question: `.translationTask` hands its action a session
    /// that may ask to download (`canRequestDownloads`), and
    /// `prepareTranslation()` is what shows the sheet. It needs a SwiftUI view
    /// in the window, so a 1×1 clear one is added for the length of the
    /// question.
    private func prepare(from: Locale.Language, to: Locale.Language, high: Bool) async throws -> [String: Any] {
        let error: Error? = try await withCheckedThrowingContinuation { continuation in
            Task { @MainActor in
                guard let parent = host() else {
                    continuation.resume(throwing: Failure(code: "noView", message: "no view to present from"))
                    return
                }

                var detach: (() -> Void)?
                let view = PrepareView(source: from, target: to, high: high) { error in
                    Task { @MainActor in
                        detach?()
                        detach = nil
                    }
                    continuation.resume(returning: error)
                }
                detach = Self.attach(view, to: parent)
            }
        }

        let status = await Self.status(from: from, to: to, high: high)
        if let error, status != "installed" {
            let failure = Self.describe(error)
            return ["status": status, "error": failure.code, "message": failure.message]
        }
        return ["status": status]
    }

    /// Adds `view` to `parent`, 1×1 and clear; returns what takes it away.
    @MainActor
    private static func attach(_ view: PrepareView, to parent: Host) -> () -> Void {
        #if os(iOS)
        let controller = UIHostingController(rootView: view)
        controller.view.backgroundColor = .clear
        controller.view.frame = CGRect(x: 0, y: 0, width: 1, height: 1)
        controller.view.isUserInteractionEnabled = false
        parent.addChild(controller)
        parent.view.addSubview(controller.view)
        controller.didMove(toParent: parent)
        return {
            controller.willMove(toParent: nil)
            controller.view.removeFromSuperview()
            controller.removeFromParent()
        }
        #elseif os(macOS)
        let hosting = NSHostingView(rootView: view)
        hosting.frame = NSRect(x: 0, y: 0, width: 1, height: 1)
        parent.addSubview(hosting)
        return { hosting.removeFromSuperview() }
        #endif
    }

    static func status(from: Locale.Language, to: Locale.Language, high: Bool) async -> String {
        let availability: LanguageAvailability
        if #available(iOS 26.4, macOS 26.4, *) {
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

    static func describe(_ error: Error) -> Failure {
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
        // The framework's description alone is often just "Unable to
        // Translate"; its failure reason says why.
        var message = error.localizedDescription
        if let reason = (error as? LocalizedError)?.failureReason, !reason.isEmpty, reason != message {
            message += " (\(reason))"
        }
        return Failure(code: code, message: message)
    }
}

/// One request at a time, in the order they came, with a session kept per
/// pair and strategy. An actor alone would not do: its methods interleave at
/// every `await`, so each request first waits for the one queued before it.
@available(iOS 26.0, macOS 26.0, *)
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
        if #available(iOS 26.4, macOS 26.4, *) {
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
            if skip, #available(iOS 26.4, macOS 26.4, *) {
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
            // One line the framework will not take fails the whole batch, so
            // the lines go again one at a time. A line with nothing to
            // translate (a placeholder or an emoji alone) stays as it is;
            // any other failure is the request's.
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
@available(iOS 26.4, macOS 26.4, *)
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

/// The download question's host: `.translationTask` runs its action once the
/// configuration is set, with a session that may ask the user to download.
@available(iOS 26.0, macOS 26.0, *)
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
                if #available(iOS 26.4, macOS 26.4, *) {
                    configuration = .init(source: source, target: target, preferredStrategy: high ? .highFidelity : .lowLatency)
                } else {
                    configuration = .init(source: source, target: target)
                }
            }
    }
}
