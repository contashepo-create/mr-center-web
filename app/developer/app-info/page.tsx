'use client';

import { useEffect, useState } from 'react';
import { Button, Card, ErrorNotice, Input, PageHeader, Textarea } from '@/components/ui';
import { Modal } from '@/components/modal';
import { useToast } from '@/components/toast';
import { devFetchPublicConfig, devSavePublicConfig } from '@/lib/api';
import type { PublicConfig } from '@/lib/types';

export default function DeveloperAppInfoPage() {
  const toast = useToast();
  const [cfg, setCfg] = useState<PublicConfig>({});
  const [draft, setDraft] = useState<PublicConfig>({});
  const [open, setOpen] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => { devFetchPublicConfig().then(setCfg).catch(setError); }, []);

  const openEdit = () => { setDraft(cfg); setDirty(false); setError(null); setOpen(true); };
  const change = (patch: Partial<PublicConfig>) => { setDraft((d) => ({ ...d, ...patch })); setDirty(true); };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      await devSavePublicConfig(draft);
      toast.success('تم حفظ بيانات حول التطبيق', 'ستظهر في الويب والتطبيق.');
      setCfg(draft); setDirty(false); setOpen(false);
    } catch (err) { setError(err); }
    finally { setBusy(false); }
  };

  return <>
    <PageHeader
      title="حول التطبيق"
      subtitle="محتوى عام يظهر في الويب والتطبيق."
      actions={<Button type="button" onClick={openEdit}>تعديل</Button>}
    />
    <ErrorNotice error={error} />
    <Card className="stack">
      <h2 className="h3">المحتوى الحالي</h2>
      <p className="muted">العنوان: <b>{cfg.about_title ?? '—'}</b></p>
      <p className="muted">البريد: <b>{cfg.contact_email ?? '—'}</b></p>
      <p className="muted">واتساب: <b>{cfg.contact_whatsapp ?? '—'}</b></p>
      <p className="muted" style={{ lineHeight: 1.8 }}>الوصف: {cfg.about_body ?? '—'}</p>
      <p className="muted" style={{ lineHeight: 1.8 }}>رسالة عامة: {cfg.global_message ?? '—'}</p>
    </Card>

    <Modal
      open={open}
      title="تعديل بيانات حول التطبيق"
      dirty={dirty}
      onClose={() => setOpen(false)}
      onSave={() => void submit({ preventDefault: () => {} } as React.FormEvent)}
      saveLabel={busy ? 'جاري الحفظ...' : 'حفظ'}
      footer={<Button disabled={busy} type="submit" form="app-info-form">{busy ? 'جاري الحفظ...' : 'حفظ'}</Button>}
    >
      <form id="app-info-form" className="stack" onSubmit={submit}>
        <Input label="عنوان حول التطبيق" value={draft.about_title ?? ''} onChange={(e) => change({ about_title: e.target.value })} />
        <Textarea label="وصف التطبيق" value={draft.about_body ?? ''} onChange={(e) => change({ about_body: e.target.value })} />
        <Input label="واتساب التواصل" value={draft.contact_whatsapp ?? ''} onChange={(e) => change({ contact_whatsapp: e.target.value })} dir="ltr" />
        <Input label="البريد" value={draft.contact_email ?? ''} onChange={(e) => change({ contact_email: e.target.value })} dir="ltr" />
        <Textarea label="رسالة عامة تظهر في الرئيسية" value={draft.global_message ?? ''} onChange={(e) => change({ global_message: e.target.value })} />
        <ErrorNotice error={error} />
      </form>
    </Modal>
  </>;
}
