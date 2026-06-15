import fs from 'node:fs/promises';
import path from 'node:path';

import {
  DEFAULT_OUTPUT_ROOT,
  DEFAULT_ROOT,
  DEFAULT_METADATA_JSON,
  latestManifest,
  loadMetadataRows,
  readJson,
} from './wechat_transcript_common.mjs';

function parseArgs(argv) {
  const args = {
    root: DEFAULT_ROOT,
    outputRoot: DEFAULT_OUTPUT_ROOT,
    metadataJson: DEFAULT_METADATA_JSON,
    manifest: '',
    requireComplete: false,
    sampleLimit: 20,
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
    } else if (arg === '--manifest') {
      args.manifest = next;
      i += 1;
    } else if (arg === '--require-complete') {
      args.requireComplete = true;
    } else if (arg === '--sample-limit') {
      args.sampleLimit = Number(next || args.sampleLimit);
      i += 1;
    }
  }
  return args;
}

function countById(ids) {
  const counts = new Map();
  for (const id of ids.map((value) => String(value || '').trim()).filter(Boolean)) {
    counts.set(id, (counts.get(id) || 0) + 1);
  }
  return counts;
}

function duplicateIds(ids) {
  return [...countById(ids).entries()]
    .filter(([, count]) => count > 1)
    .map(([id, count]) => ({ id, count }));
}

async function localAudioIds(root) {
  const metaDir = path.join(root, 'meta');
  const files = await fs.readdir(metaDir).catch(() => []);
  const ids = [];
  for (const file of files) {
    if (!file.endsWith('.meta.json')) continue;
    try {
      const meta = await readJson(path.join(metaDir, file));
      const objectId = String(meta.object_id || '').trim();
      const audio = String(meta.audio || '').trim();
      if (!objectId || !audio) continue;
      await fs.access(audio);
      ids.push(objectId);
    } catch {}
  }
  return ids;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const manifest = args.manifest || await latestManifest(args.outputRoot);
  if (!manifest) throw new Error('No manifest found; pass --manifest or --output-root');

  const sourceRows = (await loadMetadataRows(args.metadataJson))
    .filter((row) => row.is_video !== false && row.object_id && row.object_nonce_id);
  const sourceIds = sourceRows.map((row) => String(row.object_id));
  const sourceSet = new Set(sourceIds);

  const manifestPayload = await readJson(manifest);
  const manifestRows = manifestPayload.rows || [];
  const manifestIds = manifestRows.map((row) => String(row.object_id || '')).filter(Boolean);
  const manifestSet = new Set(manifestIds);

  const audioIds = await localAudioIds(args.root);
  const audioSet = new Set(audioIds);
  const accountedSet = new Set([...manifestSet, ...audioSet]);

  const sourceDuplicates = duplicateIds(sourceIds);
  const manifestDuplicates = duplicateIds(manifestIds);
  const audioDuplicates = duplicateIds(audioIds);
  const extraInManifest = [...manifestSet].filter((id) => !sourceSet.has(id));
  const missingFromManifest = [...sourceSet].filter((id) => !manifestSet.has(id));
  const downloadedNotManifest = [...audioSet].filter((id) => sourceSet.has(id) && !manifestSet.has(id));
  const missingWithoutAudio = [...sourceSet].filter((id) => !accountedSet.has(id));

  const ok =
    sourceDuplicates.length === 0 &&
    manifestDuplicates.length === 0 &&
    extraInManifest.length === 0 &&
    (!args.requireComplete || missingFromManifest.length === 0);

  const summary = {
    ok,
    require_complete: args.requireComplete,
    source: {
      total: sourceIds.length,
      unique: sourceSet.size,
      duplicate_object_ids: sourceDuplicates.length,
    },
    final_manifest: {
      path: manifest,
      generated_at: manifestPayload.generated_at || '',
      completed_count: Number(manifestPayload.completed_count ?? manifestRows.length),
      rows: manifestRows.length,
      unique_object_ids: manifestSet.size,
      duplicate_object_ids: manifestDuplicates.length,
      extra_ids_not_in_source: extraInManifest.length,
    },
    local_audio: {
      files_with_object_id: audioIds.length,
      unique_object_ids: audioSet.size,
      duplicate_object_ids: audioDuplicates.length,
    },
    reconciliation: {
      missing_from_manifest: missingFromManifest.length,
      downloaded_not_manifest: downloadedNotManifest.length,
      missing_without_local_audio: missingWithoutAudio.length,
      accounted_unique_ids: accountedSet.size,
    },
    samples: {
      source_duplicate_object_ids: sourceDuplicates.slice(0, args.sampleLimit),
      manifest_duplicate_object_ids: manifestDuplicates.slice(0, args.sampleLimit),
      extra_ids_not_in_source: extraInManifest.slice(0, args.sampleLimit),
      downloaded_not_manifest: downloadedNotManifest.slice(0, args.sampleLimit),
      missing_without_local_audio: missingWithoutAudio.slice(0, args.sampleLimit),
    },
  };

  console.log(JSON.stringify(summary, null, 2));
  if (!ok) process.exitCode = args.requireComplete ? 3 : 2;
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
