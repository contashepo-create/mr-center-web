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
type GeneralSettingsSection = 'profile' | 'operations' | 'fiscal' | 'backup';

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
  const [generalSection, setGeneralSection] = useState<GeneralSettingsSection>('profile');
  const [closing, setClosing] = useState(false);
  const [yearMsg, setYearMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [imageBusy, setImageBusy] = useState(false);
  const [backupBusy, setBackupBusy] = useState(false);
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
      setSettingsDirty(false);
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

  const general = <section className="settings-general-workspace">
    <Card className="settings-general-hero">
      <div className="settings-center-avatar" aria-hidden="true">{(center?.name ?? 'م').trim().slice(0, 1)}</div>
      <div className="settings-general-hero-copy"><span className="settings-general-kicker">لوحة إدارة السنتر</span><h2>{center?.name ?? 'بيانات السنتر'}</h2><p>إدارة منظمة لهوية السنتر، التشغيل اليومي، السنة المالية والنسخ الاحتياطي من مكان واحد.</p><div className="settings-center-tags"><Badge tone="info">{center?.kind === 'solo' ? 'مدرس مستقل' : 'سنتر تعليمي'}</Badge><Badge tone={center?.status === 'active' ? 'success' : 'danger'}>{center?.status === 'active' ? 'الحساب نشط' : center?.status ?? '—'}</Badge><span className="tiny muted">الكود: <b dir="ltr">{center?.code ?? '—'}</b></span></div></div>
      <div className="settings-general-hero-action"><span className="tiny muted">آخر حفظ للإعدادات</span><strong>{settingsDirty ? 'توجد تعديلات غير محفوظة' : 'كل التغييرات محفوظة'}</strong><Button type="button" variant="secondary" onClick={() => setTab('printing')}>هوية الطباعة ←</Button></div>
    </Card>
    <div className="settings-general-console">
      <nav className="settings-general-nav" aria-label="أقسام الإعدادات العامة">
        <button type="button" className={generalSection === 'profile' ? 'active' : ''} onClick={() => setGeneralSection('profile')}><span>⌂</span><div><strong>بيانات السنتر</strong><small>الهوية والكود</small></div></button>
        <button type="button" className={generalSection === 'operations' ? 'active' : ''} onClick={() => setGeneralSection('operations')}><span>⚙</span><div><strong>التشغيل والتواصل</strong><small>التسجيل وقنوات التواصل</small></div></button>
        <button type="button" className={generalSection === 'fiscal' ? 'active' : ''} onClick={() => setGeneralSection('fiscal')}><span>◷</span><div><strong>السنة المالية</strong><small>الأرشفة والأرصدة</small></div></button>
        <button type="button" className={generalSection === 'backup' ? 'active' : ''} onClick={() => setGeneralSection('backup')}><span>◫</span><div><strong>النسخ والأمان</strong><small>QR ونسخة البيانات</small></div></button>
      </nav>
      <div className="settings-general-pane">
        {generalSection === 'profile' ? <Card className="stack settings-pane-card"><div className="settings-pane-title"><div><span className="settings-general-kicker">هوية الحساب</span><h3 className="h2">بيانات السنتر</h3><p>هذه البيانات التعريفية التي يعتمد عليها نظام السنتر والروابط الداخلية.</p></div><Badge tone="info">معرف موثوق</Badge></div><div className="settings-profile-grid"><div className="settings-profile-item"><span>اسم السنتر</span><strong>{center?.name ?? '—'}</strong></div><div className="settings-profile-item"><span>كود السنتر</span><strong dir="ltr">{center?.code ?? '—'}</strong></div><div className="settings-profile-item"><span>نوع الحساب</span><strong>{center?.kind === 'solo' ? 'مدرس مستقل' : 'سنتر تعليمي'}</strong></div><div className="settings-profile-item"><span>الحالة</span><strong>{center?.status === 'active' ? 'نشط' : center?.status ?? '—'}</strong></div></div><Notice tone="info">لتبقى الحسابات والطلاب معزولين بأمان، لا تُعدّل بيانات التعريف الأساسية من هذه الصفحة. استخدم قسم التواصل والتشغيل لتحديث ما يظهر للمستخدمين.</Notice></Card> : null}
        {generalSection === 'operations' ? <Card className="settings-pane-card"><form className="stack" onSubmit={saveGeneral}><div className="settings-pane-title"><div><span className="settings-general-kicker">تشغيل يومي</span><h3 className="h2">التواصل وإتاحة التسجيل</h3><p>اضبط بيانات التواصل وحالة التسجيل والأرشيف بطريقة مباشرة ثم احفظ التغييرات.</p></div><Button type="submit" disabled={busy || !settingsDirty}>{busy ? 'جارٍ الحفظ…' : 'حفظ التغييرات'}</Button></div><div className="settings-form-grid"><Input label="واتساب السنتر" value={settings.whatsapp} onChange={(event) => { setSettings({ ...settings, whatsapp: event.target.value }); setSettingsDirty(true); }} dir="ltr" placeholder="2010…" help="رقم التواصل الذي يظهر للطلاب وأولياء الأمور." /><Input label="بريد التواصل" value={settings.contact_email} onChange={(event) => { setSettings({ ...settings, contact_email: event.target.value }); setSettingsDirty(true); }} dir="ltr" placeholder="center@example.com" help="قناة التواصل الرسمية للسنتر." /><Input label="اسم الأرشيف / السنة الدراسية" value={settings.archive_year} onChange={(event) => { setSettings({ ...settings, archive_year: event.target.value }); setSettingsDirty(true); }} placeholder="مثال: 2026 / 2027" /></div><div className="settings-switch-surface"><div><strong>إتاحة تسجيل الطلاب</strong><p>{settings.registration_open ? 'التسجيل متاح حالياً ويمكن للطلاب الجدد بدء الطلب.' : 'أُغلق التسجيل العام، وتبقى بيانات الطلاب الحاليين دون تغيير.'}</p></div><label className="switch-row"><input type="checkbox" checked={settings.registration_open} onChange={(event) => { setSettings({ ...settings, registration_open: event.target.checked }); setSettingsDirty(true); }} /><span>{settings.registration_open ? 'مفتوح' : 'مغلق'}</span></label></div><ErrorNotice error={error} /></form></Card> : null}
        {generalSection === 'fiscal' ? <Card className="stack settings-pane-card"><div className="settings-pane-title"><div><span className="settings-general-kicker">تنظيم مالي</span><h3 className="h2">السنة المالية</h3><p>إغلاق السنة يرحّل الرصيد الافتتاحي والمستحقات إلى سنة جديدة مع الاحتفاظ بالسجل.</p></div>{years.some((year) => year.status === 'open') ? <Button type="button" variant="secondary" disabled={closing} onClick={() => void closeYear()}>{closing ? 'جارٍ الإغلاق…' : 'إغلاق السنة وفتح الجديدة'}</Button> : null}</div>{years.length === 0 ? <Notice tone="info">لا توجد سنوات مالية مسجلة — تُنشأ تلقائياً مع إنشاء السنتر.</Notice> : <div className="table-wrap"><table><thead><tr><th>السنة</th><th>تبدأ</th><th>تنتهي</th><th>الحالة</th><th>رصيد افتتاحي</th><th>رصيد الختام</th><th>مستحقات معلقة</th></tr></thead><tbody>{years.map((year) => <tr key={year.id}><td><strong>{year.year_label}</strong></td><td>{formatDate(year.starts_on)}</td><td>{year.ends_on ? formatDate(year.ends_on) : '—'}</td><td><Badge tone={year.status === 'open' ? 'success' : 'default'}>{year.status === 'open' ? 'مفتوحة' : 'مغلقة'}</Badge></td><td>{formatMoney(year.opening_balance)}</td><td>{year.closing_balance === null ? '—' : formatMoney(year.closing_balance)}</td><td>{year.closing_pending_dues === null ? '—' : formatMoney(year.closing_pending_dues)}</td></tr>)}</tbody></table></div>}</Card> : null}
        {generalSection === 'backup' ? <Card className="settings-pane-card"><div className="settings-pane-title"><div><span className="settings-general-kicker">استمرارية وأمان</span><h3 className="h2">النسخ الاحتياطي ورمز السنتر</h3><p>احتفظ بنسخة قابلة للقراءة من البيانات، وشارك رمز السنتر الموثوق عند الحاجة.</p></div><Button type="button" variant="secondary" disabled={backupBusy || !center} onClick={() => void exportBackup()}>{backupBusy ? 'جارٍ تجهيز النسخة…' : 'تحميل نسخة احتياطية JSON'}</Button></div><div className="settings-backup-grid"><div className="settings-backup-copy"><h4>نسخة بيانات السنتر</h4><p>التصدير للقراءة فقط ومن جداول السنتر المعزولة بصلاحيات RLS. لا يغير أي سجل موجود.</p><Notice tone="info">احفظ الملف في مكان آمن ولا تشاركه إلا مع من يملك صلاحية الاطلاع على بيانات السنتر.</Notice></div>{qr ? <details className="settings-qr-card"><summary>عرض رمز QR وبيانات المشاركة</summary><div className="stack"><QrCode value={qr} /><textarea className="textarea" readOnly dir="ltr" value={qr} /></div></details> : null}</div></Card> : null}
      </div>
    </div>
  </section>;

  const printing = <section className="printing-settings-workspace">
    <Card className="printing-settings-intro"><div><span className="printing-settings-kicker">هوية موحدة لكل المستندات</span><h2 className="h2">هوية الطباعة</h2><p>الشعار والعلامة المائية والتذييل هنا تطبق تلقائياً على الاختبارات، التقارير الأكاديمية، تقارير الطلاب، العهدة، كشوف الرواتب والوثائق المالية.</p></div><div className="row"><Button type="button" variant="secondary" onClick={() => setPrintPreviewOpen(true)}>⌕ معاينة قبل الحفظ</Button><Button type="button" disabled={busy || imageBusy || !settingsDirty} onClick={() => void savePrintIdentity()}>{busy ? 'جارٍ الحفظ…' : 'حفظ هوية الطباعة'}</Button></div></Card>
    <div className="grid grid-2 printing-settings-grid">
      <Card className="stack"><div><h3 className="h3">العلامة المائية</h3><p className="muted tiny">اختر ظهورها فوق المحتوى لتظل واضحة على الأسئلة والجداول، أو خلفه لتصميم أكثر هدوءاً. تتكرر الخيارات نفسها في كل صفحة مطبوعة.</p></div>
        <label className="switch-row"><input type="checkbox" checked={settings.print.watermark_enabled} onChange={(event) => setPrint({ watermark_enabled: event.target.checked })} /><span>{settings.print.watermark_enabled ? 'العلامة المائية مفعلة' : 'العلامة المائية متوقفة'}</span></label>
        <Textarea label="نص العلامة المائية" value={settings.print.watermark_text} onChange={(event) => setPrint({ watermark_text: event.target.value })} placeholder={`يستخدم اسم السنتر تلقائياً: ${branding.center_name}`} help="اتركه فارغاً لاستخدام اسم السنتر تلقائياً، حتى لو أخفيت الاسم من الترويسة أو التذييل." />
        <div className="grid grid-2"><Select label="نمط توزيع العلامة" value={settings.print.watermark_pattern} onChange={(event) => setPrint({ watermark_pattern: event.target.value as CenterPrintSettings['watermark_pattern'] })}><option value="single">علامة واحدة في المنتصف</option><option value="grid">شبكة متساوية تغطي الورقة</option><option value="staggered">شبكة متداخلة تغطي الورقة</option></Select><Select label="طبقة العلامة" value={settings.print.watermark_layer} onChange={(event) => setPrint({ watermark_layer: event.target.value as CenterPrintSettings['watermark_layer'] })}><option value="front">فوق الأسئلة والجداول (موصى به)</option><option value="behind">خلف المحتوى</option></Select></div>
        <div className="grid grid-3"><div className="input-wrap"><span className="label">عدد العلامات: {settings.print.watermark_pattern === 'single' ? 1 : settings.print.watermark_repeat_count}</span><input className="input" type="range" min="1" max="36" disabled={settings.print.watermark_pattern === 'single'} value={settings.print.watermark_repeat_count} onChange={(event) => setPrint({ watermark_repeat_count: Number(event.target.value) })} /><span className="tiny muted">من ١ إلى ٣٦ علامة في الصفحة</span></div><div className="input-wrap"><span className="label">حجم خط العلامة: {settings.print.watermark_font_size}px</span><input className="input" type="range" min="16" max="180" value={settings.print.watermark_font_size} onChange={(event) => setPrint({ watermark_font_size: Number(event.target.value) })} /></div><div className="input-wrap"><span className="label">شفافية العلامة: {Math.round(settings.print.watermark_opacity * 100)}%</span><input className="input" type="range" min="1" max="55" value={Math.round(settings.print.watermark_opacity * 100)} onChange={(event) => setPrint({ watermark_opacity: Number(event.target.value) / 100 })} /></div></div>
        <div className="grid grid-3"><Select label="اتجاه النص / الصورة" value={settings.print.watermark_direction} onChange={(event) => setPrint({ watermark_direction: event.target.value as CenterPrintSettings['watermark_direction'] })}><option value="diagonal">مائل قطرياً</option><option value="vertical">طولي</option><option value="horizontal">أفقي</option></Select><Input label="لون نص العلامة" type="color" value={settings.print.watermark_color} onChange={(event) => setPrint({ watermark_color: event.target.value })} /><div className="input-wrap"><span className="label">حجم صورة العلامة: {settings.print.watermark_image_size}px</span><input className="input" type="range" min="32" max="340" value={settings.print.watermark_image_size} onChange={(event) => setPrint({ watermark_image_size: Number(event.target.value) })} /></div></div>
        <label className="input-wrap"><span className="label">إرفاق صورة للعلامة المائية</span><input className="input" type="file" accept="image/png,image/jpeg,image/webp" disabled={imageBusy} onChange={(event) => void attachPrintImage('watermark_image', event.target.files?.[0])} /><span className="tiny muted">تضغط الصورة محلياً قبل الحفظ. اختر صورة حتى 8 MB.</span></label>
        <Input label="رابط صورة العلامة (اختياري)" value={settings.print.watermark_image} onChange={(event) => setPrint({ watermark_image: event.target.value })} placeholder="https://… أو يُملأ تلقائياً بعد الإرفاق" />
        {settings.print.watermark_image ? <div className="printing-image-row"><img src={settings.print.watermark_image} alt="معاينة العلامة المائية" /><Button type="button" variant="ghost" onClick={() => setPrint({ watermark_image: '' })}>إزالة الصورة</Button></div> : null}
      </Card>
      <Card className="stack"><div><h3 className="h3">اسم السنتر والعنوان والشعار</h3><p className="muted tiny">تحكم بشكل مستقل في اسم السنتر أعلى المستند، وفي الاسم والعنوان بأسفل كل ورقة.</p></div>
        <label className="switch-row"><input type="checkbox" checked={settings.print.header_show_center_name} onChange={(event) => setPrint({ header_show_center_name: event.target.checked })} /><span>إظهار اسم السنتر في ترويسة الوثيقة وورقة الاختبار</span></label>
        <label className="switch-row"><input type="checkbox" checked={settings.print.footer_enabled} onChange={(event) => setPrint({ footer_enabled: event.target.checked })} /><span>{settings.print.footer_enabled ? 'تذييل الهوية مفعل' : 'تذييل الهوية متوقف'}</span></label>
        <div className="grid grid-2"><label className="row small"><input type="checkbox" disabled={!settings.print.footer_enabled} checked={settings.print.footer_show_center_name} onChange={(event) => setPrint({ footer_show_center_name: event.target.checked })} /> إظهار اسم السنتر في التذييل</label><label className="row small"><input type="checkbox" disabled={!settings.print.footer_enabled} checked={settings.print.footer_show_address} onChange={(event) => setPrint({ footer_show_address: event.target.checked })} /> إظهار العنوان في التذييل</label></div>
        <Input label="عنوان السنتر في التذييل" disabled={!settings.print.footer_enabled || !settings.print.footer_show_address} value={settings.print.footer_address} onChange={(event) => setPrint({ footer_address: event.target.value })} placeholder="مثال: طلخا — شارع …" />
        <div className="grid grid-2"><div className="input-wrap"><span className="label">حجم خط التذييل: {settings.print.footer_font_size}px</span><input className="input" type="range" min="7" max="18" disabled={!settings.print.footer_enabled} value={settings.print.footer_font_size} onChange={(event) => setPrint({ footer_font_size: Number(event.target.value) })} /></div><Select label="مكان الشعار في الورقة" value={settings.print.logo_position} onChange={(event) => setPrint({ logo_position: event.target.value as CenterPrintSettings['logo_position'] })}><option value="top_right">أعلى اليمين</option><option value="top_left">أعلى اليسار</option><option value="top_center">أعلى المنتصف</option><option value="bottom_right">أسفل اليمين</option><option value="bottom_left">أسفل اليسار</option></Select></div>
        <div className="input-wrap"><span className="label">حجم الشعار: {settings.print.logo_size}px</span><input className="input" type="range" min="24" max="110" value={settings.print.logo_size} onChange={(event) => setPrint({ logo_size: Number(event.target.value) })} /></div>
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

    <Modal open={printPreviewOpen} title="معاينة هوية الطباعة" subtitle="تظهر الهوية كما ستخرج في المستندات، ويمكنك العودة للتعديل دون حفظ." onClose={() => setPrintPreviewOpen(false)} wide footer={<div className="row"><Button type="button" variant="secondary" onClick={() => setPrintPreviewOpen(false)}>متابعة التعديل</Button><Button type="button" disabled={busy || imageBusy || !settingsDirty} onClick={() => void savePrintIdentity()}>{busy ? 'جارٍ الحفظ…' : 'حفظ الهوية'}</Button></div>}><PrintIdentityPreview branding={branding} /></Modal>
  </>;
}
