import React from 'react';
import { Box, SunMedium, Image as ImageIcon, Film, Volume2, Split, FolderOpen } from 'lucide-react';

export default function DragDropOverlay({ viewMode, dropTargetSlot }) {
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(8, 8, 8, 0.90)',
        backdropFilter: 'blur(8px)',
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        pointerEvents: 'none',
        border: '3px dashed #ffffff',
        margin: 12,
        borderRadius: 12,
        boxShadow: 'inset 0 0 40px rgba(0, 0, 0, 0.8), 0 0 30px rgba(255, 255, 255, 0.1)'
      }}
    >
      {viewMode === 'compare' ? (
        <div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%' }}>
          <div style={{ display: 'flex', flex: 1, width: '100%' }}>
            {/* Slot A Half */}
            <div
              style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                borderRight: '2px dashed #444444',
                background: dropTargetSlot === 'A' ? 'rgba(255, 255, 255, 0.08)' : 'transparent',
                transition: 'background 0.15s ease'
              }}
            >
              <div
                style={{
                  width: 60,
                  height: 60,
                  borderRadius: '50%',
                  background: '#222222',
                  border: '2px solid #ffffff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginBottom: 16
                }}
              >
                <span style={{ fontSize: 24, fontWeight: 900, color: '#ffffff' }}>A</span>
              </div>
              <div style={{ fontSize: 18, fontWeight: 700, color: '#ffffff', marginBottom: 6 }}>
                Drop for Slot A
              </div>
              <div style={{ fontSize: 12, color: '#888888' }}>
                Assign as left / primary comparison image
              </div>
            </div>

            {/* Slot B Half */}
            <div
              style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                background: dropTargetSlot === 'B' ? 'rgba(255, 255, 255, 0.08)' : 'transparent',
                transition: 'background 0.15s ease'
              }}
            >
              <div
                style={{
                  width: 60,
                  height: 60,
                  borderRadius: '50%',
                  background: '#222222',
                  border: '2px solid #888888',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginBottom: 16
                }}
              >
                <span style={{ fontSize: 24, fontWeight: 900, color: '#888888' }}>B</span>
              </div>
              <div style={{ fontSize: 18, fontWeight: 700, color: '#ffffff', marginBottom: 6 }}>
                Drop for Slot B
              </div>
              <div style={{ fontSize: 12, color: '#888888' }}>
                Assign as right / secondary comparison image
              </div>
            </div>
          </div>

          <div
            style={{
              padding: '12px 0',
              textAlign: 'center',
              fontSize: 11,
              color: '#888888',
              borderTop: '1px dashed #333333'
            }}
          >
            Drop 2D image or HDR to compare • 3D meshes & media auto-switch to full viewport
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div
              style={{
                width: 44,
                height: 44,
                borderRadius: '50%',
                background: '#1a1a1a',
                border: '1px solid #333',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
              title="3D Models"
            >
              <Box size={22} color="#00e5ff" />
            </div>
            <div
              style={{
                width: 44,
                height: 44,
                borderRadius: '50%',
                background: '#1a1a1a',
                border: '1px solid #333',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
              title="HDR & EXR 360 Maps"
            >
              <SunMedium size={22} color="#ffb300" />
            </div>
            <div
              style={{
                width: 44,
                height: 44,
                borderRadius: '50%',
                background: '#1a1a1a',
                border: '1px solid #333',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
              title="2D Images & Textures"
            >
              <ImageIcon size={22} color="#00e676" />
            </div>
            <div
              style={{
                width: 44,
                height: 44,
                borderRadius: '50%',
                background: '#1a1a1a',
                border: '1px solid #333',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
              title="Videos"
            >
              <Film size={22} color="#b388ff" />
            </div>
            <div
              style={{
                width: 44,
                height: 44,
                borderRadius: '50%',
                background: '#1a1a1a',
                border: '1px solid #333',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
              title="Audio"
            >
              <Volume2 size={22} color="#ff80ab" />
            </div>
          </div>

          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 20, fontWeight: 700, color: '#ffffff', marginBottom: 4 }}>
              Drop File to Inspect
            </div>

            <div style={{ fontSize: 13, color: '#00e5ff', fontWeight: 600, marginBottom: 6 }}>
              ⚡ Smart Auto-Switching Viewport
            </div>

            <div style={{ fontSize: 12, color: '#888888', fontFamily: 'monospace' }}>
              Seamlessly opens 3D models, HDR/EXR 360 skyboxes, images, video & audio
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
