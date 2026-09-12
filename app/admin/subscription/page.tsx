'use client';

import { useEffect, useMemo, useState } from 'react';
import { Badge, Button, Card, EmptyState, ErrorNotice, Input, Notice, PageHeader, Select, formatStatus } from '@/components/ui';
import { useToast } from '@/components/toast';
import { useSession } from '@/context/session';
import { createSubscriptionRequest, fetchSubscriptionRequests, fetchSubscriptionsHistory } from '@/lib/api';
import { PRODUCTS, planLabel, priceFor } from '@/lib/billing';
import { isOwner } from '@/lib/rbac';
import type { PlanType, Subscription, SubscriptionRequest } from '@/lib/types';
import { formatDate, formatMoney } from '@/lib/utils';

export default function SubscriptionPage() {
  const { profile, subscription } = useSession();
  const toast = useToast();
  const centerId = profile?.center_id;
  const [requests, setRequests] = useState<SubscriptionRequest[]>([]);
  const [history, setHistory] = useState<Subscription[]>([]);
  const [form, setForm] = useState({ plan: 'center_full' as PlanType, months: '1', amount: '', transfer_at: new Date().toISOString().slice(0, 10), transfer_time: '', notes: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const expected = useMemo(() => priceFor(form.plan, Number(form.months)) ?? 0, [form.plan, form.months]);

  // لا يمكن التحويل لباقة أخرى إلا عندما يتبقى 7 أيام أو أقل في الباقة الحالية
  // (أو إن لم تكن هناك باقة سارية أصلاً) — حماية من التبديل المتكرر.
  const daysLeft = typeof subscription?.days_left === 'number' ? subscription.days_left : null;
  const canSwitch = !subscription || subscription.status !== 'active' || (daysLeft !== null && daysLeft <= 7);

  const load = async () => { if (!centerId) return; try { const [r, h] = await Promise.all([fetchSubscriptionRequests(centerId), fetchSubscriptionsHistory(centerId)]); setRequests(r); setHistory(h); } catch (err) { setError(err); } };
  useEffect(() => { void load(); }, [centerId]);
  useEffect(() => { if (expected) setForm((f) => ({ ...f, amount: String(expected) })); }, [expected]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); if (!centerId) return;
    if (!canSwitch) { setError(new Error('باقتك الحالية ما زالت سارية — يمكنك طلب التحويل لباقة أخرى عندما يتبقى 7 أيام أو أقل فقط.')); return; }
    setBusy(true); setError(null);
    const transferAt = `${form.transfer_at}${form.transfer_time ? ` ${form.transfer_time}` : ''}`.trim();
    try { await createSubscriptionRequest({ centerId, plan: form.plan, months: Number(form.months), amount: Number(form.amount), transferAt, notes: form.notes }); toast.success('تم إرسال طلب الترقية', 'وصل طلبك للمطور وسيُراجع في أقرب وقت.'); await load(); }
    catch (err) { setError(err); }
    finally { setBusy(false); }
  };

  if (profile && !isOwner(profile)) {
    return <Card><Notice tone="error">إدارة الاشتراك متاحة لصاحب السنتر فقط.</Notice></Card>;
  }

  return (
    <>
      <PageHeader title="الاشتراك والباقات" subtitle="طلب ترقية أو تجديد من الويب بنفس نظام الاشتراكات في التطبيق." />
      <ErrorNotice error={error} />
      <div className="grid grid-4" style={{ marginBottom: 18 }}>
        <Card className="compact kpi"><span className="muted">الحالة الحالية</span><div className="kpi-value">{subscription?.status ?? '—'}</div></Card>
        <Card className="compact kpi"><span className="muted">باقتك</span><div className="kpi-value" style={{ fontSize: '1.4rem' }}>{planLabel(subscription?.plan_type)}</div></Card>
        <Card className="compact kpi"><span className="muted">الانتهاء</span><div className="kpi-value" style={{ fontSize: '1.4rem' }}>{subscription?.ends_on ? formatDate(subscription.ends_on) : '—'}</div></Card>
        <Card className="compact kpi"><span className="muted">الأيام المتبقية</span><div className="kpi-value">{daysLeft === null ? '—' : `${daysLeft} يوم`}</div></Card>
      </div>

      <div className="grid grid-2">
        <Card className="stack">
          <h2 className="h3">طلب اشتراك / ترقية</h2>
          {!canSwitch ? (
            <Notice tone="warn">باقتك الحالية سارية وباقٍ عليها {daysLeft ?? 0} يوم — لا يمكنك التحويل لباقة أخرى قبل أن يتبقى 7 أيام أو أقل. ستصلك إشعارات عند اقتراب انتهاء باقتك (تظهر لك أنت فقط).</Notice>
          ) : null}
          <form className="stack" onSubmit={submit}>
            <Select label="الباقة" value={form.plan} onChange={(e) => setForm({ ...form, plan: e.target.value as PlanType })}>{PRODUCTS.map((p) => <option key={p.plan} value={p.plan}>{p.name}</option>)}</Select>
            <Select label="المدة" value={form.months} onChange={(e) => setForm({ ...form, months: e.target.value })}>{PRODUCTS.find((p) => p.plan === form.plan)?.durations.map((d) => <option key={d.months} value={d.months}>{d.label} — {formatMoney(d.price)}</option>)}</Select>
            <Input label="قيمة التحويل" type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
            <div className="grid grid-2">
              <Input label="تاريخ التحويل" type="date" value={form.transfer_at} onChange={(e) => setForm({ ...form, transfer_at: e.target.value })} />
              <Input label="وقت التحصيل" type="time" value={form.transfer_time} onChange={(e) => setForm({ ...form, transfer_time: e.target.value })} />
            </div>
            <Input label="ملاحظات" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            <Button disabled={busy || !canSwitch} type="submit">إرسال الطلب</Button>
          </form>
        </Card>
        <Card className="stack">
          <h2 className="h3">الباقات المتاحة</h2>
          {PRODUCTS.map((p) => <div className="card compact soft" key={p.plan}><div className="row-between"><strong>{p.name}</strong><Badge tone="info">{p.tagline}</Badge></div><p className="muted small">{p.features.join(' · ')}</p></div>)}
        </Card>
      </div>

      <div className="grid grid-2" style={{ marginTop: 18 }}>
        <Card className="stack"><div className="row-between"><h2 className="h3">طلباتك</h2><Badge tone="info">{requests.length}</Badge></div>{requests.length === 0 ? <EmptyState title="لا توجد طلبات" /> : <div className="table-wrap"><table><thead><tr><th>الباقة</th><th>المدة</th><th>المبلغ</th><th>الحالة</th></tr></thead><tbody>{requests.map((r) => { const st = formatStatus(r.status); return <tr key={r.id}><td>{planLabel(r.plan)}</td><td>{r.months} شهر</td><td>{formatMoney(r.amount)}</td><td><Badge tone={st.tone}>{st.text}</Badge></td></tr>; })}</tbody></table></div>}</Card>
        <Card className="stack"><div className="row-between"><h2 className="h3">السجل</h2><Badge tone="info">{history.length}</Badge></div>{history.length === 0 ? <EmptyState title="لا يوجد سجل" /> : <div className="table-wrap"><table><thead><tr><th>الباقة</th><th>من</th><th>إلى</th><th>الحالة</th></tr></thead><tbody>{history.map((h) => { const st = formatStatus(h.status); return <tr key={h.id}><td>{planLabel(h.plan_type)}</td><td>{formatDate(h.starts_on)}</td><td>{formatDate(h.ends_on)}</td><td><Badge tone={st.tone}>{st.text}</Badge></td></tr>; })}</tbody></table></div>}</Card>
      </div>
    </>
  );
}
