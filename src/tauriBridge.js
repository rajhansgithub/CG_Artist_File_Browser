import { invoke, convertFileSrc, isTauri } from '@tauri-apps/api/core';
import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { listen } from '@tauri-apps/api/event';

export function setupTauriBridge() {
  if (!isTauri() && !window.__TAURI_INTERNALS__) {
    return;
  }

  window.electronAPI = {
    isElectron: false,
    isTauri: true,

    // File System & Navigation
    listDrives: async () => {
      return await invoke('list_drives');
    },

    readDirectory: async (dirPath, options) => {
      const res = await invoke('read_directory', { dirPath, options });
      if (res && res.items) {
        // Convert thumbnail paths to browser-renderable URLs
        res.items = res.items.map((item) => {
          if (item.thumbnail && !item.thumbnail.startsWith('http') && !item.thumbnail.startsWith('data:')) {
            return {
              ...item,
              thumbnail: convertFileSrc(item.thumbnail),
            };
          }
          return item;
        });
      }
      return res;
    },

    openFolderDialog: async (defaultPath) => {
      try {
        const selected = await openDialog({
          directory: true,
          multiple: false,
          defaultPath: defaultPath || undefined,
        });
        if (Array.isArray(selected)) return selected[0] || null;
        return selected || null;
      } catch (err) {
        console.error('openFolderDialog error:', err);
        return null;
      }
    },

    openFileDialog: async (options = {}) => {
      try {
        const selected = await openDialog({
          directory: false,
          multiple: false,
          filters: options.filters || undefined,
          defaultPath: options.defaultPath || undefined,
        });
        if (Array.isArray(selected)) return selected[0] || null;
        return selected || null;
      } catch (err) {
        console.error('openFileDialog error:', err);
        return null;
      }
    },

    showInFolder: async (filePath) => {
      return await invoke('show_in_folder', { filePath });
    },

    openExternal: async (filePath) => {
      return await invoke('open_external', { filePath });
    },

    readFileBuffer: async (filePath) => {
      const bytes = await invoke('read_file_buffer', { filePath });
      if (bytes instanceof Uint8Array) {
        return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      }
      if (Array.isArray(bytes)) {
        return new Uint8Array(bytes).buffer;
      }
      return bytes;
    },

    getItemDetails: async (filePath) => {
      return await invoke('get_item_details', { targetPath: filePath });
    },

    getPathForFile: (file) => {
      if (typeof file === 'string') return file;
      return (file && file.path) || '';
    },

    onDragDrop: async (callback) => {
      try {
        const webview = getCurrentWebview();
        const unlisten = await webview.onDragDropEvent((event) => {
          if (callback && event?.payload) {
            callback(event.payload);
          }
        });
        return unlisten;
      } catch (err) {
        console.warn('Failed to setup Tauri onDragDropEvent via getCurrentWebview, using fallback:', err);
        try {
          const unlistenDrop = await listen('tauri://drag-drop', (event) => {
            if (callback) {
              callback({
                type: 'drop',
                paths: event.payload?.paths || [],
                position: event.payload?.position
              });
            }
          });
          const unlistenEnter = await listen('tauri://drag-enter', (event) => {
            if (callback) {
              callback({
                type: 'enter',
                paths: event.payload?.paths || [],
                position: event.payload?.position
              });
            }
          });
          const unlistenOver = await listen('tauri://drag-over', (event) => {
            if (callback) {
              callback({
                type: 'over',
                position: event.payload?.position
              });
            }
          });
          const unlistenLeave = await listen('tauri://drag-leave', () => {
            if (callback) {
              callback({ type: 'leave' });
            }
          });
          return () => {
            unlistenDrop();
            unlistenEnter();
            unlistenOver();
            unlistenLeave();
          };
        } catch (fallbackErr) {
          console.error('All Tauri drag-drop listeners failed:', fallbackErr);
          return () => {};
        }
      }
    },

    // Snapshot & Image Export
    saveImageFile: async (filePath, dataUrl) => {
      try {
        await invoke('save_image_file', { filePath, dataUrl });
        return { success: true, path: filePath };
      } catch (err) {
        console.error('saveImageFile error:', err);
        return { success: false, error: err?.toString() || 'Failed to save image file' };
      }
    },

    saveImageFileDialog: async (defaultFilename, dataUrl) => {
      try {
        const chosenPath = await saveDialog({
          defaultPath: defaultFilename,
          filters: [
            { name: 'PNG Image (*.png)', extensions: ['png'] },
            { name: 'All Files (*.*)', extensions: ['*'] }
          ],
        });
        if (!chosenPath) return { success: false, cancelled: true };
        await invoke('save_image_file', { filePath: chosenPath, dataUrl });
        return { success: true, path: chosenPath };
      } catch (err) {
        console.error('saveImageFileDialog error:', err);
        return { success: false, error: err?.toString() || 'Failed to save image dialog' };
      }
    },

    // Blender 3D & Converter Integration
    getBlenderStatus: async () => {
      return await invoke('get_blender_status');
    },

    setBlenderPath: async (newPath) => {
      try {
        const status = await invoke('set_blender_path', { newPath });
        return { success: true, status };
      } catch (err) {
        return { success: false, error: err?.toString() || 'Failed to update Blender path' };
      }
    },

    convertAsset: async (filePath) => {
      return await invoke('convert_asset', { filePath });
    },

    renderThumbnail: async (filePath) => {
      return await invoke('render_thumbnail', { filePath });
    },

    // Favorites & Collections
    getFavorites: async () => {
      return await invoke('get_favorites');
    },

    toggleFavorite: async (item) => {
      return await invoke('toggle_favorite', { item });
    },

    // Cache Management
    getCacheStats: async () => {
      return await invoke('get_cache_stats');
    },

    clearCache: async () => {
      try {
        await invoke('clear_cache');
        return { success: true };
      } catch (err) {
        return { success: false, error: err?.toString() || 'Failed to clear cache' };
      }
    },

    saveThumbnail: async (filePath, dataUrl) => {
      const thumbPath = await invoke('save_thumbnail', { filePath, dataUrl });
      return {
        success: true,
        thumbnailUrl: convertFileSrc(thumbPath),
      };
    },

    // Helper to construct local streaming URLs using Tauri's convertFileSrc
    toAssetUrl: (filePath) => {
      if (!filePath) return '';
      return convertFileSrc(filePath);
    },
  };
}
