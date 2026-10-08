import React, { useEffect, useRef, useState } from 'react';
import { Network } from 'lucide-react';
import { parseNetworkError } from '../utils/networkErrors';

// "Connect to network folder": sign in to a share with a username and password. With "Remember" ticked
// the password is kept in Windows Credential Manager and the share reconnects every time the app starts.
// onConnect resolves to the opened path; it rejects with the reason when Windows refuses.
export default function ConnectNetworkModal({ initialPath, onClose, onConnect }) {
  const [path, setPath] = useState(initialPath || '');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const firstFieldRef = useRef(null);

  useEffect(() => {
    firstFieldRef.current?.focus();
  }, []);

  const submit = async (e) => {
    e?.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await onConnect({ path, username, password, remember });
    } catch (err) {
      setError(parseNetworkError(err?.message || err).text);
      setBusy(false);
    }
  };

  const labelStyle = { fontSize: 12, fontWeight: 600, color: 'var(--text-main)' };
  const inputStyle = { paddingLeft: 12, fontFamily: 'var(--font-mono)', fontSize: 12 };

  return (
    <div className="modal-overlay" onClick={busy ? undefined : onClose}>
      <form className="modal-card" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Network size={16} color="var(--text-main)" />
            <span>Connect to network folder</span>
          </div>
          <button type="button" className="icon-btn" style={{ width: 28, height: 28 }} onClick={onClose} disabled={busy}>
            ✕
          </button>
        </div>

        <div className="modal-body">
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
            Use this when File Explorer opens a shared folder but this app cannot. Windows keeps sign-ins separate for
            each program, so the app needs the username and password once.
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={labelStyle}>Network folder</label>
            <input
              ref={firstFieldRef}
              type="text"
              className="search-input"
              style={inputStyle}
              placeholder="\\mypc\library"
              value={path}
              spellCheck={false}
              onChange={(e) => setPath(e.target.value)}
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={labelStyle}>Username</label>
            <input
              type="text"
              className="search-input"
              style={inputStyle}
              placeholder="the Windows account on that PC"
              value={username}
              spellCheck={false}
              autoComplete="off"
              onChange={(e) => setUsername(e.target.value)}
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={labelStyle}>Password</label>
            <input
              type="password"
              className="search-input"
              style={inputStyle}
              value={password}
              autoComplete="off"
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 12, color: 'var(--text-secondary)', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={remember}
              style={{ marginTop: 2 }}
              onChange={(e) => setRemember(e.target.checked)}
            />
            <span>
              Always stay connected. The password is kept in Windows Credential Manager, not in the app's files, and
              the folder reconnects every time the app starts.
            </span>
          </label>

          {error && <div style={{ fontSize: 12, color: '#f28b82', lineHeight: 1.5 }}>{error}</div>}
        </div>

        <div className="modal-footer">
          <button type="button" className="btn-secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={busy || !path.trim() || !username.trim()}>
            {busy ? 'Connecting...' : 'Connect'}
          </button>
        </div>
      </form>
    </div>
  );
}
