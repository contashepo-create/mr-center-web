'use client';

import { useEffect, useMemo, useState } from 'react';
import { Badge, Button, Card, EmptyState, ErrorNotice, Input, Notice, PageHeader, Select } from '@/components/ui';
import { Modal } from '@/components/modal';
import { useToast } from '@/components/toast';
import { useSession } from '@/context/session';
import { isOwner } from '@/lib/rbac';
import { getSupabase } from '@/lib/supabase';
import type { Profile } from '@/lib/types';
import { formatDate, formatMoney, todayIso } from '@/lib/utils';

export type Custody = {
  id: string;
  center_id: string;
  staff_id: string;
  custody_date: string;
  expected_amount: number;
  delivered_amount: number;
  status: 'open' | 'submitted' | 'matched' | 'shortage' | 'surplus';
  notes: string;
  submitted_at: string | null;
  created_at: string;
};

function custodyLabel(status: Custody['status']) {
  if (status === 'matched') return ['مطابقة', 'success'] as const;
  if (status === 'shortage') return ['عجز', 'danger'] as const;
  if (status === 'surplus') return ['زيادة', 'warn'] as const;
  if (status === 'submitted') return ['مُسلَّمة', 'info'] as const;
  return ['مفتوحة', 'default'] as const;
}

/** مساحة العهدة المستخدمة داخل المحاسبة، ويمكن عرضها أيضاً كصفحة مستقلة للتوافق مع الروابط القديمة. */
export function CustodyWorkspace({ embedded = false }: { embedded?: boolean }) {
  const { profile, features } = useSession();
  const toast = useToast();
  const centerId = profile?.center_id;
  const [rows, setRows] = useState<Custody[]>([]);
  const [staff, setStaff] = useState<Pick<Profile, 'id' | 'full_name' | 'role'>[]>([]);
  const [amount, setAmount] = useState('');
  const [notes, setNotes] = useState('');
  const [reviewNotes, setReviewNotes] = useState('');
  const [filterStaff, setFilterStaff] = useState('all');
  const [open, setOpen] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const staffAllowed = profile?.role === 'secretary' || profile?.role === 'manager';
  const owner = isOwner(profile);
  const staffName = useMemo(() => new Map(staff.map((s) => [s.id, s.full_name])), [staff]);
  const visible = rows.filter((r) => filterStaff === 'all' || r.staff_id === filterStaff);
  const currentMonth = todayIso().slice(0, 7);
  const monthRows = visible.filter((r) => r.custody_date.slice(0, 7) === currentMonth);
  const monthExpected = monthRows.reduce((sum, r) => sum + Number(r.expected_amount || 0), 0);
  const monthDelivered = monthRows.reduce((sum, r) => sum + Number(r.delivered_amount || 0), 0);

  const load = async () => {
    if (!centerId) return;
    setError(null);
    try {
      const sb = getSupabase();
      const [custodyRes, staffRes] = await Promise.all([
        sb.from('staff_custody').select('*').eq('center_id', centerId).order('custody_date', { ascending: false }).limit(300),
        sb.from('profiles').select('id,full_name,role').eq('center_id', centerId).in('role', ['teacher', 'manager', 'secretary']).limit(300),
      ]);
      if (custodyRes.error) throw custodyRes.error;
      if (staffRes.error) throw staffRes.error;
      setRows((custodyRes.data ?? []) as Custody[]);
      setStaff((staffRes.data ?? []) as Pick<Profile, 'id' | 'full_name' | 'role'>[]);
    } catch (err) { setError(err); }
  };
  useEffect(() => { void load(); }, [centerId]);

  if (!owner && !staffAllowed) return <Card><Notice tone="error">العهدة متاحة لصاحب السنتر والمدير والسكرتير فقط.</Notice></Card>;

  const submitCustody = async (e: React.FormEvent) => {
    e.preventDefault();
    const value = Number(amount);
    if (!Number.isFinite(value) || value < 0) return setError(new Error('أدخل مبلغاً مسلماً صحيحاً.'));
    setBusy(true); setError(null);
    try {
      const { error: rpcError } = await getSupabase().rpc('submit_staff_custody', {
        p_staff: profile!.id, p_date: todayIso(), p_delivered: value, p_notes: notes.trim(),
      });
      if (rpcError) throw rpcError;
      setAmount(''); setNotes(''); setDirty(false); setOpen(false);
      toast.success('تم تسليم العهدة', 'سُجلت عهدة اليوم وطوبقت مع التحصيل المسجل.');
      await load();
    } catch (err) { setError(err); }
    finally { setBusy(false); }
  };

  const review = async (id: string, status: Custody['status']) => {
    setError(null);
    try {
      const { error: rpcError } = await getSupabase().rpc('review_staff_custody', { p_id: id, p_status: status, p_notes: reviewNotes.trim() });
      if (rpcError) throw rpcError;
      setReviewNotes(''); toast.success('تم تحديث حالة العهدة'); await load();
    } catch (err) { setError(err); }
  };
  const ownerReview = owner && !!features?.accounting;

  return <>
    {!embedded ? <PageHeader title="العهدة داخل المحاسبة" subtitle="تسليم ومطابقة تحصيل اليوم. ستنتقل هذه المساحة إلى المحاسبة من القائمة الرئيسية." actions={staffAllowed ? <Button type="button" onClick={() => { setError(null); setDirty(false); setOpen(true); }}>+ تسليم عهدة اليوم</Button> : undefined} /> : null}
    {embedded ? <div className="row-between accounting-section-heading"><div><h2 className="h2">العهدة اليومية</h2><p className="muted">مطابقة تحصيل الموظفين مع ما تم تسليمه للخزينة.</p></div>{staffAllowed ? <Button type="button" onClick={() => { setError(null); setDirty(false); setOpen(true); }}>+ تسليم عهدة اليوم</Button> : null}</div> : null}
    <ErrorNotice error={error} />
    {owner && !features?.accounting ? <Notice tone="warn">المحاسبة غير مفعلة لسنترك. تُعتمد العهدة تلقائياً كإجراء تشغيلي، أما المراجعة والتقارير التفصيلية فتظهر عند التفعيل.</Notice> : null}
    <div className="grid grid-3" style={{ margin: '16px 0 18px' }}>
      <Card className="compact kpi"><span className="muted">متوقع هذا الشهر</span><div className="kpi-value">{formatMoney(monthExpected)}</div></Card>
      <Card className="compact kpi"><span className="muted">تم تسليمه</span><div className="kpi-value">{formatMoney(monthDelivered)}</div></Card>
      <Card className="compact kpi"><span className="muted">فرق العهد</span><div className="kpi-value" style={{ color: monthDelivered === monthExpected ? 'var(--success)' : 'var(--danger)' }}>{formatMoney(monthDelivered - monthExpected)}</div></Card>
    </div>
    <Card className="stack">
      <div className="grid grid-2">
        <Select label="عرض عهدة الموظف" value={filterStaff} onChange={(e) => setFilterStaff(e.target.value)}><option value="all">كل الموظفين</option>{staff.map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}</Select>
        {ownerReview ? <Input label="ملاحظة الاعتماد (اختيارية)" value={reviewNotes} onChange={(e) => setReviewNotes(e.target.value)} /> : <Notice tone="info">يسجل الموظف عهدته بنفسه، ويعتمدها صاحب السنتر من هذه الشاشة.</Notice>}
      </div>
      {visible.length === 0 ? <EmptyState title="لا توجد عهد مسجلة" body="يظهر هنا تسليم اليوم بعد أن يسجله المدير أو السكرتير." /> : <div className="table-wrap"><table><thead><tr><th>التاريخ</th><th>الموظف</th><th>المتوقع</th><th>المُسلّم</th><th>الحالة</th><th>ملاحظات</th>{ownerReview ? <th>اعتماد</th> : null}</tr></thead><tbody>{visible.map((row) => { const [text, tone] = custodyLabel(row.status); return <tr key={row.id}><td>{formatDate(row.custody_date)}</td><td>{staffName.get(row.staff_id) ?? 'موظف'}</td><td>{formatMoney(row.expected_amount)}</td><td>{formatMoney(row.delivered_amount)}</td><td><Badge tone={tone}>{text}</Badge></td><td>{row.notes || '—'}</td>{ownerReview ? <td><div className="row"><Button type="button" variant="secondary" onClick={() => void review(row.id, 'matched')}>مطابقة</Button><Button type="button" variant="secondary" onClick={() => void review(row.id, 'shortage')}>عجز</Button><Button type="button" variant="secondary" onClick={() => void review(row.id, 'surplus')}>زيادة</Button></div></td> : null}</tr>; })}</tbody></table></div>}
    </Card>
    <Modal open={open} title="تسليم عهدة اليوم" subtitle={todayIso()} dirty={dirty} onClose={() => setOpen(false)} onSave={() => void submitCustody({ preventDefault: () => undefined } as React.FormEvent)} saveLabel={busy ? 'جارٍ الحفظ…' : 'تسجيل وتسليم'} footer={<Button disabled={busy} type="submit" form="custody-form">{busy ? 'جارٍ الحفظ…' : 'تسجيل وتسليم'}</Button>}>
      <form id="custody-form" className="stack" onSubmit={submitCustody}>
        <Input label="المبلغ المُسلّم" type="number" min="0" step="0.01" value={amount} onChange={(e) => { setAmount(e.target.value); setDirty(true); }} />
        <Input label="ملاحظات" value={notes} onChange={(e) => { setNotes(e.target.value); setDirty(true); }} />
        <Notice tone="info">سيطابق النظام المبلغ مع تحصيلك المسجل اليوم تلقائياً.</Notice>
        <ErrorNotice error={error} />
      </form>
    </Modal>
  </>;
}
