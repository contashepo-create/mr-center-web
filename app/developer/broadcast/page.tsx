'use client';

import { useEffect, useMemo, useState } from 'react';
import { Button, Card, EmptyState, ErrorNotice, Input, Notice, PageHeader, Select, Textarea } from '@/components/ui';
import { Modal } from '@/components/modal';
import { useToast } from '@/components/toast';
import { devFetchCenters, developerBroadcastNotification, type CenterWithSub } from '@/lib/api';
import type { CenterBroadcastDelivery, DeveloperBroadcastChannel, DeveloperBroadcastPresentation } from '@/lib/types';

type StaffScope = 'all_centers' | 'one_center';
type BroadcastForm = {
  channel: DeveloperBroadcastChannel;
  centerId: string;
  centerDelivery: CenterBroadcastDelivery;
  presentation: DeveloperBroadcastPresentation;
  staffScope: StaffScope;
  title: string;
  body: string;
};

const initialForm: BroadcastForm = {
  channel: 'center', centerId: '', centerDelivery: 'owners', presentation: 'notification', staffScope: 'all_centers', title: '', body: '',
};

const channelOptions: Array<{ value: DeveloperBroadcastChannel; label: string; detail: string }> = [
  { value: 'center', label: 'سنتر محدد', detail: 'اختر السنتر ثم حدد أي مزيج من المالك والموظفين والطلاب.' },
  { value: 'all_owners', label: 'أصحاب السناتر', detail: 'صاحب كل سنتر فقط.' },
  { value: 'all_owners_staff', label: 'أصحاب السناتر وموظفوهم', detail: 'كل مالك وكل موظف نشط، من دون الطلاب.' },
  { value: 'all_owners_students', label: 'كل أعضاء السناتر', detail: 'أصحاب السناتر والموظفون النشطون والطلاب. هذا هو الخيار الشامل للسناتر.' },
  { value: 'all_students', label: 'الطلاب فقط', detail: 'لا تصل لأصحاب السناتر أو موظفيهم.' },
  { value: 'staff', label: 'الموظفون فقط', detail: 'المدرسون والمديرون والسكرتارية، في كل السناتر أو سنتر واحد.' },
  { value: 'all_project', label: 'كل حسابات المشروع', detail: 'كل الحسابات المرتبطة بالسناتر: أصحابها وموظفوها وطلابها. لا يرسل للمطور الذي أنشأ البث.' },
];

const deliveryOptions: Array<{ value: CenterBroadcastDelivery; label: string }> = [
  { value: 'owners', label: 'صاحب السنتر فقط' },
  { value: 'owners_staff', label: 'صاحب السنتر والموظفون' },
  { value: 'owners_students', label: 'صاحب السنتر والموظفون والطلاب' },
  { value: 'students', label: 'الطلاب فقط' },
  { value: 'staff', label: 'الموظفون فقط' },
  { value: 'everyone', label: 'كل حسابات هذا السنتر' },
];

const presentationOptions: Array<{ value: DeveloperBroadcastPresentation; label: string; detail: string }> = [
  { value: 'notification', label: 'إشعار عادي', detail: 'يظهر في زر الجرس والصفحة المختصة.' },
  { value: 'message', label: 'رسالة', detail: 'يظهر في زر الرسائل وصندوق رسائل المطور.' },
  { value: 'urgent', label: 'تنبيه طارئ', detail: 'يظهر فوراً في نافذة منبثقة، ويبقى في الجرس حتى قراءته.' },
];

function channelDescription(form: BroadcastForm, selectedCenter?: CenterWithSub): string {
  const centerName = selectedCenter ? `سنتر «${selectedCenter.name}»` : 'السنتر المختار';
  if (form.channel === 'center') return `سيصل إلى: ${deliveryOptions.find((option) => option.value === form.centerDelivery)?.label ?? 'المستلمين المختارين'} في ${centerName}.`;
  if (form.channel === 'all_owners') return 'سيصل إلى أصحاب كل السناتر فقط.';
  if (form.channel === 'all_owners_staff') return 'سيصل إلى أصحاب كل السناتر وموظفيهم النشطين.';
  if (form.channel === 'all_owners_students') return 'سيصل إلى أصحاب السناتر وموظفيهم وطلابهم، مرة واحدة لكل حساب.';
  if (form.channel === 'all_students') return 'سيصل إلى الطلاب في كل السناتر فقط.';
  if (form.channel === 'all_project') return 'سيصل إلى كل أصحاب السناتر وموظفيهم وطلابهم، مرة واحدة لكل حساب.';
  return form.staffScope === 'all_centers' ? 'سيصل إلى الموظفين النشطين في كل السناتر.' : `سيصل إلى الموظفين النشطين داخل ${centerName} فقط.`;
}

export default function DeveloperBroadcastPage() {
  const toast = useToast();
  const [centers, setCenters] = useState<CenterWithSub[]>([]);
  const [form, setForm] = useState<BroadcastForm>(initialForm);
  const [open, setOpen] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    devFetchCenters()
      .then((rows) => {
        setCenters(rows);
        if (rows[0]) setForm((current) => current.centerId ? current : { ...current, centerId: rows[0].id });
      })
      .catch(setError);
  }, []);

  const selectedCenter = useMemo(() => centers.find((center) => center.id === form.centerId), [centers, form.centerId]);
  const needsCenter = form.channel === 'center' || (form.channel === 'staff' && form.staffScope === 'one_center');
  const selectedChannel = channelOptions.find((option) => option.value === form.channel);
  const canSend = !!form.title.trim() && !!form.body.trim() && (!needsCenter || !!form.centerId);

  const openCompose = () => {
    setForm({ ...initialForm, centerId: centers[0]?.id ?? '' });
    setDirty(false);
    setError(null);
    setOpen(true);
  };
  const change = (patch: Partial<BroadcastForm>) => { setForm((current) => ({ ...current, ...patch })); setDirty(true); };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSend) return;
    setBusy(true);
    setError(null);
    try {
      const result = await developerBroadcastNotification({
        channel: form.channel,
        title: form.title,
        body: form.body,
        centerId: needsCenter ? form.centerId : null,
        centerDelivery: form.channel === 'center' ? form.centerDelivery : null,
        presentation: form.presentation,
      });
      const mode = presentationOptions.find((option) => option.value === form.presentation)?.label ?? 'إشعار';
      toast.success('تم إرسال البث', `${mode}: استهدف ${result.recipient_accounts} حساباً في ${result.centers} سنتر، مرة واحدة لكل حساب.`);
      setDirty(false);
      setOpen(false);
      setForm((current) => ({ ...current, title: '', body: '' }));
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return <>
    <PageHeader
      title="بث وإشعارات العملاء"
      subtitle="اختر الجمهور وطريقة الظهور؛ يحدد الخادم المستلمين ويمنع التكرار ويحافظ على عزل كل سنتر."
      actions={<Button type="button" onClick={openCompose}>+ بث جديد</Button>}
    />
    <ErrorNotice error={error} />
    <Card className="stack">
      <div className="row-between"><div><h2 className="h3">قنوات البث المتاحة</h2><p className="muted small">كل قناة تسجل رسائل منفصلة ومعزولة لكل سنتر؛ لا يطلع مستلم على سنتر آخر.</p></div></div>
      <div className="grid grid-2">
        {channelOptions.map((option) => <div className="card compact soft stack" key={option.value}><strong>{option.label}</strong><span className="muted small">{option.detail}</span></div>)}
      </div>
      {centers.length === 0 ? <EmptyState title="لا توجد سناتر قابلة للاختيار" body="ما زالت القنوات العامة متاحة عند وجود سناتر مسجلة." /> : null}
    </Card>

    <Modal
      open={open}
      title="إنشاء بث مطور"
      dirty={dirty}
      onClose={() => setOpen(false)}
      onSave={() => void submit({ preventDefault: () => {} } as React.FormEvent)}
      saveLabel={busy ? 'جارٍ الإرسال…' : 'إرسال البث'}
      footer={<Button disabled={busy || !canSend} type="submit" form="dev-broadcast-form">{busy ? 'جارٍ الإرسال…' : 'إرسال البث'}</Button>}
    >
      <form id="dev-broadcast-form" className="stack" onSubmit={submit}>
        <Select label="قناة البث" value={form.channel} onChange={(event) => change({ channel: event.target.value as DeveloperBroadcastChannel })}>
          {channelOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </Select>
        {selectedChannel ? <Notice tone="info">{selectedChannel.detail}</Notice> : null}

        {form.channel === 'staff' ? <Select label="نطاق الموظفين" value={form.staffScope} onChange={(event) => change({ staffScope: event.target.value as StaffScope })}>
          <option value="all_centers">الموظفون في كل السناتر</option>
          <option value="one_center">الموظفون داخل سنتر محدد</option>
        </Select> : null}

        {needsCenter ? <Select label="اختيار السنتر" value={form.centerId} onChange={(event) => change({ centerId: event.target.value })}>
          <option value="">اختر السنتر</option>
          {centers.map((center) => <option key={center.id} value={center.id}>{center.name} — {center.code}</option>)}
        </Select> : null}

        {form.channel === 'center' ? <Select label="مستلمو السنتر المحدد" value={form.centerDelivery} onChange={(event) => change({ centerDelivery: event.target.value as CenterBroadcastDelivery })}>
          {deliveryOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </Select> : null}

        <Select label="طريقة الظهور" value={form.presentation} onChange={(event) => change({ presentation: event.target.value as DeveloperBroadcastPresentation })}>
          {presentationOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </Select>
        <Notice tone="info">{presentationOptions.find((option) => option.value === form.presentation)?.detail}</Notice>
        <Notice tone="success"><strong>المستلمون:</strong> {channelDescription(form, selectedCenter)}</Notice>
        <Input label="عنوان الإشعار" value={form.title} maxLength={180} onChange={(event) => change({ title: event.target.value })} required />
        <Textarea label="نص الرسالة" value={form.body} maxLength={5000} onChange={(event) => change({ body: event.target.value })} required />
        <ErrorNotice error={error} />
      </form>
    </Modal>
  </>;
}
