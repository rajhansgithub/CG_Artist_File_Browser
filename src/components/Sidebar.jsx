import React, { useState, useEffect, useRef } from 'react';
import {
  HardDrive,
  Network,
  X,
  Plus,
  Star,
  ChevronRight,
  RefreshCw,
  FolderOpen,
  FolderTree,
  History,
  CircleHelp,
  SlidersHorizontal,
  Layers,
  Trophy
} from 'lucide-react';
import { useAchievementLevel } from '../achievements/level.js';
import FolderIcon from './FolderIcon';
import RecentFolders from './RecentFolders';
import { useFolderIcons } from '../utils/folderIconStore';
import { useUpdates, hasNewVersion } from '../utils/updateStore';

// "Z:" plus the share name, e.g. "Z: library" for Z:\ -> \\mypc\library
function networkDriveName(drive) {
  const letter = drive.mount.replace(/\\$/, '');
  const share = drive.label && drive.label.startsWith('\\\\') ? drive.label.split('\\').filter(Boolean).pop() : '';
  return share ? `${letter} ${share}` : letter;
}

// Is `path` on this drive (or the share it maps)?
function isOnDrive(drive, path) {
  if (!path) return false;
  const p = path.toUpperCase();
  return p.startsWith(drive.mount.toUpperCase()) || (drive.isNetwork && p.startsWith(drive.name.toUpperCase()));
}

// How full a drive is, 0 to 1, or null when its size is unknown
function usedShare(drive) {
  const free = parseFloat(drive.freeGB);
  const total = parseFloat(drive.totalGB);
  if (!Number.isFinite(free) || !Number.isFinite(total) || total <= 0) return null;
  return Math.min(1, Math.max(0, 1 - free / total));
}

function DriveBar({ drive }) {
  const used = usedShare(drive);
  if (used == null) return null;
  return (
    <span className="drive-bar" aria-hidden="true">
      <i style={{ width: `${Math.round(used * 100)}%` }} />
    </span>
  );
}

const ellipsis = { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };

// What the side rail's pop-out panels hold
const FLYOUTS = {
  locations: { title: 'Drives and network', icon: HardDrive },
  folders: { title: 'Folders', icon: FolderTree },
  recent: { title: 'Recent folders', icon: History },
  starred: { title: 'Starred assets', icon: Star }
};

// Simple mode shows a slim icon rail whose buttons open the same lists as pop-outs. Pro mode shows the full sidebar.
export default function Sidebar({
  drives,
  currentPath,
  onNavigate,
  favorites,
  folderItems,
  blenderStatus,
  onOpenSettings,
  onOpenGuide,
  onOpenAchievements,
  onOpenFolderPicker,
  onRefresh,
  uiMode,
  onToggleFavorite,
  networkLocations,
  onRemoveNetworkLocation,
  onConnectNetwork,
  recentFolders,
  onClearRecentFolders
}) {
  const { openMenu } = useFolderIcons();
  const ach = useAchievementLevel();
  const updates = useUpdates();
  const updateTitle = hasNewVersion(updates) ? `Update available: v${updates.found.version}` : '';
  const achTitle = `Achievements · Level ${ach.level} ${ach.title} (${ach.metal})`;
  const [flyout, setFlyout] = useState(null);
  const flyoutRef = useRef(null);
  const railRef = useRef(null);

  const folders = (folderItems || []).filter((item) => item.isDirectory);
  const starredFolders = (favorites || []).filter((item) => item.isDirectory);
  const favoriteFiles = (favorites || []).filter((item) => !item.isDirectory);
  const pro = uiMode === 'pro';

  // The pop-out closes on a click elsewhere, on Escape, and when switching to Pro
  useEffect(() => {
    if (!flyout) return undefined;
    const close = (e) => {
      if (e.type === 'keydown') {
        if (e.key === 'Escape') setFlyout(null);
        return;
      }
      if (flyoutRef.current?.contains(e.target) || railRef.current?.contains(e.target)) return;
      setFlyout(null);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [flyout]);

  useEffect(() => {
    if (pro) setFlyout(null);
  }, [pro]);

  const go = (path, isFile) => {
    onNavigate(path, isFile);
    setFlyout(null);
  };

  const drivesSection = () => (
    <div>
      <div className="sidebar-section-title">
        <span>Drives</span>
        <button className="section-action" onClick={onRefresh} title="Refresh drives">
          <RefreshCw size={11} />
        </button>
      </div>
      <div className="nav-list">
        {drives.map((d) => {
          const isSelected = isOnDrive(d, currentPath);
          const Icon = d.isNetwork ? Network : HardDrive;
          return (
            <div
              key={d.mount}
              className={`nav-item drive-item ${isSelected ? 'active' : ''}`}
              onClick={() => go(d.name)}
              title={`${d.label} (${d.mount})`}
            >
              <Icon size={14} className="nav-icon" />
              <span className="drive-col">
                <span className="drive-top">
                  <span style={ellipsis}>{d.isNetwork ? networkDriveName(d) : d.mount}</span>
                  <span className="nav-trail">
                    {d.freeGB && d.totalGB ? `${d.freeGB} GB free` : d.isNetwork ? (d.offline ? 'Offline' : 'Network') : ''}
                  </span>
                </span>
                <DriveBar drive={d} />
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );

  // Network locations: shares opened by typing a path, signed in with a password, or saved in Explorer
  const networkSection = () => (
    <div>
      <div className="sidebar-section-title">
        <span>Network</span>
        <button
          className="section-action"
          onClick={onConnectNetwork}
          title="Connect to network folder (sign in with a username and password)"
        >
          <Plus size={12} />
        </button>
      </div>
      <div className="nav-list">
        {(!networkLocations || networkLocations.length === 0) && <div className="nav-empty">No network folders</div>}
        {(networkLocations || []).map((loc) => (
          <div
            key={loc.path}
            className={`nav-item ${currentPath && currentPath.toLowerCase().startsWith(loc.path.toLowerCase()) ? 'active' : ''}`}
            onClick={() => go(loc.path)}
            title={
              (loc.name ? `${loc.name} (${loc.path})` : loc.path) +
              (loc.username ? `\nSigned in as ${loc.username}, reconnects automatically` : '')
            }
          >
            <Network size={14} className="nav-icon" />
            <span style={ellipsis}>{loc.name || loc.path.replace(/\\$/, '')}</span>
            {loc.removable && (
              <button
                className="nav-remove"
                onClick={(e) => {
                  e.stopPropagation();
                  onRemoveNetworkLocation(loc.path);
                }}
                title={loc.username ? 'Remove from list and forget the saved password' : 'Remove from list'}
              >
                <X size={11} />
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );

  const recentSection = () => (
    <RecentFolders paths={recentFolders} currentPath={currentPath} onNavigate={go} onClear={onClearRecentFolders} />
  );

  const pinnedSection = () =>
    starredFolders.length > 0 && (
      <div>
        <div className="sidebar-section-title">
          <span>Pinned</span>
          <span className="section-count">{starredFolders.length}</span>
        </div>
        <div className="nav-list">
          {starredFolders.map((sf) => (
            <div
              key={sf.path}
              className="nav-item"
              onClick={() => go(sf.path, false)}
              onContextMenu={(e) => openMenu(e, sf)}
              title={sf.path}
            >
              <FolderIcon item={sf} size={14} className="nav-icon" style={{ flexShrink: 0 }} />
              <span style={ellipsis}>{sf.name}</span>
              <button
                className="nav-remove pinned"
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleFavorite(sf);
                }}
                title="Unpin folder"
              >
                <Star size={11} fill="currentColor" />
              </button>
            </div>
          ))}
        </div>
      </div>
    );

  const starredSection = () =>
    favoriteFiles.length > 0 && (
      <div>
        <div className="sidebar-section-title">
          <span>Starred</span>
          <span className="section-count">{favoriteFiles.length}</span>
        </div>
        <div className="nav-list">
          {favoriteFiles.slice(0, 10).map((fav) => (
            <div key={fav.path} className="nav-item" onClick={() => go(fav.path, true)} title={fav.path}>
              <Star size={13} className="nav-icon" />
              <span style={ellipsis}>{fav.name}</span>
            </div>
          ))}
        </div>
      </div>
    );

  // Subfolders of the open folder. Hidden when there are none.
  const subfoldersSection = () =>
    folders.length > 0 && (
      <div>
        <div className="sidebar-section-title">
          <span>Subfolders</span>
          <span className="section-count">{folders.length}</span>
        </div>
        <div className="nav-list">
          {folders.map((f) => (
            <div key={f.path} className="nav-item" onClick={() => go(f.path)} onContextMenu={(e) => openMenu(e, f)} title={f.path}>
              <FolderIcon item={f} size={14} className="nav-icon" style={{ flexShrink: 0 }} />
              <span style={ellipsis}>{f.name}</span>
              <ChevronRight size={11} style={{ opacity: 0.3 }} />
            </div>
          ))}
        </div>
      </div>
    );

  const blenderReady = !!blenderStatus?.available;
  const blenderTitle = blenderReady
    ? 'Blender converter is ready (for ABC and USD). Click to configure.'
    : 'Blender converter is not set up. Click to configure (needed for ABC and USD).';

  if (pro) {
    return (
      <aside className="sidebar sidebar-pro">
        <div className="sidebar-brand">
          <div className="brand-mark">
            <Layers size={13} />
          </div>
          <span>CG Artist File Browser</span>
        </div>
        <div className="sidebar-scroll">
          {drivesSection()}
          {networkSection()}
          {recentSection()}
          {pinnedSection()}
          {starredSection()}
          {subfoldersSection()}
        </div>
        <div className="sidebar-foot">
          <button className="foot-btn" onClick={onOpenFolderPicker} title="Open Folder...">
            <FolderOpen size={14} />
            <span>Open</span>
          </button>
          <button className={`foot-btn ach-foot is-m${ach.rank.m}`} onClick={onOpenAchievements} title={achTitle} aria-label={achTitle}>
            <Trophy size={14} />
            <span className="ach-nav-lv">Lv {ach.level}</span>
          </button>
          <button className="foot-btn icon" onClick={onOpenGuide} title="Help: open the user guide in your browser" aria-label="Help">
            <CircleHelp size={14} />
          </button>
          <button className="foot-btn icon" onClick={onOpenSettings} title={updateTitle || 'Studio Preferences & Configuration'} aria-label="Settings">
            <SlidersHorizontal size={14} />
            {updateTitle && <span className="update-dot" />}
          </button>
          <button className="foot-blender" onClick={onOpenSettings} title={blenderTitle} aria-label={blenderTitle}>
            <span className={`blender-dot ${blenderReady ? 'ready' : ''}`} />
            <span>Blender {blenderReady ? 'ready' : 'setup'}</span>
          </button>
        </div>
      </aside>
    );
  }

  const railButton = (key, label, Icon) => (
    <button
      key={key}
      className={`rail-btn ${flyout === key ? 'active' : ''}`}
      onClick={() => setFlyout((open) => (open === key ? null : key))}
      title={label}
      aria-label={label}
      aria-expanded={flyout === key}
    >
      <Icon size={19} strokeWidth={1.7} />
    </button>
  );

  return (
    <>
      <nav className="sidebar sidebar-rail" ref={railRef} aria-label="Places">
        <div className="brand-mark rail-brand" title="CG Artist File Browser">
          <Layers size={14} />
        </div>
        <button className="rail-btn" onClick={onOpenFolderPicker} title="Open Folder..." aria-label="Open Folder">
          <FolderOpen size={19} strokeWidth={1.7} />
        </button>
        {railButton('locations', 'Drives and network', FLYOUTS.locations.icon)}
        {railButton('folders', 'Subfolders and pinned folders', FLYOUTS.folders.icon)}
        {railButton('recent', 'Recent folders', FLYOUTS.recent.icon)}
        {railButton('starred', 'Starred assets', FLYOUTS.starred.icon)}
        {drives.length > 0 && <div className="rail-sep" />}
        {/* Every drive is one click away, with a bar for how full it is */}
        <div className="rail-drives">
          {drives.map((d) => {
            const Icon = d.isNetwork ? Network : HardDrive;
            const letter = d.mount.replace(/[:\\/]+$/, '') || d.mount;
            return (
              <button
                key={d.mount}
                className={`rail-drive ${isOnDrive(d, currentPath) ? 'active' : ''}`}
                onClick={() => go(d.name)}
                title={`${d.isNetwork ? networkDriveName(d) : d.mount} ${d.label || ''}${d.freeGB ? ` · ${d.freeGB} GB free` : ''}`}
                aria-label={`Open drive ${d.mount}`}
              >
                <Icon size={12} />
                <span>{letter}</span>
                <DriveBar drive={d} />
              </button>
            );
          })}
        </div>
        <div className="rail-spacer" />
        <button className={`rail-btn ach-rail-btn is-m${ach.rank.m}`} onClick={onOpenAchievements} title={achTitle} aria-label={achTitle}>
          <Trophy size={19} strokeWidth={1.7} />
          <span className="ach-rail-lv">{ach.level}</span>
        </button>
        <button className="rail-btn" onClick={onOpenGuide} title="Help: open the user guide in your browser" aria-label="Help">
          <CircleHelp size={19} strokeWidth={1.7} />
        </button>
        <button className="rail-btn" onClick={onOpenSettings} title={`${updateTitle ? `${updateTitle}. ` : ''}Studio Preferences & Configuration. ${blenderTitle}`} aria-label="Settings">
          <SlidersHorizontal size={19} strokeWidth={1.7} />
          <span className={`blender-dot rail ${blenderReady ? 'ready' : ''}`} />
          {updateTitle && <span className="update-dot" />}
        </button>
      </nav>

      {flyout && (
        <div className="rail-flyout" ref={flyoutRef} role="dialog" aria-label={FLYOUTS[flyout].title}>
          {flyout === 'locations' && (
            <>
              {drivesSection()}
              {networkSection()}
            </>
          )}
          {flyout === 'folders' && (
            <>
              {pinnedSection()}
              {subfoldersSection()}
              {!starredFolders.length && !folders.length && <div className="nav-empty">No subfolders or pinned folders</div>}
            </>
          )}
          {flyout === 'recent' && (recentFolders?.length ? recentSection() : <div className="nav-empty">No recent folders yet</div>)}
          {flyout === 'starred' && (favoriteFiles.length ? starredSection() : <div className="nav-empty">Star a file to find it here</div>)}
        </div>
      )}
    </>
  );
}
