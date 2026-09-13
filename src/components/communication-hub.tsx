'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSession } from '@/context/session';
import { fetchMyCommunicationSummary, markMyCommunicationNotificationRead } from '@/lib/api';
import type { CommunicationBucket, CommunicationItem, CommunicationSummary } from '@/lib/types';
import { formatDate } from '@/lib/utils';
import { ThemeToggle } from './theme-toggle';

const emptySummary: CommunicationSummary = {
  notifications: { unread: 0, items: [] },
  messages: { unread: 0, items: [] },
};

type Area = 'admin' | 'student' | 'developer';
type OpenPanel = 'notifications' | 'messages' | null;

function fallbackRoute(area: Area, panel: Exclude<OpenPanel, null>): string | null {
  if (area === 'student') return panel === 'notifications' ? '/student/notifications' : '/student/inquiries';
  if (area === 'admin') return panel === 'notifications' ? '/admin/dev-notices' : '/admin/support';
  return panel === 'messages' ? '/developer/support' : '/developer/broadcast';
}

function shortBody(body: string): string {
  return body.length > 96 ? `${body.slice(0, 96)}…` : body;
}

function CommunicationPanel({
  label, bucket, fallback, onNavigate,
}: {
  label: string;
  bucket: CommunicationBucket;
  fallback: string | null;
  onNavigate: () => void;
}) {
  return <div className="communication-panel" role="dialog" aria-label={label}>
    <div className="communication-panel-head"><strong>{label}</strong><span>{bucket.unread} جديد</span></div>
    {bucket.items.length === 0 ? <p className="communication-empty">لا توجد عناصر غير مقروءة.</p> : <div className="communication-items">{bucket.items.map((item) => <Link key={`${item.kind}-${item.id}`} href={item.route} className="communication-item" onClick={onNavigate}>
      <span className={`communication-item-icon ${item.presentation === 'urgent' ? 'urgent' : ''}`}>{item.presentation === 'urgent' ? '!' : item.kind === 'support_message' || item.kind === 'developer_message' ? '✉' : '●'}</span>
      <span className="communication-item-copy"><strong>{item.title}</strong><small>{shortBody(item.body)}</small><time>{formatDate(item.created_at)}</time></span>
    </Link>)}</div>}
    {fallback ? <Link className="communication-all" href={fallback} onClick={onNavigate}>فتح القسم المختص ←</Link> : null}
  </div>;
}

/**
 * شريط موحد أعلى مساحة العمل، لا يضع إشعارات أو رسائل المستخدم داخل القائمة الجانبية.
 * المصدر خادمي واحد: يعيد العدادات والعناصر المسموح بها للحساب فقط.
 */
export function CommunicationHub({ area }: { area: Area }) {
  const pathname = usePathname();
  const router = useRouter();
  const { profile, signOut } = useSession();
  const [summary, setSummary] = useState<CommunicationSummary>(emptySummary);
  const [open, setOpen] = useState<OpenPanel>(null);
  const [urgent, setUrgent] = useState<CommunicationItem | null>(null);

  const reload = useCallback(async () => {
    if (!profile) { setSummary(emptySummary); return; }
    try {
      const next = await fetchMyCommunicationSummary();
      setSummary(next);
      setUrgent((current) => {
        const firstUrgent = next.notifications.items.find((item) => item.presentation === 'urgent') ?? null;
        if (!firstUrgent) return null;
        return firstUrgent.id !== current?.id ? firstUrgent : current;
      });
    } catch {
      // لا تعطل التصفح لو لم يطبق ترحيل مركز التواصل بعد أو انقطع الاتصال لحظياً.
    }
  }, [profile]);

  useEffect(() => {
    void reload();
    const changed = () => { void reload(); };
    window.addEventListener('mrcenter:communication-changed', changed);
    const timer = window.setInterval(changed, 45000);
    return () => { window.removeEventListener('mrcenter:communication-changed', changed); window.clearInterval(timer); };
  }, [pathname, reload]);

  const urgentTitle = useMemo(() => urgent?.title ?? '', [urgent]);
  const handleLogout = async () => { await signOut(); router.replace('/'); };
  const acknowledgeUrgent = async (openTarget: boolean) => {
    if (!urgent) return;
    try { await markMyCommunicationNotificationRead(urgent.id); } catch { /* تعرض الصفحة الأصلية الرسالة إن تعذر التعليم */ }
    const target = urgent.route;
    setUrgent(null);
    if (openTarget) router.push(target);
  };

  return <>
    <header className="communication-hub no-print" aria-label="الإشعارات والرسائل والحساب">
      <div className="communication-hub-context"><span className="communication-hub-dot" /><span>مركز التواصل</span></div>
      <div className="communication-actions">
        <div className="communication-action-wrap">
          <button type="button" className={`communication-action ${open === 'notifications' ? 'active' : ''}`} onClick={() => setOpen((current) => current === 'notifications' ? null : 'notifications')} aria-label={`الإشعارات، ${summary.notifications.unread} غير مقروءة`} aria-expanded={open === 'notifications'}>
            <span aria-hidden="true">🔔</span>{summary.notifications.unread > 0 ? <b>{summary.notifications.unread > 99 ? '99+' : summary.notifications.unread}</b> : null}
            <span className="communication-action-label">الإشعارات</span>
          </button>
          {open === 'notifications' ? <CommunicationPanel label="الإشعارات غير المقروءة" bucket={summary.notifications} fallback={fallbackRoute(area, 'notifications')} onNavigate={() => setOpen(null)} /> : null}
        </div>
        <div className="communication-action-wrap">
          <button type="button" className={`communication-action ${open === 'messages' ? 'active' : ''}`} onClick={() => setOpen((current) => current === 'messages' ? null : 'messages')} aria-label={`الرسائل، ${summary.messages.unread} غير مقروءة`} aria-expanded={open === 'messages'}>
            <span aria-hidden="true">✉</span>{summary.messages.unread > 0 ? <b>{summary.messages.unread > 99 ? '99+' : summary.messages.unread}</b> : null}
            <span className="communication-action-label">الرسائل</span>
          </button>
          {open === 'messages' ? <CommunicationPanel label="الرسائل غير المقروءة" bucket={summary.messages} fallback={fallbackRoute(area, 'messages')} onNavigate={() => setOpen(null)} /> : null}
        </div>
        <ThemeToggle compact />
        <button type="button" className="communication-action logout" onClick={() => void handleLogout()} title="تسجيل الخروج" aria-label="تسجيل الخروج"><span aria-hidden="true">⇥</span><span className="communication-action-label">خروج</span></button>
      </div>
    </header>

    {urgent ? <div className="urgent-overlay no-print" role="alertdialog" aria-modal="true" aria-labelledby="urgent-title">
      <section className="urgent-dialog"><span className="urgent-symbol">!</span><span className="urgent-kicker">تنبيه طارئ من إدارة Mr Center</span><h2 id="urgent-title">{urgentTitle}</h2><p>{urgent.body}</p><div className="row"><button type="button" className="btn secondary" onClick={() => void acknowledgeUrgent(false)}>تمت القراءة</button><button type="button" className="btn" onClick={() => void acknowledgeUrgent(true)}>فتح الرسالة</button></div></section>
    </div> : null}
  </>;
}
