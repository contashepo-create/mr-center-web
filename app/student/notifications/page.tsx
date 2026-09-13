'use client';

import { useEffect, useState } from 'react';
import { Badge, Button, Card, EmptyState, ErrorNotice, PageHeader } from '@/components/ui';
import { useSession } from '@/context/session';
import { fetchMyNotifications, markNotificationRead } from '@/lib/api';
import type { MyNotification } from '@/lib/types';
import { formatDate } from '@/lib/utils';

export default function StudentNotificationsPage() {
  const { profile } = useSession();
  const [rows, setRows] = useState<MyNotification[]>([]);
  const [error, setError] = useState<unknown>(null);
  const load = async () => { try { setRows(await fetchMyNotifications()); } catch (err) { setError(err); } };
  useEffect(() => { void load(); }, []);
  const mark = async (id: string) => { if (!profile?.center_id || !profile.student_id) return; try { await markNotificationRead(profile.center_id, id, profile.student_id); await load(); } catch (err) { setError(err); } };
  const presentationLabel = (presentation?: MyNotification['presentation']) => presentation === 'urgent' ? 'طارئ' : presentation === 'message' ? 'رسالة' : 'إشعار';
  return <><PageHeader title="صندوق الإشعارات والرسائل" subtitle="إشعارات السنتر والبث الموجه لك، وتظهر الرسائل هنا أيضاً." /><ErrorNotice error={error} /><Card className="stack">{rows.length === 0 ? <EmptyState title="لا توجد إشعارات" /> : rows.map((n) => <div key={n.id} className="card compact soft stack"><div className="row-between"><strong>{n.title}</strong><div className="row"><Badge tone={n.presentation === 'urgent' ? 'danger' : n.presentation === 'message' ? 'info' : 'default'}>{presentationLabel(n.presentation)}</Badge><Badge tone={n.is_read ? 'default' : 'info'}>{n.is_read ? 'مقروء' : 'جديد'}</Badge></div></div><p className="muted small" style={{ lineHeight: 1.8 }}>{n.body}</p><div className="row-between"><span className="tiny muted">{formatDate(n.created_at)}</span>{!n.is_read ? <Button type="button" variant="secondary" onClick={() => void mark(n.id)}>تعليم كمقروء</Button> : null}</div></div>)}</Card></>;
}
