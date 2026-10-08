import React, { useEffect, useRef, useState } from 'react';

// Address-bar style text box: type or paste a folder path (J:\Assets, \\mypc\library or //mypc/library).
// onSubmit resolves to an error message, or nothing when the navigation worked.
export default function PathInput({ initialValue, onSubmit, onCancel }) {
  const [value, setValue] = useState(initialValue || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    const message = await onSubmit(value);
    // On success the parent closes this box; keep it open with the reason otherwise
    setBusy(false);
    if (message) {
      setError(message);
      inputRef.current?.focus();
    }
  };

  return (
    <>
      <input
        ref={inputRef}
        className="path-input"
        value={value}
        spellCheck={false}
        placeholder="Type a path, e.g. \\mypc\library or J:\Assets"
        onChange={(e) => {
          setValue(e.target.value);
          setError('');
        }}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') {
            submit();
          } else if (e.key === 'Escape') {
            onCancel();
          }
        }}
        onBlur={() => {
          if (!busy) onCancel();
        }}
        readOnly={busy}
      />
      {busy && <span className="path-status">Connecting...</span>}
      {error && (
        <span className="path-status path-error" title={error}>
          {error}
        </span>
      )}
    </>
  );
}
