# Install And Run With Codex

This guide is for users who want Codex to clone, build, and run the WeChat Channels Downloader on a Mac.

## What This Tool Does

It captures media requests from WeChat Channels while the target video is playable in the logged-in WeChat desktop app, then saves audio-only `.m4a` files.

It does not bypass paid access, DRM, account restrictions, private content, or platform protection.

## Requirements

- macOS 15 or newer.
- WeChat desktop installed and logged in.
- Xcode Command Line Tools or Xcode.
- Python 3.11.
- FFmpeg and FFprobe on `PATH`.

Recommended install commands:

```bash
xcode-select --install
brew install python@3.11 ffmpeg
```

## Codex Setup

Ask Codex to run:

```bash
git clone https://github.com/Evander764/wechat-channels-downloader-mac.git
cd wechat-channels-downloader-mac
swift build -c release
.build/release/wcd-helper bootstrap --json
.build/release/wcd-helper cert install --json
.build/release/wcd-helper doctor --json
```

`doctor` should report `ok: true` or list the missing local dependency.

## Download A Playable Video

Ask Codex to run:

```bash
.build/release/wcd-helper proxy start --json
```

Then open WeChat desktop and play the target WeChat Channels video long enough for media requests to load.

Ask Codex to inspect captures:

```bash
.build/release/wcd-helper captures tail --json
```

Pick a capture ID from the output, then download audio:

```bash
.build/release/wcd-helper download --capture-id CAPTURE_ID --json
```

Always stop the proxy when finished:

```bash
.build/release/wcd-helper proxy stop --json
```

Downloads are saved to:

```text
~/Movies/WeChat Channels Downloads/
```

## Recording Fallback

If no media capture appears but the video is audible in WeChat, ask Codex to run:

```bash
.build/release/wcd-helper record-current --duration-seconds 30 --json
```

This records the current WeChat window audio instead of downloading a network media URL.

## Important Notes

- The target video must be playable by the current logged-in WeChat user.
- A share link alone is not enough unless it is opened and played in WeChat so the media request can be captured.
- Starting the proxy changes the active macOS network service proxy to `127.0.0.1:18088`.
- Stopping the proxy restores the previous proxy settings saved by the helper.
- The first certificate install may trigger a macOS keychain permission prompt.
