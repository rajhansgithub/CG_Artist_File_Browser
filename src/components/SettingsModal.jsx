import React, { useState, useEffect } from 'react';
import { Settings, CheckCircle2, AlertCircle, Trash2, HardDrive, RefreshCw } from 'lucide-react';

export default function SettingsModal({ isOpen, onClose }) {
  const [blenderPath, setBlenderPath] = useState('');
  const [blenderStatus, setBlenderStatus] = useState(null);
  const [cacheStats, setCacheStats] = useState(null);
  const [statusMsg, setStatusMsg] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (isOpen) {
      loadSettings();
    }
  }, [isOpen]);

  const loadSettings = async () => {
    if (window.electronAPI) {
      const status = await window.electronAPI.getBlenderStatus();
      setBlenderStatus(status);
      setBlenderPath(status.path || '');

      const stats = await window.electronAPI.getCacheStats();
      setCacheStats(stats);
    }
  };

  const handleBrowseBlenderPath = async () => {
    if (window.electronAPI?.openFileDialog) {
      const filePath = await window.electronAPI.openFileDialog({
        filters: [
          { name: 'Blender Executable (blender.exe)', extensions: ['exe'] },
          { name: 'All Executables (*.exe)', extensions: ['exe'] },
          { name: 'All Files (*.*)', extensions: ['*'] }
        ]
      });
      if (filePath) {
        setBlenderPath(filePath);
      }
    }
  };

  const handleSaveBlenderPath = async () => {
    if (!window.electronAPI) return;
    setSaving(true);
    setStatusMsg('');
    try {
      const res = await window.electronAPI.setBlenderPath(blenderPath);
      if (res && res.success) {
        setStatusMsg('Blender path updated successfully!');
        loadSettings();
      } else {
        setStatusMsg(`Error: ${res?.error || 'Path does not exist'}`);
      }
    } catch (err) {
      setStatusMsg(`Error: ${err?.message || err}`);
    }
    setSaving(false);
  };

  const handleClearCache = async () => {
    if (!window.electronAPI) return;
    try {
      const res = await window.electronAPI.clearCache();
      if (res && (res.success || res === true)) {
        setStatusMsg('Cache cleared successfully!');
        loadSettings();
      } else {
        setStatusMsg(`Error: ${res?.error || 'Failed to clear cache'}`);
      }
    } catch (err) {
      setStatusMsg(`Error: ${err?.message || err}`);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Settings size={16} color="var(--text-main)" />
            <span>Studio Preferences & Configuration</span>
            <span className="version-badge">v1.0.1</span>
          </div>
          <button
            className="icon-btn"
            style={{ width: 28, height: 28 }}
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        <div className="modal-body">
          {/* Blender Integration Section */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-main)' }}>
              Blender Executable Path (for .abc & .usd conversion)
            </label>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
              Blender is used in background headless mode to import Alembic (.abc) and Universal Scene Description (.usd, .usdc, .usda) and convert them to high-speed GPU GLB previews.
            </div>

            <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
              <input
                type="text"
                className="search-input"
                style={{ paddingLeft: 12, fontFamily: 'var(--font-mono)', fontSize: 12, flex: 1 }}
                placeholder="C:\Program Files\Blender Foundation\Blender\blender.exe"
                value={blenderPath}
                onChange={(e) => setBlenderPath(e.target.value)}
              />
              <button
                className="btn-secondary"
                onClick={handleBrowseBlenderPath}
                title="Browse for blender.exe"
                style={{ whiteSpace: 'nowrap' }}
              >
                Browse...
              </button>
              <button className="btn-primary" onClick={handleSaveBlenderPath} disabled={saving}>
                Save
              </button>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
              {blenderStatus?.available ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--accent-emerald)', fontSize: 12 }}>
                  <CheckCircle2 size={14} />
                  <span>Blender is detected and ready for .abc / .usd conversion</span>
                </div>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#ef4444', fontSize: 12 }}>
                  <AlertCircle size={14} />
                  <span>Blender not found. Please provide path to blender.exe</span>
                </div>
              )}
            </div>
          </div>

          <div style={{ height: 1, background: 'var(--border-subtle)' }} />

          {/* Cache Management */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-main)' }}>
              Asset Cache Management
            </label>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
              The studio caches converted 3D GLBs and rendered thumbnails to make folder browsing instant.
            </div>

            {cacheStats && (
              <div
                style={{
                  background: 'var(--bg-tertiary)',
                  padding: '10px 14px',
                  borderRadius: 'var(--radius-sm)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  fontFamily: 'var(--font-mono)',
                  fontSize: 12
                }}
              >
                <div>
                  <span>Disk Used: </span>
                  <span style={{ color: '#ffffff', fontWeight: 600 }}>{cacheStats.sizeMB} MB</span>
                  <span style={{ margin: '0 8px', color: 'var(--border-medium)' }}>|</span>
                  <span>Cached Items: </span>
                  <span style={{ color: '#ffffff', fontWeight: 600 }}>{cacheStats.fileCount}</span>
                </div>
                <button
                  className="filter-btn"
                  onClick={handleClearCache}
                  style={{ color: '#ef4444' }}
                >
                  <Trash2 size={13} />
                  Clear Cache
                </button>
              </div>
            )}
          </div>

          <div style={{ height: 1, background: 'var(--border-subtle)' }} />

          {/* Supported Formats Info */}
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
              Supported File Formats
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 12 }}>
              <div style={{ background: 'var(--bg-tertiary)', padding: 10, borderRadius: 6 }}>
                <span style={{ color: '#ffffff', fontWeight: 600 }}>3D Formats:</span>
                <div style={{ color: 'var(--text-secondary)', marginTop: 4, lineHeight: 1.5 }}>
                  OBJ, FBX, GLTF, GLB, STL, PLY, USDZ, USD, USDC, USDA, ABC (Alembic)
                </div>
              </div>
              <div style={{ background: 'var(--bg-tertiary)', padding: 10, borderRadius: 6 }}>
                <span style={{ color: '#ffffff', fontWeight: 600 }}>HDR & Textures:</span>
                <div style={{ color: 'var(--text-secondary)', marginTop: 4, lineHeight: 1.5 }}>
                  Radiance HDR (.hdr), OpenEXR (.exr), PNG, JPG, WebP, TGA
                </div>
              </div>
            </div>
          </div>

          {statusMsg && (
            <div style={{ fontSize: 12, color: '#ffffff', fontWeight: 500 }}>
              {statusMsg}
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button className="btn-secondary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
