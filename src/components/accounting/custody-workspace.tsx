'use client';

import { useEffect, useMemo, useState } from 'react';
import { Badge, Button, Card, EmptyState, ErrorNotice, Input, Notice, PageHeader, Select, Textarea } from '@/components/ui';
import { Modal } from '@/components/modal';
import { useToast } from '@/components/toast';
import { useSession } from '@/context/session';
import { isOwner } from '@/lib/rbac';
import { buildCustodyReportHtml, printReport } from '@/lib/report';
import { getSupabase } from '@/lib/supabase';
import type { Profile } from '@/lib/types';
import { formatDate, formatMoney, todayIso } from '@/lib/utils';

export type Custody = {
  id: string | null;
  center_id?: string;
  staff_id: string | null;
  staff_name: string;
  custody_date: string;
  expected_amount: number | string;
  delivered_amount: number | string;
  status: 'open' | 'submitted' | 'matched' | 'shortage' | 'surplus';
  notes: string;
  submitted_at: string | null;
  created_at: string | null;
};

const value = (amount: number | string | null | undefined) => Number(amount || 0);
function custodyLabel(status: Custody['status'], delivered: number) {
  if (status === 'matched') return ['مطابقة ومعتمدة', 'success'] as const;
  if (status === 'shortage') return ['عجز يحتاج متابعة', 'danger'] as const;
  if (status === 'surplus') return ['زيادة بحاجة لتفسير', 'warn'] as const;
  if (status === 'submitted') return ['بانتظار مراجعة', 'info'] as const;
  return delivered > 0 ? ['بانتظار مطابقة', 'info'] as const : ['بانتظار التسليم', 'default'] as const;
}

/** مساحة العهدة ضمن المحاسبة: تعرض التحصيل المتوقع فوراً ثم التسليم والمطابقة في تدفق واحد. */
export function CustodyWorkspace({ embedded = false }: { embedded?: boolean }) {
  const { profile, features } = useSession();
  const toast = useToast();
  const centerId = profile?.center_id;
  const owner = isOwner(profile);
  const staffAllowed = profile?.role === 'secretary' || profile?.role === 'manager';
  const [rows, setRows] = useState<Custody[]>([]);
  const [staff, setStaff] = useState<Pick<Profile, 'id' | 'full_name' | 'role'>[]>([]);
  const [amount, setAmount] = useState('');
  const [notes, setNotes] = useState('');
  const [filterStaff, setFilterStaff] = useState('all');
  const [deliveryOpen, setDeliveryOpen] = useState(false);
  const [settlementOpen, setSettlementOpen] = useState(false);
  const [settlementRow, setSettlementRow] = useState<Custody | null>(null);
  const [settlementAmount, setSettlementAmount] = useState('');
  const [settlementNotes, setSettlementNotes] = useState('');
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const visible = useMemo(() => rows.filter((row) => filterStaff === 'all' || row.staff_id === filterStaff), [rows, filterStaff]);
  const currentMonth = todayIso().slice(0, 7);
  const monthRows = useMemo(() => visible.filter((row) => row.custody_date.slice(0, 7) === currentMonth), [visible, currentMonth]);
  const monthExpected = monthRows.reduce((sum, row) => sum + value(row.expected_amount), 0);
  const monthDelivered = monthRows.reduce((sum, row) => sum + value(row.delivered_amount), 0);
  const pendingRows = visible.filter((row) => row.status === 'open' || row.status === 'submitted').length;
  const myToday = rows.find((row) => row.staff_id === profile?.id && row.custody_date === todayIso());
  const ownerReview = owner && !!features?.accounting;

  const load = async () => {
    if (!centerId) return;
    setError(null);
    try {
      const sb = getSupabase();
      const [overviewRes, staffRes] = await Promise.all([
        sb.rpc('get_custody_overview', { p_from: null, p_to: null }),
        owner ? sb.from('profiles').select('id,full_name,role').eq('center_id', centerId).in('role', ['center_admin', 'teacher', 'manager', 'secretary']).order('full_name').limit(300) : Promise.resolve({ data: [], error: null }),
      ]);
      if (overviewRes.error) throw overviewRes.error;
      if (staffRes.error) throw staffRes.error;
      setRows((overviewRes.data ?? []) as Custody[]);
      setStaff((staffRes.data ?? []) as Pick<Profile, 'id' | 'full_name' | 'role'>[]);
    } catch (err) { setError(err); }
  };
  useEffect(() => { void load(); }, [centerId, owner]);

  if (!owner && !staffAllowed) return <Card><Notice tone="error">العهدة متاحة لصاحب السنتر والمدير والسكرتير فقط.</Notice></Card>;

  const openDelivery = () => {
    const expected = myToday ? value(myToday.expected_amount) : 0;
    setAmount(String(expected)); setNotes(myToday?.notes ?? ''); setDirty(false); setError(null); setDeliveryOpen(true);
  };
  const submitCustody = async (event: React.FormEvent) => {
    event.preventDefault();
    const delivered = Number(amount);
    if (!Number.isFinite(delivered) || delivered < 0) return setError(new Error('أدخل مبلغاً مسلماً صحيحاً.'));
    setBusy(true); setError(null);
    try {
      const { error: rpcError } = await getSupabase().rpc('submit_staff_custody', { p_staff: profile!.id, p_date: todayIso(), p_delivered: delivered, p_notes: notes.trim() });
      if (rpcError) throw rpcError;
      setDeliveryOpen(false); setDirty(false);
      toast.success('تم تسجيل تسليم العهدة', delivered === (myToday ? value(myToday.expected_amount) : 0) ? 'المبلغ مطابق للتحصيل المتوقع.' : 'سيظهر الفرق بوضوح للمراجعة.');
      await load();
    } catch (err) { setError(err); } finally { setBusy(false); }
  };
  const openSettlement = (row: Custody) => {
    setSettlementRow(row); setSettlementAmount(String(value(row.delivered_amount) || value(row.expected_amount))); setSettlementNotes(row.notes || ''); setDirty(false); setError(null); setSettlementOpen(true);
  };
  const settle = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!centerId || !settlementRow) return;
    const delivered = Number(settlementAmount);
    if (!Number.isFinite(delivered) || delivered < 0) return setError(new Error('أدخل مبلغاً صحيحاً للخزينة.'));
    setBusy(true); setError(null);
    try {
      const { error: rpcError } = await getSupabase().rpc('settle_staff_custody', { p_center: centerId, p_staff: settlementRow.staff_id, p_date: settlementRow.custody_date, p_delivered: delivered, p_notes: settlementNotes.trim() });
      if (rpcError) throw rpcError;
      const expected = value(settlementRow.expected_amount);
      setSettlementOpen(false); setSettlementRow(null); setDirty(false);
      toast.success('تمت مراجعة العهدة', delivered === expected ? 'تم اعتماد المطابقة.' : delivered < expected ? `سجل عجز قدره ${formatMoney(expected - delivered)}.` : `سجلت زيادة قدرها ${formatMoney(delivered - expected)}.`);
      await load();
    } catch (err) { setError(err); } finally { setBusy(false); }
  };
  const printCustody = () => printReport(buildCustodyReportHtml('كشف العهدة والتحصيل', `${currentMonth} — حتى ${todayIso()}`, monthRows.map((row) => {
    const [label] = custodyLabel(row.status, value(row.delivered_amount));
    return [formatDate(row.custody_date), row.staff_name, formatMoney(value(row.expected_amount)), formatMoney(value(row.delivered_amount)), label, row.notes || '—'];
  }), { name: profile?.full_name }));

  return <>
    {!embedded ? <PageHeader title="العهدة داخل المحاسبة" subtitle="تدفق واضح من التحصيل المتوقع إلى التسليم والمطابقة." actions={staffAllowed ? <Button type="button" onClick={openDelivery}>+ تسليم عهدة اليوم</Button> : undefined} /> : null}
    {embedded ? <div className="row-between accounting-section-heading"><div><h2 className="h2">العهدة والتحصيل</h2><p className="muted">كل تحصيل مسجل للموظف يظهر فوراً كعهدة متوقعة، حتى قبل تسجيل التسليم.</p></div><div className="row">{ownerReview ? <Button type="button" variant="secondary" onClick={printCustody}>🖨 كشف العهدة</Button> : null}{staffAllowed ? <Button type="button" onClick={openDelivery}>+ تسليم عهدة اليوم</Button> : null}</div></div> : null}
    <ErrorNotice error={error} />
    {owner && !features?.accounting ? <Notice tone="warn">المحاسبة غير مفعلة لسنترك. تُعتمد العهدة كإجراء تشغيلي، وتتوفر المطابقة المالية التفصيلية بعد التفعيل.</Notice> : null}
    {staffAllowed ? <Notice tone="info">تحصيلك المتوقع اليوم: <strong>{formatMoney(value(myToday?.expected_amount))}</strong>. أدخل ما سلّمته فعلياً للخزينة ثم راجع الفرق إن وُجد.</Notice> : null}
    <div className="grid grid-4" style={{ margin: '16px 0 18px' }}>
      <Card className="compact kpi"><span className="muted">تحصيل متوقع هذا الشهر</span><div className="kpi-value">{formatMoney(monthExpected)}</div></Card>
      <Card className="compact kpi"><span className="muted">تم تسليمه للخزينة</span><div className="kpi-value">{formatMoney(monthDelivered)}</div></Card>
      <Card className="compact kpi"><span className="muted">الفرق قيد المتابعة</span><div className="kpi-value" style={{ color: monthDelivered === monthExpected ? 'var(--success)' : 'var(--danger)' }}>{formatMoney(monthExpected - monthDelivered)}</div></Card>
      <Card className="compact kpi"><span className="muted">صفوف تحتاج إجراء</span><div className="kpi-value">{pendingRows}</div></Card>
    </div>
    <Card className="stack">
      <div className="row-between"><div><h3 className="h3">سجل العهدة اليومي</h3><p className="tiny muted">المرحلة ١: التحصيل المتوقع · المرحلة ٢: تسليم النقدية · المرحلة ٣: المطابقة أو توثيق العجز/الزيادة.</p></div>{ownerReview ? <Button type="button" variant="ghost" onClick={() => void load()}>↻ تحديث</Button> : null}</div>
      {owner ? <Select label="عرض عهدة الموظف" value={filterStaff} onChange={(event) => setFilterStaff(event.target.value)}><option value="all">كل الموظفين</option>{staff.map((item) => <option key={item.id} value={item.id}>{item.full_name}</option>)}</Select> : null}
      {visible.length === 0 ? <EmptyState title="لا يوجد تحصيل أو تسليم مسجل بعد" body="بمجرد تسجيل الموظف لتحصيل طالب، سيظهر هنا تلقائياً كمبلغ متوقع للعهدة." /> : <div className="table-wrap"><table><thead><tr><th>التاريخ</th><th>الموظف</th><th>١. المتوقع من التحصيل</th><th>٢. المسلم للخزينة</th><th>٣. النتيجة</th><th>الفرق</th><th>ملاحظات</th>{ownerReview ? <th>الإجراء</th> : null}</tr></thead><tbody>{visible.map((row) => { const expected = value(row.expected_amount); const delivered = value(row.delivered_amount); const difference = delivered - expected; const [label, tone] = custodyLabel(row.status, delivered); return <tr key={`${row.staff_id}-${row.custody_date}`}><td>{formatDate(row.custody_date)}</td><td><strong>{row.staff_name}</strong></td><td>{formatMoney(expected)}</td><td>{row.submitted_at ? formatMoney(delivered) : <span className="muted">لم يُسلّم بعد</span>}</td><td><Badge tone={tone}>{label}</Badge></td><td style={{ color: difference === 0 ? 'var(--success)' : difference < 0 ? 'var(--danger)' : 'var(--warn)' }}>{row.submitted_at ? `${difference > 0 ? '+' : ''}${formatMoney(difference)}` : '—'}</td><td>{row.notes || '—'}</td>{ownerReview ? <td>{row.staff_id ? <Button type="button" variant={row.status === 'matched' ? 'ghost' : 'secondary'} onClick={() => openSettlement(row)}>{row.submitted_at ? 'مراجعة/تعديل' : 'تسجيل تسليم'}</Button> : <span className="tiny muted">قيد قديم غير منسوب</span>}</td> : null}</tr>; })}</tbody></table></div>}
    </Card>
    <Modal open={deliveryOpen} title="تسليم عهدة اليوم" subtitle={`التحصيل المتوقع المسجل: ${formatMoney(value(myToday?.expected_amount))}`} dirty={dirty} onClose={() => setDeliveryOpen(false)} onSave={() => void submitCustody({ preventDefault: () => undefined } as React.FormEvent)} saveLabel={busy ? 'جارٍ الحفظ…' : 'تسجيل التسليم'} footer={<Button disabled={busy} type="submit" form="custody-form">{busy ? 'جارٍ الحفظ…' : 'تسجيل التسليم'}</Button>}><form id="custody-form" className="stack" onSubmit={submitCustody}><Input label="المبلغ المُسلّم للخزينة" type="number" min="0" step="0.01" value={amount} onChange={(event) => { setAmount(event.target.value); setDirty(true); }} /><Textarea label="ملاحظات التسليم (اختيارية)" value={notes} onChange={(event) => { setNotes(event.target.value); setDirty(true); }} /><Notice tone="info">يحسب النظام التحصيل من الدفعات التي سجلتها باسمك اليوم، ثم يبين المطابقة أو العجز أو الزيادة تلقائياً.</Notice><ErrorNotice error={error} /></form></Modal>
    <Modal open={settlementOpen} title="مراجعة وتسوية العهدة" subtitle={settlementRow ? `${settlementRow.staff_name} — ${formatDate(settlementRow.custody_date)} — المتوقع ${formatMoney(value(settlementRow.expected_amount))}` : ''} dirty={dirty} onClose={() => setSettlementOpen(false)} onSave={() => void settle({ preventDefault: () => undefined } as React.FormEvent)} saveLabel={busy ? 'جارٍ الاعتماد…' : 'اعتماد التسليم'} footer={<Button disabled={busy} type="submit" form="custody-settlement-form">{busy ? 'جارٍ الاعتماد…' : 'اعتماد التسليم'}</Button>}><form id="custody-settlement-form" className="stack" onSubmit={settle}><Input label="المبلغ الفعلي الذي استلمته الخزينة" type="number" min="0" step="0.01" value={settlementAmount} onChange={(event) => { setSettlementAmount(event.target.value); setDirty(true); }} /><Textarea label="ملاحظة المراجعة أو سبب الفرق" value={settlementNotes} onChange={(event) => { setSettlementNotes(event.target.value); setDirty(true); }} /><Notice tone="warn">يعتمد النظام الحالة تلقائياً: مطابق عند تساوي المبلغين، عجز عند الأقل، وزيادة عند الأعلى. تستطيع العودة لهذا السجل وتعديله مع توثيق السبب.</Notice><ErrorNotice error={error} /></form></Modal>
  </>;
}
