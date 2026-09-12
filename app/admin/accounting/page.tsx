'use client';

import { useEffect, useMemo, useState } from 'react';
import { Badge, Button, Card, EmptyState, ErrorNotice, Input, Notice, PageHeader, Select } from '@/components/ui';
import { useSession } from '@/context/session';
import { closeFiscalYear, fetchMyFiscalYears, requestAccounting, type FiscalYear } from '@/lib/features';
import { isOwner, roleLabel } from '@/lib/rbac';
import { getSupabase } from '@/lib/supabase';
import type { Profile } from '@/lib/types';
import { formatDate, formatMoney, todayIso } from '@/lib/utils';
import { buildPayrollReportHtml, buildReportHtml, printReport } from '@/lib/report';

type LedgerKind = 'income' | 'expense';
type EntryType = 'general' | 'salary' | 'advance' | 'bonus' | 'rent' | 'utility' | 'purchase' | 'payment_collection';
type Ledger = {
  id: string;
  center_id: string;
  kind: LedgerKind;
  entry_type: EntryType;
  category: string;
  description: string;
  amount: number;
  deduction: number;
  employee_id: string | null;
  occurred_on: string;
  period_month: number | null;
  period_year: number | null;
  created_by: string | null;
  created_by_name: string;
  source_payment_id: string | null;
  created_at: string;
};
type Staff = Pick<Profile, 'id' | 'full_name' | 'role'>;
type CommissionRule = { id: string; staff_id: string; rate: number; starts_on: string; ends_on: string | null; is_active: boolean };

const ENTRY_LABEL: Record<EntryType, string> = {
  general: 'مصروف عام', salary: 'راتب', advance: 'سلفة', bonus: 'مكافأة', rent: 'إيجار', utility: 'مرافق', purchase: 'مشتريات', payment_collection: 'تحصيل طلاب',
};
const EXPENSE_TYPES: EntryType[] = ['general', 'salary', 'advance', 'bonus', 'rent', 'utility', 'purchase'];

function AccountingUpsell({ centerId }: { centerId: string }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  const request = async () => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await requestAccounting(centerId);
      setMessage('تم إرسال طلب التفعيل إلى الإدارة وسيتم التواصل معك.');
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="container" style={{ padding: '28px 0' }}>
      <Card className="stack-lg" style={{ maxWidth: 680, margin: '0 auto', textAlign: 'center' }}>
        <div className="logo" style={{ margin: '0 auto' }}>💼</div>
        <div>
          <h1 className="h2">المحاسبة — خدمة إضافية</h1>
          <p className="muted" style={{ lineHeight: 1.9 }}>
            سجلاتك المالية تُحفظ وتُسجل تلقائياً في الخلفية منذ بداية اشتراكك (الإيرادات والتحصيل والعهدة)،
            لكن الاطلاع على الدفتر المالي وتسجيل المصروفات والرواتب والعمولات متاح بعد تفعيل الخدمة من الإدارة.
          </p>
        </div>
        <Notice tone="warn">هذه الخدمة مدفوعة وتُفعَّل لكل سنتر على حدة. عند التفعيل ستجد كل حساباتك جاهزة من البداية.</Notice>
        <ErrorNotice error={error} />
        {message ? <Notice tone="success">{message}</Notice> : null}
        <Button type="button" className="block" disabled={busy} onClick={request}>
          {busy ? 'جارٍ الإرسال...' : 'طلب تفعيل الخدمة'}
        </Button>
      </Card>
    </main>
  );
}

export default function AccountingPage() {
  const { profile, features } = useSession();
  const centerId = profile?.center_id;
  const [rows, setRows] = useState<Ledger[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [rules, setRules] = useState<CommissionRule[]>([]);
  const [years, setYears] = useState<FiscalYear[]>([]);
  const [closing, setClosing] = useState(false);
  const [yearMsg, setYearMsg] = useState<string | null>(null);
  const [form, setForm] = useState({ entry_type: 'general' as EntryType, employee_id: '', category: '', description: '', amount: '', deduction: '0', occurred_on: todayIso() });
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [commission, setCommission] = useState({ staff_id: '', rate: '3', starts_on: todayIso(), ends_on: '', is_active: true });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [message, setMessage] = useState<string | null>(null);

  const staffName = useMemo(() => new Map(staff.map((s) => [s.id, s.full_name])), [staff]);
  const filteredRows = useMemo(() => rows.filter((r) => (!fromDate || r.occurred_on >= fromDate) && (!toDate || r.occurred_on <= toDate)), [rows, fromDate, toDate]);
  const totals = useMemo(() => ({
    income: filteredRows.filter((r) => r.kind === 'income').reduce((s, r) => s + Number(r.amount || 0), 0),
    expense: filteredRows.filter((r) => r.kind === 'expense').reduce((s, r) => s + Number(r.amount || 0), 0),
  }), [filteredRows]);
  const collectorTotals = useMemo(() => {
    const map = new Map<string, { name: string; total: number; commission: number; rate: number }>();
    for (const r of filteredRows.filter((x) => x.entry_type === 'payment_collection')) {
      const id = r.created_by ?? (r.created_by_name || 'unknown');
      const current = map.get(id) ?? { name: r.created_by_name || staffName.get(id) || 'غير معروف', total: 0, commission: 0, rate: 0 };
      current.total += Number(r.amount || 0);
      const rule = rules.find((x) => x.staff_id === id && x.is_active && x.starts_on <= (toDate || todayIso()) && (!x.ends_on || x.ends_on >= (fromDate || '0000-01-01')));
      current.rate = Number(rule?.rate ?? 0);
      current.commission = Math.round((current.total * current.rate / 100) * 100) / 100;
      map.set(id, current);
    }
    return [...map.entries()].map(([id, value]) => ({ id, ...value })).sort((a, b) => b.total - a.total);
  }, [filteredRows, rules, staffName, fromDate, toDate]);
  const payroll = useMemo(() => staff.map((emp) => {
    const mine = filteredRows.filter((r) => r.employee_id === emp.id && r.kind === 'expense');
    const salary = mine.filter((r) => r.entry_type === 'salary').reduce((s, r) => s + Number(r.amount || 0), 0);
    const advance = mine.filter((r) => r.entry_type === 'advance').reduce((s, r) => s + Number(r.amount || 0), 0);
    const bonus = mine.filter((r) => r.entry_type === 'bonus').reduce((s, r) => s + Number(r.amount || 0), 0);
    const deduction = mine.reduce((s, r) => s + Number(r.deduction || 0), 0);
    const commissionValue = collectorTotals.find((c) => c.id === emp.id)?.commission ?? 0;
    return { ...emp, salary, advance, bonus: bonus + commissionValue, deduction, net: salary + bonus + commissionValue - deduction - advance };
  }).filter((x) => x.salary || x.advance || x.bonus || x.deduction), [staff, filteredRows, collectorTotals]);

  const load = async () => {
    if (!centerId) return;
    setError(null);
    try {
      const sb = getSupabase();
      const [ledgerRes, staffRes, rulesRes, yearsRes] = await Promise.all([
        sb.from('center_ledger').select('*').eq('center_id', centerId).order('occurred_on', { ascending: false }).limit(1000),
        sb.from('profiles').select('id,full_name,role').eq('center_id', centerId).in('role', ['teacher', 'manager', 'secretary']).order('full_name'),
        sb.from('staff_commission_rules').select('*').eq('center_id', centerId).order('created_at', { ascending: false }),
        fetchMyFiscalYears().catch(() => []),
      ]);
      if (ledgerRes.error) throw ledgerRes.error;
      if (staffRes.error) throw staffRes.error;
      if (rulesRes.error) throw rulesRes.error;
      setRows((ledgerRes.data ?? []) as Ledger[]);
      setStaff((staffRes.data ?? []) as Staff[]);
      setRules((rulesRes.data ?? []) as CommissionRule[]);
      setYears(yearsRes);
      if (!commission.staff_id && staffRes.data?.[0]) setCommission((old) => ({ ...old, staff_id: (staffRes.data[0] as Staff).id }));
    } catch (err) { setError(err); }
  };
  useEffect(() => { void load(); }, [centerId]);

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
      await load();
    } catch (err) {
      setError(err);
    } finally {
      setClosing(false);
    }
  };

  if (profile && !isOwner(profile)) return <Card><Notice tone="error">المحاسبة متاحة لصاحب السنتر فقط.</Notice></Card>;
  if (isOwner(profile) && features && !features.accounting) {
    return centerId ? <AccountingUpsell centerId={centerId} /> : null;
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!centerId) return;
    const amount = Number(form.amount);
    const deduction = Math.max(0, Number(form.deduction) || 0);
    if (!form.category.trim() || !amount || amount <= 0) return setError(new Error('أدخل التصنيف والمبلغ الصحيح'));
    if (['salary', 'advance', 'bonus'].includes(form.entry_type) && !form.employee_id) return setError(new Error('اختر الموظف للحركات المرتبطة بالراتب أو السلفة أو المكافأة'));
    setBusy(true); setError(null); setMessage(null);
    try {
      const { error } = await getSupabase().from('center_ledger').insert({
        center_id: centerId,
        kind: 'expense',
        entry_type: form.entry_type,
        category: form.category.trim(),
        description: form.description.trim(),
        amount,
        occurred_on: form.occurred_on || todayIso(),
        employee_id: form.employee_id || null,
        created_by: profile?.id,
        created_by_name: profile?.full_name ?? '',
        deduction,
        period_month: Number((form.occurred_on || todayIso()).slice(5, 7)),
        period_year: Number((form.occurred_on || todayIso()).slice(0, 4)),
      });
      if (error) throw error;
      setForm({ entry_type: 'general', employee_id: '', category: '', description: '', amount: '', deduction: '0', occurred_on: todayIso() });
      setMessage('تم تسجيل المصروف. إيرادات الطلاب تسجل آلياً فقط من قسم التحصيل لمنع ازدواج الإيراد.');
      await load();
    } catch (err) { setError(err); }
    finally { setBusy(false); }
  };

  const saveCommission = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!centerId || !commission.staff_id) return;
    const rate = Number(commission.rate);
    if (Number.isNaN(rate) || rate < 0 || rate > 100) return setError(new Error('نسبة العمولة يجب أن تكون بين 0 و 100'));
    setError(null); setMessage(null);
    try {
      const { error } = await getSupabase().from('staff_commission_rules').upsert({
        center_id: centerId,
        staff_id: commission.staff_id,
        rate,
        starts_on: commission.starts_on || todayIso(),
        ends_on: commission.ends_on || null,
        is_active: commission.is_active,
      }, { onConflict: 'center_id,staff_id' });
      if (error) throw error;
      setMessage('تم حفظ نسبة العمولة.');
      await load();
    } catch (err) { setError(err); }
  };

  const printFinancial = () => printReport(buildReportHtml('التقرير المالي', `${fromDate || 'البداية'} — ${toDate || 'اليوم'}`, [
    { title: 'الملخص', headers: ['البند', 'القيمة'], rows: [['الإيرادات', formatMoney(totals.income)], ['المصروفات', formatMoney(totals.expense)], ['الصافي', formatMoney(totals.income - totals.expense)]] },
    { title: 'تحصيل الموظفين', headers: ['الموظف', 'المحصل', 'نسبة العمولة', 'العمولة'], rows: collectorTotals.map((c) => [c.name, formatMoney(c.total), `${c.rate}%`, formatMoney(c.commission)]) },
    { title: 'آخر الحركات', headers: ['التاريخ', 'النوع', 'البند', 'المبلغ', 'المنفذ'], rows: filteredRows.map((r) => [formatDate(r.occurred_on), r.kind === 'income' ? 'إيراد' : 'مصروف', `${ENTRY_LABEL[r.entry_type] ?? r.entry_type} — ${r.category}`, formatMoney(r.amount), r.created_by_name || staffName.get(r.employee_id ?? '') || '—']) },
  ], { name: profile?.full_name }));

  const printPayroll = (p: (typeof payroll)[number]) => printReport(buildPayrollReportHtml({ name: p.full_name, role: roleLabel(p.role) }, `${fromDate || 'البداية'} — ${toDate || 'اليوم'}`, {
    base: p.salary, bonus: p.bonus, advances: p.advance, deductions: p.deduction, net: p.net,
  }, { name: profile?.full_name }));

  return <>
    <PageHeader title="المحاسبة" subtitle="دفتر مالي: إيرادات التحصيل آلية، والمصروفات/الرواتب/السلف يضيفها صاحب السنتر فقط." actions={<Button type="button" variant="secondary" onClick={printFinancial}>طباعة تقرير مالي</Button>} />
    <ErrorNotice error={error} />{message ? <Notice tone="success">{message}</Notice> : null}
    {yearMsg ? <Notice tone="success">{yearMsg}</Notice> : null}
    <Card className="stack" style={{ marginBottom: 18 }}>
      <div className="row-between">
        <h2 className="h3">السنة المالية</h2>
        {years.some((y) => y.status === 'open') ? (
          <Button type="button" variant="secondary" disabled={closing} onClick={closeYear}>{closing ? 'جارٍ الإغلاق...' : 'إغلاق السنة وفتح سنة جديدة'}</Button>
        ) : null}
      </div>
      {years.length === 0 ? <EmptyState title="لا توجد سنوات مالية" body="تُنشأ السنة المالية تلقائياً مع إنشاء السنتر." /> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>السنة</th><th>تبدأ</th><th>تنتهي</th><th>الحالة</th><th>رصيد افتتاحي</th><th>إيرادات</th><th>مصروفات</th><th>رصيد الختام</th><th>مستحقات معلقة</th></tr></thead>
            <tbody>
              {years.map((y) => (
                <tr key={y.id}>
                  <td><strong>{y.year_label}</strong></td>
                  <td>{formatDate(y.starts_on)}</td>
                  <td>{y.ends_on ? formatDate(y.ends_on) : '—'}</td>
                  <td><Badge tone={y.status === 'open' ? 'success' : 'default'}>{y.status === 'open' ? 'مفتوحة' : 'مغلقة'}</Badge></td>
                  <td>{formatMoney(y.opening_balance)}</td>
                  <td>{y.closing_income === null ? '—' : formatMoney(y.closing_income)}</td>
                  <td>{y.closing_expense === null ? '—' : formatMoney(y.closing_expense)}</td>
                  <td><strong>{y.closing_balance === null ? '—' : formatMoney(y.closing_balance)}</strong></td>
                  <td>{y.closing_pending_dues === null ? '—' : formatMoney(y.closing_pending_dues)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
    <div className="grid grid-4" style={{ marginBottom: 18 }}><Card className="compact kpi"><span className="muted">الإيرادات</span><div className="kpi-value">{formatMoney(totals.income)}</div></Card><Card className="compact kpi"><span className="muted">المصروفات</span><div className="kpi-value">{formatMoney(totals.expense)}</div></Card><Card className="compact kpi"><span className="muted">الصافي</span><div className="kpi-value">{formatMoney(totals.income - totals.expense)}</div></Card><Card className="compact kpi"><span className="muted">حركات الفترة</span><div className="kpi-value">{filteredRows.length}</div></Card></div>
    <div className="grid grid-2">
      <Card className="stack"><h2 className="h3">فلترة الفترة</h2><div className="grid grid-2"><Input label="من تاريخ" type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} /><Input label="إلى تاريخ" type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} /></div><Notice>مصدر الإيراد الوحيد هو `payment_collection` الناتج تلقائياً من دفعات الطلاب؛ هذا يمنع تكرار الإيرادات محاسبياً.</Notice></Card>
      <Card className="stack"><h2 className="h3">مصروف جديد</h2><form className="stack" onSubmit={submit}><div className="grid grid-2"><Select label="نوع المصروف" value={form.entry_type} onChange={(e) => setForm({ ...form, entry_type: e.target.value as EntryType })}>{EXPENSE_TYPES.map((t) => <option key={t} value={t}>{ENTRY_LABEL[t]}</option>)}</Select>{['salary', 'advance', 'bonus'].includes(form.entry_type) ? <Select label="الموظف" value={form.employee_id} onChange={(e) => setForm({ ...form, employee_id: e.target.value })}><option value="">اختر الموظف</option>{staff.map((s) => <option key={s.id} value={s.id}>{s.full_name} — {roleLabel(s.role)}</option>)}</Select> : null}<Input label="التصنيف" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} required /><Input label="المبلغ" type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} required /><Input label="خصم من المستحق" type="number" value={form.deduction} onChange={(e) => setForm({ ...form, deduction: e.target.value })} /><Input label="التاريخ" type="date" value={form.occurred_on} onChange={(e) => setForm({ ...form, occurred_on: e.target.value })} /></div><Input label="الوصف" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /><Button disabled={busy} type="submit">{busy ? 'جاري الحفظ...' : 'حفظ المصروف'}</Button></form></Card>
    </div>
    <div className="grid grid-2" style={{ marginTop: 18 }}>
      <Card className="stack"><h2 className="h3">عمولات التحصيل</h2><form className="stack" onSubmit={saveCommission}><div className="grid grid-2"><Select label="الموظف" value={commission.staff_id} onChange={(e) => setCommission({ ...commission, staff_id: e.target.value })}><option value="">اختر الموظف</option>{staff.map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}</Select><Input label="النسبة %" type="number" value={commission.rate} onChange={(e) => setCommission({ ...commission, rate: e.target.value })} /><Input label="تبدأ من" type="date" value={commission.starts_on} onChange={(e) => setCommission({ ...commission, starts_on: e.target.value })} /><Input label="تنتهي في" type="date" value={commission.ends_on} onChange={(e) => setCommission({ ...commission, ends_on: e.target.value })} /></div><label className="row small muted"><input type="checkbox" checked={commission.is_active} onChange={(e) => setCommission({ ...commission, is_active: e.target.checked })} /> العمولة مفعلة</label><Button type="submit" variant="secondary">حفظ العمولة</Button></form>{collectorTotals.length === 0 ? <EmptyState title="لا يوجد تحصيل موظفين في الفترة" /> : collectorTotals.map((c) => <div key={c.id} className="row-between card compact soft"><span>{c.name}</span><span>{formatMoney(c.total)}</span><Badge tone="success">عمولة {formatMoney(c.commission)} · {c.rate}%</Badge></div>)}</Card>
      <Card className="stack"><h2 className="h3">كشف الرواتب والسلفيات</h2>{payroll.length === 0 ? <EmptyState title="لا توجد حركات رواتب في الفترة" /> : payroll.map((p) => <div key={p.id} className="card compact soft stack"><div className="row-between"><strong>{p.full_name}</strong><Badge>{roleLabel(p.role)}</Badge></div><p className="muted small">راتب: {formatMoney(p.salary)} · سلف: {formatMoney(p.advance)} · مكافآت/عمولات: {formatMoney(p.bonus)} · خصومات: {formatMoney(p.deduction)}</p><div className="row-between"><strong>الصافي: {formatMoney(p.net)}</strong><Button type="button" variant="secondary" onClick={() => printPayroll(p)}>كشف راتب PDF</Button></div></div>)}</Card>
    </div>
    <Card className="stack" style={{ marginTop: 18 }}><div className="row-between"><h2 className="h3">سجل الحركات</h2><Badge tone="info">{filteredRows.length}</Badge></div>{filteredRows.length === 0 ? <EmptyState title="لا توجد حركات" /> : <div className="table-wrap"><table><thead><tr><th>التاريخ</th><th>النوع</th><th>البند</th><th>الموظف/المنفذ</th><th>المبلغ</th><th>المصدر</th></tr></thead><tbody>{filteredRows.map((r) => <tr key={r.id}><td>{formatDate(r.occurred_on)}</td><td><Badge tone={r.kind === 'income' ? 'success' : 'warn'}>{r.kind === 'income' ? 'إيراد' : 'مصروف'}</Badge></td><td>{ENTRY_LABEL[r.entry_type] ?? r.entry_type}<div className="tiny muted">{r.category}{r.description ? ` — ${r.description}` : ''}</div></td><td>{staffName.get(r.employee_id ?? '') ?? r.created_by_name ?? '—'}</td><td>{formatMoney(r.amount)}</td><td>{r.source_payment_id ? 'دفعة طالب' : 'يدوي'}</td></tr>)}</tbody></table></div>}</Card>
  </>;
}
