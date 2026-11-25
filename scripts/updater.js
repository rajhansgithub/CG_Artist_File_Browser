// In-app update tools (docs/UPDATES.md). Run on the PC that builds the release.
//
//   npm run updater:keygen
//       Makes the update signing key once, OUTSIDE the repo, and writes its public half into
//       src-tauri/tauri.conf.json. Keep a backup of the key file: without it, installed apps can no longer
//       be updated (people would have to download the app again by hand).
//
//   npm run updater:sign -- <version> [--notes "What changed"] [--notes-file notes.md] [--base-url <url>]
//       After the build: signs the installer and the portable exe in release/ for that version and writes
//       release/latest.json, the file the app reads to find updates. Upload latest.json with the two exes.
//
// The key is looked for in TAURI_SIGNING_PRIVATE_KEY_PATH, else %USERPROFILE%\.tauri\cg-artist-file-browser-updater.key
// A password, if the key has one, comes from TAURI_SIGNING_PRIVATE_KEY_PASSWORD. Nothing secret is written to the repo.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const confPath = path.join(rootDir, 'src-tauri', 'tauri.conf.json');
const releaseDir = path.join(rootDir, 'release');
const tauriCli = path.join(rootDir, 'node_modules', '@tauri-apps', 'cli', 'tauri.js');

export const KEY_PATH = process.env.TAURI_SIGNING_PRIVATE_KEY_PATH
  || path.join(os.homedir(), '.tauri', 'cg-artist-file-browser-updater.key');

// Manifest keys, matching src-tauri/src/app_update.rs
const TARGET_INSTALLED = 'windows-x86_64';
const TARGET_PORTABLE = 'windows-x86_64-portable';

export const setupName = (v) => `CG-Artist-File-Browser-Setup-v${v}.exe`;
export const portableName = (v) => `CG-Artist-File-Browser-v${v}-Portable.exe`;

function fail(msg) {
  console.error(`\n❌ ${msg}\n`);
  process.exit(1);
}

function readConf() {
  return JSON.parse(fs.readFileSync(confPath, 'utf8'));
}

function updaterConf(conf) {
  return conf.plugins?.updater || {};
}

function tauri(args) {
  if (!fs.existsSync(tauriCli)) fail('The Tauri CLI is missing. Run npm install first.');
  // No shell, so paths with spaces and an empty password reach the CLI exactly as given
  execFileSync(process.execPath, [tauriCli, ...args], { cwd: rootDir, stdio: 'inherit' });
}

function passwordArgs() {
  return process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD === undefined ? ['-p', ''] : [];
}

// "https://github.com/o/r/releases/latest/download/latest.json" -> { owner, repo }
export function githubRepoOf(endpoint) {
  const m = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/releases\//.exec(endpoint || '');
  return m ? { owner: m[1], repo: m[2] } : null;
}

// Where the files of a version are downloaded from: the release of the repo the first GitHub endpoint points to
export function downloadBase(conf, version, override) {
  if (override) return override.replace(/\/+$/, '');
  const gh = (updaterConf(conf).endpoints || []).map(githubRepoOf).find(Boolean);
  if (!gh) fail('No GitHub endpoint in tauri.conf.json > plugins.updater.endpoints. Pass --base-url <where the files will be>.');
  return `https://github.com/${gh.owner}/${gh.repo}/releases/download/v${version}`;
}

// Fails unless the key exists and matches the public key in tauri.conf.json. Used by sign and by release.js.
export function checkKey() {
  const pubkey = (updaterConf(readConf()).pubkey || '').trim();
  if (!pubkey) fail('tauri.conf.json has no updater public key yet. Run: npm run updater:keygen');
  if (!process.env.TAURI_SIGNING_PRIVATE_KEY && !fs.existsSync(KEY_PATH)) {
    fail(`The update signing key was not found at ${KEY_PATH}. Restore it from your backup (or set TAURI_SIGNING_PRIVATE_KEY_PATH). Do not make a new key: installed apps only trust the old one.`);
  }
  const pubPath = `${KEY_PATH}.pub`;
  if (fs.existsSync(pubPath) && fs.readFileSync(pubPath, 'utf8').trim() !== pubkey) {
    fail(`The key at ${KEY_PATH} does not match the public key in tauri.conf.json. Updates signed with it would be refused by the app.`);
  }
}

function keygen() {
  const conf = readConf();
  const current = (updaterConf(conf).pubkey || '').trim();
  const pubPath = `${KEY_PATH}.pub`;

  if (!fs.existsSync(KEY_PATH)) {
    if (current && !process.argv.includes('--replace-key')) {
      fail(`tauri.conf.json already has an updater public key, but its private key is not at ${KEY_PATH}. Restore the key from your backup. (A new key locks out every installed app; only if you really mean that, run again with --replace-key.)`);
    }
    fs.mkdirSync(path.dirname(KEY_PATH), { recursive: true });
    console.log(`Making the update signing key at ${KEY_PATH} ...`);
    tauri(['signer', 'generate', '--ci', ...passwordArgs(), '-w', KEY_PATH]);
  } else {
    console.log(`Using the existing update signing key at ${KEY_PATH}`);
  }
  if (!fs.existsSync(pubPath)) fail(`${pubPath} is missing; it is made together with the key.`);
  const pubkey = fs.readFileSync(pubPath, 'utf8').trim();
  if (current && current !== pubkey && !process.argv.includes('--replace-key')) {
    fail('tauri.conf.json has a different public key. Keeping it. (Run with --replace-key only if you mean to lock out installed apps.)');
  }

  conf.plugins = conf.plugins || {};
  conf.plugins.updater = { ...updaterConf(conf), pubkey };
  fs.writeFileSync(confPath, JSON.stringify(conf, null, 2) + '\n');
  console.log('✓ Public key written to src-tauri/tauri.conf.json (plugins.updater.pubkey). Commit that file.');
  console.log(`\n⚠️  BACK UP ${KEY_PATH} (for example to a password manager or a USB stick).`);
  console.log('   Never commit it or share it. If it is lost, installed apps can no longer be updated.\n');
}

function argValue(name) {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
}

function sign() {
  const version = (process.argv[3] || '').replace(/^v/, '');
  if (!/^\d+\.\d+\.\d+$/.test(version)) fail('Usage: npm run updater:sign -- <version> [--notes "What changed"]');
  const conf = readConf();
  if (conf.version !== version) fail(`tauri.conf.json is at ${conf.version}, not ${version}. Build that version first.`);
  checkKey();

  const files = [
    { target: TARGET_INSTALLED, name: setupName(version) },
    { target: TARGET_PORTABLE, name: portableName(version) },
  ];
  for (const f of files) {
    if (!fs.existsSync(path.join(releaseDir, f.name))) fail(`release/${f.name} is missing. Build ${version} first.`);
  }

  const keyArgs = process.env.TAURI_SIGNING_PRIVATE_KEY ? [] : ['-f', KEY_PATH];
  const base = downloadBase(conf, version, argValue('--base-url'));
  const platforms = {};
  for (const f of files) {
    const file = path.join(releaseDir, f.name);
    const sigPath = `${file}.sig`;
    if (fs.existsSync(sigPath)) fs.rmSync(sigPath);
    // --app-version binds the signature to this version (the app refuses a mismatch)
    tauri(['signer', 'sign', ...keyArgs, ...passwordArgs(), '--app-version', version, file]);
    if (!fs.existsSync(sigPath)) fail(`Signing ${f.name} did not produce ${f.name}.sig.`);
    platforms[f.target] = { signature: fs.readFileSync(sigPath, 'utf8').trim(), url: `${base}/${encodeURIComponent(f.name)}` };
  }
  // Same installer under the bundle-specific key too, for any future build that asks for it
  platforms[`${TARGET_INSTALLED}-nsis`] = platforms[TARGET_INSTALLED];

  const notesFile = argValue('--notes-file');
  const notes = notesFile ? fs.readFileSync(path.resolve(notesFile), 'utf8').trim() : (argValue('--notes') || '').trim();
  const manifest = {
    version,
    notes: notes || `Version ${version}.`,
    pub_date: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    platforms,
  };
  fs.writeFileSync(path.join(releaseDir, 'latest.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log(`\n✓ Signed ${files.map((f) => f.name).join(' and ')}`);
  console.log(`✓ Wrote release/latest.json (downloads from ${base})`);
  console.log('  Upload latest.json together with both exes to the same release.\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const cmd = process.argv[2];
  if (cmd === 'keygen') keygen();
  else if (cmd === 'sign') sign();
  else fail('Usage: node scripts/updater.js keygen | sign <version> [--notes "..."]');
}
