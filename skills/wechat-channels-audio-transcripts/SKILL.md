---
name: wechat-channels-audio-transcripts
description: Historical WeChat Channels capture and transcription backend. Real work is Windows 5080 only and must be launched through the GitHub-first Information Intake control plane. Never open or process real WeChat content on macOS.
---

# WeChat Channels Audio Transcripts

This repository preserves an older capture/transcription implementation. It is not an active Mac intake route.

## Hard Boundary

- Do not open WeChat Channels on macOS.
- Do not capture, record, download, import, verify, package, or transcribe real WeChat content on macOS.
- Do not treat old Mac commands, artifacts, or successful runs as current permission.
- Keep historical source and fixtures as evidence; do not delete them merely because the route is retired.

All real work belongs to `win-desktop-5080` and must enter through `Evander764/information-intake`. That wrapper checks GitHub policy Issue #4, Windows log Issue #5, all-platform log Issue #6, and open PRs before content access.

## Active Workflow

1. Open the Information Intake repository on `win-desktop-5080`.
2. Read the latest GitHub policy/log issues and open PRs.
3. Run the unified Information Intake command with `--device-id win-desktop-5080`.
4. Keep content bodies, source identifiers, credentials, private paths, and media out of GitHub.
5. Record GitHub check time, run time, content-date range, current-day/backfill counts, ingest time/stage, verification, status, and blocker.

Direct real-content commands in this repository fail closed unless invoked on the registered device with an explicit successful Information Intake preflight marker. Synthetic tests remain allowed. On Mac, only non-content status/cleanup of an already-existing helper is permitted.

## Completion Evidence

Completion requires a verified normalized manifest plus the sanitized GitHub log. A process exit, audio file, transcript, or historical artifact alone is not sufficient.
