// Dev server settings: the web app runs on port 5173 and forwards /api and
// live updates to the server on port 4300.
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

const API = process.env.API_URL || 'http://localhost:4300';

export default defineConfig({
  plugins: [vue()],
  server: {
    port: 5173,
    proxy: {
      '/api': API,
      '/socket.io': { target: API, ws: true },
    },
  },
});
