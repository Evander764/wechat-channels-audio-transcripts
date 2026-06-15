import fs from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

import {
  PROJECT_ROOT,
  accountsConfigured,
  buildEnv,
  configPathFromArg,
  loadConfig,
} from './config.mjs';

function commandExists(command) {
  const result = spawnSync('where.exe', [command], { encoding: 'utf8' });
  return result.status === 0;
}

function commandVersion(command, args = ['--version']) {
  const result = spawnSync(command, args, { cwd: PROJECT_ROOT, encoding: 'utf8', timeout: 8000 });
  return {
    ok: result.status === 0,
    version: (result.stdout || result.stderr || '').split(/\r?\n/)[0].trim(),
  };
}

function pythonImport(command, moduleName) {
  const result = spawnSync(command, [
    '-c',
    `import ${moduleName}; print(getattr(${moduleName}, "__version__", "installed"))`,
  ], { cwd: PROJECT_ROOT, encoding: 'utf8', timeout: 10000 });
  return {
    ok: result.status === 0,
    version: (result.stdout || '').trim(),
    error: result.status === 0 ? '' : (result.stderr || result.stdout || '').trim().split(/\r?\n/).slice(-1)[0],
  };
}

async function fileExists(file) {
  if (!file) return false;
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

async function checkWxChannel(baseUrl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3000);
  try {
    const response = await fetch(baseUrl, { signal: controller.signal });
    return { ok: true, status: response.status };
  } catch (error) {
    return { ok: false, error: error.message };
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const configPath = configPathFromArg();
  let config;
  try {
    config = await loadConfig(configPath);
  } catch (error) {
    console.error(`Config not ready: ${configPath}`);
    console.error('Run: npm run setup');
    process.exitCode = 1;
    return;
  }

  const env = buildEnv(config);
  const checks = {
    node: commandVersion('node'),
    ffmpeg: commandVersion('ffmpeg', ['-version']),
    ffprobe: commandVersion('ffprobe', ['-version']),
    curl: commandVersion('curl.exe', ['--version']),
    python: commandVersion(config.transcription.python, ['--version']),
    faster_whisper: pythonImport(config.transcription.python, 'faster_whisper'),
    ctranslate2: pythonImport(config.transcription.python, 'ctranslate2'),
    git: commandExists('git.exe'),
    wx_channel: await checkWxChannel(config.wxChannelBaseUrl),
    accounts_configured: accountsConfigured(config).length,
    metadata_json_exists: await fileExists(config.metadataJson),
    outputRoot: config.outputRoot,
    workRoot: config.workRoot,
    cudaDllDirs: env.WECHAT_CUDA_DLL_DIRS || '',
  };

  const hardFailures = [];
  for (const name of ['node', 'ffmpeg', 'ffprobe', 'curl', 'python', 'faster_whisper', 'ctranslate2']) {
    if (!checks[name].ok) hardFailures.push(name);
  }
  if (!checks.wx_channel.ok) hardFailures.push('wx_channel');
  if (!checks.accounts_configured) hardFailures.push('accounts');

  console.log(JSON.stringify({
    ok: hardFailures.length === 0,
    hardFailures,
    checks,
    notes: [
      'wx_channel only needs to be reachable when capturing or resolving media.',
      'metadata_json_exists is false before the first successful capture.',
    ],
  }, null, 2));

  if (hardFailures.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
