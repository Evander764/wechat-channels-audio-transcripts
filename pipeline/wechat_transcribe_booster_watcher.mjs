import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';

import {
  DEFAULT_ROOT,
  DEFAULT_TRANSCRIBE_BATCH_SCRIPT,
  DEFAULT_TRANSCRIBE_PYTHON,
  PROJECT_ROOT,
} from './wechat_transcript_common.mjs';
import { activeCommandLineCount } from './processes.mjs';

function parseArgs(argv) {
  const args = {
    root: DEFAULT_ROOT,
    python: DEFAULT_TRANSCRIBE_PYTHON,
    script: DEFAULT_TRANSCRIBE_BATCH_SCRIPT,
    intervalSeconds: 60,
    limit: 32,
    minBacklog: 16,
    maxBoosters: 3,
    model: 'small',
    language: 'zh',
    once: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === '--root') {
      args.root = next;
      i += 1;
    } else if (arg === '--python') {
      args.python = next;
      i += 1;
    } else if (arg === '--script') {
      args.script = next;
      i += 1;
    } else if (arg === '--interval-seconds') {
      args.intervalSeconds = Number(next || args.intervalSeconds);
      i += 1;
    } else if (arg === '--limit') {
      args.limit = Number(next || args.limit);
      i += 1;
    } else if (arg === '--min-backlog') {
      args.minBacklog = Number(next || args.minBacklog);
      i += 1;
    } else if (arg === '--max-boosters') {
      args.maxBoosters = Number(next || args.maxBoosters);
      i += 1;
    } else if (arg === '--model') {
      args.model = next || args.model;
      i += 1;
    } else if (arg === '--language') {
      args.language = next || args.language;
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

async function countFiles(dir, pattern) {
  const files = await fs.readdir(dir).catch(() => []);
  return files.filter((name) => pattern.test(name)).length;
}

async function backlog(root) {
  const audio = await countFiles(path.join(root, 'audio'), /\.m4a$/i);
  const segments = await countFiles(path.join(root, 'segments'), /\.json$/i);
  const locks = await countFiles(path.join(root, 'segments'), /\.lock$/i);
  return {
    audio,
    segments,
    locks,
    backlog: audio - segments,
  };
}

async function activeBoosterCount() {
  return activeCommandLineCount(['transcribe_wechat_audio_batch.py', 'no-cpu-fallback']);
}

async function startBooster(args) {
  await fs.mkdir(path.join(PROJECT_ROOT, 'run_logs'), { recursive: true });
  const stamp = new Date()
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, '')
    .replace(/[^0-9TZ]/g, '');
  const suffix = `${stamp}_${process.pid}_${Math.random().toString(16).slice(2, 8)}`;
  const stdoutPath = path.join(PROJECT_ROOT, 'run_logs', `transcribe_booster_watch_${suffix}.out.log`);
  const stderrPath = path.join(PROJECT_ROOT, 'run_logs', `transcribe_booster_watch_${suffix}.err.log`);
  const stdout = await fs.open(stdoutPath, 'a');
  const stderr = await fs.open(stderrPath, 'a');
  const child = spawn(args.python, [
    args.script,
    '--root', args.root,
    '--limit', String(args.limit),
    '--model', args.model,
    '--language', args.language,
    '--no-cpu-fallback',
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
  for (;;) {
    const state = await backlog(args.root);
    const active = await activeBoosterCount();
    const base = {
      time: new Date().toISOString(),
      ...state,
      active_boosters: active,
    };

    const maxBoosters = Math.max(1, Math.floor(Number(args.maxBoosters || 1)));
    const missing = Math.max(0, maxBoosters - active);
    const neededByBacklog = Math.max(0, Math.ceil(state.backlog / Math.max(1, args.limit)));
    const toStart = state.backlog >= args.minBacklog
      ? Math.min(missing, neededByBacklog)
      : 0;

    if (toStart > 0) {
      const launched = [];
      for (let index = 0; index < toStart; index += 1) {
        launched.push(await startBooster(args));
      }
      console.log(JSON.stringify({ event: 'booster_started', ...base, max_boosters: maxBoosters, launched }));
    } else {
      console.log(JSON.stringify({ event: 'booster_wait', ...base, max_boosters: maxBoosters }));
    }

    if (args.once) break;
    await sleep(Math.max(30, args.intervalSeconds) * 1000);
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
