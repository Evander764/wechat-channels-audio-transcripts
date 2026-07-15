// swift-tools-version: 6.0

import PackageDescription

let package = Package(
    name: "WeChatChannelsDownloader",
    platforms: [
        .macOS(.v15)
    ],
    products: [
        .executable(name: "WeChatChannelsDownloader", targets: ["WeChatChannelsDownloader"]),
        .executable(name: "wcd-helper", targets: ["WCDHelper"])
    ],
    targets: [
        .executableTarget(
            name: "WeChatChannelsDownloader",
            dependencies: [],
            linkerSettings: [
                .linkedFramework("AppKit")
            ]
        ),
        .executableTarget(
            name: "WCDHelper",
            dependencies: [],
            linkerSettings: [
                .linkedFramework("AppKit"),
                .linkedFramework("AVFoundation"),
                .linkedFramework("CoreGraphics"),
                .linkedFramework("ScreenCaptureKit")
            ]
        )
    ]
)
