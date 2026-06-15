# WeChat Channels Process Summary

This project contains a reusable macOS/Windows workflow for WeChat Channels account exports.

## Main Scripts

- `scripts/mac-direct.mjs`: wraps the macOS helper commands for setup, listening, capture inspection, direct download, recording fallback, and proxy cleanup.
- `macos/Sources/WCDHelper/main.swift`: macOS helper that manages mitmproxy, trusted capture certificate, proxy settings, capture logs, audio-only ffmpeg downloads, and current-window recording fallback.
- `scripts/mac-direct.mjs download-transcribe`: selects a captured media request, downloads audio, then runs `pipeline/transcribe_audio.py` for a single-video Markdown/JSON transcript.
- `pipeline/wechat_channels_export_metadata_post.mjs`: exports account/video metadata from the local `wx_channel` API.
- `pipeline/wechat_direct_audio_pipeline.mjs`: resolves video detail data, downloads protected media, extracts audio, and writes per-video metadata.
- `pipeline/wechat_direct_marathon.mjs`: repeatedly runs download batches, transcribes pending audio, enriches output, and stops after no-progress periods.
- `pipeline/transcribe_wechat_audio_batch.py`: keeps faster-whisper loaded and transcribes audio batches.
- `pipeline/enrich_existing_wechat_transcripts.mjs`: merges audio/transcript/meta outputs into final Markdown/JSON/CSV artifacts.
- `pipeline/verify_wechat_download_integrity.mjs`: reconciles source metadata, final manifest, and local audio coverage.

## Output Shape

```text
wechat_transcripts_with_metrics_existing_<timestamp>/
  manifest.json
  manifest.csv
  texts_with_metrics/
  json/
```

Dynamic working output contains:

```text
audio_transcripts_dynamic/
  audio/
  meta/
  segments/
  texts/
  tmp/
  batch-log.jsonl
```

Do not use raw dynamic file counts as final completion proof. Use manifest reconciliation.
