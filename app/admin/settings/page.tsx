'use client';

import { useEffect, useState } from 'react';
import { Badge, Button, Card, ErrorNotice, Input, Notice, PageHeader } from '@/components/ui';
import { Modal } from '@/components/modal';
import { useToast } from '@/components/toast';
import { useSession } from '@/context/session';
import { fetchCenterSettings, fetchMyCenter, saveCenterSettings } from '@/lib/api';
import { downloadCenterBackup } from '@/lib/backup';
import { closeFiscalYear, fetchMyFiscalYears, type FiscalYear } from '@/lib/features';
import { isOwner } from '@/lib/rbac';
import type { Center, CenterSettings } from '@/lib/types';
import { encodeCenterQr } from '@/lib/qr';
import { formatDate, formatMoney } from '@/lib/utils';
import { QrCode } from '@/components/qr-code';

export default function AdminSettingsPage() {
  const { profile } = useSession();
  const toast = useToast();
  const centerId = profile?.center_id;
  const [center, setCenter] = useState<Center | null>(null);
  const [settings, setSettings] = useState<CenterSettings>({ whatsapp: '', contact_email: '', registration_open: true, archive_year: '' });
  const [years, setYears] = useState<FiscalYear[]>([]);
  const [closing, setClosing] = useState(false);
  const [yearMsg, setYearMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [backupBusy, setBackupBusy] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsDirty, setSettingsDirty] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    if (!centerId) return;
    Promise.all([fetchMyCenter(centerId), fetchCenterSettings(centerId)])
      .then(([c, s]) => { setCenter(c); setSettings(s); })
      .catch(setError);
  }, [centerId]);

  useEffect(() => {
    if (!centerId) return;
    fetchMyFiscalYears().then(setYears).catch(() => setYears([]));
  }, [centerId]);

  if (profile && !isOwner(profile)) return <Card><Notice tone="error">إعدادات السنتر متاحة لصاحب السنتر فقط.</Notice></Card>;

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!centerId) return;
    setBusy(true); setError(null);
    try { await saveCenterSettings(centerId, settings); toast.success('تم حفظ الإعدادات', 'حُفظت إعدادات السنتر بنجاح.'); setSettingsDirty(false); setSettingsOpen(false); }
    catch (err) { setError(err); }
    finally { setBusy(false); }
  };

  const exportBackup = async () => {
    if (!centerId || !center) return;
    setBackupBusy(true); setError(null);
    try {
      const name = await downloadCenterBackup(centerId, center.name, 'web');
      toast.success('تم تجهيز النسخة الاحتياطية', name);
    } catch (err) {
      setError(err);
    } finally {
      setBackupBusy(false);
    }
  };

  const qr = center ? encodeCenterQr(center.id, center.code, center.name) : '';

  const closeYear = async () => {
    if (!centerId) return;
    const openYear = years.find((y) => y.status === 'open');
    const label = openYear?.year_label ?? '';
    if (!window.confirm(`سيتم إغلاق السنة المالية ${label || 'الحالية'} وفتح سنة جديدة مع ترحيل الرصيد الافتتاحي والمستحقات المعلقة. هل أنت متأكد؟`)) return;
    setClosing(true);
    setError(null);
    setYearMsg(null);
    try {
      const res = await closeFiscalYear(centerId);
      setYearMsg(`تم إغلاق سنة ${res.closed} وفتح سنة ${res.opened} — الرصيد المرحّل: ${formatMoney(res.carry_balance)} والمستحقات المعلقة: ${formatMoney(res.carry_pending)}.`);
      setYears(await fetchMyFiscalYears());
    } catch (err) {
      setError(err);
    } finally {
      setClosing(false);
    }
  };

  return <>
    <PageHeader title="إعدادات السنتر" subtitle="بيانات تشغيلية وكود السنتر وباركود الانضمام والسنة المالية." />
    <ErrorNotice error={error} />{yearMsg ? <Notice tone="success">{yearMsg}</Notice> : null}
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
        <div className="grid grid-2">
          <Card className="compact soft kpi"><span className="muted">واتساب</span><div className="kpi-value" style={{ fontSize: '1rem' }} dir="ltr">{settings.whatsapp || '—'}</div></Card>
          <Card className="compact soft kpi"><span className="muted">بريد التواصل</span><div className="kpi-value" style={{ fontSize: '1rem' }} dir="ltr">{settings.contact_email || '—'}</div></Card>
          <Card className="compact soft kpi"><span className="muted">السنة/الأرشيف</span><div className="kpi-value" style={{ fontSize: '1rem' }}>{settings.archive_year || '—'}</div></Card>
          <Card className="compact soft kpi"><span className="muted">التسجيل</span><div className="kpi-value" style={{ fontSize: '1rem' }}>{settings.registration_open ? 'مفتوح' : 'مغلق'}</div></Card>
        </div>
        <Button type="button" onClick={() => { setSettingsDirty(false); setError(null); setSettingsOpen(true); }}>تعديل الإعدادات</Button>
      </Card>
    </div>
    <Card className="stack" style={{ marginTop: 18 }}>
      <div className="row-between">
        <div>
          <h2 className="h3">السنة المالية</h2>
          <p className="muted small" style={{ margin: '6px 0 0' }}>فتح وإغلاق السنة الدراسية يتم من هنا مباشرة — بلا ارتباط بقسم المحاسبة، فالسناتر غير المشتركة تتحكم بسنتها أيضاً.</p>
        </div>
        {years.some((y) => y.status === 'open') ? (
          <Button type="button" variant="secondary" disabled={closing} onClick={closeYear}>{closing ? 'جارٍ الإغلاق...' : 'إغلاق السنة وفتح سنة جديدة'}</Button>
        ) : null}
      </div>
      {years.length === 0 ? <p className="muted">لا توجد سنوات مالية مسجلة — تُنشأ تلقائياً مع إنشاء السنتر.</p> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>السنة</th><th>تبدأ</th><th>تنتهي</th><th>الحالة</th><th>رصيد افتتاحي</th><th>رصيد الختام</th><th>مستحقات معلقة</th></tr></thead>
            <tbody>
              {years.map((y) => (
                <tr key={y.id}>
                  <td><strong>{y.year_label}</strong></td>
                  <td>{formatDate(y.starts_on)}</td>
                  <td>{y.ends_on ? formatDate(y.ends_on) : '—'}</td>
                  <td><Badge tone={y.status === 'open' ? 'success' : 'default'}>{y.status === 'open' ? 'مفتوحة' : 'مغلقة'}</Badge></td>
                  <td>{formatMoney(y.opening_balance)}</td>
                  <td>{y.closing_balance === null ? '—' : formatMoney(y.closing_balance)}</td>
                  <td>{y.closing_pending_dues === null ? '—' : formatMoney(y.closing_pending_dues)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>

    <Modal
      open={settingsOpen}
      title="الإعدادات التشغيلية"
      subtitle="واتساب وبريد التواصل وأرشيف السنة وحالة التسجيل"
      dirty={settingsDirty}
      onClose={() => setSettingsOpen(false)}
      onSave={() => void save({ preventDefault: () => {} } as React.FormEvent)}
      saveLabel={busy ? 'جاري الحفظ...' : 'حفظ الإعدادات'}
      footer={<Button disabled={busy} type="submit" form="settings-form">{busy ? 'جاري الحفظ...' : 'حفظ الإعدادات'}</Button>}
    >
      <form id="settings-form" className="stack" onSubmit={save}>
        <Input label="واتساب السنتر" value={settings.whatsapp} onChange={(e) => { setSettings({ ...settings, whatsapp: e.target.value }); setSettingsDirty(true); }} dir="ltr" />
        <Input label="بريد التواصل" value={settings.contact_email} onChange={(e) => { setSettings({ ...settings, contact_email: e.target.value }); setSettingsDirty(true); }} dir="ltr" />
        <Input label="السنة/الأرشيف" value={settings.archive_year} onChange={(e) => { setSettings({ ...settings, archive_year: e.target.value }); setSettingsDirty(true); }} />
        <label className="row small muted"><input type="checkbox" checked={settings.registration_open} onChange={(e) => { setSettings({ ...settings, registration_open: e.target.checked }); setSettingsDirty(true); }} /> التسجيل مفتوح للطلاب</label>
        <ErrorNotice error={error} />
      </form>
    </Modal>
  </>;
}
