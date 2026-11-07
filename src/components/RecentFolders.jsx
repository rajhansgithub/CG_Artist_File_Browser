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
        <span>Recent</span>
        <button className="section-action" onClick={onClear} title="Clear recent folders">
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
          >
            <History size={14} className="nav-icon" />
            <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {recentFolderName(path)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
