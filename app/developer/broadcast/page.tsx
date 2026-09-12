'use client';

import { useEffect, useState } from 'react';
import { Button, Card, EmptyState, ErrorNotice, Input, PageHeader, Select, Textarea } from '@/components/ui';
import { Modal } from '@/components/modal';
import { useToast } from '@/components/toast';
import { devFetchCenters, sendNotification, type CenterWithSub } from '@/lib/api';
import type { NotificationAudience } from '@/lib/types';

export default function DeveloperBroadcastPage() {
  const toast = useToast();
  const [centers, setCenters] = useState<CenterWithSub[]>([]);
  const [form, setForm] = useState({ centerId: '', audience: 'owners' as NotificationAudience, title: '', body: '' });
  const [open, setOpen] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => { devFetchCenters().then((c) => { setCenters(c); if (c[0]) setForm((f) => (f.centerId ? f : { ...f, centerId: c[0].id })); }).catch(setError); }, []);

  const openCompose = () => { setForm((f) => ({ centerId: f.centerId || centers[0]?.id || '', audience: 'owners', title: '', body: '' })); setDirty(false); setError(null); setOpen(true); };
  const change = (patch: Partial<typeof form>) => { setForm((f) => ({ ...f, ...patch })); setDirty(true); };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      await sendNotification({ centerId: form.centerId, audience: form.audience, title: form.title, body: form.body });
      toast.success('تم إرسال الإشعار', 'وصل للجمهور المحدد.');
      setDirty(false); setOpen(false); setForm((f) => ({ ...f, title: '', body: '' }));
    } catch (err) { setError(err); }
    finally { setBusy(false); }
  };

  return <>
    <PageHeader
      title="بث وإشعارات"
      subtitle="إرسال إشعار لسنتر محدد أو لأصحابه عبر قناة owners."
      actions={<Button type="button" onClick={openCompose}>+ إشعار جديد</Button>}
    />
    <ErrorNotice error={error} />
    <Card className="stack">
      <h2 className="h3">السناتر</h2>
      {centers.length === 0 ? <EmptyState title="لا توجد سناتر" /> : <p className="muted">اختر سنتراً من «+ إشعار جديد» لإرسال رسالة لصاحبه أو لكل طلابه.</p>}
    </Card>

    <Modal
      open={open}
      title="إشعار جديد"
      dirty={dirty}
      onClose={() => setOpen(false)}
      onSave={() => void submit({ preventDefault: () => {} } as React.FormEvent)}
      saveLabel={busy ? 'جاري الإرسال...' : 'إرسال'}
      footer={<Button disabled={busy || !form.centerId} type="submit" form="dev-broadcast-form">{busy ? 'جاري الإرسال...' : 'إرسال'}</Button>}
    >
      <form id="dev-broadcast-form" className="stack" onSubmit={submit}>
        <Select label="السنتر" value={form.centerId} onChange={(e) => change({ centerId: e.target.value })}>{centers.map((c) => <option key={c.id} value={c.id}>{c.name} — {c.code}</option>)}</Select>
        <Select label="الجمهور" value={form.audience} onChange={(e) => change({ audience: e.target.value as NotificationAudience })}><option value="owners">صاحب السنتر</option><option value="all">كل الطلاب</option></Select>
        <Input label="العنوان" value={form.title} onChange={(e) => change({ title: e.target.value })} required />
        <Textarea label="نص الرسالة" value={form.body} onChange={(e) => change({ body: e.target.value })} required />
        <ErrorNotice error={error} />
      </form>
    </Modal>
  </>;
}
