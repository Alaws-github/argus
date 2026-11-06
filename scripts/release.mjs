// Starts a release: sets the version (root package.json, the one place the app
// reads it from, shown under Sign Out), adds a section to CHANGELOG.md listing
// the commits since the last tag, and prints the git steps to finish.
//
//   npm run release -- 1.5.0
//
// Run it on the release branch (release/v1.5) once the work is in. Edit the
// new CHANGELOG section into plain words, commit, merge to main, then tag.
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const version = (process.argv[2] ?? '').replace(/^v/, '');
if (!/^\d+\.\d+\.\d+$/.test(version)) {
  console.error('Give the new version as three numbers, for example: npm run release -- 1.5.0');
  process.exit(1);
}
const git = (c) => { try { return execSync(`git ${c}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return ''; } };

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const before = pkg.version;
pkg.version = version;
writeFileSync('package.json', `${JSON.stringify(pkg, null, 2)}\n`);

const last = git('describe --tags --abbrev=0');
const commits = git(`log --no-merges --format=%s ${last ? `${last}..HEAD` : ''}`).split('\n').filter(Boolean);
const day = new Date().toISOString().slice(0, 10);
const section = `## v${version} (${day})\n\n${commits.length ? commits.map((c) => `- ${c}`).join('\n') : '- (describe the changes)'}\n`;
const file = 'CHANGELOG.md';
const head = '# Changelog\n\nWhat changed in each release of ARGUS, newest first. The version shown under Sign Out comes from package.json.\n';
const current = existsSync(file) ? readFileSync(file, 'utf8') : head;
if (current.includes(`## v${version} `)) {
  console.log(`CHANGELOG.md already has v${version}; left it as it is.`);
} else {
  const at = current.indexOf('\n## ');
  writeFileSync(file, at < 0 ? `${current.trimEnd()}\n\n${section}` : `${current.slice(0, at + 1)}${section}\n${current.slice(at + 1)}`);
}

console.log(`Version ${before} -> ${version}. CHANGELOG.md has a v${version} section${last ? ` (commits since ${last})` : ''}: put it into plain words.

Then:
  git add -A
  git commit -m "v${version}"
  git push
  (merge the release branch into main on GitHub)
  git switch main && git pull
  git tag -a v${version} -m "v${version}"
  git push origin v${version}
  cd deploy/cloudflare && npm run deploy   (from the tag, to update the live site)`);
