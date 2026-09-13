'use client';

import { useEffect, useMemo, useState } from 'react';
import { Button, Card, EmptyState, ErrorNotice, Input, Notice, PageHeader, Select, Textarea } from '@/components/ui';
import { Modal } from '@/components/modal';
import { useToast } from '@/components/toast';
import { devFetchCenters, developerBroadcastNotification, type CenterWithSub } from '@/lib/api';
import type { CenterBroadcastDelivery, DeveloperBroadcastChannel } from '@/lib/types';

type StaffScope = 'all_centers' | 'one_center';
type BroadcastForm = {
  channel: DeveloperBroadcastChannel;
  centerId: string;
  centerDelivery: CenterBroadcastDelivery;
  staffScope: StaffScope;
  title: string;
  body: string;
};

const initialForm: BroadcastForm = {
  channel: 'center', centerId: '', centerDelivery: 'owners', staffScope: 'all_centers', title: '', body: '',
};

const channelOptions: Array<{ value: DeveloperBroadcastChannel; label: string; detail: string }> = [
  { value: 'center', label: '١. سنتر محدد', detail: 'اختر سنتراً ثم أرسل لصاحبه فقط أو لصاحبه وطلابه.' },
  { value: 'all_owners', label: '٢. أصحاب كل السناتر', detail: 'رسالة واحدة مخصصة لصاحب كل سنتر.' },
  { value: 'all_owners_students', label: '٣. السناتر وطلابها كلها', detail: 'تصل إلى أصحاب كل السناتر وكل الطلاب.' },
  { value: 'all_students', label: '٤. الطلاب كلهم فقط', detail: 'لا تصل إلى أصحاب السناتر أو موظفيهم.' },
  { value: 'staff', label: '٥. موظفو السناتر', detail: 'إلى المدرسين والمديرين والسكرتارية في كل السناتر أو سنتر تختاره.' },
];

function channelDescription(form: BroadcastForm, selectedCenter?: CenterWithSub): string {
  const centerName = selectedCenter ? `سنتر «${selectedCenter.name}»` : 'السنتر المختار';
  if (form.channel === 'center') return form.centerDelivery === 'owners' ? `سيصل إلى صاحب ${centerName} فقط.` : `سيصل إلى صاحب ${centerName} وطلابه.`;
  if (form.channel === 'all_owners') return 'سيصل إلى أصحاب السناتر كلها.';
  if (form.channel === 'all_owners_students') return 'سيصل إلى أصحاب السناتر كلها وكل طلابها.';
  if (form.channel === 'all_students') return 'سيصل إلى الطلاب في كل السناتر فقط.';
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
      });
      toast.success('تم إرسال البث', `استهدف ${result.recipient_accounts} حساباً في ${result.centers} سنتر، وسُجل ${result.notification_rows} إشعاراً آمناً.`);
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
      subtitle="اختر بدقة واحدة من قنوات المطور الخمس؛ يحدد الخادم المستلمين ويحافظ على عزل كل سنتر."
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
          <option value="owners">صاحب السنتر فقط</option>
          <option value="owners_students">صاحب السنتر وطلابه</option>
        </Select> : null}

        <Notice tone="success"><strong>المستلمون:</strong> {channelDescription(form, selectedCenter)}</Notice>
        <Input label="عنوان الإشعار" value={form.title} maxLength={180} onChange={(event) => change({ title: event.target.value })} required />
        <Textarea label="نص الرسالة" value={form.body} maxLength={5000} onChange={(event) => change({ body: event.target.value })} required />
        <ErrorNotice error={error} />
      </form>
    </Modal>
  </>;
}
