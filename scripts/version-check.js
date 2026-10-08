import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// 1. Read package.json
const pkgPath = path.join(rootDir, 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
const pkgVersion = pkg.version;

// 2. Read src-tauri/tauri.conf.json
const tauriConfPath = path.join(rootDir, 'src-tauri', 'tauri.conf.json');
const tauriConf = JSON.parse(fs.readFileSync(tauriConfPath, 'utf8'));
const tauriVersion = tauriConf.version;

// 3. Read src-tauri/Cargo.toml
const cargoPath = path.join(rootDir, 'src-tauri', 'Cargo.toml');
const cargoContent = fs.readFileSync(cargoPath, 'utf8');
const cargoMatch = cargoContent.match(/^version\s*=\s*"([^"]+)"/m);
const cargoVersion = cargoMatch ? cargoMatch[1] : null;

console.log(`Checking version consistency across files:`);
console.log(`  - package.json:          ${pkgVersion}`);
console.log(`  - tauri.conf.json:       ${tauriVersion}`);
console.log(`  - Cargo.toml:            ${cargoVersion}`);

if (pkgVersion === tauriVersion && pkgVersion === cargoVersion) {
  console.log(`\n✓ All files agree on version v${pkgVersion}\n`);
  process.exit(0);
} else {
  console.error(`\n❌ Version mismatch detected! All files must agree.`);
  process.exit(1);
}
