import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_CONFIG,
  EXAMPLE_CONFIG,
  buildEnv,
  ensureRuntimeDirs,
  loadConfig,
  normalizeConfig,
  readJson,
} from './config.mjs';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MACOS_ROOT = path.join(PROJECT_ROOT, 'macos');
const HELPER = path.join(MACOS_ROOT, '.build', 'release', 'wcd-helper');

const MEDIA_PRIORITY = {
  hls: 0,
  video: 1,
  live: 2,
  candidate: 3,
  fragment: 9,
};

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd || PROJECT_ROOT,
      env: options.env ? { ...process.env, ...options.env } : process.env,
      stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    if (options.capture) {
      child.stdout.on('data', (chunk) => { stdout += chunk; });
      child.stderr.on('data', (chunk) => { stderr += chunk; });
    }
    child.on('error', reject);
    child.on('close', (code) => {
      const result = { code, stdout, stderr };
      if (code === 0 || options.allowFailure) resolve(result);
      else reject(new Error(`${command} exited ${code}: ${stderr || stdout}`));
    });
  });
}

function parseArgs(argv) {
  const out = { command: 'help', flags: new Map(), positional: [] };
  const [command, ...rest] = argv;
  out.command = command || 'help';
  for (let i = 0; i < rest.length; i += 1) {
    const item = rest[i];
    if (!item.startsWith('--')) {
      out.positional.push(item);
      continue;
    }
    const next = rest[i + 1];
    if (next && !next.startsWith('--')) {
      out.flags.set(item, next);
      i += 1;
    } else {
      out.flags.set(item, true);
    }
  }
  return out;
}

function flag(cli, name, fallback = '') {
  return cli.flags.has(name) ? cli.flags.get(name) : fallback;
}

async function exists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

async function ensureHelper() {
  if (process.platform !== 'darwin') {
    throw new Error('The mac direct downloader only runs on macOS.');
  }
  if (await exists(HELPER)) return;
  await run('swift', ['build', '-c', 'release'], { cwd: MACOS_ROOT });
}

function parseJsonOutput(result) {
  const text = result.stdout.trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    const start = text.lastIndexOf('\n{');
    if (start >= 0) return JSON.parse(text.slice(start + 1));
    throw new Error(`Helper returned non-JSON output: ${text.slice(0, 500)}`);
  }
}

async function helper(args, options = {}) {
  await ensureHelper();
  const result = await run(HELPER, args, {
    cwd: MACOS_ROOT,
    capture: true,
    allowFailure: options.allowFailure,
  });
  const payload = parseJsonOutput(result) || { ok: result.code === 0 };
  if (options.print !== false) console.log(JSON.stringify(payload, null, 2));
  if (result.code !== 0 && !options.allowFailure) {
    throw new Error(payload.message || `wcd-helper exited ${result.code}`);
  }
  return payload;
}

async function setup() {
  await ensureHelper();
  const bootstrap = await helper(['bootstrap', '--json'], { allowFailure: false, print: false });
  const doctor = await helper(['doctor', '--json'], { allowFailure: true, print: false });
  console.log(JSON.stringify({
    ok: Boolean(bootstrap.ok),
    message: 'mac helper built; mitmproxy bootstrap complete',
    data: {
      helper: HELPER,
      bootstrap,
      doctor,
      next: [
        'Run npm run mac:cert:install once if the mitmproxy certificate is not trusted yet.',
        'Run npm run mac:listen, play the target WeChat Channels video, then run npm run mac:download-latest.',
      ],
    },
  }, null, 2));
}

async function captures(print = true) {
  const payload = await helper(['captures', 'tail', '--json'], { allowFailure: false, print: false });
  const rows = payload.data?.captures || [];
  rows.sort(compareCaptures);
  const output = { ...payload, data: { ...payload.data, captures: rows } };
  if (print) console.log(JSON.stringify(output, null, 2));
  return rows;
}

function compareCaptures(a, b) {
  const pa = MEDIA_PRIORITY[a.media_type] ?? 5;
  const pb = MEDIA_PRIORITY[b.media_type] ?? 5;
  return pa - pb || Number(b.captured_at || 0) - Number(a.captured_at || 0);
}

function normalize(value) {
  return String(value || '').toLowerCase().replace(/\s+/g, '');
}

function captureText(record) {
  return [record.title, record.source, record.media_type, record.url]
    .map((item) => String(item || ''))
    .join('\n');
}

function pickCapture(rows, { captureId, match, latest }) {
  if (captureId) {
    const found = rows.find((row) => row.id === captureId);
    if (!found) throw new Error(`No capture found for id ${captureId}`);
    return found;
  }
  const downloadable = rows
    .filter((row) => row.status !== 'http_error')
    .filter((row) => (MEDIA_PRIORITY[row.media_type] ?? 9) < 9)
    .sort(compareCaptures);
  if (match) {
    const needle = normalize(match);
    const found = downloadable.find((row) => normalize(captureText(row)).includes(needle));
    if (!found) throw new Error(`No captured media matched: ${match}`);
    return found;
  }
  if ((latest || downloadable.length) && downloadable[0]) return downloadable[0];
  throw new Error('No downloadable capture found. Start listening, then play the target video in WeChat Channels.');
}

async function downloadSelected(cli) {
  return downloadSelectedCapture(cli, { print: true });
}

async function downloadSelectedCapture(cli, { print }) {
  const rows = await captures(false);
  const selected = pickCapture(rows, {
    captureId: flag(cli, '--capture-id'),
    match: flag(cli, '--match'),
    latest: true,
  });
  const payload = await helper(['download', '--capture-id', selected.id, '--json'], { print: false });
  const output = {
    ...payload,
    selected_capture: {
      id: selected.id,
      title: selected.title,
      media_type: selected.media_type,
      source: selected.source,
      captured_at: selected.captured_at,
    },
  };
  if (print) console.log(JSON.stringify(output, null, 2));
  return output;
}

async function loadDirectConfig() {
  let config;
  try {
    config = await loadConfig(DEFAULT_CONFIG);
  } catch {
    config = normalizeConfig(await readJson(EXAMPLE_CONFIG), EXAMPLE_CONFIG);
  }
  await ensureRuntimeDirs(config);
  return config;
}

function safeStem(value) {
  return String(value || 'wechat-capture')
    .replace(/[\/\\?%*|"<>:\n\r\t]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 96) || 'wechat-capture';
}

async function transcribeDownloadedAudio(downloadPayload, cli) {
  const config = await loadDirectConfig();
  const audio = downloadPayload.data?.output;
  if (!audio) throw new Error('Downloaded payload did not include data.output');
  await fs.access(audio);

  const selected = downloadPayload.selected_capture || {};
  const title = selected.title || path.basename(audio, path.extname(audio));
  const stem = safeStem(`${title}-${selected.id || 'capture'}`);
  const metaPath = path.join(config.workRoot, 'meta', `${stem}.meta.json`);
  const outputMd = path.resolve(String(flag(cli, '--output-md', path.join(config.workRoot, 'texts', `${stem}.md`))));
  const outputJson = path.resolve(String(flag(cli, '--output-json', path.join(config.workRoot, 'segments', `${stem}.json`))));
  const python = String(flag(cli, '--python', config.transcription.python));
  const model = String(flag(cli, '--model', config.transcription.model));
  const language = String(flag(cli, '--language', config.transcription.language));
  const device = String(flag(cli, '--device', config.transcription.device));
  const computeType = String(flag(cli, '--compute-type', config.transcription.computeType));

  await fs.mkdir(path.dirname(metaPath), { recursive: true });
  await fs.mkdir(path.dirname(outputMd), { recursive: true });
  await fs.mkdir(path.dirname(outputJson), { recursive: true });
  const meta = {
    title,
    index: selected.id || '',
    capture_id: selected.id || '',
    media_type: selected.media_type || '',
    source: selected.source || '',
    source_url: downloadPayload.data?.url || '',
    audio,
    transcript_source: 'wechat_channels_direct_capture',
  };
  await fs.writeFile(metaPath, `${JSON.stringify(meta, null, 2)}\n`, 'utf8');

  const args = [
    path.join(PROJECT_ROOT, 'pipeline', 'transcribe_audio.py'),
    '--audio', audio,
    '--output-md', outputMd,
    '--output-json', outputJson,
    '--meta-json', metaPath,
    '--model', model,
    '--language', language,
    '--device', device,
    '--compute-type', computeType,
  ];
  if (flag(cli, '--vad-filter', false) === true) args.push('--vad-filter');

  const result = await run(python, args, { capture: true, env: buildEnv(config) });
  const summary = parseJsonOutput(result) || {};
  return {
    ok: result.code === 0,
    audio,
    output_md: outputMd,
    output_json: outputJson,
    meta_json: metaPath,
    model,
    language,
    device,
    compute_type: computeType,
    summary,
  };
}

async function downloadAndTranscribe(cli) {
  const downloaded = await downloadSelectedCapture(cli, { print: false });
  const transcript = await transcribeDownloadedAudio(downloaded, cli);
  console.log(JSON.stringify({
    ...downloaded,
    transcript,
  }, null, 2));
}

async function listen() {
  await helper(['captures', 'clear', '--json'], { allowFailure: false, print: false });
  await helper(['proxy', 'start', '--json'], { allowFailure: false, print: true });
}

async function stop() {
  await helper(['proxy', 'stop', '--json'], { allowFailure: false, print: true });
}

async function status() {
  await helper(['proxy', 'status', '--json'], { allowFailure: false, print: true });
}

async function recordCurrent(cli) {
  const seconds = String(flag(cli, '--duration-seconds', '30'));
  await helper(['record-current', '--duration-seconds', seconds, '--json'], { allowFailure: false, print: true });
}

function usage() {
  console.log(`Usage:
  npm run mac:setup
  npm run mac:doctor
  npm run mac:cert:install
  npm run mac:listen
  npm run mac:captures
  npm run mac:download-latest -- --match "title keyword"
  npm run mac:download-latest -- --capture-id CAPTURE_ID
  npm run mac:download-transcribe -- --match "title keyword"
  npm run mac:download-transcribe -- --capture-id CAPTURE_ID --model small
  npm run mac:record-current -- --duration-seconds 30
  npm run mac:stop`);
}

async function main() {
  const cli = parseArgs(process.argv.slice(2));
  if (cli.command === 'setup') await setup();
  else if (cli.command === 'doctor') await helper(['doctor', '--json'], { allowFailure: true, print: true });
  else if (cli.command === 'cert-install') await helper(['cert', 'install', '--json'], { allowFailure: false, print: true });
  else if (cli.command === 'listen') await listen();
  else if (cli.command === 'stop') await stop();
  else if (cli.command === 'status') await status();
  else if (cli.command === 'captures') await captures(true);
  else if (cli.command === 'download-latest' || cli.command === 'download') await downloadSelected(cli);
  else if (cli.command === 'download-transcribe') await downloadAndTranscribe(cli);
  else if (cli.command === 'record-current') await recordCurrent(cli);
  else usage();
}

main().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    message: error.message || String(error),
  }, null, 2));
  process.exitCode = 1;
});
