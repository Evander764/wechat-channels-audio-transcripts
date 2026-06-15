import fs from 'node:fs/promises';
import path from 'node:path';

import {
  DEFAULT_OUTPUT_ROOT,
  DEFAULT_ROOT,
  DEFAULT_METADATA_JSON,
  ensureDir,
  loadMetadataRows,
  markdownWithMetrics,
  pickMetricFields,
  readJson,
  resolveOutDir,
  safeFileName,
  timestampedTextFromSegments,
  titleSimilarity,
  transcriptTextFromSegments,
  writeCsv,
} from './wechat_transcript_common.mjs';

function parseArgs(argv) {
  const out = {
    root: DEFAULT_ROOT,
    metadataJson: DEFAULT_METADATA_JSON,
    outputRoot: DEFAULT_OUTPUT_ROOT,
    outputDir: '',
    accountUsername: '',
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === '--root') {
      out.root = next;
      i += 1;
    } else if (arg === '--metadata-json') {
      out.metadataJson = next;
      i += 1;
    } else if (arg === '--output-root') {
      out.outputRoot = next;
      i += 1;
    } else if (arg === '--output-dir') {
      out.outputDir = next;
      i += 1;
    } else if (arg === '--account-username') {
      out.accountUsername = next;
      i += 1;
    }
  }
  return out;
}

function seqFromFile(name) {
  const match = String(name).match(/^(\d{4})\./);
  return match ? Number(match[1]) : null;
}

function titleFromName(name) {
  return String(name)
    .replace(/^(\d{4})\./, '')
    .replace(/\.(md|json|wav|m4a|mp3|aac|mp4)$/i, '')
    .replace(/\.meta$/i, '')
    .trim();
}

function matchMetadata({ title, seq, segmentDuration, rows, objectId, accountUsername }) {
  if (objectId) {
    const exact = rows.find((row) =>
      String(row.object_id || '') === String(objectId) &&
      (!accountUsername || String(row.account_username || '') === String(accountUsername))
    );
    if (exact) {
      return {
        row: exact,
        score: 1,
        titleScore: 1,
        seqScore: 1,
        durationScore: 1,
      };
    }
  }

  const candidates = rows.map((row, index) => {
    const titleScore = titleSimilarity(title, row.title);
    const seqScore =
      seq != null && Number.isFinite(Number(row.source_index))
        ? Math.max(0, 1 - Math.abs(seq - Number(row.source_index)) / 20)
        : 0;
    const duration = Number(row.duration_seconds || 0);
    const durationScore =
      duration && segmentDuration
        ? Math.max(0, 1 - Math.min(Math.abs(duration - segmentDuration), Math.abs(duration * 3 - segmentDuration)) / Math.max(duration, segmentDuration, 1))
        : 0;
    return {
      row,
      score: Math.max(titleScore, 0.65 * titleScore + 0.25 * seqScore + 0.1 * durationScore),
      titleScore,
      seqScore,
      durationScore,
    };
  });
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0] || null;
}

async function findExistingAudio(root, seq, title) {
  const audioDir = path.join(root, 'audio');
  const files = await fs.readdir(audioDir).catch(() => []);
  const seqText = String(seq || '').padStart(4, '0');
  const titleKey = titleFromName(title);
  const candidates = files
    .filter((name) => name.startsWith(`${seqText}.`) && /\.(wav|m4a|mp3|aac|mp4)$/i.test(name))
    .filter((name) => !/(\.recording|\.overlong)\.(wav|m4a|mp3|aac|mp4)$/i.test(name));

  return candidates
    .map((name) => path.join(audioDir, name))
    .find((file) => titleSimilarity(titleKey, titleFromName(path.basename(file))) > 0.7) ||
    candidates
      .map((name) => path.join(audioDir, name))[0] ||
    '';
}

function scoreTranscriptEntry(entry) {
  const playbackSpeed = Number(entry.segmentPayload.meta?.playback_speed || 1);
  const segmentDuration = Number(entry.segmentPayload.duration || 0);
  const expectedDuration = Number(entry.metrics.duration_seconds || 0);
  const actualDuration = playbackSpeed > 1.01 ? segmentDuration * playbackSpeed : segmentDuration;
  const durationFit = expectedDuration
    ? Math.max(0, 1 - Math.abs(expectedDuration - actualDuration) / Math.max(expectedDuration, 1))
    : 0;
  const normalSpeedScore = playbackSpeed <= 1.01 ? 2 : 0;
  const segmentScore = Math.min(Number(entry.segmentPayload.segments?.length || 0) / 200, 1);
  return entry.matchScore * 8 + durationFit * 3 + normalSpeedScore + segmentScore;
}

function dedupeTranscriptEntries(entries) {
  const selected = new Map();
  for (const entry of entries) {
    const key = entry.metrics.object_id || `seq:${entry.seq}:${entry.capturedTitle}`;
    const current = selected.get(key);
    if (!current || scoreTranscriptEntry(entry) > scoreTranscriptEntry(current)) {
      selected.set(key, entry);
    }
  }
  return [...selected.values()].sort((a, b) => a.seq - b.seq);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const root = args.root;
  const outDir = args.outputDir || resolveOutDir(args.outputRoot, 'wechat_transcripts_with_metrics_existing');
  const enrichedDir = path.join(outDir, 'texts_with_metrics');
  const jsonDir = path.join(outDir, 'json');
  await ensureDir(enrichedDir);
  await ensureDir(jsonDir);

  const rows = (await loadMetadataRows(args.metadataJson))
    .filter((row) => !args.accountUsername || row.account_username === args.accountUsername);
  const segmentDir = path.join(root, 'segments');
  const textDir = path.join(root, 'texts');
  const segmentFiles = (await fs.readdir(segmentDir))
    .filter((name) => /^(\d{4})\..+\.json$/i.test(name))
    .sort();

  const entries = [];
  for (const segmentName of segmentFiles) {
    const seq = seqFromFile(segmentName);
    const segmentPath = path.join(segmentDir, segmentName);
    const segmentPayload = await readJson(segmentPath);
    const title = segmentPayload.meta?.title || titleFromName(segmentName);
    const match = matchMetadata({
      title,
      seq,
      segmentDuration: Number(segmentPayload.duration || 0),
      rows,
      objectId: segmentPayload.meta?.object_id,
      accountUsername: segmentPayload.meta?.account_username,
    });
    const metrics = pickMetricFields(match?.row);
    const transcriptText = transcriptTextFromSegments(segmentPayload);
    const timestampedText = timestampedTextFromSegments(segmentPayload);
    const originalTranscript = path.join(textDir, `${path.basename(segmentName, '.json')}.md`);
    const audioPath = await findExistingAudio(root, seq, title);
    const matchScore = match ? Number(match.score.toFixed(4)) : 0;
    entries.push({
      seq,
      outputTitle: metrics.title || title,
      capturedTitle: title,
      segmentPath,
      originalTranscript,
      audioPath,
      matchScore,
      metrics,
      transcriptText,
      timestampedText,
      segmentPayload,
    });
  }

  const selectedEntries = dedupeTranscriptEntries(entries);
  const manifestRows = [];
  for (const entry of selectedEntries) {
    const outputName = `${String(entry.seq || 0).padStart(4, '0')}.${safeFileName(entry.outputTitle)}.with_metrics.md`;
    const outputPath = path.join(enrichedDir, outputName);
    const payload = {
      source_segment_path: entry.segmentPath,
      original_transcript_path: entry.originalTranscript,
      audio_path: entry.audioPath,
      captured_title: entry.capturedTitle,
      match_score: entry.matchScore,
      metrics: entry.metrics,
      transcript: entry.transcriptText,
      timestamped_transcript: entry.timestampedText,
      segment_payload: entry.segmentPayload,
    };
    await fs.writeFile(path.join(jsonDir, outputName.replace(/\.md$/i, '.json')), JSON.stringify(payload, null, 2), 'utf8');
    await fs.writeFile(
      outputPath,
      markdownWithMetrics({
        title: entry.outputTitle,
        metrics: entry.metrics,
        transcriptText: entry.transcriptText,
        timestampedText: entry.timestampedText,
        extra: {
          audio_path: entry.audioPath,
          transcript_source: entry.segmentPayload.meta?.transcript_source || 'existing_loopback_audio_whisper',
          model: entry.segmentPayload.meta?.model || '',
          segment_count: entry.segmentPayload.segments?.length || 0,
          match_score: entry.matchScore,
          original_transcript_path: entry.originalTranscript,
        },
      }),
      'utf8',
    );
    manifestRows.push({
      seq: entry.seq,
      captured_title: entry.capturedTitle,
      matched_title: entry.metrics.title || '',
      account_name: entry.metrics.account_name || '',
      object_id: entry.metrics.object_id || '',
      create_time_iso: entry.metrics.create_time_iso || '',
      duration_seconds: entry.metrics.duration_seconds ?? '',
      like_count: entry.metrics.like_count ?? '',
      favorite_count: entry.metrics.favorite_count ?? '',
      raw_like_count: entry.metrics.raw_like_count ?? '',
      raw_favorite_count: entry.metrics.raw_favorite_count ?? '',
      forward_count: entry.metrics.forward_count ?? '',
      comment_count: entry.metrics.comment_count ?? '',
      read_count: entry.metrics.read_count ?? '',
      match_score: entry.matchScore,
      audio_path: entry.audioPath,
      transcript_path: outputPath,
    });
  }

  await fs.writeFile(
    path.join(outDir, 'manifest.json'),
    JSON.stringify(
      {
        source_root: root,
        metadata_json: args.metadataJson,
        completed_count: manifestRows.length,
        generated_at: new Date().toISOString(),
        rows: manifestRows,
      },
      null,
      2,
    ),
    'utf8',
  );
  await writeCsv(path.join(outDir, 'manifest.csv'), manifestRows);
  console.log(JSON.stringify({ ok: true, outDir, completed_count: manifestRows.length }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
