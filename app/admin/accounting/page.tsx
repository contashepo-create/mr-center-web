'use client';

import { useEffect, useMemo, useState } from 'react';
import { Badge, Button, Card, EmptyState, ErrorNotice, Input, Notice, PageHeader, Select, Textarea } from '@/components/ui';
import { Modal } from '@/components/modal';
import { CustodyWorkspace } from '@/components/accounting/custody-workspace';
import { useToast } from '@/components/toast';
import { useSession } from '@/context/session';
import { closeFiscalYear, fetchMyFiscalYears, requestAccounting, type FiscalYear } from '@/lib/features';
import { isOwner, roleLabel } from '@/lib/rbac';
import { getSupabase } from '@/lib/supabase';
import { LEDGER_ENTRY_LABEL, operatingExpense, periodTotals, summarizeEmployeePayroll, type AccountingLedgerRow, valueOf } from '@/lib/accounting';
import type { Profile } from '@/lib/types';
import { formatDate, formatMoney, todayIso } from '@/lib/utils';
import { buildPayrollReportHtml, buildReportHtml, printReport } from '@/lib/report';

type Ledger = AccountingLedgerRow & {
  center_id: string;
  category: string;
  description: string;
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
type Tab = 'overview' | 'ledger' | 'manual' | 'payroll' | 'advances' | 'commissions' | 'custody' | 'years' | 'reports';

type ManualForm = { kind: 'income' | 'expense'; category: string; description: string; amount: string; occurred_on: string };
type PayrollForm = { employee_id: string; base: string; bonus: string; commission: string; advance: string; deduction: string; occurred_on: string; description: string };

const MANUAL_INCOME_CATEGORIES = ['دورة أو خدمة إضافية', 'بيع ملازم', 'إيراد قاعة', 'دعم أو تبرع', 'إيراد آخر'];
const MANUAL_EXPENSE_CATEGORIES = ['مستلزمات', 'نقل', 'صيانة', 'دعاية', 'إيجار', 'كهرباء ومرافق', 'أدوات تعليمية', 'مصروف آخر'];

function money(amount: number): string { return formatMoney(amount); }
function ledgerTone(kind: Ledger['kind']): 'success' | 'warn' { return kind === 'income' ? 'success' : 'warn'; }
function AccountingUpsell({ centerId }: { centerId: string }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const request = async () => {
    setBusy(true); setError(null); setMessage(null);
    try { await requestAccounting(centerId); setMessage('تم إرسال طلب التفعيل إلى الإدارة وسيتم التواصل معك.'); }
    catch (err) { setError(err); }
    finally { setBusy(false); }
  };
  return <main className="container" style={{ padding: '28px 0' }}><Card className="stack-lg accounting-upsell" style={{ maxWidth: 800, margin: '0 auto' }}>
    <div style={{ textAlign: 'center' }}><div className="logo" style={{ margin: '0 auto' }}>💼</div><h1 className="h2" style={{ marginTop: 10 }}>المحاسبة الذكية لسنترك</h1><p className="muted">دفتر مالي، رواتب وتسويات، سلف بلا ازدواج، عهدة وعمولات وتقارير جاهزة للطباعة.</p></div>
    <div className="grid grid-3">{[
      ['📒', 'دفتر واضح', 'إيراد ومصروف وحركة نقدية مع رصيد جارٍ.'],
      ['🧮', 'رواتب صحيحة', 'تُسوّى السلفة من الراتب ولا تُحسب تكلفة مرتين.'],
      ['📊', 'تقارير عملية', 'قائمة دخل وتدفق نقدي وكشوف رواتب.'],
    ].map(([icon, title, text]) => <div className="card compact soft" key={title}><div className="small">{icon}</div><strong>{title}</strong><p className="tiny muted">{text}</p></div>)}</div>
    <Notice tone="info">تُفعّل العهدة تلقائياً مع خدمة المحاسبة، ويظهر للمدير والسكرتير زر تسليم العهدة من داخلها.</Notice>
    <ErrorNotice error={error} />{message ? <Notice tone="success">{message}</Notice> : null}
    <Button type="button" className="block" disabled={busy} onClick={() => void request()}>{busy ? 'جارٍ الإرسال…' : '🔓 اطلب تفعيل المحاسبة الآن'}</Button>
  </Card></main>;
}

export default function AccountingPage() {
  const { profile, features } = useSession();
  const toast = useToast();
  const centerId = profile?.center_id;
  const owner = isOwner(profile);
  const canDeliverCustody = profile?.role === 'manager' || profile?.role === 'secretary';
  const [rows, setRows] = useState<Ledger[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [rules, setRules] = useState<CommissionRule[]>([]);
  const [years, setYears] = useState<FiscalYear[]>([]);
  const [tab, setTab] = useState<Tab>('overview');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [kindFilter, setKindFilter] = useState<'all' | 'income' | 'expense'>('all');
  const [search, setSearch] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [closing, setClosing] = useState(false);
  const [yearMessage, setYearMessage] = useState<string | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualDirty, setManualDirty] = useState(false);
  const [manualForm, setManualForm] = useState<ManualForm>({ kind: 'income', category: '', description: '', amount: '', occurred_on: todayIso() });
  const [advanceOpen, setAdvanceOpen] = useState(false);
  const [advanceDirty, setAdvanceDirty] = useState(false);
  const [advanceForm, setAdvanceForm] = useState({ employee_id: '', amount: '', occurred_on: todayIso(), description: '' });
  const [payrollOpen, setPayrollOpen] = useState(false);
  const [payrollDirty, setPayrollDirty] = useState(false);
  const [payrollForm, setPayrollForm] = useState<PayrollForm>({ employee_id: '', base: '', bonus: '0', commission: '0', advance: '0', deduction: '0', occurred_on: todayIso(), description: '' });
  const [commissionPayOpen, setCommissionPayOpen] = useState(false);
  const [commissionPayDirty, setCommissionPayDirty] = useState(false);
  const [commissionPay, setCommissionPay] = useState({ employee_id: '', amount: '', occurred_on: todayIso(), description: '' });
  const [ruleOpen, setRuleOpen] = useState(false);
  const [ruleDirty, setRuleDirty] = useState(false);
  const [ruleForm, setRuleForm] = useState({ staff_id: '', rate: '3', starts_on: todayIso(), ends_on: '', is_active: true });

  const staffName = useMemo(() => new Map(staff.map((person) => [person.id, person.full_name])), [staff]);
  const filteredRows = useMemo(() => rows.filter((row) => {
    if (fromDate && row.occurred_on < fromDate) return false;
    if (toDate && row.occurred_on > toDate) return false;
    if (kindFilter !== 'all' && row.kind !== kindFilter) return false;
    const q = search.trim();
    return !q || `${row.category} ${row.description} ${row.created_by_name} ${staffName.get(row.employee_id ?? '') ?? ''}`.includes(q);
  }), [rows, fromDate, toDate, kindFilter, search, staffName]);
  const totals = useMemo(() => periodTotals(filteredRows), [filteredRows]);
  const openYear = years.find((year) => year.status === 'open');
  const openingBalance = valueOf(openYear?.opening_balance);
  const runningRows = useMemo(() => {
    let balance = openingBalance;
    return [...filteredRows].sort((a, b) => a.occurred_on.localeCompare(b.occurred_on)).map((row) => {
      balance += row.kind === 'income' ? valueOf(row.amount) : -valueOf(row.amount);
      return { ...row, balance };
    });
  }, [filteredRows, openingBalance]);
  const expenseBreakdown = useMemo(() => {
    const data = new Map<string, number>();
    filteredRows.forEach((row) => {
      const amount = operatingExpense(row);
      if (amount > 0) data.set(LEDGER_ENTRY_LABEL[row.entry_type], (data.get(LEDGER_ENTRY_LABEL[row.entry_type]) ?? 0) + amount);
    });
    return [...data.entries()].map(([label, amount]) => ({ label, amount })).sort((a, b) => b.amount - a.amount);
  }, [filteredRows]);
  const collectorTotals = useMemo(() => {
    const data = new Map<string, { id: string; name: string; collected: number; rate: number; due: number; paid: number }>();
    filteredRows.filter((row) => row.entry_type === 'payment_collection').forEach((row) => {
      const id = row.created_by ?? '';
      if (!id) return;
      const rule = rules.find((entry) => entry.staff_id === id && entry.is_active && entry.starts_on <= (toDate || todayIso()) && (!entry.ends_on || entry.ends_on >= (fromDate || '0000-01-01')));
      const current = data.get(id) ?? { id, name: row.created_by_name || staffName.get(id) || 'موظف', collected: 0, rate: valueOf(rule?.rate), due: 0, paid: 0 };
      current.collected += valueOf(row.amount);
      current.due = Math.round((current.collected * current.rate / 100) * 100) / 100;
      data.set(id, current);
    });
    filteredRows.filter((row) => row.entry_type === 'commission' || (row.entry_type === 'salary' && valueOf(row.commission_amount) > 0)).forEach((row) => {
      if (!row.employee_id) return;
      const current = data.get(row.employee_id) ?? { id: row.employee_id, name: staffName.get(row.employee_id) ?? 'موظف', collected: 0, rate: 0, due: 0, paid: 0 };
      current.paid += row.entry_type === 'salary' ? valueOf(row.commission_amount) : valueOf(row.amount);
      data.set(row.employee_id, current);
    });
    return [...data.values()].sort((a, b) => b.due - a.due);
  }, [filteredRows, rules, staffName, fromDate, toDate]);
  const payroll = useMemo(() => staff.map((employee) => {
    const period = summarizeEmployeePayroll(filteredRows, employee.id);
    const allTime = summarizeEmployeePayroll(rows, employee.id);
    return { ...employee, ...period, outstandingAdvance: allTime.advancesOutstanding };
  }).filter((entry) => entry.baseSalary || entry.bonuses || entry.commissions || entry.advancesIssued || entry.deductions || entry.outstandingAdvance), [staff, filteredRows, rows]);
  const advances = useMemo(() => staff.map((employee) => ({ ...employee, ...summarizeEmployeePayroll(rows, employee.id) })).filter((item) => item.advancesIssued || item.advancesOutstanding), [staff, rows]);

  const load = async () => {
    if (!centerId || !owner) return;
    setError(null);
    try {
      const sb = getSupabase();
      const [ledgerRes, staffRes, rulesRes, fiscalYears] = await Promise.all([
        sb.from('center_ledger').select('*').eq('center_id', centerId).order('occurred_on', { ascending: false }).limit(1500),
        sb.from('profiles').select('id,full_name,role').eq('center_id', centerId).in('role', ['center_admin', 'teacher', 'manager', 'secretary']).order('full_name'),
        sb.from('staff_commission_rules').select('*').eq('center_id', centerId).order('created_at', { ascending: false }),
        fetchMyFiscalYears().catch(() => []),
      ]);
      if (ledgerRes.error) throw ledgerRes.error;
      if (staffRes.error) throw staffRes.error;
      if (rulesRes.error) throw rulesRes.error;
      const staffRows = (staffRes.data ?? []) as Staff[];
      setRows((ledgerRes.data ?? []) as Ledger[]); setStaff(staffRows); setRules((rulesRes.data ?? []) as CommissionRule[]); setYears(fiscalYears);
      if (!ruleForm.staff_id && staffRows[0]) setRuleForm((value) => ({ ...value, staff_id: staffRows[0].id }));
    } catch (err) { setError(err); }
  };
  useEffect(() => { void load(); }, [centerId, owner]);

  if (profile && !owner) {
    if (canDeliverCustody) return <CustodyWorkspace embedded />;
    return <Card><Notice tone="error">المحاسبة متاحة لصاحب السنتر، أما المدير والسكرتير فيمكنهما الدخول لتسليم العهدة فقط.</Notice></Card>;
  }
  if (owner && features && !features.accounting) return centerId ? <AccountingUpsell centerId={centerId} /> : null;

  const startManual = (kind: ManualForm['kind']) => {
    setError(null); setManualDirty(false); setManualForm({ kind, category: kind === 'income' ? MANUAL_INCOME_CATEGORIES[0] : MANUAL_EXPENSE_CATEGORIES[0], description: '', amount: '', occurred_on: todayIso() }); setManualOpen(true);
  };
  const saveManual = async (event: React.FormEvent) => {
    event.preventDefault(); if (!centerId) return;
    const amount = Number(manualForm.amount);
    if (!manualForm.category.trim() || !Number.isFinite(amount) || amount <= 0) return setError(new Error('أدخل تصنيفاً ومبلغاً صحيحاً.'));
    setBusy(true); setError(null);
    try {
      const { error: rpcError } = await getSupabase().rpc('record_manual_ledger_entry', { p_center: centerId, p_kind: manualForm.kind, p_category: manualForm.category.trim(), p_description: manualForm.description.trim(), p_amount: amount, p_date: manualForm.occurred_on || todayIso() });
      if (rpcError) throw rpcError;
      setManualOpen(false); setManualDirty(false); toast.success(`تم تسجيل ${manualForm.kind === 'income' ? 'الإيراد' : 'المصروف'} اليدوي`); await load();
    } catch (err) { setError(err); } finally { setBusy(false); }
  };
  const saveAdvance = async (event: React.FormEvent) => {
    event.preventDefault(); if (!centerId || !advanceForm.employee_id) return setError(new Error('اختر الموظف أولاً.'));
    const amount = Number(advanceForm.amount); if (!Number.isFinite(amount) || amount <= 0) return setError(new Error('أدخل مبلغ سلفة صحيحاً.'));
    setBusy(true); setError(null);
    try {
      const { error: rpcError } = await getSupabase().rpc('record_staff_advance', { p_center: centerId, p_employee: advanceForm.employee_id, p_amount: amount, p_date: advanceForm.occurred_on || todayIso(), p_description: advanceForm.description.trim() });
      if (rpcError) throw rpcError;
      setAdvanceOpen(false); setAdvanceDirty(false); toast.success('تم صرف السلفة', 'سجلت حركة نقدية ورصيداً مستحقاً على الموظف، وليست مصروفاً إضافياً.'); await load();
    } catch (err) { setError(err); } finally { setBusy(false); }
  };
  const savePayroll = async (event: React.FormEvent) => {
    event.preventDefault(); if (!centerId || !payrollForm.employee_id) return setError(new Error('اختر الموظف أولاً.'));
    const values = { base: Number(payrollForm.base), bonus: Number(payrollForm.bonus) || 0, commission: Number(payrollForm.commission) || 0, advance: Number(payrollForm.advance) || 0, deduction: Number(payrollForm.deduction) || 0 };
    if (!Number.isFinite(values.base) || values.base <= 0 || Object.values(values).some((value) => value < 0)) return setError(new Error('تحقق من أرقام التسوية؛ الراتب الأساسي أكبر من صفر ولا تقبل الحقول قيماً سالبة.'));
    setBusy(true); setError(null);
    try {
      const { error: rpcError } = await getSupabase().rpc('record_payroll_settlement', { p_center: centerId, p_employee: payrollForm.employee_id, p_base_salary: values.base, p_bonus: values.bonus, p_commission: values.commission, p_advance_applied: values.advance, p_deduction: values.deduction, p_date: payrollForm.occurred_on || todayIso(), p_description: payrollForm.description.trim() });
      if (rpcError) throw rpcError;
      setPayrollOpen(false); setPayrollDirty(false); toast.success('تمت تسوية الراتب', 'يظهر الراتب الإجمالي في الربح والخسارة، وصافي ما دُفع فقط في النقدية.'); await load();
    } catch (err) { setError(err); } finally { setBusy(false); }
  };
  const saveCommissionPayment = async (event: React.FormEvent) => {
    event.preventDefault(); if (!centerId || !commissionPay.employee_id) return setError(new Error('اختر الموظف أولاً.'));
    const amount = Number(commissionPay.amount); if (!Number.isFinite(amount) || amount <= 0) return setError(new Error('أدخل مبلغ العمولة الصحيح.'));
    setBusy(true); setError(null);
    try {
      const { error: rpcError } = await getSupabase().rpc('record_staff_commission_payment', { p_center: centerId, p_employee: commissionPay.employee_id, p_amount: amount, p_date: commissionPay.occurred_on || todayIso(), p_description: commissionPay.description.trim() });
      if (rpcError) throw rpcError;
      setCommissionPayOpen(false); setCommissionPayDirty(false); toast.success('تم تسجيل صرف العمولة'); await load();
    } catch (err) { setError(err); } finally { setBusy(false); }
  };
  const saveRule = async (event: React.FormEvent) => {
    event.preventDefault(); if (!centerId || !ruleForm.staff_id) return setError(new Error('اختر الموظف.'));
    const rate = Number(ruleForm.rate); if (!Number.isFinite(rate) || rate < 0 || rate > 100) return setError(new Error('نسبة العمولة بين 0 و100.'));
    setBusy(true); setError(null);
    try {
      const { error: upsertError } = await getSupabase().from('staff_commission_rules').upsert({ center_id: centerId, staff_id: ruleForm.staff_id, rate, starts_on: ruleForm.starts_on || todayIso(), ends_on: ruleForm.ends_on || null, is_active: ruleForm.is_active }, { onConflict: 'center_id,staff_id' });
      if (upsertError) throw upsertError;
      setRuleOpen(false); setRuleDirty(false); toast.success('تم حفظ قاعدة العمولة'); await load();
    } catch (err) { setError(err); } finally { setBusy(false); }
  };
  const closeYear = async () => {
    if (!centerId || !window.confirm(`سيتم إغلاق السنة ${openYear?.year_label ?? 'الحالية'} وفتح سنة جديدة مع ترحيل الرصيد. هل أنت متأكد؟`)) return;
    setClosing(true); setError(null); setYearMessage(null);
    try { const result = await closeFiscalYear(centerId); setYearMessage(`تم إغلاق ${result.closed} وفتح ${result.opened}. الرصيد المرحّل: ${money(result.carry_balance)}.`); await load(); }
    catch (err) { setError(err); } finally { setClosing(false); }
  };

  const printFinancial = () => printReport(buildReportHtml('التقرير المالي الشامل', `${fromDate || 'البداية'} — ${toDate || 'اليوم'}`, [
    { title: 'ملخص الربح والخسارة', headers: ['البند', 'القيمة'], rows: [['الإيرادات التشغيلية', money(totals.income)], ['تكاليف التشغيل', money(totals.operatingCosts)], ['صافي الربح / الخسارة', money(totals.netProfit)]] },
    { title: 'ملخص الحركة النقدية', headers: ['البند', 'القيمة'], rows: [['رصيد الافتتاح', money(openingBalance)], ['نقد داخل', money(totals.cashIncome)], ['نقد خارج (يشمل السلف)', money(totals.cashOut)], ['الرصيد الجاري', money(openingBalance + totals.cashNet)]] },
    { title: 'السلف القائمة', headers: ['الموظف', 'المرصود', 'المسوّى', 'المتبقي'], rows: advances.map((item) => [item.full_name, money(item.advancesIssued), money(item.advancesApplied), money(item.advancesOutstanding)]) },
  ], { name: profile?.full_name }));
  const printIncomeStatement = () => printReport(buildReportHtml('قائمة الدخل', `${fromDate || 'البداية'} — ${toDate || 'اليوم'}`, [
    { title: 'الإيرادات', headers: ['البند', 'القيمة'], rows: [['الإيرادات التشغيلية', money(totals.income)]] },
    { title: 'تكلفة التشغيل', headers: ['البند', 'القيمة'], rows: [...expenseBreakdown.map((item) => [item.label, money(item.amount)]), ['إجمالي تكلفة التشغيل', money(totals.operatingCosts)]] },
    { title: 'النتيجة', headers: ['البند', 'القيمة'], rows: [['صافي الربح / الخسارة', money(totals.netProfit)]] },
  ], { name: profile?.full_name }));
  const printCashFlow = () => printReport(buildReportHtml('كشف التدفق النقدي', `${fromDate || 'البداية'} — ${toDate || 'اليوم'}`, [
    { title: 'النقدية', headers: ['البند', 'القيمة'], rows: [['رصيد افتتاحي', money(openingBalance)], ['النقد الداخل', `+ ${money(totals.cashIncome)}`], ['النقد الخارج (يشمل السلف)', `− ${money(totals.cashOut)}`], ['الرصيد الختامي', money(openingBalance + totals.cashNet)]] },
  ], { name: profile?.full_name }));

  const resetFilters = () => { setFromDate(''); setToDate(''); setKindFilter('all'); setSearch(''); };
  const tabItems: Array<[Tab, string]> = [['overview', '⌂ ملخص'], ['ledger', '📒 الدفتر'], ['manual', '✚ إيراد ومصروف'], ['payroll', '🧮 رواتب وتسويات'], ['advances', '💳 السلفيات'], ['commissions', '🤝 العمولات'], ['custody', '🧾 العهدة'], ['years', '📆 سنة مالية'], ['reports', '🖨 تقارير']];

  return <>
    <PageHeader title="المحاسبة" subtitle="لوحة مالية عملية: أرباح، نقدية، رواتب، سلف، عمولات، عهدة وتقارير دقيقة." actions={<div className="row"><Button type="button" variant="secondary" onClick={printFinancial}>🖨 طباعة الملخص</Button><Button type="button" onClick={() => startManual('expense')}>+ مصروف</Button></div>} />
    <ErrorNotice error={error} />{yearMessage ? <Notice tone="success">{yearMessage}</Notice> : null}
    <div className="grid grid-4 accounting-kpis" style={{ margin: '16px 0' }}>
      <Card className="compact kpi"><span className="muted">إيرادات تشغيلية</span><div className="kpi-value" style={{ color: 'var(--success)' }}>{money(totals.income)}</div><span className="tiny muted">ضمن الفترة المختارة</span></Card>
      <Card className="compact kpi"><span className="muted">تكلفة تشغيل</span><div className="kpi-value" style={{ color: 'var(--danger)' }}>{money(totals.operatingCosts)}</div><span className="tiny muted">لا تشمل السلف</span></Card>
      <Card className="compact kpi"><span className="muted">صافي الربح / الخسارة</span><div className="kpi-value" style={{ color: totals.netProfit >= 0 ? 'var(--accent)' : 'var(--danger)' }}>{money(totals.netProfit)}</div><span className="tiny muted">الإيراد − التكلفة</span></Card>
      <Card className="compact kpi"><span className="muted">الرصيد النقدي الجاري</span><div className="kpi-value">{money(openingBalance + totals.cashNet)}</div><span className="tiny muted">يشمل السلف المصروفة</span></Card>
    </div>
    <Card className="stack accounting-filter-card" style={{ marginBottom: 16 }}><div className="grid grid-4"><Input label="من تاريخ" type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} /><Input label="إلى تاريخ" type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} /><Select label="نوع الحركة" value={kindFilter} onChange={(event) => setKindFilter(event.target.value as 'all' | 'income' | 'expense')}><option value="all">كل الحركات</option><option value="income">إيرادات</option><option value="expense">مصروفات</option></Select><Input label="بحث في الدفتر" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="تصنيف أو موظف أو وصف" /></div><div className="row-between"><span className="tiny muted">تسري الفترة على الدفتر والتحليل والتقارير. عدد الحركات: {filteredRows.length}</span><Button type="button" variant="ghost" onClick={resetFilters}>مسح الفلاتر</Button></div></Card>
    <div className="tabs accounting-tabs" style={{ marginBottom: 18 }}>{tabItems.map(([key, label]) => <button type="button" key={key} className={`tab ${tab === key ? 'active' : ''}`} onClick={() => setTab(key)}>{label}</button>)}</div>

    {tab === 'overview' ? <div className="stack-lg">
      <div className="grid grid-2"><Card className="stack"><div className="row-between"><div><h2 className="h3">قائمة الدخل</h2><p className="tiny muted">تقيس الأداء التشغيلي، لذلك لا تعد السلفة تكلفة.</p></div><Button type="button" variant="secondary" onClick={printIncomeStatement}>طباعة</Button></div><div className="table-wrap"><table style={{ minWidth: 0 }}><tbody><tr><td>الإيرادات التشغيلية</td><td style={{ color: 'var(--success)' }}>{money(totals.income)}</td></tr>{expenseBreakdown.slice(0, 4).map((item) => <tr key={item.label}><td className="muted">— {item.label}</td><td>{money(item.amount)}</td></tr>)}<tr><td><strong>إجمالي تكلفة التشغيل</strong></td><td style={{ color: 'var(--danger)' }}><strong>{money(totals.operatingCosts)}</strong></td></tr><tr><td><strong>صافي الربح / الخسارة</strong></td><td><strong style={{ color: totals.netProfit >= 0 ? 'var(--success)' : 'var(--danger)' }}>{money(totals.netProfit)}</strong></td></tr></tbody></table></div></Card>
      <Card className="stack"><div className="row-between"><div><h2 className="h3">التدفق النقدي</h2><p className="tiny muted">يسجل كل النقد الداخل والخارج، ومنها السلف.</p></div><Button type="button" variant="secondary" onClick={printCashFlow}>طباعة</Button></div><div className="table-wrap"><table style={{ minWidth: 0 }}><tbody><tr><td>رصيد افتتاحي</td><td>{money(openingBalance)}</td></tr><tr><td>نقد داخل</td><td style={{ color: 'var(--success)' }}>+ {money(totals.cashIncome)}</td></tr><tr><td>نقد خارج</td><td style={{ color: 'var(--danger)' }}>− {money(totals.cashOut)}</td></tr><tr><td className="muted">منه سلف مصروفة</td><td>{money(totals.advances)}</td></tr><tr><td><strong>الرصيد الجاري</strong></td><td><strong>{money(openingBalance + totals.cashNet)}</strong></td></tr></tbody></table></div></Card></div>
      <Card className="stack"><div className="row-between"><div><h2 className="h3">إشارات تحتاج متابعة</h2><p className="muted small">نظرة سريعة على أرصدة الموظفين واستحقاقات التحصيل.</p></div><Badge tone="info">{advances.filter((item) => item.advancesOutstanding > 0).length + collectorTotals.filter((item) => item.due > item.paid).length}</Badge></div><div className="grid grid-2"><div className="soft card compact"><strong>سلف قائمة</strong><div className="kpi-value">{money(advances.reduce((sum, item) => sum + item.advancesOutstanding, 0))}</div><p className="tiny muted">تُخصم فقط عند تسجيل تسوية راتب.</p><Button type="button" variant="ghost" onClick={() => setTab('advances')}>مراجعة السلف ←</Button></div><div className="soft card compact"><strong>عمولات مستحقة تقديرياً</strong><div className="kpi-value">{money(collectorTotals.reduce((sum, item) => sum + Math.max(0, item.due - item.paid), 0))}</div><p className="tiny muted">تُحسب من تحصيل الفترة حسب القواعد الفعالة.</p><Button type="button" variant="ghost" onClick={() => setTab('commissions')}>مراجعة العمولات ←</Button></div></div></Card>
    </div> : null}

    {tab === 'ledger' ? <Card className="stack"><div className="row-between"><div><h2 className="h3">الدفتر العام</h2><p className="muted small">الرصيد الجاري مبني على النقد الفعلي، وليس على تكلفة التشغيل.</p></div><div className="row"><Button type="button" variant="secondary" onClick={() => startManual('income')}>+ إيراد يدوي</Button><Button type="button" onClick={() => startManual('expense')}>+ مصروف</Button></div></div><Notice tone="info">إيراد تحصيل الطلاب يظهر تلقائياً بعد تسجيل الدفعة. ويمكنك إضافة إيرادات أخرى يدوياً عند الحاجة، مع تصنيف واضح لتجنب التكرار.</Notice>{runningRows.length === 0 ? <EmptyState title="لا توجد حركات في الفترة" body="أضف إيراداً أو مصروفاً، أو غيّر الفترة المحددة." /> : <div className="table-wrap"><table><thead><tr><th>التاريخ</th><th>الحركة</th><th>البند</th><th>التفاصيل</th><th>النقد</th><th>الرصيد</th><th>الأثر</th></tr></thead><tbody>{runningRows.map((row) => <tr key={row.id}><td>{formatDate(row.occurred_on)}</td><td><Badge tone={ledgerTone(row.kind)}>{row.kind === 'income' ? 'إيراد' : 'مصروف'}</Badge></td><td><strong>{LEDGER_ENTRY_LABEL[row.entry_type]}</strong><br /><span className="tiny muted">{row.category}</span></td><td className="small">{row.description || '—'}{valueOf(row.advance_applied) > 0 ? <div className="tiny">تسوية سلفة: {money(valueOf(row.advance_applied))}</div> : null}{valueOf(row.deduction) > 0 ? <div className="tiny">خصم: {money(valueOf(row.deduction))}</div> : null}</td><td style={{ color: row.kind === 'income' ? 'var(--success)' : 'var(--danger)' }}><strong>{row.kind === 'income' ? '+' : '−'}{money(valueOf(row.amount))}</strong></td><td>{money(row.balance)}</td><td><Badge tone={row.entry_type === 'advance' ? 'info' : row.affects_profit === false ? 'default' : 'success'}>{row.entry_type === 'advance' ? 'سلفة / ذمم' : row.affects_profit === false ? 'نقد فقط' : 'تشغيلي'}</Badge></td></tr>)}</tbody></table></div>}</Card> : null}

    {tab === 'manual' ? <div className="stack-lg"><div className="grid grid-2"><Card className="stack accounting-action-card"><div className="action-icon">↗</div><h2 className="h3">إيراد يدوي</h2><p className="muted">لإيراد خارج دفعات الطلاب: بيع ملازم أو خدمة أو إيجار قاعة مثلاً.</p><Notice tone="warn">لا تضف دفعة طالب هنا؛ تسجل تلقائياً من قسم المدفوعات.</Notice><Button type="button" onClick={() => startManual('income')}>تسجيل إيراد يدوي</Button></Card><Card className="stack accounting-action-card"><div className="action-icon expense">↘</div><h2 className="h3">مصروف يدوي</h2><p className="muted">إيجار أو مرافق أو صيانة أو مستلزمات. الرواتب والسلف لها تبويباتها الخاصة للتسوية الدقيقة.</p><Button type="button" variant="secondary" onClick={() => startManual('expense')}>تسجيل مصروف يدوي</Button></Card></div><Card className="stack"><h2 className="h3">آخر الإدخالات اليدوية</h2>{filteredRows.filter((row) => row.entry_type === 'general').length === 0 ? <EmptyState title="لا توجد إدخالات يدوية في الفترة" /> : <div className="table-wrap"><table><thead><tr><th>التاريخ</th><th>النوع</th><th>التصنيف</th><th>المبلغ</th><th>الوصف</th></tr></thead><tbody>{filteredRows.filter((row) => row.entry_type === 'general').map((row) => <tr key={row.id}><td>{formatDate(row.occurred_on)}</td><td><Badge tone={ledgerTone(row.kind)}>{row.kind === 'income' ? 'إيراد' : 'مصروف'}</Badge></td><td>{row.category}</td><td>{money(valueOf(row.amount))}</td><td>{row.description || '—'}</td></tr>)}</tbody></table></div>}</Card></div> : null}

    {tab === 'payroll' ? <div className="stack-lg"><Card className="stack"><div className="row-between"><div><h2 className="h3">رواتب وتسويات الموظفين</h2><p className="muted small">التسوية تحفظ الأساسي والمكافأة والعمولة والسلفة والخصم وصافي ما دُفع نقداً في حركة واحدة قابلة للمراجعة.</p></div><Button type="button" onClick={() => { setPayrollForm({ employee_id: staff[0]?.id ?? '', base: '', bonus: '0', commission: '0', advance: '0', deduction: '0', occurred_on: todayIso(), description: '' }); setPayrollDirty(false); setError(null); setPayrollOpen(true); }}>+ تسوية راتب</Button></div><Notice tone="info">السلفة ليست مصروفاً منفصلاً: تُظهر قائمة الدخل تكلفة الراتب الإجمالية مرة واحدة فقط، بينما تسجل النقدية صافي ما تم دفعه فعلاً.</Notice>{payroll.length === 0 ? <EmptyState title="لا توجد تسويات أو سلف للموظفين" body="ابدأ بتسجيل سلفة أو تسوية راتب." /> : <div className="table-wrap"><table><thead><tr><th>الموظف</th><th>أساسي الفترة</th><th>مكافآت/عمولات</th><th>سلف مسواة</th><th>خصومات</th><th>صافي مدفوع</th><th>سلفة قائمة</th><th></th></tr></thead><tbody>{payroll.map((entry) => <tr key={entry.id}><td><strong>{entry.full_name}</strong><br /><span className="tiny muted">{roleLabel(entry.role)}</span></td><td>{money(entry.baseSalary)}</td><td>{money(entry.bonuses + entry.commissions)}</td><td>{money(entry.advancesApplied)}</td><td>{money(entry.deductions)}</td><td><strong>{money(entry.cashPaid)}</strong></td><td style={{ color: entry.outstandingAdvance > 0 ? 'var(--danger)' : undefined }}>{money(entry.outstandingAdvance)}</td><td><Button type="button" variant="ghost" onClick={() => printReport(buildPayrollReportHtml({ name: entry.full_name, role: roleLabel(entry.role) }, `${fromDate || 'البداية'} — ${toDate || 'اليوم'}`, { base: entry.baseSalary, bonus: entry.bonuses + entry.commissions, advances: entry.advancesApplied, deductions: entry.deductions, net: entry.cashPaid }, { name: profile?.full_name }))}>كشف</Button></td></tr>)}</tbody></table></div>}</Card></div> : null}

    {tab === 'advances' ? <div className="stack-lg"><Card className="stack"><div className="row-between"><div><h2 className="h3">السلفيات والذمم على الموظفين</h2><p className="muted small">صرف السلفة يخرج نقداً فقط. ويظل رصيدها ذمة إلى أن تخصمه في تسوية راتب.</p></div><Button type="button" onClick={() => { setAdvanceForm({ employee_id: staff[0]?.id ?? '', amount: '', occurred_on: todayIso(), description: '' }); setAdvanceDirty(false); setError(null); setAdvanceOpen(true); }}>+ صرف سلفة</Button></div><Notice tone="info">إجمالي السلف القائمة: <strong>{money(advances.reduce((sum, entry) => sum + entry.advancesOutstanding, 0))}</strong> — لا يدخل هذا الرقم ضمن مصروفات الربح والخسارة.</Notice>{advances.length === 0 ? <EmptyState title="لا توجد سلف مسجلة" /> : <div className="table-wrap"><table><thead><tr><th>الموظف</th><th>إجمالي سلف مصروفة</th><th>تمت تسويته</th><th>الرصيد المستحق</th><th>آخر حركة</th></tr></thead><tbody>{advances.map((entry) => { const last = rows.filter((row) => row.employee_id === entry.id && row.entry_type === 'advance').sort((a, b) => b.occurred_on.localeCompare(a.occurred_on))[0]; return <tr key={entry.id}><td><strong>{entry.full_name}</strong><br /><span className="tiny muted">{roleLabel(entry.role)}</span></td><td>{money(entry.advancesIssued)}</td><td>{money(entry.advancesApplied)}</td><td><strong style={{ color: entry.advancesOutstanding > 0 ? 'var(--danger)' : 'var(--success)' }}>{money(entry.advancesOutstanding)}</strong></td><td>{last ? formatDate(last.occurred_on) : '—'}</td></tr>; })}</tbody></table></div>}</Card></div> : null}

    {tab === 'commissions' ? <div className="stack-lg"><div className="grid grid-2"><Card className="stack"><div className="row-between"><h2 className="h3">عمولات التحصيل</h2><Button type="button" variant="secondary" onClick={() => { setRuleForm({ staff_id: staff[0]?.id ?? '', rate: '3', starts_on: todayIso(), ends_on: '', is_active: true }); setRuleDirty(false); setError(null); setRuleOpen(true); }}>+ قاعدة عمولة</Button></div><p className="muted small">تُحتسب تقديرياً من تحصيل كل موظف في الفترة حسب النسبة السارية.</p>{rules.length === 0 ? <EmptyState title="لم تضف قاعدة عمولة بعد" body="حدد نسبة عمولة للمحصل ثم راقب المستحقات هنا." /> : <div className="table-wrap"><table><thead><tr><th>الموظف</th><th>النسبة</th><th>من</th><th>إلى</th><th>الحالة</th></tr></thead><tbody>{rules.map((rule) => <tr key={rule.id}><td>{staffName.get(rule.staff_id) ?? 'موظف'}</td><td>{rule.rate}%</td><td>{formatDate(rule.starts_on)}</td><td>{rule.ends_on ? formatDate(rule.ends_on) : 'مفتوحة'}</td><td><Badge tone={rule.is_active ? 'success' : 'default'}>{rule.is_active ? 'فعالة' : 'موقوفة'}</Badge></td></tr>)}</tbody></table></div>}</Card><Card className="stack"><div className="row-between"><h2 className="h3">صرف عمولة</h2><Button type="button" onClick={() => { setCommissionPay({ employee_id: staff[0]?.id ?? '', amount: '', occurred_on: todayIso(), description: '' }); setCommissionPayDirty(false); setError(null); setCommissionPayOpen(true); }}>+ صرف عمولة</Button></div><Notice tone="info">يمكن أيضاً إدراج العمولة داخل تسوية الراتب؛ سيظهر صرفها هنا ضمن المدفوع.</Notice><div className="kpi"><span className="muted">إجمالي المتبقي تقديرياً</span><div className="kpi-value">{money(collectorTotals.reduce((sum, item) => sum + Math.max(0, item.due - item.paid), 0))}</div></div></Card></div><Card className="stack"><h2 className="h3">تحصيل وعمولات الفترة</h2>{collectorTotals.length === 0 ? <EmptyState title="لا يوجد تحصيل مسجل للموظفين في هذه الفترة" /> : <div className="table-wrap"><table><thead><tr><th>الموظف</th><th>المحصل</th><th>النسبة</th><th>المستحق</th><th>المصروف</th><th>المتبقي</th></tr></thead><tbody>{collectorTotals.map((item) => <tr key={item.id}><td>{item.name}</td><td>{money(item.collected)}</td><td>{item.rate}%</td><td>{money(item.due)}</td><td>{money(item.paid)}</td><td><strong style={{ color: item.due > item.paid ? 'var(--danger)' : 'var(--success)' }}>{money(Math.max(0, item.due - item.paid))}</strong></td></tr>)}</tbody></table></div>}</Card></div> : null}

    {tab === 'custody' ? <CustodyWorkspace embedded /> : null}

    {tab === 'years' ? <Card className="stack"><div className="row-between"><div><h2 className="h3">السنة المالية</h2><p className="muted small">عند الإغلاق يرحّل النظام الرصيد والمستحقات المعلقة إلى السنة التالية.</p></div>{openYear ? <Button type="button" variant="secondary" disabled={closing} onClick={() => void closeYear()}>{closing ? 'جارٍ الإغلاق…' : 'إغلاق السنة وفتح التالية'}</Button> : null}</div>{years.length === 0 ? <EmptyState title="لا توجد سنة مالية" body="تُنشأ السنة تلقائياً مع تفعيل المحاسبة." /> : <div className="table-wrap"><table><thead><tr><th>السنة</th><th>تبدأ</th><th>تنتهي</th><th>الحالة</th><th>افتتاحي</th><th>إيرادات</th><th>تكلفة تشغيل</th><th>ختامي</th><th>معلق</th></tr></thead><tbody>{years.map((year) => <tr key={year.id}><td><strong>{year.year_label}</strong></td><td>{formatDate(year.starts_on)}</td><td>{year.ends_on ? formatDate(year.ends_on) : '—'}</td><td><Badge tone={year.status === 'open' ? 'success' : 'default'}>{year.status === 'open' ? 'مفتوحة' : 'مغلقة'}</Badge></td><td>{money(valueOf(year.opening_balance))}</td><td>{year.closing_income === null ? '—' : money(valueOf(year.closing_income))}</td><td>{year.closing_expense === null ? '—' : money(valueOf(year.closing_expense))}</td><td>{year.closing_balance === null ? '—' : money(valueOf(year.closing_balance))}</td><td>{year.closing_pending_dues === null ? '—' : money(valueOf(year.closing_pending_dues))}</td></tr>)}</tbody></table></div>}</Card> : null}

    {tab === 'reports' ? <div className="grid grid-2"><Card className="stack"><h2 className="h3">تقارير قابلة للطباعة PDF</h2><p className="muted">الفترة الحالية: {fromDate || 'البداية'} — {toDate || 'اليوم'}. كل تقرير يفتح مربع طباعة المتصفح مباشرة.</p><div className="stack"><div className="report-action"><div><strong>التقرير المالي الشامل</strong><p className="tiny muted">النتيجة التشغيلية، النقدية والسلف القائمة.</p></div><Button type="button" variant="secondary" onClick={printFinancial}>طباعة</Button></div><div className="report-action"><div><strong>قائمة الدخل</strong><p className="tiny muted">تستبعد السلف حتى لا تتكرر تكلفة الموظف.</p></div><Button type="button" variant="secondary" onClick={printIncomeStatement}>طباعة</Button></div><div className="report-action"><div><strong>كشف التدفق النقدي</strong><p className="tiny muted">يشمل كل النقد الخارج بما فيه السلف.</p></div><Button type="button" variant="secondary" onClick={printCashFlow}>طباعة</Button></div><div className="report-action"><div><strong>قائمة الرواتب</strong><p className="tiny muted">تسويات الفترة وسلفها وخصوماتها.</p></div><Button type="button" variant="secondary" onClick={() => printReport(buildReportHtml('قائمة الرواتب', `${fromDate || 'البداية'} — ${toDate || 'اليوم'}`, [{ title: 'تسويات الموظفين', headers: ['الموظف', 'أساسي', 'إضافات', 'سلفة مسواة', 'خصم', 'صافي نقدي'], rows: payroll.map((item) => [item.full_name, money(item.baseSalary), money(item.bonuses + item.commissions), money(item.advancesApplied), money(item.deductions), money(item.cashPaid)]) }], { name: profile?.full_name }))}>طباعة</Button></div></div></Card><Card className="stack"><h2 className="h3">كيف تُقرأ الأرقام؟</h2><Notice tone="success">قائمة الدخل = الإيراد التشغيلي − تكلفة التشغيل. راتب الموظف يظهر بإجماليه مرة واحدة.</Notice><Notice tone="info">التدفق النقدي = ما دخل الخزينة − ما خرج منها. لذلك يظهر صرف السلفة هنا، لا ضمن التكلفة.</Notice><Notice tone="warn">قبل صرف راتب، راجع رصيد السلف القائم واختر المبلغ المسوّى بدقة في شاشة التسوية.</Notice></Card></div> : null}

    <Modal open={manualOpen} title={manualForm.kind === 'income' ? 'تسجيل إيراد يدوي' : 'تسجيل مصروف يدوي'} subtitle={manualForm.kind === 'income' ? 'لإيراد غير مرتبط بدفعة طالب.' : 'للمصروفات التشغيلية غير المرتبطة بالرواتب أو السلف.'} dirty={manualDirty} onClose={() => setManualOpen(false)} onSave={() => void saveManual({ preventDefault: () => undefined } as React.FormEvent)} saveLabel={busy ? 'جارٍ الحفظ…' : 'حفظ الحركة'} footer={<Button disabled={busy} type="submit" form="manual-ledger-form">{busy ? 'جارٍ الحفظ…' : 'حفظ الحركة'}</Button>}><form id="manual-ledger-form" className="stack" onSubmit={saveManual}><div className="grid grid-2"><Select label="التصنيف" value={manualForm.category} onChange={(event) => { setManualForm({ ...manualForm, category: event.target.value }); setManualDirty(true); }}>{(manualForm.kind === 'income' ? MANUAL_INCOME_CATEGORIES : MANUAL_EXPENSE_CATEGORIES).map((category) => <option key={category} value={category}>{category}</option>)}</Select><Input label="المبلغ" type="number" min="0.01" step="0.01" value={manualForm.amount} onChange={(event) => { setManualForm({ ...manualForm, amount: event.target.value }); setManualDirty(true); }} required /><Input label="التاريخ" type="date" value={manualForm.occurred_on} onChange={(event) => { setManualForm({ ...manualForm, occurred_on: event.target.value }); setManualDirty(true); }} /></div><Textarea label="وصف أو مرجع (اختياري)" value={manualForm.description} onChange={(event) => { setManualForm({ ...manualForm, description: event.target.value }); setManualDirty(true); }} /><Notice tone={manualForm.kind === 'income' ? 'warn' : 'info'}>{manualForm.kind === 'income' ? 'دفعات الطلاب لا تُدخل يدوياً: تظهر تلقائياً من شاشة المدفوعات.' : 'للرواتب والسلف استخدم تبويب «رواتب وتسويات» أو «السلفيات» حتى تبقى التقارير صحيحة.'}</Notice><ErrorNotice error={error} /></form></Modal>

    <Modal open={advanceOpen} title="صرف سلفة موظف" subtitle="السلفة نقد خرج ورصيد مستحق على الموظف، وليست مصروف تشغيل." dirty={advanceDirty} onClose={() => setAdvanceOpen(false)} onSave={() => void saveAdvance({ preventDefault: () => undefined } as React.FormEvent)} saveLabel={busy ? 'جارٍ الحفظ…' : 'صرف السلفة'} footer={<Button disabled={busy} type="submit" form="advance-form">{busy ? 'جارٍ الحفظ…' : 'صرف السلفة'}</Button>}><form id="advance-form" className="stack" onSubmit={saveAdvance}><div className="grid grid-2"><Select label="الموظف" value={advanceForm.employee_id} onChange={(event) => { setAdvanceForm({ ...advanceForm, employee_id: event.target.value }); setAdvanceDirty(true); }}><option value="">اختر الموظف</option>{staff.map((employee) => <option key={employee.id} value={employee.id}>{employee.full_name} — {roleLabel(employee.role)}</option>)}</Select><Input label="مبلغ السلفة" type="number" min="0.01" step="0.01" value={advanceForm.amount} onChange={(event) => { setAdvanceForm({ ...advanceForm, amount: event.target.value }); setAdvanceDirty(true); }} /><Input label="التاريخ" type="date" value={advanceForm.occurred_on} onChange={(event) => { setAdvanceForm({ ...advanceForm, occurred_on: event.target.value }); setAdvanceDirty(true); }} /></div><Textarea label="ملاحظة (اختيارية)" value={advanceForm.description} onChange={(event) => { setAdvanceForm({ ...advanceForm, description: event.target.value }); setAdvanceDirty(true); }} /><Notice tone="info">عند تسوية الراتب، أدخل الجزء الذي تريد خصمه في حقل «سلفة مسوّاة».</Notice><ErrorNotice error={error} /></form></Modal>

    <Modal open={payrollOpen} title="تسوية راتب موظف" subtitle="توثيق كامل للاستحقاق، السلف والخصومات وصافي الدفع النقدي." dirty={payrollDirty} onClose={() => setPayrollOpen(false)} onSave={() => void savePayroll({ preventDefault: () => undefined } as React.FormEvent)} saveLabel={busy ? 'جارٍ الحفظ…' : 'حفظ التسوية'} footer={<Button disabled={busy} type="submit" form="payroll-form">{busy ? 'جارٍ الحفظ…' : 'حفظ التسوية'}</Button>}><form id="payroll-form" className="stack" onSubmit={savePayroll}><div className="grid grid-2"><Select label="الموظف" value={payrollForm.employee_id} onChange={(event) => { setPayrollForm({ ...payrollForm, employee_id: event.target.value }); setPayrollDirty(true); }}><option value="">اختر الموظف</option>{staff.map((employee) => <option key={employee.id} value={employee.id}>{employee.full_name} — {roleLabel(employee.role)}</option>)}</Select><Input label="الراتب الأساسي" type="number" min="0.01" step="0.01" value={payrollForm.base} onChange={(event) => { setPayrollForm({ ...payrollForm, base: event.target.value }); setPayrollDirty(true); }} /><Input label="مكافأة (اختياري)" type="number" min="0" step="0.01" value={payrollForm.bonus} onChange={(event) => { setPayrollForm({ ...payrollForm, bonus: event.target.value }); setPayrollDirty(true); }} /><Input label="عمولة ضمن الراتب" type="number" min="0" step="0.01" value={payrollForm.commission} onChange={(event) => { setPayrollForm({ ...payrollForm, commission: event.target.value }); setPayrollDirty(true); }} /><Input label="سلفة مسوّاة من الراتب" type="number" min="0" step="0.01" value={payrollForm.advance} onChange={(event) => { setPayrollForm({ ...payrollForm, advance: event.target.value }); setPayrollDirty(true); }} help="لا يمكن أن تتجاوز رصيد سلف الموظف." /><Input label="خصم آخر" type="number" min="0" step="0.01" value={payrollForm.deduction} onChange={(event) => { setPayrollForm({ ...payrollForm, deduction: event.target.value }); setPayrollDirty(true); }} /><Input label="تاريخ الاستحقاق" type="date" value={payrollForm.occurred_on} onChange={(event) => { setPayrollForm({ ...payrollForm, occurred_on: event.target.value }); setPayrollDirty(true); }} /></div><Textarea label="بيان التسوية (اختياري)" value={payrollForm.description} onChange={(event) => { setPayrollForm({ ...payrollForm, description: event.target.value }); setPayrollDirty(true); }} /><Notice tone="success">صافي النقد المدفوع = الأساسي + المكافأة + العمولة − السلفة المسوّاة − الخصم. تكلفة التشغيل تبقى إجمالي الاستحقاق قبل السلفة والخصم.</Notice><ErrorNotice error={error} /></form></Modal>

    <Modal open={commissionPayOpen} title="صرف عمولة مستقلة" subtitle="إذا لم تُضم العمولة إلى تسوية الراتب." dirty={commissionPayDirty} onClose={() => setCommissionPayOpen(false)} onSave={() => void saveCommissionPayment({ preventDefault: () => undefined } as React.FormEvent)} saveLabel={busy ? 'جارٍ الحفظ…' : 'صرف العمولة'} footer={<Button disabled={busy} type="submit" form="commission-payment-form">{busy ? 'جارٍ الحفظ…' : 'صرف العمولة'}</Button>}><form id="commission-payment-form" className="stack" onSubmit={saveCommissionPayment}><div className="grid grid-2"><Select label="الموظف" value={commissionPay.employee_id} onChange={(event) => { setCommissionPay({ ...commissionPay, employee_id: event.target.value }); setCommissionPayDirty(true); }}><option value="">اختر الموظف</option>{staff.map((employee) => <option key={employee.id} value={employee.id}>{employee.full_name}</option>)}</Select><Input label="المبلغ" type="number" min="0.01" step="0.01" value={commissionPay.amount} onChange={(event) => { setCommissionPay({ ...commissionPay, amount: event.target.value }); setCommissionPayDirty(true); }} /><Input label="التاريخ" type="date" value={commissionPay.occurred_on} onChange={(event) => { setCommissionPay({ ...commissionPay, occurred_on: event.target.value }); setCommissionPayDirty(true); }} /></div><Textarea label="بيان الصرف (اختياري)" value={commissionPay.description} onChange={(event) => { setCommissionPay({ ...commissionPay, description: event.target.value }); setCommissionPayDirty(true); }} /><ErrorNotice error={error} /></form></Modal>

    <Modal open={ruleOpen} title="قاعدة عمولة تحصيل" subtitle="النسبة التي يستحقها الموظف من تحصيله ضمن فترة القاعدة." dirty={ruleDirty} onClose={() => setRuleOpen(false)} onSave={() => void saveRule({ preventDefault: () => undefined } as React.FormEvent)} saveLabel={busy ? 'جارٍ الحفظ…' : 'حفظ القاعدة'} footer={<Button disabled={busy} type="submit" form="commission-rule-form">{busy ? 'جارٍ الحفظ…' : 'حفظ القاعدة'}</Button>}><form id="commission-rule-form" className="stack" onSubmit={saveRule}><div className="grid grid-2"><Select label="الموظف" value={ruleForm.staff_id} onChange={(event) => { setRuleForm({ ...ruleForm, staff_id: event.target.value }); setRuleDirty(true); }}><option value="">اختر الموظف</option>{staff.map((employee) => <option key={employee.id} value={employee.id}>{employee.full_name}</option>)}</Select><Input label="نسبة العمولة %" type="number" min="0" max="100" step="0.01" value={ruleForm.rate} onChange={(event) => { setRuleForm({ ...ruleForm, rate: event.target.value }); setRuleDirty(true); }} /><Input label="تبدأ من" type="date" value={ruleForm.starts_on} onChange={(event) => { setRuleForm({ ...ruleForm, starts_on: event.target.value }); setRuleDirty(true); }} /><Input label="تنتهي في (اختياري)" type="date" value={ruleForm.ends_on} onChange={(event) => { setRuleForm({ ...ruleForm, ends_on: event.target.value }); setRuleDirty(true); }} /></div><label className="row small"><input type="checkbox" checked={ruleForm.is_active} onChange={(event) => { setRuleForm({ ...ruleForm, is_active: event.target.checked }); setRuleDirty(true); }} /> القاعدة فعّالة</label><ErrorNotice error={error} /></form></Modal>
  </>;
}
