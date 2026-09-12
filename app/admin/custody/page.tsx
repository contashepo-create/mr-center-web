'use client';

import { useEffect, useMemo, useState } from 'react';
import { Badge, Button, Card, EmptyState, ErrorNotice, Input, Notice, PageHeader, Select } from '@/components/ui';
import { useSession } from '@/context/session';
import { isOwner } from '@/lib/rbac';
import { getSupabase } from '@/lib/supabase';
import type { Profile } from '@/lib/types';
import { formatDate, formatMoney, todayIso } from '@/lib/utils';

type Custody = {
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

function label(status: Custody['status']) {
  if (status === 'matched') return ['مطابقة', 'success'] as const;
  if (status === 'shortage') return ['عجز', 'danger'] as const;
  if (status === 'surplus') return ['زيادة', 'warn'] as const;
  if (status === 'submitted') return ['مسلمة', 'info'] as const;
  return ['مفتوحة', 'default'] as const;
}

export default function CustodyPage() {
  const { profile } = useSession();
  const centerId = profile?.center_id;
  const [rows, setRows] = useState<Custody[]>([]);
  const [staff, setStaff] = useState<Profile[]>([]);
  const [amount, setAmount] = useState('');
  const [notes, setNotes] = useState('');
  const [reviewNotes, setReviewNotes] = useState('');
  const [filterStaff, setFilterStaff] = useState('all');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [message, setMessage] = useState<string | null>(null);
  const staffAllowed = profile?.role === 'secretary' || profile?.role === 'manager';
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
        sb.from('profiles').select('*').eq('center_id', centerId).in('role', ['teacher', 'manager', 'secretary']).limit(300),
      ]);
      if (custodyRes.error) throw custodyRes.error;
      if (staffRes.error) throw staffRes.error;
      setRows((custodyRes.data ?? []) as Custody[]);
      setStaff((staffRes.data ?? []) as Profile[]);
    } catch (err) { setError(err); }
  };
  useEffect(() => { void load(); }, [centerId]);

  if (!isOwner(profile) && !staffAllowed) {
    return <Card><Notice tone="error">العهدة متاحة لصاحب السنتر والمدير/السكرتير فقط.</Notice></Card>;
  }

  const submitCustody = async (e: React.FormEvent) => {
    e.preventDefault();
    const value = Number(amount);
    if (!value || value < 0) return setError(new Error('أدخل المبلغ المسلم'));
    setBusy(true); setError(null); setMessage(null);
    try {
      const { error } = await getSupabase().rpc('submit_staff_custody', {
        p_staff: profile!.id,
        p_date: todayIso(),
        p_delivered: value,
        p_notes: notes.trim(),
      });
      if (error) throw error;
      setAmount(''); setNotes(''); setMessage('تم تسجيل عهدة اليوم ومطابقتها مع تحصيلك.'); await load();
    } catch (err) { setError(err); }
    finally { setBusy(false); }
  };

  const review = async (id: string, status: Custody['status']) => {
    setError(null); setMessage(null);
    try {
      const { error } = await getSupabase().rpc('review_staff_custody', { p_id: id, p_status: status, p_notes: reviewNotes.trim() });
      if (error) throw error;
      setReviewNotes(''); setMessage('تم تحديث حالة العهدة.'); await load();
    } catch (err) { setError(err); }
  };

  return <>
    <PageHeader title="عهدة التحصيل" subtitle="مطابقة يومية بين تحصيل الموظفين والمبالغ المسلمة." />
    <ErrorNotice error={error} />{message ? <Notice tone="success">{message}</Notice> : null}
    <div className="grid grid-3" style={{ marginBottom: 18 }}>
      <Card className="compact kpi"><span className="muted">متوقع الشهر</span><div className="kpi-value">{formatMoney(monthExpected)}</div></Card>
      <Card className="compact kpi"><span className="muted">مسلم الشهر</span><div className="kpi-value">{formatMoney(monthDelivered)}</div></Card>
      <Card className="compact kpi"><span className="muted">الفرق</span><div className="kpi-value">{formatMoney(monthDelivered - monthExpected)}</div></Card>
    </div>
    <div className="grid grid-2">
      {staffAllowed ? <Card className="stack"><h2 className="h3">تسليم عهدة اليوم</h2><form className="stack" onSubmit={submitCustody}><Input label={`المبلغ المسلم — ${todayIso()}`} type="number" value={amount} onChange={(e) => setAmount(e.target.value)} /><Input label="ملاحظات" value={notes} onChange={(e) => setNotes(e.target.value)} /><Button disabled={busy} type="submit">تسجيل وتسليم</Button></form></Card> : null}
      <Card className="stack"><h2 className="h3">فلترة واعتماد</h2><Select label="الموظف" value={filterStaff} onChange={(e) => setFilterStaff(e.target.value)}><option value="all">الكل</option>{staff.map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}</Select>{isOwner(profile) ? <Input label="ملاحظات الاعتماد" value={reviewNotes} onChange={(e) => setReviewNotes(e.target.value)} /> : null}</Card>
    </div>
    <Card className="stack" style={{ marginTop: 18 }}><div className="row-between"><h2 className="h3">سجل العهد</h2><Badge tone="info">{visible.length}</Badge></div>{visible.length === 0 ? <EmptyState title="لا توجد عهد مسجلة" /> : <div className="table-wrap"><table><thead><tr><th>التاريخ</th><th>الموظف</th><th>المتوقع</th><th>المسلم</th><th>الحالة</th><th>ملاحظات</th><th>اعتماد</th></tr></thead><tbody>{visible.map((r) => { const [txt, tone] = label(r.status); return <tr key={r.id}><td>{formatDate(r.custody_date)}</td><td>{staffName.get(r.staff_id) ?? r.staff_id}</td><td>{formatMoney(r.expected_amount)}</td><td>{formatMoney(r.delivered_amount)}</td><td><Badge tone={tone}>{txt}</Badge></td><td>{r.notes || '—'}</td><td>{isOwner(profile) ? <div className="row"><Button type="button" variant="secondary" onClick={() => void review(r.id, 'matched')}>مطابقة</Button><Button type="button" variant="secondary" onClick={() => void review(r.id, 'shortage')}>عجز</Button><Button type="button" variant="secondary" onClick={() => void review(r.id, 'surplus')}>زيادة</Button></div> : '—'}</td></tr>; })}</tbody></table></div>}</Card>
  </>;
}
