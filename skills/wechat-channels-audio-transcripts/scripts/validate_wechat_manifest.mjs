#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

function parseArgs(argv) {
  const args = {
    manifest: '',
    metadataJson: '',
    requireComplete: false,
    requireTranscripts: true,
    requireMetrics: true,
    sampleLimit: 20,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === '--manifest') {
      args.manifest = next || '';
      i += 1;
    } else if (arg === '--metadata-json') {
      args.metadataJson = next || '';
      i += 1;
    } else if (arg === '--require-complete') {
      args.requireComplete = true;
    } else if (arg === '--no-require-transcripts') {
      args.requireTranscripts = false;
    } else if (arg === '--no-require-metrics') {
      args.requireMetrics = false;
    } else if (arg === '--sample-limit') {
      args.sampleLimit = Number(next || args.sampleLimit);
      i += 1;
    }
  }
  return args;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
}

function rowsFromMetadata(payload) {
  const rows = Array.isArray(payload) ? payload : payload.rows || payload.videos || payload.items || [];
  return rows.filter((row) => row && row.is_video !== false && (row.object_id || row.objectId) && (row.object_nonce_id || row.objectNonceId));
}

function idOf(row) {
  return String(row.object_id || row.objectId || '').trim();
}

function countDuplicates(ids) {
  const counts = new Map();
  for (const id of ids.filter(Boolean)) counts.set(id, (counts.get(id) || 0) + 1);
  return [...counts.entries()].filter(([, count]) => count > 1).map(([id, count]) => ({ id, count }));
}

function transcriptPath(row) {
  return row.transcript_path || row.markdown || row.text_path || row.scriptPath || row.transcriptPath || '';
}

function hasMetric(row) {
  const keys = [
    'like_count',
    'favorite_count',
    'forward_count',
    'comment_count',
    'read_count',
    'play_count',
    'duration_seconds',
    'create_time_iso',
    'object_id',
  ];
  return keys.some((key) => row[key] !== undefined && row[key] !== null && String(row[key]) !== '');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.manifest) throw new Error('Pass --manifest <manifest.json>');

  const manifestPath = path.resolve(args.manifest);
  const manifest = readJson(manifestPath);
  const rows = manifest.rows || [];
  const manifestIds = rows.map(idOf).filter(Boolean);
  const manifestSet = new Set(manifestIds);

  let sourceIds = [];
  if (args.metadataJson) {
    sourceIds = rowsFromMetadata(readJson(path.resolve(args.metadataJson))).map(idOf).filter(Boolean);
  }
  const sourceSet = new Set(sourceIds);

  const missingFromManifest = sourceIds.filter((id) => !manifestSet.has(id));
  const extraInManifest = sourceIds.length ? manifestIds.filter((id) => !sourceSet.has(id)) : [];
  const missingTranscriptRows = [];
  const missingMetricRows = [];

  for (const row of rows) {
    if (args.requireTranscripts) {
      const file = transcriptPath(row);
      if (!file || !fs.existsSync(file) || fs.statSync(file).size <= 0) {
        missingTranscriptRows.push({ object_id: idOf(row), title: row.title || row.matched_title || '', path: file });
      }
    }
    if (args.requireMetrics && !hasMetric(row)) {
      missingMetricRows.push({ object_id: idOf(row), title: row.title || row.matched_title || '' });
    }
  }

  const summary = {
    ok:
      countDuplicates(sourceIds).length === 0 &&
      countDuplicates(manifestIds).length === 0 &&
      extraInManifest.length === 0 &&
      (!args.requireComplete || missingFromManifest.length === 0) &&
      (!args.requireTranscripts || missingTranscriptRows.length === 0) &&
      (!args.requireMetrics || missingMetricRows.length === 0),
    manifest: manifestPath,
    generated_at: manifest.generated_at || '',
    completed_count: Number(manifest.completed_count ?? rows.length),
    manifest_rows: rows.length,
    manifest_unique_ids: manifestSet.size,
    source_total: sourceIds.length || null,
    source_unique_ids: sourceIds.length ? sourceSet.size : null,
    duplicate_source_ids: countDuplicates(sourceIds).length,
    duplicate_manifest_ids: countDuplicates(manifestIds).length,
    missing_from_manifest: missingFromManifest.length,
    extra_in_manifest: extraInManifest.length,
    missing_transcripts: missingTranscriptRows.length,
    missing_metrics: missingMetricRows.length,
    samples: {
      missing_from_manifest: missingFromManifest.slice(0, args.sampleLimit),
      extra_in_manifest: extraInManifest.slice(0, args.sampleLimit),
      missing_transcripts: missingTranscriptRows.slice(0, args.sampleLimit),
      missing_metrics: missingMetricRows.slice(0, args.sampleLimit),
    },
  };

  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) process.exitCode = 2;
}

try {
  main();
} catch (error) {
  console.error(error.stack || error.message);
  process.exitCode = 1;
}
