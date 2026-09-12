'use client';

import { useEffect, useMemo, useState } from 'react';
import { Badge, Button, Card, EmptyState, ErrorNotice, Input, Notice, PageHeader, Select, formatStatus } from '@/components/ui';
import { useSession } from '@/context/session';
import { fetchDues, fetchGroups, fetchPaymentsForMonth, fetchStudents, generateDuesForGroup, recordPayment } from '@/lib/api';
import type { Due, Group, Payment, Student } from '@/lib/types';
import { can } from '@/lib/rbac';
import { useTeacherGroupIds } from '@/lib/staff';
import { arabicMonth, formatDate, formatMoney } from '@/lib/utils';

export default function PaymentsPage() {
  const { profile } = useSession();
  const centerId = profile?.center_id;
  const now = new Date();
  const [month, setMonth] = useState(String(now.getMonth() + 1));
  const [year, setYear] = useState(String(now.getFullYear()));
  const [groups, setGroups] = useState<Group[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [dues, setDues] = useState<Due[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [selectedGroup, setSelectedGroup] = useState('');
  const [pay, setPay] = useState({ dueId: '', amount: '', notes: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [message, setMessage] = useState<string | null>(null);

  const teacherScope = useTeacherGroupIds();
  const visibleGroups = useMemo(() => {
    if (profile?.role !== 'teacher') return groups;
    if (!teacherScope) return [];
    return groups.filter((g) => teacherScope.includes(g.id));
  }, [groups, profile?.role, teacherScope]);
  const visibleGroupIds = useMemo(() => new Set(visibleGroups.map((g) => g.id)), [visibleGroups]);
  const visibleDues = useMemo(() => profile?.role === 'teacher' ? dues.filter((d) => !!d.group_id && visibleGroupIds.has(d.group_id)) : dues, [dues, profile?.role, visibleGroupIds]);
  const visibleStudentIds = useMemo(() => new Set(students.filter((s) => !profile || profile.role !== 'teacher' || (!!s.group_id && visibleGroupIds.has(s.group_id))).map((s) => s.id)), [students, profile, visibleGroupIds]);
  const visiblePayments = useMemo(() => profile?.role === 'teacher' ? payments.filter((p) => visibleStudentIds.has(p.student_id)) : payments, [payments, profile?.role, visibleStudentIds]);
  const studentsMap = useMemo(() => new Map(students.map((s) => [s.id, s])), [students]);
  const groupsMap = useMemo(() => new Map(groups.map((g) => [g.id, g])), [groups]);
  const pendingDues = visibleDues.filter((d) => d.status !== 'paid');
  const paidTotal = visiblePayments.reduce((sum, p) => sum + Number(p.amount || 0), 0);
  const dueTotal = visibleDues.reduce((sum, d) => sum + Number(d.amount || 0), 0);

  const load = async () => {
    if (!centerId) return;
    setError(null);
    try {
      const m = Number(month); const y = Number(year);
      const [g, s, d, p] = await Promise.all([fetchGroups(centerId), fetchStudents(centerId), fetchDues(centerId, m, y), fetchPaymentsForMonth(centerId, m, y)]);
      setGroups(g); setStudents(s); setDues(d); setPayments(p); if (!selectedGroup && g[0]) setSelectedGroup(g[0].id);
    } catch (err) { setError(err); }
  };
  useEffect(() => { void load(); }, [centerId, month, year]);
  useEffect(() => {
    if (visibleGroups.length === 0) { setSelectedGroup(''); return; }
    if (!selectedGroup || !visibleGroups.some((g) => g.id === selectedGroup)) setSelectedGroup(visibleGroups[0].id);
  }, [visibleGroups, selectedGroup]);

  const generate = async () => {
    if (!centerId || !selectedGroup) return;
    const group = groups.find((g) => g.id === selectedGroup);
    if (!group) return;
    setBusy(true); setError(null); setMessage(null);
    try {
      const res = await generateDuesForGroup(centerId, group, Number(month), Number(year));
      setMessage(res.skippedNoSessions ? 'لم يتم التوليد لأن نظام المجموعة بالحصة ولا توجد حصص لهذا الشهر.' : `تم توليد ${res.created} مستحق بقيمة ${formatMoney(res.amount)}.`);
      await load();
    } catch (err) { setError(err); }
    finally { setBusy(false); }
  };

  const collect = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!centerId || !pay.dueId) return;
    const due = dues.find((d) => d.id === pay.dueId);
    if (!due) return;
    setBusy(true); setError(null); setMessage(null);
    try {
      await recordPayment({ centerId, studentId: due.student_id, dueId: due.id, amount: Number(pay.amount) || Number(due.amount), month: Number(month), year: Number(year), notes: pay.notes });
      setPay({ dueId: '', amount: '', notes: '' });
      setMessage('تم تسجيل الدفعة وتحديث حالة المستحق.');
      await load();
    } catch (err) { setError(err); }
    finally { setBusy(false); }
  };

  if (profile && !can(profile, 'collect')) {
    return <Card><Notice tone="error">ليس لديك صلاحية التحصيل والمدفوعات.</Notice></Card>;
  }

  return (
    <>
      <PageHeader title="المدفوعات والمستحقات" subtitle="توليد مستحقات شهرية وتسجيل التحصيل على نفس جداول التطبيق." />
      <ErrorNotice error={error} />
      {message ? <Notice tone="success">{message}</Notice> : null}

      <div className="grid grid-4" style={{ marginBottom: 18 }}>
        <Card className="compact kpi"><span className="muted">إجمالي المستحقات</span><div className="kpi-value">{formatMoney(dueTotal)}</div></Card>
        <Card className="compact kpi"><span className="muted">المحصل</span><div className="kpi-value">{formatMoney(paidTotal)}</div></Card>
        <Card className="compact kpi"><span className="muted">المعلق</span><div className="kpi-value">{pendingDues.length}</div></Card>
        <Card className="compact kpi"><span className="muted">الشهر</span><div className="kpi-value">{arabicMonth(Number(month))}</div></Card>
      </div>

      <div className="grid grid-2">
        <Card className="stack">
          <h2 className="h3">توليد مستحقات</h2>
          <div className="grid grid-2">
            <Select label="الشهر" value={month} onChange={(e) => setMonth(e.target.value)}>{Array.from({ length: 12 }, (_, i) => <option key={i + 1} value={i + 1}>{arabicMonth(i + 1)}</option>)}</Select>
            <Input label="السنة" type="number" value={year} onChange={(e) => setYear(e.target.value)} />
            <Select label="المجموعة" value={selectedGroup} onChange={(e) => setSelectedGroup(e.target.value)}>
              {visibleGroups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </Select>
          </div>
          <Button type="button" disabled={busy || !selectedGroup} onClick={generate}>توليد مستحقات المجموعة</Button>
        </Card>

        <Card className="stack">
          <h2 className="h3">تحصيل مستحق</h2>
          <form className="stack" onSubmit={collect}>
            <Select label="المستحق" value={pay.dueId} onChange={(e) => {
              const due = dues.find((d) => d.id === e.target.value);
              setPay({ ...pay, dueId: e.target.value, amount: due ? String(due.amount) : '' });
            }}>
              <option value="">اختر مستحقاً</option>
              {pendingDues.map((d) => <option key={d.id} value={d.id}>{studentsMap.get(d.student_id)?.name ?? d.student_id} — {formatMoney(d.amount)}</option>)}
            </Select>
            <Input label="المبلغ المدفوع" type="number" value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value })} />
            <Input label="ملاحظات" value={pay.notes} onChange={(e) => setPay({ ...pay, notes: e.target.value })} />
            <Button disabled={busy || !pay.dueId} type="submit">تسجيل الدفعة</Button>
          </form>
        </Card>
      </div>

      <Card className="stack" style={{ marginTop: 18 }}>
        <div className="row-between"><h2 className="h3">المستحقات</h2><Badge tone="info">{visibleDues.length}</Badge></div>
        {visibleDues.length === 0 ? <EmptyState title="لا توجد مستحقات" body={profile?.role === 'teacher' ? 'لا توجد مستحقات داخل مجموعاتك المسندة لهذا الشهر.' : 'ولّد مستحقات مجموعة لهذا الشهر أولاً.'} /> : (
          <div className="table-wrap"><table><thead><tr><th>الطالب</th><th>المجموعة</th><th>المبلغ</th><th>الحالة</th><th>تاريخ الإنشاء</th></tr></thead><tbody>
            {visibleDues.map((d) => { const st = formatStatus(d.status); return <tr key={d.id}><td>{studentsMap.get(d.student_id)?.name ?? '—'}</td><td>{d.group_id ? groupsMap.get(d.group_id)?.name ?? '—' : '—'}</td><td>{formatMoney(d.amount)}</td><td><Badge tone={st.tone}>{st.text}</Badge></td><td>{formatDate(d.created_at)}</td></tr>; })}
          </tbody></table></div>
        )}
      </Card>
    </>
  );
}
