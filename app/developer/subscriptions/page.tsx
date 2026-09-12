'use client';

import { useEffect, useMemo, useState } from 'react';
import { Badge, Button, Card, EmptyState, ErrorNotice, Input, Notice, PageHeader, Select, formatStatus } from '@/components/ui';
import { Modal } from '@/components/modal';
import { useToast } from '@/components/toast';
import { devFetchCenters, devFetchPendingRequests, devResolveRequest, devSetCenterStatus, devUpsertSubscription, logActivity, type CenterWithSub } from '@/lib/api';
import { PRODUCTS, planLabel } from '@/lib/billing';
import { getSupabase } from '@/lib/supabase';
import type { PlanType, SubscriptionRequest } from '@/lib/types';
import { formatDate, formatMoney, todayIso } from '@/lib/utils';

type ReqRow = SubscriptionRequest & { center_name?: string; center_code?: string };

const initialManual = { centerId: '', planType: 'center_full' as PlanType, months: '1', status: 'active' as 'active' | 'suspended', notes: '' };
const initialExtra = { centerId: '', teachers: '0', secretaries: '0', managers: '0', starts: todayIso(), ends: '', open: false };

export default function DeveloperSubscriptionsPage() {
  const toast = useToast();
  const [centers, setCenters] = useState<CenterWithSub[]>([]);
  const [rows, setRows] = useState<ReqRow[]>([]);
  const [manual, setManual] = useState(initialManual);
  const [extra, setExtra] = useState(initialExtra);
  const [manualOpen, setManualOpen] = useState(false);
  const [extraOpen, setExtraOpen] = useState(false);
  const [manualDirty, setManualDirty] = useState(false);
  const [extraDirty, setExtraDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const selectedCenter = useMemo(() => centers.find((c) => c.id === manual.centerId || c.id === extra.centerId), [centers, manual.centerId, extra.centerId]);

  const load = async () => {
    try {
      const [c, r] = await Promise.all([devFetchCenters(), devFetchPendingRequests()]);
      setCenters(c);
      setRows(r);
      if (c[0]) {
        setManual((old) => old.centerId ? old : { ...old, centerId: c[0].id });
        setExtra((old) => old.centerId ? old : { ...old, centerId: c[0].id });
      }
    } catch (err) { setError(err); }
  };
  useEffect(() => { void load(); }, []);

  const resolve = async (r: ReqRow, approve: boolean) => {
    setError(null);
    try {
      if (approve) {
        await devUpsertSubscription({
          centerId: r.center_id,
          planType: r.plan as PlanType,
          months: r.months,
          status: 'active',
          notes: `ترقية معتمدة — تحويل ${formatMoney(r.amount)} بتاريخ ${r.transfer_at}`,
        });
        await devSetCenterStatus(r.center_id, 'active');
        await logActivity(r.center_id, 'subscription_upgraded', `${planLabel(r.plan)} — اعتماد طلب بتحويل ${formatMoney(r.amount)}`);
      }
      await devResolveRequest(r.id, approve);
      await logActivity(r.center_id, approve ? 'request_approved' : 'request_rejected', `طلب ${planLabel(r.plan)} — ${formatMoney(r.amount)}`);
      toast.success(approve ? 'تم اعتماد الطلب' : 'تم رفض الطلب', approve ? 'تم تفعيل الاشتراك.' : 'أُبلغ صاحب السنتر بالرفض.');
      await load();
    } catch (err) { setError(err); }
  };

  const changeManual = (patch: Partial<typeof manual>) => { setManual((m) => ({ ...m, ...patch })); setManualDirty(true); };
  const changeExtra = (patch: Partial<typeof extra>) => { setExtra((e) => ({ ...e, ...patch })); setExtraDirty(true); };

  const openManual = () => {
    setManual({ ...initialManual, centerId: centers[0]?.id ?? '' });
    setManualDirty(false); setError(null); setManualOpen(true);
  };
  const openExtra = () => {
    setExtra({ ...initialExtra, starts: todayIso(), centerId: centers[0]?.id ?? '' });
    setExtraDirty(false); setError(null); setExtraOpen(true);
  };

  const submitManual = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null); setBusy(true);
    try {
      await devUpsertSubscription({ centerId: manual.centerId, planType: manual.planType, months: Number(manual.months), status: manual.status, notes: manual.notes });
      await devSetCenterStatus(manual.centerId, manual.status === 'active' ? 'active' : 'suspended');
      await logActivity(manual.centerId, manual.status === 'active' ? 'subscription_activated' : 'subscription_suspended', `${planLabel(manual.planType)} — تفعيل يدوي`);
      toast.success('تم حفظ الاشتراك', 'تم تحديث حالة السنتر وفق الباقة اليدوية.');
      setManualDirty(false); setManualOpen(false); await load();
    } catch (err) { setError(err); }
    finally { setBusy(false); }
  };

  const saveEntitlement = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!extra.open && !extra.ends) return setError(new Error('أدخل تاريخ انتهاء الزيادة أو اختر مفتوحة بلا نهاية'));
    setBusy(true);
    try {
      const { error } = await getSupabase().rpc('dev_upsert_entitlement', {
        p_center: extra.centerId,
        p_teachers: Math.max(0, Number(extra.teachers) || 0),
        p_secretaries: Math.max(0, Number(extra.secretaries) || 0),
        p_managers: Math.max(0, Number(extra.managers) || 0),
        p_starts: extra.starts || null,
        p_ends: extra.open ? null : extra.ends,
        p_open: extra.open,
      });
      if (error) throw error;
      await logActivity(extra.centerId, 'entitlement_updated', `زيادة فريق: مدرسين ${extra.teachers} · سكرتارية ${extra.secretaries} · مديرين ${extra.managers}`);
      toast.success('تم حفظ الزيادة', 'تم تطبيق حدود الفريق المؤقتة/المفتوحة.');
      setExtraDirty(false); setExtraOpen(false);
    } catch (err) { setError(err); }
    finally { setBusy(false); }
  };

  return <>
    <PageHeader
      title="الاشتراكات"
      subtitle="اعتماد طلبات الاشتراك، تفعيل يدوي، وزيادات فريق مؤقتة."
      actions={<div className="row"><Button type="button" onClick={openManual}>+ اشتراك يدوي</Button><Button type="button" variant="secondary" onClick={openExtra}>+ زيادة حدود الفريق</Button></div>}
    />
    <ErrorNotice error={error} />
    <div className="grid grid-3">
      <Card className="stack"><h2 className="h3">طلبات معلقة</h2>{rows.length === 0 ? <EmptyState title="لا توجد طلبات معلقة" /> : rows.map((r) => { const st = formatStatus(r.status); return <div key={r.id} className="card compact soft stack"><div className="row-between"><strong>{r.center_name ?? r.center_id}</strong><Badge tone={st.tone}>{st.text}</Badge></div><p className="muted small">{planLabel(r.plan)} · {r.months} شهر · {formatMoney(r.amount)} · تحويل {formatDate(r.transfer_at)}</p><div className="row"><Button type="button" onClick={() => void resolve(r, true)}>اعتماد وتفعيل</Button><Button type="button" variant="danger" onClick={() => void resolve(r, false)}>رفض</Button></div></div>; })}</Card>
      <Card className="stack">
        <h2 className="h3">اشتراك يدوي</h2>
        {selectedCenter ? <Notice>المحدد: {selectedCenter.name} · {planLabel(selectedCenter.latest_sub?.plan_type)} · {selectedCenter.latest_sub?.ends_on ?? '—'}</Notice> : <Notice tone="info">اضغط «+ اشتراك يدوي» أعلى الصفحة لفتح نموذج تفعيل/إيقاف منبثق.</Notice>}
      </Card>
      <Card className="stack">
        <h2 className="h3">زيادة حدود الفريق</h2>
        <Notice tone="info">اضغط «+ زيادة حدود الفريق» أعلى الصفحة لفتح نموذج منبثق للزيادة المؤقتة أو المفتوحة بلا نهاية.</Notice>
      </Card>
    </div>

    <Modal
      open={manualOpen}
      title="اشتراك يدوي"
      subtitle={selectedCenter ? `${selectedCenter.name} — ${selectedCenter.code}` : undefined}
      dirty={manualDirty}
      onClose={() => setManualOpen(false)}
      onSave={() => void submitManual({ preventDefault: () => {} } as React.FormEvent)}
      saveLabel={busy ? 'جاري الحفظ...' : 'حفظ اشتراك'}
      footer={<Button disabled={busy || !manual.centerId} type="submit" form="manual-sub-form">{busy ? 'جاري الحفظ...' : 'حفظ اشتراك'}</Button>}
    >
      <form id="manual-sub-form" className="stack" onSubmit={submitManual}>
        <Select label="السنتر" value={manual.centerId} onChange={(e) => changeManual({ centerId: e.target.value })}>{centers.map((c) => <option key={c.id} value={c.id}>{c.name} — {c.code}</option>)}</Select>
        <Select label="الباقة" value={manual.planType} onChange={(e) => changeManual({ planType: e.target.value as PlanType })}>{PRODUCTS.map((p) => <option key={p.plan} value={p.plan}>{p.name}</option>)}</Select>
        <Input label="عدد الشهور" type="number" value={manual.months} onChange={(e) => changeManual({ months: e.target.value })} />
        <Select label="الحالة" value={manual.status} onChange={(e) => changeManual({ status: e.target.value as 'active' | 'suspended' })}><option value="active">نشط</option><option value="suspended">موقوف</option></Select>
        <Input label="ملاحظات" value={manual.notes} onChange={(e) => changeManual({ notes: e.target.value })} />
        <ErrorNotice error={error} />
      </form>
    </Modal>

    <Modal
      open={extraOpen}
      title="زيادة حدود الفريق"
      subtitle={centers.find((c) => c.id === extra.centerId)?.name}
      dirty={extraDirty}
      onClose={() => setExtraOpen(false)}
      onSave={() => void saveEntitlement({ preventDefault: () => {} } as React.FormEvent)}
      saveLabel={busy ? 'جاري الحفظ...' : 'حفظ الزيادة'}
      footer={<Button disabled={busy || !extra.centerId} type="submit" form="entitlement-form">{busy ? 'جاري الحفظ...' : 'حفظ الزيادة'}</Button>}
    >
      <form id="entitlement-form" className="stack" onSubmit={saveEntitlement}>
        <Select label="السنتر" value={extra.centerId} onChange={(e) => changeExtra({ centerId: e.target.value })}>{centers.map((c) => <option key={c.id} value={c.id}>{c.name} — {c.code}</option>)}</Select>
        <div className="grid grid-3">
          <Input label="مدرسين إضافيين" type="number" value={extra.teachers} onChange={(e) => changeExtra({ teachers: e.target.value })} />
          <Input label="سكرتارية إضافية" type="number" value={extra.secretaries} onChange={(e) => changeExtra({ secretaries: e.target.value })} />
          <Input label="مديرين إضافيين" type="number" value={extra.managers} onChange={(e) => changeExtra({ managers: e.target.value })} />
        </div>
        <Input label="من تاريخ" type="date" value={extra.starts} onChange={(e) => changeExtra({ starts: e.target.value })} />
        <Input label="إلى تاريخ" type="date" value={extra.ends} onChange={(e) => changeExtra({ ends: e.target.value })} disabled={extra.open} />
        <label className="row small muted"><input type="checkbox" checked={extra.open} onChange={(e) => changeExtra({ open: e.target.checked })} /> مفتوحة بلا نهاية</label>
        <ErrorNotice error={error} />
      </form>
    </Modal>
  </>;
}
