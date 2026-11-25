import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { checkKey, githubRepoOf } from './updater.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const cargoBin = path.join(process.env.USERPROFILE || 'C:\\Users\\RajhansMiniPC', '.cargo', 'bin');
if (fs.existsSync(cargoBin) && !process.env.PATH.includes(cargoBin)) {
  process.env.PATH = `${cargoBin};${process.env.PATH}`;
}
const nodeBin = 'C:\\Program Files\\nodejs';
if (fs.existsSync(nodeBin) && !process.env.PATH.includes(nodeBin)) {
  process.env.PATH = `${nodeBin};${process.env.PATH}`;
}

const targetVersion = process.argv[2];
// Optional: npm run release 1.25.0 -- --notes "What changed" (shown in the app's update screen and on GitHub)
const notesIdx = process.argv.indexOf('--notes');
const releaseNotes = notesIdx > 0 ? (process.argv[notesIdx + 1] || '').trim() : '';

if (!targetVersion) {
  console.error('Usage: npm run release <version>');
  console.error('\nRelease Versioning Rules (SemVer MAJOR.MINOR.PATCH):');
  console.error('  Patch (bug fixes, maintenance):       npm run release 1.0.11');
  console.error('  Minor (new features from ROADMAP.md):  npm run release 1.1.0');
  console.error('  Major (architectural overhaul):       npm run release 2.0.0');
  console.error('\nNote: v1.0.10 is followed by v1.0.11 (dot-separated integers, not decimals).\n');
  process.exit(1);
}

const cleanVersion = targetVersion.replace(/^v/, '');
const tag = `v${cleanVersion}`;

// Reject anything that would not pass scripts/version-check.js before any file is changed.
if (!/^\d+\.\d+\.\d+$/.test(cleanVersion)) {
  console.error(`❌ "${targetVersion}" is not a plain MAJOR.MINOR.PATCH version (for example 1.11.3). Nothing was changed.`);
  process.exit(1);
}

const archPath = path.join(rootDir, 'docs', 'ARCHITECTURE.md');
const archContent = fs.readFileSync(archPath, 'utf8');
const ARCH_VERSION_LINE = /(\*\*Current release version:\*\*\s*`)[^`]*(`)/;
if (!ARCH_VERSION_LINE.test(archContent)) {
  console.error('❌ No "Current release version" line found in docs/ARCHITECTURE.md. Nothing was changed.');
  process.exit(1);
}

// In-app updates: the release must be signed with the update key (docs/UPDATES.md). Checked before any file changes.
checkKey();

console.log(`\n🚀 Preparing release ${tag}...\n`);

// 1. Update package.json
const pkgPath = path.join(rootDir, 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
pkg.version = cleanVersion;
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
console.log(`✓ Updated package.json to ${cleanVersion}`);

// 2. Update src-tauri/tauri.conf.json
const tauriConfPath = path.join(rootDir, 'src-tauri', 'tauri.conf.json');
if (fs.existsSync(tauriConfPath)) {
  const tauriConf = JSON.parse(fs.readFileSync(tauriConfPath, 'utf8'));
  tauriConf.version = cleanVersion;
  fs.writeFileSync(tauriConfPath, JSON.stringify(tauriConf, null, 2) + '\n');
  console.log(`✓ Updated tauri.conf.json to ${tauriConf.version}`);
}

// 3. Update src-tauri/Cargo.toml
const cargoPath = path.join(rootDir, 'src-tauri', 'Cargo.toml');
if (fs.existsSync(cargoPath)) {
  let cargoContent = fs.readFileSync(cargoPath, 'utf8');
  cargoContent = cargoContent.replace(
    /^version = "[^"]+"/m,
    `version = "${cleanVersion}"`
  );
  fs.writeFileSync(cargoPath, cargoContent);
  console.log(`✓ Updated Cargo.toml`);
}

// 4. Update the "Current release version" line in docs/ARCHITECTURE.md
fs.writeFileSync(archPath, archContent.replace(ARCH_VERSION_LINE, `$1${cleanVersion}$2`));
console.log(`✓ Updated docs/ARCHITECTURE.md to ${cleanVersion}`);

// Verify consistency across all version files
execSync('npm run version:check', { cwd: rootDir, stdio: 'inherit' });

// 4. Run frontend build check & Local Tauri build
console.log(`\n📦 Building local binaries with Tauri...`);
try {
  execSync('npx tauri build', { cwd: rootDir, stdio: 'inherit' });
  const releaseDir = path.join(rootDir, 'release');
  if (!fs.existsSync(releaseDir)) fs.mkdirSync(releaseDir, { recursive: true });

  const targetExe = path.join(rootDir, 'src-tauri', 'target', 'release', 'cg-artist-file-browser.exe');
  if (fs.existsSync(targetExe)) {
    fs.copyFileSync(targetExe, path.join(releaseDir, `CG-Artist-File-Browser-v${cleanVersion}-Portable.exe`));
    fs.copyFileSync(targetExe, path.join(releaseDir, `CG-Artist-File-Browser-Portable.exe`));
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
      console.log(`✓ Copied installer to release/: ${setupFile}`);
    }
  }
} catch (e) {
  console.warn('⚠️ Local Tauri build failed or skipped, running npm run build check:', e.message);
  execSync('npm run build', { cwd: rootDir, stdio: 'inherit' });
}

// Check the built files before anything is committed or pushed.
const setupAsset = path.join(rootDir, 'release', `CG-Artist-File-Browser-Setup-v${cleanVersion}.exe`);
const portableAsset = path.join(rootDir, 'release', `CG-Artist-File-Browser-v${cleanVersion}-Portable.exe`);
const manifestAsset = path.join(rootDir, 'release', 'latest.json');
if (!fs.existsSync(setupAsset) || !fs.existsSync(portableAsset)) {
  console.error(`\n❌ The installer or the portable exe is missing in release/. Nothing was committed or pushed.`);
  process.exit(1);
}

// Sign both for the in-app updater and write release/latest.json
if (fs.existsSync(manifestAsset)) fs.rmSync(manifestAsset);
execSync(`node scripts/updater.js sign ${cleanVersion}${releaseNotes ? ` --notes ${JSON.stringify(releaseNotes)}` : ''}`, { cwd: rootDir, stdio: 'inherit' });
const releaseAssets = [
  setupAsset,
  portableAsset,
  path.join(rootDir, 'release', 'CG-Artist-File-Browser-Portable.exe'),
  manifestAsset,
].filter(fs.existsSync);

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

  // 6. Create the GitHub Release and upload the locally built files with the gh CLI (not GitHub Actions)
  console.log(`\n🚀 Uploading locally built binaries directly to GitHub Releases...`);
  // Created as a draft, then published once every file is up, so the app never sees a release without latest.json
  const notesFile = path.join(rootDir, 'release', 'release-notes.md');
  fs.writeFileSync(notesFile, releaseNotes || `Release ${tag}.`);
  const title = `CG Artist File Browser ${tag} (Installer & Portable)`;
  const publish = (assets, repoArg) => {
    const assetArgs = assets.map(p => `"${p}"`).join(' ');
    execSync(`gh release create ${tag} ${assetArgs} ${repoArg} --draft --title "${title}" --notes-file "${notesFile}"`, { cwd: rootDir, stdio: 'inherit' });
    execSync(`gh release edit ${tag} ${repoArg} --draft=false --latest`, { cwd: rootDir, stdio: 'inherit' });
  };
  publish(releaseAssets, '');
  console.log(`✓ Published ${tag} to GitHub Releases`);

  // A private app reads its updates from a public mirror repo (docs/UPDATES.md): publish the same files there
  const tauriConf = JSON.parse(fs.readFileSync(tauriConfPath, 'utf8'));
  const updateRepo = (tauriConf.plugins?.updater?.endpoints || []).map(githubRepoOf).find(Boolean);
  const sourceRepo = /github\.com[/:]([^/]+)\/([^/.]+)/.exec(pkg.repository?.url || '');
  if (updateRepo && sourceRepo && `${updateRepo.owner}/${updateRepo.repo}`.toLowerCase() !== `${sourceRepo[1]}/${sourceRepo[2]}`.toLowerCase()) {
    publish([setupAsset, portableAsset, manifestAsset], `--repo ${updateRepo.owner}/${updateRepo.repo}`);
    console.log(`✓ Published the update files to ${updateRepo.owner}/${updateRepo.repo}`);
  }

  console.log(`\n🎉 Successfully published release ${tag} to GitHub!`);
  console.log(`🔗 Releases: https://github.com/rajhansgithub/CG_Artist_File_Browser/releases\n`);
} catch (err) {
  console.error('Release failed:', err.message);
  process.exit(1);
}
