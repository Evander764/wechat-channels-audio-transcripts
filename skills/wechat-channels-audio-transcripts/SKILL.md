---
name: wechat-channels-audio-transcripts
description: >
  Operate the Windows workflow for WeChat Channels accounts: collect video
  metadata and metrics, download audio, transcribe with faster-whisper, verify
  manifest coverage, and package transcript/data archives.
---

# WeChat Channels Audio Transcripts

Use this skill when the user wants to process one or more WeChat Channels accounts on Windows.

## Workflow

1. Confirm WeChat for Windows is logged in and the target Video Channels page opens normally.
2. Confirm `wx_channel` is running and its local API base URL is configured.
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

```powershell
npm run setup
npm run doctor
npm run capture
npm run run
npm run verify
npm run package
```

Use `README.md` for install details and configuration shape.
