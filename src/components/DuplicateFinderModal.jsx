import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, CopyCheck, FolderOpen, FolderSearch, X } from 'lucide-react';
import { formatBytes } from '../utils/formatHelpers';
import { copyText } from '../utils/itemMenu';

const THRESHOLDS = [
  { value: 100, label: '100% (the same files only)' },
  { value: 95, label: '95% or more' },
  { value: 90, label: '90% or more' },
  { value: 80, label: '80% or more' },
  { value: 70, label: '70% or more' },
  { value: 60, label: '60% or more' },
  { value: 50, label: '50% or more' }
];

// Groups shown at first and added by each "Show more"; a big report stays quick to draw
const PAGE = 100;

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

const rowText = { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };
const muted = { fontSize: 12, color: 'var(--text-secondary)' };
const cardStyle = {
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-sm)',
  background: 'var(--bg-tertiary)',
  padding: '8px 10px',
  display: 'flex',
  flexDirection: 'column',
  gap: 6
};

const lastPart = (path) => String(path || '').replace(/[\\/]+$/, '').split(/[\\/]/).pop() || path;
const plural = (n, one, many) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

function tabStyle(active) {
  return active ? { background: 'var(--text-main)', color: 'var(--bg-elevated)', borderColor: 'var(--text-main)' } : undefined;
}

// Plain-text copy of the report for the clipboard
function reportText(report) {
  const lines = [];
  lines.push(
    `Duplicates in ${report.root} (${report.exact ? 'exact: same contents' : 'fast: same name and size'}, folders ${report.minScore}% or more alike)`
  );
  lines.push(
    `${plural(report.files, 'file', 'files')} in ${plural(report.folders, 'folder', 'folders')}, ${formatBytes(report.bytes)}. ${formatBytes(report.extraBytes)} in extra copies.`
  );
  lines.push('');
  lines.push(`Folder groups (${report.folderGroupsTotal})`);
  report.folderGroups.forEach((group, index) => {
    lines.push(`${index + 1}. ${group.score}% same, ${group.members.length} folders`);
    group.members.forEach((m) => {
      const diff = m.score < 100 ? `, ${m.score}%, ${m.missingCount} missing, ${m.extraCount} only here` : '';
      lines.push(`   ${m.path}  (${plural(m.files, 'file', 'files')}, ${formatBytes(m.bytes)}${diff})`);
    });
  });
  lines.push('');
  lines.push(`File copies (${report.fileGroupsTotal})`);
  report.fileGroups.forEach((group, index) => {
    lines.push(`${index + 1}. ${group.name}, ${formatBytes(group.size)}, ${group.paths.length} copies`);
    group.paths.forEach((p) => lines.push(`   ${p}`));
  });
  return lines.join('\n');
}

function IconButton({ title, onClick, children }) {
  return (
    <button type="button" className="icon-btn" style={{ width: 24, height: 24, flexShrink: 0 }} title={title} onClick={onClick}>
      {children}
    </button>
  );
}

function NameList({ title, names, count }) {
  if (!count) return null;
  return (
    <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
      <div style={{ color: 'var(--text-main)' }}>
        {title} ({count.toLocaleString()})
      </div>
      {names.map((name) => (
        <div key={name} style={rowText} title={name}>
          {name}
        </div>
      ))}
      {count > names.length && <div>and {(count - names.length).toLocaleString()} more</div>}
    </div>
  );
}

function FolderMemberRow({ member, reference, onOpenFolder, onReveal }) {
  const [open, setOpen] = useState(false);
  const differs = member.score < 100;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
        <span style={{ ...rowText, flex: 1 }} title={member.path}>
          {member.path}
        </span>
        <span style={{ ...muted, flexShrink: 0 }}>
          {plural(member.files, 'file', 'files')} · {formatBytes(member.bytes)}
        </span>
        {differs && (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 2, border: 'none', background: 'transparent', color: 'var(--text-main)', cursor: 'pointer', fontSize: 12, padding: 0 }}
            title="Show the files that differ"
          >
            {member.score}% alike {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </button>
        )}
        <IconButton title="Open folder" onClick={() => onOpenFolder(member.path)}>
          <FolderOpen size={13} />
        </IconButton>
        <IconButton title="Reveal in Explorer" onClick={() => onReveal(member.path)}>
          <FolderSearch size={13} />
        </IconButton>
      </div>
      {open && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingLeft: 12 }}>
          <NameList title={`In ${lastPart(reference)}, missing here`} names={member.missing} count={member.missingCount} />
          <NameList title="Only here" names={member.extra} count={member.extraCount} />
        </div>
      )}
    </div>
  );
}

function FolderGroupCard({ group, onOpenFolder, onReveal }) {
  const reference = group.members[0].path;
  return (
    <div style={cardStyle}>
      <div style={{ fontSize: 12, fontWeight: 600 }}>
        {group.members.length} folders · {group.score === 100 ? 'same files' : `${group.score}% or more alike`}
      </div>
      {group.members.map((member) => (
        <FolderMemberRow key={member.path} member={member} reference={reference} onOpenFolder={onOpenFolder} onReveal={onReveal} />
      ))}
    </div>
  );
}

function FileGroupCard({ group, onReveal }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={cardStyle}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{ display: 'flex', alignItems: 'center', gap: 6, border: 'none', background: 'transparent', color: 'var(--text-main)', cursor: 'pointer', padding: 0, fontSize: 12, textAlign: 'left' }}
      >
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        <span style={{ ...rowText, flex: 1, fontWeight: 600 }} title={group.name}>
          {group.name}
        </span>
        <span style={{ ...muted, flexShrink: 0 }}>
          {group.paths.length} copies · {formatBytes(group.size)} each
        </span>
      </button>
      {open &&
        group.paths.map((path) => (
          <div key={path} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, paddingLeft: 19 }}>
            <span style={{ ...rowText, flex: 1 }} title={path}>
              {path}
            </span>
            <IconButton title="Reveal in Explorer" onClick={() => onReveal(path)}>
              <FolderSearch size={13} />
            </IconButton>
          </div>
        ))}
    </div>
  );
}

// Right-click a folder > "Find duplicates…": lists the folders and files under it that are copies of each other.
// The scan runs in Rust (src-tauri/src/duplicates.rs). Report only: nothing is moved or deleted from here.
export default function DuplicateFinderModal({ folder, onOpenFolder, onReveal, onClose }) {
  const [exact, setExact] = useState(false);
  const [minScore, setMinScore] = useState(80);
  const [progress, setProgress] = useState(null); // { phase, done, total } while scanning
  const [report, setReport] = useState(null);
  const [error, setError] = useState('');
  const [stopping, setStopping] = useState(false);
  const [tab, setTab] = useState('folders');
  const [shown, setShown] = useState(PAGE);
  const [copied, setCopied] = useState(false);
  const jobIdRef = useRef(null);
  const unlistenRef = useRef(null);
  const running = progress !== null;

  const stopListening = () => {
    unlistenRef.current?.();
    unlistenRef.current = null;
  };

  // A scan still running when the window goes away is stopped
  useEffect(
    () => () => {
      stopListening();
      if (jobIdRef.current) window.electronAPI?.cancelDuplicateScan?.(jobIdRef.current);
    },
    []
  );

  const start = async () => {
    const jobId = `dupes-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    jobIdRef.current = jobId;
    setError('');
    setReport(null);
    setStopping(false);
    setShown(PAGE);
    setCopied(false);
    setProgress({ phase: 'listing', done: 0, total: 0 });

    // Listen before starting, so the first events cannot arrive before anyone is listening
    unlistenRef.current = await window.electronAPI.onDuplicateScanEvent((type, payload) => {
      if (payload.jobId !== jobIdRef.current) return;
      if (type === 'progress') {
        setProgress({ phase: payload.phase, done: payload.done, total: payload.total });
        return;
      }
      stopListening();
      jobIdRef.current = null;
      setProgress(null);
      setStopping(false);
      if (payload.report) {
        setReport(payload.report);
        setTab(payload.report.folderGroupsTotal || !payload.report.fileGroupsTotal ? 'folders' : 'files');
      } else if (payload.error) {
        setError(payload.error);
      }
    });

    const res = await window.electronAPI.startDuplicateScan(jobId, folder.path, { exact, minScore });
    if (!res.ok) {
      stopListening();
      jobIdRef.current = null;
      setProgress(null);
      setError(res.error);
    }
  };

  const stop = async () => {
    setStopping(true);
    await window.electronAPI.cancelDuplicateScan(jobIdRef.current);
  };

  const copyReport = async () => {
    setCopied(await copyText(reportText(report)));
  };

  const progressLine = () => {
    if (!progress) return '';
    if (progress.phase === 'listing') return `Listing files… ${progress.done.toLocaleString()} found`;
    if (progress.phase === 'reading') return `Reading file contents… ${formatBytes(progress.done)} of ${formatBytes(progress.total)}`;
    return 'Comparing folders…';
  };
  const fraction = progress && progress.phase !== 'listing' && progress.total ? Math.min(1, progress.done / progress.total) : null;

  const list = report ? (tab === 'folders' ? report.folderGroups : report.fileGroups) : [];
  const total = report ? (tab === 'folders' ? report.folderGroupsTotal : report.fileGroupsTotal) : 0;

  return (
    <div className="modal-overlay" onClick={running ? undefined : onClose}>
      <div className="modal-card" style={{ width: report ? 720 : 460, maxWidth: '92vw' }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
            <CopyCheck size={16} color="var(--text-main)" />
            <span style={rowText} title={folder.path}>
              Find duplicates in "{folder.name || lastPart(folder.path)}"
            </span>
          </div>
          <button type="button" className="icon-btn" style={{ width: 28, height: 28 }} onClick={onClose} disabled={running}>
            <X size={14} />
          </button>
        </div>

        {!running && !report && (
          <>
            <div className="modal-body">
              <div style={{ ...muted, ...rowText }} title={folder.path}>
                {folder.path}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={muted}>Check</div>
                {[
                  { value: false, title: 'Fast: same name and size', text: 'Reads no files. Quick, also on network drives.' },
                  {
                    value: true,
                    title: 'Exact: same contents',
                    text: 'Reads the files that share a size. Finds renamed copies. Slower on network drives.'
                  }
                ].map((option) => (
                  <label key={String(option.value)} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', cursor: 'pointer', fontSize: 12 }}>
                    <input type="radio" name="dupes-check" style={{ accentColor: 'var(--text-main)' }} checked={exact === option.value} onChange={() => setExact(option.value)} />
                    <span>
                      <span style={{ color: 'var(--text-main)' }}>{option.title}</span>
                      <br />
                      <span style={{ color: 'var(--text-secondary)' }}>{option.text}</span>
                    </span>
                  </label>
                ))}
              </div>
              <label style={muted}>
                Group folders that are alike by
                <select style={{ ...fieldStyle, marginTop: 4 }} value={minScore} onChange={(e) => setMinScore(Number(e.target.value))}>
                  {THRESHOLDS.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </label>
              <div style={muted}>Folder names don't matter, only the files inside. Nothing is moved or deleted.</div>
              {error && <div style={{ fontSize: 12, color: '#ff6666' }}>{error}</div>}
            </div>
            <div className="modal-footer">
              <button type="button" className="btn-secondary" onClick={onClose}>
                Cancel
              </button>
              <button type="button" className="btn-primary" onClick={start}>
                Find duplicates
              </button>
            </div>
          </>
        )}

        {running && (
          <>
            <div className="modal-body">
              <div style={{ height: 6, borderRadius: 3, background: 'var(--bg-tertiary)', overflow: 'hidden' }}>
                <div
                  style={{
                    width: fraction === null ? '100%' : `${Math.round(fraction * 100)}%`,
                    opacity: fraction === null ? 0.35 : 1,
                    height: '100%',
                    background: 'var(--accent-mid)',
                    transition: 'width 0.2s'
                  }}
                />
              </div>
              <div style={muted}>{stopping ? 'Stopping…' : progressLine()}</div>
            </div>
            <div className="modal-footer">
              <button type="button" className="btn-secondary" onClick={stop} disabled={stopping}>
                {stopping ? 'Stopping...' : 'Cancel'}
              </button>
            </div>
          </>
        )}

        {report && (
          <>
            <div className="modal-body">
              <div style={muted}>
                {plural(report.files, 'file', 'files')} in {plural(report.folders, 'folder', 'folders')} · {formatBytes(report.bytes)} ·{' '}
                {report.exact ? '' : 'about '}
                {formatBytes(report.extraBytes)} in extra copies
                {report.skipped ? ` · ${plural(report.skipped, 'item', 'items')} could not be read` : ''}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" className="btn-secondary" style={tabStyle(tab === 'folders')} onClick={() => { setTab('folders'); setShown(PAGE); }}>
                  Folders ({report.folderGroupsTotal.toLocaleString()})
                </button>
                <button type="button" className="btn-secondary" style={tabStyle(tab === 'files')} onClick={() => { setTab('files'); setShown(PAGE); }}>
                  Files ({report.fileGroupsTotal.toLocaleString()})
                </button>
              </div>
              {list.length === 0 ? (
                <div style={muted}>{tab === 'folders' ? 'No duplicate folders found.' : 'No other duplicate files found.'}</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {list.slice(0, shown).map((group) =>
                    tab === 'folders' ? (
                      <FolderGroupCard key={group.members[0].path} group={group} onOpenFolder={onOpenFolder} onReveal={onReveal} />
                    ) : (
                      <FileGroupCard key={group.paths[0]} group={group} onReveal={onReveal} />
                    )
                  )}
                  {list.length > shown && (
                    <button type="button" className="btn-secondary" style={{ alignSelf: 'center' }} onClick={() => setShown((n) => n + PAGE)}>
                      Show more
                    </button>
                  )}
                  {total > list.length && list.length <= shown && (
                    <div style={muted}>Showing the biggest {list.length.toLocaleString()} of {total.toLocaleString()}.</div>
                  )}
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button type="button" className="btn-secondary" onClick={copyReport}>
                {copied ? 'Copied' : 'Copy report'}
              </button>
              <button type="button" className="btn-secondary" onClick={() => setReport(null)}>
                Scan again
              </button>
              <button type="button" className="btn-primary" onClick={onClose}>
                Close
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
