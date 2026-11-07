import React, { Suspense, useState, useEffect, useRef, useMemo, useCallback } from 'react';
import Header from './components/Header';
import Sidebar from './components/Sidebar';
import AssetGrid from './components/AssetGrid';
import { isDragOutActive, dockSlotAt } from './utils/dragOut';
import { loadSavedTheme, rememberTheme, applyTheme } from './utils/themes';
import PathInput from './components/PathInput';
import ShortcutCheatsheet from './components/ShortcutCheatsheet';
import ConnectNetworkModal from './components/ConnectNetworkModal';
import DropErrorModal from './components/DropErrorModal';
import GuideErrorModal from './components/GuideErrorModal';
import DragDropOverlay from './components/DragDropOverlay';
import ItemContextMenu from './components/ItemContextMenu';
import { RenameItemModal, DeleteItemModal } from './components/ItemActionModals';
import FileTransferPanel from './components/FileTransferPanel';
import { useFileTransfers } from './hooks/useFileTransfers';
import { copyText, isRootLocation } from './utils/itemMenu';
import SortMenu from './components/SortMenu';
import FilterDock from './components/FilterDock';
import { useFolderStatus } from './utils/folderStatus';
import { forgetFolderPeek } from './utils/folderPeek';
import { isTextEntryTarget } from './utils/quickLook';
import { FolderIconsContext, useFolderIconStore, normalizeFolderKey } from './utils/folderIconStore';
import {
  EMPTY_LABEL_FILTER,
  collectTags,
  isLabelFilterActive,
  labelFor,
  labelForItems,
  matchesLabelFilter,
  useFileLabelStore
} from './utils/fileLabelStore';
import { FileLabelPopover, LabelFilterMenu } from './components/LabelPanels';
import {
  is3DFormat,
  isHdrFormat,
  isImageFormat,
  isTextureFormat,
  isVideoFormat,
  isAudioFormat,
  isPdfFormat,
  isMarkdownFormat,
  isTxTexFormat,
  isComparableItem,
  getCompareKind
} from './utils/formatHelpers';
import { getParentDir, buildBreadcrumbs } from './utils/pathHelpers';
import { DEFAULT_SORT, sortItems, sortByColumn, loadFolderSort, saveFolderSort } from './utils/sortItems';
import {
  ListingCache,
  createHistory,
  pushEntry,
  stepHistory,
  canStep,
  listingSignature,
  findLeftBehindItem
} from './utils/navHistory';
import { groupImageSequences, sequenceContaining } from './utils/imageSequence';
import { findTextureSet } from './utils/textureSets';
import { parseNetworkError } from './utils/networkErrors';
import { useExternalApps, refreshExternalApps, sendToExternalApp } from './utils/externalAppStore';
import { useQuickLook } from './hooks/useQuickLook';
import { useDebouncedValue } from './hooks/useDebouncedValue';
import { clampGridSize, loadFolderGridSize, loadGlobalGridSize, saveFolderGridSize } from './utils/folderGridSize';
import {
  ImageViewer,
  TxTexViewer,
  ImageSequencePlayer,
  VideoPlayer,
  PdfViewer,
  MarkdownViewer,
  AudioPlayer,
  Viewport3D,
  HdrExrInspector,
  CompareView,
  QuickLookWindow,
  InspectorDrawer,
  SettingsModal,
  BatchConvertModal,
  DuplicateFinderModal,
  TextureSetModal,
  FolderIconPicker,
  PasteConflictModal
} from './components/lazyViewers';
import { ArrowLeft, ArrowUp, ChevronLeft, ChevronRight, ArrowLeftRight, Split, TextCursorInput, LayoutGrid, List, Info } from 'lucide-react';

// How long the search box waits after the last keystroke before the folder is searched again
const SEARCH_DEBOUNCE_MS = 250;

export default function App() {
  const [drives, setDrives] = useState([]);
  const [networkLocations, setNetworkLocations] = useState([]);
  const [recentFolders, setRecentFolders] = useState([]);
  const [isEditingPath, setIsEditingPath] = useState(false);
  const [navError, setNavError] = useState('');
  const [navErrorPath, setNavErrorPath] = useState('');
  // Network sign-in window: null when closed, otherwise the path to prefill
  const [connectDialog, setConnectDialog] = useState(null);
  const [currentPath, setCurrentPath] = useState('');
  const [folderItems, setFolderItems] = useState([]);
  const [parentPath, setParentPath] = useState(null);
  // The focused item (what the viewer, compare and status bar follow) and the paths of the whole selection
  const [selectedAsset, setSingleSelectedAsset] = useState(null);
  const [selectedPaths, setSelectedPaths] = useState(() => new Set());
  // Choosing one item on its own, or navigating, selects just that item
  const setSelectedAsset = (item) => {
    setSingleSelectedAsset(item);
    setSelectedPaths(new Set(item ? [item.path] : []));
  };
  // Ctrl / Shift click, Ctrl + A and box selection set several items at once
  const setSelection = (paths, focus) => {
    setSingleSelectedAsset(focus || null);
    setSelectedPaths(paths);
  };
  const [compareAssetA, setCompareAssetA] = useState(null);
  const [compareAssetB, setCompareAssetB] = useState(null);

  // Drag and Drop Global State
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [dropTargetSlot, setDropTargetSlot] = useState(null); // 'A' or 'B' (in compare mode)
  const [dropError, setDropError] = useState(null);
  const dragCounterRef = useRef(0);
  const lastDropTimeRef = useRef(0);

  // Synchronized refs for stable listener callbacks
  const viewModeRef = useRef('grid');
  const dropTargetSlotRef = useRef(null);
  const compareAssetARef = useRef(null);
  const compareAssetBRef = useRef(null);
  const currentPathRef = useRef('');
  const filterTypeRef = useRef('all');
  const searchTermRef = useRef('');
  const parentPathRef = useRef(null);
  const folderItemsRef = useRef([]);

  // Filter & Search. The box shows every keystroke at once, but the folder is only searched again once typing pauses
  const [searchTerm, setSearchTerm] = useState('');
  const searchInputRef = useRef(null); // the filter box in the header, focused by Ctrl + F
  const debouncedSearchTerm = useDebouncedValue(searchTerm, SEARCH_DEBOUNCE_MS);
  const [filterType, setFilterType] = useState('all'); // 'all', '3d', 'hdr'
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);
  const [favorites, setFavorites] = useState([]);
  // Colour labels and tags, and the filter on them (a file must match every chosen tag and any chosen colour)
  const fileLabels = useFileLabelStore();
  const [labelFilter, setLabelFilter] = useState(EMPTY_LABEL_FILTER);
  const labelTags = useMemo(() => collectTags(fileLabels.labels), [fileLabels.labels]);

  // Views & UI State
  const [viewMode, setViewMode] = useState('grid'); // 'grid', 'studio3d', 'hdrexr', 'image', 'txtex', 'video', 'audio', 'pdf', 'markdown', 'sequence', 'compare'
  const [previewOpen, setPreviewOpen] = useState(false); // the floating Quick Look window, shown over the grid
  const [inspectorOpen, setInspectorOpen] = useState(false); // the file details drawer beside the grid, toggled with I
  const [theme, setTheme] = useState(loadSavedTheme); // colour scheme, see src/utils/themes.js
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  // The settings screen is only loaded once it has been opened, and stays mounted after that
  const settingsSeenRef = useRef(false);
  if (isSettingsOpen) settingsSeenRef.current = true;
  const [guideError, setGuideError] = useState(null);
  const [blenderStatus, setBlenderStatus] = useState(null);
  // Apps the right-click "Send to" menu lists, set up in Settings > External apps
  const externalApps = useExternalApps();
  const [isLoadingDir, setIsLoadingDir] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  // Interface mode: 'simple' (slim rail, clean toolbar) or 'pro' (full sidebar, every filter with counts). Remembered.
  const [uiMode, setUiMode] = useState(() => {
    try {
      return localStorage.getItem('cg_artist_ui_mode') === 'pro' ? 'pro' : 'simple';
    } catch {
      return 'simple';
    }
  });
  const changeUiMode = (mode) => {
    setUiMode(mode);
    try {
      localStorage.setItem('cg_artist_ui_mode', mode);
    } catch {
      /* storage unavailable: the choice just won't be remembered */
    }
  };

  // Interactive Grid Sizing (Ctrl + Mouse Scroll Wheel). Each folder keeps its own size; see utils/folderGridSize.js
  const [gridSize, setGridSize] = useState(loadGlobalGridSize);
  const gridSizeRef = useRef(gridSize);

  // Ctrl + wheel changes the size of the folder on screen (and the global size used by folders with none of their own)
  const handleGridSizeChange = useCallback((change) => {
    const next = clampGridSize(typeof change === 'function' ? change(gridSizeRef.current) : change);
    gridSizeRef.current = next;
    setGridSize(next);
    saveFolderGridSize(currentPathRef.current, next);
  }, []);

  // Folder view: 'icons' (Large icons thumbnail grid, default) or 'details' (Explorer-style list)
  const [folderView, setFolderView] = useState(() => {
    try {
      return localStorage.getItem('cg_artist_folder_view') === 'details' ? 'details' : 'icons';
    } catch {
      return 'icons';
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem('cg_artist_folder_view', folderView);
    } catch {
      /* storage unavailable: the choice just won't be remembered */
    }
  }, [folderView]);

  // Synchronize refs with state for stable event listener callbacks
  viewModeRef.current = viewMode;
  dropTargetSlotRef.current = dropTargetSlot;
  compareAssetARef.current = compareAssetA;
  compareAssetBRef.current = compareAssetB;
  currentPathRef.current = currentPath;
  filterTypeRef.current = filterType;
  searchTermRef.current = debouncedSearchTerm;
  parentPathRef.current = parentPath;
  folderItemsRef.current = folderItems;

  // Sorting (remembered per folder), back / forward history and the listings kept for instant "back"
  const [sort, setSort] = useState({ ...DEFAULT_SORT });
  const [history, setHistory] = useState(createHistory);
  const historyRef = useRef(history);
  const listingCacheRef = useRef(new ListingCache());
  const navSeqRef = useRef(0); // bumped on every folder navigation so a slow, older listing never overwrites a newer one
  const drivesStampRef = useRef(0);


  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const changeTheme = (nextTheme) => {
    setTheme(nextTheme);
    rememberTheme(nextTheme);
  };

  const toggleTheme = () => changeTheme(theme === 'light' ? 'dark' : 'light');

  // Initial load
  useEffect(() => {
    loadDrivesAndInitialDir();
    loadNetworkLocations();
    loadFavorites();
    loadBlenderStatus();
    refreshExternalApps();
  }, []);

  const loadDrivesAndInitialDir = async () => {
    if (window.electronAPI) {
      const driveList = await window.electronAPI.listDrives();
      drivesStampRef.current = Date.now();
      setDrives(driveList);

      // Default to J:\ if present, or first drive
      const initial = driveList.find((d) => d.mount.toUpperCase().startsWith('J')) || driveList[0];
      if (initial) {
        navigateTo(initial.name);
      }
    } else {
      // Mock data for pure browser environment
      setDrives([
        { mount: 'C:', name: 'C:\\', label: 'Windows (C:)', totalGB: 512, freeGB: 210 },
        { mount: 'J:', name: 'J:\\', label: 'CG Projects (J:)', totalGB: 1024, freeGB: 680 }
      ]);
      setFolderItems([
        { name: 'Character_Rig.fbx', path: 'Character_Rig.fbx', isDirectory: false, category: '3d', extension: '.fbx', size: 14500000, modified: Date.now() },
        { name: 'Vehicle_Model.obj', path: 'Vehicle_Model.obj', isDirectory: false, category: '3d', extension: '.obj', size: 8200000, modified: Date.now() },
        { name: 'Studio_Softbox.hdr', path: 'Studio_Softbox.hdr', isDirectory: false, category: 'hdr', extension: '.hdr', size: 24000000, modified: Date.now() },
        { name: 'City_Sunset.exr', path: 'City_Sunset.exr', isDirectory: false, category: 'hdr', extension: '.exr', size: 48000000, modified: Date.now() }
      ]);
      setCurrentPath('J:\\Local_WebFileBrowser');
    }
  };

  // Re-reads the drive list only (picks up newly mapped network drives) without leaving the current folder
  const refreshDrives = async () => {
    if (window.electronAPI) {
      setDrives(await window.electronAPI.listDrives());
      loadNetworkLocations();
    }
  };

  const loadNetworkLocations = async () => {
    if (window.electronAPI?.getNetworkLocations) {
      setNetworkLocations((await window.electronAPI.getNetworkLocations()) || []);
    }
  };

  const handleRemoveNetworkLocation = async (path) => {
    const next = await window.electronAPI.removeNetworkLocation(path);
    setNetworkLocations(next || []);
  };

  // The backend records a folder when it is read, so the list is re-read each time the folder changes
  useEffect(() => {
    loadRecentFolders();
  }, [currentPath]);

  const loadRecentFolders = async () => {
    if (window.electronAPI?.getRecentFolders) {
      setRecentFolders((await window.electronAPI.getRecentFolders()) || []);
    }
  };

  const handleClearRecentFolders = async () => {
    await window.electronAPI.clearRecentFolders();
    setRecentFolders([]);
  };

  // Signs in to a share from the "Connect to network folder" window, then opens it.
  // Throws the reason when Windows refuses, which the window shows under the fields.
  const handleConnectNetwork = async ({ path, username, password, remember }) => {
    const resolved = await window.electronAPI.connectNetwork(path, username, password, remember);
    setConnectDialog(null);
    setIsEditingPath(false);
    setNavError('');
    loadNetworkLocations();
    navigateTo(resolved.path, !resolved.isDirectory);
  };

  // Address bar: accepts J:\Assets, \\mypc\library and //mypc/library. Returns an error message, or nothing on success.
  const submitTypedPath = async (text) => {
    try {
      const resolved = await window.electronAPI.resolvePath(text);
      loadNetworkLocations();
      setIsEditingPath(false);
      navigateTo(resolved.path, !resolved.isDirectory);
      return '';
    } catch (err) {
      return String(err?.message || err);
    }
  };

  // Ctrl+L / Alt+D: jump to the address box like File Explorer
  useEffect(() => {
    const onKeyDown = (e) => {
      const key = e.key?.toLowerCase();
      if (((e.ctrlKey || e.metaKey) && key === 'l') || (e.altKey && key === 'd')) {
        e.preventDefault();
        setIsEditingPath(true);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const loadFavorites = async () => {
    if (window.electronAPI) {
      const favs = await window.electronAPI.getFavorites();
      setFavorites(favs || []);
    }
  };

  const loadBlenderStatus = async () => {
    if (window.electronAPI) {
      const status = await window.electronAPI.getBlenderStatus();
      setBlenderStatus(status);
    }
  };

  const updateHistory = (next) => {
    historyRef.current = next;
    setHistory(next);
  };

  // Lists a folder with the current filter and search, and keeps the result for instant back / forward
  const fetchListing = async (dirPath) => {
    const filter = filterTypeRef.current === 'all' ? 'all' : filterTypeRef.current;
    const search = searchTermRef.current;
    const res = await window.electronAPI.readDirectory(dirPath, { filter, search });
    if (res && !res.error && res.currentPath) {
      listingCacheRef.current.set(res.currentPath, filter, search, res);
    }
    return res;
  };

  // The per-folder view choices (sort and thumbnail size) of the folder being shown
  const applyFolderView = (path) => {
    setSort(loadFolderSort(path));
    const size = loadFolderGridSize(path);
    gridSizeRef.current = size;
    setGridSize(size);
  };

  // Shows a folder listing and picks that folder's remembered sort and size. `record: false` is for back / forward,
  // which move through the history instead of adding to it.
  const showListing = (res, { record = true } = {}) => {
    setCurrentPath(res.currentPath);
    setParentPath(res.parentPath);
    setFolderItems(res.items || []);
    applyFolderView(res.currentPath);
    if (record) updateHistory(pushEntry(historyRef.current, res.currentPath));
  };

  // After opening a folder the selection is cleared, except when going up to a folder that contains the one just
  // left: that one is highlighted so the arrow keys carry on from there, like File Explorer.
  const selectAfterNavigation = (items, leavingPath, newPath) => {
    if (normalizeFolderKey(leavingPath) === normalizeFolderKey(newPath)) return;
    setSelectedAsset(findLeftBehindItem(items, leavingPath, newPath));
  };

  // `fromHistory` (back / forward): the cached listing is shown at once and refreshed behind the scenes.
  const navigateTo = async (targetPath, openDirectly = false, { fromHistory = false, previousHistory = null } = {}) => {
    if (!window.electronAPI) return;

    if (openDirectly) {
      // It's a file
      const ext = targetPath.slice(targetPath.lastIndexOf('.')).toLowerCase();
      let cat = '3d';
      if (['.hdr', '.exr'].includes(ext)) {
        cat = 'hdr';
      } else if (['.tif', '.tiff', '.tga', '.dds', '.psd', '.tx', '.tex'].includes(ext)) {
        cat = 'texture';
      } else if (['.png', '.jpg', '.jpeg', '.webp', '.bmp'].includes(ext)) {
        cat = 'image';
      } else if (['.mp4', '.webm', '.mov', '.mkv', '.avi'].includes(ext)) {
        cat = 'video';
      } else if (['.wav', '.mp3', '.ogg', '.flac', '.aac', '.aiff', '.m4a'].includes(ext)) {
        cat = 'audio';
      } else if (ext === '.pdf') {
        cat = 'pdf';
      } else if (isMarkdownFormat(ext)) {
        cat = 'markdown';
      }

      const item = {
        name: targetPath.split(/[/\\]/).pop(),
        path: targetPath,
        isDirectory: false,
        category: cat,
        extension: ext
      };

      const parentDir = getParentDir(targetPath);
      if (parentDir && parentDir !== currentPath) {
        fetchListing(parentDir).then((res) => {
          if (res && !res.error) showListing(res);
        });
      }

      openAsset(item);
      return;
    }

    // Opening a folder from anywhere (sidebar, pinned, drives, breadcrumbs) closes any open viewer
    setViewMode('grid');
    setNavError('');
    setNavErrorPath('');
    const seq = ++navSeqRef.current;
    const leaving = {
      path: currentPathRef.current,
      parentPath: parentPathRef.current,
      items: folderItemsRef.current
    };

    let shownFromCache = false;
    let cachedSignature = '';
    if (fromHistory) {
      const cached = listingCacheRef.current.get(targetPath, filterTypeRef.current, searchTermRef.current);
      if (cached) {
        shownFromCache = true;
        cachedSignature = listingSignature(cached.items || []);
        showListing(cached, { record: false });
        selectAfterNavigation(cached.items || [], leaving.path, cached.currentPath);
      }
    }
    setIsLoadingDir(!shownFromCache);

    try {
      const res = await fetchListing(targetPath);
      if (seq !== navSeqRef.current) return; // a newer navigation took over while this one was loading

      if (res && !res.error) {
        const unchanged = shownFromCache && listingSignature(res.items || []) === cachedSignature;
        if (!unchanged) {
          showListing(res, { record: !fromHistory });
          selectAfterNavigation(res.items || [], leaving.path, res.currentPath);
        } else if (!fromHistory) {
          updateHistory(pushEntry(historyRef.current, res.currentPath));
        }
      }
    } catch (err) {
      if (seq !== navSeqRef.current) return;
      // Unreachable drive or share: say why instead of leaving the bar on "Scanning directory..."
      setNavError(String(err?.message || err));
      setNavErrorPath(targetPath);
      if (fromHistory) {
        // The folder is gone or unreachable: stay where we were and keep the history as it was
        if (previousHistory) updateHistory(previousHistory);
        if (shownFromCache) {
          setCurrentPath(leaving.path);
          setParentPath(leaving.parentPath);
          setFolderItems(leaving.items);
          applyFolderView(leaving.path);
        }
      }
    } finally {
      if (seq === navSeqRef.current) setIsLoadingDir(false);
    }
  };

  // Back (-1) and forward (+1) through the folders visited
  const goHistory = (delta) => {
    const before = historyRef.current;
    const step = stepHistory(before, delta);
    if (!step) return;
    updateHistory(step.history);
    navigateTo(step.path, false, { fromHistory: true, previousHistory: before });
  };

  const goUp = () => {
    if (parentPathRef.current) navigateTo(parentPathRef.current);
  };

  // Reloads the open folder where it is (F5, Ctrl+R and the header button). The folder, the selection, the scroll
  // position, the sort, the thumbnail size and the filters all stay as they are. When the folder has gone, the
  // nearest parent that still exists is shown instead, and the bar says so.
  const refreshFolder = async () => {
    if (!window.electronAPI || !currentPathRef.current) return;
    const seq = navSeqRef.current;
    const startPath = currentPathRef.current;
    // Folder tiles show what is inside them now
    forgetFolderPeek();
    setIsRefreshing(true);
    try {
      let target = startPath;
      let res = null;
      let firstError = '';
      while (target) {
        try {
          res = await fetchListing(target);
        } catch (err) {
          res = { error: String(err?.message || err) };
        }
        if (seq !== navSeqRef.current) return; // a folder was opened while this was reading: that listing wins
        if (res && !res.error) break;
        firstError = firstError || res?.error || 'The folder could not be read';
        res = null;
        // A share that does not answer or needs a sign-in is still there, so its parent folders would not help
        if (parseNetworkError(firstError).needsSignIn || /did not answer within/.test(firstError)) break;
        target = getParentDir(target);
      }

      if (!res) {
        // Nothing from the folder up to the drive or share can be read: keep the listing on screen and say why
        setNavError(firstError);
        setNavErrorPath(startPath);
      } else if (target === startPath) {
        setParentPath(res.parentPath);
        setFolderItems(res.items || []);
        if (navErrorPath === startPath) {
          setNavError('');
          setNavErrorPath('');
        }
      } else {
        // The folder is gone: show the nearest parent that still exists, as if the user had gone up to it
        updateHistory(pushEntry(historyRef.current, res.currentPath));
        showListing(res, { record: false });
        selectAfterNavigation(res.items || [], startPath, res.currentPath);
        setNavError(`${startPath} is no longer there, so ${res.currentPath} is shown`);
        setNavErrorPath('');
      }
    } finally {
      setIsRefreshing(false);
    }
  };

  // F5 and Ctrl+R reload the folder in place. Left alone, the webview reloads the whole app, which starts again at the
  // default drive and loses the folder that was open.
  const refreshFolderRef = useRef(refreshFolder);
  refreshFolderRef.current = refreshFolder;
  useEffect(() => {
    const onKeyDown = (e) => {
      const isRefreshKey = e.key === 'F5' || ((e.ctrlKey || e.metaKey) && !e.altKey && e.key?.toLowerCase() === 'r');
      if (!isRefreshKey) return;
      e.preventDefault();
      refreshFolderRef.current();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Re-fetch when the (debounced) search or filter changes
  useEffect(() => {
    if (!currentPath || !window.electronAPI) return undefined;
    let stale = false;
    const seq = navSeqRef.current;
    fetchListing(currentPath)
      .then((res) => {
        if (!stale && seq === navSeqRef.current && res && !res.error) {
          setFolderItems(res.items || []);
        }
      })
      .catch(() => {});
    return () => {
      stale = true;
    };
  }, [debouncedSearchTerm, filterType]);

  // Alt+Left / Alt+Right and the mouse's back / forward buttons walk the folder history
  const goHistoryRef = useRef(goHistory);
  goHistoryRef.current = goHistory;
  const windowOpenRef = useRef(false); // kept up to date below, once every window's state exists
  useEffect(() => {
    const onKeyDown = (e) => {
      if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || windowOpenRef.current) return;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        goHistoryRef.current(e.key === 'ArrowLeft' ? -1 : 1);
      }
    };
    const onMouseUp = (e) => {
      if ((e.button !== 3 && e.button !== 4) || windowOpenRef.current) return;
      e.preventDefault();
      goHistoryRef.current(e.button === 3 ? -1 : 1);
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, []);

  // I shows or hides the Inspector beside the folder grid. The viewers have their own I, so it only works in the grid
  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.key?.toLowerCase() !== 'i' || e.ctrlKey || e.altKey || e.metaKey || e.repeat) return;
      if (viewModeRef.current !== 'grid' || windowOpenRef.current || isTextEntryTarget(e.target)) return;
      e.preventDefault();
      setInspectorOpen((open) => !open);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Help: opens the built-in user guide in the default browser; the error window explains if the browser cannot be started
  const handleOpenGuide = async () => {
    const res = await window.electronAPI?.openUserGuide?.();
    if (res && !res.ok) setGuideError(res.error || 'The user guide could not be opened.');
  };

  const handleOpenFolderPicker = async () => {
    if (!window.electronAPI) return;
    const folder = await window.electronAPI.openFolderDialog(currentPath);
    if (folder) {
      navigateTo(folder);
    }
  };

  const handleToggleFavorite = async (item) => {
    if (!window.electronAPI) return;
    const updated = await window.electronAPI.toggleFavorite(item);
    setFavorites(updated);
  };

  const handleRevealInExplorer = (filePath) => {
    if (window.electronAPI) {
      window.electronAPI.showInFolder(filePath);
    }
  };

  const handleOpenExternal = (item) => {
    if (window.electronAPI) {
      window.electronAPI.openExternal(item.path);
    }
  };

  // Right-click "Send to": opens the selected files in an app from Settings > External apps
  const handleSendToApp = async (items, app) => {
    const res = await sendToExternalApp(app, items.map((item) => item.path));
    if (!res.ok) {
      window.electronAPI?.showError(res.error, `Send to ${app.name}`);
    }
  };

  const handleCopyPaths = (items) => {
    copyText(items.map((item) => item.path).join('\n'));
  };

  // Lists the open folder again after a rename or delete
  // Resolves the new items, or null when the folder could not be read or another folder was opened meanwhile
  const refreshCurrentFolder = async () => {
    const path = currentPath;
    const res = await fetchListing(path);
    if (currentPathRef.current !== path || !res || res.error) return null;
    setFolderItems(res.items || []);
    return res.items || [];
  };

  // Rename: resolves to an error message for the dialog, or to null when it worked.
  // The viewer, the compare slots, the favorites and a folder's custom icon follow the item to its new path.
  const handleRenameItem = async (item, newName) => {
    const res = await window.electronAPI.renameItem(item.path, newName);
    if (!res.ok) return res.error;
    const renamed = { ...item, name: newName, path: res.path };
    const isItem = (other) => other && other.path === item.path;
    setSelectedAsset((prev) => (isItem(prev) ? renamed : prev));
    setCompareAssetA((prev) => (isItem(prev) ? renamed : prev));
    setCompareAssetB((prev) => (isItem(prev) ? renamed : prev));
    if (favorites.some((f) => f.path === item.path)) {
      await handleToggleFavorite(item);
      await handleToggleFavorite(renamed);
    }
    // A custom folder icon follows the folder to its new name
    const iconId = item.isDirectory ? folderIconStore.assignments[normalizeFolderKey(item.path)] : null;
    if (iconId) {
      await folderIconStore.setIcon(renamed.path, iconId);
      await folderIconStore.resetIcon(item.path);
    }
    setItemAction(null);
    await refreshCurrentFolder();
    return null;
  };

  // Delete (to the Recycle Bin, or for good with Shift + Delete): stops at the first failure and reports it to the dialog
  const handleDeleteItems = async (items, permanent = false) => {
    for (const item of items) {
      const res = permanent
        ? await window.electronAPI.deleteItemPermanently(item.path)
        : await window.electronAPI.deleteItem(item.path);
      if (!res.ok) {
        await refreshCurrentFolder();
        return res.error;
      }
      const isItem = (other) => other && other.path === item.path;
      setSelectedAsset((prev) => (isItem(prev) ? null : prev));
      setCompareAssetA((prev) => (isItem(prev) ? null : prev));
      setCompareAssetB((prev) => (isItem(prev) ? null : prev));
      if (favorites.some((f) => f.path === item.path)) {
        await handleToggleFavorite(item);
      }
    }
    setItemAction(null);
    await refreshCurrentFolder();
    return null;
  };

  // ---- Copy, cut, paste and New folder ----
  // Cut and Copy put the files on the clipboard (shared with File Explorer on Windows); Paste copies or moves them into the
  // open folder in the background, with progress in the corner (src-tauri/src/file_ops.rs does the work).
  const [cutPaths, setCutPaths] = useState(() => new Set()); // the items cut here, shown dimmed until they are pasted
  const [pasteConflict, setPasteConflict] = useState(null); // { items, destDir, mode, names } while the user chooses
  const samePlace = (a, b) => {
    const norm = (p) => String(p || '').replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase();
    return norm(a) === norm(b);
  };
  const baseName = (path) => String(path || '').split(/[\\/]/).filter(Boolean).pop() || String(path || '');

  // A moved item keeps its favorite star and its custom folder icon, and leaves the compare slots, as when it is renamed
  const followMovedItems = async (rows) => {
    for (const row of rows) {
      const isMoved = (other) => other && other.path === row.path;
      setCompareAssetA((prev) => (isMoved(prev) ? null : prev));
      setCompareAssetB((prev) => (isMoved(prev) ? null : prev));
      const favorite = favorites.find((f) => f.path === row.path);
      if (favorite) {
        await handleToggleFavorite(favorite);
        await handleToggleFavorite({ ...favorite, path: row.outPath, name: baseName(row.outPath) });
      }
      const iconId = folderIconStore.assignments[normalizeFolderKey(row.path)];
      if (iconId) {
        await folderIconStore.setIcon(row.outPath, iconId);
        await folderIconStore.resetIcon(row.path);
      }
    }
  };

  // A paste has ended: the open folder is read again when it was the source or the target, and the pasted items are selected
  const handleTransferFinished = async (job) => {
    const done = job.rows.filter((row) => row.status === 'done' && row.outPath);
    if (job.mode === 'move') await followMovedItems(done.filter((row) => !samePlace(row.path, row.outPath)));
    const here = currentPathRef.current;
    const touchesHere = samePlace(job.destDir, here) || job.rows.some((row) => samePlace(getParentDir(row.path), here));
    if (!touchesHere) return;
    const items = await refreshCurrentFolder();
    if (!items || !samePlace(job.destDir, currentPathRef.current)) return;
    const picked = items.filter((item) => done.some((row) => samePlace(row.outPath, item.path)));
    if (picked.length) setSelection(new Set(picked.map((item) => item.path)), picked[0]);
  };
  const transfers = useFileTransfers({ onFinished: handleTransferFinished });

  const putOnClipboard = async (items, cut) => {
    const usable = items.filter((item) => !item.isSequence && !isRootLocation(item.path));
    if (!usable.length || !window.electronAPI) return;
    const res = await window.electronAPI.setClipboardFiles(usable.map((item) => item.path), cut);
    if (!res.ok) {
      window.electronAPI.showError(res.error, cut ? 'Cut' : 'Copy');
      return;
    }
    setCutPaths(cut ? new Set(usable.map((item) => item.path)) : new Set());
  };

  const beginTransfer = async (items, destDir, mode, replace) => {
    const error = await transfers.start(items, destDir, mode, replace);
    if (error) {
      window.electronAPI.showError(error, 'Paste');
      return;
    }
    // A cut is pasted once, as in File Explorer
    if (mode === 'move') {
      setCutPaths(new Set());
      window.electronAPI.clearClipboardFiles();
    }
  };

  // `explicit` is a click on Paste in the menu: it says so when there is nothing to paste, where Ctrl + V stays quiet
  const pasteIntoOpenFolder = async (explicit = false) => {
    const destDir = currentPathRef.current;
    if (!destDir || !window.electronAPI) return;
    const got = await window.electronAPI.getClipboardFiles();
    if (!got.ok) {
      window.electronAPI.showError(got.error, 'Paste');
      return;
    }
    const paths = got.files?.paths || [];
    if (!paths.length) {
      if (explicit) transfers.notify('There are no copied files to paste.');
      return;
    }
    const mode = got.files.cut ? 'move' : 'copy';
    const check = await window.electronAPI.checkFileTransfer(paths, destDir, mode);
    if (!check.ok) {
      window.electronAPI.showError(check.error, 'Paste');
      return;
    }
    if (!check.actionable) {
      // Cutting items into the folder they are already in changes nothing
      if (mode === 'move') {
        setCutPaths(new Set());
        window.electronAPI.clearClipboardFiles();
      }
      return;
    }
    const items = paths.map((path) => ({ path, name: baseName(path) }));
    if (check.conflicts.length) {
      setPasteConflict({ items, destDir, mode, names: check.conflicts });
    } else {
      beginTransfer(items, destDir, mode, false);
    }
  };

  // New folder: made in the open folder, selected, and opened for naming
  const createFolderHere = async () => {
    const parent = currentPathRef.current;
    if (!parent || !window.electronAPI) return;
    const res = await window.electronAPI.createFolder(parent);
    if (!res.ok) {
      window.electronAPI.showError(res.error, 'New folder');
      return;
    }
    const items = await refreshCurrentFolder();
    const made = items?.find((item) => samePlace(item.path, res.path));
    if (!made) return;
    setSelection(new Set([made.path]), made);
    setItemAction({ type: 'rename', items: [made] });
  };

  const openAsset = (item) => {
    setSelectedAsset(item);
    if (item.isSequence) {
      setViewMode('sequence');
    } else if (item.category === '3d') {
      setViewMode('studio3d');
    } else if (item.category === 'hdr') {
      setViewMode('hdrexr');
    } else if (item.category === 'texture' && isTxTexFormat(item.extension)) {
      setViewMode('txtex');
    } else if (item.category === 'image' || item.category === 'texture') {
      setViewMode('image');
    } else if (item.category === 'video') {
      setViewMode('video');
    } else if (item.category === 'audio') {
      setViewMode('audio');
    } else if (item.category === 'pdf') {
      setViewMode('pdf');
    } else if (item.category === 'markdown') {
      setViewMode('markdown');
    }
  };

  const handleSetCompareA = (item) => {
    if (isComparableItem(item)) {
      setCompareAssetA(item);
    }
  };

  const handleSetCompareB = (item) => {
    if (isComparableItem(item)) {
      setCompareAssetB(item);
    }
  };

  const handleSwapCompareSlots = () => {
    const temp = compareAssetA;
    setCompareAssetA(compareAssetB);
    setCompareAssetB(temp);
  };

  const handleClearCompareSlots = () => {
    setCompareAssetA(null);
    setCompareAssetB(null);
  };

  const handleAddToCompare = (item) => {
    if (!isComparableItem(item)) return;
    if (!compareAssetA) {
      setCompareAssetA(item);
    } else if (!compareAssetB) {
      setCompareAssetB(item);
      setViewMode('compare');
    } else {
      setCompareAssetA(item);
      setViewMode('compare');
    }
  };

  // Helper to resolve details of a dropped File object or path string
  const resolveFileItem = async (fileOrPath) => {
    let filePath = '';
    let fileName = '';

    if (typeof fileOrPath === 'string') {
      filePath = fileOrPath;
      fileName = filePath.split(/[/\\]/).pop() || 'Unknown File';
    } else if (fileOrPath && typeof fileOrPath === 'object') {
      // If already a resolved item (e.g. from internal grid drag)
      if (fileOrPath.category && fileOrPath.path) {
        return fileOrPath;
      }
      filePath = window.electronAPI?.getPathForFile
        ? window.electronAPI.getPathForFile(fileOrPath)
        : fileOrPath.path;
      fileName = fileOrPath.name || (filePath ? filePath.split(/[/\\]/).pop() : 'Unknown File');
    }

    if (filePath && window.electronAPI?.getItemDetails) {
      try {
        const details = await window.electronAPI.getItemDetails(filePath);
        if (details && !details.error) {
          return {
            ...details,
            name: details.name || fileName
          };
        }
      } catch (err) {
        console.warn('Failed to retrieve item details:', filePath, err);
      }
    }

    const name = fileName || 'Unknown File';
    const ext = name.includes('.') ? name.slice(name.lastIndexOf('.')).toLowerCase() : '';
    let cat = 'other';
    if (is3DFormat(ext)) {
      cat = '3d';
    } else if (isHdrFormat(ext)) {
      cat = 'hdr';
    } else if (isTextureFormat(ext)) {
      cat = 'texture';
    } else if (isImageFormat(ext)) {
      cat = 'image';
    } else if (isVideoFormat(ext)) {
      cat = 'video';
    } else if (isAudioFormat(ext)) {
      cat = 'audio';
    } else if (isPdfFormat(ext)) {
      cat = 'pdf';
    } else if (isMarkdownFormat(ext)) {
      cat = 'markdown';
    }

    return {
      name,
      path: filePath || name,
      isDirectory: (typeof fileOrPath === 'object' && fileOrPath.isDirectory) || (!ext && !name.includes('.')),
      category: cat,
      extension: ext,
      size: (typeof fileOrPath === 'object' && fileOrPath.size) || 0,
      modified: (typeof fileOrPath === 'object' && fileOrPath.lastModified) || Date.now()
    };
  };

  // Process dropped items with smart auto-switching across all viewers
  const handleProcessDroppedFiles = async (droppedFiles, slot) => {
    if (!droppedFiles || droppedFiles.length === 0) return;

    const resolvedItems = [];
    for (const f of droppedFiles) {
      const item = await resolveFileItem(f);
      if (item) resolvedItems.push(item);
    }

    if (resolvedItems.length === 0) return;

    const firstItem = resolvedItems[0];

    // Case 1: Folder dropped anywhere -> navigate into that directory
    if (firstItem.isDirectory) {
      navigateTo(firstItem.path);
      setViewMode('grid');
      return;
    }

    // Also populate folder items if file is from a different folder
    const parentDir = getParentDir(firstItem.path);
    if (parentDir && parentDir !== currentPathRef.current && window.electronAPI?.readDirectory) {
      fetchListing(parentDir).then((res) => {
        if (res && !res.error && res.items) showListing(res);
      });
    }

    // Case 2: Two files dropped simultaneously -> launch compare view directly if both are comparable images
    if (resolvedItems.length >= 2) {
      const kindOfFirst = getCompareKind(resolvedItems[0]);
      if (kindOfFirst && kindOfFirst === getCompareKind(resolvedItems[1])) {
        setCompareAssetA(resolvedItems[0]);
        setCompareAssetB(resolvedItems[1]);
        setViewMode('compare');
        return;
      }
    }

    // Case 3: Dropped in Compare view - Slot targeting for comparable images only
    if (viewModeRef.current === 'compare') {
      if (isComparableItem(firstItem)) {
        if (slot === 'B') {
          setCompareAssetB(firstItem);
        } else if (slot === 'A') {
          setCompareAssetA(firstItem);
        } else {
          // Default: set A if empty, else set B
          if (!compareAssetARef.current) {
            setCompareAssetA(firstItem);
          } else {
            setCompareAssetB(firstItem);
          }
        }
        return;
      }
      // If a non-image file (e.g. 3D model, HDR/EXR, video, audio) is dropped in compare mode, seamlessly switch below!
    }

    // Smart Auto-Switching: regardless of current viewer (3D, HDR, Image, Video, Audio, Grid),
    // automatically open the dropped file in its dedicated viewer without erroring!
    if (firstItem.isSequence) {
      setSelectedAsset(firstItem);
      setViewMode('sequence');
    } else if (firstItem.category === '3d') {
      setSelectedAsset(firstItem);
      setViewMode('studio3d');
    } else if (firstItem.category === 'hdr') {
      setSelectedAsset(firstItem);
      setViewMode('hdrexr');
    } else if (firstItem.category === 'texture' && isTxTexFormat(firstItem.extension)) {
      setSelectedAsset(firstItem);
      setViewMode('txtex');
    } else if (['image', 'texture'].includes(firstItem.category)) {
      setSelectedAsset(firstItem);
      setViewMode('image');
    } else if (firstItem.category === 'video') {
      setSelectedAsset(firstItem);
      setViewMode('video');
    } else if (firstItem.category === 'audio') {
      setSelectedAsset(firstItem);
      setViewMode('audio');
    } else if (firstItem.category === 'pdf') {
      setSelectedAsset(firstItem);
      setViewMode('pdf');
    } else if (firstItem.category === 'markdown') {
      setSelectedAsset(firstItem);
      setViewMode('markdown');
    } else {
      // Truly unsupported non-media file (e.g. .exe, .zip, .dll, etc.)
      setDropError({
        fileName: firstItem.name,
        currentViewerTitle: 'Universal Media Viewport',
        expectedTypes: 'Supported: 3D Models (.obj, .fbx, .gltf, .glb, .stl, .ply, .usd, .abc), HDR/EXR Maps (.hdr, .exr), Images (.png, .jpg, .webp, .tif, .tga), Render textures (.tx, .tex), Videos (.mp4, .mov, .webm), Audio (.wav, .mp3, .ogg, .flac), PDF Documents (.pdf), Markdown (.md)',
        suggestedViewer: null,
        fileItem: firstItem
      });
    }
  };

  // Native Tauri window drag & drop listener
  useEffect(() => {
    if (!window.electronAPI?.onDragDrop) return;

    let unlistenFn = null;
    let isSubscribed = true;

    window.electronAPI.onDragDrop((payload) => {
      if (!isSubscribed || !payload) return;

      if (payload.type === 'enter') {
        setIsDraggingOver(!isDragOutActive());
        if (viewModeRef.current === 'compare' && payload.position) {
          const scale = window.devicePixelRatio || 1;
          const clientX = payload.position.x / scale;
          const slot = clientX < window.innerWidth / 2 ? 'A' : 'B';
          setDropTargetSlot(slot);
        } else {
          setDropTargetSlot(null);
        }
      } else if (payload.type === 'over') {
        setIsDraggingOver(!isDragOutActive());
        if (viewModeRef.current === 'compare' && payload.position) {
          const scale = window.devicePixelRatio || 1;
          const clientX = payload.position.x / scale;
          const slot = clientX < window.innerWidth / 2 ? 'A' : 'B';
          setDropTargetSlot(slot);
        } else {
          setDropTargetSlot(null);
        }
      } else if (payload.type === 'drop') {
        setIsDraggingOver(false);
        let slot = dropTargetSlotRef.current;
        if (viewModeRef.current === 'compare' && payload.position) {
          const scale = window.devicePixelRatio || 1;
          const clientX = payload.position.x / scale;
          slot = clientX < window.innerWidth / 2 ? 'A' : 'B';
        }
        setDropTargetSlot(null);

        if (payload.paths && payload.paths.length > 0) {
          lastDropTimeRef.current = Date.now();
          // One of our own cards dragged out and dropped back on a compare dock slot
          const dockSlot = isDragOutActive() ? dockSlotAt(payload.position) : null;
          if (dockSlot) {
            resolveFileItem(payload.paths[0]).then((item) => {
              if (item && isComparableItem(item)) {
                (dockSlot === 'A' ? setCompareAssetA : setCompareAssetB)(item);
              }
            });
          } else {
            handleProcessDroppedFiles(payload.paths, slot);
          }
        }
      } else if (payload.type === 'leave') {
        setIsDraggingOver(false);
        setDropTargetSlot(null);
      }
    }).then((fn) => {
      if (isSubscribed) {
        unlistenFn = fn;
      } else if (typeof fn === 'function') {
        fn();
      }
    });

    return () => {
      isSubscribed = false;
      if (typeof unlistenFn === 'function') {
        unlistenFn();
      }
    };
  }, []);

  // HTML5 window-level drag & drop listeners (Electron & browser fallback)
  useEffect(() => {
    const handleDragEnter = (e) => {
      e.preventDefault();
      dragCounterRef.current += 1;
      if (e.dataTransfer && e.dataTransfer.types && Array.from(e.dataTransfer.types).includes('Files')) {
        setIsDraggingOver(true);
      }
    };

    const handleDragOver = (e) => {
      e.preventDefault();
      if (e.dataTransfer) {
        e.dataTransfer.dropEffect = 'copy';
      }

      if (viewModeRef.current === 'compare') {
        const slot = e.clientX < window.innerWidth / 2 ? 'A' : 'B';
        setDropTargetSlot(slot);
      } else {
        setDropTargetSlot(null);
      }
    };

    const handleDragLeave = (e) => {
      e.preventDefault();
      dragCounterRef.current -= 1;
      if (dragCounterRef.current <= 0) {
        dragCounterRef.current = 0;
        setIsDraggingOver(false);
        setDropTargetSlot(null);
      }
    };

    const handleDrop = async (e) => {
      e.preventDefault();
      dragCounterRef.current = 0;
      setIsDraggingOver(false);

      if (Date.now() - lastDropTimeRef.current < 400) return;
      lastDropTimeRef.current = Date.now();

      const slot = dropTargetSlotRef.current || (e.clientX < window.innerWidth / 2 ? 'A' : 'B');
      setDropTargetSlot(null);

      if (!e.dataTransfer?.files || e.dataTransfer.files.length === 0) {
        const jsonStr = e.dataTransfer?.getData('application/json');
        if (jsonStr) {
          try {
            const item = JSON.parse(jsonStr);
            if (item) {
              handleProcessDroppedFiles([item], slot);
              return;
            }
          } catch (_) {}
        }
        return;
      }

      const files = Array.from(e.dataTransfer.files);
      await handleProcessDroppedFiles(files, slot);
    };

    window.addEventListener('dragenter', handleDragEnter);
    window.addEventListener('dragover', handleDragOver);
    window.addEventListener('dragleave', handleDragLeave);
    window.addEventListener('drop', handleDrop);

    return () => {
      window.removeEventListener('dragenter', handleDragEnter);
      window.removeEventListener('dragover', handleDragOver);
      window.removeEventListener('dragleave', handleDragLeave);
      window.removeEventListener('drop', handleDrop);
    };
  }, []);

  // Folder icons: the user's picks and the "Change icon" dialog
  const folderIconStore = useFolderIconStore();
  const [iconPickerItem, setIconPickerItem] = useState(null);
  // Right-click menu for files and folders (grid card, details row, sidebar). Its entries come from utils/itemMenu.js.
  // From the grid and details view it acts on the whole selection when the item clicked is part of it, like Explorer.
  const [itemMenu, setItemMenu] = useState(null); // { x, y, item, useSelection }
  const [itemAction, setItemAction] = useState(null); // { type: 'rename' | 'delete', items }
  const [convertItems, setConvertItems] = useState(null); // the images picked for right-click "Convert..."
  const [duplicateFolder, setDuplicateFolder] = useState(null); // { path, name } for right-click "Find duplicates..."
  const [labelEditor, setLabelEditor] = useState(null); // { items, anchor } for "Colour and tags" opened from a menu
  const [textureSet, setTextureSet] = useState(null); // { base, maps } for "View as texture set" opened from a menu
  const openItemMenu = useCallback((e, item, useSelection = false) => {
    e.preventDefault();
    setItemMenu({ x: e.clientX, y: e.clientY, item, useSelection });
  }, []);
  // Right-click on the empty space of the grid: the folder menu (Refresh) instead of an item's menu
  const openFolderMenu = useCallback((e) => {
    e.preventDefault();
    setItemMenu({ x: e.clientX, y: e.clientY, item: null, useSelection: false, background: true });
  }, []);
  const folderIconsValue = useMemo(
    () => ({
      assignments: folderIconStore.assignments,
      customUrls: folderIconStore.customUrls,
      openMenu: openItemMenu
    }),
    [folderIconStore.assignments, folderIconStore.customUrls, openItemMenu]
  );

  // Any window or menu on top of the folder view: the keyboard shortcuts for the folder stay out of its way
  const isWindowOpen = isSettingsOpen || !!connectDialog || !!dropError || !!iconPickerItem || !!itemMenu || !!itemAction || !!convertItems || !!duplicateFolder || !!labelEditor || !!textureSet || !!guideError || !!pasteConflict;
  windowOpenRef.current = isWindowOpen;

  // Every file is shown on its own. A numbered series is folded into one item only for "Play as sequence" (and the player's
  // previous / next, which step through the sequences in the folder)
  const sequenceGroups = useMemo(() => groupImageSequences(folderItems), [folderItems]);
  const sequenceFor = (item) => sequenceContaining(sequenceGroups, item);

  // Filter and sort items for display
  // How many files of each kind the open folder holds. A filtered listing only knows the kind it is filtered to.
  const kindCounts = useMemo(() => {
    const files = folderItems.filter((item) => !item.isDirectory);
    if (filterType !== 'all') return { [filterType]: files.length };
    const counts = { all: files.length, '3d': 0, hdr: 0, image: 0, texture: 0, video: 0, audio: 0, pdf: 0, markdown: 0 };
    for (const item of files) {
      if (item.category in counts) counts[item.category] += 1;
    }
    return counts;
  }, [folderItems, filterType]);

  const displayedItems = useMemo(() => {
    const favoritesOnly = showFavoritesOnly ? folderItems.filter((item) => favorites.some((f) => f.path === item.path)) : folderItems;
    // Folders always stay in view so the label filter never hides the way to the files
    const visible = isLabelFilterActive(labelFilter)
      ? favoritesOnly.filter((item) => item.isDirectory || matchesLabelFilter(labelFor(fileLabels.labels, item.path), labelFilter))
      : favoritesOnly;
    return sortItems(visible, sort);
  }, [folderItems, showFavoritesOnly, favorites, sort, labelFilter, fileLabels.labels]);

  // What the open right-click menu acts on: the whole selection when its item is part of a multi-selection
  const itemMenuItems = (() => {
    if (!itemMenu || itemMenu.background) return [];
    const { item, useSelection } = itemMenu;
    if (!useSelection || !selectedPaths.has(item.path)) return [item];
    const picked = displayedItems.filter((d) => selectedPaths.has(d.path));
    return picked.length ? picked : [item];
  })();

  // The sort is saved for the folder it was chosen in
  const handleSortChange = (next) => {
    setSort(next);
    saveFolderSort(currentPath, next);
  };

  // Only a selection that is in the folder on screen is shown in the status bar
  const selectionInFolder = selectedAsset ? displayedItems.find((item) => item.path === selectedAsset.path) || null : null;

  // Counts, size, selection and free space for the toolbar's subtitle
  const folderStatus = useFolderStatus({
    items: displayedItems,
    filtered: filterType !== 'all' || !!searchTerm.trim() || showFavoritesOnly || isLabelFilterActive(labelFilter),
    selectedItem: selectionInFolder,
    selectedPaths,
    drives,
    currentPath
  });

  // Folder tiles peek inside local folders only: a network share can be slow, and the grid must not wait on it
  const canPeekFolder = useCallback(
    (path) => {
      if (/^[\\/]{2}/.test(path)) return false;
      const letter = path.slice(0, 2).toUpperCase();
      return !drives.some((d) => d.isNetwork && (d.mount || '').toUpperCase().startsWith(letter));
    },
    [drives]
  );

  // Items that leave the folder on screen (a new folder, a filter, Favorites only) drop out of the multi-selection
  useEffect(() => {
    setSelectedPaths((prev) => {
      if (prev.size === 0) return prev;
      const visible = new Set(displayedItems.map((item) => item.path));
      const kept = new Set([...prev].filter((path) => visible.has(path)));
      return kept.size === prev.size ? prev : kept;
    });
  }, [displayedItems]);
  // Space opens the floating Quick Look window on the selected file, Space or Esc closes it (see hooks/useQuickLook.js)
  useQuickLook({
    viewMode,
    previewOpen,
    setPreviewOpen,
    selectedAsset: selectionInFolder,
    blocked: isWindowOpen || isEditingPath
  });
  // Quick Look belongs to the folder on screen, so it closes when the folder or the view changes
  useEffect(() => {
    setPreviewOpen(false);
  }, [currentPath, viewMode]);

  // Free space on the drive shown in the status bar goes stale as files are copied, so re-read the drives now and then
  useEffect(() => {
    if (!currentPath || !window.electronAPI?.listDrives) return;
    if (Date.now() - drivesStampRef.current < 30000) return;
    drivesStampRef.current = Date.now();
    window.electronAPI
      .listDrives()
      .then((list) => {
        if (Array.isArray(list) && list.length) {
          setDrives((prev) => (JSON.stringify(prev) === JSON.stringify(list) ? prev : list));
        }
      })
      .catch(() => {});
  }, [currentPath]);

  // Folder shortcuts the grid does not handle itself. They act on the grid only, with no window or menu open and no
  // text box focused. The handlers are read through a ref, so the listener is attached once and sees the latest state.
  const selectedForKeys = () => (selectedPaths.size > 0 ? displayedItems.filter((item) => selectedPaths.has(item.path)) : []);
  const folderKeysRef = useRef(null);
  folderKeysRef.current = {
    deleteSelection: (permanent) => {
      const items = selectedForKeys();
      if (!items.length || items.some((item) => item.isSequence || isRootLocation(item.path))) return;
      setItemAction({ type: 'delete', items, permanent });
    },
    renameSelection: () => {
      const items = selectedForKeys();
      const item = items[0];
      if (items.length !== 1 || item.isSequence || isRootLocation(item.path)) return;
      setItemAction({ type: 'rename', items: [item] });
    },
    copySelectionPaths: () => {
      const items = selectedForKeys();
      if (items.length) handleCopyPaths(items);
    },
    copySelection: () => putOnClipboard(selectedForKeys(), false),
    cutSelection: () => putOnClipboard(selectedForKeys(), true),
    paste: () => pasteIntoOpenFolder(false),
    newFolder: createFolderHere,
    focusFilter: () => {
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    },
    goUp,
    toggleInspector: () => setInspectorOpen((open) => !open)
  };
  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.defaultPrevented || e.repeat || viewModeRef.current !== 'grid' || windowOpenRef.current) return;
      if (isTextEntryTarget(e.target)) return;
      const keys = folderKeysRef.current;
      const plain = !e.ctrlKey && !e.altKey && !e.metaKey;
      const ctrl = (e.ctrlKey || e.metaKey) && !e.altKey;
      const lower = e.key?.toLowerCase();

      // Delete moves to the Recycle Bin after a confirm; Shift + Delete deletes for good after a stronger one
      if (e.key === 'Delete' && plain) {
        e.preventDefault();
        keys.deleteSelection(e.shiftKey);
      } else if (e.key === 'F2' && plain && !e.shiftKey) {
        e.preventDefault();
        keys.renameSelection();
      } else if (e.key === 'Enter' && e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
        e.preventDefault();
        keys.toggleInspector();
      } else if (e.key === 'ArrowUp' && e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
        e.preventDefault();
        keys.goUp();
      } else if (ctrl && !e.shiftKey && lower === 'f') {
        e.preventDefault();
        keys.focusFilter();
      } else if (ctrl && e.shiftKey && lower === 'c') {
        e.preventDefault();
        keys.copySelectionPaths();
      } else if (ctrl && e.shiftKey && lower === 'n') {
        e.preventDefault();
        keys.newFolder();
      } else if (ctrl && !e.shiftKey && (lower === 'c' || lower === 'x')) {
        // Selected text (in the Inspector, say) keeps its own copy
        if (lower === 'c' && window.getSelection?.()?.toString()) return;
        e.preventDefault();
        if (lower === 'c') keys.copySelection();
        else keys.cutSelection();
      } else if (ctrl && !e.shiftKey && lower === 'v') {
        e.preventDefault();
        keys.paste();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const breadcrumbs = buildBreadcrumbs(currentPath);

  return (
    <FolderIconsContext.Provider value={folderIconsValue}>
    <div className="app-container" data-ui={uiMode}>
      {/* Main Workspace */}
      <div className="main-workspace">
        {/* Sidebar */}
        <Sidebar
          drives={drives}
          currentPath={currentPath}
          onNavigate={(p, isFile) => navigateTo(p, isFile)}
          favorites={favorites}
          onToggleFavorite={handleToggleFavorite}
          folderItems={folderItems}
          blenderStatus={blenderStatus}
          onOpenSettings={() => setIsSettingsOpen(true)}
          onRefresh={refreshDrives}
          networkLocations={networkLocations}
          onRemoveNetworkLocation={handleRemoveNetworkLocation}
          onConnectNetwork={() => setConnectDialog({ path: '' })}
          recentFolders={recentFolders}
          onClearRecentFolders={handleClearRecentFolders}
          onOpenGuide={handleOpenGuide}
          onOpenFolderPicker={handleOpenFolderPicker}
          uiMode={uiMode}
        />


        {/* Content Area */}
        <div className="content-area">
          {/* Toolbar: navigation, filters, tools and search in one floating bar */}
          <Header
            searchTerm={searchTerm}
            setSearchTerm={setSearchTerm}
            labelFilter={labelFilter}
            setLabelFilter={setLabelFilter}
            labelTags={labelTags}
            onRefreshFolder={refreshFolder}
            isRefreshing={isRefreshing}
            searchInputRef={searchInputRef}
            uiMode={uiMode}
            onChangeUiMode={changeUiMode}
            navNode={
              <>
            <button
              className="icon-btn"
              style={{ width: 28, height: 28 }}
              onClick={() => goHistory(-1)}
              disabled={!canStep(history, -1)}
              title="Back (Alt + Left)"
              aria-label="Back"
            >
              <ChevronLeft size={14} />
            </button>
            <button
              className="icon-btn"
              style={{ width: 28, height: 28 }}
              onClick={() => goHistory(1)}
              disabled={!canStep(history, 1)}
              title="Forward (Alt + Right)"
              aria-label="Forward"
            >
              <ChevronRight size={14} />
            </button>

            {(parentPath || viewMode !== 'grid') && (
              <button
                className="icon-btn"
                style={{ width: 28, height: 28, marginRight: 6 }}
                onClick={() => {
                  if (viewMode !== 'grid') {
                    setViewMode('grid');
                  } else if (parentPath) {
                    navigateTo(parentPath);
                  }
                }}
                title={viewMode !== 'grid' ? 'Close preview and return to folder' : 'Go up to parent folder (Backspace)'}
              >
                {viewMode !== 'grid' ? <ArrowLeft size={14} /> : <ArrowUp size={14} />}
              </button>
            )}

            {isEditingPath && (
              <PathInput
                initialValue={currentPath}
                onSubmit={submitTypedPath}
                onCancel={() => setIsEditingPath(false)}
                onSignIn={(typed) => setConnectDialog({ path: typed })}
              />
            )}

            {!isEditingPath && (() => {
              // Title: the open folder (or the file in the viewer). Below it: the folders above it, one click each,
              // then what the folder holds and the room left on the drive.
              const here = breadcrumbs[breadcrumbs.length - 1];
              const inViewer = viewMode !== 'grid' && selectedAsset;
              const parents = inViewer ? breadcrumbs : breadcrumbs.slice(0, -1);
              const status =
                viewMode === 'grid'
                  ? [
                      folderStatus.countText,
                      uiMode === 'pro' ? folderStatus.sizeText : '',
                      folderStatus.freeText,
                      folderStatus.selectionText
                    ].filter(Boolean)
                  : [];
              return (
                <div className="tb-title">
                  <span className="tb-title-name" title={inViewer ? selectedAsset.name : here?.path || ''}>
                    {inViewer ? selectedAsset.name : here?.name || 'Open a folder'}
                  </span>
                  {(parents.length > 0 || status.length > 0) && (
                    <span className="tb-title-sub">
                      {parents.map((crumb, idx) => (
                        <React.Fragment key={crumb.path}>
                          {idx > 0 && <ChevronRight size={10} className="tb-crumb-sep" />}
                          <button
                            className="tb-crumb"
                            onClick={() => {
                              if (viewMode !== 'grid') setViewMode('grid');
                              if (crumb.path !== currentPath) navigateTo(crumb.path);
                            }}
                            title={`Open folder: ${crumb.path}`}
                          >
                            {crumb.name}
                          </button>
                        </React.Fragment>
                      ))}
                      {status.length > 0 && (
                        <span
                          className="tb-status"
                          title={[folderStatus.countText, folderStatus.detailText, folderStatus.diskText].filter(Boolean).join('\n')}
                        >
                          {parents.length > 0 ? ' · ' : ''}
                          {status.join(' · ')}
                        </span>
                      )}
                    </span>
                  )}
                </div>
              );
            })()}

            {!isEditingPath && (
              // Empty space in the bar starts typing a path, like File Explorer's address bar
              <div className="breadcrumb-fill" onClick={() => setIsEditingPath(true)} title="Type a path (Ctrl+L)" />
            )}

            {navError && !isEditingPath && (() => {
              const { text, needsSignIn } = parseNetworkError(navError);
              return (
                <>
                  <span className="path-status path-error" title={text} onClick={() => setNavError('')}>
                    {text}
                  </span>
                  {needsSignIn && (
                    <button
                      className="btn-secondary"
                      style={{ whiteSpace: 'nowrap', flexShrink: 0, padding: '2px 10px' }}
                      onClick={() => setConnectDialog({ path: navErrorPath })}
                    >
                      Sign in...
                    </button>
                  )}
                </>
              );
            })()}

            {isLoadingDir && (
              <span style={{ fontSize: 11, color: 'var(--text-secondary)', marginLeft: 'auto' }}>
                Scanning directory...
              </span>
            )}

              </>
            }
            toolsNode={
              <>
            {viewMode === 'grid' && <SortMenu sort={sort} onChange={handleSortChange} />}

            {viewMode === 'grid' && (
              <div className="view-switcher" role="group" aria-label="Folder view">
                <button
                  className={`view-switch-btn ${folderView === 'icons' ? 'active' : ''}`}
                  onClick={() => setFolderView('icons')}
                  title="Large icons (Ctrl + mouse wheel resizes thumbnails)"
                  aria-label="Large icons"
                  aria-pressed={folderView === 'icons'}
                >
                  <LayoutGrid size={13} />
                </button>
                <button
                  className={`view-switch-btn ${folderView === 'details' ? 'active' : ''}`}
                  onClick={() => setFolderView('details')}
                  title="Details"
                  aria-label="Details"
                  aria-pressed={folderView === 'details'}
                >
                  <List size={13} />
                </button>
              </div>
            )}

            {viewMode === 'grid' && (
              <div className="view-switcher" role="group" aria-label="Inspector">
                <button
                  className={`view-switch-btn ${inspectorOpen ? 'active' : ''}`}
                  onClick={() => setInspectorOpen((open) => !open)}
                  title="Show or hide the Inspector (I)"
                  aria-label="Inspector"
                  aria-pressed={inspectorOpen}
                >
                  <Info size={13} />
                </button>
              </div>
            )}

            {!isEditingPath && (
              <button
                className="icon-btn"
                style={{ width: 24, height: 24 }}
                onClick={() => setIsEditingPath(true)}
                title="Type a folder path or network address (Ctrl+L)"
              >
                <TextCursorInput size={13} />
              </button>
            )}
              </>
            }
          />

          {/* The folder: tiles with the filter dock floating over them, and the Inspector beside them */}
          {viewMode === 'grid' && (
            <div className="grid-row">
              <div className="grid-stage">
                {/* Dynamic Views */}
                {viewMode === 'grid' && (
                  <AssetGrid
                    items={displayedItems}
                    selectedItem={selectedAsset}
                    selectedPaths={selectedPaths}
                    cutPaths={cutPaths}
                    onSelect={(item) => setSelectedAsset(item)}
                    onSelectionChange={setSelection}
                    onOpen={(item) => {
                      if (item.isDirectory) {
                        navigateTo(item.path);
                      } else {
                        openAsset(item);
                      }
                    }}
                    onToggleFavorite={handleToggleFavorite}
                    favorites={favorites}
                    onRevealInExplorer={handleRevealInExplorer}
                    onAddToCompare={handleAddToCompare}
                    compareAssetA={compareAssetA}
                    compareAssetB={compareAssetB}
                    onSetCompareA={handleSetCompareA}
                    onSetCompareB={handleSetCompareB}
                    labels={fileLabels.labels}
                    labelActions={fileLabels}
                    gridSize={gridSize}
                    onGridSizeChange={handleGridSizeChange}
                    folderView={folderView}
                    sort={sort}
                    onSortColumn={(key) => handleSortChange(sortByColumn(sort, key))}
                    keyboardEnabled={!isWindowOpen && !isEditingPath}
                    onGoUp={goUp}
                    onOpenFolderMenu={openFolderMenu}
                    onOpenExternal={handleOpenExternal}
                    canPeekFolder={canPeekFolder}
                  />
                )}

                {viewMode === 'grid' && (
                  <FilterDock
                    uiMode={uiMode}
                    filterType={filterType}
                    setFilterType={setFilterType}
                    showFavoritesOnly={showFavoritesOnly}
                    setShowFavoritesOnly={setShowFavoritesOnly}
                    kindCounts={kindCounts}
                    gridSize={gridSize}
                    onGridSizeChange={handleGridSizeChange}
                    showZoom={folderView === 'icons'}
                  />
                )}

                {/* Floating Compare Dock (Displays active Slot A and Slot B selections) */}
                {viewMode === 'grid' && (compareAssetA || compareAssetB) && (
                  <div className="floating-compare-dock">
                    <div
                      className="dock-slot"
                      onDragOver={(e) => {
                        e.preventDefault();
                        e.dataTransfer.dropEffect = 'copy';
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        const data = e.dataTransfer.getData('application/json');
                        if (data) {
                          try {
                            const item = JSON.parse(data);
                            if (item && isComparableItem(item)) setCompareAssetA(item);
                          } catch (_) {}
                        }
                      }}
                    >
                      <span className="dock-slot-tag a">SLOT A</span>
                      <span className="dock-name" title={compareAssetA?.name || 'Not assigned'}>
                        {compareAssetA ? compareAssetA.name : 'Select asset for A'}
                      </span>
                      {compareAssetA && (
                        <button
                          className="dock-clear-btn"
                          onClick={() => setCompareAssetA(null)}
                          title="Clear Slot A"
                        >
                          ✕
                        </button>
                      )}
                    </div>

                    <button
                      className="icon-btn"
                      style={{ width: 28, height: 28, background: '#1c1c1c' }}
                      onClick={handleSwapCompareSlots}
                      title="Swap Slot A and Slot B"
                    >
                      <ArrowLeftRight size={13} color="#ffffff" />
                    </button>

                    <div
                      className="dock-slot"
                      onDragOver={(e) => {
                        e.preventDefault();
                        e.dataTransfer.dropEffect = 'copy';
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        const data = e.dataTransfer.getData('application/json');
                        if (data) {
                          try {
                            const item = JSON.parse(data);
                            if (item && isComparableItem(item)) setCompareAssetB(item);
                          } catch (_) {}
                        }
                      }}
                    >
                      <span className="dock-slot-tag b">SLOT B</span>
                      <span className="dock-name" title={compareAssetB?.name || 'Not assigned'}>
                        {compareAssetB ? compareAssetB.name : 'Select asset for B'}
                      </span>
                      {compareAssetB && (
                        <button
                          className="dock-clear-btn"
                          onClick={() => setCompareAssetB(null)}
                          title="Clear Slot B"
                        >
                          ✕
                        </button>
                      )}
                    </div>

                    <button
                      className="dock-launch-btn"
                      onClick={() => setViewMode('compare')}
                      title="Launch Comparison"
                    >
                      <Split size={14} />
                      <span>Compare</span>
                    </button>

                    <button
                      className="icon-btn"
                      style={{ width: 26, height: 26, color: '#888888' }}
                      onClick={handleClearCompareSlots}
                      title="Clear Compare Selection"
                    >
                      ✕
                    </button>
                  </div>
                )}
              </div>

              {/* File details beside the grid: the selected file or folder, read without opening it */}
              {viewMode === 'grid' && inspectorOpen && (
                <Suspense fallback={null}>
                  <InspectorDrawer
                    item={selectionInFolder}
                    onClose={() => setInspectorOpen(false)}
                    onOpen={(item) => (item.isDirectory ? navigateTo(item.path) : openAsset(item))}
                    onReveal={handleRevealInExplorer}
                    compareAssetA={compareAssetA}
                    compareAssetB={compareAssetB}
                    onSetCompareA={handleSetCompareA}
                    onSetCompareB={handleSetCompareB}
                    textureSet={selectionInFolder && !selectionInFolder.isDirectory ? findTextureSet(selectionInFolder, folderItems) : null}
                    onViewTextureSet={(set) => setTextureSet(set)}
                    externalApps={externalApps}
                    onSendToApp={handleSendToApp}
                    label={selectionInFolder ? labelFor(fileLabels.labels, selectionInFolder.path) : null}
                    labelActions={fileLabels}
                  />
                </Suspense>
              )}
            </div>
          )}

          <Suspense fallback={null}>
          {viewMode === 'image' && (
            <ImageViewer
              asset={selectedAsset}
              allFolderItems={folderItems}
              onClose={() => setViewMode('grid')}
              onSelectAsset={(item) => setSelectedAsset(item)}
              onRevealInExplorer={handleRevealInExplorer}
            />
          )}

          {viewMode === 'txtex' && (
            <TxTexViewer
              asset={selectedAsset}
              allFolderItems={folderItems}
              onClose={() => setViewMode('grid')}
              onSelectAsset={(item) => setSelectedAsset(item)}
              onRevealInExplorer={handleRevealInExplorer}
            />
          )}

          {viewMode === 'sequence' && (
            <ImageSequencePlayer
              asset={selectedAsset}
              allFolderItems={sequenceGroups}
              onClose={() => setViewMode('grid')}
              onSelectAsset={(item) => setSelectedAsset(item)}
              onRevealInExplorer={handleRevealInExplorer}
            />
          )}

          {viewMode === 'video' && (
            <VideoPlayer
              asset={selectedAsset}
              allFolderItems={folderItems}
              onClose={() => setViewMode('grid')}
              onSelectAsset={(item) => setSelectedAsset(item)}
              onRevealInExplorer={handleRevealInExplorer}
            />
          )}

          {viewMode === 'pdf' && (
            <PdfViewer
              asset={selectedAsset}
              allFolderItems={folderItems}
              onClose={() => setViewMode('grid')}
              onSelectAsset={(item) => setSelectedAsset(item)}
              onRevealInExplorer={handleRevealInExplorer}
            />
          )}

          {viewMode === 'markdown' && (
            <MarkdownViewer
              asset={selectedAsset}
              allFolderItems={folderItems}
              onClose={() => setViewMode('grid')}
              onSelectAsset={(item) => setSelectedAsset(item)}
              onRevealInExplorer={handleRevealInExplorer}
            />
          )}

          {viewMode === 'audio' && (
            <AudioPlayer
              asset={selectedAsset}
              allFolderItems={folderItems}
              onClose={() => setViewMode('grid')}
              onSelectAsset={(item) => setSelectedAsset(item)}
              onRevealInExplorer={handleRevealInExplorer}
            />
          )}

          {viewMode === 'studio3d' && (
            <Viewport3D
              asset={selectedAsset || folderItems.find((i) => i.category === '3d')}
              onClose={() => setViewMode('grid')}
              onRevealInExplorer={handleRevealInExplorer}
            />
          )}

          {viewMode === 'hdrexr' && (
            <HdrExrInspector
              asset={selectedAsset || folderItems.find((i) => i.category === 'hdr')}
              onClose={() => setViewMode('grid')}
              onRevealInExplorer={handleRevealInExplorer}
            />
          )}

          {viewMode === 'compare' && (
            <CompareView
              folderItems={folderItems}
              initialAssetA={isComparableItem(compareAssetA) ? compareAssetA : (isComparableItem(selectedAsset) ? selectedAsset : null)}
              initialAssetB={isComparableItem(compareAssetB) ? compareAssetB : null}
              onClose={() => setViewMode('grid')}
              onRevealInExplorer={handleRevealInExplorer}
            />
          )}

          {viewMode === 'grid' && previewOpen && selectionInFolder && (
            <QuickLookWindow
              asset={selectionInFolder}
              folderItems={folderItems}
              sequenceGroups={sequenceGroups}
              onSelectAsset={(item) => setSelectedAsset(item)}
              onOpenFull={() => {
                setPreviewOpen(false);
                if (selectionInFolder.isDirectory) navigateTo(selectionInFolder.path);
                else openAsset(selectionInFolder);
              }}
              onClose={() => setPreviewOpen(false)}
              onRevealInExplorer={handleRevealInExplorer}
            />
          )}
          </Suspense>
        </div>

      </div>

      {/* Settings Modal */}
      {settingsSeenRef.current && (
        <Suspense fallback={null}>
          <SettingsModal
            isOpen={isSettingsOpen}
            onClose={() => setIsSettingsOpen(false)}
            theme={theme}
            onThemeChange={changeTheme}
            onOpenGuide={handleOpenGuide}
          />
        </Suspense>
      )}

      {/* Keyboard shortcut list, opened with ? or F1 */}
      <ShortcutCheatsheet onOpenGuide={handleOpenGuide} />

      {/* Shown when the user guide could not be opened in the browser */}
      <GuideErrorModal message={guideError} onClose={() => setGuideError(null)} />

      {/* Sign in to a network share with a username and password */}
      {connectDialog && (
        <ConnectNetworkModal
          initialPath={connectDialog.path}
          onClose={() => setConnectDialog(null)}
          onConnect={handleConnectNetwork}
        />
      )}

      {/* Visual Drag & Drop Overlay */}
      {isDraggingOver && (
        <DragDropOverlay viewMode={viewMode} dropTargetSlot={dropTargetSlot} />
      )}

      {/* Drop Error / Viewer Incompatibility Modal */}
      {dropError && (
        <DropErrorModal
          errorInfo={dropError}
          onClose={() => setDropError(null)}
          onOpenInSuggestedViewer={(item, targetView) => {
            setSelectedAsset(item);
            setViewMode(targetView);
            setDropError(null);
          }}
        />
      )}

      {/* Right-click menu, rename and delete dialogs, and the folder icon picker */}
      {itemMenu && (
        <ItemContextMenu
          x={itemMenu.x}
          y={itemMenu.y}
          items={itemMenuItems}
          background={!!itemMenu.background}
          actions={{
            onRefresh: refreshFolder,
            onPaste: () => pasteIntoOpenFolder(true),
            onNewFolder: createFolderHere,
            canWrite: !!currentPath,
            onFindDuplicatesHere: () =>
              setDuplicateFolder({ path: currentPath, name: currentPath.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || currentPath }),
            onFindDuplicates: (item) => setDuplicateFolder({ path: item.path, name: item.name }),
            onCut: (items) => putOnClipboard(items, true),
            onCopy: (items) => putOnClipboard(items, false),
            isFavorite: (item) => favorites.some((f) => f.path === item.path),
            hasIconChoice: (item) => !!folderIconStore.assignments[normalizeFolderKey(item.path)],
            sequenceFor,
            onPlaySequence: (sequence) => openAsset(sequence),
            textureSetFor: (item) => findTextureSet(item, folderItems),
            onViewTextureSet: (set) => setTextureSet(set),
            onEditLabels: (items) => setLabelEditor({ items, anchor: { x: itemMenu.x, y: itemMenu.y } }),
            onOpen: (item) => (item.isDirectory ? navigateTo(item.path) : openAsset(item)),
            onOpenExternal: handleOpenExternal,
            externalApps,
            onSendTo: handleSendToApp,
            onSetCompareA: handleSetCompareA,
            onSetCompareB: handleSetCompareB,
            onCopyPaths: handleCopyPaths,
            onReveal: (item) => handleRevealInExplorer(item.path),
            onToggleFavorite: handleToggleFavorite,
            onChangeIcon: (item) => setIconPickerItem(item),
            onResetIcon: (item) => folderIconStore.resetIcon(item.path),
            onRename: (item) => setItemAction({ type: 'rename', items: [item] }),
            onDelete: (items) => setItemAction({ type: 'delete', items }),
            onConvert: (items) => setConvertItems(items)
          }}
          onClose={() => setItemMenu(null)}
        />
      )}

      {/* A texture set's maps side by side, opened from the right-click menu of one of its maps */}
      {textureSet && (
        <Suspense fallback={null}>
          <TextureSetModal
            set={textureSet}
            onOpenMap={(item) => {
              setTextureSet(null);
              openAsset(item);
            }}
            onClose={() => setTextureSet(null)}
          />
        </Suspense>
      )}

      {/* Colour and tags of the item or selection a menu was opened on */}
      {labelEditor && (
        <FileLabelPopover
          anchor={labelEditor.anchor}
          label={labelForItems(fileLabels.labels, labelEditor.items)}
          onSetColor={(color) => fileLabels.setColor(labelEditor.items.map((item) => item.path), color)}
          onAddTag={(tag) => fileLabels.editTags(labelEditor.items.map((item) => item.path), [tag], [])}
          onRemoveTag={(tag) => fileLabels.editTags(labelEditor.items.map((item) => item.path), [], [tag])}
          onClose={() => setLabelEditor(null)}
        />
      )}
      {itemAction?.type === 'rename' && (
        <RenameItemModal
          item={itemAction.items[0]}
          onSubmit={(newName) => handleRenameItem(itemAction.items[0], newName)}
          onClose={() => setItemAction(null)}
        />
      )}
      {itemAction?.type === 'delete' && (
        <DeleteItemModal
          items={itemAction.items}
          permanent={!!itemAction.permanent}
          onConfirm={() => handleDeleteItems(itemAction.items, !!itemAction.permanent)}
          onClose={() => setItemAction(null)}
        />
      )}
      {pasteConflict && (
        <Suspense fallback={null}>
          <PasteConflictModal
            names={pasteConflict.names}
            total={pasteConflict.items.length}
            mode={pasteConflict.mode}
            onChoose={(replace) => {
              const { items, destDir, mode } = pasteConflict;
              setPasteConflict(null);
              beginTransfer(items, destDir, mode, replace);
            }}
            onClose={() => setPasteConflict(null)}
          />
        </Suspense>
      )}
      <FileTransferPanel jobs={transfers.jobs} onCancel={transfers.cancel} onDismiss={transfers.dismiss} />
      {convertItems && (
        <Suspense fallback={null}>
          <BatchConvertModal items={convertItems} onClose={() => setConvertItems(null)} />
        </Suspense>
      )}
      {duplicateFolder && (
        <Suspense fallback={null}>
          <DuplicateFinderModal
            folder={duplicateFolder}
            onOpenFolder={(path) => {
              setDuplicateFolder(null);
              navigateTo(path);
            }}
            onReveal={handleRevealInExplorer}
            onClose={() => setDuplicateFolder(null)}
          />
        </Suspense>
      )}
      {iconPickerItem && (
        <Suspense fallback={null}>
          <FolderIconPicker
            item={iconPickerItem}
            store={folderIconStore}
            onClose={() => setIconPickerItem(null)}
          />
        </Suspense>
      )}
    </div>
    </FolderIconsContext.Provider>
  );
}
