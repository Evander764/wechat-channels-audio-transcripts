import fs from 'node:fs/promises';
import path from 'node:path';

import {
  DEFAULT_OUTPUT_ROOT,
  DEFAULT_METADATA_JSON,
  ensureDir,
  latestManifest,
  loadMetadataRows,
  resolveOutDir,
  writeCsv,
} from './wechat_transcript_common.mjs';

function parseArgs(argv) {
  const out = {
    metadataJson: DEFAULT_METADATA_JSON,
    completedManifest: '',
    outputRoot: DEFAULT_OUTPUT_ROOT,
    outputDir: '',
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === '--metadata-json') {
      out.metadataJson = next;
      i += 1;
    } else if (arg === '--completed-manifest') {
      out.completedManifest = next;
      i += 1;
    } else if (arg === '--output-root') {
      out.outputRoot = next;
      i += 1;
    } else if (arg === '--output-dir') {
      out.outputDir = next;
      i += 1;
    }
  }
  return out;
}

async function readCompletedObjectIds(file) {
  if (!file) return new Set();
  const payload = JSON.parse(await fs.readFile(file, 'utf8'));
  return new Set((payload.rows || []).map((row) => String(row.object_id || '')).filter(Boolean));
}

function queueRow(row, index, status) {
  return {
    queue_index: index,
    status,
    account_name: row.account_name || '',
    account_username: row.account_username || '',
    object_id: row.object_id || '',
    object_nonce_id: row.object_nonce_id || '',
    title: row.title || '',
    create_time_iso: row.create_time_iso || '',
    duration_seconds: Number(row.duration_seconds || 0),
    estimated_record_seconds_3x: Math.ceil(Number(row.duration_seconds || 0) / 3),
    like_count: row.like_count ?? '',
    favorite_count: row.favorite_count ?? '',
    forward_count: row.forward_count ?? '',
    comment_count: row.comment_count ?? '',
    read_count: row.read_count ?? '',
    ip_region: row.ip_region || '',
    wechat_feed_url: row.wechat_feed_url || '',
    local_detail_api_url: row.local_detail_api_url || '',
  };
}

function sumSeconds(rows, key = 'duration_seconds') {
  return rows.reduce((sum, row) => sum + Number(row[key] || 0), 0);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.completedManifest) args.completedManifest = await latestManifest(args.outputRoot);
  const outDir = args.outputDir || resolveOutDir(args.outputRoot, 'wechat_audio_transcript_queue');
  await ensureDir(outDir);

  const rows = await loadMetadataRows(args.metadataJson);
  const completedIds = await readCompletedObjectIds(args.completedManifest);
  const completed = [];
  const pending = [];
  let index = 0;
  for (const row of rows) {
    index += 1;
    const status = completedIds.has(String(row.object_id || '')) ? 'completed' : 'pending';
    const item = queueRow(row, index, status);
    if (status === 'completed') completed.push(item);
    else pending.push(item);
  }

  const all = [...completed, ...pending].sort((a, b) => a.queue_index - b.queue_index);
  const summary = {
    metadata_json: args.metadataJson,
    completed_manifest: args.completedManifest,
    total_video_count: rows.length,
    completed_count: completed.length,
    pending_count: pending.length,
    total_duration_hours: Number((sumSeconds(all) / 3600).toFixed(2)),
    pending_duration_hours: Number((sumSeconds(pending) / 3600).toFixed(2)),
    pending_estimated_record_hours_3x: Number((sumSeconds(pending, 'estimated_record_seconds_3x') / 3600).toFixed(2)),
    generated_at: new Date().toISOString(),
  };

  await fs.writeFile(path.join(outDir, 'summary.json'), JSON.stringify(summary, null, 2), 'utf8');
  await fs.writeFile(path.join(outDir, 'queue.all.json'), JSON.stringify({ summary, rows: all }, null, 2), 'utf8');
  await fs.writeFile(path.join(outDir, 'queue.completed.json'), JSON.stringify({ summary, rows: completed }, null, 2), 'utf8');
  await fs.writeFile(path.join(outDir, 'queue.pending.json'), JSON.stringify({ summary, rows: pending }, null, 2), 'utf8');
  await writeCsv(path.join(outDir, 'queue.all.csv'), all);
  await writeCsv(path.join(outDir, 'queue.completed.csv'), completed);
  await writeCsv(path.join(outDir, 'queue.pending.csv'), pending);

  console.log(JSON.stringify({ ok: true, outDir, ...summary }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
