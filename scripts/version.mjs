// Going back to an earlier version of ARGUS, and returning to the latest.
// Each release is a git tag (v0.3 ... v1.2). This wraps the git commands so
// your data is backed up first and nothing you haven't committed is lost.
//
//   npm run versions                 list the versions and show which one you're on
//   npm run versions -- use v1.1     switch the code to v1.1 (your data folder is copied first)
//   npm run versions -- latest       back to the newest version (the main branch)
//
// Stop the app before switching. After switching, run npm install (older
// versions may use different packages), then start the app. An older version
// may not understand a database a newer one created: if it fails to start,
// restore the backup it made or reset the database (npm run db:reset).
import { execSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync } from 'node:fs';

const git = (c) => execSync(`git ${c}`, { encoding: 'utf8' }).trim();
const [cmd, tag] = process.argv.slice(2);
try {
  git('rev-parse --is-inside-work-tree');
} catch {
  console.error('This folder is not a git repository yet. See docs/runbooks/versions-and-github.md.');
  process.exit(1);
}

const tags = git('tag -l "v*" --sort=-v:refname').split('\n').filter(Boolean);
const here = (() => {
  try {
    return git('describe --tags --exact-match');
  } catch {
    return null;
  }
})();
const branch = (() => {
  try {
    return git('symbolic-ref --short HEAD');
  } catch {
    return null;
  }
})();

if (!cmd) {
  console.log(`You are on ${branch ? `the ${branch} branch` : 'a detached copy'}${here ? ` (${here})` : ''}.\n`);
  for (const t of tags)
    console.log(`${t === here ? '*' : ' '} ${t.padEnd(8)} ${git(`tag -l ${t} --format="%(contents:subject)"`)}`);
  console.log('\nnpm run versions -- use <version>   or   npm run versions -- latest');
  process.exit(0);
}
if (git('status --porcelain')) {
  console.error(
    'You have changes that are not committed. Commit them (or stash them) first, so switching versions cannot overwrite them.',
  );
  process.exit(1);
}
if (existsSync('data')) {
  const to = `data-backups/data-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  mkdirSync('data-backups', { recursive: true });
  cpSync('data', to, { recursive: true });
  console.log(`Backed up the data folder to ${to}`);
}
if (cmd === 'use' && tag) {
  if (!tags.includes(tag)) {
    console.error(`No version called ${tag}. Run npm run versions to see the list.`);
    process.exit(1);
  }
  git(`switch --detach ${tag}`);
  console.log(`Switched to ${tag}. Now run npm install, then start the app. To come back: npm run versions -- latest`);
} else if (cmd === 'latest') {
  git('switch main');
  console.log('Back on the latest version (main). Run npm install, then start the app.');
} else {
  console.error('Use: npm run versions, npm run versions -- use v1.1, or npm run versions -- latest');
  process.exit(1);
}
