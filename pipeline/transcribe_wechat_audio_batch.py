"""Batch transcribe WeChat audio files while keeping faster-whisper loaded."""

from __future__ import annotations

import argparse
import json
import os
import sys
import tempfile
import time
from pathlib import Path

from faster_whisper import WhisperModel


DEFAULT_ROOT = Path(
    os.environ.get(
        "WECHAT_CHANNELS_WORK_ROOT",
        Path.home() / "Movies" / "WeChat Channels Downloads" / "audio_transcripts_dynamic",
    )
)
CUDA_DLL_DIRS = [
    Path(value)
    for value in os.environ.get("WECHAT_CUDA_DLL_DIRS", "").split(os.pathsep)
    if value.strip()
]


def prepare_cuda_dlls() -> None:
    for dll_dir in CUDA_DLL_DIRS:
        if not dll_dir.exists():
            continue
        try:
            os.add_dll_directory(str(dll_dir))
        except (AttributeError, OSError):
            pass
        os.environ["PATH"] = str(dll_dir) + os.pathsep + os.environ.get("PATH", "")


def read_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8-sig"))


def write_markdown(output: Path, meta: dict, segments: list[dict]) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    lines = [
        f"# {meta.get('title') or output.stem}",
        "",
        f"- index: {meta.get('index', meta.get('seq', ''))}",
        f"- duration: {meta.get('duration', meta.get('duration_seconds', ''))}",
        f"- source: {meta.get('transcript_source') or 'direct_media_download_faster_whisper'}",
        f"- model: {meta.get('model', '')}",
        f"- playback_speed: {meta.get('playback_speed', 1.0)}",
        f"- device: {meta.get('device', '')}",
        f"- segment_count: {len(segments)}",
        "",
        "## 文字稿",
        "",
    ]
    lines.extend(segment["text"] for segment in segments if segment.get("text"))
    lines.append("")
    output.write_text("\n".join(lines), encoding="utf-8")


def seq_from_name(path: Path) -> int:
    try:
        return int(path.name.split(".", 1)[0])
    except Exception:
        return 0


def collect_tasks(root: Path, limit: int, force: bool) -> list[dict]:
    tasks: list[dict] = []
    for meta_path in sorted((root / "meta").glob("*.meta.json"), key=seq_from_name):
        meta = read_json(meta_path)
        audio_value = str(meta.get("audio") or "").strip()
        if not audio_value:
            continue
        audio = Path(audio_value)
        if not audio.exists() or audio.is_dir():
            continue
        segments = Path(meta.get("segments") or (root / "segments" / meta_path.name.replace(".meta.json", ".json")))
        markdown = Path(meta.get("markdown") or (root / "texts" / meta_path.name.replace(".meta.json", ".md")))
        if segments.exists() and not force:
            continue
        lock = Path(str(segments) + ".lock")
        tasks.append({"meta_path": meta_path, "meta": meta, "audio": audio, "segments": segments, "markdown": markdown, "lock": lock})
        if limit and len(tasks) >= limit:
            break
    return tasks


def acquire_lock(lock: Path, stale_after_seconds: int = 12 * 60 * 60) -> bool:
    lock.parent.mkdir(parents=True, exist_ok=True)
    try:
        stat = lock.stat()
        if time.time() - stat.st_mtime > stale_after_seconds:
            lock.unlink(missing_ok=True)
    except FileNotFoundError:
        pass

    flags = os.O_CREAT | os.O_EXCL | os.O_WRONLY
    try:
        handle = os.open(str(lock), flags)
    except FileExistsError:
        return False

    with os.fdopen(handle, "w", encoding="utf-8") as file:
        file.write(json.dumps({"pid": os.getpid(), "started_at": time.time()}, ensure_ascii=True))
    return True


def release_lock(lock: Path) -> None:
    try:
        lock.unlink()
    except FileNotFoundError:
        pass


def load_model(model_name: str, device: str, compute_type: str, allow_cpu_fallback: bool):
    try:
        return WhisperModel(model_name, device=device, compute_type=compute_type), device, compute_type
    except Exception:
        if device == "cpu" or not allow_cpu_fallback:
            raise
        return WhisperModel(model_name, device="cpu", compute_type="int8"), "cpu", "int8"


def transcribe_one(model: WhisperModel, task: dict, language: str, vad_filter: bool) -> tuple[list[dict], object]:
    raw_segments, info = model.transcribe(str(task["audio"]), language=language, vad_filter=vad_filter)
    segments = [
        {"start": float(segment.start), "end": float(segment.end), "text": segment.text.strip()}
        for segment in raw_segments
    ]
    return segments, info


def main() -> int:
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except AttributeError:
        pass

    parser = argparse.ArgumentParser()
    parser.add_argument("--root", default=str(DEFAULT_ROOT))
    parser.add_argument("--model", default="small")
    parser.add_argument("--language", default="zh")
    parser.add_argument("--device", default="cpu")
    parser.add_argument("--compute-type", default="int8")
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--vad-filter", action="store_true")
    parser.add_argument("--no-cpu-fallback", action="store_true")
    args = parser.parse_args()

    prepare_cuda_dlls()
    root = Path(args.root)
    tasks = collect_tasks(root, args.limit, args.force)
    if not tasks:
        print(json.dumps({"ok": True, "selected_count": 0, "completed_count": 0, "failed_count": 0}, ensure_ascii=True, indent=2))
        return 0

    model, actual_device, actual_compute_type = load_model(
        args.model,
        args.device,
        args.compute_type,
        not args.no_cpu_fallback,
    )

    results = []
    failures = []
    for index, task in enumerate(tasks, start=1):
        meta = task["meta"]
        title = meta.get("title") or task["audio"].stem
        if not acquire_lock(task["lock"]):
            print(f"[skip locked] {meta.get('seq')} {title}")
            continue
        try:
            if task["segments"].exists() and not args.force:
                print(f"[skip completed] {meta.get('seq')} {title}")
                continue
            segments, info = transcribe_one(model, task, args.language, args.vad_filter)
            meta.update(
                {
                    "status": "completed",
                    "completed_at": __import__("datetime").datetime.utcnow().replace(microsecond=0).isoformat() + "Z",
                    "model": args.model,
                    "device": actual_device,
                    "compute_type": actual_compute_type,
                    "segment_count": len(segments),
                    "transcribed_duration": info.duration,
                    "language": info.language,
                    "language_probability": info.language_probability,
                    "markdown": str(task["markdown"]),
                    "segments": str(task["segments"]),
                }
            )
            payload = {
                "audio": str(task["audio"]),
                "language": info.language,
                "language_probability": info.language_probability,
                "duration": info.duration,
                "meta": meta,
                "segments": segments,
            }
            task["segments"].parent.mkdir(parents=True, exist_ok=True)
            task["segments"].write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
            write_markdown(task["markdown"], meta, segments)
            task["meta_path"].write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
            results.append({"seq": meta.get("seq"), "title": title, "segments": len(segments)})
            print(f"[{index}/{len(tasks)}] transcribed {meta.get('seq')} {title}")
        except Exception as error:
            failures.append({"seq": meta.get("seq"), "title": title, "error": str(error)})
            print(f"[failed] {meta.get('seq')} {title}: {error}")
        finally:
            release_lock(task["lock"])

    print(json.dumps({"ok": not failures, "selected_count": len(tasks), "completed_count": len(results), "failed_count": len(failures), "device": actual_device, "compute_type": actual_compute_type, "results": results, "failures": failures}, ensure_ascii=True, indent=2))
    return 0 if not failures else 1


if __name__ == "__main__":
    raise SystemExit(main())
