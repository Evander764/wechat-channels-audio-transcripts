import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DEFAULT_CONFIG = path.join(PROJECT_ROOT, 'wechat.config.json');
export const EXAMPLE_CONFIG = path.join(PROJECT_ROOT, 'config.example.json');

export function expandPath(value, base = PROJECT_ROOT) {
  if (!value) return '';
  let text = String(value);
  text = text.replace(/^~(?=$|[\\/])/, os.homedir());
  text = text.replace(/%USERPROFILE%/gi, process.env.USERPROFILE || os.homedir());
  text = text.replace(/%LOCALAPPDATA%/gi, process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'));
  if (/^[a-zA-Z]:[\\/]/.test(text) || text.startsWith('\\\\')) return path.resolve(text);
  return path.resolve(base, text);
}

export function resolveCommandOrPath(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  if (text.includes('\\') || text.includes('/') || text.startsWith('.') || text.startsWith('~') || /^[a-zA-Z]:/.test(text)) {
    return expandPath(text);
  }
  return text;
}

export function configPathFromArg(argv = process.argv.slice(2)) {
  const index = argv.indexOf('--config');
  return index >= 0 && argv[index + 1] ? expandPath(argv[index + 1]) : DEFAULT_CONFIG;
}

export async function readJson(file) {
  return JSON.parse((await fs.readFile(file, 'utf8')).replace(/^\uFEFF/, ''));
}

export async function writeJson(file, payload) {
  await fs.writeFile(file, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

export async function loadConfig(configPath = DEFAULT_CONFIG) {
  const config = await readJson(configPath);
  return normalizeConfig(config, configPath);
}

export function normalizeConfig(config, configPath = DEFAULT_CONFIG) {
  const outputRoot = expandPath(config.outputRoot || path.join(os.homedir(), 'Videos', 'WeChat Channels Downloads'));
  const workRoot = expandPath(config.workRoot || path.join(outputRoot, 'audio_transcripts_dynamic'));
  const transcription = config.transcription || {};
  const download = config.download || {};
  return {
    ...config,
    configPath,
    wxChannelBaseUrl: config.wxChannelBaseUrl || 'http://127.0.0.1:2025',
    outputRoot,
    workRoot,
    metadataJson: expandPath(config.metadataJson || ''),
    maxPages: Number(config.maxPages || 300),
    accounts: Array.isArray(config.accounts) ? config.accounts : [],
    download: {
      concurrency: Number(download.concurrency || 8),
      maxConcurrency: Number(download.maxConcurrency || download.concurrency || 8),
      batchLimit: Number(download.batchLimit || 120),
      maxBatches: Number(download.maxBatches || 999),
      order: download.order || 'shortest',
      timeoutMs: Number(download.timeoutMs || 240000),
      stopAfterNoProgress: Number(download.stopAfterNoProgress || 4),
    },
    transcription: {
      python: resolveCommandOrPath(transcription.python || 'python'),
      model: transcription.model || 'small',
      language: transcription.language || 'zh',
      device: transcription.device || 'cuda',
      computeType: transcription.computeType || 'float16',
      transcribeLimit: Number(transcription.transcribeLimit || 120),
      allowCpuFallback: transcription.allowCpuFallback !== false,
      cudaDllDirs: Array.isArray(transcription.cudaDllDirs) ? transcription.cudaDllDirs : [],
    },
  };
}

export async function saveConfig(configPath, config) {
  const clean = { ...config };
  delete clean.configPath;
  await writeJson(configPath, clean);
}

export async function ensureRuntimeDirs(config) {
  await fs.mkdir(config.outputRoot, { recursive: true });
  for (const name of ['audio', 'meta', 'segments', 'texts', 'tmp']) {
    await fs.mkdir(path.join(config.workRoot, name), { recursive: true });
  }
  await fs.mkdir(path.join(PROJECT_ROOT, '.runtime'), { recursive: true });
  await fs.mkdir(path.join(PROJECT_ROOT, 'run_logs'), { recursive: true });
}

export function buildEnv(config) {
  const cudaDllDirs = (config.transcription.cudaDllDirs || []).map((item) => expandPath(item));
  return {
    ...process.env,
    WX_CHANNEL_BASE_URL: config.wxChannelBaseUrl,
    WECHAT_CHANNELS_OUTPUT_ROOT: config.outputRoot,
    WECHAT_CHANNELS_WORK_ROOT: config.workRoot,
    WECHAT_CHANNELS_METADATA_JSON: config.metadataJson || '',
    WECHAT_TRANSCRIBE_PYTHON: config.transcription.python,
    WECHAT_TRANSCRIBE_SCRIPT: path.join(PROJECT_ROOT, 'windows', 'transcribe_audio.py'),
    WECHAT_TRANSCRIBE_BATCH_SCRIPT: path.join(PROJECT_ROOT, 'windows', 'transcribe_wechat_audio_batch.py'),
    WECHAT_CUDA_DLL_DIRS: cudaDllDirs.join(path.delimiter),
  };
}

export function accountsConfigured(config) {
  return config.accounts.filter((account) => account && account.username && !String(account.username).startsWith('v2_xxx'));
}
