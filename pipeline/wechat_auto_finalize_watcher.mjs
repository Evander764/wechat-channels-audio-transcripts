import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';

import {
  DEFAULT_OUTPUT_ROOT,
  DEFAULT_METADATA_JSON,
  latestManifest,
  loadMetadataRows,
  PROJECT_ROOT,
  readJson,
} from './wechat_transcript_common.mjs';
import { archivePaths } from '../scripts/archive.mjs';

function parseArgs(argv) {
  const args = {
    outputRoot: DEFAULT_OUTPUT_ROOT,
    metadataJson: DEFAULT_METADATA_JSON,
    intervalSeconds: 300,
    total: 0,
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
      args.total = Number(next || 0);
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
      if (code === 0 || options.allowFailure) resolve({ code, stdout, stderr });
      else reject(new Error(`${command} exited ${code}`));
    });
  });
}

function extractJsonObject(text) {
  const start = text.lastIndexOf('\n{');
  const slice = start >= 0 ? text.slice(start + 1) : text;
  return JSON.parse(slice);
}

async function enrich(args) {
  const result = await run('node', [
    './pipeline/enrich_existing_wechat_transcripts.mjs',
    '--metadata-json', args.metadataJson,
    '--output-root', args.outputRoot,
  ], {
    cwd: PROJECT_ROOT,
    capture: true,
  });
  return extractJsonObject(result.stdout);
}

async function packageManifest(manifest, outputRoot) {
  const outDir = path.dirname(manifest);
  const base = path.basename(outDir);
  const zipPath = path.join(outputRoot, `${base}.zip`);
  const candidates = [
    path.join(outDir, 'texts_with_metrics'),
    path.join(outDir, 'manifest.json'),
    path.join(outDir, 'manifest.csv'),
    path.join(outDir, 'json'),
  ];
  const paths = [];
  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      paths.push(candidate);
    } catch {}
  }
  if (!paths.length) throw new Error(`nothing to package from ${outDir}`);

  await archivePaths({ cwd: outDir, zipPath, paths });
  return zipPath;
}

async function totalCount(args) {
  if (args.total) return args.total;
  const rows = await loadMetadataRows(args.metadataJson);
  return rows.filter((row) => row.is_video !== false && row.object_id && row.object_nonce_id).length;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const total = await totalCount(args);
  if (!total) throw new Error('could not determine total video count');

  while (true) {
    let manifest = await latestManifest(args.outputRoot);
    let completed = await completedCount(manifest);
    console.log(JSON.stringify({ event: 'watch', completed, total, manifest, time: new Date().toISOString() }));

    if (completed < total) {
      const enriched = await enrich(args);
      manifest = path.join(enriched.outDir, 'manifest.json');
      completed = Number(enriched.completed_count || 0);
      console.log(JSON.stringify({ event: 'enriched', completed, total, manifest, time: new Date().toISOString() }));
    }

    if (completed >= total) {
      const zipPath = await packageManifest(manifest, args.outputRoot);
      console.log(JSON.stringify({ event: 'packaged', completed, total, manifest, zipPath, time: new Date().toISOString() }));
      break;
    }

    if (args.once) break;
    await sleep(Math.max(30, args.intervalSeconds) * 1000);
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
