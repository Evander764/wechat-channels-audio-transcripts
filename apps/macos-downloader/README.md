# WeChat Channels Downloader beta

Mac-native beta for capturing currently playable WeChat Channels media requests, downloading audio-only `.m4a` files from public video/live/replay streams, and falling back to current-window recording when network capture is not available.

If you are using Codex to install and run this project, start with [INSTALL_FOR_CODEX.md](INSTALL_FOR_CODEX.md).

## Install From Source

```bash
git clone https://github.com/Evander764/wechat-channels-downloader-mac.git
cd wechat-channels-downloader-mac
swift build -c release
```

For a packaged beta app:

```bash
./scripts/package-app.sh
```

## Commands

```bash
.build/release/wcd-helper doctor --json
.build/release/wcd-helper bootstrap --json
.build/release/wcd-helper cert install --json
.build/release/wcd-helper proxy start --json
.build/release/wcd-helper proxy stop --json
.build/release/wcd-helper captures tail --json
.build/release/wcd-helper download --capture-id ID --json
.build/release/wcd-helper record-current --duration-seconds 30 --json
```

`download` extracts audio only. It does not keep a downloaded video file.

## Local Paths

- App: `/Applications/WeChat Channels Downloader_beta.app`
- State: `~/Library/Application Support/WeChat Channels Downloader/`
- Downloads: `~/Movies/WeChat Channels Downloads/`
- Proxy port: `127.0.0.1:18088`

This tool is intended for media that is already playable by the current user. It does not bypass paid access, DRM, account restrictions, or platform protection.
