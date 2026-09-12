'use client';

import { useEffect, useState } from 'react';
import { Badge, Button, Card, EmptyState, ErrorNotice, Notice, PageHeader, Textarea } from '@/components/ui';
import { useSession } from '@/context/session';
import { fetchSupportMessages, sendSupportMessage } from '@/lib/api';
import { isOwner } from '@/lib/rbac';
import type { SupportMessage } from '@/lib/types';
import { formatDate } from '@/lib/utils';

export default function AdminSupportPage() {
  const { profile } = useSession();
  const centerId = profile?.center_id;
  const [rows, setRows] = useState<SupportMessage[]>([]);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const load = async () => { if (!centerId) return; try { setRows(await fetchSupportMessages(centerId)); } catch (err) { setError(err); } };
  useEffect(() => { void load(); }, [centerId]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); if (!centerId || !body.trim()) return;
    setBusy(true); setError(null);
    try { await sendSupportMessage(centerId, body); setBody(''); await load(); }
    catch (err) { setError(err); }
    finally { setBusy(false); }
  };

  if (profile && !isOwner(profile)) {
    return <Card><Notice tone="error">الدعم المباشر مع المطور متاح لصاحب السنتر فقط.</Notice></Card>;
  }

  return <>
    <PageHeader title="الدعم" subtitle="محادثة بين صاحب السنتر والمطور محفوظة في نفس قاعدة البيانات." />
    <ErrorNotice error={error} />
    <Card className="stack">
      {rows.length === 0 ? <EmptyState title="لا توجد رسائل" /> : <div className="stack">{rows.map((m) => <div key={m.id} className={`card compact soft`} style={{ marginInlineStart: m.sender_role === 'owner' ? 'auto' : 0, maxWidth: 680 }}><div className="row-between"><strong>{m.sender_name}</strong><Badge tone={m.sender_role === 'developer' ? 'info' : 'success'}>{m.sender_role === 'developer' ? 'المطور' : 'السنتر'}</Badge></div><p style={{ lineHeight: 1.8 }}>{m.body}</p><span className="tiny muted">{formatDate(m.created_at)}</span></div>)}</div>}
      <form className="stack no-print" onSubmit={submit}>
        <Textarea label="رسالتك" value={body} onChange={(e) => setBody(e.target.value)} />
        <Button disabled={busy || !body.trim()} type="submit">إرسال</Button>
      </form>
    </Card>
  </>;
}
