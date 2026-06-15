"""Transcribe a local audio file with faster-whisper.

This script is for audio captured from local playback.  It does not download,
fetch, or decrypt media streams.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import tempfile
from pathlib import Path

from faster_whisper import WhisperModel


CUDA_DLL_DIRS = [
    Path(value)
    for value in os.environ.get("WECHAT_CUDA_DLL_DIRS", "").split(os.pathsep)
    if value.strip()
]


def _prepare_cuda_dlls() -> None:
    for dll_dir in CUDA_DLL_DIRS:
        if not dll_dir.exists():
            continue
        try:
            os.add_dll_directory(str(dll_dir))
        except (AttributeError, OSError):
            pass
        os.environ["PATH"] = str(dll_dir) + os.pathsep + os.environ.get("PATH", "")


def _safe_audio_path(audio: Path, work_dir: Path) -> Path:
    suffix = audio.suffix or ".wav"
    safe = work_dir / f"input{suffix}"
    shutil.copy2(audio, safe)
    return safe


def _restore_speed(audio: Path, work_dir: Path, playback_speed: float) -> Path:
    if playback_speed <= 1.01:
        return audio
    restored = work_dir / "restored_speed.wav"
    tempo = 1.0 / playback_speed
    filters: list[str] = []
    while tempo < 0.5:
        filters.append("atempo=0.5")
        tempo /= 0.5
    while tempo > 100.0:
        filters.append("atempo=100.0")
        tempo /= 100.0
    filters.append(f"atempo={tempo:.6f}")
    subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-hide_banner",
            "-loglevel",
            "error",
            "-i",
            str(audio),
            "-filter:a",
            ",".join(filters),
            str(restored),
        ],
        check=True,
    )
    return restored


def _write_markdown(output: Path, meta: dict, segments: list[dict]) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    title = meta.get("title") or output.stem
    lines = [
        f"# {title}",
        "",
        f"- index: {meta.get('index', '')}",
        f"- duration: {meta.get('duration', '')}",
        f"- source: loopback_audio_whisper",
        f"- model: {meta.get('model', '')}",
        f"- playback_speed: {meta.get('playback_speed', '')}",
        f"- segment_count: {len(segments)}",
        "",
        "## 文字稿",
        "",
    ]
    lines.extend(segment["text"] for segment in segments if segment.get("text"))
    lines.append("")
    output.write_text("\n".join(lines), encoding="utf-8")


def _run_transcribe(audio: Path, args: argparse.Namespace) -> tuple[list[dict], object, str, str]:
    def run_with(device: str, compute_type: str) -> tuple[list[dict], object, str, str]:
        model = WhisperModel(args.model, device=device, compute_type=compute_type)
        raw_segments, info = model.transcribe(str(audio), language=args.language, vad_filter=args.vad_filter)
        segments = [
            {
                "start": float(segment.start),
                "end": float(segment.end),
                "text": segment.text.strip(),
            }
            for segment in raw_segments
        ]
        return segments, info, device, compute_type

    try:
        return run_with(args.device, args.compute_type)
    except Exception:
        if args.device == "cpu":
            raise
        return run_with("cpu", "int8")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--audio", required=True)
    parser.add_argument("--output-md", required=True)
    parser.add_argument("--output-json", required=True)
    parser.add_argument("--meta-json")
    parser.add_argument("--model", default="small")
    parser.add_argument("--language", default="zh")
    parser.add_argument("--device", default="cpu")
    parser.add_argument("--compute-type", default="int8")
    parser.add_argument("--playback-speed", type=float, default=1.0)
    parser.add_argument("--restore-speed", action="store_true")
    parser.add_argument("--vad-filter", action="store_true")
    args = parser.parse_args()

    audio = Path(args.audio)
    _prepare_cuda_dlls()
    meta = {}
    if args.meta_json:
        meta = json.loads(Path(args.meta_json).read_text(encoding="utf-8-sig"))
    meta.update({"model": args.model, "playback_speed": args.playback_speed})

    with tempfile.TemporaryDirectory(prefix="wcd_transcribe_") as tmp:
        work_dir = Path(tmp)
        safe = _safe_audio_path(audio, work_dir)
        if args.restore_speed:
            safe = _restore_speed(safe, work_dir, args.playback_speed)

        segments, info, actual_device, actual_compute_type = _run_transcribe(safe, args)
        meta.update({"device": actual_device, "compute_type": actual_compute_type})

    payload = {
        "audio": str(audio),
        "language": info.language,
        "language_probability": info.language_probability,
        "duration": info.duration,
        "meta": meta,
        "segments": segments,
    }
    Path(args.output_json).parent.mkdir(parents=True, exist_ok=True)
    Path(args.output_json).write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    _write_markdown(Path(args.output_md), meta, segments)
    print(json.dumps({"output_md": args.output_md, "segments": len(segments), "duration": info.duration}, ensure_ascii=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
