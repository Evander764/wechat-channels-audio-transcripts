# Breakpoints And Recovery

Use this before restarting or repairing a WeChat Channels run.

## Critical Breakpoints

1. **WeChat cannot enter Video Channels after the helper starts**
   - Symptom: Video Channels home/profile will not load with or without proxy.
   - Recovery: close helper/capture app first, open Video Channels normally, navigate to the profile, scroll to bottom, then start capture/link extraction.

2. **No links appear in normal browser history**
   - Symptom: user fully browsed the account, but browser history has no useful media URLs.
   - Recovery: use wx_channel/local API capture and metadata export. Do not rely on browser history.

3. **Only partial account feed captured**
   - Symptom: final source count is too low.
   - Recovery: re-open the account profile, scroll to the bottom until no new cards appear, then export metadata again. Treat `object_id` count as the source of truth.

4. **Duplicate direct downloader batches**
   - Symptom: multiple `wechat_direct_marathon.mjs`, `wechat_direct_audio_pipeline.mjs`, or many extra `curl`/`curl.exe` processes.
   - Recovery: stop old downloader/supervisor processes before starting a new batch. Keep transcription watchers separate.

5. **`curl: (18)` incomplete response**
   - Cause: CDN/server closes after partial body.
   - Recovery: keep a stable temp file keyed by `object_id`, use `curl --continue-at -`, and fall back to range chunks after repeated `18`, `28`, `56`, or timeout errors.

6. **Hung curl children**
   - Symptom: outer Node process times out but `curl` stays alive.
   - Recovery: on Windows, kill the child process tree with `taskkill.exe /PID <pid> /T /F`; on macOS, use `ps` to locate the child process and terminate it.

7. **`decrypted header does not look like media`**
   - Causes:
     - the file already has a valid media header and should not be decrypted again;
     - stale or corrupted partial media was resumed with the wrong URL/key;
     - the partial file was already mutated by a previous decrypt attempt.
   - Recovery:
     - skip decrypt when the file header already looks like `ftyp`, `styp`, `moov`, or `mdat`;
     - store resume sidecars containing key and URL;
     - remove media and sidecar files for the `object_id` when decrypt/extract fails.

8. **Antivirus/Python CFFI popup**
   - Symptom: Python-CFFI error with `PermissionError: [WinError 5]` and a path like `\\.\aswMonFltProxy\`.
   - Recovery: disable HTTPS/proxy inspection or whitelist the working venv and helper app. Avast was one observed trigger.

9. **Transcription backlog grows**
   - Symptom: audio count increases faster than segment JSON count.
   - Recovery: run `wechat_transcribe_booster_watcher.mjs` with GPU workers. Avoid CPU fallback when the host has a usable GPU and the user asked for GPU.

10. **Terminal mojibake**
    - Symptom: Chinese titles look garbled in terminal logs.
    - Recovery: inspect UTF-8 files and manifests directly. Console mojibake does not prove the data is bad.

11. **Final ZIP looks too large**
    - Cause: already-compressed audio dominates archive size.
    - Recovery: build a text/data ZIP excluding media when the handoff goal is transcript review.

## Recovery Order

1. Run enrichment once to get the newest manifest.
2. Run integrity verification against source metadata and latest manifest.
3. If incomplete, list missing `object_id`s and check whether local dynamic audio already accounts for them.
4. Stop duplicate downloader processes.
5. Restart one marathon batch with:

```bash
node ./pipeline/wechat_direct_marathon.mjs \
  --completed-manifest "<latest-manifest.json>" \
  --batch-limit 120 \
  --transcribe-limit 0 \
  --concurrency 8 \
  --max-concurrency 8 \
  --model small \
  --order shortest \
  --skip-batch-transcribe \
  --stop-after-no-progress 4 \
  --timeout-ms 240000
```

6. Keep transcribe watcher/booster running if audio backlog exists.
7. Repeat enrichment and verification.
8. Package only after verification passes.

## Completion Proof

A run is complete only when validation proves:

- source unique IDs equal final manifest unique IDs;
- final `completed_count` equals source total;
- no duplicate `object_id`s in source or final manifest;
- `missing_from_manifest` is zero;
- every transcript path exists and is non-empty;
- metrics are present per row;
- final package exists if packaging was requested.
