# WeChat Channels Audio Transcripts

Historical WeChat Channels capture, audio, transcription, metrics, and packaging implementation.

## Current Operating Boundary

This repository is no longer an active macOS intake route. Mac must not open WeChat Channels or perform real capture, recording, download, import, transcription, verification, or packaging.

All real WeChat-family work belongs only to device `win-desktop-5080` and must be started through the GitHub-first control plane in [`Evander764/information-intake`](https://github.com/Evander764/information-intake):

- policy: Information Intake Issue #4;
- Windows 5080 check/run/ingest log: Issue #5;
- all-platform check/run/ingest log: Issue #6.

The Information Intake wrapper checks GitHub before content access, enforces the exact device ID, and writes sanitized timing/count/verification evidence. Do not put content bodies, source URLs, account identifiers, credentials, private paths, or media in GitHub.

## What Remains Here

- historical source showing the earlier capture and transcription design;
- synthetic fixtures and tests;
- a Windows backend reference;
- non-content Mac status/cleanup for an already-existing helper.

Historical Mac commands are retained in source control for evidence, but real-content entrypoints now fail closed. Git history remains the place to inspect the retired workflow; it is not permission to run it.

## Development Checks

```bash
npm test
npm run check
```

These checks use code and synthetic fixtures only. They must not open WeChat or access real user content.
