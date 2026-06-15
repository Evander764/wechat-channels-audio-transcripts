# ltaoo wx_channels_download Principle

Use this reference when explaining or extending the WeChat Channels capture flow.

## What It Does

`ltaoo/wx_channels_download` is a local WeChat Channels helper, not a normal public-page crawler. It works by combining:

- local HTTPS proxy and root certificate installation;
- JavaScript injection into WeChat Channels web pages loaded by WeChat desktop;
- WebSocket/API bridge between injected page code and the local Go service;
- media/profile request capture from the logged-in WeChat session;
- Gopeed-based download tasks;
- ISAAC64-based protected-media decryption and ffmpeg conversion for audio/video outputs.

## Important Source Anchors

- `internal/interceptor/interceptor.go`: starts the proxy, installs/trusts certificate, sets system proxy, and wires plugins.
- `internal/interceptor/plugin.go`: intercepts `channels.weixin.qq.com`, rewrites HTML/JS responses, injects helper scripts, and exposes local fake API endpoints.
- `internal/interceptor/inject/src/feed.js`: inserts the visible download controls and updates the current feed profile from page events.
- `internal/interceptor/inject/src/utils.js`: formats feed profiles, builds media URLs from `media.url + media.urlToken`, keeps `decodeKey`, and prepares download metadata.
- `internal/api/routes.go` and `internal/api/handler.go`: expose local APIs such as `/api/task/create`, `/api/channels/feed/profile`, and `/api/channels/parse_sph`.
- `internal/channels/reader.go` and `internal/channels/decryptor.go`: decrypt protected media streams and optionally convert to mp3 through ffmpeg.
- `internal/api/sph.go`: optional share-link parsing path using Tencent Yuanbao parse results, then WeChat Channels feed info. This path requires a configured cookie and can drift.

## Practical Agent Pattern

For one playable video on macOS:

1. start capture;
2. ask the user to play the target video in WeChat desktop;
3. list captures and choose by `capture_id` or title match;
4. download using captured URL plus headers;
5. extract audio with ffmpeg;
6. transcribe with faster-whisper;
7. return `data.url`, `data.output`, `transcript.output_md`, and `transcript.output_json`.

For account-scale work, use the batch metadata/API path and verify final manifest coverage instead of trusting active terminal logs.

## Limits

- It depends on the user's own logged-in session and playable media requests.
- It does not bypass paid access, DRM, deleted content, private content, or account restrictions.
- Share-link parsing is useful when it works, but the local capture route is usually more controllable for agents because it has observable captures and local files.
