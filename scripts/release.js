import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const targetVersion = process.argv[2];

if (!targetVersion) {
  console.error('Usage: node scripts/release.js <version>');
  console.error('Example: node scripts/release.js 1.0.1');
  process.exit(1);
}

const cleanVersion = targetVersion.replace(/^v/, '');
const tag = `v${cleanVersion}`;

console.log(`\n🚀 Preparing release ${tag}...\n`);

// 1. Update package.json
const pkgPath = path.join(rootDir, 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
pkg.version = cleanVersion;
if (pkg.build) {
  if (pkg.build.nsis) {
    pkg.build.nsis.artifactName = `CG-Artist-File-Browser-Setup-${cleanVersion}.exe`;
  }
  if (pkg.build.portable) {
    pkg.build.portable.artifactName = `CG-Artist-File-Browser-${cleanVersion}-Portable.exe`;
  }
}
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
console.log(`✓ Updated package.json to ${cleanVersion}`);

// 2. Update src-tauri/tauri.conf.json
const tauriConfPath = path.join(rootDir, 'src-tauri', 'tauri.conf.json');
if (fs.existsSync(tauriConfPath)) {
  const tauriConf = JSON.parse(fs.readFileSync(tauriConfPath, 'utf8'));
  tauriConf.version = cleanVersion.replace(/-.*$/, '');
  fs.writeFileSync(tauriConfPath, JSON.stringify(tauriConf, null, 2) + '\n');
  console.log(`✓ Updated tauri.conf.json to ${tauriConf.version}`);
}

// 3. Update src-tauri/Cargo.toml
const cargoPath = path.join(rootDir, 'src-tauri', 'Cargo.toml');
if (fs.existsSync(cargoPath)) {
  let cargoContent = fs.readFileSync(cargoPath, 'utf8');
  cargoContent = cargoContent.replace(
    /^version = "[^"]+"/m,
    `version = "${cleanVersion.replace(/-beta.*$/, '')}"`
  );
  fs.writeFileSync(cargoPath, cargoContent);
  console.log(`✓ Updated Cargo.toml`);
}

// 4. Run frontend build check
console.log(`\n📦 Verifying build...`);
execSync('npm run build', { cwd: rootDir, stdio: 'inherit' });
console.log(`✓ Frontend build passed`);

// 5. Git Commit, Tag & Push
console.log(`\n📤 Publishing to GitHub...`);
try {
  execSync('git add package.json src-tauri/tauri.conf.json src-tauri/Cargo.toml dist/ src/ scripts/ README.md', {
    cwd: rootDir,
    stdio: 'inherit'
  });
  execSync(`git commit -m "chore(release): bump version to ${cleanVersion}"`, {
    cwd: rootDir,
    stdio: 'inherit'
  });
  execSync(`git tag -a ${tag} -m "Release ${tag}"`, {
    cwd: rootDir,
    stdio: 'inherit'
  });
  execSync('git push origin main', { cwd: rootDir, stdio: 'inherit' });
  execSync(`git push origin ${tag}`, { cwd: rootDir, stdio: 'inherit' });

  console.log(`\n🎉 Successfully pushed release ${tag} to GitHub!`);
  console.log(`🔗 Releases: https://github.com/rajhansgithub/CG_Artist_File_Browser_Tauri/releases`);
  console.log(`🔗 Action Runs: https://github.com/rajhansgithub/CG_Artist_File_Browser_Tauri/actions\n`);
} catch (err) {
  console.error('Error during git push:', err);
  process.exit(1);
}
