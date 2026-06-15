import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('mac direct workflow exposes a one-shot download and transcribe command', () => {
  const packageJson = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const script = fs.readFileSync(new URL('../scripts/mac-direct.mjs', import.meta.url), 'utf8');

  assert.equal(packageJson.scripts['mac:download-transcribe'], 'node scripts/mac-direct.mjs download-transcribe');
  assert.match(script, /download-transcribe/);
  assert.match(script, /transcribe_audio\.py/);
  assert.match(script, /output_md/);
});
