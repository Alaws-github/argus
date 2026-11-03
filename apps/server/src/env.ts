// Loads ../../.env if it exists. Imported first so the values are set before
// anything reads them. process.loadEnvFile needs Node 20.12 or later.
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const file = resolve(dirname(fileURLToPath(import.meta.url)), '../../../.env');
if (existsSync(file)) process.loadEnvFile(file);
