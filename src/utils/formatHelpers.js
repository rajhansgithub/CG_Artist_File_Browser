export function formatBytes(bytes, decimals = 1) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

export function formatDate(timestamp) {
  if (!timestamp) return '';
  const d = new Date(timestamp);
  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

export function getFileBadgeClass(ext) {
  const cleanExt = (ext || '').toLowerCase().replace(/^\./, '');
  if (cleanExt === 'obj') return 'badge-obj';
  if (cleanExt === 'fbx') return 'badge-fbx';
  if (cleanExt === 'gltf' || cleanExt === 'glb') return 'badge-glb';
  if (cleanExt === 'abc') return 'badge-abc';
  if (cleanExt.startsWith('usd')) return 'badge-usd';
  if (cleanExt === 'hdr') return 'badge-hdr';
  if (cleanExt === 'exr') return 'badge-exr';
  if (cleanExt === 'tif' || cleanExt === 'tiff') return 'badge-tiff';
  if (cleanExt === 'tga') return 'badge-tga';
  if (cleanExt === 'mp4' || cleanExt === 'mov' || cleanExt === 'webm' || cleanExt === 'mkv' || cleanExt === 'avi') return 'badge-video';
  if (cleanExt === 'wav' || cleanExt === 'mp3' || cleanExt === 'ogg' || cleanExt === 'flac' || cleanExt === 'aac' || cleanExt === 'aiff' || cleanExt === 'm4a') return 'badge-audio';
  return '';
}

export function is3DFormat(ext) {
  const e = (ext || '').toLowerCase();
  return ['.obj', '.fbx', '.gltf', '.glb', '.stl', '.ply', '.usd', '.usda', '.usdc', '.usdz', '.abc', '.blend', '.dae'].includes(e);
}

export function isHdrFormat(ext) {
  const e = (ext || '').toLowerCase();
  return ['.hdr', '.exr'].includes(e);
}

export function isImageFormat(ext) {
  const e = (ext || '').toLowerCase();
  return ['.png', '.jpg', '.jpeg', '.webp', '.bmp'].includes(e);
}

export function isTextureFormat(ext) {
  const e = (ext || '').toLowerCase();
  return ['.tif', '.tiff', '.tga', '.dds', '.psd'].includes(e);
}

// Strictly 2D image and texture files eligible for Image Comparison (excludes 360 skybox HDR/EXR)
export function isComparableImage(item) {
  if (!item || item.isDirectory) return false;
  const ext = (item.extension || (item.name && item.name.includes('.') ? item.name.slice(item.name.lastIndexOf('.')) : '')).toLowerCase();
  return (isImageFormat(ext) || isTextureFormat(ext)) && !isHdrFormat(ext);
}

export function isVideoFormat(ext) {
  const e = (ext || '').toLowerCase();
  return ['.mp4', '.webm', '.mov', '.mkv', '.avi'].includes(e);
}

export function isAudioFormat(ext) {
  const e = (ext || '').toLowerCase();
  return ['.wav', '.mp3', '.ogg', '.flac', '.aac', '.aiff', '.m4a'].includes(e);
}

export function formatTimecode(seconds, fps = 24) {
  if (isNaN(seconds) || seconds < 0) return '00:00:00:00';
  const totalFrames = Math.floor(seconds * fps);
  const frames = totalFrames % fps;
  const totalSeconds = Math.floor(seconds);
  const secs = totalSeconds % 60;
  const mins = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600);
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}:${String(frames).padStart(2, '0')}`;
}

export function formatDuration(seconds) {
  if (isNaN(seconds) || seconds < 0) return '00:00';
  const totalSeconds = Math.floor(seconds);
  const secs = totalSeconds % 60;
  const mins = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600);
  if (hours > 0) {
    return `${hours}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export function toStreamUrl(filePath) {
  if (!filePath) return '';
  if (typeof window !== 'undefined' && window.electronAPI?.toAssetUrl) {
    return window.electronAPI.toAssetUrl(filePath);
  }
  return filePath;
}


