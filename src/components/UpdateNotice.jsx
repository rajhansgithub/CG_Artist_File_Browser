import React, { useEffect } from 'react';
import { CheckCircle2, AlertCircle, Download, X } from 'lucide-react';
import { useUpdates, closeNotice, dismissReport } from '../utils/updateStore.js';

// Small notice in the bottom-right corner: "updated to vX" after an update, "the update did not finish" when
// it failed, or "vX is available" when the daily check finds one. Never blocks the app.
export default function UpdateNotice({ onOpenSettings }) {
  const u = useUpdates();
  const report = u.report;

  // The "updated" notice goes away by itself; the others wait for the user
  useEffect(() => {
    if (report?.status !== 'updated') return undefined;
    const t = setTimeout(dismissReport, 12000);
    return () => clearTimeout(t);
  }, [report]);

  let body = null;
  if (report?.status === 'updated') {
    body = {
      icon: <CheckCircle2 size={16} color="#30d158" />,
      title: `Updated to v${report.to}`,
      text: report.notes ? report.notes.split('\n').find((l) => l.trim())?.replace(/^[-*•]\s*/, '') : `You were on v${report.from}.`,
      onClose: dismissReport,
    };
  } else if (report?.status === 'failed') {
    body = {
      icon: <AlertCircle size={16} color="#ef4444" />,
      title: `The update to v${report.to} did not finish`,
      text: `You are still on v${report.from}. You can try again in Settings.`,
      action: { label: 'Open Settings', run: () => { dismissReport(); onOpenSettings(); } },
      onClose: dismissReport,
    };
  } else if (u.noticeOpen && u.found && u.status === 'available') {
    body = {
      icon: <Download size={16} color="var(--accent, #0a84ff)" />,
      title: `Version ${u.found.version} is available`,
      text: 'See what is new and install it from Settings.',
      action: { label: 'View', run: () => { closeNotice(); onOpenSettings(); } },
      onClose: closeNotice,
      closeLabel: 'Later',
    };
  }
  if (!body) return null;

  return (
    <div className="update-notice" role="status" aria-live="polite">
      <div className="update-notice-icon">{body.icon}</div>
      <div className="update-notice-text">
        <div className="update-notice-title">{body.title}</div>
        {body.text && <div className="update-notice-sub">{body.text}</div>}
        {(body.action || body.closeLabel) && (
          <div className="update-notice-actions">
            {body.action && (
              <button className="btn-primary" onClick={body.action.run}>{body.action.label}</button>
            )}
            {body.closeLabel && (
              <button className="btn-secondary" onClick={body.onClose}>{body.closeLabel}</button>
            )}
          </div>
        )}
      </div>
      <button className="icon-btn update-notice-close" onClick={body.onClose} aria-label="Close" title="Close">
        <X size={13} />
      </button>
    </div>
  );
}
