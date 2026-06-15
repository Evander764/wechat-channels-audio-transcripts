import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';

import {
  DEFAULT_OUTPUT_ROOT,
  DEFAULT_ROOT,
  DEFAULT_METADATA_JSON,
  DEFAULT_TRANSCRIBE_BATCH_SCRIPT,
  DEFAULT_TRANSCRIBE_PYTHON,
  DEFAULT_TRANSCRIBE_SCRIPT,
  PROJECT_ROOT,
  ensureDir,
  latestManifest,
  loadMetadataRows,
  readJson,
} from './wechat_transcript_common.mjs';

function parseArgs(argv) {
  const args = {
    root: DEFAULT_ROOT,
    outputRoot: DEFAULT_OUTPUT_ROOT,
    metadataJson: DEFAULT_METADATA_JSON,
    completedManifest: '',
    python: DEFAULT_TRANSCRIBE_PYTHON,
    transcribeScript: DEFAULT_TRANSCRIBE_SCRIPT,
    transcribeBatch: DEFAULT_TRANSCRIBE_BATCH_SCRIPT,
    batchLimit: 100,
    transcribeLimit: 120,
    concurrency: 2,
    maxConcurrency: 8,
    maxBatches: 999,
    model: 'small',
    order: 'shortest',
    stopAfterNoProgress: 2,
    skipBatchTranscribe: false,
    timeoutMs: null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === '--root') {
      args.root = next;
      i += 1;
    } else if (arg === '--output-root') {
      args.outputRoot = next;
      i += 1;
    } else if (arg === '--metadata-json') {
      args.metadataJson = next;
      i += 1;
    } else if (arg === '--completed-manifest') {
      args.completedManifest = next;
      i += 1;
    } else if (arg === '--python') {
      args.python = next;
      i += 1;
    } else if (arg === '--transcribe-script') {
      args.transcribeScript = next;
      i += 1;
    } else if (arg === '--transcribe-batch') {
      args.transcribeBatch = next;
      i += 1;
    } else if (arg === '--batch-limit') {
      args.batchLimit = Number(next || args.batchLimit);
      i += 1;
    } else if (arg === '--transcribe-limit') {
      args.transcribeLimit = Number(next || args.transcribeLimit);
      i += 1;
    } else if (arg === '--concurrency') {
      args.concurrency = Number(next || args.concurrency);
      i += 1;
    } else if (arg === '--max-concurrency') {
      args.maxConcurrency = Number(next || args.maxConcurrency);
      i += 1;
    } else if (arg === '--max-batches') {
      args.maxBatches = Number(next || args.maxBatches);
      i += 1;
    } else if (arg === '--model') {
      args.model = next || args.model;
      i += 1;
    } else if (arg === '--order') {
      args.order = next || args.order;
      i += 1;
    } else if (arg === '--stop-after-no-progress') {
      args.stopAfterNoProgress = Number(next || args.stopAfterNoProgress);
      i += 1;
    } else if (arg === '--timeout-ms') {
      args.timeoutMs = Number(next || 0) || null;
      i += 1;
    } else if (arg === '--skip-batch-transcribe') {
      args.skipBatchTranscribe = true;
    }
  }
  return args;
}

async function completedCount(manifest) {
  if (!manifest) return 0;
  const payload = await readJson(manifest);
  return Number(payload.completed_count ?? payload.rows?.length ?? 0);
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    });
    let stdout = '';
    let stderr = '';
    if (options.capture) {
      child.stdout.on('data', (chunk) => {
        const text = chunk.toString();
        stdout += text;
        process.stdout.write(text);
      });
      child.stderr.on('data', (chunk) => {
        const text = chunk.toString();
        stderr += text;
        process.stderr.write(text);
      });
    }
    child.on('error', reject);
    child.on('close', (code) => {
      const result = { code, stdout, stderr };
      if (code === 0 || options.allowFailure) resolve(result);
      else reject(new Error(`${command} exited ${code}`));
    });
  });
}

function extractJsonObject(text) {
  const start = text.lastIndexOf('\n{');
  const slice = start >= 0 ? text.slice(start + 1) : text;
  return JSON.parse(slice);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  await ensureDir(path.join(args.root, 'run_logs'));

  let manifest = args.completedManifest || await latestManifest(args.outputRoot);
  if (manifest) await fs.access(manifest);

  const rows = await loadMetadataRows(args.metadataJson);
  const total = rows.filter((row) => row.is_video !== false && row.object_id && row.object_nonce_id).length;
  let noProgress = 0;

  for (let batch = 1; batch <= args.maxBatches; batch += 1) {
    const before = await completedCount(manifest);
    console.log(`\n=== batch ${batch} start: completed ${before}/${total} ===`);
    if (before >= total) break;

    await run('node', [
      './windows/wechat_direct_audio_pipeline.mjs',
      ...(manifest ? ['--completed-manifest', manifest] : []),
      '--root', args.root,
      '--output-root', args.outputRoot,
      '--metadata-json', args.metadataJson,
      '--python', args.python,
      '--transcribe-script', args.transcribeScript,
      '--order', args.order,
      '--limit', String(args.batchLimit),
      '--model', args.model,
      '--skip-transcribe',
      '--concurrency', String(args.concurrency),
      '--max-concurrency', String(args.maxConcurrency),
      ...(args.timeoutMs ? ['--timeout-ms', String(args.timeoutMs)] : []),
    ], { cwd: PROJECT_ROOT, allowFailure: true });

    if (!args.skipBatchTranscribe) {
      await run(args.python, [
        args.transcribeBatch,
        '--root', args.root,
        '--limit', String(args.transcribeLimit),
        '--model', args.model,
        '--language', 'zh',
      ], { cwd: PROJECT_ROOT, allowFailure: true });
    } else {
      console.log('batch transcribe skipped; live transcribe watcher is expected to process audio');
    }

    const enriched = await run('node', [
      './windows/enrich_existing_wechat_transcripts.mjs',
      '--root', args.root,
      '--output-root', args.outputRoot,
      '--metadata-json', args.metadataJson,
    ], {
      cwd: PROJECT_ROOT,
      capture: true,
    });
    const enrichedJson = extractJsonObject(enriched.stdout);
    manifest = path.join(enrichedJson.outDir, 'manifest.json');

    await run('node', [
      './windows/prepare_wechat_audio_queue.mjs',
      '--completed-manifest', manifest,
      '--metadata-json', args.metadataJson,
      '--output-root', args.outputRoot,
    ], {
      cwd: PROJECT_ROOT,
      allowFailure: true,
    });

    const after = await completedCount(manifest);
    console.log(`=== batch ${batch} done: completed ${after}/${total}, added ${after - before} ===`);
    if (after <= before) {
      noProgress += 1;
      if (noProgress >= args.stopAfterNoProgress) {
        console.log(`No progress for ${noProgress} consecutive batches; stopping.`);
        break;
      }
    } else {
      noProgress = 0;
    }
  }

  const finalCount = await completedCount(manifest);
  console.log(JSON.stringify({ ok: finalCount >= total, manifest, completed_count: finalCount, total }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
