'use client';

import { useState } from 'react';
import { Button, Card, ErrorNotice, Input, Notice, PageHeader } from '@/components/ui';
import { Modal } from '@/components/modal';
import { useToast } from '@/components/toast';
import { useSession } from '@/context/session';
import { clearOverrideConfig, getActiveConfig, saveOverrideConfig } from '@/lib/supabase';

export default function DeveloperConnectionPage() {
  const { reinitConnection } = useSession();
  const toast = useToast();
  const active = getActiveConfig();
  const [url, setUrl] = useState(active?.url ?? '');
  const [key, setKey] = useState('');
  const [open, setOpen] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const openEdit = () => { setUrl(active?.url ?? ''); setKey(''); setDirty(false); setError(null); setOpen(true); };

  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setError(null); setBusy(true);
    try {
      await saveOverrideConfig(url, key);
      await reinitConnection();
      toast.success('تم تغيير الاتصال', 'سجّل الدخول مرة أخرى إذا لزم.');
      setDirty(false); setOpen(false);
    } catch (err) { setError(err); }
    finally { setBusy(false); }
  };
  const clear = async () => {
    setError(null); setBusy(true);
    try {
      await clearOverrideConfig();
      await reinitConnection();
      toast.success('تم حذف الاتصال اليدوي', 'تم الرجوع للبيئة/كلاود فلير.');
      setOpen(false);
    } catch (err) { setError(err); }
    finally { setBusy(false); }
  };

  return <>
    <PageHeader
      title="إعدادات الاتصال"
      subtitle="عرض أو تغيير اتصال Supabase محلياً في هذا المتصفح فقط."
      actions={<Button type="button" onClick={openEdit}>تغيير مؤقت</Button>}
    />
    <ErrorNotice error={error} />
    <Card className="stack">
      <h2 className="h3">الاتصال الحالي</h2>
      <p className="muted">المصدر: <b>{active?.source ?? 'غير مضبوط'}</b></p>
      <p className="muted" dir="ltr">{active?.url ?? '—'}</p>
      <Notice>على Vercel الأفضل استخدام Environment Variables. التغيير اليدوي هنا للتجارب فقط.</Notice>
      <div className="row"><Button type="button" variant="danger" disabled={busy} onClick={() => void clear()}>حذف الاتصال اليدوي</Button></div>
    </Card>

    <Modal
      open={open}
      title="تغيير مؤقت للاتصال"
      subtitle="يُحفظ محلياً في هذا المتصفح فقط"
      dirty={dirty}
      onClose={() => setOpen(false)}
      onSave={() => void save({ preventDefault: () => {} } as React.FormEvent)}
      saveLabel={busy ? 'جاري...' : 'تطبيق الاتصال'}
      footer={<Button disabled={busy} type="submit" form="connection-form">{busy ? 'جاري...' : 'تطبيق الاتصال'}</Button>}
    >
      <form id="connection-form" className="stack" onSubmit={save}>
        <Input label="Supabase URL" value={url} onChange={(e) => { setUrl(e.target.value); setDirty(true); }} dir="ltr" />
        <Input label="Anon Key" value={key} onChange={(e) => { setKey(e.target.value); setDirty(true); }} dir="ltr" />
        <ErrorNotice error={error} />
      </form>
    </Modal>
  </>;
}
