'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { Badge, Button, Card, EmptyState, ErrorNotice, Notice, PageHeader, formatStatus } from '@/components/ui';
import { useToast } from '@/components/toast';
import { useSession } from '@/context/session';
import { addStudentToGroup, fetchDuesForStudent, fetchExams, fetchGrades, fetchGradesForStudent, fetchGroups, fetchMyAttendance, fetchMyExamAttempts, fetchMyInquiries, fetchPaymentsForStudent, fetchStudentAccount, fetchStudentById, fetchStudentGroups, removeStudentFromGroup } from '@/lib/api';
import type { AppExam, AppInquiry, Attendance, Due, ExamAttempt, Grade, Group, ManualGrade, Payment, SessionRecord, Student, StudentAccount } from '@/lib/types';
import { arabicMonth, formatDate, formatMoney } from '@/lib/utils';
import { buildReportHtml, printReport } from '@/lib/report';
import { isOwner, useTeacherGroupIds } from '@/lib/staff';
import { disconnectStudentSession, fetchStudentDevices, setStudentDeviceBlocked, type StudentDeviceSession } from '@/lib/student-access';

type ProfileTab = 'overview' | 'learning' | 'finance' | 'activity';
type StudentActivity = { id: string; at: string; icon: string; title: string; detail: string; tone: 'info' | 'success' | 'warn' | 'danger' | 'default' };

export default function StudentDetailPage() {
  const params = useParams<{ id: string }>();
  const { profile } = useSession();
  const toast = useToast();
  const centerId = profile?.center_id;
  const id = params.id;
  const [student, setStudent] = useState<Student | null>(null);
  const [groups, setGroups] = useState<Group[]>([]);
  const [gradeRows, setGradeRows] = useState<Grade[]>([]);
  const [studentGroupIds, setStudentGroupIds] = useState<string[]>([]);
  const [dues, setDues] = useState<Due[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [manualGrades, setManualGrades] = useState<ManualGrade[]>([]);
  const [examAttempts, setExamAttempts] = useState<ExamAttempt[]>([]);
  const [exams, setExams] = useState<AppExam[]>([]);
  const [inquiries, setInquiries] = useState<AppInquiry[]>([]);
  const [attendance, setAttendance] = useState<(Attendance & { sessions?: SessionRecord | null })[]>([]);
  const [account, setAccount] = useState<StudentAccount | null>(null);
  const [devices, setDevices] = useState<StudentDeviceSession[] | null>(null);
  const [devicesBusy, setDevicesBusy] = useState(false);
  const [tab, setTab] = useState<ProfileTab>('overview');
  const [error, setError] = useState<unknown>(null);
  const teacherScope = useTeacherGroupIds();
  const canManage = isOwner(profile);

  const groupName = useMemo(() => new Map(groups.map((group) => [group.id, group.name])), [groups]);
  const gradeName = useMemo(() => new Map(gradeRows.map((grade) => [grade.id, grade.name])), [gradeRows]);
  const studentAllGroupIds = useMemo(() => [...new Set([student?.group_id, ...studentGroupIds].filter(Boolean) as string[])], [student?.group_id, studentGroupIds]);
  const memberGroups = useMemo(() => groups.filter((group) => studentAllGroupIds.includes(group.id)), [groups, studentAllGroupIds]);
  const gradeGroups = useMemo(() => groups.filter((group) => group.grade_id === student?.grade_id), [groups, student?.grade_id]);
  const incompatibleMembershipIds = useMemo(() => studentGroupIds.filter((groupId) => { const group = groups.find((item) => item.id === groupId); return !!group && group.grade_id !== student?.grade_id; }), [studentGroupIds, groups, student?.grade_id]);
  const teacherCanOpen = profile?.role !== 'teacher' || !teacherScope || studentAllGroupIds.some((groupId) => teacherScope.includes(groupId));
  const pendingDues = useMemo(() => dues.filter((due) => due.status !== 'paid'), [dues]);
  const presentCount = attendance.filter((row) => row.status === 'present').length;
  const lateCount = attendance.filter((row) => row.status === 'late').length;
  const attendanceRate = attendance.length ? Math.round(((presentCount + lateCount) / attendance.length) * 100) : 0;
  const manualAverage = manualGrades.length ? Math.round((manualGrades.reduce((sum, item) => sum + (Number(item.score) / Math.max(1, Number(item.max_score))) * 100, 0) / manualGrades.length) * 10) / 10 : 0;
  const examAverage = examAttempts.length ? Math.round((examAttempts.reduce((sum, item) => sum + (Number(item.score) / Math.max(1, Number(item.max_score))) * 100, 0) / examAttempts.length) * 10) / 10 : 0;

  const load = async () => {
    if (!id || !centerId) return;
    setError(null);
    // تظل هوية الطالب ظاهرة حتى لو كانت شاشة الدور الحالي لا تملك قراءة أحد الأقسام الثانوية.
    const optional = async <T,>(request: Promise<T>, fallback: T): Promise<T> => { try { return await request; } catch { return fallback; } };
    try {
      const [st, allGroups, allGrades, links, nextDues, nextPayments, nextManualGrades, nextAttendance, nextExamAttempts, nextExams, nextInquiries, nextAccount] = await Promise.all([
        fetchStudentById(id), fetchGroups(centerId), fetchGrades(centerId), fetchStudentGroups(id),
        canManage ? optional(fetchDuesForStudent(id), [] as Due[]) : Promise.resolve([] as Due[]),
        canManage ? optional(fetchPaymentsForStudent(id), [] as Payment[]) : Promise.resolve([] as Payment[]),
        optional(fetchGradesForStudent(id), [] as ManualGrade[]), optional(fetchMyAttendance(id), [] as (Attendance & { sessions?: SessionRecord | null })[]),
        canManage ? optional(fetchMyExamAttempts(id), [] as ExamAttempt[]) : Promise.resolve([] as ExamAttempt[]),
        canManage ? optional(fetchExams(centerId), [] as AppExam[]) : Promise.resolve([] as AppExam[]),
        canManage ? optional(fetchMyInquiries(id), [] as AppInquiry[]) : Promise.resolve([] as AppInquiry[]),
        canManage ? optional(fetchStudentAccount(centerId, id), null) : Promise.resolve(null),
      ]);
      setStudent(st); setGroups(allGroups); setGradeRows(allGrades); setStudentGroupIds(links.map((row) => row.group_id));
      setDues(nextDues); setPayments(nextPayments); setManualGrades(nextManualGrades); setAttendance(nextAttendance); setExamAttempts(nextExamAttempts); setExams(nextExams); setInquiries(nextInquiries); setAccount(nextAccount);
    } catch (err) { setError(err); }
  };
  useEffect(() => { void load(); }, [id, centerId, canManage]);

  const toggleGroup = async (groupId: string, checked: boolean) => {
    if (!centerId || !student) return;
    try { if (checked) await addStudentToGroup(centerId, student.id, groupId); else await removeStudentFromGroup(student.id, groupId); await load(); } catch (err) { setError(err); }
  };

  const loadDevices = async () => {
    if (!student || !canManage) return;
    setDevicesBusy(true); setError(null);
    try { setDevices(await fetchStudentDevices(student.id)); }
    catch (err) { setError(err); }
    finally { setDevicesBusy(false); }
  };
  const changeDeviceBlock = async (device: StudentDeviceSession, blocked: boolean) => {
    if (!student) return;
    if (blocked && !window.confirm(`حجب جهاز الطالب ${student.name}؟ سيُغلق وصوله من هذا الجهاز فقط.`)) return;
    setDevicesBusy(true); setError(null);
    try {
      await setStudentDeviceBlocked(student.id, device.device_id, blocked);
      toast.success(blocked ? 'تم حجب الجهاز' : 'تم إلغاء حجب الجهاز', blocked ? 'هذا الحجب مقيد بالطالب والسنتر الحاليين فقط.' : 'يمكن للطالب استخدام الجهاز مرة أخرى.');
      await loadDevices();
    } catch (err) { setError(err); setDevicesBusy(false); }
  };
  const disconnectStudent = async () => {
    if (!student || !window.confirm(`إنهاء جلسة ${student.name} الحالية؟ يمكنه تسجيل الدخول مجدداً ما لم يكن جهازه محجوباً.`)) return;
    setDevicesBusy(true); setError(null);
    try { await disconnectStudentSession(student.id); toast.success('تم إنهاء جلسة الطالب', 'سيُسجل خروجه من التطبيق عند الفحص التالي للجلسة.'); }
    catch (err) { setError(err); }
    finally { setDevicesBusy(false); }
  };

  const activities = useMemo<StudentActivity[]>(() => {
    const rows: StudentActivity[] = [
      ...payments.map((item) => ({ id: `payment-${item.id}`, at: item.payment_date || item.created_at, icon: '¤', title: 'تحصيل مسجل', detail: `${formatMoney(Number(item.amount))}${item.notes ? ` · ${item.notes}` : ''}`, tone: 'success' as const })),
      ...attendance.map((item) => ({ id: `attendance-${item.id}`, at: item.sessions?.session_date || item.created_at, icon: item.status === 'absent' ? '−' : '✓', title: item.status === 'present' ? 'حاضر في الحصة' : item.status === 'late' ? 'حضور متأخر' : 'غياب مسجل', detail: item.sessions ? `${groupName.get(item.sessions.group_id) ?? 'مجموعة'} · ${item.sessions.start_time || ''}` : 'سجل حضور', tone: item.status === 'absent' ? 'danger' as const : item.status === 'late' ? 'warn' as const : 'success' as const })),
      ...manualGrades.map((item) => ({ id: `grade-${item.id}`, at: item.created_at, icon: '★', title: 'تقييم يدوي', detail: `${item.title}: ${item.score} / ${item.max_score}`, tone: 'info' as const })),
      ...examAttempts.map((item) => ({ id: `exam-${item.id}`, at: item.created_at, icon: '✎', title: 'محاولة اختبار', detail: `${exams.find((exam) => exam.id === item.exam_id)?.title ?? 'اختبار'}: ${item.score} / ${item.max_score}`, tone: item.status === 'pending_review' ? 'warn' as const : 'info' as const })),
      ...inquiries.map((item) => ({ id: `inquiry-${item.id}`, at: item.created_at, icon: '↔', title: item.kind === 'transfer' ? 'طلب انتقال مجموعة' : 'طلب أو استفسار', detail: item.subject || item.body || 'بدون عنوان', tone: item.status === 'approved' ? 'success' as const : item.status === 'rejected' ? 'danger' as const : 'default' as const })),
      ...(student ? [{ id: `student-${student.id}`, at: student.created_at, icon: '＋', title: 'انضم الطالب إلى السنتر', detail: `سُجل في ${gradeName.get(student.grade_id ?? '') ?? 'صف غير محدد'}`, tone: 'info' as const }] : []),
    ];
    return rows.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  }, [payments, attendance, manualGrades, examAttempts, inquiries, student, gradeName, groupName, exams]);

  const print = () => {
    if (!student) return;
    printReport(buildReportHtml(`الملف الشامل للطالب: ${student.name}`, 'Mr Center — تقرير أكاديمي ومالي وسجل نشاط', [
      { title: 'بيانات الطالب', headers: ['البند', 'القيمة'], rows: [['رقم الملف', student.id], ['الصف', gradeName.get(student.grade_id ?? '') ?? '—'], ['الهاتف', student.phone ?? '—'], ['ولي الأمر', student.guardian_phone ?? '—'], ['البريد', student.email ?? '—'], ['الحالة', student.status], ['الملاحظات', student.notes ?? '—'], ['تاريخ التسجيل', formatDate(student.created_at)]] },
      { title: 'المجموعات والمدرسون', headers: ['المجموعة', 'نوع العضوية', 'المدرس', 'هاتف المدرس'], rows: memberGroups.map((group) => [group.name, group.id === student.group_id ? 'أساسية' : 'إضافية', group.teacher_name || '—', group.teacher_phone || '—']) },
      { title: 'الملخص الأكاديمي', headers: ['البند', 'القيمة'], rows: [['الحضور', `${presentCount + lateCount} من ${attendance.length} (${attendanceRate}%)`], ['متوسط التقييمات اليدوية', manualGrades.length ? `${manualAverage}%` : '—'], ['متوسط الاختبارات الإلكترونية', examAttempts.length ? `${examAverage}%` : '—']] },
      { title: 'المستحقات', headers: ['الفترة', 'المبلغ', 'الحالة'], rows: dues.map((due) => [`${arabicMonth(due.month)} ${due.due_year}`, formatMoney(Number(due.amount)), due.status]) },
      { title: 'الدفعات', headers: ['التاريخ', 'المبلغ', 'ملاحظات'], rows: payments.map((payment) => [formatDate(payment.payment_date), formatMoney(Number(payment.amount)), payment.notes ?? '—']) },
      { title: 'الدرجات والاختبارات', headers: ['التقييم', 'النتيجة', 'التاريخ'], rows: [...manualGrades.map((item) => [item.title, `${item.score}/${item.max_score}`, formatDate(item.created_at)]), ...examAttempts.map((item) => [exams.find((exam) => exam.id === item.exam_id)?.title ?? 'اختبار', `${item.score}/${item.max_score}`, formatDate(item.created_at)])] },
      { title: 'آخر النشاط', headers: ['التاريخ', 'النشاط', 'التفاصيل'], rows: activities.slice(0, 30).map((item) => [formatDate(item.at), item.title, item.detail]) },
    ], { name: profile?.full_name }));
  };

  if (student && !teacherCanOpen) return <Card><Notice tone="error">هذا الطالب خارج نطاق المجموعات المسندة لك.</Notice></Card>;
  if (!student) return <><PageHeader title="ملف الطالب" subtitle="الملف الأكاديمي والمالي الشامل." actions={<Link className="btn secondary" href="/admin/students">رجوع</Link>} /><ErrorNotice error={error} /><EmptyState title="لم يتم العثور على الطالب" /></>;
  const status = formatStatus(student.status);

  return <>
    <PageHeader title={student.name} subtitle={`ملف شامل · ${gradeName.get(student.grade_id ?? '') ?? 'صف غير محدد'} · ${studentAllGroupIds.length} عضوية`} actions={<div className="row"><Link className="btn secondary" href="/admin/students">رجوع</Link><Button type="button" onClick={print}>طباعة التقرير الشامل</Button></div>} />
    <ErrorNotice error={error} />
    <section className="student-profile-hero"><div className="student-profile-avatar">{student.name.trim().slice(0, 1) || 'ط'}</div><div className="student-profile-title"><div className="row"><h2>{student.name}</h2><Badge tone={status.tone}>{status.text}</Badge></div><p>رقم الملف: <span dir="ltr">{student.id}</span> · مسجل في {formatDate(student.created_at)}</p><div className="student-profile-badges"><Badge tone="info">{gradeName.get(student.grade_id ?? '') ?? 'بلا صف'}</Badge>{memberGroups.map((group) => <Badge key={group.id} tone={group.id === student.group_id ? 'success' : 'default'}>{group.name}{group.id === student.group_id ? ' · أساسية' : ''}</Badge>)}</div></div><div className="student-profile-contact"><span>☎ {student.phone ?? 'لا يوجد هاتف'}</span><span>ولي الأمر: {student.guardian_phone ?? '—'}</span></div></section>
    <div className="grid grid-4 workspace-kpis student-profile-kpis"><Card className="compact kpi workspace-stat purple"><span className="workspace-stat-icon">▦</span><span className="muted">المستحق المتبقي</span><div className="kpi-value">{formatMoney(account?.summary.amount_due ?? pendingDues.reduce((sum, due) => sum + Number(due.amount || 0), 0))}</div></Card><Card className="compact kpi workspace-stat green"><span className="workspace-stat-icon">✓</span><span className="muted">نسبة الحضور</span><div className="kpi-value">{attendanceRate}%</div></Card><Card className="compact kpi workspace-stat blue"><span className="workspace-stat-icon">★</span><span className="muted">متوسط التقييمات</span><div className="kpi-value">{manualGrades.length ? `${manualAverage}%` : '—'}</div></Card><Card className="compact kpi workspace-stat amber"><span className="workspace-stat-icon">✎</span><span className="muted">متوسط الاختبارات</span><div className="kpi-value">{examAttempts.length ? `${examAverage}%` : '—'}</div></Card></div>
    <nav className="student-profile-tabs" aria-label="أقسام ملف الطالب"><button type="button" className={tab === 'overview' ? 'active' : ''} onClick={() => setTab('overview')}>نظرة عامة</button><button type="button" className={tab === 'learning' ? 'active' : ''} onClick={() => setTab('learning')}>الدراسة والحضور</button><button type="button" className={tab === 'finance' ? 'active' : ''} onClick={() => setTab('finance')}>الحساب والتحصيل</button><button type="button" className={tab === 'activity' ? 'active' : ''} onClick={() => setTab('activity')}>سجل النشاط</button></nav>

    {tab === 'overview' ? <div className="grid grid-2"><Card className="stack"><div className="row-between"><h2 className="h3">بيانات الطالب</h2><Badge tone={status.tone}>{status.text}</Badge></div><div className="profile-details-grid"><span>الصف الدراسي</span><strong>{gradeName.get(student.grade_id ?? '') ?? 'غير محدد'}</strong><span>البريد الإلكتروني</span><strong dir="ltr">{student.email ?? profile?.email ?? '—'}</strong><span>هاتف الطالب</span><strong dir="ltr">{student.phone ?? '—'}</strong><span>هاتف ولي الأمر</span><strong dir="ltr">{student.guardian_phone ?? '—'}</strong><span>تاريخ التسجيل</span><strong>{formatDate(student.created_at)}</strong><span>آخر تحديث</span><strong>{formatDate(student.updated_at)}</strong>{student.notes ? <><span>ملاحظات إدارية</span><strong>{student.notes}</strong></> : null}</div></Card>{canManage ? <Card className="stack student-device-card"><div className="row-between"><div><h2 className="h3">أجهزة ووصول الطالب</h2><p className="muted small">حجب جهاز أو إنهاء جلسة الطالب يتم داخل هذا السنتر فقط، ولا يستخدم حجب أجهزة المنصة العام.</p></div><div className="row"><Button type="button" variant="secondary" disabled={devicesBusy} onClick={() => void loadDevices()}>{devicesBusy ? 'جارٍ...' : '↻ تحديث الأجهزة'}</Button><Button type="button" variant="ghost" disabled={devicesBusy} onClick={() => void disconnectStudent()}>إنهاء الجلسة</Button></div></div>{devices === null ? <Notice tone="info">اضغط «تحديث الأجهزة» لعرض الأجهزة التي دخل منها الطالب. يبدأ التسجيل تلقائياً عند دخول الطالب بعد تطبيق التحديث.</Notice> : devices.length === 0 ? <EmptyState title="لا توجد أجهزة مسجلة لهذا الطالب" body="سيظهر الجهاز هنا تلقائياً عند دخوله إلى حسابه." /> : <div className="student-device-list">{devices.map((device) => <article className="student-device-row" key={device.id}><span className={`student-device-icon ${device.blocked ? 'blocked' : ''}`}>{device.blocked ? '⊘' : '▣'}</span><div><strong>{device.blocked ? 'جهاز محجوب' : 'جهاز مسموح'}</strong><p dir="ltr">{device.device_id}</p><small>آخر ظهور: {formatDate(device.last_seen)}{device.note ? ` · ${device.note}` : ''}</small></div><Button type="button" variant={device.blocked ? 'secondary' : 'danger'} disabled={devicesBusy} onClick={() => void changeDeviceBlock(device, !device.blocked)}>{device.blocked ? 'إلغاء الحجب' : 'حجب الجهاز'}</Button></article>)}</div>}</Card> : null}<Card className="stack"><div className="row-between"><div><h2 className="h3">المجموعات والمدرسون</h2><p className="muted small">عضويات الطالب الأساسية والإضافية، مع مدرس كل مجموعة.</p></div><Badge tone="info">{memberGroups.length} مجموعات</Badge></div>{memberGroups.length ? memberGroups.map((group) => <article className="student-teacher-card" key={group.id}><span className="teacher-avatar">{group.teacher_name?.slice(0, 1) || 'م'}</span><div><strong>{group.name} {group.id === student.group_id ? <Badge tone="success">أساسية</Badge> : <Badge>إضافية</Badge>}</strong><p>المدرس: {group.teacher_name || 'لم يُحدد بعد'}{group.teacher_phone ? <span dir="ltr"> · {group.teacher_phone}</span> : ''}</p><small>{group.days?.length ? `المواعيد: ${group.days.join('، ')} · ${group.start_time || '--:--'} - ${group.end_time || '--:--'}` : 'لم يُحدد جدول للمجموعة'}</small></div></article>) : <EmptyState title="لا توجد مجموعات مسندة" />}{canManage ? <><div className="membership-grid">{gradeGroups.map((group) => <label key={group.id} className="membership-option"><input type="checkbox" checked={student.group_id === group.id || studentGroupIds.includes(group.id)} disabled={student.group_id === group.id} onChange={(event) => void toggleGroup(group.id, event.target.checked)} /><span>{group.name} {student.group_id === group.id ? <Badge tone="info">أساسية</Badge> : null}</span></label>)}</div>{incompatibleMembershipIds.length ? <Notice tone="warn">عضويات قديمة بصف مختلف: {incompatibleMembershipIds.map((groupId) => groupName.get(groupId) ?? groupId).join('، ')}. حدّث صف الطالب من قائمة الطلاب لتتم تسويتها تلقائياً.</Notice> : null}</> : null}</Card><Card className="stack"><h2 className="h3">ملخص سريع</h2><div className="profile-summary-row"><span>الحضور المسجل</span><strong>{presentCount + lateCount} حضور · {attendance.filter((item) => item.status === 'absent').length} غياب</strong></div><div className="profile-summary-row"><span>التقييمات والاختبارات</span><strong>{manualGrades.length} تقييم · {examAttempts.length} محاولة</strong></div><div className="profile-summary-row"><span>الطلبات المقدمة</span><strong>{inquiries.length} طلب · {inquiries.filter((item) => item.status === 'pending').length} معلق</strong></div></Card><Card className="stack"><h2 className="h3">آخر نشاط</h2>{activities.slice(0, 5).map((item) => <div className="profile-activity-mini" key={item.id}><span className={item.tone}>{item.icon}</span><div><strong>{item.title}</strong><p>{item.detail}</p></div><small>{formatDate(item.at)}</small></div>)}</Card></div> : null}

    {tab === 'learning' ? <div className="grid grid-2"><Card className="stack"><div className="row-between"><h2 className="h3">سجل الحضور</h2><Badge tone={attendanceRate >= 80 ? 'success' : attendanceRate >= 60 ? 'warn' : 'danger'}>{attendanceRate}%</Badge></div><div className="attendance-summary"><span>حاضر: <b>{presentCount}</b></span><span>متأخر: <b>{lateCount}</b></span><span>غائب: <b>{attendance.filter((item) => item.status === 'absent').length}</b></span></div>{attendance.length ? <div className="table-wrap"><table><thead><tr><th>التاريخ</th><th>المجموعة</th><th>الحالة</th><th>ملاحظات</th></tr></thead><tbody>{attendance.map((item) => <tr key={item.id}><td>{formatDate(item.sessions?.session_date ?? item.created_at)}</td><td>{groupName.get(item.sessions?.group_id ?? '') ?? '—'}</td><td><Badge tone={item.status === 'absent' ? 'danger' : item.status === 'late' ? 'warn' : 'success'}>{item.status === 'present' ? 'حاضر' : item.status === 'late' ? 'متأخر' : 'غائب'}</Badge></td><td>{item.notes ?? '—'}</td></tr>)}</tbody></table></div> : <EmptyState title="لا توجد سجلات حضور" />}</Card><Card className="stack"><h2 className="h3">التقييمات والاختبارات</h2><div className="academic-score-summary"><span>يدوي: <b>{manualGrades.length ? `${manualAverage}%` : '—'}</b></span><span>إلكتروني: <b>{examAttempts.length ? `${examAverage}%` : '—'}</b></span></div>{manualGrades.length || examAttempts.length ? <div className="stack">{manualGrades.map((item) => <div className="profile-summary-row" key={`manual-${item.id}`}><span>★ {item.title}<small>{arabicMonth(item.month)} {item.grade_year}</small></span><strong>{item.score} / {item.max_score}</strong></div>)}{examAttempts.map((item) => <div className="profile-summary-row" key={`exam-${item.id}`}><span>✎ {exams.find((exam) => exam.id === item.exam_id)?.title ?? 'اختبار إلكتروني'}<small>{formatDate(item.created_at)} · {item.status === 'pending_review' ? 'بانتظار المراجعة' : 'مصحح'}</small></span><strong>{item.score} / {item.max_score}</strong></div>)}</div> : <EmptyState title="لا توجد تقييمات أو محاولات" />}</Card></div> : null}

    {tab === 'finance' ? canManage ? <div className="grid grid-2"><Card className="stack"><div className="row-between"><h2 className="h3">كشف الحساب</h2><Badge tone={(account?.summary.net_balance ?? 0) > 0 ? 'success' : 'default'}>{(account?.summary.credit_balance ?? 0) > 0 ? `رصيد مقدم ${formatMoney(account?.summary.credit_balance ?? 0)}` : 'لا يوجد رصيد مقدم'}</Badge></div><div className="finance-summary-grid"><div><span>المستحق</span><strong>{formatMoney(account?.summary.amount_due ?? pendingDues.reduce((sum, due) => sum + Number(due.amount), 0))}</strong></div><div><span>الرصد الدائن</span><strong>{formatMoney(account?.summary.credit_balance ?? 0)}</strong></div><div><span>الصافي</span><strong>{formatMoney(account?.summary.net_balance ?? 0)}</strong></div></div>{dues.length ? <div className="table-wrap"><table><thead><tr><th>الفترة/المصدر</th><th>المبلغ</th><th>الحالة</th></tr></thead><tbody>{dues.map((due) => { const dueStatus = formatStatus(due.status); return <tr key={due.id}><td>{due.due_source === 'attendance' ? 'استحقاق حضور' : `${arabicMonth(due.month)} ${due.due_year}`}</td><td>{formatMoney(Number(due.amount))}</td><td><Badge tone={dueStatus.tone}>{dueStatus.text}</Badge></td></tr>; })}</tbody></table></div> : <EmptyState title="لا توجد مستحقات" />}</Card><Card className="stack"><div className="row-between"><h2 className="h3">سجل التحصيل</h2><Badge tone="info">{payments.length} دفعات</Badge></div>{payments.length ? <div className="table-wrap"><table><thead><tr><th>التاريخ</th><th>المبلغ</th><th>ملاحظات</th></tr></thead><tbody>{payments.map((payment) => <tr key={payment.id}><td>{formatDate(payment.payment_date)}</td><td>{formatMoney(Number(payment.amount))}</td><td>{payment.notes ?? '—'}</td></tr>)}</tbody></table></div> : <EmptyState title="لا توجد دفعات مسجلة" />}</Card></div> : <Card><Notice tone="info">البيانات المالية متاحة لمسئول السنتر فقط.</Notice></Card> : null}

    {tab === 'activity' ? <Card className="stack"><div className="row-between"><div><h2 className="h3">سجل النشاط الكامل</h2><p className="muted small">تجميع زمني للحضور، التحصيل، التقييمات، الاختبارات والطلبات.</p></div><Badge tone="info">{activities.length} حدث</Badge></div>{activities.length ? <div className="student-activity-timeline">{activities.map((item) => <article className="student-activity-row" key={item.id}><span className={`activity-icon ${item.tone}`}>{item.icon}</span><div><strong>{item.title}</strong><p>{item.detail}</p></div><time>{formatDate(item.at)}</time></article>)}</div> : <EmptyState title="لا توجد أحداث مسجلة بعد" />}</Card> : null}
  </>;
}
