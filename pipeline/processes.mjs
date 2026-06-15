import { execFile } from 'node:child_process';

function execText(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(command, args, {
      windowsHide: true,
      maxBuffer: options.maxBuffer || 2 * 1024 * 1024,
    }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`${error.message}\n${stderr || ''}`.trim()));
        return;
      }
      resolve(stdout);
    });
  });
}

async function psJson(command) {
  const stdout = await execText('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command]);
  const text = stdout.trim();
  return text ? JSON.parse(text) : null;
}

export async function activeCommandLineCount(patterns) {
  if (process.platform === 'win32') {
    const escaped = patterns.map((pattern) => String(pattern).replace(/'/g, "''"));
    const checks = escaped.map((pattern) => "$_.CommandLine -like '*" + pattern + "*'").join(' -and ');
    const command = `
$items = Get-CimInstance Win32_Process | Where-Object {
  $_.CommandLine -and (${checks})
}
@($items).Count | ConvertTo-Json
`;
    const count = await psJson(command);
    return Number(count || 0);
  }

  const stdout = await execText('ps', ['-axo', 'pid=,command=']);
  const ignoredPids = new Set([process.pid, process.ppid].filter(Boolean));
  return stdout
    .split(/\r?\n/)
    .map((line) => {
      const match = line.match(/^\s*(\d+)\s+(.+)$/);
      return match ? { pid: Number(match[1]), command: match[2] } : null;
    })
    .filter(Boolean)
    .filter((item) => !ignoredPids.has(item.pid))
    .filter((item) => patterns.every((pattern) => item.command.includes(pattern)))
    .length;
}
