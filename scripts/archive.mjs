import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${command} exited ${code}: ${stderr || stdout}`));
    });
  });
}

function psSingle(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

async function existingArchiveItems(items) {
  const existing = [];
  for (const item of items) {
    try {
      await fs.access(item);
      existing.push(item);
    } catch {}
  }
  return existing;
}

export async function archivePaths({ cwd, zipPath, paths }) {
  const existing = await existingArchiveItems(paths);
  if (!existing.length) throw new Error(`Nothing to package from ${cwd}`);
  await fs.mkdir(path.dirname(zipPath), { recursive: true });
  await fs.rm(zipPath, { force: true }).catch(() => {});

  if (process.platform === 'win32') {
    const command = [
      '$ErrorActionPreference = "Stop"',
      `$paths = @(${existing.map(psSingle).join(',')})`,
      `Compress-Archive -LiteralPath $paths -DestinationPath ${psSingle(zipPath)} -Force`,
    ].join('; ');
    await run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command]);
    return { zipPath, entries: existing };
  }

  const relative = existing.map((item) => path.relative(cwd, item));
  await run('zip', ['-r', '-q', zipPath, ...relative], { cwd });
  return { zipPath, entries: relative };
}
