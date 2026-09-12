'use client';

import { useEffect, useMemo, useState } from 'react';
import { Badge, Button, Card, EmptyState, ErrorNotice, PageHeader, Select, Textarea } from '@/components/ui';
import { Modal } from '@/components/modal';
import { useToast } from '@/components/toast';
import { devFetchCenters, devFetchSupportMessages, devSendSupportMessage, type CenterWithSub } from '@/lib/api';
import type { SupportMessage } from '@/lib/types';
import { formatDate } from '@/lib/utils';

export default function DeveloperSupportPage() {
  const toast = useToast();
  const [centers, setCenters] = useState<CenterWithSub[]>([]);
  const [rows, setRows] = useState<SupportMessage[]>([]);
  const [centerId, setCenterId] = useState('');
  const [body, setBody] = useState('');
  const [open, setOpen] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const centerName = useMemo(() => new Map(centers.map((c) => [c.id, c.name])), [centers]);
  const visible = centerId ? rows.filter((r) => r.center_id === centerId) : rows;
  const load = async () => { try { const [c, m] = await Promise.all([devFetchCenters(), devFetchSupportMessages()]); setCenters(c); setRows(m); if (!centerId && c[0]) setCenterId(c[0].id); } catch (err) { setError(err); } };
  useEffect(() => { void load(); }, []);

  const openReply = () => { setBody(''); setDirty(false); setError(null); setOpen(true); };

  const send = async (e: React.FormEvent) => {
    e.preventDefault(); if (!centerId || !body.trim()) return;
    try {
      await devSendSupportMessage(centerId, body);
      toast.success('تم إرسال الرد', 'وصل لصاحب السنتر.');
      setDirty(false); setOpen(false); setBody(''); await load();
    } catch (err) { setError(err); }
  };

  return <>
    <PageHeader
      title="دعم العملاء"
      subtitle="متابعة رسائل السناتر والرد عليها."
      actions={<Button type="button" onClick={openReply} disabled={!centerId}>+ رد المطور</Button>}
    />
    <ErrorNotice error={error} />
    <div className="grid grid-2">
      <Card className="stack">
        <h2 className="h3">السنتر</h2>
        <Select label="اختر السنتر" value={centerId} onChange={(e) => setCenterId(e.target.value)}>{centers.map((c) => <option key={c.id} value={c.id}>{c.name} — {c.code}</option>)}</Select>
      </Card>
      <Card className="stack"><div className="row-between"><h2 className="h3">المحادثة</h2><Badge tone="info">{visible.length}</Badge></div>{visible.length === 0 ? <EmptyState title="لا توجد رسائل" /> : visible.map((m) => <div key={m.id} className="card compact soft"><div className="row-between"><strong>{m.sender_name || centerName.get(m.center_id) || '—'}</strong><Badge tone={m.sender_role === 'developer' ? 'info' : 'success'}>{m.sender_role === 'developer' ? 'المطور' : 'السنتر'}</Badge></div><p className="muted small">{m.body}</p><span className="tiny muted">{formatDate(m.created_at)}</span></div>)}</Card>
    </div>

    <Modal
      open={open}
      title="رد المطور"
      subtitle={centerName.get(centerId)}
      dirty={dirty}
      onClose={() => setOpen(false)}
      onSave={() => void send({ preventDefault: () => {} } as React.FormEvent)}
      saveLabel="إرسال الرد"
      footer={<Button disabled={!body.trim()} type="submit" form="dev-support-form">إرسال الرد</Button>}
    >
      <form id="dev-support-form" className="stack" onSubmit={send}>
        <Textarea label="رد المطور" value={body} onChange={(e) => { setBody(e.target.value); setDirty(true); }} />
        <ErrorNotice error={error} />
      </form>
    </Modal>
  </>;
}
