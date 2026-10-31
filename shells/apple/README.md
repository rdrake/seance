# SeanceApple

Swift shared by the iOS shell (`shells/capacitor`) and the macOS shell
(`shells/tauri`). Each shell keeps a thin adapter; everything else lives here.

- `SeanceTranslate` — `AppleTranslate`, Apple's Translation framework for the
  page's translator (`client/js/translate/engines/apple.ts`). The adapters:
  `shells/capacitor/ios/App/App/AppleTranslatePlugin.swift` (a Capacitor
  plugin) and `shells/tauri/src-tauri/swift/` (a C entry point for
  `src/apple.rs`).

The iOS project references this directory as a local package; the macOS
shell's `swift/Package.swift` depends on it by path. Build both after a change
here: `shells/capacitor/tools/ios-device.sh` (or an Xcode build) and
`cargo build` in `shells/tauri/src-tauri`.
