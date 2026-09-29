import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { exec } from 'child_process';
import { performance } from 'perf_hooks';

const FORMAT_CATEGORIES = {
  '.obj': '3d', '.fbx': '3d', '.gltf': '3d', '.glb': '3d', '.stl': '3d',
  '.ply': '3d', '.usd': '3d', '.usda': '3d', '.usdc': '3d', '.usdz': '3d',
  '.abc': '3d', '.dae': '3d', '.blend': '3d',
  '.hdr': 'hdr', '.exr': 'hdr',
  '.png': 'image', '.jpg': 'image', '.jpeg': 'image', '.webp': 'image', '.bmp': 'image',
  '.tif': 'texture', '.tiff': 'texture', '.tga': 'texture', '.dds': 'texture', '.psd': 'texture',
  '.mp4': 'video', '.webm': 'video', '.mov': 'video', '.mkv': 'video', '.avi': 'video',
  '.wav': 'audio', '.mp3': 'audio', '.ogg': 'audio', '.flac': 'audio', '.aac': 'audio', '.aiff': 'audio', '.m4a': 'audio'
};

function hashString(str) {
  return crypto.createHash('md5').update(str).digest('hex');
}

const CACHE_DIR = path.join(process.env.LOCALAPPDATA || 'C:\\Users\\Temp', 'AssetStudioCache');

// 1. List Drives (Electron WMIC implementation)
export async function listDrivesNode() {
  return new Promise((resolve) => {
    const t0 = performance.now();
    exec('wmic logicaldisk get name, volumename, size, freespace /format:list', (err, stdout) => {
      const elapsed = performance.now() - t0;
      if (!err && stdout.trim()) {
        const drives = [];
        const entries = stdout.trim().split(/\r?\n\r?\n/);
        for (const entry of entries) {
          const lines = entry.split(/\r?\n/);
          const driveObj = {};
          for (const line of lines) {
            const [k, v] = line.split('=');
            if (k && v !== undefined) driveObj[k.trim()] = v.trim();
          }
          if (driveObj.Name) {
            drives.push({
              name: driveObj.Name + '\\',
              mount: driveObj.Name,
              label: driveObj.VolumeName || 'Local Disk',
              totalGB: driveObj.Size ? (parseInt(driveObj.Size, 10) / (1024 ** 3)).toFixed(1) : null,
              freeGB: driveObj.FreeSpace ? (parseInt(driveObj.FreeSpace, 10) / (1024 ** 3)).toFixed(1) : null
            });
          }
        }
        resolve({ drives, elapsed });
        return;
      }
      resolve({ drives: [], elapsed });
    });
  });
}

// 2. Read Directory (Electron scan implementation)
export async function readDirectoryNode(dirPath, options = {}) {
  const { filter = 'all', search = '', recursive = false, maxDepth = 2 } = options;
  const lowerSearch = search.trim().toLowerCase();
  const results = [];

  const t0 = performance.now();

  async function scan(currentDir, currentDepth) {
    const entries = await fsp.readdir(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name.startsWith('$') || entry.name === 'node_modules' || entry.name === 'System Volume Information') {
        continue;
      }

      const fullPath = path.join(currentDir, entry.name);
      let isDirectory = false;
      try {
        isDirectory = entry.isDirectory();
      } catch (e) {
        continue;
      }

      if (isDirectory) {
        if (!recursive) {
          results.push({
            name: entry.name,
            path: fullPath,
            isDirectory: true,
            category: 'folder',
            size: 0,
            modified: 0,
            extension: ''
          });
        } else if (currentDepth < maxDepth) {
          await scan(fullPath, currentDepth + 1);
        }
      } else {
        const ext = path.extname(entry.name).toLowerCase();
        const category = FORMAT_CATEGORIES[ext] || 'other';

        if (filter === '3d' && category !== '3d') continue;
        if (filter === 'hdr' && category !== 'hdr') continue;
        if (filter === 'image' && category !== 'image') continue;
        if (filter === 'texture' && category !== 'texture') continue;
        if (filter === 'video' && category !== 'video') continue;
        if (filter === 'audio' && category !== 'audio') continue;
        if (filter === 'assets' && !['3d', 'hdr', 'image', 'texture', 'video', 'audio'].includes(category)) continue;

        if (lowerSearch && !entry.name.toLowerCase().includes(lowerSearch)) {
          continue;
        }

        let size = 0;
        let modified = 0;
        try {
          const stats = await fsp.stat(fullPath);
          size = stats.size;
          modified = stats.mtimeMs;
        } catch (e) {}

        let thumbnail = null;
        const hash = hashString(`v2_${fullPath}_${modified}_${size}`);
        const cachedJpg = path.join(CACHE_DIR, 'thumbs', `${hash}.jpg`);
        const cachedPng = path.join(CACHE_DIR, 'thumbs', `${hash}.png`);
        if (fs.existsSync(cachedJpg)) {
          thumbnail = `app-asset://local/${encodeURIComponent(cachedJpg)}`;
        } else if (fs.existsSync(cachedPng)) {
          thumbnail = `app-asset://local/${encodeURIComponent(cachedPng)}`;
        }

        results.push({
          name: entry.name,
          path: fullPath,
          isDirectory: false,
          category,
          extension: ext,
          size,
          modified,
          thumbnail
        });
      }
    }
  }

  await scan(dirPath, 0);
  const elapsed = performance.now() - t0;
  return { itemsCount: results.length, elapsed, results };
}

// 3. Read File Buffer (Electron buffer read implementation)
export async function readFileBufferNode(filePath) {
  const t0 = performance.now();
  const data = await fsp.readFile(filePath);
  const elapsed = performance.now() - t0;
  const sizeMB = data.length / (1024 * 1024);
  const throughputMBs = (sizeMB / (elapsed / 1000));
  return { sizeMB, elapsed, throughputMBs };
}
