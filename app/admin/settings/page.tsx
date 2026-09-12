'use client';

import { useEffect, useState } from 'react';
import { Badge, Button, Card, ErrorNotice, Input, Notice, PageHeader } from '@/components/ui';
import { useSession } from '@/context/session';
import { fetchCenterSettings, fetchMyCenter, saveCenterSettings } from '@/lib/api';
import { downloadCenterBackup } from '@/lib/backup';
import { isOwner } from '@/lib/rbac';
import type { Center, CenterSettings } from '@/lib/types';
import { encodeCenterQr } from '@/lib/qr';
import { QrCode } from '@/components/qr-code';

export default function AdminSettingsPage() {
  const { profile } = useSession();
  const centerId = profile?.center_id;
  const [center, setCenter] = useState<Center | null>(null);
  const [settings, setSettings] = useState<CenterSettings>({ whatsapp: '', contact_email: '', registration_open: true, archive_year: '' });
  const [busy, setBusy] = useState(false);
  const [backupBusy, setBackupBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!centerId) return;
    Promise.all([fetchMyCenter(centerId), fetchCenterSettings(centerId)])
      .then(([c, s]) => { setCenter(c); setSettings(s); })
      .catch(setError);
  }, [centerId]);

  if (profile && !isOwner(profile)) return <Card><Notice tone="error">إعدادات السنتر متاحة لصاحب السنتر فقط.</Notice></Card>;

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!centerId) return;
    setBusy(true); setError(null); setMessage(null);
    try { await saveCenterSettings(centerId, settings); setMessage('تم حفظ الإعدادات.'); }
    catch (err) { setError(err); }
    finally { setBusy(false); }
  };

  const exportBackup = async () => {
    if (!centerId || !center) return;
    setBackupBusy(true); setError(null); setMessage(null);
    try {
      const name = await downloadCenterBackup(centerId, center.name, 'web');
      setMessage(`تم تجهيز النسخة الاحتياطية: ${name}`);
    } catch (err) {
      setError(err);
    } finally {
      setBackupBusy(false);
    }
  };

  const qr = center ? encodeCenterQr(center.id, center.code, center.name) : '';

  return <>
    <PageHeader title="إعدادات السنتر" subtitle="بيانات تشغيلية وكود السنتر وباركود الانضمام." />
    <ErrorNotice error={error} />{message ? <Notice tone="success">{message}</Notice> : null}
    <div className="grid grid-2">
      <Card className="stack">
        <h2 className="h3">بيانات السنتر</h2>
        <div className="row"><Badge tone="info">{center?.kind === 'solo' ? 'مدرس مستقل' : 'سنتر'}</Badge><Badge tone={center?.status === 'active' ? 'success' : 'danger'}>{center?.status ?? '—'}</Badge></div>
        <p className="muted">الاسم: <b>{center?.name ?? '—'}</b></p>
        <p className="muted">الكود: <b dir="ltr">{center?.code ?? '—'}</b></p>
        {qr ? <div className="stack"><QrCode value={qr} /><textarea className="textarea" readOnly dir="ltr" value={qr} /></div> : null}
        <Button type="button" variant="secondary" disabled={backupBusy || !center} onClick={() => void exportBackup()}>{backupBusy ? 'جاري تجهيز النسخة...' : 'تحميل نسخة احتياطية JSON'}</Button>
        <p className="muted tiny">تصدير آمن للقراءة فقط من نفس جداول Android ومحكوم بصلاحيات RLS.</p>
      </Card>
      <Card className="stack">
        <h2 className="h3">الإعدادات التشغيلية</h2>
        <form className="stack" onSubmit={save}>
          <Input label="واتساب السنتر" value={settings.whatsapp} onChange={(e) => setSettings({ ...settings, whatsapp: e.target.value })} dir="ltr" />
          <Input label="بريد التواصل" value={settings.contact_email} onChange={(e) => setSettings({ ...settings, contact_email: e.target.value })} dir="ltr" />
          <Input label="السنة/الأرشيف" value={settings.archive_year} onChange={(e) => setSettings({ ...settings, archive_year: e.target.value })} />
          <label className="row small muted"><input type="checkbox" checked={settings.registration_open} onChange={(e) => setSettings({ ...settings, registration_open: e.target.checked })} /> التسجيل مفتوح للطلاب</label>
          <Button disabled={busy} type="submit">حفظ الإعدادات</Button>
        </form>
      </Card>
    </div>
  </>;
}
