// Loads ../../.env if it exists. Imported first so the values are set before
// anything reads them. process.loadEnvFile needs Node 20.12 or later.
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { REPO_ROOT } from './paths.js';

const file = resolve(REPO_ROOT, '.env');
if (existsSync(file)) process.loadEnvFile(file);
