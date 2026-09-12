'use client';

import { useEffect, useMemo, useState } from 'react';
import { Badge, Button, Card, EmptyState, ErrorNotice, Input, Notice, PageHeader, Select, Textarea } from '@/components/ui';
import { useSession } from '@/context/session';
import { fetchCenterStudentGroups, fetchDuesForStudent, fetchGrades, fetchGroups, fetchMyCenter, fetchStudents } from '@/lib/api';
import { can } from '@/lib/rbac';
import { useTeacherGroupIds } from '@/lib/staff';
import type { Center, Grade, Group, Student } from '@/lib/types';
import { duesReminderText, generalNoticeText, guardianReportText, openWhatsApp } from '@/lib/whatsapp';
import { arabicMonth } from '@/lib/utils';

type Scope = 'all' | 'grade' | 'group' | 'student';

export default function WhatsAppPage() {
  const { profile } = useSession();
  const centerId = profile?.center_id;
  const teacherScope = useTeacherGroupIds();
  const [center, setCenter] = useState<Center | null>(null);
  const [students, setStudents] = useState<Student[]>([]);
  const [grades, setGrades] = useState<Grade[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [extraLinks, setExtraLinks] = useState<Set<string>>(new Set());
  const [scope, setScope] = useState<Scope>('all');
  const [scopeGrade, setScopeGrade] = useState('');
  const [scopeGroup, setScopeGroup] = useState('');
  const [scopeStudent, setScopeStudent] = useState('');
  const [target, setTarget] = useState<'student' | 'guardian'>('guardian');
  const [body, setBody] = useState('السلام عليكم، نذكركم بمتابعة حساب الطالب على تطبيق/ويب Mr Center.');
  const [error, setError] = useState<unknown>(null);

  const visibleGroups = useMemo(() => {
    if (profile?.role !== 'teacher') return groups;
    if (!teacherScope) return [];
    return groups.filter((g) => teacherScope.includes(g.id));
  }, [groups, profile?.role, teacherScope]);
  const visibleGroupIds = useMemo(() => new Set(visibleGroups.map((g) => g.id)), [visibleGroups]);
  const scopedStudents = useMemo(() => profile?.role === 'teacher'
    ? students.filter((s) => !!s.group_id && visibleGroupIds.has(s.group_id))
    : students,
  [students, profile?.role, visibleGroupIds]);
  const filtered = useMemo(() => scopedStudents.filter((s) => {
    if (scope === 'grade') return scopeGrade ? s.grade_id === scopeGrade : true;
    if (scope === 'group') return scopeGroup ? s.group_id === scopeGroup || extraLinks.has(`${s.id}:${scopeGroup}`) : true;
    if (scope === 'student') return scopeStudent ? s.id === scopeStudent : true;
    return true;
  }), [scopedStudents, scope, scopeGrade, scopeGroup, scopeStudent, extraLinks]);

  useEffect(() => {
    if (!centerId) return;
    Promise.all([fetchMyCenter(centerId), fetchStudents(centerId), fetchGrades(centerId), fetchGroups(centerId), fetchCenterStudentGroups(centerId)])
      .then(([c, s, gr, gp, links]) => {
        setCenter(c); setStudents(s); setGrades(gr); setGroups(gp);
        setExtraLinks(new Set(links.map((l) => `${l.student_id}:${l.group_id}`)));
      })
      .catch(setError);
  }, [centerId]);

  if (profile && !can(profile, 'notify')) return <Card><Notice tone="error">ليس لديك صلاحية إرسال تنبيهات واتساب.</Notice></Card>;

  const openOne = async (s: Student) => {
    const phone = target === 'guardian' ? s.guardian_phone : s.phone;
    const ok = await openWhatsApp(phone, body.replaceAll('{student}', s.name).replaceAll('{center}', center?.name ?? ''));
    if (!ok) setError(new Error(`رقم غير صالح للطالب ${s.name}`));
  };
  const buildReport = async (s: Student) => {
    const dues = await fetchDuesForStudent(s.id);
    const pending = dues.filter((d) => d.status !== 'paid');
    setBody(guardianReportText({ centerName: center?.name ?? 'Mr Center', studentName: s.name, pendingCount: pending.length, pendingTotal: pending.reduce((sum, d) => sum + Number(d.amount || 0), 0) }));
  };
  const buildDuesReminder = async (s: Student) => {
    const dues = (await fetchDuesForStudent(s.id)).filter((d) => d.status !== 'paid');
    const total = dues.reduce((sum, d) => sum + Number(d.amount || 0), 0);
    const latest = dues[0];
    setBody(duesReminderText(center?.name ?? 'Mr Center', s.name, latest ? `${arabicMonth(latest.month)} ${latest.year}` : 'مستحقات معلقة', total));
  };

  return <>
    <PageHeader title="واتساب" subtitle="تجهيز رسائل واتساب فردية للطلاب أو أولياء الأمور بنفس قوالب التطبيق." />
    <ErrorNotice error={error} />
    <div className="grid grid-2">
      <Card className="stack"><h2 className="h3">إعداد الرسالة</h2>
        <div className="grid grid-2">
          <Select label="النطاق" value={scope} onChange={(e) => setScope(e.target.value as Scope)}><option value="all">كل الطلاب</option><option value="grade">صف محدد</option><option value="group">مجموعة محددة</option><option value="student">طالب محدد</option></Select>
          <Select label="الإرسال إلى" value={target} onChange={(e) => setTarget(e.target.value as 'student' | 'guardian')}><option value="guardian">ولي الأمر</option><option value="student">الطالب</option></Select>
          {scope === 'grade' ? <Select label="الصف" value={scopeGrade} onChange={(e) => setScopeGrade(e.target.value)}><option value="">كل الصفوف</option>{grades.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</Select> : null}
          {scope === 'group' ? <Select label="المجموعة" value={scopeGroup} onChange={(e) => setScopeGroup(e.target.value)}><option value="">كل المجموعات</option>{visibleGroups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</Select> : null}
          {scope === 'student' ? <Select label="الطالب" value={scopeStudent} onChange={(e) => setScopeStudent(e.target.value)}><option value="">اختر طالباً</option>{scopedStudents.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select> : null}
        </div>
        <Textarea label="نص الرسالة" value={body} onChange={(e) => setBody(e.target.value)} help="يمكن استخدام {student} و {center}" />
        <div className="row"><Button type="button" variant="secondary" onClick={() => setBody(generalNoticeText(center?.name ?? 'Mr Center', 'السلام عليكم، توجد رسالة جديدة من إدارة السنتر.'))}>قالب عام</Button><Input label="عدد المستهدفين" value={String(filtered.length)} readOnly /></div>
        {profile?.role === 'teacher' ? <Notice>حساب المدرس يرى ويرسل فقط لطلاب المجموعات المسندة له في الواجهة مثل تطبيق Android.</Notice> : null}
      </Card>
      <Card className="stack"><div className="row-between"><h2 className="h3">المستهدفون</h2><Badge tone="info">{filtered.length}</Badge></div>{filtered.length === 0 ? <EmptyState title="لا يوجد طلاب" /> : filtered.map((s) => <div key={s.id} className="card compact soft"><div className="row-between"><div><strong>{s.name}</strong><div className="tiny muted" dir="ltr">{target === 'guardian' ? s.guardian_phone : s.phone}</div></div><div className="row"><Button type="button" variant="secondary" onClick={() => void buildReport(s)}>تقرير</Button><Button type="button" variant="secondary" onClick={() => void buildDuesReminder(s)}>مستحق</Button><Button type="button" onClick={() => void openOne(s)}>فتح واتساب</Button></div></div></div>)}</Card>
    </div>
  </>;
}
