import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';

import {
  PROJECT_ROOT,
  accountsConfigured,
  buildEnv,
  configPathFromArg,
  ensureRuntimeDirs,
  loadConfig,
  saveConfig,
  writeJson,
} from './config.mjs';

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: PROJECT_ROOT,
      env: options.env,
      stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
      windowsHide: true,
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

function extractLastJson(text) {
  const candidates = [];
  for (let index = text.lastIndexOf('{'); index >= 0; index = text.lastIndexOf('{', index - 1)) {
    candidates.push(text.slice(index));
  }
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {}
  }
  throw new Error('No JSON summary found in command output.');
}

async function latestManifest(outputRoot) {
  const entries = await fs.readdir(outputRoot, { withFileTypes: true }).catch(() => []);
  const manifests = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith('wechat_transcripts_with_metrics_existing_')) continue;
    const manifest = path.join(outputRoot, entry.name, 'manifest.json');
    try {
      const stat = await fs.stat(manifest);
      manifests.push({ manifest, mtimeMs: stat.mtimeMs });
    } catch {}
  }
  manifests.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return manifests[0]?.manifest || '';
}

function commonMarathonArgs(config, includeTranscribe) {
  const args = [
    './windows/wechat_direct_marathon.mjs',
    '--root', config.workRoot,
    '--output-root', config.outputRoot,
    '--metadata-json', config.metadataJson,
    '--python', config.transcription.python,
    '--transcribe-script', path.join(PROJECT_ROOT, 'windows', 'transcribe_audio.py'),
    '--transcribe-batch', path.join(PROJECT_ROOT, 'windows', 'transcribe_wechat_audio_batch.py'),
    '--batch-limit', String(config.download.batchLimit),
    '--transcribe-limit', String(config.transcription.transcribeLimit),
    '--concurrency', String(config.download.concurrency),
    '--max-concurrency', String(config.download.maxConcurrency),
    '--max-batches', String(config.download.maxBatches),
    '--model', config.transcription.model,
    '--order', config.download.order,
    '--stop-after-no-progress', String(config.download.stopAfterNoProgress),
    '--timeout-ms', String(config.download.timeoutMs),
  ];
  if (!includeTranscribe) args.push('--skip-batch-transcribe');
  return args;
}

async function capture(config, env) {
  const accounts = accountsConfigured(config);
  if (!accounts.length) throw new Error('No accounts configured. Edit wechat.config.json accounts[].username first.');
  const accountsFile = path.join(PROJECT_ROOT, '.runtime', 'accounts.json');
  await writeJson(accountsFile, { accounts });
  const result = await run(process.execPath, [
    './windows/wechat_channels_export_metadata_post.mjs',
    '--base-url', config.wxChannelBaseUrl,
    '--output-root', config.outputRoot,
    '--accounts-json', accountsFile,
    '--max-pages', String(config.maxPages),
  ], { env, capture: true });
  const summary = extractLastJson(result.stdout);
  if (summary.metadata_json) {
    config.metadataJson = summary.metadata_json;
    await saveConfig(config.configPath, config);
  }
  return summary;
}

async function download(config, env, includeTranscribe) {
  if (!config.metadataJson) throw new Error('No metadataJson configured. Run npm run capture first.');
  await run(process.execPath, commonMarathonArgs(config, includeTranscribe), { env });
}

async function transcribe(config, env) {
  const args = [
    './windows/transcribe_wechat_audio_batch.py',
    '--root', config.workRoot,
    '--limit', String(config.transcription.transcribeLimit),
    '--model', config.transcription.model,
    '--language', config.transcription.language,
    '--device', config.transcription.device,
    '--compute-type', config.transcription.computeType,
  ];
  if (!config.transcription.allowCpuFallback) args.push('--no-cpu-fallback');
  await run(config.transcription.python, args, { env });
}

async function enrich(config, env) {
  const result = await run(process.execPath, [
    './windows/enrich_existing_wechat_transcripts.mjs',
    '--root', config.workRoot,
    '--output-root', config.outputRoot,
    '--metadata-json', config.metadataJson,
  ], { env, capture: true });
  return extractLastJson(result.stdout);
}

async function verify(config, env, requireComplete = true) {
  const manifest = await latestManifest(config.outputRoot);
  if (!manifest) throw new Error('No final manifest found. Run npm run enrich first.');
  await run(process.execPath, [
    './windows/verify_wechat_download_integrity.mjs',
    '--root', config.workRoot,
    '--output-root', config.outputRoot,
    '--metadata-json', config.metadataJson,
    '--manifest', manifest,
    ...(requireComplete ? ['--require-complete'] : []),
  ], { env });
  return manifest;
}

function psSingle(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

async function packageOutput(config) {
  const manifest = await latestManifest(config.outputRoot);
  if (!manifest) throw new Error('No final manifest found. Run npm run enrich first.');
  const outDir = path.dirname(manifest);
  const zipPath = path.join(config.outputRoot, `${path.basename(outDir)}.zip`);
  const candidates = ['texts_with_metrics', 'json', 'manifest.json', 'manifest.csv']
    .map((name) => path.join(outDir, name));
  const existing = [];
  for (const item of candidates) {
    try {
      await fs.access(item);
      existing.push(item);
    } catch {}
  }
  if (!existing.length) throw new Error(`Nothing to package from ${outDir}`);
  const command = [
    '$ErrorActionPreference = "Stop"',
    `$paths = @(${existing.map(psSingle).join(',')})`,
    `Compress-Archive -LiteralPath $paths -DestinationPath ${psSingle(zipPath)} -Force`,
  ].join('; ');
  await run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command], { env: process.env });
  console.log(JSON.stringify({ ok: true, zipPath, manifest }, null, 2));
}

function commandFromArgs(argv) {
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === '--config') {
      index += 1;
      continue;
    }
    if (!item.startsWith('--')) return item;
  }
  return 'help';
}

async function main() {
  const argv = process.argv.slice(2);
  const command = commandFromArgs(argv);
  const configPath = configPathFromArg(argv);
  const config = await loadConfig(configPath);
  await ensureRuntimeDirs(config);
  const env = buildEnv(config);

  if (command === 'capture') {
    await capture(config, env);
  } else if (command === 'download') {
    await download(config, env, false);
  } else if (command === 'transcribe') {
    await transcribe(config, env);
  } else if (command === 'enrich') {
    await enrich(config, env);
  } else if (command === 'verify') {
    await verify(config, env, true);
  } else if (command === 'package') {
    await packageOutput(config);
  } else if (command === 'run') {
    if (!config.metadataJson) await capture(config, env);
    const freshConfig = await loadConfig(configPath);
    await download(freshConfig, buildEnv(freshConfig), true);
    await enrich(freshConfig, buildEnv(freshConfig));
    await verify(freshConfig, buildEnv(freshConfig), false);
    await packageOutput(freshConfig);
  } else {
    console.log('Usage: npm run <capture|download|transcribe|enrich|verify|package|run>');
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
