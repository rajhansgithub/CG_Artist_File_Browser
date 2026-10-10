import React from 'react';
import { AlertTriangle } from 'lucide-react';

// Tells the user why Help could not open the user guide, and where the guide is so they can open it by hand.
export default function GuideErrorModal({ message, onClose }) {
  if (!message) return null;

  return (
    <div className="modal-overlay" onClick={onClose} style={{ zIndex: 1000 }}>
      <div className="modal-card" style={{ width: 480 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <AlertTriangle size={16} color="#f59e0b" />
            <span>The user guide could not be opened</span>
          </div>
          <button className="icon-btn" style={{ width: 28, height: 28 }} onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="modal-body">
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5, wordBreak: 'break-word' }}>
            {message}
          </div>
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
