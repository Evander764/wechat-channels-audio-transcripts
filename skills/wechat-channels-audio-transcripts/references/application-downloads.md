# Application And Dependency Download Guide

Use official pages where possible. Do not bundle private cookies, WeChat sessions, generated media, or downloaded account outputs.

## Required Applications

- WeChat for Windows: `https://pc.weixin.qq.com/`
- wx_channel: `https://github.com/nobiyou/wx_channel`
- Node.js: `https://nodejs.org/en/download`
- Python for Windows: `https://www.python.org/downloads/windows/`
- FFmpeg/FFprobe: `https://ffmpeg.org/download.html`
- Git: `https://git-scm.com/download/win`

## Python Dependencies

Install transcription dependencies in a venv or another dedicated Python environment:

```powershell
python -m venv .runtime\transcript-venv
.\.runtime\transcript-venv\Scripts\python.exe -m pip install --upgrade pip
.\.runtime\transcript-venv\Scripts\python.exe -m pip install faster-whisper ctranslate2
```

Then set `transcription.python` in `wechat.config.json` to:

```text
.runtime\transcript-venv\Scripts\python.exe
```

For GPU transcription, confirm `nvidia-smi` works and configure `transcription.cudaDllDirs` if CTranslate2 cannot find CUDA DLLs.
