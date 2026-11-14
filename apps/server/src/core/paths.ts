// Where the server finds files outside its own code: the repository root (for .env), the data
// folder (database, evidence, secret key) and the agents' rules files. Kept in one place so a
// file can move between feature folders without its paths breaking.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** apps/server/src */
export const SERVER_SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The repository root, where .env lives. */
export const REPO_ROOT = resolve(SERVER_SRC, '../../..');

/** The data folder: database, evidence files and secret.key (gitignored; back up together). */
export const DATA_DIR = resolve(REPO_ROOT, 'data');

/** The agents' rules files (rule 8 in CLAUDE.md). */
export const PROMPTS_DIR = resolve(SERVER_SRC, 'agents/prompts');

/** Reads one rules file from agents/prompts. */
export const readPrompt = (file: string) => readFileSync(resolve(PROMPTS_DIR, file), 'utf8');
