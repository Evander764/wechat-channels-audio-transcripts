import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';

import {
  DEFAULT_OUTPUT_ROOT,
  DEFAULT_ROOT,
  DEFAULT_METADATA_JSON,
  DEFAULT_TRANSCRIBE_PYTHON,
  DEFAULT_TRANSCRIBE_SCRIPT,
  ensureDir,
  loadMetadataRows,
  readJson,
  safeFileName,
} from './wechat_transcript_common.mjs';

const DEFAULT_DETAIL_BASE = `${process.env.WX_CHANNEL_BASE_URL || `http://127.0.0.1:${process.env.WX_CHANNEL_PORT || 2025}`}/api/channels/feed/profile`;
const MASK = (1n << 64n) - 1n;
const CURL_COMMAND = process.platform === 'win32' ? 'curl.exe' : 'curl';
const MEDIA_USER_AGENT = process.platform === 'darwin'
  ? 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
  : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

function curlBaseArgs() {
  return process.platform === 'win32' ? ['--ssl-no-revoke'] : [];
}

function u64(value) {
  return value & MASK;
}

function parseArgs(argv) {
  const out = {
    root: DEFAULT_ROOT,
    outputRoot: DEFAULT_OUTPUT_ROOT,
    metadataJson: DEFAULT_METADATA_JSON,
    completedManifest: '',
    detailBase: DEFAULT_DETAIL_BASE,
    python: DEFAULT_TRANSCRIBE_PYTHON,
    transcribeScript: DEFAULT_TRANSCRIBE_SCRIPT,
    limit: 1,
    startIndex: 0,
    order: 'metadata',
    model: 'small',
    concurrency: 1,
    maxConcurrency: 8,
    keepMedia: false,
    skipTranscribe: false,
    timeoutMs: 15 * 60 * 1000,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === '--root') {
      out.root = next;
      i += 1;
    } else if (arg === '--output-root') {
      out.outputRoot = next;
      i += 1;
    } else if (arg === '--metadata-json') {
      out.metadataJson = next;
      i += 1;
    } else if (arg === '--completed-manifest') {
      out.completedManifest = next;
      i += 1;
    } else if (arg === '--detail-base') {
      out.detailBase = next;
      i += 1;
    } else if (arg === '--python') {
      out.python = next;
      i += 1;
    } else if (arg === '--transcribe-script') {
      out.transcribeScript = next;
      i += 1;
    } else if (arg === '--limit') {
      out.limit = Number(next || 1);
      i += 1;
    } else if (arg === '--start-index') {
      out.startIndex = Number(next || 0);
      i += 1;
    } else if (arg === '--order') {
      out.order = next || 'metadata';
      i += 1;
    } else if (arg === '--model') {
      out.model = next;
      i += 1;
    } else if (arg === '--concurrency') {
      out.concurrency = Number(next || 1);
      i += 1;
    } else if (arg === '--max-concurrency') {
      out.maxConcurrency = Number(next || out.maxConcurrency);
      i += 1;
    } else if (arg === '--timeout-ms') {
      out.timeoutMs = Number(next || out.timeoutMs);
      i += 1;
    } else if (arg === '--keep-media') {
      out.keepMedia = true;
    } else if (arg === '--skip-transcribe') {
      out.skipTranscribe = true;
    }
  }
  return out;
}

async function latestManifest(outputRoot) {
  const entries = await fs.readdir(outputRoot, { withFileTypes: true }).catch(() => []);
  const dirs = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith('wechat_transcripts_with_metrics_existing_')) continue;
    const manifest = path.join(outputRoot, entry.name, 'manifest.json');
    try {
      const stat = await fs.stat(manifest);
      dirs.push({ manifest, mtimeMs: stat.mtimeMs });
    } catch {}
  }
  dirs.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return dirs[0]?.manifest || '';
}

async function completedObjectIds(file) {
  if (!file) return new Set();
  const payload = await readJson(file);
  return new Set((payload.rows || []).map((row) => String(row.object_id || '')).filter(Boolean));
}

async function localAudioObjectIds(root) {
  const found = new Set();
  const metaDir = path.join(root, 'meta');
  const files = await fs.readdir(metaDir).catch(() => []);
  for (const file of files) {
    if (!file.endsWith('.meta.json')) continue;
    try {
      const meta = await readJson(path.join(metaDir, file));
      const objectId = String(meta.object_id || '').trim();
      const audio = String(meta.audio || '').trim();
      if (!objectId || !audio) continue;
      await fs.access(audio);
      found.add(objectId);
    } catch {}
  }
  return found;
}

async function localFailureCounts(root) {
  const counts = new Map();
  const logFile = path.join(root, 'batch-log.jsonl');
  const text = await fs.readFile(logFile, 'utf8').catch(() => '');
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line);
      if (entry.event !== 'direct_failed') continue;
      const objectId = String(entry.object_id || '').trim();
      if (!objectId) continue;
      counts.set(objectId, (counts.get(objectId) || 0) + 1);
    } catch {}
  }
  return counts;
}

async function maxExistingSeq(root) {
  const names = [];
  for (const dir of ['segments', 'meta', 'audio', 'texts']) {
    const full = path.join(root, dir);
    const files = await fs.readdir(full).catch(() => []);
    names.push(...files);
  }
  let max = 0;
  for (const name of names) {
    const match = /^(\d{4})\./.exec(name);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return max;
}

class Isaac64 {
  constructor(seed) {
    this.randrsl = new Array(256).fill(0n);
    this.mm = new Array(256).fill(0n);
    this.randcnt = 0;
    this.aa = 0n;
    this.bb = 0n;
    this.cc = 0n;
    this.randrsl[0] = seed;
    this.randinit(true);
  }

  mix(a, b, c, d, e, f, g, h) {
    a = u64(a - e); f = u64(f ^ (h >> 9n)); h = u64(h + a);
    b = u64(b - f); g = u64(g ^ u64(a << 9n)); a = u64(a + b);
    c = u64(c - g); h = u64(h ^ (b >> 23n)); b = u64(b + c);
    d = u64(d - h); a = u64(a ^ u64(c << 15n)); c = u64(c + d);
    e = u64(e - a); b = u64(b ^ (d >> 14n)); d = u64(d + e);
    f = u64(f - b); c = u64(c ^ u64(e << 20n)); e = u64(e + f);
    g = u64(g - c); d = u64(d ^ (f >> 17n)); f = u64(f + g);
    h = u64(h - d); e = u64(e ^ u64(g << 14n)); g = u64(g + h);
    return [a, b, c, d, e, f, g, h];
  }

  randinit(flag) {
    let a = 0x9e3779b97f4a7c13n;
    let b = a, c = a, d = a, e = a, f = a, g = a, h = a;
    for (let j = 0; j < 4; j += 1) [a, b, c, d, e, f, g, h] = this.mix(a, b, c, d, e, f, g, h);
    for (let j = 0; j < 256; j += 8) {
      if (flag) {
        a = u64(a + this.randrsl[j]); b = u64(b + this.randrsl[j + 1]);
        c = u64(c + this.randrsl[j + 2]); d = u64(d + this.randrsl[j + 3]);
        e = u64(e + this.randrsl[j + 4]); f = u64(f + this.randrsl[j + 5]);
        g = u64(g + this.randrsl[j + 6]); h = u64(h + this.randrsl[j + 7]);
      }
      [a, b, c, d, e, f, g, h] = this.mix(a, b, c, d, e, f, g, h);
      this.mm[j] = a; this.mm[j + 1] = b; this.mm[j + 2] = c; this.mm[j + 3] = d;
      this.mm[j + 4] = e; this.mm[j + 5] = f; this.mm[j + 6] = g; this.mm[j + 7] = h;
    }
    if (flag) {
      for (let j = 0; j < 256; j += 8) {
        a = u64(a + this.mm[j]); b = u64(b + this.mm[j + 1]);
        c = u64(c + this.mm[j + 2]); d = u64(d + this.mm[j + 3]);
        e = u64(e + this.mm[j + 4]); f = u64(f + this.mm[j + 5]);
        g = u64(g + this.mm[j + 6]); h = u64(h + this.mm[j + 7]);
        [a, b, c, d, e, f, g, h] = this.mix(a, b, c, d, e, f, g, h);
        this.mm[j] = a; this.mm[j + 1] = b; this.mm[j + 2] = c; this.mm[j + 3] = d;
        this.mm[j + 4] = e; this.mm[j + 5] = f; this.mm[j + 6] = g; this.mm[j + 7] = h;
      }
    }
    this.isaac64();
    this.randcnt = 256;
  }

  isaac64() {
    this.cc = u64(this.cc + 1n);
    this.bb = u64(this.bb + this.cc);
    for (let j = 0; j < 256; j += 1) {
      const x = this.mm[j];
      if (j % 4 === 0) this.aa = u64(~u64(this.aa ^ u64(this.aa << 21n)));
      else if (j % 4 === 1) this.aa = u64(this.aa ^ (this.aa >> 5n));
      else if (j % 4 === 2) this.aa = u64(this.aa ^ u64(this.aa << 12n));
      else this.aa = u64(this.aa ^ (this.aa >> 33n));
      this.aa = u64(this.aa + this.mm[(j + 128) % 256]);
      const y = u64(this.mm[Number((x >> 3n) & 255n)] + this.aa + this.bb);
      this.mm[j] = y;
      this.bb = u64(this.mm[Number((y >> 11n) & 255n)] + x);
      this.randrsl[j] = this.bb;
    }
  }

  random() {
    if (this.randcnt === 0) {
      this.isaac64();
      this.randcnt = 256;
    }
    this.randcnt -= 1;
    return this.randrsl[this.randcnt];
  }

  generate(length) {
    const out = Buffer.alloc(length);
    let pos = 0;
    while (pos < length) {
      const val = this.random();
      for (let shift = 56n; shift >= 0n && pos < length; shift -= 8n) {
        out[pos] = Number((val >> shift) & 0xffn);
        pos += 1;
      }
    }
    return out;
  }
}

function directURL(media) {
  const base = String(media?.url || '').trim();
  const token = String(media?.urlToken || '').trim();
  if (!base) return '';
  return token && !base.includes(token) ? `${base}${token}` : base;
}

function firstMedia(payload) {
  const data = payload?.data?.data || payload?.data || payload;
  const object = data?.object || data;
  const media = object?.objectDesc?.media;
  return Array.isArray(media) ? media[0] : null;
}

function detailURL(base, row) {
  const u = new URL(base);
  u.searchParams.set('object_id', row.object_id);
  u.searchParams.set('nonce_id', row.object_nonce_id);
  return u.toString();
}

async function fetchDetail(row, args) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const res = await fetch(detailURL(args.detailBase, row), { signal: AbortSignal.timeout(75_000) });
      const text = await res.text();
      if (!res.ok) throw new Error(`detail HTTP ${res.status}: ${text.slice(0, 200)}`);
      const payload = JSON.parse(text);
      if (payload.code !== 0) throw new Error(`detail code ${payload.code}: ${payload.message || ''}`);
      const media = firstMedia(payload);
      const url = directURL(media);
      const key = String(media?.decodeKey || media?.decryptKey || '').trim();
      if (!url) throw new Error('detail response has no media url');
      return { payload, media, url, key };
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
    }
  }
  throw lastError;
}

async function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const { timeoutMs: childTimeoutMs, ...spawnOpts } = opts;
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, ...spawnOpts });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = childTimeoutMs
      ? setTimeout(() => {
          timedOut = true;
          if (process.platform === 'win32' && child.pid) {
            spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
              .on('error', () => {});
          } else {
            child.kill('SIGKILL');
          }
        }, childTimeoutMs)
      : null;
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      if (timedOut) {
        reject(new Error(`${cmd} timed out after ${childTimeoutMs}ms: ${stderr || stdout}`));
        return;
      }
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${cmd} exited ${code}: ${stderr || stdout}`));
    });
  });
}

async function existingSize(file) {
  try {
    return (await fs.stat(file)).size;
  } catch {
    return 0;
  }
}

function resumeSidecar(file) {
  return `${file}.resume.json`;
}

async function removeMediaAndSidecar(file) {
  await fs.rm(file, { force: true }).catch(() => {});
  await fs.rm(resumeSidecar(file), { force: true }).catch(() => {});
}

async function writeResumeSidecar(file, key, url) {
  await fs.writeFile(
    resumeSidecar(file),
    JSON.stringify({ key: String(key || ''), url: String(url || '') }, null, 2),
    'utf8',
  );
}

async function hasMatchingResumeSidecar(file, key, url) {
  try {
    const payload = await readJson(resumeSidecar(file));
    return String(payload.key || '') === String(key || '') &&
      String(payload.url || '') === String(url || '');
  } catch {
    return false;
  }
}

async function readResumeSidecar(file) {
  try {
    const payload = await readJson(resumeSidecar(file));
    const key = String(payload.key || '').trim();
    const url = String(payload.url || '').trim();
    if (!key || !url || await existingSize(file) <= 0) return null;
    return { key, url };
  } catch {
    return null;
  }
}

async function existingResumeForObject(root, objectId) {
  const tmpDir = path.join(root, 'tmp');
  const preferred = path.join(tmpDir, `${objectId}.media`);
  const preferredInfo = await readResumeSidecar(preferred);
  if (preferredInfo) return { ...preferredInfo, file: preferred };

  const files = await fs.readdir(tmpDir).catch(() => []);
  let best = null;
  for (const file of files) {
    if (!file.endsWith(`.${objectId}.media`)) continue;
    const full = path.join(tmpDir, file);
    const info = await readResumeSidecar(full);
    if (!info) continue;
    const size = await existingSize(full);
    if (!best || size > best.size) best = { ...info, file: full, size };
  }
  return best;
}

function parseContentRangeTotal(headersText) {
  const match = String(headersText || '').match(/content-range:\s*bytes\s+\d+-\d+\/(\d+)/i);
  return match ? Number(match[1]) : 0;
}

function parseContentLength(headersText) {
  const matches = [...String(headersText || '').matchAll(/content-length:\s*(\d+)/gi)];
  const last = matches.at(-1);
  return last ? Number(last[1]) : 0;
}

async function downloadRangeChunk(url, file, row, start, end, timeoutMs) {
  const partFile = `${file}.${start}-${end}.part`;
  const headersFile = `${partFile}.headers`;
  await fs.rm(partFile, { force: true }).catch(() => {});
  await fs.rm(headersFile, { force: true }).catch(() => {});

  let lastError;
  const chunkTimeoutMs = Math.min(Math.max(timeoutMs, 180_000), 420_000);
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      await run(CURL_COMMAND, [
        ...curlBaseArgs(),
        '--fail',
        '--location',
        '--retry', '1',
        '--connect-timeout', '20',
        '--speed-time', '60',
        '--speed-limit', '16384',
        '--max-time', String(Math.ceil(chunkTimeoutMs / 1000)),
        '--range', `${start}-${end}`,
        '-H', 'Origin: https://channels.weixin.qq.com',
        '-H', `Referer: ${row.wechat_feed_url || 'https://channels.weixin.qq.com/'}`,
        '-H', `User-Agent: ${MEDIA_USER_AGENT}`,
        '-D', headersFile,
        '-o', partFile,
        url,
      ], { timeoutMs: chunkTimeoutMs + 15_000 });
      const bytes = await existingSize(partFile);
      if (bytes <= 0) throw new Error('range chunk is empty');
      const headers = await fs.readFile(headersFile, 'utf8').catch(() => '');
      const total = parseContentRangeTotal(headers) || (start === 0 ? parseContentLength(headers) : 0);
      if (start > 0 && !parseContentRangeTotal(headers)) {
        throw new Error('server did not honor range request');
      }
      return { partFile, headersFile, bytes, total };
    } catch (error) {
      lastError = error;
      await fs.rm(partFile, { force: true }).catch(() => {});
      await fs.rm(headersFile, { force: true }).catch(() => {});
      if (attempt === 5) throw lastError;
      await new Promise((resolve) => setTimeout(resolve, attempt * 2000));
    }
  }
  throw lastError;
}

async function downloadByRanges(url, file, row, timeoutMs, key) {
  await writeResumeSidecar(file, key, url);
  const chunkSize = 8 * 1024 * 1024;
  let start = await existingSize(file);
  let total = 0;

  for (let chunkIndex = 0; chunkIndex < 1000; chunkIndex += 1) {
    if (total && start >= total) break;
    const end = total ? Math.min(total - 1, start + chunkSize - 1) : start + chunkSize - 1;
    const chunk = await downloadRangeChunk(url, file, row, start, end, timeoutMs);
    total = total || chunk.total;
    const data = await fs.readFile(chunk.partFile);
    await fs.appendFile(file, data);
    await fs.rm(chunk.partFile, { force: true }).catch(() => {});
    await fs.rm(chunk.headersFile, { force: true }).catch(() => {});
    start += data.length;
    if (!total && data.length < chunkSize) break;
  }

  const size = await existingSize(file);
  if (total && size < total) throw new Error(`range download incomplete: ${size}/${total}`);
  return size;
}

async function download(url, file, row, timeoutMs, key) {
  await ensureDir(path.dirname(file));
  await writeResumeSidecar(file, key, url);
  let lastError;
  const curlMaxSeconds = Math.max(60, Math.ceil(timeoutMs / 1000));
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      const resume = (await existingSize(file)) > 0;
      const curlArgs = [
        ...curlBaseArgs(),
        '--fail',
        '--location',
        '--retry', '0',
        '--connect-timeout', '20',
        '--speed-time', '60',
        '--speed-limit', '32768',
        '--max-time', String(curlMaxSeconds),
        '-H', 'Origin: https://channels.weixin.qq.com',
        '-H', `Referer: ${row.wechat_feed_url || 'https://channels.weixin.qq.com/'}`,
        '-H', `User-Agent: ${MEDIA_USER_AGENT}`,
        '-o', file,
        url,
      ];
      if (resume) curlArgs.splice(curlArgs.length - 3, 0, '--continue-at', '-');
      await run(CURL_COMMAND, curlArgs, { timeoutMs: timeoutMs + 15000 });
      break;
    } catch (error) {
      lastError = error;
      if (/range|416|resume|continue/i.test(String(error.message || ''))) {
        await removeMediaAndSidecar(file);
        await writeResumeSidecar(file, key, url);
      } else if (/HTTP|403|404|410|expired|forbidden/i.test(String(error.message || ''))) {
        await removeMediaAndSidecar(file);
      }
      if (attempt === 5) {
        if (/(curl|curl\.exe) (exited 18|exited 28|exited 56|timed out)|timed out after|server closed abruptly/i.test(String(lastError.message || ''))) {
          return downloadByRanges(url, file, row, timeoutMs, key);
        }
        throw lastError;
      }
      await new Promise((resolve) => setTimeout(resolve, attempt * 3000));
    }
  }
  const stat = await fs.stat(file);
  if (stat.size < 1024) throw new Error('downloaded media is too small');
  return stat.size;
}

async function headerLooksLikeMedia(file) {
  try {
    const handle = await fs.open(file, 'r');
    try {
      const chunk = Buffer.alloc(32);
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, 0);
      return looksLikeMediaHeader(chunk.subarray(0, bytesRead));
    } finally {
      await handle.close();
    }
  } catch {
    return false;
  }
}

async function removeMediaPartials(root, objectId) {
  const tmpDir = path.join(root, 'tmp');
  const files = await fs.readdir(tmpDir).catch(() => []);
  await Promise.all(files
    .filter((file) =>
      file === `${objectId}.media` ||
      file === `${objectId}.media.resume.json` ||
      file.endsWith(`.${objectId}.media`) ||
      file.endsWith(`.${objectId}.media.resume.json`))
    .map((file) => fs.rm(path.join(tmpDir, file), { force: true }).catch(() => {})));
}

async function resumableMediaFile(root, objectId, key, url) {
  const tmpDir = path.join(root, 'tmp');
  await ensureDir(tmpDir);
  const preferred = path.join(tmpDir, `${objectId}.media`);
  if (key && await headerLooksLikeMedia(preferred)) {
    await removeMediaAndSidecar(preferred);
  }
  if (await existingSize(preferred) > 0 && !await hasMatchingResumeSidecar(preferred, key, url)) {
    await removeMediaAndSidecar(preferred);
  }
  const currentSize = await existingSize(preferred);
  let best = { file: '', size: currentSize };
  const files = await fs.readdir(tmpDir).catch(() => []);
  for (const file of files) {
    if (!file.endsWith(`.${objectId}.media`)) continue;
    const full = path.join(tmpDir, file);
    if (key && await headerLooksLikeMedia(full)) {
      await removeMediaAndSidecar(full);
      continue;
    }
    if (!await hasMatchingResumeSidecar(full, key, url)) {
      await removeMediaAndSidecar(full);
      continue;
    }
    const size = await existingSize(full);
    if (size > best.size) best = { file: full, size };
  }
  if (best.file && best.file !== preferred) {
    await fs.copyFile(best.file, preferred);
    await fs.copyFile(resumeSidecar(best.file), resumeSidecar(preferred)).catch(() => {});
  }
  await writeResumeSidecar(preferred, key, url);
  return preferred;
}

function looksLikeMediaHeader(buffer) {
  const limit = Math.min(buffer.length, 32);
  for (let i = 4; i + 4 <= limit; i += 1) {
    const box = buffer.subarray(i, i + 4).toString('ascii');
    if (['ftyp', 'styp', 'moov', 'mdat'].includes(box)) return true;
  }
  return false;
}

async function decryptPrefix(file, key) {
  if (!key) return { decrypted: false };
  const seed = BigInt(key);
  const handle = await fs.open(file, 'r+');
  try {
    const stat = await handle.stat();
    const length = Math.min(131072, stat.size);
    const chunk = Buffer.alloc(length);
    const { bytesRead } = await handle.read(chunk, 0, length, 0);
    if (looksLikeMediaHeader(chunk.subarray(0, bytesRead))) {
      return { decrypted: false, already_media_header: true };
    }
    const decryptor = new Isaac64(seed).generate(bytesRead);
    for (let i = 0; i < bytesRead; i += 1) chunk[i] ^= decryptor[i];
    if (!looksLikeMediaHeader(chunk.subarray(0, bytesRead))) {
      throw new Error('decrypted header does not look like media');
    }
    await handle.write(chunk.subarray(0, bytesRead), 0, bytesRead, 0);
    return { decrypted: true, decryptedBytes: bytesRead };
  } finally {
    await handle.close();
  }
}

async function extractAudio(mediaFile, audioFile) {
  await ensureDir(path.dirname(audioFile));
  await fs.rm(audioFile, { force: true }).catch(() => {});
  try {
    await run('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-i', mediaFile, '-vn', '-c:a', 'copy', audioFile]);
  } catch {
    await fs.rm(audioFile, { force: true }).catch(() => {});
    await run('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-i', mediaFile, '-vn', '-c:a', 'aac', '-b:a', '128k', audioFile]);
  }
  await run('ffprobe', ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', audioFile]);
  return (await fs.stat(audioFile)).size;
}

async function transcribe(audioFile, metaFile, markdownFile, segmentFile, args) {
  await run(args.python, [
    args.transcribeScript,
    '--audio', audioFile,
    '--output-md', markdownFile,
    '--output-json', segmentFile,
    '--meta-json', metaFile,
    '--model', args.model,
    '--language', 'zh',
  ]);
  const payload = await readJson(segmentFile);
  return { segments: payload.segments?.length || 0, duration: payload.duration || 0 };
}

async function appendLog(root, payload) {
  const line = JSON.stringify({ ...payload, at: new Date().toISOString() });
  await fs.appendFile(path.join(root, 'batch-log.jsonl'), `${line}\n`, 'utf8');
}

async function processOne(row, seq, args) {
  const totalStartMs = performance.now();
  const seqText = String(seq).padStart(4, '0');
  const title = row.title || row.object_id;
  const base = `${seqText}.${safeFileName(title)}`;
  const audioFile = path.join(args.root, 'audio', `${base}.m4a`);
  const metaFile = path.join(args.root, 'meta', `${base}.meta.json`);
  const markdownFile = path.join(args.root, 'texts', `${base}.md`);
  const segmentFile = path.join(args.root, 'segments', `${base}.json`);
  const startedAt = new Date().toISOString();

  const detailStartMs = performance.now();
  const resumeInfo = await existingResumeForObject(args.root, row.object_id);
  const detail = resumeInfo
    ? { payload: null, media: null, url: resumeInfo.url, key: resumeInfo.key, fromResume: true }
    : await fetchDetail(row, args);
  const detailElapsedMs = performance.now() - detailStartMs;
  const meta = {
    seq,
    index: seq,
    title,
    account_name: row.account_name || '',
    account_username: row.account_username || '',
    object_id: row.object_id || '',
    object_nonce_id: row.object_nonce_id || '',
    duration: row.duration_seconds || '',
    duration_seconds: row.duration_seconds || '',
    wechat_feed_url: row.wechat_feed_url || '',
    transcript_source: 'direct_media_download_faster_whisper',
    media_url: detail.url,
    has_decode_key: !!detail.key,
    detail_from_resume: !!detail.fromResume,
    model: args.model,
    requested_concurrency: args.concurrency,
    effective_concurrency: args.effectiveConcurrency || args.concurrency,
    order: args.order,
    started_at: startedAt,
  };
  await fs.writeFile(metaFile, JSON.stringify(meta, null, 2), 'utf8');

  const tmpFile = await resumableMediaFile(args.root, row.object_id, detail.key, detail.url);
  const downloadStartMs = performance.now();
  const downloadedBytes = await download(detail.url, tmpFile, row, args.timeoutMs, detail.key);
  const downloadElapsedMs = performance.now() - downloadStartMs;
  let decryptInfo = { decrypted: false };
  try {
    decryptInfo = await decryptPrefix(tmpFile, detail.key);
  } catch (error) {
    await removeMediaPartials(args.root, row.object_id);
    throw error;
  }
  const extractStartMs = performance.now();
  let audioBytes = 0;
  try {
    audioBytes = await extractAudio(tmpFile, audioFile);
  } catch (error) {
    await removeMediaPartials(args.root, row.object_id);
    throw error;
  }
  const extractElapsedMs = performance.now() - extractStartMs;
  let tx = { segments: 0, duration: 0 };
  if (!args.skipTranscribe) {
    tx = await transcribe(audioFile, metaFile, markdownFile, segmentFile, args);
  }

  const finalMeta = {
    ...meta,
    status: args.skipTranscribe ? 'audio_ready' : 'completed',
    completed_at: args.skipTranscribe ? '' : new Date().toISOString(),
    downloaded_bytes: downloadedBytes,
    audio_bytes: audioBytes,
    detail_elapsed_ms: Math.round(detailElapsedMs),
    download_elapsed_ms: Math.round(downloadElapsedMs),
    extract_elapsed_ms: Math.round(extractElapsedMs),
    total_elapsed_ms: Math.round(performance.now() - totalStartMs),
    media_download_mbps: Number(((downloadedBytes / 1024 / 1024) / Math.max(downloadElapsedMs / 1000, 0.001)).toFixed(3)),
    audio: audioFile,
    markdown: markdownFile,
    segments: segmentFile,
    segment_count: tx.segments,
    transcribed_duration: tx.duration,
    ...decryptInfo,
  };
  await fs.writeFile(metaFile, JSON.stringify(finalMeta, null, 2), 'utf8');
  if (!args.keepMedia) await removeMediaAndSidecar(tmpFile);
  await appendLog(args.root, {
    event: args.skipTranscribe ? 'direct_audio_ready' : 'direct_completed',
    seq,
    title,
    object_id: row.object_id,
    audio: audioFile,
    segments: tx.segments,
    downloaded_bytes: downloadedBytes,
    download_elapsed_ms: Math.round(downloadElapsedMs),
    total_elapsed_ms: Math.round(performance.now() - totalStartMs),
    requested_concurrency: args.concurrency,
    effective_concurrency: args.effectiveConcurrency || args.concurrency,
  });
  return finalMeta;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  for (const dir of ['audio', 'meta', 'texts', 'segments', 'tmp']) await ensureDir(path.join(args.root, dir));
  if (!args.completedManifest) args.completedManifest = await latestManifest(args.outputRoot);
  if (args.completedManifest) {
    await fs.access(args.completedManifest);
  }

  const rows = await loadMetadataRows(args.metadataJson);
  const done = await completedObjectIds(args.completedManifest);
  const localAudio = await localAudioObjectIds(args.root);
  const failureCounts = await localFailureCounts(args.root);
  const pending = rows.filter((row) =>
    row.is_video !== false &&
    row.object_id &&
    row.object_nonce_id &&
    !done.has(String(row.object_id)) &&
    !localAudio.has(String(row.object_id))
  );
  if (args.order === 'shortest') {
    pending.sort((a, b) =>
      (failureCounts.get(String(a.object_id)) || 0) - (failureCounts.get(String(b.object_id)) || 0) ||
      Number(a.duration_seconds || Number.MAX_SAFE_INTEGER) - Number(b.duration_seconds || Number.MAX_SAFE_INTEGER) ||
      Number(a.file_size || Number.MAX_SAFE_INTEGER) - Number(b.file_size || Number.MAX_SAFE_INTEGER)
    );
  }
  const selected = pending.slice(args.startIndex, args.startIndex + args.limit);
  const startSeq = await maxExistingSeq(args.root);
  const maxConcurrency = Math.max(1, Math.floor(Number(args.maxConcurrency || 8)));
  const concurrency = Math.max(1, Math.min(maxConcurrency, Math.floor(Number(args.concurrency || 1))));
  args.effectiveConcurrency = concurrency;
  let nextIndex = 0;
  const results = [];
  const failures = [];

  async function worker() {
    while (nextIndex < selected.length) {
      const index = nextIndex;
      nextIndex += 1;
      const row = selected[index];
      const seq = startSeq + index + 1;
      try {
        console.log(`[${index + 1}/${selected.length}] direct ${seq} ${row.title}`);
        const result = await processOne(row, seq, args);
        results.push({ seq, object_id: row.object_id, title: row.title, audio: result.audio, segments: result.segment_count });
      } catch (error) {
        failures.push({ seq, object_id: row.object_id, title: row.title, error: error.message });
        await appendLog(args.root, {
          event: 'direct_failed',
          seq,
          title: row.title,
          object_id: row.object_id,
          error: error.message,
          requested_concurrency: args.concurrency,
          effective_concurrency: args.effectiveConcurrency || args.concurrency,
        });
        console.error(`[failed] ${row.title}: ${error.message}`);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, selected.length) }, () => worker()));
  results.sort((a, b) => a.seq - b.seq);
  failures.sort((a, b) => a.seq - b.seq);

  const summary = {
    ok: failures.length === 0,
    root: args.root,
    completed_manifest: args.completedManifest,
    completed_manifest_count: done.size,
    local_audio_count: localAudio.size,
    failed_pending_count: pending.filter((row) => (failureCounts.get(String(row.object_id)) || 0) > 0).length,
    pending_total: pending.length,
    selected_count: selected.length,
    requested_concurrency: args.concurrency,
    max_concurrency: maxConcurrency,
    concurrency,
    completed_count: results.length,
    failed_count: failures.length,
    results,
    failures,
  };
  console.log(JSON.stringify(summary, null, 2));
  process.exitCode = failures.length ? 1 : 0;
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
