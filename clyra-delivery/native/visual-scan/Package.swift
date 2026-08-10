// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "visual-scan",
    platforms: [.macOS(.v13)],
    products: [
        .executable(name: "visual-scan", targets: ["VisualScan"]),
    ],
    targets: [
        .executableTarget(
            name: "VisualScan",
            path: "Sources/VisualScan"
        ),
    ]
)
