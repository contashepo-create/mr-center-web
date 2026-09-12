'use client';

import { useEffect, useState } from 'react';
import { Badge, Button, Card, EmptyState, ErrorNotice, Notice, PageHeader } from '@/components/ui';
import { useSession } from '@/context/session';
import { fetchOwnerNotices, markOwnerNoticeRead } from '@/lib/api';
import { isOwner } from '@/lib/rbac';
import { getSupabase } from '@/lib/supabase';
import type { AppNotification } from '@/lib/types';
import { formatDate } from '@/lib/utils';

type Row = AppNotification & { read: boolean };

export default function DeveloperNoticesPage() {
  const { profile } = useSession();
  const centerId = profile?.center_id;
  const [rows, setRows] = useState<Row[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  const load = async () => {
    if (!centerId) return;
    setError(null);
    try {
      const ns = await fetchOwnerNotices(centerId);
      const { data: sess } = await getSupabase().auth.getSession();
      const uid = sess.session?.user.id;
      let readIds = new Set<string>();
      if (uid) {
        const { data: reads, error: readErr } = await getSupabase().from('app_notification_reads').select('notification_id').eq('center_id', centerId).eq('student_id', uid);
        if (readErr) throw readErr;
        readIds = new Set((reads ?? []).map((r: { notification_id: string }) => r.notification_id));
      }
      setRows(ns.map((n) => ({ ...n, read: readIds.has(n.id) })));
    } catch (err) { setError(err); }
  };
  useEffect(() => { void load(); }, [centerId]);

  if (profile && !isOwner(profile)) return <Card><Notice tone="error">تنبيهات المطور متاحة لصاحب السنتر فقط.</Notice></Card>;

  const open = async (n: Row) => {
    const willOpen = openId !== n.id;
    setOpenId(willOpen ? n.id : null);
    if (willOpen && !n.read && centerId) {
      try { await markOwnerNoticeRead(centerId, n.id); setRows((old) => old.map((x) => x.id === n.id ? { ...x, read: true } : x)); }
      catch (err) { setError(err); }
    }
  };

  const unread = rows.filter((r) => !r.read);
  return <>
    <PageHeader title="تنبيهات المطور" subtitle={unread.length ? `${unread.length} غير مقروء` : 'كل التنبيهات مقروءة'} />
    <ErrorNotice error={error} />
    <Card className="stack"><div className="row-between"><h2 className="h3">الأحدث</h2><Badge tone="info">{rows.length}</Badge></div>{rows.length === 0 ? <EmptyState title="لا توجد تنبيهات" /> : rows.map((n) => <div key={n.id} className="card compact soft stack"><div className="row-between"><div><strong>{n.title}</strong><div className="tiny muted">{formatDate(n.created_at)}</div></div><Badge tone={n.read ? 'default' : 'warn'}>{n.read ? 'مقروء' : 'جديد'}</Badge></div>{openId === n.id ? <p style={{ lineHeight: 1.9 }}>{n.body}</p> : <p className="muted small" style={{ lineHeight: 1.7 }}>{n.body.slice(0, 140)}{n.body.length > 140 ? '...' : ''}</p>}<Button type="button" variant="secondary" onClick={() => void open(n)}>{openId === n.id ? 'إغلاق' : 'فتح'}</Button></div>)}</Card>
  </>;
}
