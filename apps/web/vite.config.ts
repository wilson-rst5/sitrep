import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    proxy: { '/api': process.env.SITREP_DEV_PROXY ?? 'http://localhost:8080' },
  },
});
