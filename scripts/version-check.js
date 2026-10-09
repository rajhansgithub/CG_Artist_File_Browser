import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const SEMVER_CORE = /^\d+\.\d+\.\d+$/;
// Line in docs/ARCHITECTURE.md: **Current release version:** `1.11.2`
const ARCH_VERSION_LINE = /\*\*Current release version:\*\*\s*`([^`]*)`/;

function readText(relPath) {
  return fs.readFileSync(path.join(rootDir, relPath), 'utf8');
}

// Each source returns its version string, or null when the version cannot be found.
const sources = [
  {
    file: 'package.json',
    read: () => JSON.parse(readText('package.json')).version ?? null,
  },
  {
    file: 'src-tauri/tauri.conf.json',
    read: () => JSON.parse(readText('src-tauri/tauri.conf.json')).version ?? null,
  },
  {
    file: 'src-tauri/Cargo.toml',
    read: () => {
      // Only the [package] table counts; other tables (dependencies, lib, ...) may also have version keys.
      const packageTable = readText('src-tauri/Cargo.toml').split(/^\[/m).find(s => s.startsWith('package]'));
      const match = packageTable?.match(/^version\s*=\s*"([^"]*)"/m);
      return match ? match[1] : null;
    },
  },
  {
    file: 'docs/ARCHITECTURE.md',
    read: () => readText('docs/ARCHITECTURE.md').match(ARCH_VERSION_LINE)?.[1] ?? null,
  },
];

console.log(`Checking version consistency across files:`);

const problems = [];
const versions = [];
for (const source of sources) {
  let value;
  try {
    value = source.read();
  } catch (err) {
    problems.push(`${source.file}: could not be read (${err.message})`);
    console.log(`  - ${source.file.padEnd(26)} <unreadable>`);
    continue;
  }
  console.log(`  - ${source.file.padEnd(26)} ${value ?? '<missing>'}`);
  if (value === null) {
    problems.push(`${source.file}: no version found`);
  } else if (!SEMVER_CORE.test(value)) {
    problems.push(`${source.file}: "${value}" is not plain MAJOR.MINOR.PATCH (no "v" prefix or beta suffix)`);
  } else {
    versions.push({ file: source.file, value });
  }
}

// package.json is the reference; every other source must match it exactly.
const reference = versions.find(v => v.file === 'package.json');
if (reference) {
  for (const { file, value } of versions) {
    if (value !== reference.value) {
      problems.push(`${file} has ${value} but package.json has ${reference.value}`);
    }
  }
}

if (problems.length === 0) {
  console.log(`\n✓ All files agree on version v${reference.value}\n`);
  process.exit(0);
} else {
  console.error(`\n❌ Version mismatch detected! All files must agree on one MAJOR.MINOR.PATCH version:`);
  for (const problem of problems) {
    console.error(`   - ${problem}`);
  }
  console.error(`\nFix the listed file(s), or run "npm run release <version>", which updates all of them.\n`);
  process.exit(1);
}
