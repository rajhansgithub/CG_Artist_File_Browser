import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const cargoBin = path.join(process.env.USERPROFILE || 'C:\\Users\\RajhansMiniPC', '.cargo', 'bin');
if (fs.existsSync(cargoBin) && !process.env.PATH.includes(cargoBin)) {
  process.env.PATH = `${cargoBin};${process.env.PATH}`;
}

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

// 4. Run frontend build check & Local Tauri build
console.log(`\n📦 Building local binaries with Tauri...`);
try {
  execSync('npx tauri build', { cwd: rootDir, stdio: 'inherit' });
  const releaseDir = path.join(rootDir, 'release');
  if (!fs.existsSync(releaseDir)) fs.mkdirSync(releaseDir, { recursive: true });

  const targetExe = path.join(rootDir, 'src-tauri', 'target', 'release', 'cg-artist-file-browser.exe');
  if (fs.existsSync(targetExe)) {
    fs.copyFileSync(targetExe, path.join(releaseDir, `CG-Artist-File-Browser-v${cleanVersion}-Standalone.exe`));
    fs.copyFileSync(targetExe, path.join(releaseDir, `CG-Artist-File-Browser-v${cleanVersion}-Portable.exe`));
    fs.copyFileSync(targetExe, path.join(releaseDir, `CG-Artist-File-Browser-Portable.exe`));
    fs.copyFileSync(targetExe, path.join(releaseDir, `cg-artist-file-browser.exe`));
    console.log(`✓ Copied portable binaries to release/`);
  }

  const nsisBundleDir = path.join(rootDir, 'src-tauri', 'target', 'release', 'bundle', 'nsis');
  if (fs.existsSync(nsisBundleDir)) {
    const files = fs.readdirSync(nsisBundleDir);
    const setupFile = files.find(f => f.includes(cleanVersion) && f.endsWith('.exe')) ||
                      files.filter(f => f.endsWith('.exe')).sort((a, b) => {
                        return fs.statSync(path.join(nsisBundleDir, b)).mtimeMs - fs.statSync(path.join(nsisBundleDir, a)).mtimeMs;
                      })[0];
    if (setupFile) {
      fs.copyFileSync(path.join(nsisBundleDir, setupFile), path.join(releaseDir, `CG-Artist-File-Browser-Setup-v${cleanVersion}.exe`));
      fs.copyFileSync(path.join(nsisBundleDir, setupFile), path.join(releaseDir, `CG-Artist-File-Browser-Setup-${cleanVersion}.exe`));
      fs.copyFileSync(path.join(nsisBundleDir, setupFile), path.join(releaseDir, setupFile));
      console.log(`✓ Copied installer binaries to release/: ${setupFile}`);
    }
  }
} catch (e) {
  console.warn('⚠️ Local Tauri build failed or skipped, running npm run build check:', e.message);
  execSync('npm run build', { cwd: rootDir, stdio: 'inherit' });
}

// 5. Git Commit, Tag & Push
console.log(`\n📤 Publishing to GitHub...`);
try {
  execSync('git add -A', {
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
  console.log(`🔗 Releases: https://github.com/rajhansgithub/CG_Artist_File_Browser/releases`);
  console.log(`🔗 Action Runs: https://github.com/rajhansgithub/CG_Artist_File_Browser/actions\n`);
} catch (err) {
  console.error('Error during git push:', err);
  process.exit(1);
}
