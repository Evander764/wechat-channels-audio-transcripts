// swift-tools-version: 6.0

import PackageDescription

let package = Package(
    name: "WeChatChannelsAudioMac",
    platforms: [
        .macOS(.v15)
    ],
    products: [
        .executable(name: "wcd-helper", targets: ["WCDHelper"])
    ],
    targets: [
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
