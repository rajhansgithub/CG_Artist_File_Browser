import React, { useEffect } from 'react';
import { CheckCircle2, AlertCircle, RefreshCw, Download, ExternalLink } from 'lucide-react';
import {
  useUpdates,
  updatesAvailable,
  checkForUpdates,
  installUpdate,
  skipVersion,
  setAutoCheck,
  openReleasesPage,
  startUpdates,
  formatBytes,
  formatAgo,
} from '../utils/updateStore.js';

// Settings > Updates: check, see what's new, download and install (docs/UPDATES.md).
export default function UpdateSection() {
  const u = useUpdates();

  useEffect(() => {
    // Normally already started by the app; fills in the version and build kind if not
    startUpdates();
  }, []);

  if (!updatesAvailable()) return null;

  const kindLabel = u.info?.kind === 'portable' ? 'portable app' : u.info?.kind === 'installed' ? 'installed app' : 'development build';
  const busy = u.status === 'checking' || u.status === 'downloading' || u.status === 'installing';
  const pct = u.progress?.total ? Math.min(100, Math.round((u.progress.downloaded / u.progress.total) * 100)) : null;
  const hint = u.info?.kind === 'portable'
    ? 'The portable exe is replaced where it is. The old one is kept until the new one opens, and put back if it does not.'
    : 'The app closes, installs the update with a small progress bar and opens again. Your settings and files stay as they are.';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-main)' }}>
        Updates
      </label>
      <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
        You have {u.info ? `v${u.info.currentVersion}` : 'this version'}{u.info ? ` (${kindLabel})` : ''}. Every update is checked against our signature before it is installed.
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 4 }}>
        <button
          className="btn-secondary"
          onClick={() => checkForUpdates()}
          disabled={busy || u.info?.configured === false}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
        >
          <RefreshCw size={13} className={u.status === 'checking' ? 'spin-icon' : undefined} />
          {u.status === 'checking' ? 'Checking…' : 'Check for updates'}
        </button>

        {u.status === 'latest' && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--accent-emerald, #30d158)', fontSize: 12 }}>
            <CheckCircle2 size={14} />
            You have the latest version. Checked {formatAgo(u.lastCheck)}.
          </span>
        )}
        {u.info?.configured === false && (
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Updates are not set up in this build of the app.</span>
        )}
      </div>

      {u.found && ['available', 'downloading', 'installing', 'error'].includes(u.status) && (
        <div
          style={{
            background: 'var(--bg-tertiary)',
            padding: '10px 14px',
            borderRadius: 'var(--radius-sm)',
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            fontSize: 12,
          }}
        >
          <div style={{ color: 'var(--text-main)', fontWeight: 600 }}>
            Version {u.found.version} is available{u.found.date ? ` (released ${u.found.date})` : ''}.
            {u.found.version === u.skipped && <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}> You skipped this one.</span>}
          </div>
          {u.found.notes && (
            <div
              style={{
                color: 'var(--text-secondary)',
                whiteSpace: 'pre-wrap',
                lineHeight: 1.5,
                maxHeight: 140,
                overflowY: 'auto',
              }}
            >
              {u.found.notes}
            </div>
          )}

          {(u.status === 'downloading' || u.status === 'installing') && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ height: 4, borderRadius: 2, background: 'var(--bg-elevated)', overflow: 'hidden' }}>
                <div
                  style={{
                    height: '100%',
                    width: u.status === 'installing' ? '100%' : `${pct ?? 30}%`,
                    background: 'var(--accent, #0a84ff)',
                    transition: 'width 0.2s ease',
                  }}
                />
              </div>
              <div style={{ color: 'var(--text-secondary)' }}>
                {u.status === 'installing'
                  ? 'Checking the signature and installing. The app will close and open again…'
                  : `Downloading… ${formatBytes(u.progress?.downloaded ?? 0)}${u.progress?.total ? ` of ${formatBytes(u.progress.total)}` : ''}`}
              </div>
            </div>
          )}

          {(u.status === 'available' || u.status === 'error') && (
            <>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button
                  className="btn-primary"
                  onClick={installUpdate}
                  disabled={u.info?.kind === 'dev'}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
                >
                  <Download size={13} />
                  {u.status === 'error' ? 'Try again' : 'Download and install'}
                </button>
                {u.found.version !== u.skipped && (
                  <button className="btn-secondary" onClick={() => skipVersion(u.found.version)}>
                    Skip this version
                  </button>
                )}
              </div>
              <div style={{ color: 'var(--text-muted)' }}>{hint}</div>
            </>
          )}
        </div>
      )}

      {u.status === 'error' && u.error && (
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, color: '#ef4444', fontSize: 12 }}>
          <AlertCircle size={14} style={{ flex: 'none', marginTop: 1 }} />
          <span>{u.error}</span>
        </div>
      )}

      {u.status === 'error' && u.info?.releasesPage && (
        <div>
          <button className="btn-secondary" onClick={openReleasesPage} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <ExternalLink size={13} />
            Open the download page
          </button>
        </div>
      )}

      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text-secondary)', cursor: 'pointer' }}>
        <input type="checkbox" checked={u.auto} onChange={(e) => setAutoCheck(e.target.checked)} />
        Check once a day. Only the version number is fetched; nothing about you or your files is sent.
      </label>
    </div>
  );
}
