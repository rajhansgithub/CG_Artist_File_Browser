// Builds docs/achievements-preview.html: one self-contained page that runs the app's real achievements code (core, observer,
// screen, pop-ups, full view, shaders) on sample states. It is published as the "CG Artist File Browser Achievements" artifact.
// Run: node docs/build-achievements-preview.mjs
import { build } from 'vite';
import fs from 'fs';
import os from 'os';
import path from 'path';

const root = path.resolve(import.meta.dirname, '..');
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'ach-preview-'));
await build({
  root,
  configFile: false,
  logLevel: 'warn',
  publicDir: false,
  define: { 'process.env.NODE_ENV': '"production"' },
  build: {
    outDir: out,
    emptyOutDir: true,
    cssTarget: 'chrome120',
    lib: { entry: path.join(root, 'docs/achievements-preview.entry.js'), formats: ['iife'], name: 'AchPreview', fileName: () => 'preview.js', cssFileName: 'preview' }
  }
});
const js = fs.readFileSync(path.join(out, 'preview.js'), 'utf8');
const cssFile = fs.readdirSync(out).find((f) => f.endsWith('.css'));
const css = cssFile ? fs.readFileSync(path.join(out, cssFile), 'utf8') : '';

// The app's own theme tokens (index.css + mac-shell.css), so the preview looks like the app in its dark and light themes
const tokenBlocks = (file) => {
  const src = fs.readFileSync(path.join(root, file), 'utf8');
  return (src.match(/(^|\n)(:root|\[data-theme=["'](light|gray|oled)["']\])\s*\{[^}]*\}/g) || []).join('\n');
};
const tokens = tokenBlocks('src/styles/index.css') + '\n' + tokenBlocks('src/styles/mac-shell.css');
const template = fs.readFileSync(path.join(root, 'docs/achievements-preview.template.html'), 'utf8');
const html = template
  .replace('/*APP_TOKENS*/', () => tokens)
  .replace('/*ACH_CSS*/', () => css)
  .replace('/*ACH_JS*/', () => js.replace(/<\/script/gi, '<\\/script'));
fs.writeFileSync(path.join(root, 'docs/achievements-preview.html'), html);
fs.rmSync(out, { recursive: true, force: true });
console.log(`docs/achievements-preview.html: ${(html.length / 1024).toFixed(0)} KB`);
