import React from 'react';
import { AlertTriangle, ExternalLink, ArrowRight, X } from 'lucide-react';

export default function DropErrorModal({
  errorInfo,
  onClose,
  onOpenInSuggestedViewer
}) {
  if (!errorInfo) return null;

  const { fileName, currentViewerTitle, expectedTypes, suggestedViewer, fileItem } = errorInfo;

  return (
    <div className="modal-overlay" onClick={onClose} style={{ zIndex: 1000 }}>
      <div
        className="modal-card"
        style={{
          width: 480,
          background: '#121212',
          border: '1px solid #3a3a3a',
          boxShadow: '0 16px 48px rgba(0, 0, 0, 0.9)',
          borderRadius: 8
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="modal-header"
          style={{
            background: '#181818',
            borderBottom: '1px solid #282828',
            padding: '12px 18px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div
              style={{
                width: 28,
                height: 28,
                borderRadius: '50%',
                background: '#2a1a1a',
                border: '1px solid #552222',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
            >
              <AlertTriangle size={15} color="#ff6666" />
            </div>
            <span style={{ fontWeight: 700, fontSize: 13, color: '#ffffff' }}>
              Unsupported File Format
            </span>
          </div>

          <button className="icon-btn" style={{ width: 24, height: 24 }} onClick={onClose}>
            <X size={14} />
          </button>
        </div>

        {/* Body */}
        <div className="modal-body" style={{ padding: '18px 20px', gap: 14 }}>
          {/* File Name Tag */}
          <div
            style={{
              background: '#181818',
              border: '1px solid #2a2a2a',
              borderRadius: 6,
              padding: '10px 14px',
              display: 'flex',
              flexDirection: 'column',
              gap: 4
            }}
          >
            <span style={{ fontSize: 11, color: '#888888' }}>Dropped File:</span>
            <span
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: '#ffffff',
                fontFamily: 'monospace',
                wordBreak: 'break-all'
              }}
            >
              {fileName}
            </span>
          </div>

          {/* Explanation */}
          <div style={{ fontSize: 12, lineHeight: 1.6, color: '#bbbbbb' }}>
            This file format is not supported for interactive viewport inspection:
            <div
              style={{
                marginTop: 6,
                padding: '6px 12px',
                background: '#161616',
                borderRadius: 4,
                border: '1px solid #242424',
                color: '#cccccc',
                fontSize: 11,
                fontFamily: 'monospace'
              }}
            >
              {expectedTypes}
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div
          className="modal-footer"
          style={{
            background: '#141414',
            borderTop: '1px solid #242424',
            padding: '12px 18px',
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 10
          }}
        >
          <button className="filter-btn" onClick={onClose} style={{ height: 32, fontSize: 12 }}>
            Cancel
          </button>

          {suggestedViewer && (
            <button
              className="dock-launch-btn"
              onClick={() => onOpenInSuggestedViewer(fileItem, suggestedViewer.viewMode)}
              style={{ height: 32, fontSize: 12 }}
            >
              <span>{suggestedViewer.buttonLabel}</span>
              <ArrowRight size={13} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
