'use client';

import Link from 'next/link';
import type { ButtonHTMLAttributes, HTMLAttributes, InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { arabicError } from '@/lib/utils';

export function Button({ variant = 'primary', className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'danger' | 'ghost' }) {
  const cls = ['btn', variant !== 'primary' ? variant : '', className].filter(Boolean).join(' ');
  return <button {...props} className={cls} />;
}

export function LinkButton({ href, variant = 'primary', className = '', children }: { href: string; variant?: 'primary' | 'secondary' | 'danger' | 'ghost'; className?: string; children: React.ReactNode }) {
  const cls = ['btn', variant !== 'primary' ? variant : '', className].filter(Boolean).join(' ');
  return <Link href={href} className={cls}>{children}</Link>;
}

export function Input({ label, help, ...props }: InputHTMLAttributes<HTMLInputElement> & { label: string; help?: string }) {
  return (
    <label className="input-wrap">
      <span className="label">{label}</span>
      <input {...props} className={`input ${props.className ?? ''}`} />
      {help ? <span className="tiny muted">{help}</span> : null}
    </label>
  );
}

export function Textarea({ label, help, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string; help?: string }) {
  return (
    <label className="input-wrap">
      <span className="label">{label}</span>
      <textarea {...props} className={`textarea ${props.className ?? ''}`} />
      {help ? <span className="tiny muted">{help}</span> : null}
    </label>
  );
}

export function Select({ label, help, children, ...props }: SelectHTMLAttributes<HTMLSelectElement> & { label: string; help?: string; children: React.ReactNode }) {
  return (
    <label className="input-wrap">
      <span className="label">{label}</span>
      <select {...props} className={`select ${props.className ?? ''}`}>{children}</select>
      {help ? <span className="tiny muted">{help}</span> : null}
    </label>
  );
}

export function Card({ children, className = '', ...props }: HTMLAttributes<HTMLElement> & { children: React.ReactNode }) {
  return <section {...props} className={`card ${className}`}>{children}</section>;
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: React.ReactNode }) {
  return (
    <div className="row-between topbar">
      <div>
        <h1 className="h2">{title}</h1>
        {subtitle ? <p className="muted" style={{ margin: '8px 0 0' }}>{subtitle}</p> : null}
      </div>
      {actions ? <div className="row">{actions}</div> : null}
    </div>
  );
}

export function Badge({ children, tone = 'default' }: { children: React.ReactNode; tone?: 'default' | 'success' | 'warn' | 'danger' | 'info' }) {
  return <span className={`badge ${tone !== 'default' ? tone : ''}`}>{children}</span>;
}

export function Notice({ children, tone = 'default' }: { children: React.ReactNode; tone?: 'default' | 'success' | 'warn' | 'error' | 'info' }) {
  return <div className={`notice ${tone}`}>{children}</div>;
}

export function ErrorNotice({ error }: { error: unknown }) {
  if (!error) return null;
  return <Notice tone="error">{arabicError(error)}</Notice>;
}

export function EmptyState({ title = 'لا توجد بيانات بعد', body, action }: { title?: string; body?: string; action?: React.ReactNode }) {
  return (
    <div className="card soft" style={{ textAlign: 'center', padding: 34 }}>
      <div style={{ fontSize: 42, marginBottom: 10 }}>⌁</div>
      <h3 className="h3">{title}</h3>
      {body ? <p className="muted">{body}</p> : null}
      {action ? <div className="row" style={{ justifyContent: 'center', marginTop: 16 }}>{action}</div> : null}
    </div>
  );
}

export function LoadingScreen({ text = 'جاري التحميل...' }: { text?: string }) {
  return (
    <div className="auth-page">
      <div className="card auth-card" style={{ textAlign: 'center' }}>
        <div className="logo" style={{ margin: '0 auto 16px' }}>MR</div>
        <h1 className="h3">{text}</h1>
        <p className="muted">نجهز الجلسة ونقرأ صلاحيات المستخدم.</p>
      </div>
    </div>
  );
}

export function formatStatus(status: string | null | undefined): { text: string; tone: 'default' | 'success' | 'warn' | 'danger' | 'info' } {
  if (status === 'active' || status === 'paid' || status === 'graded' || status === 'approved') return { text: status === 'paid' ? 'مسدد' : status === 'approved' ? 'معتمد' : status === 'graded' ? 'مصحح' : 'نشط', tone: 'success' };
  if (status === 'pending' || status === 'partial' || status === 'pending_review') return { text: status === 'partial' ? 'جزئي' : status === 'pending_review' ? 'ينتظر التصحيح' : 'معلق', tone: 'warn' };
  if (status === 'suspended' || status === 'expired' || status === 'rejected' || status === 'absent') return { text: status === 'expired' ? 'منتهي' : status === 'rejected' ? 'مرفوض' : status === 'absent' ? 'غائب' : 'موقوف', tone: 'danger' };
  if (status === 'present') return { text: 'حاضر', tone: 'success' };
  if (status === 'late') return { text: 'متأخر', tone: 'warn' };
  if (status === 'archived') return { text: 'مؤرشف', tone: 'default' };
  return { text: status || '—', tone: 'default' };
}
