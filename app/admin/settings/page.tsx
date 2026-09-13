'use client';

import { useEffect, useMemo, useState } from 'react';
import { Badge, Button, Card, ErrorNotice, Input, Notice, PageHeader, Select, Textarea } from '@/components/ui';
import { Modal } from '@/components/modal';
import { PrintIdentityPreview } from '@/components/printing/print-identity-preview';
import { useToast } from '@/components/toast';
import { useSession } from '@/context/session';
import { fetchCenterSettings, fetchMyCenter, saveCenterSettings } from '@/lib/api';
import { downloadCenterBackup } from '@/lib/backup';
import { closeFiscalYear, fetchMyFiscalYears, type FiscalYear } from '@/lib/features';
import { brandForCenter, DEFAULT_CENTER_PRINT_SETTINGS, imageFileToPrintDataUrl } from '@/lib/printing';
import { isOwner } from '@/lib/rbac';
import type { Center, CenterPrintSettings, CenterSettings } from '@/lib/types';
import { encodeCenterQr } from '@/lib/qr';
import { formatDate, formatMoney } from '@/lib/utils';
import { QrCode } from '@/components/qr-code';

type SettingsTab = 'general' | 'printing';

const initialSettings: CenterSettings = {
  whatsapp: '', contact_email: '', registration_open: true, archive_year: '', print: DEFAULT_CENTER_PRINT_SETTINGS,
};

export default function AdminSettingsPage() {
  const { profile } = useSession();
  const toast = useToast();
  const centerId = profile?.center_id;
  const [center, setCenter] = useState<Center | null>(null);
  const [settings, setSettings] = useState<CenterSettings>(initialSettings);
  const [years, setYears] = useState<FiscalYear[]>([]);
  const [tab, setTab] = useState<SettingsTab>('general');
  const [closing, setClosing] = useState(false);
  const [yearMsg, setYearMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [imageBusy, setImageBusy] = useState(false);
  const [backupBusy, setBackupBusy] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [printPreviewOpen, setPrintPreviewOpen] = useState(false);
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

  const branding = useMemo(() => brandForCenter(center?.name, settings.print), [center?.name, settings.print]);
  const setPrint = (next: Partial<CenterPrintSettings>) => {
    setSettings((old) => ({ ...old, print: { ...old.print, ...next } }));
    setSettingsDirty(true);
  };

  if (profile && !isOwner(profile)) return <Card><Notice tone="error">إعدادات السنتر متاحة لصاحب السنتر فقط.</Notice></Card>;

  const saveGeneral = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!centerId) return;
    setBusy(true); setError(null);
    try {
      await saveCenterSettings(centerId, settings);
      toast.success('تم حفظ الإعدادات', 'حُفظت إعدادات السنتر بنجاح.');
      setSettingsDirty(false); setSettingsOpen(false);
    } catch (err) { setError(err); }
    finally { setBusy(false); }
  };
  const savePrintIdentity = async () => {
    if (!centerId) return;
    setBusy(true); setError(null);
    try {
      await saveCenterSettings(centerId, settings);
      toast.success('تم حفظ هوية الطباعة', 'ستظهر الهوية الجديدة في الاختبارات والتقارير والرواتب وكل المستندات المطبوعة.');
      setSettingsDirty(false);
    } catch (err) { setError(err); }
    finally { setBusy(false); }
  };
  const attachPrintImage = async (field: 'logo_url' | 'watermark_image', file?: File) => {
    if (!file) return;
    setImageBusy(true); setError(null);
    try {
      const source = await imageFileToPrintDataUrl(file);
      setPrint({ [field]: source });
      toast.success(field === 'logo_url' ? 'تم تجهيز شعار السنتر' : 'تم تجهيز صورة العلامة المائية', 'يمكنك الآن معاينتها قبل الحفظ.');
    } catch (err) { setError(err); }
    finally { setImageBusy(false); }
  };

  const exportBackup = async () => {
    if (!centerId || !center) return;
    setBackupBusy(true); setError(null);
    try { const name = await downloadCenterBackup(centerId, center.name, 'web'); toast.success('تم تجهيز النسخة الاحتياطية', name); }
    catch (err) { setError(err); }
    finally { setBackupBusy(false); }
  };
  const closeYear = async () => {
    if (!centerId) return;
    const openYear = years.find((y) => y.status === 'open');
    const label = openYear?.year_label ?? '';
    if (!window.confirm(`سيتم إغلاق السنة المالية ${label || 'الحالية'} وفتح سنة جديدة مع ترحيل الرصيد الافتتاحي والمستحقات المعلقة. هل أنت متأكد؟`)) return;
    setClosing(true); setError(null); setYearMsg(null);
    try {
      const result = await closeFiscalYear(centerId);
      setYearMsg(`تم إغلاق سنة ${result.closed} وفتح سنة ${result.opened} — الرصيد المرحّل: ${formatMoney(result.carry_balance)} والمستحقات المعلقة: ${formatMoney(result.carry_pending)}.`);
      setYears(await fetchMyFiscalYears());
    } catch (err) { setError(err); }
    finally { setClosing(false); }
  };
  const qr = center ? encodeCenterQr(center.id, center.code, center.name) : '';

  const general = <>
    <div className="grid grid-2">
      <Card className="stack">
        <h2 className="h3">بيانات السنتر</h2>
        <div className="row"><Badge tone="info">{center?.kind === 'solo' ? 'مدرس مستقل' : 'سنتر'}</Badge><Badge tone={center?.status === 'active' ? 'success' : 'danger'}>{center?.status ?? '—'}</Badge></div>
        <p className="muted">الاسم: <b>{center?.name ?? '—'}</b></p><p className="muted">الكود: <b dir="ltr">{center?.code ?? '—'}</b></p>
        {qr ? <div className="stack"><QrCode value={qr} /><textarea className="textarea" readOnly dir="ltr" value={qr} /></div> : null}
        <Button type="button" variant="secondary" disabled={backupBusy || !center} onClick={() => void exportBackup()}>{backupBusy ? 'جاري تجهيز النسخة...' : 'تحميل نسخة احتياطية JSON'}</Button>
        <p className="muted tiny">تصدير آمن للقراءة فقط من نفس جداول Android ومحكوم بصلاحيات RLS.</p>
      </Card>
      <Card className="stack">
        <h2 className="h3">الإعدادات التشغيلية</h2>
        <div className="grid grid-2"><Card className="compact soft kpi"><span className="muted">واتساب</span><div className="kpi-value" style={{ fontSize: '1rem' }} dir="ltr">{settings.whatsapp || '—'}</div></Card><Card className="compact soft kpi"><span className="muted">بريد التواصل</span><div className="kpi-value" style={{ fontSize: '1rem' }} dir="ltr">{settings.contact_email || '—'}</div></Card><Card className="compact soft kpi"><span className="muted">السنة/الأرشيف</span><div className="kpi-value" style={{ fontSize: '1rem' }}>{settings.archive_year || '—'}</div></Card><Card className="compact soft kpi"><span className="muted">التسجيل</span><div className="kpi-value" style={{ fontSize: '1rem' }}>{settings.registration_open ? 'مفتوح' : 'مغلق'}</div></Card></div>
        <Button type="button" onClick={() => { setSettingsDirty(false); setError(null); setSettingsOpen(true); }}>تعديل الإعدادات</Button>
      </Card>
    </div>
    <Card className="stack" style={{ marginTop: 18 }}>
      <div className="row-between"><div><h2 className="h3">السنة المالية</h2><p className="muted small" style={{ margin: '6px 0 0' }}>فتح وإغلاق السنة الدراسية يتم من هنا مباشرة — بلا ارتباط بقسم المحاسبة، فالسناتر غير المشتركة تتحكم بسنتها أيضاً.</p></div>{years.some((y) => y.status === 'open') ? <Button type="button" variant="secondary" disabled={closing} onClick={() => void closeYear()}>{closing ? 'جارٍ الإغلاق...' : 'إغلاق السنة وفتح سنة جديدة'}</Button> : null}</div>
      {years.length === 0 ? <p className="muted">لا توجد سنوات مالية مسجلة — تُنشأ تلقائياً مع إنشاء السنتر.</p> : <div className="table-wrap"><table><thead><tr><th>السنة</th><th>تبدأ</th><th>تنتهي</th><th>الحالة</th><th>رصيد افتتاحي</th><th>رصيد الختام</th><th>مستحقات معلقة</th></tr></thead><tbody>{years.map((year) => <tr key={year.id}><td><strong>{year.year_label}</strong></td><td>{formatDate(year.starts_on)}</td><td>{year.ends_on ? formatDate(year.ends_on) : '—'}</td><td><Badge tone={year.status === 'open' ? 'success' : 'default'}>{year.status === 'open' ? 'مفتوحة' : 'مغلقة'}</Badge></td><td>{formatMoney(year.opening_balance)}</td><td>{year.closing_balance === null ? '—' : formatMoney(year.closing_balance)}</td><td>{year.closing_pending_dues === null ? '—' : formatMoney(year.closing_pending_dues)}</td></tr>)}</tbody></table></div>}
    </Card>
  </>;

  const printing = <section className="printing-settings-workspace">
    <Card className="printing-settings-intro"><div><span className="printing-settings-kicker">هوية موحدة لكل المستندات</span><h2 className="h2">هوية الطباعة</h2><p>الشعار والعلامة المائية والتذييل هنا تطبق تلقائياً على الاختبارات، التقارير الأكاديمية، تقارير الطلاب، العهدة، كشوف الرواتب والوثائق المالية.</p></div><div className="row"><Button type="button" variant="secondary" onClick={() => setPrintPreviewOpen(true)}>⌕ معاينة قبل الحفظ</Button><Button type="button" disabled={busy || imageBusy || !settingsDirty} onClick={() => void savePrintIdentity()}>{busy ? 'جارٍ الحفظ…' : 'حفظ هوية الطباعة'}</Button></div></Card>
    <div className="grid grid-2 printing-settings-grid">
      <Card className="stack"><div><h3 className="h3">العلامة المائية</h3><p className="muted tiny">تظهر بخفة على مساحة الورقة كاملة، وتتكرر عند امتداد المستند إلى صفحات متعددة.</p></div>
        <label className="switch-row"><input type="checkbox" checked={settings.print.watermark_enabled} onChange={(event) => setPrint({ watermark_enabled: event.target.checked })} /><span>{settings.print.watermark_enabled ? 'العلامة المائية مفعلة' : 'العلامة المائية متوقفة'}</span></label>
        <Textarea label="نص العلامة المائية" value={settings.print.watermark_text} onChange={(event) => setPrint({ watermark_text: event.target.value })} placeholder={`يستخدم اسم السنتر تلقائياً: ${branding.center_name}`} help="اتركه فارغاً لاستخدام اسم السنتر تلقائياً." />
        <div className="grid grid-2"><Select label="اتجاه النص / الصورة" value={settings.print.watermark_direction} onChange={(event) => setPrint({ watermark_direction: event.target.value as CenterPrintSettings['watermark_direction'] })}><option value="diagonal">مائل قطرياً</option><option value="vertical">طولي</option><option value="horizontal">أفقي</option></Select><div className="input-wrap"><span className="label">شفافية العلامة: {Math.round(settings.print.watermark_opacity * 100)}%</span><input className="input" type="range" min="2" max="32" value={Math.round(settings.print.watermark_opacity * 100)} onChange={(event) => setPrint({ watermark_opacity: Number(event.target.value) / 100 })} /></div></div>
        <label className="input-wrap"><span className="label">إرفاق صورة للعلامة المائية</span><input className="input" type="file" accept="image/png,image/jpeg,image/webp" disabled={imageBusy} onChange={(event) => void attachPrintImage('watermark_image', event.target.files?.[0])} /><span className="tiny muted">تضغط الصورة محلياً قبل الحفظ. اختر صورة حتى 8 MB.</span></label>
        <Input label="رابط صورة العلامة (اختياري)" value={settings.print.watermark_image} onChange={(event) => setPrint({ watermark_image: event.target.value })} placeholder="https://… أو يُملأ تلقائياً بعد الإرفاق" />
        {settings.print.watermark_image ? <div className="printing-image-row"><img src={settings.print.watermark_image} alt="معاينة العلامة المائية" /><Button type="button" variant="ghost" onClick={() => setPrint({ watermark_image: '' })}>إزالة الصورة</Button></div> : null}
      </Card>
      <Card className="stack"><div><h3 className="h3">شعار السنتر وتذييل الورقة</h3><p className="muted tiny">اسم السنتر يظهر دائماً بخط صغير في الهامش السفلي؛ أضف العنوان ليظهر بجواره.</p></div>
        <Input label="عنوان السنتر في التذييل" value={settings.print.footer_address} onChange={(event) => setPrint({ footer_address: event.target.value })} placeholder="مثال: طلخا — شارع …" />
        <div className="grid grid-2"><Select label="مكان الشعار في الورقة" value={settings.print.logo_position} onChange={(event) => setPrint({ logo_position: event.target.value as CenterPrintSettings['logo_position'] })}><option value="top_right">أعلى اليمين</option><option value="top_left">أعلى اليسار</option><option value="top_center">أعلى المنتصف</option><option value="bottom_right">أسفل اليمين</option><option value="bottom_left">أسفل اليسار</option></Select><div className="input-wrap"><span className="label">حجم الشعار: {settings.print.logo_size}px</span><input className="input" type="range" min="24" max="110" value={settings.print.logo_size} onChange={(event) => setPrint({ logo_size: Number(event.target.value) })} /></div></div>
        <label className="input-wrap"><span className="label">إرفاق شعار السنتر</span><input className="input" type="file" accept="image/png,image/jpeg,image/webp" disabled={imageBusy} onChange={(event) => void attachPrintImage('logo_url', event.target.files?.[0])} /><span className="tiny muted">يظهر الشعار تلقائياً في كل ورقة مطبوعة من السنتر.</span></label>
        <Input label="رابط الشعار (اختياري)" value={settings.print.logo_url} onChange={(event) => setPrint({ logo_url: event.target.value })} placeholder="https://… أو يُملأ تلقائياً بعد الإرفاق" />
        {settings.print.logo_url ? <div className="printing-image-row"><img src={settings.print.logo_url} alt="شعار السنتر" /><Button type="button" variant="ghost" onClick={() => setPrint({ logo_url: '' })}>إزالة الشعار</Button></div> : null}
      </Card>
    </div>
    <Card className="printing-preview-card"><div className="row-between"><div><h3 className="h3">معاينة فورية</h3><p className="muted tiny">هذه معاينة للتصميم الحالي حتى قبل حفظه.</p></div><Button type="button" variant="secondary" onClick={() => setPrintPreviewOpen(true)}>تكبير المعاينة</Button></div><PrintIdentityPreview branding={branding} compact /></Card>
  </section>;

  return <>
    <PageHeader title="إعدادات السنتر" subtitle="بيانات التشغيل، السنة المالية، وهوية موحدة لكل ورقة مطبوعة." />
    <ErrorNotice error={error} />{yearMsg ? <Notice tone="success">{yearMsg}</Notice> : null}
    <nav className="settings-section-tabs" aria-label="أقسام إعدادات السنتر"><button type="button" className={tab === 'general' ? 'active' : ''} onClick={() => setTab('general')}>⚙ الإعدادات العامة</button><button type="button" className={tab === 'printing' ? 'active' : ''} onClick={() => setTab('printing')}>▧ هوية الطباعة</button></nav>
    {tab === 'general' ? general : printing}

    <Modal open={settingsOpen} title="الإعدادات التشغيلية" subtitle="واتساب وبريد التواصل وأرشيف السنة وحالة التسجيل" dirty={settingsDirty} onClose={() => setSettingsOpen(false)} onSave={() => void saveGeneral({ preventDefault: () => {} } as React.FormEvent)} saveLabel={busy ? 'جاري الحفظ...' : 'حفظ الإعدادات'} footer={<Button disabled={busy} type="submit" form="settings-form">{busy ? 'جاري الحفظ...' : 'حفظ الإعدادات'}</Button>}><form id="settings-form" className="stack" onSubmit={saveGeneral}><Input label="واتساب السنتر" value={settings.whatsapp} onChange={(event) => { setSettings({ ...settings, whatsapp: event.target.value }); setSettingsDirty(true); }} dir="ltr" /><Input label="بريد التواصل" value={settings.contact_email} onChange={(event) => { setSettings({ ...settings, contact_email: event.target.value }); setSettingsDirty(true); }} dir="ltr" /><Input label="السنة/الأرشيف" value={settings.archive_year} onChange={(event) => { setSettings({ ...settings, archive_year: event.target.value }); setSettingsDirty(true); }} /><label className="row small muted"><input type="checkbox" checked={settings.registration_open} onChange={(event) => { setSettings({ ...settings, registration_open: event.target.checked }); setSettingsDirty(true); }} /> التسجيل مفتوح للطلاب</label><ErrorNotice error={error} /></form></Modal>
    <Modal open={printPreviewOpen} title="معاينة هوية الطباعة" subtitle="تظهر الهوية كما ستخرج في المستندات، ويمكنك العودة للتعديل دون حفظ." onClose={() => setPrintPreviewOpen(false)} wide footer={<div className="row"><Button type="button" variant="secondary" onClick={() => setPrintPreviewOpen(false)}>متابعة التعديل</Button><Button type="button" disabled={busy || imageBusy || !settingsDirty} onClick={() => void savePrintIdentity()}>{busy ? 'جارٍ الحفظ…' : 'حفظ الهوية'}</Button></div>}><PrintIdentityPreview branding={branding} /></Modal>
  </>;
}
