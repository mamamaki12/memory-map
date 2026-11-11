import React, { useEffect, useId, useRef } from 'react';

// A dialog in the app's own look. Esc closes it (unless something is running).
export function Modal({ title, onClose, busy, className, closeButton = true, role, children }) {
  const ref = useRef(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    const opener = document.activeElement;
    dialog.showModal();
    return () => {
      dialog.close();
      // The dialog leaves the page when it closes, so put the focus back on the button that opened it.
      if (opener?.isConnected && (!document.activeElement || document.activeElement === document.body)) opener.focus({ preventScroll: true });
    };
  }, []);
  // stopPropagation: a dialog opened from inside another one (the friends screen) closes alone.
  return <dialog ref={ref} className={className} role={role} aria-labelledby={titleId} onCancel={event => { event.preventDefault(); event.stopPropagation(); if (!busy) onClose(); }}>
    <div className="dialog-head"><h2 id={titleId}>{title}</h2>{closeButton && <button disabled={busy} onClick={onClose} aria-label="閉じる">×</button>}</div>
    {children}
  </dialog>;
}

// Asking before something that is hard to undo: "やめる" is chosen first, Esc also stops.
export function ConfirmDialog({ title, text, confirmLabel, busyLabel, busy, onCancel, onConfirm }) {
  return <Modal title={title} className="confirm-dialog" role="alertdialog" closeButton={false} busy={busy} onClose={onCancel}>
    {/* Each part up to a 、 or 。 stays on one line, so a line never ends with one or two lonely characters. */}
    <p className="confirm-text">{text.split(/(?<=[、。])/).map((part, index) => <span key={index} className="phrase">{part}</span>)}</p>
    <div className="confirm-actions">
      <button autoFocus disabled={busy} onClick={onCancel}>やめる</button>
      <button className="danger-fill" disabled={busy} onClick={onConfirm}>{busy ? busyLabel : confirmLabel}</button>
    </div>
  </Modal>;
}
