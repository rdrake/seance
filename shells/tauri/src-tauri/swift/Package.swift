// swift-tools-version:5.9
// The macOS shell's Swift code (src/apple.rs), built and linked by build.rs
// through swift-rs.
import PackageDescription

let package = Package(
    name: "SeanceApple",
    platforms: [.macOS(.v10_15)],
    products: [
        .library(name: "SeanceApple", type: .static, targets: ["SeanceApple"]),
    ],
    targets: [
        .target(name: "SeanceApple", path: "Sources/SeanceApple"),
    ]
)
