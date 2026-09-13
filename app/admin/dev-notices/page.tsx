'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Badge, Button, Card, EmptyState, ErrorNotice, Notice, PageHeader } from '@/components/ui';
import { useSession } from '@/context/session';
import { fetchMyDeveloperNotifications, markDeveloperNotificationRead } from '@/lib/api';
import { isOwner, isStaff } from '@/lib/rbac';
import type { MyNotification } from '@/lib/types';
import { formatDate } from '@/lib/utils';

export default function DeveloperNoticesPage() {
  const { profile } = useSession();
  const searchParams = useSearchParams();
  const requestedView = searchParams.get('view');
  const view = requestedView === 'message' ? 'message' : requestedView === 'notification' ? 'notification' : 'all';
  const [rows, setRows] = useState<MyNotification[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  const load = async () => {
    setError(null);
    try {
      setRows(await fetchMyDeveloperNotifications());
    } catch (err) {
      setError(err);
    }
  };
  useEffect(() => { void load(); }, []);

  const allowed = isOwner(profile) || isStaff(profile);
  if (profile && !allowed) return <Card><Notice tone="error">تنبيهات المطور متاحة لصاحب السنتر وفريقه فقط.</Notice></Card>;

  const open = async (notice: MyNotification) => {
    const willOpen = openId !== notice.id;
    setOpenId(willOpen ? notice.id : null);
    if (willOpen && !notice.is_read) {
      try {
        await markDeveloperNotificationRead(notice.id);
        setRows((current) => current.map((row) => row.id === notice.id ? { ...row, is_read: true } : row));
      } catch (err) {
        setError(err);
      }
    }
  };

  const visibleRows = rows.filter((row) => view === 'all' || (view === 'message' ? row.presentation === 'message' : row.presentation !== 'message'));
  const unread = visibleRows.filter((row) => !row.is_read);
  const recipientLabel = isOwner(profile) ? 'رسائل خاصة بصاحب السنتر' : 'رسائل خاصة بفريق العمل';
  const presentationLabel = (presentation?: MyNotification['presentation']) => presentation === 'urgent' ? 'طارئ' : presentation === 'message' ? 'رسالة' : 'إشعار';
  return <>
    <PageHeader title="تنبيهات المطور" subtitle={unread.length ? `${unread.length} غير مقروء · ${recipientLabel}` : recipientLabel} />
    <ErrorNotice error={error} />
    <Card className="stack">
      <div className="row-between"><h2 className="h3">الأحدث</h2><div className="row"><a className={`btn ${view === 'all' ? '' : 'secondary'}`} href="/admin/dev-notices">الكل</a><a className={`btn ${view === 'notification' ? '' : 'secondary'}`} href="/admin/dev-notices?view=notification">الإشعارات</a><a className={`btn ${view === 'message' ? '' : 'secondary'}`} href="/admin/dev-notices?view=message">الرسائل</a><Badge tone="info">{visibleRows.length}</Badge></div></div>
      {visibleRows.length === 0 ? <EmptyState title="لا توجد رسائل في هذا القسم" /> : visibleRows.map((notice) => <div key={notice.id} className="card compact soft stack">
        <div className="row-between"><div><strong>{notice.title}</strong><div className="tiny muted">{formatDate(notice.created_at)}</div></div><div className="row"><Badge tone={notice.presentation === 'urgent' ? 'danger' : notice.presentation === 'message' ? 'info' : 'default'}>{presentationLabel(notice.presentation)}</Badge><Badge tone={notice.is_read ? 'default' : 'warn'}>{notice.is_read ? 'مقروء' : 'جديد'}</Badge></div></div>
        {openId === notice.id ? <p style={{ lineHeight: 1.9 }}>{notice.body}</p> : <p className="muted small" style={{ lineHeight: 1.7 }}>{notice.body.slice(0, 140)}{notice.body.length > 140 ? '...' : ''}</p>}
        <Button type="button" variant="secondary" onClick={() => void open(notice)}>{openId === notice.id ? 'إغلاق' : 'فتح'}</Button>
      </div>)}</Card>
  </>;
}
