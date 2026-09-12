'use client';

import { useEffect, useMemo, useState } from 'react';
import { Badge, Button, Card, EmptyState, ErrorNotice, Input, PageHeader, Select } from '@/components/ui';
import { useSession } from '@/context/session';
import { fetchAttendanceForSessions, fetchDues, fetchGroups, fetchManualGradesForMonth, fetchPaymentsForMonth, fetchSessionsForCenterMonth, fetchStudents } from '@/lib/api';
import { can } from '@/lib/rbac';
import { useTeacherGroupIds } from '@/lib/staff';
import type { Attendance, Due, Group, ManualGrade, Payment, SessionRecord, Student } from '@/lib/types';
import { arabicMonth, formatMoney } from '@/lib/utils';
import { buildReportHtml, printReport } from '@/lib/report';

export default function ReportsPage() {
  const { profile } = useSession();
  const centerId = profile?.center_id;
  const now = new Date();
  const [month, setMonth] = useState(String(now.getMonth() + 1));
  const [year, setYear] = useState(String(now.getFullYear()));
  const [students, setStudents] = useState<Student[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [attendance, setAttendance] = useState<Attendance[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [dues, setDues] = useState<Due[]>([]);
  const [grades, setGrades] = useState<ManualGrade[]>([]);
  const [error, setError] = useState<unknown>(null);

  const load = async () => {
    if (!centerId) return;
    setError(null);
    try {
      const m = Number(month); const y = Number(year);
      const [s, g, sess, p, d, gr] = await Promise.all([fetchStudents(centerId), fetchGroups(centerId), fetchSessionsForCenterMonth(centerId, m, y), fetchPaymentsForMonth(centerId, m, y), fetchDues(centerId, m, y), fetchManualGradesForMonth(centerId, m, y)]);
      setStudents(s); setGroups(g); setSessions(sess); setPayments(p); setDues(d); setGrades(gr); setAttendance(await fetchAttendanceForSessions(sess.map((x) => x.id)));
    } catch (err) { setError(err); }
  };
  useEffect(() => { void load(); }, [centerId, month, year]);
  const teacherScope = useTeacherGroupIds();
  const visibleGroups = useMemo(() => {
    if (profile?.role !== 'teacher') return groups;
    if (!teacherScope) return [];
    return groups.filter((g) => teacherScope.includes(g.id));
  }, [groups, profile?.role, teacherScope]);
  const visibleGroupIds = useMemo(() => new Set(visibleGroups.map((g) => g.id)), [visibleGroups]);
  const visibleStudents = useMemo(() => profile?.role === 'teacher' ? students.filter((s) => !!s.group_id && visibleGroupIds.has(s.group_id)) : students, [students, profile?.role, visibleGroupIds]);
  const visibleStudentIds = useMemo(() => new Set(visibleStudents.map((s) => s.id)), [visibleStudents]);
  const visibleSessions = useMemo(() => profile?.role === 'teacher' ? sessions.filter((s) => visibleGroupIds.has(s.group_id)) : sessions, [sessions, profile?.role, visibleGroupIds]);
  const visibleSessionIds = useMemo(() => new Set(visibleSessions.map((s) => s.id)), [visibleSessions]);
  const visibleAttendance = useMemo(() => profile?.role === 'teacher' ? attendance.filter((a) => visibleSessionIds.has(a.session_id)) : attendance, [attendance, profile?.role, visibleSessionIds]);
  const visiblePayments = useMemo(() => profile?.role === 'teacher' ? payments.filter((p) => visibleStudentIds.has(p.student_id)) : payments, [payments, profile?.role, visibleStudentIds]);
  const visibleDues = useMemo(() => profile?.role === 'teacher' ? dues.filter((d) => !!d.group_id && visibleGroupIds.has(d.group_id)) : dues, [dues, profile?.role, visibleGroupIds]);
  const visibleGrades = useMemo(() => profile?.role === 'teacher' ? grades.filter((g) => visibleStudentIds.has(g.student_id)) : grades, [grades, profile?.role, visibleStudentIds]);
  const stats = useMemo(() => ({ present: visibleAttendance.filter((a) => a.status === 'present' || a.status === 'late').length, absent: visibleAttendance.filter((a) => a.status === 'absent').length, paid: visiblePayments.reduce((s, p) => s + Number(p.amount || 0), 0), due: visibleDues.reduce((s, d) => s + Number(d.amount || 0), 0), avg: visibleGrades.length ? Math.round(visibleGrades.reduce((s, g) => s + (Number(g.score) / Math.max(1, Number(g.max_score))) * 100, 0) / visibleGrades.length) : null }), [visibleAttendance, visiblePayments, visibleDues, visibleGrades]);
  if (profile && !can(profile, 'reports')) return <Card><div className="notice error">ليس لديك صلاحية التقارير.</div></Card>;
  const print = () => {
    const studentNames = new Map(visibleStudents.map((s) => [s.id, s.name]));
    const groupNames = new Map(visibleGroups.map((g) => [g.id, g.name]));
    printReport(buildReportHtml(`تقرير ${arabicMonth(Number(month))} ${year}`, 'ملخص إداري ومالي وأكاديمي', [
      { title: 'ملخص عام', headers: ['البند', 'القيمة'], rows: [['عدد الطلاب', String(visibleStudents.length)], ['عدد المجموعات', String(visibleGroups.length)], ['عدد الحصص', String(visibleSessions.length)], ['حضور/غياب', `${stats.present} / ${stats.absent}`], ['إجمالي المستحقات', formatMoney(stats.due)], ['إجمالي التحصيل', formatMoney(stats.paid)], ['متوسط الدرجات', stats.avg === null ? '—' : `${stats.avg}%`]] },
      { title: 'المستحقات', headers: ['الطالب', 'المجموعة', 'المبلغ', 'الحالة'], rows: visibleDues.map((d) => [studentNames.get(d.student_id) ?? d.student_id, d.group_id ? groupNames.get(d.group_id) ?? '—' : '—', formatMoney(d.amount), d.status]) },
      { title: 'الدفعات', headers: ['الطالب', 'المبلغ', 'التاريخ', 'ملاحظات'], rows: visiblePayments.map((p) => [studentNames.get(p.student_id) ?? p.student_id, formatMoney(p.amount), p.payment_date, p.notes ?? '—']) },
      { title: 'الدرجات', headers: ['الطالب', 'التقييم', 'الدرجة'], rows: visibleGrades.map((g) => [studentNames.get(g.student_id) ?? g.student_id, g.title, `${g.score}/${g.max_score}`]) },
    ], { name: profile?.full_name }));
  };
  return <><PageHeader title="التقارير" subtitle="تقارير شهرية قابلة للطباعة أو الحفظ PDF من المتصفح." actions={<Button type="button" onClick={print}>طباعة / PDF</Button>} /><ErrorNotice error={error} /><Card className="stack" style={{ marginBottom: 18 }}><div className="grid grid-3"><Select label="الشهر" value={month} onChange={(e) => setMonth(e.target.value)}>{Array.from({ length: 12 }, (_, i) => <option key={i + 1} value={i + 1}>{arabicMonth(i + 1)}</option>)}</Select><Input label="السنة" type="number" value={year} onChange={(e) => setYear(e.target.value)} /><div className="input-wrap"><span className="label">الفترة</span><div className="notice">{arabicMonth(Number(month))} {year}</div></div></div></Card><div className="grid grid-4" style={{ marginBottom: 18 }}><Card className="compact kpi"><span className="muted">الطلاب</span><div className="kpi-value">{visibleStudents.length}</div></Card><Card className="compact kpi"><span className="muted">الحصص</span><div className="kpi-value">{visibleSessions.length}</div></Card><Card className="compact kpi"><span className="muted">التحصيل</span><div className="kpi-value">{formatMoney(stats.paid)}</div></Card><Card className="compact kpi"><span className="muted">متوسط الدرجات</span><div className="kpi-value">{stats.avg === null ? '—' : `${stats.avg}%`}</div></Card></div><div className="grid grid-2"><Card className="stack"><div className="row-between"><h2 className="h3">حضور الشهر</h2><Badge tone="success">{stats.present} حاضر</Badge><Badge tone="danger">{stats.absent} غائب</Badge></div>{visibleAttendance.length === 0 ? <EmptyState title="لا يوجد حضور" /> : null}</Card><Card className="stack"><h2 className="h3">مالي</h2><div className="notice">المستحقات: {formatMoney(stats.due)} · المحصل: {formatMoney(stats.paid)} · المتبقي التقريبي: {formatMoney(Math.max(0, stats.due - stats.paid))}</div></Card></div></>;
}
