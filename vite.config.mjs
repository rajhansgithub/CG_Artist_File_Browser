import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import fs from 'fs';

const pkg = JSON.parse(fs.readFileSync('./package.json', 'utf8'));

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(`v${pkg.version}`)
  },
  base: './', // crucial for Electron loading file://
  server: {
    port: 5173,
    strictPort: true
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    assetsDir: 'assets',
    chunkSizeWarningLimit: 3000,
    // The app runs in WebView2 (Chromium) on Windows. Without this the CSS minifier keeps only -webkit-backdrop-filter,
    // which Chromium ignores, so every frosted-glass blur was lost in the built app
    cssTarget: 'chrome120'
  },
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src')
    }
  }
});
