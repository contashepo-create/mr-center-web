'use client';

import { useEffect, useState } from 'react';
import { Badge, Button, Card, EmptyState, ErrorNotice, Notice, PageHeader, Textarea } from '@/components/ui';
import { Modal } from '@/components/modal';
import { useToast } from '@/components/toast';
import { useSession } from '@/context/session';
import { fetchSupportMessages, sendSupportMessage } from '@/lib/api';
import { isOwner } from '@/lib/rbac';
import type { SupportMessage } from '@/lib/types';
import { formatDate } from '@/lib/utils';

export default function AdminSupportPage() {
  const { profile } = useSession();
  const toast = useToast();
  const centerId = profile?.center_id;
  const [rows, setRows] = useState<SupportMessage[]>([]);
  const [body, setBody] = useState('');
  const [open, setOpen] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const load = async () => { if (!centerId) return; try { setRows(await fetchSupportMessages(centerId)); } catch (err) { setError(err); } };
  useEffect(() => { void load(); }, [centerId]);

  const openNew = () => { setBody(''); setDirty(false); setError(null); setOpen(true); };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); if (!centerId || !body.trim()) return;
    setBusy(true); setError(null);
    try {
      await sendSupportMessage(centerId, body);
      toast.success('تم إرسال الرسالة', 'وصلت للمطور وسيرد عليك في هذه المحادثة.');
      setDirty(false); setOpen(false); setBody(''); await load();
    }
    catch (err) { setError(err); }
    finally { setBusy(false); }
  };

  if (profile && !isOwner(profile)) {
    return <Card><Notice tone="error">الدعم المباشر مع المطور متاح لصاحب السنتر فقط.</Notice></Card>;
  }

  return <>
    <PageHeader
      title="الدعم"
      subtitle="محادثة بين صاحب السنتر والمطور محفوظة في نفس قاعدة البيانات."
      actions={<Button type="button" onClick={openNew}>+ رسالة جديدة</Button>}
    />
    <ErrorNotice error={error} />
    <Card className="stack">
      {rows.length === 0 ? <EmptyState title="لا توجد رسائل" /> : <div className="stack">{rows.map((m) => <div key={m.id} className={`card compact soft`} style={{ marginInlineStart: m.sender_role === 'owner' ? 'auto' : 0, maxWidth: 680 }}><div className="row-between"><strong>{m.sender_name}</strong><Badge tone={m.sender_role === 'developer' ? 'info' : 'success'}>{m.sender_role === 'developer' ? 'المطور' : 'السنتر'}</Badge></div><p style={{ lineHeight: 1.8 }}>{m.body}</p><span className="tiny muted">{formatDate(m.created_at)}</span></div>)}</div>}
    </Card>

    <Modal
      open={open}
      title="رسالة جديدة للمطور"
      dirty={dirty}
      onClose={() => setOpen(false)}
      onSave={() => void submit({ preventDefault: () => {} } as React.FormEvent)}
      saveLabel={busy ? 'جاري الإرسال...' : 'إرسال'}
      footer={<Button disabled={busy || !body.trim()} type="submit" form="support-form">{busy ? 'جاري الإرسال...' : 'إرسال'}</Button>}
    >
      <form id="support-form" className="stack" onSubmit={submit}>
        <Textarea label="رسالتك" value={body} onChange={(e) => { setBody(e.target.value); setDirty(true); }} />
        <ErrorNotice error={error} />
      </form>
    </Modal>
  </>;
}
