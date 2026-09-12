'use client';

// ============================================================
// نظام الإشعارات المنبثقة الجانبية (Toast)
// رسالة صغيرة وواضحة تظهر جانبياً وتختفي تلقائياً بعد ثوانٍ،
// ليعرف المستخدم أن العملية التي نفذها تمت بنجاح (أو فشلت).
// ============================================================

import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';

export type ToastTone = 'success' | 'error' | 'info' | 'warn';

export interface ToastItem {
  id: number;
  tone: ToastTone;
  title: string;
  message?: string;
}

interface ToastContextValue {
  push: (tone: ToastTone, title: string, message?: string) => void;
  success: (title: string, message?: string) => void;
  error: (title: string, message?: string) => void;
  info: (title: string, message?: string) => void;
  warn: (title: string, message?: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const ICONS: Record<ToastTone, string> = {
  success: '✓',
  error: '✕',
  info: 'ℹ',
  warn: '⚠',
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const counter = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((old) => old.filter((t) => t.id !== id));
  }, []);

  const push = useCallback((tone: ToastTone, title: string, message?: string) => {
    counter.current += 1;
    const id = counter.current;
    setToasts((old) => [...old.slice(-4), { id, tone, title, message }]);
    window.setTimeout(() => dismiss(id), 4000);
  }, [dismiss]);

  const value = useMemo<ToastContextValue>(() => ({
    push,
    success: (t, m) => push('success', t, m),
    error: (t, m) => push('error', t, m),
    info: (t, m) => push('info', t, m),
    warn: (t, m) => push('warn', t, m),
  }), [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-region" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.tone}`}>
            <span className="toast-icon">{ICONS[t.tone]}</span>
            <div className="toast-body">
              <strong className="toast-title">{t.title}</strong>
              {t.message ? <span className="toast-message">{t.message}</span> : null}
            </div>
            <button type="button" className="toast-close" aria-label="إغلاق" onClick={() => dismiss(t.id)}>✕</button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside ToastProvider');
  return ctx;
}
