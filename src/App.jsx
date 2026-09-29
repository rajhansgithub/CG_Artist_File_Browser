import React, { useState, useEffect, useRef } from 'react';
import Header from './components/Header';
import Sidebar from './components/Sidebar';
import AssetGrid from './components/AssetGrid';
import Viewport3D from './components/Viewport3D';
import HdrExrInspector from './components/HdrExrInspector';
import ImageViewer from './components/ImageViewer';
import VideoPlayer from './components/VideoPlayer';
import AudioPlayer from './components/AudioPlayer';
import CompareView from './components/CompareView';
import SettingsModal from './components/SettingsModal';
import DropErrorModal from './components/DropErrorModal';
import DragDropOverlay from './components/DragDropOverlay';
import {
  is3DFormat,
  isHdrFormat,
  isImageFormat,
  isTextureFormat,
  isVideoFormat,
  isAudioFormat,
  isComparableImage
} from './utils/formatHelpers';
import { ChevronRight, Folder, FolderOpen, ArrowLeft, ArrowLeftRight, Split } from 'lucide-react';

export default function App() {
  const [drives, setDrives] = useState([]);
  const [currentPath, setCurrentPath] = useState('');
  const [folderItems, setFolderItems] = useState([]);
  const [parentPath, setParentPath] = useState(null);
  const [selectedAsset, setSelectedAsset] = useState(null);
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

  // Filter & Search
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState('all'); // 'all', '3d', 'hdr'
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);
  const [favorites, setFavorites] = useState([]);

  // Views & UI State
  const [viewMode, setViewMode] = useState('grid'); // 'grid', 'studio3d', 'hdrexr', 'image', 'compare'
  const [theme, setTheme] = useState('dark');
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [blenderStatus, setBlenderStatus] = useState(null);
  const [isLoadingDir, setIsLoadingDir] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  // Interactive Grid Sizing (Ctrl + Mouse Scroll Wheel)
  const [gridSize, setGridSize] = useState(() => {
    const saved = localStorage.getItem('cg_artist_grid_size') || localStorage.getItem('vfx_grid_size');
    return saved ? Math.min(500, Math.max(120, Number(saved))) : 240;
  });

  useEffect(() => {
    localStorage.setItem('cg_artist_grid_size', gridSize);
  }, [gridSize]);

  // Synchronize refs with state for stable event listener callbacks
  viewModeRef.current = viewMode;
  dropTargetSlotRef.current = dropTargetSlot;
  compareAssetARef.current = compareAssetA;
  compareAssetBRef.current = compareAssetB;
  currentPathRef.current = currentPath;
  filterTypeRef.current = filterType;
  searchTermRef.current = searchTerm;


  // Initialize theme from localStorage
  useEffect(() => {
    const savedTheme = localStorage.getItem('cg_artist_theme') || localStorage.getItem('vfx_studio_theme') || 'dark';
    setTheme(savedTheme);
    document.documentElement.setAttribute('data-theme', savedTheme);
  }, []);

  const toggleTheme = () => {
    const nextTheme = theme === 'dark' ? 'light' : 'dark';
    setTheme(nextTheme);
    localStorage.setItem('cg_artist_theme', nextTheme);
    document.documentElement.setAttribute('data-theme', nextTheme);
  };

  // Initial load
  useEffect(() => {
    loadDrivesAndInitialDir();
    loadFavorites();
    loadBlenderStatus();
  }, []);

  const loadDrivesAndInitialDir = async () => {
    if (window.electronAPI) {
      const driveList = await window.electronAPI.listDrives();
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

  const navigateTo = async (targetPath, openDirectly = false) => {
    if (!window.electronAPI) return;

    if (openDirectly) {
      // It's a file
      const ext = targetPath.slice(targetPath.lastIndexOf('.')).toLowerCase();
      let cat = '3d';
      if (['.hdr', '.exr'].includes(ext)) {
        cat = 'hdr';
      } else if (['.tif', '.tiff', '.tga', '.dds', '.psd'].includes(ext)) {
        cat = 'texture';
      } else if (['.png', '.jpg', '.jpeg', '.webp', '.bmp'].includes(ext)) {
        cat = 'image';
      } else if (['.mp4', '.webm', '.mov', '.mkv', '.avi'].includes(ext)) {
        cat = 'video';
      } else if (['.wav', '.mp3', '.ogg', '.flac', '.aac', '.aiff', '.m4a'].includes(ext)) {
        cat = 'audio';
      }

      const item = {
        name: targetPath.split(/[/\\]/).pop(),
        path: targetPath,
        isDirectory: false,
        category: cat,
        extension: ext
      };

      const lastSlash = Math.max(targetPath.lastIndexOf('/'), targetPath.lastIndexOf('\\'));
      const parentDir = lastSlash > 0 ? targetPath.slice(0, lastSlash) : '';
      if (parentDir && parentDir !== currentPath) {
        window.electronAPI.readDirectory(parentDir, {
          filter: filterType === 'all' ? 'all' : filterType,
          search: searchTerm
        }).then((res) => {
          if (res && !res.error) {
            setCurrentPath(res.currentPath);
            setParentPath(res.parentPath);
            setFolderItems(res.items || []);
          }
        });
      }

      openAsset(item);
      return;
    }

    setIsLoadingDir(true);
    const res = await window.electronAPI.readDirectory(targetPath, {
      filter: filterType === 'all' ? 'all' : filterType,
      search: searchTerm
    });

    if (res && !res.error) {
      setCurrentPath(res.currentPath);
      setParentPath(res.parentPath);
      setFolderItems(res.items || []);
    }
    setIsLoadingDir(false);
  };

  // Re-fetch when search or filter changes
  useEffect(() => {
    if (currentPath && window.electronAPI) {
      window.electronAPI
        .readDirectory(currentPath, {
          filter: filterType === 'all' ? 'all' : filterType,
          search: searchTerm
        })
        .then((res) => {
          if (res && !res.error) {
            setFolderItems(res.items || []);
          }
        });
    }
  }, [searchTerm, filterType]);

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

  const openAsset = (item) => {
    setSelectedAsset(item);
    if (item.category === '3d') {
      setViewMode('studio3d');
    } else if (item.category === 'hdr') {
      setViewMode('hdrexr');
    } else if (item.category === 'image' || item.category === 'texture') {
      setViewMode('image');
    } else if (item.category === 'video') {
      setViewMode('video');
    } else if (item.category === 'audio') {
      setViewMode('audio');
    }
  };

  const handleSetCompareA = (item) => {
    if (isComparableImage(item)) {
      setCompareAssetA(item);
    }
  };

  const handleSetCompareB = (item) => {
    if (isComparableImage(item)) {
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
    if (!isComparableImage(item)) return;
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
    const lastSlash = Math.max(firstItem.path.lastIndexOf('/'), firstItem.path.lastIndexOf('\\'));
    let parentDir = lastSlash > 0 ? firstItem.path.slice(0, lastSlash) : '';
    if (parentDir.endsWith(':')) {
      parentDir += '\\';
    }
    if (parentDir && parentDir !== currentPathRef.current && window.electronAPI?.readDirectory) {
      window.electronAPI.readDirectory(parentDir, { filter: filterTypeRef.current, search: searchTermRef.current }).then((res) => {
        if (res && !res.error && res.items) {
          setCurrentPath(res.currentPath);
          setParentPath(res.parentPath);
          setFolderItems(res.items);
        }
      });
    }

    // Case 2: Two files dropped simultaneously -> launch compare view directly if both are comparable images
    if (resolvedItems.length >= 2) {
      if (isComparableImage(resolvedItems[0]) && isComparableImage(resolvedItems[1])) {
        setCompareAssetA(resolvedItems[0]);
        setCompareAssetB(resolvedItems[1]);
        setViewMode('compare');
        return;
      }
    }

    // Case 3: Dropped in Compare view - Slot targeting for comparable images only
    if (viewModeRef.current === 'compare') {
      if (isComparableImage(firstItem)) {
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
    if (firstItem.category === '3d') {
      setSelectedAsset(firstItem);
      setViewMode('studio3d');
    } else if (firstItem.category === 'hdr') {
      setSelectedAsset(firstItem);
      setViewMode('hdrexr');
    } else if (['image', 'texture'].includes(firstItem.category)) {
      setSelectedAsset(firstItem);
      setViewMode('image');
    } else if (firstItem.category === 'video') {
      setSelectedAsset(firstItem);
      setViewMode('video');
    } else if (firstItem.category === 'audio') {
      setSelectedAsset(firstItem);
      setViewMode('audio');
    } else {
      // Truly unsupported non-media file (e.g. .exe, .zip, .dll, etc.)
      setDropError({
        fileName: firstItem.name,
        currentViewerTitle: 'Universal Media Viewport',
        expectedTypes: 'Supported: 3D Models (.obj, .fbx, .gltf, .glb, .stl, .ply, .usd, .abc), HDR/EXR Maps (.hdr, .exr), Images (.png, .jpg, .webp, .tif, .tga), Videos (.mp4, .mov, .webm), Audio (.wav, .mp3, .ogg, .flac)',
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
        setIsDraggingOver(true);
        if (viewModeRef.current === 'compare' && payload.position) {
          const scale = window.devicePixelRatio || 1;
          const clientX = payload.position.x / scale;
          const slot = clientX < window.innerWidth / 2 ? 'A' : 'B';
          setDropTargetSlot(slot);
        } else {
          setDropTargetSlot(null);
        }
      } else if (payload.type === 'over') {
        setIsDraggingOver(true);
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
          handleProcessDroppedFiles(payload.paths, slot);
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

  // Filter items for display
  const displayedItems = folderItems.filter((item) => {
    if (showFavoritesOnly) {
      return favorites.some((f) => f.path === item.path);
    }
    return true;
  });

  // Breadcrumbs builder
  const buildBreadcrumbs = () => {
    if (!currentPath) return [];
    const normalized = currentPath.replace(/\\/g, '/');
    const segments = normalized.split('/').filter(Boolean);
    const crumbs = [];
    let accum = '';

    segments.forEach((seg, idx) => {
      accum += (idx === 0 ? seg : '/' + seg);
      // Windows drive root fix (e.g., J: -> J:\)
      const full = idx === 0 && seg.endsWith(':') ? seg + '\\' : accum.replace(/\//g, '\\');
      crumbs.push({ name: seg, path: full });
    });
    return crumbs;
  };

  const breadcrumbs = buildBreadcrumbs();

  return (
    <div className="app-container">
      {/* Top Header */}
      <Header
        searchTerm={searchTerm}
        setSearchTerm={setSearchTerm}
        filterType={filterType}
        setFilterType={setFilterType}
        viewMode={viewMode}
        setViewMode={setViewMode}
        showFavoritesOnly={showFavoritesOnly}
        setShowFavoritesOnly={setShowFavoritesOnly}
        theme={theme}
        toggleTheme={toggleTheme}
        onOpenSettings={() => setIsSettingsOpen(true)}
        onOpenFolderPicker={handleOpenFolderPicker}
        sidebarCollapsed={sidebarCollapsed}
        onToggleSidebar={() => setSidebarCollapsed(!sidebarCollapsed)}
      />

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
          onRefresh={loadDrivesAndInitialDir}
          collapsed={sidebarCollapsed}
        />


        {/* Content Area */}
        <div className="content-area">
          {/* Breadcrumbs Navigation Bar */}
          <div className="breadcrumbs-bar">
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
                title={viewMode !== 'grid' ? 'Close preview and return to folder' : 'Go up to parent folder'}
              >
                <ArrowLeft size={14} />
              </button>
            )}

            <FolderOpen size={15} color="#ffffff" />

            {breadcrumbs.map((crumb, idx) => (
              <React.Fragment key={crumb.path}>
                <span
                  className={`breadcrumb-crumb ${idx === breadcrumbs.length - 1 && viewMode === 'grid' ? 'active' : ''}`}
                  onClick={() => {
                    if (viewMode !== 'grid') {
                      setViewMode('grid');
                    }
                    if (crumb.path !== currentPath) {
                      navigateTo(crumb.path);
                    }
                  }}
                  title={`Open folder: ${crumb.name}`}
                >
                  {crumb.name}
                </span>
                {(idx < breadcrumbs.length - 1 || (viewMode !== 'grid' && selectedAsset)) && (
                  <span className="breadcrumb-separator">/</span>
                )}
              </React.Fragment>
            ))}

            {viewMode !== 'grid' && selectedAsset && (
              <span
                className="breadcrumb-crumb active"
                style={{ cursor: 'default', color: '#ffffff', fontWeight: 600 }}
                title={selectedAsset.name}
              >
                {selectedAsset.name}
              </span>
            )}

            {isLoadingDir && (
              <span style={{ fontSize: 11, color: '#ffffff', marginLeft: 'auto' }}>
                Scanning directory...
              </span>
            )}
          </div>

          {/* Dynamic Views */}
          {viewMode === 'grid' && (
            <AssetGrid
              items={displayedItems}
              selectedItem={selectedAsset}
              onSelect={(item) => setSelectedAsset(item)}
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
              gridSize={gridSize}
              onGridSizeChange={setGridSize}
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
                      if (item && isComparableImage(item)) setCompareAssetA(item);
                    } catch (_) {}
                  }
                }}
              >
                <span className="dock-slot-tag a">SLOT A</span>
                <span className="dock-name" title={compareAssetA?.name || 'Not assigned'}>
                  {compareAssetA ? compareAssetA.name : 'Select image for A'}
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
                      if (item && isComparableImage(item)) setCompareAssetB(item);
                    } catch (_) {}
                  }
                }}
              >
                <span className="dock-slot-tag b">SLOT B</span>
                <span className="dock-name" title={compareAssetB?.name || 'Not assigned'}>
                  {compareAssetB ? compareAssetB.name : 'Select image for B'}
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
                title="Launch Image Comparison"
              >
                <Split size={14} />
                <span>Compare Images</span>
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

          {viewMode === 'image' && (
            <ImageViewer
              asset={selectedAsset}
              allFolderItems={folderItems}
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
              initialAssetA={isComparableImage(compareAssetA) ? compareAssetA : (isComparableImage(selectedAsset) ? selectedAsset : null)}
              initialAssetB={isComparableImage(compareAssetB) ? compareAssetB : null}
              onClose={() => setViewMode('grid')}
              onRevealInExplorer={handleRevealInExplorer}
            />
          )}
        </div>
      </div>

      {/* Settings Modal */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
      />

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
    </div>
  );
}
