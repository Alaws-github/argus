// Dev server settings: the web app runs on port 5173 and forwards /api and
// live updates to the server on port 4300.
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

// The version shown under Sign Out: the root package.json version (the single
// place it is set, by npm run release) and the git commit it was built from.
const version = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version as string;
let commit = '';
try { commit = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { /* not a git checkout */ }

const API = process.env.API_URL || 'http://localhost:4300';

export default defineConfig({
  plugins: [vue()],
  define: { __ARGUS_VERSION__: JSON.stringify(version), __ARGUS_COMMIT__: JSON.stringify(commit) },
  server: {
    port: 5173,
    proxy: {
      '/api': API,
      '/socket.io': { target: API, ws: true },
    },
  },
});
