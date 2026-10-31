// swift-tools-version:5.9
// Seance's Swift code shared by the Apple shells: the iOS shell
// (shells/capacitor, a local package of App.xcodeproj) and the macOS shell
// (shells/tauri, through its swift/ package, built by build.rs). Each shell
// keeps only its adapter: how a call arrives and where a sheet is shown.
import PackageDescription

let package = Package(
    name: "SeanceApple",
    platforms: [.iOS("26.0"), .macOS(.v10_15)],
    products: [
        .library(name: "SeanceApple", targets: ["SeanceApple"]),
    ],
    targets: [
        .target(name: "SeanceApple"),
    ],
    swiftLanguageVersions: [.v5]
)
