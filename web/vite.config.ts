import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

export default defineConfig({
  plugins: [react()],
  // share-vectors.json lives in contracts/, outside the Vite root.
  server: { fs: { allow: [repoRoot] } },
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    rollupOptions: { input: { main: 'index.html', browserTests: 'browser-tests/index.html', e2e: 'browser-tests/e2e.html' } },
  },
});
