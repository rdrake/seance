// swift-tools-version:5.9
// The macOS shell's Swift: a C entry point (src/apple.rs) over the Apple
// shells' shared package (shells/apple), built and linked by build.rs through
// swift-rs.
import PackageDescription

let package = Package(
    name: "SeanceTauri",
    platforms: [.macOS(.v10_15)],
    products: [
        .library(name: "SeanceTauri", type: .static, targets: ["SeanceTauri"]),
    ],
    dependencies: [
        .package(name: "SeanceApple", path: "../../../apple"),
    ],
    targets: [
        .target(name: "SeanceTauri", dependencies: [.product(name: "SeanceTranslate", package: "SeanceApple")]),
    ],
    swiftLanguageVersions: [.v5]
)
