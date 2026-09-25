import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

/**
 * base '/photos/': the app is public at https://<node>:10000/photos/ (Funnel
 * strips the prefix before it reaches the server; the server accepts both).
 *
 * Dev: `FAELLES_API=http://127.0.0.1:8498 npm run dev -- --port 5181`
 * proxies /photos/api/* to package A's dev backend (which accepts the prefix).
 */
const api = process.env.FAELLES_API ?? 'http://127.0.0.1:8498';

export default defineConfig({
  base: '/photos/',
  // separate caches so packages B and C can run dev servers side by side
  cacheDir: process.env.VITE_CACHE_DIR ?? 'node_modules/.vite',
  plugins: [react()],
  resolve: {
    alias: {
      '@shared': fileURLToPath(new URL('../shared', import.meta.url)),
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    host: '127.0.0.1',
    fs: { allow: ['..'] },
    proxy: {
      '/photos/api': { target: api, changeOrigin: false, ws: false },
    },
  },
  preview: { host: '127.0.0.1' },
  build: {
    target: 'es2022',
    sourcemap: true,
    chunkSizeWarningLimit: 1200,
    // never base64-inline font subsets into the CSS (keeps the critical CSS small)
    assetsInlineLimit: (file: string) => (/\.(woff2?)$/.test(file) ? false : undefined),
  },
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    environment: 'node',
  },
});
