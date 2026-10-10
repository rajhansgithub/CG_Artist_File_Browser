import React, { useEffect, useRef, useState } from 'react';
import { FileOutput, FolderOpen, X } from 'lucide-react';

const FORMATS = [
  { id: 'png', label: 'PNG' },
  { id: 'jpg', label: 'JPG' },
  { id: 'tif', label: 'TIFF' },
  { id: 'bmp', label: 'BMP' },
  { id: 'tga', label: 'TGA' },
  { id: 'webp', label: 'WebP (lossless)' },
  { id: 'exr', label: 'EXR (float)' }
];

const EXR_PRECISIONS = [
  { id: 'half', label: 'Half float (16-bit)' },
  { id: 'float', label: 'Full float (32-bit)' }
];

const EXR_COMPRESSIONS = [
  { id: 'zip', label: 'ZIP (lossless)' },
  { id: 'piz', label: 'PIZ (lossless, grainy renders)' },
  { id: 'rle', label: 'RLE (lossless, fast)' },
  { id: 'none', label: 'None' }
];

const KIND_TEXT = { rgba: 'RGBA', rgb: 'RGB', xyz: 'XYZ', single: 'single channel' };

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

const STATUS_TEXT = {
  waiting: 'Waiting',
  converting: 'Converting...',
  cancelled: 'Cancelled'
};

const lastPart = (path) => String(path || '').split(/[\\/]/).pop();

// Right-click "Convert...": writes converted copies of the selected images. The work runs in Rust
// (src-tauri/src/batch_convert.rs), so this dialog only shows progress and can stop the batch.
export default function BatchConvertModal({ items, onClose }) {
  const [format, setFormat] = useState('png');
  const [outDir, setOutDir] = useState('');
  const [exrPrecision, setExrPrecision] = useState('half');
  const [exrCompression, setExrCompression] = useState('zip');
  const [exrAlpha, setExrAlpha] = useState(true);
  const [layer, setLayer] = useState(''); // '' picks the beauty layer of each EXR
  const [layerList, setLayerList] = useState(null); // layers of the EXR files among the items, once read
  const [rows, setRows] = useState(null); // null until the batch starts, then one row per file
  const [summary, setSummary] = useState(null); // { converted, failed, cancelled } once the batch ends
  const [error, setError] = useState('');
  const [stopping, setStopping] = useState(false);
  const jobIdRef = useRef(null);
  const unlistenRef = useRef(null);
  const running = rows !== null && !summary;

  // Stops listening if the dialog goes away mid-batch
  useEffect(() => () => unlistenRef.current?.(), []);

  // A multi-layer EXR lets the user pick which layer to convert; only the headers are read
  const hasExr = items.some((item) => (item.extension || '').toLowerCase() === '.exr');
  useEffect(() => {
    if (!hasExr) return undefined;
    let cancelled = false;
    window.electronAPI?.listExrLayers?.(items.map((item) => item.path)).then((listing) => {
      if (!cancelled) setLayerList(listing);
    });
    return () => {
      cancelled = true;
    };
  }, [items, hasExr]);
  const layers = layerList?.layers || [];
  const showLayerPicker = hasExr && layers.length > 1;

  const single = items.length === 1 ? items[0] : null;
  const title = single ? `Convert "${single.name}"` : `Convert ${items.length} files`;
  const done = rows ? rows.filter((row) => row.status === 'done' || row.status === 'failed' || row.status === 'cancelled').length : 0;

  const chooseFolder = async () => {
    const picked = await window.electronAPI?.openFolderDialog?.(outDir || items[0].path);
    if (picked) setOutDir(picked);
  };

  const stopListening = () => {
    unlistenRef.current?.();
    unlistenRef.current = null;
  };

  const start = async () => {
    const jobId = `batch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    jobIdRef.current = jobId;
    setError('');
    setRows(items.map((item, index) => ({ index, name: item.name, path: item.path, status: 'waiting' })));

    // Listen before starting, so the first events cannot arrive before anyone is listening
    unlistenRef.current = await window.electronAPI.onBatchConvertEvent((type, payload) => {
      if (payload.jobId !== jobIdRef.current) return;
      if (type === 'progress') {
        setRows((prev) =>
          prev &&
          prev.map((row) =>
            row.index === payload.index
              ? { ...row, status: payload.status, outPath: payload.outPath, error: payload.error }
              : row
          )
        );
      } else {
        setSummary({ converted: payload.converted, failed: payload.failed, cancelled: payload.cancelled });
        stopListening();
      }
    });

    const options = { exrLayer: showLayerPicker && layer ? layer : null, exrPrecision, exrCompression, exrAlpha };
    const res = await window.electronAPI.startBatchConvert(jobId, items.map((item) => item.path), format, outDir, options);
    if (!res.ok) {
      stopListening();
      setRows(null);
      setError(res.error);
    }
  };

  const stop = async () => {
    setStopping(true);
    await window.electronAPI.cancelBatchConvert(jobIdRef.current);
  };

  const summaryText = () => {
    if (!summary) return '';
    const parts = [`${summary.converted} converted`];
    if (summary.failed) parts.push(`${summary.failed} failed`);
    if (summary.cancelled) parts.push('stopped early');
    return parts.join(' · ');
  };

  return (
    <div className="modal-overlay" onClick={running ? undefined : onClose}>
      <div className="modal-card" style={{ width: 460 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <FileOutput size={16} color="var(--text-main)" />
            <span style={{ wordBreak: 'break-all' }}>{title}</span>
          </div>
          <button type="button" className="icon-btn" style={{ width: 28, height: 28 }} onClick={onClose} disabled={running}>
            <X size={14} />
          </button>
        </div>

        {rows === null ? (
          <>
            <div className="modal-body">
              <label style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                Format
                <select style={{ ...fieldStyle, marginTop: 4 }} value={format} onChange={(e) => setFormat(e.target.value)}>
                  {FORMATS.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.label}
                    </option>
                  ))}
                </select>
              </label>

              {format === 'exr' && (
                <>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <label style={{ fontSize: 12, color: 'var(--text-secondary)', flex: 1, minWidth: 0 }}>
                      Precision
                      <select style={{ ...fieldStyle, marginTop: 4 }} value={exrPrecision} onChange={(e) => setExrPrecision(e.target.value)}>
                        {EXR_PRECISIONS.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label style={{ fontSize: 12, color: 'var(--text-secondary)', flex: 1, minWidth: 0 }}>
                      Compression
                      <select style={{ ...fieldStyle, marginTop: 4 }} value={exrCompression} onChange={(e) => setExrCompression(e.target.value)}>
                        {EXR_COMPRESSIONS.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text-secondary)', cursor: 'pointer' }}>
                    <input type="checkbox" checked={exrAlpha} onChange={(e) => setExrAlpha(e.target.checked)} />
                    <span>Keep alpha when the picture has it</span>
                  </label>
                </>
              )}

              {showLayerPicker && (
                <label style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                  EXR layer
                  <select style={{ ...fieldStyle, marginTop: 4 }} value={layer} onChange={(e) => setLayer(e.target.value)}>
                    <option value="">Automatic (the beauty layer)</option>
                    {layers.map((l) => (
                      <option key={l.name} value={l.name}>
                        {l.name} · {KIND_TEXT[l.kind] || l.kind}
                        {layerList.read > 1 && l.files < layerList.read ? ` · in ${l.files} of ${layerList.read} files` : ''}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {hasExr && (
                <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                  {format === 'exr'
                    ? 'EXR and HDR values are kept as they are. Pictures from other formats are converted to linear light.'
                    : 'EXR and HDR images are tone mapped to 8-bit with the same curve as the thumbnails.'}
                  {showLayerPicker && layer && layerList.read > 1
                    ? ' A file without the picked layer fails on its own; the others still convert.'
                    : ''}
                </div>
              )}

              <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Output folder</div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <div
                  style={{ ...fieldStyle, display: 'flex', alignItems: 'center', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                  title={outDir || 'A converted folder next to each file'}
                >
                  {outDir || 'A "converted" folder next to each file'}
                </div>
                <button type="button" className="btn-secondary" onClick={chooseFolder}>
                  <FolderOpen size={14} /> Choose…
                </button>
                {outDir && (
                  <button type="button" className="btn-secondary" onClick={() => setOutDir('')}>
                    Reset
                  </button>
                )}
              </div>

              <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                Existing files are never overwritten. A taken name gets a number, like shot (1).png.
              </div>
              {error && <div style={{ fontSize: 12, color: '#ff6666' }}>{error}</div>}
            </div>

            <div className="modal-footer">
              <button type="button" className="btn-secondary" onClick={onClose}>
                Cancel
              </button>
              <button type="button" className="btn-primary" onClick={start}>
                Convert
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="modal-body">
              <div style={{ height: 6, borderRadius: 3, background: 'var(--bg-tertiary)', overflow: 'hidden' }}>
                <div
                  style={{
                    width: `${rows.length ? Math.round((done / rows.length) * 100) : 0}%`,
                    height: '100%',
                    background: 'var(--accent-mid)',
                    transition: 'width 0.2s'
                  }}
                />
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                {summary ? summaryText() : `${done} of ${rows.length}`}
              </div>

              <div style={{ maxHeight: 280, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
                {rows.map((row) => (
                  <div
                    key={row.index}
                    style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 12, padding: '2px 0' }}
                  >
                    <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={row.path}>
                      {row.name}
                    </span>
                    <span
                      style={{
                        flexShrink: 0,
                        color:
                          row.status === 'failed'
                            ? '#ff6666'
                            : row.status === 'done'
                              ? 'var(--text-secondary)'
                              : 'var(--text-muted)'
                      }}
                      title={row.error || row.outPath || ''}
                    >
                      {row.status === 'done'
                        ? `Saved as ${lastPart(row.outPath)}`
                        : row.status === 'failed'
                          ? `Failed: ${row.error}`
                          : STATUS_TEXT[row.status]}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="modal-footer">
              {summary ? (
                <button type="button" className="btn-primary" onClick={onClose}>
                  Close
                </button>
              ) : (
                <button type="button" className="btn-secondary" onClick={stop} disabled={stopping}>
                  {stopping ? 'Stopping...' : 'Cancel'}
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
