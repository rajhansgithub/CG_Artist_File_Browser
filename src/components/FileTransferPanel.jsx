import React from 'react';
import { Check, Info, X } from 'lucide-react';
import { formatBytes } from '../utils/formatHelpers';

const lastPart = (path) => String(path || '').split(/[\\/]/).filter(Boolean).pop() || String(path || '');

const STATUS_TEXT = {
  waiting: 'Waiting',
  working: 'Working...',
  cancelled: 'Cancelled'
};

function describe(job) {
  const count = job.rows.length;
  const what = count === 1 ? `"${job.rows[0].name}"` : `${count} items`;
  const ended = !!job.summary;
  const verb = job.mode === 'move' ? (ended ? 'Moved' : 'Moving') : ended ? 'Copied' : 'Copying';
  return `${verb} ${what} to ${lastPart(job.destDir)}`;
}

function summaryText(job) {
  const { done, failed, cancelled } = job.summary;
  const parts = [`${done} ${job.mode === 'move' ? 'moved' : 'copied'}`];
  if (failed) parts.push(`${failed} failed`);
  if (cancelled) parts.push('stopped early');
  return parts.join(' · ');
}

function Transfer({ job, onCancel, onDismiss }) {
  const total = job.rows.length;
  const finishedRows = job.rows.filter((row) => ['done', 'failed', 'cancelled'].includes(row.status)).length;
  const ended = !!job.summary;
  // Bytes drive the bar when the size of the whole job is known (a copy); a cut counts items
  const percent = ended
    ? 100
    : job.bytesTotal > 0
      ? Math.min(100, Math.round((job.bytesDone / job.bytesTotal) * 100))
      : total
        ? Math.round((finishedRows / total) * 100)
        : 0;
  const detail = ended
    ? summaryText(job)
    : job.bytesTotal > 0
      ? `${finishedRows} of ${total} · ${formatBytes(job.bytesDone)} of ${formatBytes(job.bytesTotal)}`
      : `${finishedRows} of ${total}`;
  // A list is only worth showing when there is something to tell apart: several items, or a failure
  const showRows = total > 1 || job.rows.some((row) => row.status === 'failed');
  const [cancelling, setCancelling] = React.useState(false);

  return (
    <div className="transfer-card">
      <div className="transfer-head">
        <span className="transfer-title" title={job.destDir}>
          {describe(job)}
        </span>
        {ended ? (
          <button type="button" className="icon-btn" style={{ width: 22, height: 22 }} onClick={onDismiss} title="Close">
            <X size={12} />
          </button>
        ) : (
          <button
            type="button"
            className="btn-secondary transfer-cancel"
            disabled={cancelling}
            onClick={() => {
              setCancelling(true);
              onCancel();
            }}
          >
            {cancelling ? 'Stopping...' : 'Cancel'}
          </button>
        )}
      </div>
      <div className="transfer-bar">
        <div className="transfer-bar-fill" style={{ width: `${percent}%` }} />
      </div>
      <div className="transfer-detail">
        {ended && !job.summary.failed && !job.summary.cancelled && <Check size={12} />}
        {detail}
      </div>
      {showRows && (
        <div className="transfer-rows">
          {job.rows.map((row) => (
            <div key={row.index} className="transfer-row">
              <span className="transfer-row-name" title={row.path}>
                {row.name}
              </span>
              <span
                className={`transfer-row-status ${row.status === 'failed' ? 'failed' : ''}`}
                title={row.error || row.outPath || ''}
              >
                {row.status === 'done' ? (job.mode === 'move' ? 'Moved' : 'Copied') : row.status === 'failed' ? row.error : STATUS_TEXT[row.status]}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Copies and moves in progress, in the corner over the folder view. It does not block the window: browsing, and starting
// more pastes, carry on while it works. A paste that went well closes itself; one with a failure stays until closed.
export default function FileTransferPanel({ jobs, onCancel, onDismiss }) {
  if (!jobs.length) return null;
  return (
    <div className="transfer-panel" role="status" aria-live="polite">
      {jobs.map((job) =>
        job.kind === 'notice' ? (
          <div key={job.id} className="transfer-card transfer-notice">
            <Info size={13} />
            <span>{job.text}</span>
          </div>
        ) : (
          <Transfer key={job.id} job={job} onCancel={() => onCancel(job.id)} onDismiss={() => onDismiss(job.id)} />
        )
      )}
    </div>
  );
}
