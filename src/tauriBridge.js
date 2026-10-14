import { invoke, convertFileSrc, isTauri } from '@tauri-apps/api/core';
import { open as openDialog, save as saveDialog, message as messageDialog } from '@tauri-apps/plugin-dialog';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { listen } from '@tauri-apps/api/event';

// Imported icons arrive as file paths; the webview needs URLs
function withIconUrls(state) {
  return {
    ...state,
    custom: (state.custom || []).map((c) => ({ ...c, url: convertFileSrc(c.path) })),
  };
}

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

    // Validates a typed path (\\server\share, //server/share, D:/x) and returns it in Windows form
    resolvePath: async (input) => {
      return await invoke('resolve_path', { input });
    },

    // Signs in to a share with a username and password (optionally remembered in Windows Credential Manager)
    connectNetwork: async (path, username, password, remember) => {
      return await invoke('connect_network', { path, username, password, remember });
    },

    getNetworkLocations: async () => {
      return await invoke('get_network_locations');
    },

    removeNetworkLocation: async (path) => {
      return await invoke('remove_network_location', { path });
    },

    // Recently opened folders that still exist, most recent first
    getRecentFolders: async () => {
      return await invoke('get_recent_folders');
    },

    clearRecentFolders: async () => {
      return await invoke('clear_recent_folders');
    },

    // Apps for the right-click "Send to" menu: the list, adding and removing by path, and a look for installed apps
    getExternalApps: async () => {
      return await invoke('get_external_apps');
    },

    addExternalApp: async (path, name) => {
      return await invoke('add_external_app', { path, name });
    },

    removeExternalApp: async (path) => {
      return await invoke('remove_external_app', { path });
    },

    scanExternalApps: async () => {
      return await invoke('scan_external_apps');
    },

    // Opens the files in one app from the list. Resolves { ok } or { ok: false, error }
    sendToExternalApp: async (appPath, filePaths) => {
      try {
        await invoke('send_to_external_app', { appPath, filePaths });
        return { ok: true };
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    },

    // Message box for an error the user needs to see, such as an app that could not start
    showError: async (text, title) => {
      await messageDialog(String(text), { title, kind: 'error' });
    },

    // Batch convert runs in the background in Rust and reports through events. The caller makes the job id and
    // listens before starting, so no event can be missed. Resolves { ok } or { ok: false, error }
    // options: { exrLayer, exrPrecision: 'half' | 'float', exrCompression: 'zip' | 'piz' | 'rle' | 'none', exrAlpha }
    startBatchConvert: async (jobId, filePaths, format, outDir, options) => {
      try {
        await invoke('start_batch_convert', { jobId, filePaths, format, outDir: outDir || null, options: options || null });
        return { ok: true };
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    },

    // The layers of the EXR files among filePaths, for the converter's layer picker:
    // { layers: [{ name, kind, files }], exrFiles, read, unreadable }. Resolves null when they cannot be listed.
    listExrLayers: async (filePaths) => {
      try {
        return await invoke('list_exr_layers', { filePaths });
      } catch {
        return null;
      }
    },

    cancelBatchConvert: async (jobId) => {
      return await invoke('cancel_batch_convert', { jobId });
    },

    // Calls handler('progress' | 'finished', payload) for each batch event. Resolves a function that stops listening
    onBatchConvertEvent: async (handler) => {
      const unlistenProgress = await listen('batch-convert-progress', (event) => handler('progress', event.payload));
      const unlistenFinished = await listen('batch-convert-finished', (event) => handler('finished', event.payload));
      return () => {
        unlistenProgress();
        unlistenFinished();
      };
    },

    // Duplicate finder: scans a folder in the background in Rust and reports through events, like the batch convert.
    // options: { exact, minScore }. Resolves { ok } or { ok: false, error }
    startDuplicateScan: async (jobId, root, options) => {
      try {
        await invoke('start_duplicate_scan', { jobId, root, options: options || null });
        return { ok: true };
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    },

    cancelDuplicateScan: async (jobId) => {
      return await invoke('cancel_duplicate_scan', { jobId });
    },

    // Calls handler('progress' | 'finished', payload) for each scan event. Resolves a function that stops listening
    onDuplicateScanEvent: async (handler) => {
      const unlistenProgress = await listen('duplicate-scan-progress', (event) => handler('progress', event.payload));
      const unlistenFinished = await listen('duplicate-scan-finished', (event) => handler('finished', event.payload));
      return () => {
        unlistenProgress();
        unlistenFinished();
      };
    },

    // File operations (copy, cut, paste, new folder). Pasting runs in the background in Rust and reports through events,
    // like the batch convert: the caller makes the job id and listens before starting.
    // checkFileTransfer resolves { ok, conflicts: [names already in the folder], actionable } or { ok: false, error }
    checkFileTransfer: async (paths, destDir, mode) => {
      try {
        return { ok: true, ...(await invoke('check_file_transfer', { paths, destDir, mode })) };
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    },

    // mode is 'copy' or 'move'; replace picks Replace over "keep both" for names that are taken
    startFileTransfer: async (jobId, paths, destDir, mode, replace) => {
      try {
        await invoke('start_file_transfer', { jobId, paths, destDir, mode, replace: !!replace });
        return { ok: true };
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    },

    cancelFileTransfer: async (jobId) => {
      return await invoke('cancel_file_transfer', { jobId });
    },

    // Calls handler('progress' | 'finished', payload) for each paste event. Resolves a function that stops listening
    onFileTransferEvent: async (handler) => {
      const unlistenProgress = await listen('file-transfer-progress', (event) => handler('progress', event.payload));
      const unlistenFinished = await listen('file-transfer-finished', (event) => handler('finished', event.payload));
      return () => {
        unlistenProgress();
        unlistenFinished();
      };
    },

    // Makes "New folder" (numbered when taken) in a folder. Resolves { ok, path } or { ok: false, error }
    createFolder: async (parent) => {
      try {
        return { ok: true, path: await invoke('create_folder', { parent, name: null }) };
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    },

    // The file clipboard, shared with File Explorer on Windows. getClipboardFiles resolves { ok, files: { paths, cut } | null }
    setClipboardFiles: async (paths, cut) => {
      try {
        await invoke('set_clipboard_files', { paths, cut: !!cut });
        return { ok: true };
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    },

    getClipboardFiles: async () => {
      try {
        return { ok: true, files: await invoke('get_clipboard_files') };
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    },

    clearClipboardFiles: async () => {
      try {
        await invoke('clear_clipboard_files');
      } catch {
        // an emptied clipboard is a nicety; the paste has already happened
      }
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

    openFilesDialog: async (options = {}) => {
      try {
        const selected = await openDialog({
          directory: false,
          multiple: true,
          filters: options.filters || undefined,
          defaultPath: options.defaultPath || undefined,
        });
        if (!selected) return [];
        return Array.isArray(selected) ? selected : [selected];
      } catch (err) {
        console.error('openFilesDialog error:', err);
        return [];
      }
    },

    showInFolder: async (filePath) => {
      return await invoke('show_in_folder', { filePath });
    },

    openExternal: async (filePath) => {
      return await invoke('open_external', { filePath });
    },

    // Opens a web or mail link (http, https, mailto) from a document in the default browser. Resolves { ok } or { ok: false, error }
    openUrl: async (url) => {
      try {
        await invoke('open_url', { url });
        return { ok: true };
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    },

    // Opens the built-in user guide in the default browser. Resolves { ok } or { ok: false, error } with a sentence to show
    openUserGuide: async () => {
      try {
        await invoke('open_user_guide');
        return { ok: true };
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    },

    // Renames inside the same folder. Resolves { ok, path } or { ok: false, error }
    renameItem: async (filePath, newName) => {
      try {
        const path = await invoke('rename_item', { filePath, newName });
        return { ok: true, path };
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    },

    // Moves a file or folder to the Recycle Bin. Resolves { ok } or { ok: false, error }
    deleteItem: async (filePath) => {
      try {
        await invoke('delete_item', { filePath });
        return { ok: true };
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    },

    // Deletes a file or folder for good (Shift + Delete). Resolves { ok } or { ok: false, error }
    deleteItemPermanently: async (filePath) => {
      try {
        await invoke('delete_item_permanently', { filePath });
        return { ok: true };
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    },

    readFileBuffer: async (filePath) => {
      const bytes = await invoke('read_file_buffer', { filePath });
      // Raw ipc::Response arrives as an ArrayBuffer (no JSON array round trip)
      if (bytes instanceof ArrayBuffer) {
        return bytes;
      }
      if (bytes instanceof Uint8Array) {
        return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      }
      if (Array.isArray(bytes)) {
        return new Uint8Array(bytes).buffer;
      }
      return bytes;
    },

    // Header bytes of a file, so an EXR can be planned without reading all of it
    readFileRange: async (filePath, start, length) => {
      const bytes = await invoke('read_file_range', { filePath, start, length });
      return bytes instanceof ArrayBuffer ? bytes : new Uint8Array(bytes).buffer;
    },

    // Native EXR decode (all cores): RGBA float32 bytes, bottom row first. Rejects when the JS loader should be used.
    // With preferHalf, an all-half-float image comes back as half float (8 bytes per pixel instead of 16).
    decodeExrRgba: async (filePath, r, g, b, a, preferHalf) => {
      const bytes = await invoke('decode_exr_rgba', { filePath, r, g, b, a: a || null, preferHalf: !!preferHalf });
      return bytes instanceof ArrayBuffer ? bytes : new Uint8Array(bytes).buffer;
    },

    getItemDetails: async (filePath) => {
      return await invoke('get_item_details', { targetPath: filePath });
    },

    // Header details for the Inspector drawer: size in pixels, colour layout, EXR channels, dates
    getFileInfo: async (filePath) => {
      return await invoke('get_file_info', { filePath });
    },

    getPathForFile: (file) => {
      if (typeof file === 'string') return file;
      return (file && file.path) || '';
    },

    // Drags real files out of the window into another application; resolves when the drag ends
    startDragOut: async (paths) => {
      return await invoke('start_drag_out', { paths });
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

    // Colour labels & tags (kept in the app's own store, never written next to the files)
    getFileLabels: async () => {
      return await invoke('get_file_labels');
    },

    setFileColor: async (paths, color) => {
      return await invoke('set_file_color', { paths, color: color || null });
    },

    editFileTags: async (paths, add, remove) => {
      return await invoke('edit_file_tags', { paths, add, remove });
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

    // Native (Rust) thumbnail for HDR / EXR / TGA / TIFF. Resolves to a renderable URL, or null when the
    // file is not handled natively so callers can fall back to the JavaScript decoders.
    generateThumbnail: async (filePath) => {
      try {
        const thumbPath = await invoke('generate_thumbnail', { filePath });
        return thumbPath ? convertFileSrc(thumbPath) : null;
      } catch (err) {
        return null;
      }
    },

    saveThumbnail: async (filePath, dataUrl) => {
      const thumbPath = await invoke('save_thumbnail', { filePath, dataUrl });
      return {
        success: true,
        thumbnailUrl: convertFileSrc(thumbPath),
      };
    },

    // Folder icons: the user's picks and imported icons (kept next to the exe in the portable build),
    // plus the icon Windows already shows for folders customised in File Explorer.
    getFolderIcons: async () => {
      return withIconUrls(await invoke('get_folder_icons'));
    },

    // icon: 'lib:<id>' | 'custom:<id>', or null to go back to the default icon
    setFolderIcon: async (folderPath, icon) => {
      return withIconUrls(await invoke('set_folder_icon', { folderPath, icon: icon || null }));
    },

    importFolderIcons: async (filePaths) => {
      return withIconUrls(await invoke('import_folder_icons', { filePaths }));
    },

    removeFolderIcon: async (iconId) => {
      return withIconUrls(await invoke('remove_folder_icon', { iconId }));
    },

    getSystemFolderIcon: async (folderPath) => {
      const iconPath = await invoke('get_system_folder_icon', { folderPath });
      return iconPath ? convertFileSrc(iconPath) : null;
    },

    // Helper to construct local streaming URLs using Tauri's convertFileSrc
    toAssetUrl: (filePath) => {
      if (!filePath) return '';
      return convertFileSrc(filePath);
    },
  };
}
