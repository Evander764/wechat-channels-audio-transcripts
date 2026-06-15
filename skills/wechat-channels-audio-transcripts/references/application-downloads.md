# Application And Dependency Download Guide

Use official pages where possible. Do not bundle private cookies, WeChat sessions, generated media, or downloaded account outputs.

## Required Applications

- WeChat desktop: `https://weixin.qq.com/`
- wx_channel: `https://github.com/nobiyou/wx_channel`
- Node.js: `https://nodejs.org/en/download`
- Python: `https://www.python.org/downloads/`
- FFmpeg/FFprobe: `https://ffmpeg.org/download.html`
- Git: `https://git-scm.com/download/win`

## Python Dependencies

Install transcription dependencies in a venv or another dedicated Python environment:

```bash
python3 -m venv .runtime/transcript-venv
.runtime/transcript-venv/bin/python -m pip install --upgrade pip
.runtime/transcript-venv/bin/python -m pip install faster-whisper ctranslate2
```

Then set `transcription.python` in `wechat.config.json` to:

```text
.runtime/transcript-venv/bin/python
```

For GPU transcription on Windows, confirm `nvidia-smi` works and configure `transcription.cudaDllDirs` if CTranslate2 cannot find CUDA DLLs. macOS defaults to CPU/int8.
