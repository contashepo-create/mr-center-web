'use client';

import { useEffect, useState } from 'react';
import { Badge, Card, EmptyState, ErrorNotice, Notice, PageHeader } from '@/components/ui';
import { useSession } from '@/context/session';
import { fetchActivityLog } from '@/lib/api';
import { isOwner } from '@/lib/rbac';
import type { ActivityLog } from '@/lib/types';
import { formatDate } from '@/lib/utils';

export default function ActivityPage() {
  const { profile } = useSession();
  const [rows, setRows] = useState<ActivityLog[]>([]);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => { if (profile?.center_id) fetchActivityLog(profile.center_id).then(setRows).catch(setError); }, [profile?.center_id]);
  if (profile && !isOwner(profile)) return <Card><Notice tone="error">سجل النشاط متاح لصاحب السنتر فقط.</Notice></Card>;
  return <><PageHeader title="سجل النشاط" subtitle="آخر العمليات المسجلة داخل السنتر." /><ErrorNotice error={error} /><Card className="stack"><div className="row-between"><h2 className="h3">العمليات</h2><Badge tone="info">{rows.length}</Badge></div>{rows.length === 0 ? <EmptyState title="لا توجد عمليات مسجلة" /> : <div className="table-wrap"><table><thead><tr><th>المستخدم</th><th>العملية</th><th>التفاصيل</th><th>التاريخ</th></tr></thead><tbody>{rows.map((r) => <tr key={r.id}><td>{r.actor_name}</td><td><Badge tone="info">{r.action}</Badge></td><td>{r.details}</td><td>{formatDate(r.created_at)}</td></tr>)}</tbody></table></div>}</Card></>;
}
