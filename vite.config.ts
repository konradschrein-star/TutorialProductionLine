/// <reference types="vitest" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 3000,
    proxy: {
      '/api/google-suggest': {
        target: 'http://suggestqueries.google.com/complete/search',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/google-suggest/, ''),
      },
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      }
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
    },
  },
})
