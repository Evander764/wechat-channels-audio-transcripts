import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';

import {
  DEFAULT_OUTPUT_ROOT,
  DEFAULT_METADATA_JSON,
  latestManifest,
  loadMetadataRows,
  PROJECT_ROOT,
  readJson,
} from './wechat_transcript_common.mjs';

function parseArgs(argv) {
  const args = {
    outputRoot: DEFAULT_OUTPUT_ROOT,
    metadataJson: DEFAULT_METADATA_JSON,
    intervalSeconds: 300,
    total: 0,
    batchLimit: 120,
    concurrency: 8,
    maxConcurrency: 8,
    maxBatches: 20,
    stopAfterNoProgress: 3,
    model: 'small',
    order: 'shortest',
    once: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === '--output-root') {
      args.outputRoot = next;
      i += 1;
    } else if (arg === '--metadata-json') {
      args.metadataJson = next;
      i += 1;
    } else if (arg === '--interval-seconds') {
      args.intervalSeconds = Number(next || args.intervalSeconds);
      i += 1;
    } else if (arg === '--total') {
      args.total = Number(next || args.total);
      i += 1;
    } else if (arg === '--batch-limit') {
      args.batchLimit = Number(next || args.batchLimit);
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
    } else if (arg === '--stop-after-no-progress') {
      args.stopAfterNoProgress = Number(next || args.stopAfterNoProgress);
      i += 1;
    } else if (arg === '--model') {
      args.model = next || args.model;
      i += 1;
    } else if (arg === '--order') {
      args.order = next || args.order;
      i += 1;
    } else if (arg === '--once') {
      args.once = true;
    }
  }
  return args;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function completedCount(manifest) {
  if (!manifest) return 0;
  const payload = await readJson(manifest);
  return Number(payload.completed_count ?? payload.rows?.length ?? 0);
}

async function totalCount(args) {
  if (args.total) return args.total;
  const rows = await loadMetadataRows(args.metadataJson);
  return rows.filter((row) => row.is_video !== false && row.object_id && row.object_nonce_id).length;
}

function psJson(command) {
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command], {
      windowsHide: true,
      maxBuffer: 2 * 1024 * 1024,
    }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`${error.message}\n${stderr || ''}`.trim()));
        return;
      }
      const text = stdout.trim();
      if (!text) {
        resolve(null);
        return;
      }
      try {
        resolve(JSON.parse(text));
      } catch (parseError) {
        reject(new Error(`PowerShell JSON parse failed: ${parseError.message}\n${text}`));
      }
    });
  });
}

async function activeDownloaderCount() {
  const command = `
$ErrorActionPreference = "Stop"
$items = Get-CimInstance Win32_Process | Where-Object {
  ($_.Name -eq 'node.exe' -or $_.Name -eq 'cmd.exe') -and
  ($_.CommandLine -like '*wechat_direct_marathon.mjs*' -or $_.CommandLine -like '*wechat_direct_audio_pipeline.mjs*')
}
@($items).Count | ConvertTo-Json
`;
  const count = await psJson(command);
  return Number(count || 0);
}

async function startMarathon(manifest, args) {
  await fs.mkdir(path.join(PROJECT_ROOT, 'run_logs'), { recursive: true });
  const stamp = new Date()
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, '');
  const stdoutPath = path.join(PROJECT_ROOT, 'run_logs', `marathon_supervised_8x_${stamp}.out.log`);
  const stderrPath = path.join(PROJECT_ROOT, 'run_logs', `marathon_supervised_8x_${stamp}.err.log`);
  const stdout = await fs.open(stdoutPath, 'a');
  const stderr = await fs.open(stderrPath, 'a');
  const child = spawn(process.execPath, [
    './windows/wechat_direct_marathon.mjs',
    ...(manifest ? ['--completed-manifest', manifest] : []),
    '--output-root', args.outputRoot,
    '--metadata-json', args.metadataJson,
    '--batch-limit', String(args.batchLimit),
    '--transcribe-limit', '0',
    '--concurrency', String(args.concurrency),
    '--max-concurrency', String(args.maxConcurrency),
    '--model', args.model,
    '--order', args.order,
    '--max-batches', String(args.maxBatches),
    '--skip-batch-transcribe',
    '--stop-after-no-progress', String(args.stopAfterNoProgress),
  ], {
    cwd: PROJECT_ROOT,
    detached: true,
    windowsHide: true,
    stdio: ['ignore', stdout.fd, stderr.fd],
  });
  child.unref();
  await stdout.close();
  await stderr.close();
  return {
    pid: child.pid,
    stdout: stdoutPath,
    stderr: stderrPath,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const total = await totalCount(args);
  if (!total) throw new Error('could not determine total video count');

  for (;;) {
    const manifest = await latestManifest(args.outputRoot);
    const completed = await completedCount(manifest);
    const activeDownloaders = await activeDownloaderCount();
    const status = {
      event: 'supervisor_check',
      completed,
      total,
      remaining: Math.max(0, total - completed),
      activeDownloaders,
      manifest,
      time: new Date().toISOString(),
    };

    if (completed < total && activeDownloaders === 0) {
      const launched = await startMarathon(manifest, args);
      console.log(JSON.stringify({ ...status, event: 'supervisor_started_marathon', launched }));
    } else {
      console.log(JSON.stringify(status));
    }

    if (completed >= total || args.once) break;
    await sleep(Math.max(30, args.intervalSeconds) * 1000);
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
