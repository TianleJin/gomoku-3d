import { defineConfig } from 'vite';

export default defineConfig({
  // Relative base so the built site works from any static host or sub-path.
  base: './',
  worker: { format: 'es' },
  // three.js plus its glTF and HDR loaders is ~1 MB minified; one chunk is fine for a single-page game.
  build: { chunkSizeWarningLimit: 1100 },
});
