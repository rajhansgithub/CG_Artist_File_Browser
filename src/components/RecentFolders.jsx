import React from 'react';
import { History, X } from 'lucide-react';

// Last part of a folder path, e.g. "Textures" for J:\Assets\Textures. A drive root keeps its letter (J:\ -> "J:").
function recentFolderName(path) {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : path;
}

const SHOWN = 10;

// Folders opened lately, newest first. The list is hidden until a folder has been opened.
export default function RecentFolders({ paths, currentPath, onNavigate, onClear }) {
  if (!paths || paths.length === 0) {
    return null;
  }

  return (
    <div>
      <div className="sidebar-section-title">
        <span>RECENT FOLDERS</span>
        <button
          onClick={onClear}
          style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex' }}
          title="Clear recent folders"
        >
          <X size={11} />
        </button>
      </div>
      <div className="nav-list">
        {paths.slice(0, SHOWN).map((path) => (
          <div
            key={path}
            className={`nav-item ${currentPath && currentPath.toLowerCase() === path.toLowerCase() ? 'active' : ''}`}
            onClick={() => onNavigate(path)}
            title={path}
            style={{ display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <History size={12} color="var(--text-secondary)" style={{ flexShrink: 0 }} />
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {recentFolderName(path)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
