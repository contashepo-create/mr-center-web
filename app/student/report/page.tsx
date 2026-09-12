'use client';

import { useEffect, useState } from 'react';
import { Badge, Button, Card, EmptyState, ErrorNotice, PageHeader, formatStatus } from '@/components/ui';
import { useSession } from '@/context/session';
import { fetchDuesForStudent, fetchGradesForStudent, fetchMyAttendance, fetchPaymentsForStudent, fetchStudentById } from '@/lib/api';
import type { Attendance, Due, ManualGrade, Payment, SessionRecord, Student } from '@/lib/types';
import { buildReportHtml, printReport } from '@/lib/report';
import { arabicMonth, formatDate, formatMoney } from '@/lib/utils';

export default function StudentReportPage() {
  const { profile } = useSession();
  const [student, setStudent] = useState<Student | null>(null);  const [attendance, setAttendance] = useState<(Attendance & { sessions?: SessionRecord | null })[]>([]);
  const [grades, setGrades] = useState<ManualGrade[]>([]);
  const [dues, setDues] = useState<Due[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [error, setError] = useState<unknown>(null);

  if (profile && profile.role !== 'student') {
    return <PageHeader title="تقريري الشامل" subtitle="هذه الصفحة مخصصة لحساب الطالب فقط." />;
  }

  useEffect(() => {
    if (!profile?.student_id) return;
    Promise.all([
      fetchStudentById(profile.student_id),
      fetchMyAttendance(profile.student_id),
      fetchGradesForStudent(profile.student_id),
      fetchDuesForStudent(profile.student_id),
      fetchPaymentsForStudent(profile.student_id),
    ])
      .then(([st, a, g, d, p]) => { setStudent(st); setAttendance(a); setGrades(g); setDues(d); setPayments(p); })
      .catch(setError);
  }, [profile?.student_id]);

  const present = attendance.filter((a) => a.status === 'present' || a.status === 'late').length;
  const absent = attendance.filter((a) => a.status === 'absent').length;
  const pending = dues.filter((d) => d.status !== 'paid');
  const avg = grades.length ? Math.round((grades.reduce((s, g) => s + (Number(g.score) / Math.max(1, Number(g.max_score))) * 100, 0) / grades.length)) : null;

  const print = () => {
    printReport(buildReportHtml(`تقرير الطالب ${student?.name ?? profile?.full_name}`, 'تقرير شامل — خاص بالطالب', [
      { title: 'البيانات', headers: ['البند', 'القيمة'], rows: [['الاسم', student?.name ?? profile?.full_name ?? '—'], ['الهاتف', student?.phone ?? '—'], ['ولي الأمر', student?.guardian_phone ?? '—'], ['البريد', profile?.email ?? student?.email ?? '—']] },
      { title: 'الحضور', headers: ['البند', 'القيمة'], rows: [['سجلات الحضور', String(attendance.length)], ['حاضر/متأخر', String(present)], ['غائب', String(absent)]] },
      { title: 'الدرجات', headers: ['التقييم', 'الدرجة', 'النسبة', 'التاريخ'], rows: grades.map((g) => [g.title, `${g.score}/${g.max_score}`, `${Math.round((Number(g.score) / Math.max(1, Number(g.max_score))) * 100)}%`, formatDate(g.created_at)]) },
      { title: 'المستحقات', headers: ['الفترة', 'المبلغ', 'الحالة'], rows: dues.map((d) => [`${arabicMonth(d.month)} ${d.due_year}`, formatMoney(d.amount), d.status === 'paid' ? 'مدفوع' : d.status === 'partial' ? 'جزئي' : 'معلق']) },
      { title: 'الدفعات', headers: ['التاريخ', 'المبلغ', 'ملاحظات'], rows: payments.map((p) => [formatDate(p.payment_date), formatMoney(p.amount), p.notes ?? '—']) },
    ], { name: profile?.full_name }));
  };

  return <>
    <PageHeader title="تقريري الشامل" subtitle="كل بياناتك الأكاديمية والمالية في تقرير واحد." actions={<Button type="button" onClick={print}>طباعة / PDF</Button>} />
    <ErrorNotice error={error} />
    <div className="grid grid-4" style={{ marginBottom: 18 }}>
      <Card className="compact kpi"><span className="muted">سجلات الحضور</span><div className="kpi-value">{attendance.length}</div></Card>
      <Card className="compact kpi"><span className="muted">حاضر</span><div className="kpi-value">{present}</div></Card>
      <Card className="compact kpi"><span className="muted">متوسط الدرجات</span><div className="kpi-value">{avg === null ? '—' : `${avg}%`}</div></Card>
      <Card className="compact kpi"><span className="muted">المستحقات المعلقة</span><div className="kpi-value">{pending.length}</div></Card>
    </div>
    <div className="grid grid-2">
      <Card className="stack"><h2 className="h3">الدرجات</h2>{grades.length === 0 ? <EmptyState title="لا توجد درجات" /> : grades.slice(0, 12).map((g) => <div key={g.id} className="row-between card compact soft"><span>{g.title}</span><strong>{g.score}/{g.max_score}</strong></div>)}</Card>
      <Card className="stack"><h2 className="h3">الحضور</h2>{attendance.length === 0 ? <EmptyState title="لا يوجد حضور" /> : attendance.slice(0, 12).map((a) => { const st = formatStatus(a.status); return <div key={a.id} className="row-between card compact soft"><span>{a.sessions?.session_date ? formatDate(a.sessions.session_date) : formatDate(a.created_at)}</span><Badge tone={st.tone}>{st.text}</Badge></div>; })}</Card>
      <Card className="stack"><h2 className="h3">المستحقات</h2>{dues.length === 0 ? <EmptyState title="لا توجد مستحقات" /> : dues.slice(0, 12).map((d) => { const st = formatStatus(d.status); return <div key={d.id} className="row-between card compact soft"><span>{arabicMonth(d.month)} {d.due_year}</span><span>{formatMoney(d.amount)}</span><Badge tone={st.tone}>{st.text}</Badge></div>; })}</Card>
      <Card className="stack"><h2 className="h3">الدفعات</h2>{payments.length === 0 ? <EmptyState title="لا توجد دفعات" /> : payments.slice(0, 12).map((p) => <div key={p.id} className="row-between card compact soft"><span>{formatDate(p.payment_date)}</span><strong>{formatMoney(p.amount)}</strong></div>)}</Card>
    </div>
  </>;
}
