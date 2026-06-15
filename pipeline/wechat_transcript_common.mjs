import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function defaultOutputRoot() {
  const mediaDir = process.platform === 'darwin' ? 'Movies' : 'Videos';
  return path.join(os.homedir(), mediaDir, 'WeChat Channels Downloads');
}

export function defaultTranscribePython() {
  return process.platform === 'win32'
    ? path.join(PROJECT_ROOT, '.runtime', 'transcript-venv', 'Scripts', 'python.exe')
    : path.join(PROJECT_ROOT, '.runtime', 'transcript-venv', 'bin', 'python');
}

export function expandPath(value) {
  if (!value) return '';
  let text = String(value);
  text = text.replace(/^~(?=$|[\\/])/, os.homedir());
  text = text.replace(/%USERPROFILE%/gi, process.env.USERPROFILE || os.homedir());
  text = text.replace(/%LOCALAPPDATA%/gi, process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'));
  if (process.platform !== 'win32') text = text.replace(/\\/g, '/');
  return path.resolve(text);
}

export const DEFAULT_OUTPUT_ROOT = expandPath(
  process.env.WECHAT_CHANNELS_OUTPUT_ROOT || defaultOutputRoot(),
);

export const DEFAULT_ROOT = expandPath(
  process.env.WECHAT_CHANNELS_WORK_ROOT ||
    path.join(DEFAULT_OUTPUT_ROOT, 'audio_transcripts_dynamic'),
);

export const DEFAULT_METADATA_JSON = expandPath(process.env.WECHAT_CHANNELS_METADATA_JSON || '');

export const DEFAULT_TRANSCRIBE_PYTHON = expandPath(
  process.env.WECHAT_TRANSCRIBE_PYTHON || defaultTranscribePython(),
);

export const DEFAULT_TRANSCRIBE_SCRIPT = expandPath(
  process.env.WECHAT_TRANSCRIBE_SCRIPT ||
    path.join(PROJECT_ROOT, 'pipeline', 'transcribe_audio.py'),
);

export const DEFAULT_TRANSCRIBE_BATCH_SCRIPT = expandPath(
  process.env.WECHAT_TRANSCRIBE_BATCH_SCRIPT ||
    path.join(PROJECT_ROOT, 'pipeline', 'transcribe_wechat_audio_batch.py'),
);

export function stripBom(text) {
  return String(text || '').replace(/^\uFEFF/, '');
}

export function safeFileName(value, fallback = 'untitled') {
  const clean = String(value || fallback)
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
  return clean || fallback;
}

export function normalizeTitle(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[\u{1f300}-\u{1faff}]/gu, '')
    .replace(/[\s#，。！？，：；（）()[\]【】「」『』《》<>"'`·]/g, '')
    .trim();
}

function bigrams(text) {
  const normalized = normalizeTitle(text);
  if (normalized.length <= 1) return new Set(normalized ? [normalized] : []);
  const out = new Set();
  for (let i = 0; i < normalized.length - 1; i += 1) out.add(normalized.slice(i, i + 2));
  return out;
}

function diceCoefficient(a, b) {
  const aa = bigrams(a);
  const bb = bigrams(b);
  if (!aa.size || !bb.size) return 0;
  let same = 0;
  for (const item of aa) if (bb.has(item)) same += 1;
  return (2 * same) / (aa.size + bb.size);
}

function longestCommonSubstringLength(a, b) {
  const x = normalizeTitle(a);
  const y = normalizeTitle(b);
  if (!x || !y) return 0;
  const prev = new Array(y.length + 1).fill(0);
  let best = 0;
  for (let i = 1; i <= x.length; i += 1) {
    let lastDiag = 0;
    for (let j = 1; j <= y.length; j += 1) {
      const save = prev[j];
      prev[j] = x[i - 1] === y[j - 1] ? lastDiag + 1 : 0;
      if (prev[j] > best) best = prev[j];
      lastDiag = save;
    }
  }
  return best;
}

export function titleSimilarity(a, b) {
  const x = normalizeTitle(a);
  const y = normalizeTitle(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  if (x.includes(y) || y.includes(x)) return 0.92;
  const lcs = longestCommonSubstringLength(x, y) / Math.max(x.length, y.length);
  return Math.max(diceCoefficient(x, y), lcs);
}

export async function readJson(file) {
  return JSON.parse(stripBom(await fs.readFile(file, 'utf8')));
}

export async function loadMetadataRows(metadataJson = DEFAULT_METADATA_JSON) {
  if (!metadataJson) throw new Error('No metadata JSON configured. Run capture first or pass --metadata-json.');
  const payload = await readJson(metadataJson);
  if (Array.isArray(payload)) return payload;
  return Array.isArray(payload.rows) ? payload.rows : [];
}

export function csvEscape(value) {
  if (value === null || value === undefined) return '';
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export async function writeCsv(file, rows) {
  const headers = rows.length ? Object.keys(rows[0]) : [];
  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(headers.map((key) => csvEscape(row[key])).join(','));
  }
  await fs.writeFile(file, `${lines.join('\n')}\n`, 'utf8');
}

export function transcriptTextFromSegments(segmentPayload) {
  return (segmentPayload.segments || [])
    .map((segment) => String(segment.text || '').trim())
    .filter(Boolean)
    .join('\n');
}

export function timestampedTextFromSegments(segmentPayload) {
  return (segmentPayload.segments || [])
    .map((segment) => {
      const start = Number(segment.start || 0).toFixed(2);
      const end = Number(segment.end || 0).toFixed(2);
      return `[${start} - ${end}] ${String(segment.text || '').trim()}`;
    })
    .filter((line) => !line.endsWith('] '))
    .join('\n');
}

export function pickMetricFields(row) {
  if (!row) return {};
  return {
    account_name: row.account_name || '',
    account_username: row.account_username || '',
    contact_nickname: row.contact_nickname || '',
    object_id: row.object_id || '',
    object_nonce_id: row.object_nonce_id || '',
    title: row.title || '',
    create_time_iso: row.create_time_iso || '',
    duration_seconds: row.duration_seconds ?? '',
    file_size: row.file_size ?? '',
    like_count: row.like_count ?? '',
    favorite_count: row.favorite_count ?? '',
    forward_count: row.forward_count ?? '',
    comment_count: row.comment_count ?? '',
    read_count: row.read_count ?? '',
    friend_like_count: row.friend_like_count ?? '',
    ip_region: row.ip_region || '',
    source_page: row.source_page ?? '',
    source_index: row.source_index ?? '',
    wechat_feed_url: row.wechat_feed_url || '',
    local_detail_api_url: row.local_detail_api_url || '',
  };
}

export function markdownWithMetrics({ title, metrics, transcriptText, timestampedText, extra = {} }) {
  const fmt = (value) => (value === null || value === undefined ? '' : String(value));
  const lines = [
    `# ${title || metrics.title || '未命名视频'}`,
    '',
    '## 视频数据',
    '',
    `- 账号: ${fmt(metrics.account_name)}`,
    `- 发布时间: ${fmt(metrics.create_time_iso)}`,
    `- 视频时长: ${fmt(metrics.duration_seconds)} 秒`,
    `- 播放量: ${fmt(metrics.read_count)}`,
    `- 点赞: ${fmt(metrics.like_count)}`,
    `- 收藏: ${fmt(metrics.favorite_count)}`,
    `- 转发: ${fmt(metrics.forward_count)}`,
    `- 评论: ${fmt(metrics.comment_count)}`,
    `- 朋友点赞: ${fmt(metrics.friend_like_count)}`,
    `- IP 属地: ${fmt(metrics.ip_region)}`,
    `- object_id: ${fmt(metrics.object_id)}`,
    `- object_nonce_id: ${fmt(metrics.object_nonce_id)}`,
    `- 视频定位链接: ${fmt(metrics.wechat_feed_url)}`,
    '',
    '## 转写信息',
    '',
    `- 音频文件: ${fmt(extra.audio_path)}`,
    `- 转写来源: ${fmt(extra.transcript_source)}`,
    `- 模型: ${fmt(extra.model)}`,
    `- 分段数: ${fmt(extra.segment_count)}`,
    `- 匹配分数: ${fmt(extra.match_score)}`,
    `- 原始稿件: ${fmt(extra.original_transcript_path)}`,
    '',
    '## 文字稿',
    '',
    transcriptText || '',
  ];
  if (timestampedText) {
    lines.push('', '## 分段时间戳', '', timestampedText);
  }
  lines.push('');
  return lines.join('\n');
}

export async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

export function resolveOutDir(base, prefix) {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, '').replace('T', '_');
  return path.join(base, `${prefix}_${stamp}`);
}

export async function latestManifest(outputRoot = DEFAULT_OUTPUT_ROOT) {
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
