import fs from 'node:fs/promises';

import {
  DEFAULT_CONFIG,
  EXAMPLE_CONFIG,
  configPathFromArg,
  ensureRuntimeDirs,
  loadConfig,
} from './config.mjs';

async function exists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const configPath = configPathFromArg();
  if (!(await exists(configPath))) {
    await fs.copyFile(EXAMPLE_CONFIG, configPath);
    console.log(`Created config: ${configPath}`);
    console.log('Edit accounts[].username before running capture/download.');
  } else {
    console.log(`Config already exists: ${configPath}`);
  }

  const config = await loadConfig(configPath);
  await ensureRuntimeDirs(config);
  console.log(JSON.stringify({
    ok: true,
    config: configPath || DEFAULT_CONFIG,
    outputRoot: config.outputRoot,
    workRoot: config.workRoot,
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
