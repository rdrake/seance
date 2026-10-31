# SeanceApple

Swift shared by the iOS shell (`shells/capacitor`) and the macOS shell
(`shells/tauri`), as one module, `SeanceApple`: every plugin the two shells
have in common, by the name the page calls it (`client/js/helpers/shell.ts`).

- `AppleTranslate` (`AppleTranslate.swift`) — Apple's Translation framework
  for the page's translator (`client/js/translate/engines/apple.ts`).
- `Power` (`Power.swift`) — Low Power Mode, for the ps scene's Auto
  (`client/js/themeScene.ts`); event `changed`.
- `LocalNotifications` (`Notifications.swift`) — the page's message alerts
  (`client/js/helpers/nativeAlerts.ts`), with the shapes of Capacitor's plugin
  it replaced; event `localNotificationActionPerformed`, held until the page
  listens. Not outside an app bundle (`cargo run` answers `unsupported`).

`SeanceApple.swift` is the router: `SeanceApple.plugins` lists every plugin
and its methods, `call(plugin, method, options)` answers them, and
`ShellHost` is what a plugin may ask of its shell — where to show a sheet,
and `emit` for an event (`retain`: one the user caused outside the page,
which waits for a listener and brings the app forward). **A new plugin is a
file here and a line in `plugins`**; neither shell changes.

Each shell keeps one adapter:

- iOS: `shells/capacitor/ios/App/App/SeanceApplePlugin.swift` registers one
  Capacitor plugin per name, every method routed to the router, and hands
  events to `notifyListeners`.
- macOS: `shells/tauri/src-tauri/swift/Sources/SeanceTauri/Bridge.swift`,
  two C entry points (`seance_apple_start`, `seance_apple_call`) that
  `src/apple.rs` calls; anything the Rust shell does not answer itself goes
  here, and events come back through the shell's `emit`.

The iOS project references this directory as a local package; the macOS
shell's `swift/Package.swift` depends on it by path. Nothing in `yarn test`
builds either: after a change, build both — `shells/capacitor/tools/ios-device.sh`
(or an Xcode build) and `cargo build` in `shells/tauri/src-tauri`.
