# WeChat Channels Audio Transcripts

Windows workflow for WeChat Channels video accounts:

1. collect video links and available metrics;
2. download each video's audio from WeChat Channels media detail data;
3. transcribe audio with faster-whisper;
4. merge transcript plus metrics into Markdown/JSON/CSV;
5. package the final text/data output as a ZIP.

## Can It Download Immediately After Install?

Not literally. WeChat Channels data is tied to a logged-in WeChat session and the `wx_channel` local helper. A new user must do these steps first:

1. Install and log in to WeChat for Windows.
2. Install and run [`nobiyou/wx_channel`](https://github.com/nobiyou/wx_channel).
3. Confirm the target Video Channels account can open in WeChat.
4. Put the target account's raw `username` such as `v2_...@finder` into `wechat.config.json`.
5. Run metadata capture, then batch download/transcription.

After those prerequisites are ready, the project can run the batch workflow from commands.

## Requirements

- Windows 10/11
- WeChat for Windows
- `wx_channel` running locally, default API `http://127.0.0.1:2025`
- Node.js 18+
- Python 3.10+ with `faster-whisper` and `ctranslate2`
- FFmpeg and FFprobe on `PATH`
- `curl.exe` on `PATH`
- NVIDIA GPU is recommended for transcription, CPU is supported but slower

## Quick Start

```powershell
git clone https://github.com/Evander764/wechat-channels-audio-transcripts.git
cd wechat-channels-audio-transcripts
npm run setup
```

Create a Python environment for transcription:

```powershell
python -m venv .runtime\transcript-venv
.\.runtime\transcript-venv\Scripts\python.exe -m pip install --upgrade pip
.\.runtime\transcript-venv\Scripts\python.exe -m pip install faster-whisper ctranslate2
```

Edit `wechat.config.json`:

- replace `accounts[0].username` with the raw Video Channels username from `wx_channel`;
- set `accounts[0].name` and `slug`;
- set `transcription.python` to `.runtime\transcript-venv\Scripts\python.exe`;
- adjust `outputRoot`, `workRoot`, download concurrency, and transcription settings if needed.

Then check the local environment:

```powershell
npm run doctor
```

Capture metadata:

```powershell
npm run capture
```

Run the whole pipeline:

```powershell
npm run run
```

Or run individual stages:

```powershell
npm run download
npm run transcribe
npm run enrich
npm run verify
npm run package
```

## Configuration

The real config file is `wechat.config.json`, created from `config.example.json`.

Important fields:

- `wxChannelBaseUrl`: local `wx_channel` API base URL.
- `accounts`: one or more target accounts with `name`, `slug`, and raw `username`.
- `outputRoot`: final metadata, manifest, transcript, and ZIP output directory.
- `workRoot`: dynamic working directory for audio, segment JSON, and temporary media.
- `download.concurrency`: parallel audio downloads. Start with `8`; reduce if links fail often.
- `transcription.python`: Python executable. Use a venv path or plain `python`.
- `transcription.model`: faster-whisper model, for example `small`, `medium`, or `large-v3`.

## Outputs

Metadata capture writes:

```text
wechat_channels_metadata_full_<timestamp>/
  all_accounts.metadata.json
  all_accounts.metadata.csv
  all_accounts.videos_only.json
  all_accounts.videos_only.csv
  summary.json
```

Audio/transcription working files write:

```text
audio_transcripts_dynamic/
  audio/
  meta/
  segments/
  texts/
  tmp/
  batch-log.jsonl
```

Final enriched output writes:

```text
wechat_transcripts_with_metrics_existing_<timestamp>/
  manifest.json
  manifest.csv
  texts_with_metrics/
  json/
```

The package command creates a ZIP containing text/data outputs, not the large audio files.

## Operational Notes

- If WeChat cannot open Video Channels after starting helpers, close the helper, open Video Channels first, then start `wx_channel`.
- If antivirus blocks Python/proxy/certificate tools, whitelist this project and the `wx_channel` folder.
- Do not treat active terminal output as completion proof. Use `npm run verify` against the final manifest.
- Video play count may not always be available from the captured API. The pipeline keeps it when present and leaves it blank when unavailable.

## Legal And Account Safety

Use this only for content you have the right to process. The scripts rely on your own logged-in WeChat session and local helper APIs; they do not include credentials, cookies, downloaded media, or private account data.
