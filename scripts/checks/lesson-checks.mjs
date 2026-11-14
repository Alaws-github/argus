// Code checks for lessons in docs/lessons/ that a pattern search can catch.
// Each check is named after the "Enforced by: check <name>" line that cites it.
// Run with npm run check:lessons. Add a check here when a lesson can be enforced.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(resolve(root, p), 'utf8');
const walk = (d) =>
  readdirSync(resolve(root, d)).flatMap((f) => {
    const p = join(d, f);
    return statSync(resolve(root, p)).isDirectory() ? walk(p) : [p];
  });
const fails = [];
const fail = (check, msg) => fails.push(`[${check}] ${msg}`);

// tool-schema-objects-have-properties: an object schema with no properties is
// rejected by some providers (lesson tool-schema-objects-need-properties).
for (const f of walk('apps/server/src').filter((p) => p.endsWith('.ts'))) {
  read(f)
    .split('\n')
    .forEach((l, i) => {
      if (/type:\s*'object'\s*\}/.test(l))
        fail('tool-schema-objects-have-properties', `${f}:${i + 1} an object schema with no properties`);
    });
}

// writes-go-through-storage: only storage.ts (evidence) and crypto.ts (the
// secret key) may write files (lesson files-go-through-storage-ts).
const ALLOWED = new Set(['apps/server/src/core/storage.ts', 'apps/server/src/core/crypto.ts']);
for (const f of walk('apps/server/src').filter((p) => p.endsWith('.ts'))) {
  const rel = relative(root, resolve(root, f)).replace(/\\/g, '/');
  if (ALLOWED.has(rel)) continue;
  read(f)
    .split('\n')
    .forEach((l, i) => {
      if (/\b(writeFileSync|writeFile|createWriteStream|appendFileSync)\s*\(/.test(l))
        fail('writes-go-through-storage', `${rel}:${i + 1} writes a file directly; use storage.ts`);
    });
}

// deploy-build-script: no --prefix with -w on Windows (lesson windows-npm-workspace-flags).
const deploy = JSON.parse(read('deploy/cloudflare/package.json'));
for (const [name, cmd] of Object.entries(deploy.scripts ?? {})) {
  if (/--prefix/.test(cmd) && /(^|\s)(-w|--workspace)\b/.test(cmd))
    fail('deploy-build-script', `deploy/cloudflare/package.json script "${name}" combines --prefix with -w`);
}

// dockerfile-node-env-after-install: NODE_ENV=production must come after npm ci
// (lesson dockerfile-node-env-after-install).
const docker = read('Dockerfile').split('\n');
const ci = docker.findIndex((l) => /^RUN .*npm (ci|install)/.test(l));
const env = docker.findIndex((l) => /^ENV .*NODE_ENV=production/.test(l));
if (ci >= 0 && env >= 0 && env < ci)
  fail(
    'dockerfile-node-env-after-install',
    `Dockerfile sets NODE_ENV=production (line ${env + 1}) before installing (line ${ci + 1})`,
  );

// vue-whitespace-preserve: Prettier may put a line break between two tags, and Vue's
// default 'condense' mode would then join the words (lesson prettier-and-vue-whitespace).
if (!/whitespace:\s*'preserve'/.test(read('apps/web/vite.config.ts')))
  fail('vue-whitespace-preserve', "apps/web/vite.config.ts must compile templates with whitespace: 'preserve'");

// no-copied-core-helpers: httpError, Wrap and toIso live once in core/ (lesson one-home-for-shared-helpers).
for (const f of walk('apps/server/src').filter((p) => p.endsWith('.ts') && !p.includes('/core/'))) {
  read(f)
    .split('\n')
    .forEach((l, i) => {
      if (/^(export )?(const (httpError|toIso|wrap)\b|type (Wrap|ActorOf)\b)/.test(l))
        fail('no-copied-core-helpers', `${f}:${i + 1} redefines a helper from core/; import it instead`);
    });
}

if (fails.length) {
  console.error(fails.join('\n'));
  process.exit(1);
}
console.log('Lesson checks OK.');
