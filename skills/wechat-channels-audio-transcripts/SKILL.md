---
name: wechat-channels-audio-transcripts
description: >
  Use when a user needs WeChat Channels video audio links, audio downloads,
  faster-whisper transcripts, account exports, or ltaoo/wx_channels_download
  style macOS/Windows capture workflows.
---

# WeChat Channels Audio Transcripts

Use this skill when the user wants to download a playable WeChat Channels video's audio on macOS, or process one or more WeChat Channels accounts on macOS or Windows.

## Core Principle

This workflow relies on the user's own logged-in WeChat session. The ltaoo/wx_channels_download pattern starts a local HTTPS proxy, trusts a local certificate, injects helper JavaScript into `channels.weixin.qq.com`, captures playable media/profile data, then downloads the captured media URL and decrypts or extracts audio with ffmpeg when needed.

For agent automation, prefer this project's JSON commands over UI clicks. The source media URL appears as `data.url`; the saved audio file appears as `data.output`; transcript paths appear under `transcript.output_md` and `transcript.output_json`.

## Workflow

### macOS Current Video To Transcript

1. Run `npm run mac:doctor`.
2. If needed, run `npm run mac:setup` and `npm run mac:cert:install`.
3. Run `npm run mac:listen`.
4. Open WeChat desktop and play the target video.
5. Run `npm run mac:captures` to inspect captured media.
6. Run `npm run mac:download-transcribe -- --match "<title keyword>"`, or `--capture-id <id>` for an exact capture.
7. Run `npm run mac:stop` after download to restore proxy settings.
8. If capture fails, run `npm run mac:record-current -- --duration-seconds N`.

Use `npm run mac:download-latest` only when the user wants the audio file but not a transcript.

### Batch Account Export

1. Confirm WeChat desktop is logged in and the target Video Channels page opens normally.
2. Confirm a compatible local helper API is running and its base URL is configured.
3. Edit `wechat.config.json` with each account's raw `username`.
4. Run `npm run doctor`.
5. Run `npm run capture` to create `all_accounts.videos_only.json`.
6. Run `npm run run`, or run `download`, `transcribe`, `enrich`, `verify`, and `package` separately.
7. Treat `verify` as the source of truth before saying a batch is complete.

## Evidence To Check

- source video count from metadata;
- final manifest row count;
- unique `object_id` count;
- duplicate `object_id` count;
- missing IDs;
- non-empty transcript files;
- available metric fields such as likes, favorites, comments, forwards, and read/play count.

## Commands

```bash
npm run setup
npm run doctor
npm run mac:doctor
npm run mac:listen
npm run mac:download-transcribe
npm run mac:download-latest
npm run mac:stop
npm run capture
npm run run
npm run verify
npm run package
```

Use `README.md` for install details and configuration shape. Read `references/ltaoo-wx-channels-download-principle.md` before changing the capture/download design.

## Common Mistakes

- Do not use the user's normal Chrome profile; this is a WeChat desktop workflow.
- Do not promise downloads for content the logged-in account cannot already play.
- Do not leave the proxy running after a capture; always run `npm run mac:stop`.
- Do not treat `data.url` alone as completion; verify the audio file and transcript path exist.
