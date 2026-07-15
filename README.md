# WeChat Channels Audio Transcripts

The repository also retains the former standalone macOS downloader under [`apps/macos-downloader/`](apps/macos-downloader/) for reviewed migration history. Its proxy-capture path is disabled; see the [migration safety ruling](docs/migrations/wechat-channels-downloader-mac.md).

macOS-capable workflow for WeChat Channels video accounts:

1. directly capture and download audio from the currently playable WeChat Channels video on macOS;
2. optionally collect account-level video links and available metrics from a local helper API;
3. download each video's audio from WeChat Channels media detail data;
4. transcribe audio with faster-whisper;
5. merge transcript plus metrics into Markdown/JSON/CSV;
6. package the final text/data output as a ZIP.

## Can It Download Immediately After Install?

For a single currently playable video on macOS: yes, after one-time setup. The Mac direct downloader starts a local proxy, captures media requests while you play the target video in WeChat desktop, and saves an audio-only `.m4a`.

For the older batch account workflow: not literally. Account-level metadata is tied to your own logged-in WeChat session and a local helper API. The batch workflow expects an API compatible with:

- `POST /api/channels/contact/feed/list`
- `GET /api/channels/feed/profile`

The default batch API base is `http://127.0.0.1:2025`. On Windows this was commonly provided by `wx_channel`; on macOS you still need a compatible local bridge for account-level metadata and media-detail capture.

## Requirements

- macOS with a logged-in WeChat desktop session
- Node.js 18+
- FFmpeg, FFprobe, curl, and zip on `PATH`
- Swift toolchain / Xcode Command Line Tools for the Mac direct helper
- Python 3.11 for the Mac proxy helper
- Python 3.10+ with `faster-whisper` and `ctranslate2` only if you also need transcription
- a compatible local WeChat Channels helper API only if you need batch account capture
- CPU transcription is the macOS default; configure another faster-whisper device only after verifying it locally

## Direct Download On macOS

```bash
git clone https://github.com/Evander764/wechat-channels-audio-transcripts.git
cd wechat-channels-audio-transcripts
npm run mac:setup
```

Trust the local capture certificate once:

```bash
npm run mac:cert:install
```

Start listening, play the target WeChat Channels video in WeChat desktop, then download the most relevant captured media:

```bash
npm run mac:listen
npm run mac:download-latest
npm run mac:stop
```

To download and immediately transcribe the selected capture:

```bash
npm run mac:listen
npm run mac:download-transcribe -- --match "标题关键词"
npm run mac:stop
```

The command prints JSON containing the captured media URL, saved audio file, transcript Markdown, and transcript JSON paths.

If several videos were captured, match by title/source text:

```bash
npm run mac:captures
npm run mac:download-latest -- --match "标题关键词"
```

If network capture is unavailable, record the current WeChat window audio for a fixed duration:

```bash
npm run mac:record-current -- --duration-seconds 30
```

Direct downloads write audio files to:

```text
~/Movies/WeChat Channels Downloads/
```

The direct helper stores local state in:

```text
~/Library/Application Support/WeChat Channels Audio Transcripts/
```

## Codex Direct-Download Flow

When asking Codex to download one playable WeChat Channels video on a Mac, the expected flow is:

1. Run `npm run mac:doctor`.
2. If setup is missing, run `npm run mac:setup` and `npm run mac:cert:install`.
3. Run `npm run mac:listen`.
4. Open WeChat desktop and play the target video long enough for the media request to appear.
5. Run `npm run mac:captures`.
6. Run `npm run mac:download-transcribe -- --match "标题关键词"` when a transcript is required, or `npm run mac:download-latest -- --match "标题关键词"` for audio only.
7. Run `npm run mac:stop`.

If the network capture list stays empty, use:

```bash
npm run mac:record-current -- --duration-seconds 30
```

That fallback records the current WeChat window audio instead of downloading the network media URL.

## Batch Account Workflow

Use this only when you need full account metadata, transcripts, manifests, and ZIP handoff files.

For full setup instructions, including paths for Codex users and manual ZIP
users, see [`INSTALL.md`](INSTALL.md).

```bash
npm run setup
```

On Windows, the bootstrap helper can create the project config, runtime folders,
and transcription Python environment:

```powershell
npm.cmd run bootstrap:windows
```

If you do not use the bootstrap helper, create a Python environment for
transcription manually:

```bash
python3 -m venv .runtime/transcript-venv
.runtime/transcript-venv/bin/python -m pip install --upgrade pip
.runtime/transcript-venv/bin/python -m pip install faster-whisper ctranslate2
```

Edit `wechat.config.json`:

- replace `accounts[0].username` with the raw Video Channels username from your local helper;
- set `accounts[0].name` and `slug`;
- keep `transcription.python` as `.runtime/transcript-venv/bin/python`, or set it to another local Python path;
- keep `transcription.device` as `cpu` and `computeType` as `int8` unless you have verified another faster-whisper backend;
- adjust `outputRoot`, `workRoot`, download concurrency, and transcription settings if needed.

Then check the local environment:

```bash
npm run doctor
```

Capture metadata:

```bash
npm run capture
```

Run the whole pipeline:

```bash
npm run run
```

Or run individual stages:

```bash
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
- `outputRoot`: final metadata, manifest, transcript, and ZIP output directory. macOS default: `~/Movies/WeChat Channels Downloads`.
- `workRoot`: dynamic working directory for audio, segment JSON, and temporary media.
- `download.concurrency`: parallel audio downloads. Start with `8`; reduce if links fail often.
- `transcription.python`: Python executable. Use `.runtime/transcript-venv/bin/python` on macOS.
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

- `npm run mac:listen` changes the active macOS network service proxy to `127.0.0.1:18088`; run `npm run mac:stop` to restore the previous proxy settings.
- `npm run mac:cert:install` may prompt for local keychain permission.
- Direct download only works for media already playable by the current logged-in WeChat user. It does not bypass paid access, DRM, account restrictions, or platform protection.
- If WeChat cannot open Video Channels after starting helpers, close the helper, open Video Channels first, then start the helper again.
- If the helper API is unavailable, `npm run doctor` will report `wx_channel` as a hard failure. That means metadata capture cannot run yet.
- Do not treat active terminal output as completion proof. Use `npm run verify` against the final manifest.
- Video play count may not always be available from the captured API. The pipeline keeps it when present and leaves it blank when unavailable.

## Legal And Account Safety

Use this only for content you have the right to process. The scripts rely on your own logged-in WeChat session and local helper APIs; they do not include credentials, cookies, downloaded media, or private account data.
