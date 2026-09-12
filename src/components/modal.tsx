'use client';

// ============================================================
// نافذة منبثقة (Modal) لجميع نماذج الإدخال
// - لا تُغلق بالضغط على الخلفية أو زر الإغلاق مباشرة إذا كانت
//   هناك تعديلات غير محفوظة (dirty) — بل تعرض حوار حفظ/تجاهل/إلغاء.
// - تدعم Esc وزر الإغلاق والحفظ عبر الأزرار الداخلية.
// ============================================================

import React, { useCallback, useEffect } from 'react';
import { Button } from './ui';

export interface ModalProps {
  open: boolean;
  title: string;
  subtitle?: string;
  dirty?: boolean;
  onClose: () => void;
  onDiscard?: () => void;      // يُستدعى عند اختيار "تجاهل التعديلات"
  onSave?: () => void;         // يُستدعى عند اختيار "حفظ التعديلات"
  saveLabel?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  wide?: boolean;
}

export function Modal({
  open, title, subtitle, dirty = false, onClose, onDiscard, onSave, saveLabel = 'حفظ',
  children, footer, wide = false,
}: ModalProps) {
  const [confirming, setConfirming] = React.useState(false);

  const requestClose = useCallback(() => {
    if (dirty) {
      setConfirming(true);
      return;
    }
    setConfirming(false);
    onClose();
  }, [dirty, onClose]);

  const cancelConfirm = useCallback(() => setConfirming(false), []);

  const discard = useCallback(() => {
    setConfirming(false);
    if (onDiscard) onDiscard();
    onClose();
  }, [onDiscard, onClose]);

  const saveAndClose = useCallback(() => {
    if (onSave) onSave();
  }, [onSave]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') requestClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, requestClose]);

  useEffect(() => {
    if (!open) setConfirming(false);
  }, [open]);

  if (!open) return null;

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label={title} onClick={() => requestClose()}>
      <div className={`modal ${wide ? 'modal-wide' : ''}`} onClick={(e) => e.stopPropagation()}>
        {confirming ? (
          <div className="modal-confirm">
            <div className="logo" style={{ margin: '0 auto 10px' }}>؟</div>
            <h2 className="h3" style={{ textAlign: 'center' }}>لديك تعديلات غير محفوظة</h2>
            <p className="muted" style={{ textAlign: 'center', lineHeight: 1.8 }}>
              هل تريد حفظ التعديلات قبل الإغلاق، أم تجاهلها، أم البقاء في النموذج؟
            </p>
            <div className="stack" style={{ marginTop: 14 }}>
              <Button type="button" onClick={saveAndClose}>{saveLabel}</Button>
              <Button type="button" variant="secondary" onClick={discard}>تجاهل التعديلات والإغلاق</Button>
              <Button type="button" variant="ghost" onClick={cancelConfirm}>متابعة التعديل</Button>
            </div>
          </div>
        ) : (
          <>
            <div className="row-between modal-head">
              <div>
                <h2 className="h3">{title}</h2>
                {subtitle ? <p className="muted small" style={{ margin: '4px 0 0' }}>{subtitle}</p> : null}
              </div>
              <button type="button" className="toast-close" aria-label="إغلاق" onClick={() => requestClose()}>✕</button>
            </div>
            <div className="modal-body">{children}</div>
            {footer ? <div className="modal-foot">{footer}</div> : null}
          </>
        )}
      </div>
    </div>
  );
}

/** حوار تأكيد بسيط (بديل عن window.confirm بمظهر موحد) */
export function ConfirmDialog({ open, title, body, confirmLabel = 'تأكيد', danger = false, busy = false, onConfirm, onCancel }: {
  open: boolean;
  title: string;
  body?: string;
  confirmLabel?: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!open) return null;
  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" onClick={onCancel}>
      <div className="modal modal-sm" onClick={(e) => e.stopPropagation()}>
        <h2 className="h3">{title}</h2>
        {body ? <p className="muted" style={{ lineHeight: 1.8 }}>{body}</p> : null}
        <div className="row" style={{ justifyContent: 'flex-start', marginTop: 14 }}>
          <Button type="button" variant={danger ? 'danger' : 'primary'} disabled={busy} onClick={onConfirm}>
            {busy ? 'جارٍ...' : confirmLabel}
          </Button>
          <Button type="button" variant="secondary" onClick={onCancel}>إلغاء</Button>
        </div>
      </div>
    </div>
  );
}
