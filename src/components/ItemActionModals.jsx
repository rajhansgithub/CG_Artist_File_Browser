import React, { useEffect, useRef, useState } from 'react';
import { Pencil, Trash2, X } from 'lucide-react';

const fieldStyle = {
  width: '100%',
  boxSizing: 'border-box',
  height: 32,
  background: 'var(--bg-tertiary)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-sm)',
  padding: '0 12px',
  color: 'var(--text-main)',
  fontSize: 12
};

// Rename dialog for one file or folder. `onSubmit` resolves to an error message, or to null when the rename worked.
export function RenameItemModal({ item, onSubmit, onClose }) {
  const [name, setName] = useState(item.name);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const inputRef = useRef(null);

  // Selects the name without its extension, as File Explorer does
  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    const dot = item.isDirectory ? -1 : item.name.lastIndexOf('.');
    input.focus();
    input.setSelectionRange(0, dot > 0 ? dot : item.name.length);
  }, [item]);

  const submit = async (e) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (trimmed === item.name) return onClose();
    if (!trimmed) return setError('Enter a name');
    setBusy(true);
    setError('');
    const message = await onSubmit(trimmed);
    if (message) {
      setError(message);
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={busy ? undefined : onClose}>
      <form className="modal-card" style={{ width: 420 }} onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Pencil size={16} color="var(--text-main)" />
            <span>Rename</span>
          </div>
          <button type="button" className="icon-btn" style={{ width: 28, height: 28 }} onClick={onClose} disabled={busy}>
            <X size={14} />
          </button>
        </div>

        <div className="modal-body">
          <input
            ref={inputRef}
            type="text"
            style={fieldStyle}
            value={name}
            spellCheck={false}
            autoComplete="off"
            onChange={(e) => {
              setName(e.target.value);
              setError('');
            }}
          />
          {error && <div style={{ fontSize: 12, color: '#ff6666' }}>{error}</div>}
        </div>

        <div className="modal-footer">
          <button type="button" className="btn-secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={busy || !name.trim()}>
            {busy ? 'Renaming...' : 'Rename'}
          </button>
        </div>
      </form>
    </div>
  );
}

// Confirmation before anything is moved to the Recycle Bin. `onConfirm` resolves to an error message, or to null.
export function DeleteItemModal({ items, onConfirm, onClose }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const single = items.length === 1 ? items[0] : null;

  let title = `Delete ${items.length} items?`;
  let detail = 'The selected items will be moved to the Recycle Bin.';
  if (single) {
    title = `Delete "${single.name}"?`;
    detail = single.isDirectory
      ? 'The folder and everything inside it will be moved to the Recycle Bin.'
      : 'It will be moved to the Recycle Bin, so it can still be restored from there.';
  }

  const confirm = async () => {
    setBusy(true);
    setError('');
    const message = await onConfirm();
    if (message) {
      setError(message);
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={busy ? undefined : onClose}>
      <div className="modal-card" style={{ width: 420 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Trash2 size={16} color="#ff6666" />
            <span>Delete</span>
          </div>
          <button type="button" className="icon-btn" style={{ width: 28, height: 28 }} onClick={onClose} disabled={busy}>
            <X size={14} />
          </button>
        </div>

        <div className="modal-body">
          <div style={{ fontSize: 13, wordBreak: 'break-all' }}>{title}</div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{detail}</div>
          {error && <div style={{ fontSize: 12, color: '#ff6666' }}>{error}</div>}
        </div>

        <div className="modal-footer">
          <button type="button" className="btn-secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="btn-danger" onClick={confirm} disabled={busy}>
            {busy ? 'Deleting...' : 'Delete'}
          </button>
        </div>
      </div>
    </div>
  );
}
