import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { policyStatus } from '../scripts/device-policy.mjs';

test('historical Mac implementation remains present as evidence', () => {
  const packageJson = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const script = fs.readFileSync(new URL('../scripts/mac-direct.mjs', import.meta.url), 'utf8');

  assert.equal(packageJson.scripts['mac:download-transcribe'], 'node scripts/mac-direct.mjs download-transcribe');
  assert.match(script, /download-transcribe/);
  assert.match(script, /transcribe_audio\.py/);
  assert.match(script, /output_md/);
});

test('device policy requires Windows 5080 and successful GitHub preflight', () => {
  assert.equal(policyStatus({}, 'darwin').allowed, false);
  assert.equal(policyStatus({ INFORMATION_INTAKE_DEVICE_ID: 'win-desktop-5080' }, 'win32').allowed, false);
  assert.equal(policyStatus({
    INFORMATION_INTAKE_DEVICE_ID: 'win-desktop-5080',
    INFORMATION_INTAKE_GITHUB_PREFLIGHT: 'PASS',
  }, 'win32').allowed, true);
});

test('Mac real-content entrypoint fails before helper or WeChat access', { skip: process.platform !== 'darwin' }, () => {
  const script = fileURLToPath(new URL('../scripts/mac-direct.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [script, 'record-current'], { encoding: 'utf8' });
  assert.equal(result.status, 3);
  assert.match(result.stdout, /wechat_windows_5080_only/);
  assert.match(result.stdout, /information-intake/);
});
