# Install Guide

This project is meant to be installed on a Windows computer that already has,
or can install, the required local apps. It does not include WeChat, login data,
private account configuration, downloaded media, or generated transcript output.

## Option A: User Has Codex

Ask Codex to do the setup from a new Windows workspace:

```text
Clone https://github.com/Evander764/wechat-channels-audio-transcripts and set it up.
Use the Windows bootstrap script if available.
Then help me configure it for the WeChat Channels account or video I open in WeChat.
Do not commit or upload my login data, real wechat.config.json, downloaded audio, logs, or transcript outputs.
```

Codex can usually handle:

- cloning the repository;
- running `npm.cmd run bootstrap:windows`;
- creating `.runtime\transcript-venv`;
- installing `faster-whisper` and `ctranslate2`;
- checking Node.js, Python, FFmpeg, FFprobe, curl, and the local `wx_channel` API;
- editing `wechat.config.json` after the target account `username` is known;
- running capture, download, transcription, verification, and packaging commands.

The user still needs to:

- install and log in to WeChat for Windows;
- install and start `wx_channel`;
- open the target WeChat Channels account or video when Codex asks;
- approve any WeChat login, QR code, or account interaction in the WeChat app.

Useful commands after Codex has cloned the repo:

```powershell
npm.cmd run bootstrap:windows
npm.cmd run doctor
npm.cmd run capture
npm.cmd run run
npm.cmd run verify
npm.cmd run package
```

## Option B: User Does Not Use Codex

1. Download the release ZIP from GitHub.
2. Extract it to a stable folder, for example:

```text
D:\software\wechat-channels-audio-transcripts
```

3. Install the required apps:

- WeChat for Windows: `https://pc.weixin.qq.com/`
- wx_channel: `https://github.com/nobiyou/wx_channel`
- Node.js 18 or newer: `https://nodejs.org/en/download`
- Python 3.10 or newer: `https://www.python.org/downloads/windows/`
- FFmpeg and FFprobe: `https://ffmpeg.org/download.html`
- Git, optional for ZIP users: `https://git-scm.com/download/win`

4. Open PowerShell in the extracted project folder and run:

```powershell
npm.cmd run bootstrap:windows
```

5. Log in to WeChat for Windows.
6. Start `wx_channel` and confirm its local API is available at:

```text
http://127.0.0.1:2025
```

7. Edit `wechat.config.json`:

- set `accounts[0].name`;
- set `accounts[0].slug`;
- set `accounts[0].username` to the raw `v2_...@finder` username from `wx_channel`;
- set `transcription.python` to:

```text
.runtime\transcript-venv\Scripts\python.exe
```

8. Check the environment:

```powershell
npm.cmd run doctor
```

9. Run the workflow:

```powershell
npm.cmd run capture
npm.cmd run run
npm.cmd run verify
npm.cmd run package
```

## What The Release Includes

- reusable workflow scripts;
- a Codex skill folder;
- config templates;
- a Windows bootstrap script;
- docs for Codex and manual users.

## What The Release Does Not Include

- WeChat for Windows;
- `wx_channel` binaries or source code;
- WeChat sessions, cookies, or credentials;
- real `wechat.config.json`;
- downloaded audio, video, logs, generated ZIPs, or transcript outputs;
- Python virtual environments or model cache files.

