import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        store: resolve(import.meta.dirname, 'index.html'),
        agent: resolve(import.meta.dirname, 'agent.html'),
      },
    },
  },
});
