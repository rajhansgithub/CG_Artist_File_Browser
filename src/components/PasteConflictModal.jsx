import React, { useEffect } from 'react';
import { Files, X } from 'lucide-react';

const SHOWN_NAMES = 5;

// Asked before a paste when some names already exist in the folder. Keep both is the safe default (the new ones get a
// number, like shot (1).exr); Replace overwrites files of the same name and merges folders.
export default function PasteConflictModal({ names, total, mode, onChoose, onClose }) {
  const shown = names.slice(0, SHOWN_NAMES);
  const more = names.length - shown.length;
  const verb = mode === 'move' ? 'move' : 'copy';

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" style={{ width: 440 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Files size={16} color="var(--text-main)" />
            <span>{names.length === 1 ? 'This name is already taken' : 'These names are already taken'}</span>
          </div>
          <button type="button" className="icon-btn" style={{ width: 28, height: 28 }} onClick={onClose}>
            <X size={14} />
          </button>
        </div>

        <div className="modal-body">
          <div style={{ fontSize: 13 }}>
            {names.length === 1
              ? `This folder already has "${shown[0]}".`
              : `This folder already has ${names.length} of the ${total} items you are about to ${verb}:`}
          </div>
          {names.length > 1 && (
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', wordBreak: 'break-all' }}>
              {shown.map((name) => (
                <div key={name}>{name}</div>
              ))}
              {more > 0 && <div>and {more} more</div>}
            </div>
          )}
          <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
            Keep both adds a number to the new name, like shot (1).exr. Replace overwrites files with the same name and
            merges folders; the old files cannot be restored.
          </div>
        </div>

        <div className="modal-footer">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn-danger" onClick={() => onChoose(true)}>
            Replace
          </button>
          <button type="button" className="btn-primary" autoFocus onClick={() => onChoose(false)}>
            Keep both
          </button>
        </div>
      </div>
    </div>
  );
}
