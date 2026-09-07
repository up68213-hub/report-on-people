import { useId } from 'react';
import { createPortal } from 'react-dom';
import { useDialogFocus } from './UiControls.jsx';

export default function Dialog({
  open, onClose, title, children, footer = null, wide = false,
  modalClassName = '', overlayClassName = '', modalRef = null,
  role = 'dialog', closeOnBackdrop = true, showClose = true,
  header = null, bodyClassName = '', footerClassName = '', ariaLabel,
}) {
  const titleId = useId();
  const focusRef = useDialogFocus(open, onClose);
  const assignRef = (node) => {
    focusRef.current = node;
    if (modalRef) modalRef.current = node;
  };
  if (!open) return null;

  return createPortal(<div className={`summary-overlay show ${overlayClassName}`.trim()} onMouseDown={(event) => {
    if (closeOnBackdrop && event.target === event.currentTarget) onClose?.();
  }}>
    <div ref={assignRef} tabIndex="-1" className={`summary-modal app-modal ${wide ? 'app-modal-wide' : ''} ${modalClassName}`.trim()}
      role={role} aria-modal="true" aria-label={ariaLabel} aria-labelledby={!ariaLabel && title ? titleId : undefined}>
      {header || <div className="summary-head">
        <div className="summary-title" id={titleId}>{title}</div>
        {showClose && <button type="button" className="summary-close" onClick={onClose} aria-label="Закрыть">×</button>}
      </div>}
      <div className={`summary-body ${bodyClassName}`.trim()}>{children}</div>
      {footer !== null && <div className={`summary-foot ${footerClassName}`.trim()}>{footer}</div>}
    </div>
  </div>, document.body);
}
