# Apple shells: one Swift package, one seam

The iOS shell (`shells/capacitor`) and the macOS shell (`shells/tauri`) run
the same page on the same engine (WKWebView) and can call the same Apple
frameworks. `shells/apple` is where that Swift lives; `SeanceTranslate` is
its only module so far. This plan is about making the next modules cheap and
**removing code** rather than adding it. The codebase is already large; each
step below has to leave less to read than it found.

Status (2026-10-31): a plan. Nothing in it is built except the macOS icon
(§ 6).

## 1. The rule

A feature goes in `shells/apple` when it uses an Apple-only framework **and
both** Apple shells need it. A feature every desktop needs goes in the Tauri
shell's Rust, so Windows and Linux get it too. Anything else stays where it
is.

## 2. Where things stand

What the page calls, and who answers it (`helpers/shell.ts` callers):

| Plugin                                                         | iOS                                    | macOS (Tauri)                                     |
| -------------------------------------------------------------- | -------------------------------------- | ------------------------------------------------- |
| `AppleTranslate`                                               | `shells/apple` via an adapter          | `shells/apple` via a C entry                      |
| `Power`                                                        | `PowerPlugin` in `SceneDelegate.swift` | nothing: the ps scene's Auto gets no power signal |
| `LocalNotifications`                                           | `@capacitor/local-notifications`       | nothing: no message alerts at all                 |
| `Badge`                                                        | `@capawesome/capacitor-badge`          | Rust (`set_badge_count`)                          |
| `App` (launch link, `appUrlOpen`)                              | Capacitor                              | Rust                                              |
| `Keyboard`, `StatusBar`, `SplashScreen`, `Haptics`             | Capacitor                              | not wanted on a desktop                           |
| `KeepAlive`, `NativePush`, `SystemAccessibility`, `SystemBars` | Android only                           | —                                                 |

The seam between Rust and Swift is narrow:

- `seance_apple_call(method, options, …)` carries no plugin name, and
  `lib.rs` names `AppleTranslate` by hand. A second module would need a
  second C symbol, a second Rust wrapper and a second branch.
- It is request and answer only. Swift cannot raise an event, and `Power`
  (`changed`) and notifications (a tap) both need to.
- On iOS each module is its own `CAPPlugin` class listing its methods by hand
  (`AppleTranslatePlugin.swift`, `PowerPlugin`).

## 3. Step 0: one router, one event path

Done once, after which a module is a Swift file and a line in a list.

- **Swift** (`shells/apple`): a `SeanceApple` router,
  `call(plugin, method, options) async throws -> [String: Any]`, and a `Host`
  protocol with the two things a module may ask of its shell: the view
  controller or window to show a sheet over, and `emit(plugin, event, data)`.
  `AppleTranslate`'s view-controller closure becomes the first of those.
- **iOS**: one generic `CAPPlugin` subclass, instantiated once per module
  with that module's `jsName` and method list, replacing
  `AppleTranslatePlugin` and `PowerPlugin`. Its `emit` is `notifyListeners`.
- **macOS**: `seance_apple_call(plugin, method, options, …)`, plus
  `seance_apple_listen(callback)` registered once at setup; Rust forwards
  each event through the `emit()` that `lib.rs` already has. `seance_call`
  hands any plugin in `apple::PLUGINS` to Swift instead of naming each one.

Net: `AppleTranslatePlugin.swift`, `PowerPlugin` and the per-module Rust
wrapper go; one adapter per shell stays.

## 4. Modules, in order

### 4.1 `Power`: the first module, and the test of the event path

`ProcessInfo.isLowPowerModeEnabled` and `NSProcessInfoPowerStateDidChange`
are the same API on macOS 12+. Move `PowerPlugin`'s body into `shells/apple`
unchanged, gated `#available(macOS 12, *)` (the package and `build.rs` say
10.15). The page's gate at `themeScene.ts` (`isIOSShell()`) goes, see § 5.

### 4.2 `LocalNotifications`: message alerts on the Mac

Desktop-shells § 4.2 already says the desktop must use this plugin, never the
web `Notification` API (WKWebView has none). Two ways:

- **(a) macOS only.** A Swift module answering the Capacitor plugin's
  methods and events (`checkPermissions`, `requestPermissions`, `schedule`,
  `removeDeliveredNotifications`, `localNotificationActionPerformed`).
  iOS keeps `@capacitor/local-notifications`. Least risk, nothing shared.
- **(b) Shared.** One `SeanceNotifications` over `UNUserNotificationCenter`
  that also replaces the Capacitor plugin on iOS. One implementation for
  both, one less third-party package in `CapApp-SPM` (whose `Package.swift`
  `yarn sync` keeps rewriting), and the page's alert code stops being
  iOS-shaped. The cost: the iOS path is tested on the phone (the bundled
  sound, banners in the foreground, one alert per conversation replaced in
  place, a tap opening the conversation) and would need that pass again.

Recommended: **(b)**, because it is the one that ends with less code. It
keeps the Capacitor plugin's shapes so `nativeAlerts.ts` changes only its
gates.

To check first: `UNUserNotificationCenter.current()` is said to abort in a
process outside an app bundle, which is what `cargo run` and the `--smoke`
and `--drive` runs are. If so, the module answers `unsupported` when
`Bundle.main.bundleIdentifier` is nil.

Windows and Linux need their own alerts (`tauri-plugin-notification`, in
Rust, behind the same plugin name). That is desktop-shells gate 4, not this
plan.

### 4.3 Held

- **Language detection** (`NLLanguageRecognizer`, a `detect` method on
  `SeanceTranslate`) for lines the page's own detector cannot place. Same
  API on both. Undecided; not built until it is.
- **Network changes and waking from sleep** (`NWPathMonitor`, the Mac's
  `NSWorkspace.didWakeNotification`) calling `reconnectAll()`. Only worth it
  if WKWebView's `online` and `visibilitychange` are measured missing them.

### 4.4 Not candidates

- `Badge` is already Rust on the desktop and works on Linux too.
- Keychain for `rememberPassword` (the password sits in localStorage today):
  worth doing, but a Rust keyring crate serves all three desktops, and the
  phones would need their own anyway.
- Tray, external links, close behaviour: Rust, every desktop.
- Phone-only and Android-only plugins (§ 2): nothing to share.

## 5. The page: ask, don't check the platform

`helpers/shell.ts` already promises that a plugin a shell lacks answers null.
Callers still gate on the platform as well, which is what makes every new
shell a hunt through the client:

- `themeScene.ts`: `if (isIOSShell())` around `Power`.
- `helpers/nativeAlerts.ts`: `isIOSShell()` in `nativeAlertsAvailable`,
  `ask`, `onNativeAlertTap`.
- `helpers/appBadge.ts`: `isIOSShell()` before the permission ask.
- `translate/index.ts`: `isIOSShell() || nativePlatform() === "macos"`.

Where the call itself can answer "not here", the gate goes. The gates that
stay are the ones that really mean a platform (Android's push service, the
iOS keyboard, the status bar). Done alongside each module, not as a sweep.

## 6. Done: the macOS icon

macOS draws an `.icns` as it is, so the deploy's full-bleed square logo
showed as a hard-edged square in the Dock. `shells/tauri/tools/icons.mjs`
(`yarn icons`) now makes the `.icns` again on a Mac from the logo cut to
Apple's rounded square (`tools/macos-icon.swift`: 824 on a 1024 grid, a
soft shadow); Windows and Linux keep the square. The logo is 512 px, so the
Mac icon is upscaled; a 1024 source in `public/img/` would sharpen it.

## 7. Order

1. Step 0 and `Power` together: the router, both adapters, the event path,
   `PowerPlugin` moved, the `themeScene.ts` gate gone. Checks: the iOS
   build on the phone (Translate still works, Low Power Mode still reaches
   the scene), the Mac (`--drive`: Translate, Low Power Mode toggled).
2. Notifications, (a) or (b) as decided, with its gates.
3. Anything from § 4.3 once decided.
