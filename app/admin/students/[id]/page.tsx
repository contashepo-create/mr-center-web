'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { Badge, Button, Card, EmptyState, ErrorNotice, Notice, PageHeader, formatStatus } from '@/components/ui';
import { useSession } from '@/context/session';
import { addStudentToGroup, fetchDuesForStudent, fetchGradesForStudent, fetchGroups, fetchMyAttendance, fetchPaymentsForStudent, fetchStudentById, fetchStudentGroups, removeStudentFromGroup } from '@/lib/api';
import type { Attendance, Due, Group, ManualGrade, Payment, SessionRecord, Student } from '@/lib/types';
import { arabicMonth, formatDate, formatMoney } from '@/lib/utils';
import { buildReportHtml, printReport } from '@/lib/report';
import { isOwner, useTeacherGroupIds } from '@/lib/staff';

export default function StudentDetailPage() {
  const params = useParams<{ id: string }>();
  const { profile } = useSession();
  const centerId = profile?.center_id;
  const id = params.id;
  const [student, setStudent] = useState<Student | null>(null);
  const [groups, setGroups] = useState<Group[]>([]);
  const [studentGroupIds, setStudentGroupIds] = useState<string[]>([]);
  const [dues, setDues] = useState<Due[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [grades, setGrades] = useState<ManualGrade[]>([]);
  const [attendance, setAttendance] = useState<(Attendance & { sessions?: SessionRecord | null })[]>([]);
  const [error, setError] = useState<unknown>(null);
  const teacherScope = useTeacherGroupIds();
  const canManage = isOwner(profile);
  const groupName = useMemo(() => new Map(groups.map((g) => [g.id, g.name])), [groups]);
  const studentAllGroupIds = useMemo(() => [...new Set([student?.group_id, ...studentGroupIds].filter(Boolean) as string[])], [student?.group_id, studentGroupIds]);
  const gradeGroups = useMemo(() => groups.filter((group) => group.grade_id === student?.grade_id), [groups, student?.grade_id]);
  const incompatibleMembershipIds = useMemo(() => studentGroupIds.filter((groupId) => { const group = groups.find((item) => item.id === groupId); return !!group && group.grade_id !== student?.grade_id; }), [studentGroupIds, groups, student?.grade_id]);
  const teacherCanOpen = profile?.role !== 'teacher' || !teacherScope || studentAllGroupIds.some((gid) => teacherScope.includes(gid));

  const load = async () => {
    if (!id || !centerId) return;
    setError(null);
    try {
      const [st, allGroups, sgs, d, p, g, a] = await Promise.all([fetchStudentById(id), fetchGroups(centerId), fetchStudentGroups(id), fetchDuesForStudent(id), fetchPaymentsForStudent(id), fetchGradesForStudent(id), fetchMyAttendance(id)]);
      setStudent(st); setGroups(allGroups); setStudentGroupIds(sgs.map((x) => x.group_id)); setDues(d); setPayments(p); setGrades(g); setAttendance(a);
    } catch (err) { setError(err); }
  };
  useEffect(() => { void load(); }, [id, centerId]);

  const toggleGroup = async (groupId: string, checked: boolean) => {
    if (!centerId || !student) return;
    try { if (checked) await addStudentToGroup(centerId, student.id, groupId); else await removeStudentFromGroup(student.id, groupId); await load(); } catch (err) { setError(err); }
  };

  const print = () => {
    if (!student) return;
    printReport(buildReportHtml(`تقرير الطالب ${student.name}`, 'ملف شامل من Mr Center Web', [
      { title: 'بيانات الطالب', headers: ['البند', 'القيمة'], rows: [['الهاتف', student.phone ?? '—'], ['ولي الأمر', student.guardian_phone ?? '—'], ['الحالة', student.status], ['تاريخ التسجيل', formatDate(student.created_at)]] },
      { title: 'المجموعات', headers: ['المجموعة'], rows: [student.group_id, ...studentGroupIds].filter(Boolean).map((gid) => [groupName.get(gid as string) ?? String(gid)]) },
      { title: 'المستحقات', headers: ['الشهر', 'المبلغ', 'الحالة'], rows: dues.map((d) => [`${arabicMonth(d.month)} ${d.due_year}`, formatMoney(d.amount), d.status]) },
      { title: 'الدفعات', headers: ['التاريخ', 'المبلغ', 'ملاحظات'], rows: payments.map((p) => [formatDate(p.payment_date), formatMoney(p.amount), p.notes ?? '—']) },
      { title: 'الدرجات', headers: ['التقييم', 'الدرجة', 'التاريخ'], rows: grades.map((g) => [g.title, `${g.score}/${g.max_score}`, formatDate(g.created_at)]) },
    ], { name: profile?.full_name }));
  };

  const pending = dues.filter((d) => d.status !== 'paid');
  if (student && !teacherCanOpen) return <Card><Notice tone="error">هذا الطالب خارج نطاق المجموعات المسندة لك.</Notice></Card>;
  return <><PageHeader title={student?.name ?? 'ملف الطالب'} subtitle="ملف شامل للطالب" actions={<><Link className="btn secondary" href="/admin/students">رجوع</Link><Button type="button" onClick={print}>طباعة التقرير</Button></>} /><ErrorNotice error={error} />{!student ? <EmptyState title="لم يتم العثور على الطالب" /> : <div className="grid grid-2"><Card className="stack"><h2 className="h3">بيانات الطالب</h2><p className="muted">الهاتف: <b dir="ltr">{student.phone ?? '—'}</b></p><p className="muted">ولي الأمر: <b dir="ltr">{student.guardian_phone ?? '—'}</b></p><p className="muted">البريد: <b dir="ltr">{student.email ?? '—'}</b></p><Badge tone={formatStatus(student.status).tone}>{formatStatus(student.status).text}</Badge><Notice>إجمالي المعلق: {formatMoney(pending.reduce((s, d) => s + Number(d.amount || 0), 0))}</Notice></Card><Card className="stack"><div className="row-between"><h2 className="h3">المجموعات</h2><Badge tone="info">{studentAllGroupIds.length} عضوية</Badge></div>{canManage ? <><Notice tone="info">المجموعة الأساسية ثابتة هنا، ويمكنك إدارة العضويات الإضافية ضمن صف الطالب فقط.</Notice><div className="membership-grid">{gradeGroups.map((g) => <label key={g.id} className="membership-option"><input type="checkbox" checked={student.group_id === g.id || studentGroupIds.includes(g.id)} disabled={student.group_id === g.id} onChange={(e) => void toggleGroup(g.id, e.target.checked)} /> <span>{g.name} {student.group_id === g.id ? <Badge>أساسية</Badge> : null}</span></label>)}</div>{gradeGroups.length === 0 ? <EmptyState title="لا توجد مجموعات في صف الطالب" /> : null}{incompatibleMembershipIds.length ? <Notice tone="warn">هناك عضويات قديمة في صف مختلف: {incompatibleMembershipIds.map((groupId) => groupName.get(groupId) ?? groupId).join('، ')}. عدّل صف الطالب من قائمة الطلاب لتتم تسوية العضويات تلقائياً.</Notice> : null}</> : studentAllGroupIds.length === 0 ? <EmptyState title="لا توجد مجموعات" /> : <div className="student-group-badges">{studentAllGroupIds.map((gid) => <Badge key={gid} tone="info">{groupName.get(gid) ?? gid}</Badge>)}</div>}</Card><Card className="stack"><h2 className="h3">المستحقات</h2>{dues.length === 0 ? <EmptyState title="لا توجد مستحقات" /> : dues.slice(0, 12).map((d) => { const st = formatStatus(d.status); return <div key={d.id} className="row-between card compact soft"><span>{arabicMonth(d.month)} {d.due_year}</span><span>{formatMoney(d.amount)}</span><Badge tone={st.tone}>{st.text}</Badge></div>; })}</Card><Card className="stack"><h2 className="h3">الدرجات والحضور</h2><p className="muted">الدرجات: {grades.length}</p><p className="muted">سجلات الحضور: {attendance.length}</p>{grades.slice(0, 5).map((g) => <div key={g.id} className="row-between card compact soft"><span>{g.title}</span><strong>{g.score}/{g.max_score}</strong></div>)}</Card></div>}</>;
}
