'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { Badge, Button, Card, EmptyState, ErrorNotice, Input, Notice, PageHeader, Select, formatStatus } from '@/components/ui';
import { Modal } from '@/components/modal';
import { useToast } from '@/components/toast';
import { useSession } from '@/context/session';
import { addStudentToGroup, deleteStudent, fetchCenterStudentGroups, fetchGrades, fetchGroups, fetchStudents, removeStudentFromGroup, upsertStudent } from '@/lib/api';
import type { Grade, Group, Student } from '@/lib/types';
import { isOwner, useTeacherGroupIds } from '@/lib/staff';
import { formatDate } from '@/lib/utils';

const initialForm = { id: '', name: '', phone: '', guardian_phone: '', grade_id: '', group_id: '', status: 'active', notes: '' };
type StudentGroupLink = { student_id: string; group_id: string };

export default function StudentsPage() {
  const { profile } = useSession();
  const toast = useToast();
  const centerId = profile?.center_id;
  const [students, setStudents] = useState<Student[]>([]);
  const [grades, setGrades] = useState<Grade[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [memberLinks, setMemberLinks] = useState<StudentGroupLink[]>([]);
  const [search, setSearch] = useState('');
  const [filterGrade, setFilterGrade] = useState('all');
  const [filterGroup, setFilterGroup] = useState('all');
  const [filterStatus, setFilterStatus] = useState<'all' | Student['status']>('all');
  const [includeArchived, setIncludeArchived] = useState(false);
  const [form, setForm] = useState(initialForm);
  const [additionalGroups, setAdditionalGroups] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const teacherScope = useTeacherGroupIds();
  const canManage = isOwner(profile);
  const linksByStudent = useMemo(() => {
    const result = new Map<string, string[]>();
    memberLinks.forEach((link) => result.set(link.student_id, [...(result.get(link.student_id) ?? []), link.group_id]));
    return result;
  }, [memberLinks]);
  const allGroupIds = (student: Student) => [...new Set([student.group_id, ...(linksByStudent.get(student.id) ?? [])].filter(Boolean) as string[])];
  const visibleGroups = useMemo(() => teacherScope ? groups.filter((group) => teacherScope.includes(group.id)) : groups, [groups, teacherScope]);
  const groupName = useMemo(() => new Map(groups.map((group) => [group.id, group.name])), [groups]);
  const gradeName = useMemo(() => new Map(grades.map((grade) => [grade.id, grade.name])), [grades]);
  const groupsForFilter = useMemo(() => visibleGroups.filter((group) => filterGrade === 'all' || group.grade_id === filterGrade), [visibleGroups, filterGrade]);
  const formGroups = useMemo(() => groups.filter((group) => group.grade_id === form.grade_id), [groups, form.grade_id]);
  const visibleStudents = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('ar-EG');
    return students.filter((student) => {
      const studentGroupIds = allGroupIds(student);
      if (teacherScope && !studentGroupIds.some((id) => teacherScope.includes(id))) return false;
      if (!includeArchived && student.status === 'archived') return false;
      if (filterGrade !== 'all' && student.grade_id !== filterGrade) return false;
      if (filterGroup !== 'all' && !studentGroupIds.includes(filterGroup)) return false;
      if (filterStatus !== 'all' && student.status !== filterStatus) return false;
      return !query || `${student.name} ${student.phone ?? ''} ${student.guardian_phone ?? ''} ${student.email ?? ''}`.toLocaleLowerCase('ar-EG').includes(query);
    }).sort((a, b) => a.name.localeCompare(b.name, 'ar'));
  }, [students, search, filterGrade, filterGroup, filterStatus, includeArchived, teacherScope, linksByStudent]);
  const activeStudents = visibleStudents.filter((student) => student.status === 'active').length;
  const multiGroupStudents = visibleStudents.filter((student) => allGroupIds(student).length > 1).length;

  const load = async () => {
    if (!centerId) return;
    setError(null);
    try {
      const [nextStudents, nextGrades, nextGroups, nextLinks] = await Promise.all([
        fetchStudents(centerId, undefined, true), fetchGrades(centerId), fetchGroups(centerId), fetchCenterStudentGroups(centerId),
      ]);
      setStudents(nextStudents); setGrades(nextGrades); setGroups(nextGroups); setMemberLinks(nextLinks);
    } catch (err) { setError(err); }
  };
  useEffect(() => { void load(); }, [centerId]);

  const change = (patch: Partial<typeof form>) => { setForm((current) => ({ ...current, ...patch })); setDirty(true); };
  const chooseFormGrade = (gradeId: string) => {
    setForm((current) => ({ ...current, grade_id: gradeId, group_id: groups.some((group) => group.id === current.group_id && group.grade_id === gradeId) ? current.group_id : '' }));
    setAdditionalGroups((current) => current.filter((groupId) => groups.some((group) => group.id === groupId && group.grade_id === gradeId)));
    setDirty(true);
  };
  const chooseFilterGrade = (gradeId: string) => { setFilterGrade(gradeId); setFilterGroup('all'); };
  const chooseFilterGroup = (groupId: string) => {
    setFilterGroup(groupId);
    if (groupId !== 'all') setFilterGrade(groups.find((group) => group.id === groupId)?.grade_id ?? 'all');
  };
  const toggleAdditionalGroup = (groupId: string, checked: boolean) => {
    setAdditionalGroups((current) => checked ? [...new Set([...current, groupId])] : current.filter((id) => id !== groupId));
    setDirty(true);
  };

  const addNew = () => { setForm(initialForm); setAdditionalGroups([]); setDirty(false); setError(null); setOpen(true); };
  const edit = (student: Student) => {
    setForm({ id: student.id, name: student.name, phone: student.phone ?? '', guardian_phone: student.guardian_phone ?? '', grade_id: student.grade_id ?? '', group_id: student.group_id ?? '', status: student.status, notes: student.notes ?? '' });
    setAdditionalGroups((linksByStudent.get(student.id) ?? []).filter((groupId) => groupId !== student.group_id));
    setDirty(false); setError(null); setOpen(true);
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!centerId || !form.name.trim()) return setError(new Error('أدخل اسم الطالب.'));
    if (form.group_id && !form.grade_id) return setError(new Error('اختر الصف أولاً حتى تظهر مجموعاته الصحيحة.'));
    setBusy(true); setError(null);
    try {
      const studentId = await upsertStudent(centerId, {
        id: form.id || undefined, name: form.name, phone: form.phone || null, guardian_phone: form.guardian_phone || null,
        grade_id: form.grade_id || null, group_id: form.group_id || null, status: form.status as Student['status'], notes: form.notes || null,
      });
      const before = new Set((linksByStudent.get(studentId) ?? []).filter((id) => id !== form.group_id));
      const desired = new Set(additionalGroups.filter((id) => id !== form.group_id && formGroups.some((group) => group.id === id)));
      await Promise.all([
        ...[...before].filter((id) => !desired.has(id)).map((id) => removeStudentFromGroup(studentId, id)),
        ...[...desired].filter((id) => !before.has(id)).map((id) => addStudentToGroup(centerId, studentId, id)),
      ]);
      toast.success(form.id ? 'تم تحديث الطالب ومجموعاته' : 'تمت إضافة الطالب', desired.size ? `ينتمي إلى ${desired.size + (form.group_id ? 1 : 0)} مجموعات.` : 'تم الحفظ بنجاح.');
      setForm(initialForm); setAdditionalGroups([]); setDirty(false); setOpen(false); await load();
    } catch (err) { setError(err); }
    finally { setBusy(false); }
  };

  const remove = async (id: string) => {
    if (!confirm('هل تريد حذف الطالب؟')) return;
    setError(null);
    try { await deleteStudent(id); await load(); toast.success('تم حذف الطالب'); }
    catch (err) { setError(err); }
  };
  const groupsBadges = (student: Student) => {
    const ids = allGroupIds(student);
    if (!ids.length) return <span className="muted">—</span>;
    return <div className="student-group-badges">{ids.map((id) => <Badge key={id} tone={id === student.group_id ? 'info' : 'default'}>{groupName.get(id) ?? 'مجموعة محذوفة'}{id === student.group_id ? ' · أساسية' : ''}</Badge>)}</div>;
  };

  return <>
    <PageHeader title="الطلاب" subtitle="إدارة بيانات الطلاب، صفوفهم، ومجموعاتهم الأساسية والإضافية من شاشة عملية واحدة." actions={canManage ? <Button type="button" onClick={addNew}>+ إضافة طالب جديد</Button> : undefined} />
    <ErrorNotice error={error} />

    <div className="grid grid-4 workspace-kpis" style={{ margin: '16px 0' }}>
      <Card className="compact kpi workspace-stat purple"><span className="workspace-stat-icon">👥</span><span className="muted">إجمالي الطلاب الظاهرين</span><div className="kpi-value">{visibleStudents.length}</div></Card>
      <Card className="compact kpi workspace-stat green"><span className="workspace-stat-icon">✓</span><span className="muted">طلاب نشطون</span><div className="kpi-value">{activeStudents}</div></Card>
      <Card className="compact kpi workspace-stat blue"><span className="workspace-stat-icon">◈</span><span className="muted">ينتمون لأكثر من مجموعة</span><div className="kpi-value">{multiGroupStudents}</div></Card>
      <Card className="compact kpi workspace-stat amber"><span className="workspace-stat-icon">▦</span><span className="muted">الصفوف المتاحة</span><div className="kpi-value">{grades.length}</div></Card>
    </div>

    <Card className="workspace-filters stack">
      <div className="workspace-filter-grid">
        <Input label="بحث سريع" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="الاسم أو رقم الطالب أو ولي الأمر" />
        <Select label="الصف" value={filterGrade} onChange={(event) => chooseFilterGrade(event.target.value)}><option value="all">كل الصفوف</option>{grades.map((grade) => <option key={grade.id} value={grade.id}>{grade.name}</option>)}</Select>
        <Select label="المجموعة" value={filterGroup} onChange={(event) => chooseFilterGroup(event.target.value)}><option value="all">كل المجموعات</option>{groupsForFilter.map((group) => <option key={group.id} value={group.id}>{filterGrade === 'all' ? `${gradeName.get(group.grade_id ?? '') ?? 'بلا صف'} — ${group.name}` : group.name}</option>)}</Select>
        <Select label="الحالة" value={filterStatus} onChange={(event) => setFilterStatus(event.target.value as typeof filterStatus)}><option value="all">كل الحالات</option><option value="active">نشط</option><option value="suspended">موقوف</option><option value="archived">مؤرشف</option></Select>
      </div>
      <div className="row-between"><label className="row small muted"><input type="checkbox" checked={includeArchived} onChange={(event) => setIncludeArchived(event.target.checked)} /> إظهار المؤرشفين</label><Button type="button" variant="ghost" onClick={() => { setSearch(''); setFilterGrade('all'); setFilterGroup('all'); setFilterStatus('all'); }}>مسح الفلاتر</Button></div>
      {!canManage ? <Notice tone="info">أنت ترى فقط طلاب مجموعاتك المسندة. إدارة البيانات والعضويات لصاحب السنتر.</Notice> : null}
    </Card>

    <Card className="students-workspace" style={{ marginTop: 18 }}>
      <div className="row-between"><div><h2 className="h3">دليل الطلاب</h2><p className="muted small">تظهر كل المجموعات بجوار الطالب؛ الشارة الزرقاء هي المجموعة الأساسية.</p></div><Badge tone="info">{visibleStudents.length} نتيجة</Badge></div>
      {visibleStudents.length === 0 ? <EmptyState title={students.length ? 'لا توجد نتائج مطابقة' : 'لا يوجد طلاب بعد'} body={students.length ? 'غيّر البحث أو الصف أو المجموعة.' : 'أضف الطالب الأول ثم اربطه بصف ومجموعة.'} action={canManage ? <Button type="button" onClick={addNew}>إضافة طالب</Button> : undefined} /> : <div className="table-wrap"><table><thead><tr><th>الطالب</th><th>التواصل</th><th>الصف</th><th>المجموعات</th><th>الحالة</th><th>أضيف في</th><th>إجراء</th></tr></thead><tbody>{visibleStudents.map((student) => { const status = formatStatus(student.status); return <tr key={student.id}><td><Link href={`/admin/students/${student.id}`}><strong>{student.name}</strong></Link><div className="tiny muted">{student.email ?? 'لا يوجد بريد'}</div></td><td dir="ltr">{student.phone ?? '—'}<div className="tiny muted" dir="ltr">ولي: {student.guardian_phone ?? '—'}</div></td><td>{student.grade_id ? gradeName.get(student.grade_id) ?? '—' : '—'}</td><td>{groupsBadges(student)}</td><td><Badge tone={status.tone}>{status.text}</Badge></td><td>{formatDate(student.created_at)}</td><td>{canManage ? <div className="row"><Button type="button" variant="secondary" onClick={() => edit(student)}>تعديل</Button><Link className="btn ghost" href={`/admin/students/${student.id}`}>الملف</Link><Button type="button" variant="danger" onClick={() => void remove(student.id)}>حذف</Button></div> : <Link className="btn secondary" href={`/admin/students/${student.id}`}>فتح الملف</Link>}</td></tr>; })}</tbody></table></div>}
    </Card>

    {canManage ? <Modal open={open} title={form.id ? 'تعديل الطالب وعضوياته' : 'إضافة طالب جديد'} subtitle="اختر الصف أولاً؛ تظهر بعده مجموعاته فقط، ثم أضف أي مجموعات إضافية يحتاجها الطالب." dirty={dirty} onClose={() => setOpen(false)} onSave={() => void submit({ preventDefault: () => undefined } as React.FormEvent)} saveLabel={busy ? 'جاري الحفظ...' : 'حفظ الطالب'} wide footer={<Button disabled={busy} type="submit" form="student-form">{busy ? 'جاري الحفظ...' : 'حفظ الطالب والعضويات'}</Button>}><form id="student-form" className="stack" onSubmit={submit}><div className="grid grid-2"><Input label="اسم الطالب" value={form.name} onChange={(event) => change({ name: event.target.value })} required /><Select label="الحالة" value={form.status} onChange={(event) => change({ status: event.target.value })}><option value="active">نشط</option><option value="suspended">موقوف</option><option value="archived">مؤرشف</option></Select><Input label="رقم الطالب" value={form.phone} onChange={(event) => change({ phone: event.target.value })} dir="ltr" /><Input label="رقم ولي الأمر" value={form.guardian_phone} onChange={(event) => change({ guardian_phone: event.target.value })} dir="ltr" /></div><div className="student-assignment-panel"><div className="row-between"><div><h3 className="h3">الصف والمجموعات</h3><p className="muted small">القوائم مترابطة: تغيير الصف يعيد تصفية المجموعة الأساسية والإضافية.</p></div><Badge tone={formGroups.length ? 'info' : 'warn'}>{formGroups.length} مجموعة مناسبة</Badge></div><div className="grid grid-2"><Select label="الصف الدراسي" value={form.grade_id} onChange={(event) => chooseFormGrade(event.target.value)}><option value="">اختر الصف أولاً</option>{grades.map((grade) => <option key={grade.id} value={grade.id}>{grade.name}</option>)}</Select><Select label="المجموعة الأساسية" value={form.group_id} disabled={!form.grade_id} onChange={(event) => { change({ group_id: event.target.value }); setAdditionalGroups((current) => current.filter((id) => id !== event.target.value)); }}><option value="">بدون مجموعة أساسية</option>{formGroups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</Select></div>{!form.grade_id ? <Notice tone="info">اختر الصف لتظهر المجموعات التابعة له فقط.</Notice> : <div className="stack"><span className="label">مجموعات إضافية للطالب</span><p className="muted small" style={{ margin: 0 }}>ضع علامة بجوار كل مجموعة إضافية. ستظهر كلها في ملف الطالب وقائمة الطلاب.</p><div className="membership-grid">{formGroups.length === 0 ? <Notice tone="warn">لا توجد مجموعات لهذا الصف حتى الآن.</Notice> : formGroups.map((group) => { const primary = group.id === form.group_id; const checked = primary || additionalGroups.includes(group.id); return <label key={group.id} className={`membership-option ${checked ? 'checked' : ''} ${primary ? 'primary' : ''}`}><input type="checkbox" disabled={primary} checked={checked} onChange={(event) => toggleAdditionalGroup(group.id, event.target.checked)} /><span><strong>{group.name}</strong><small>{primary ? 'المجموعة الأساسية' : checked ? 'عضوية إضافية مفعلة' : 'أضف الطالب لهذه المجموعة'}</small></span>{primary ? <Badge tone="info">أساسية</Badge> : null}</label>; })}</div></div>}</div><Input label="ملاحظات" value={form.notes} onChange={(event) => change({ notes: event.target.value })} placeholder="ملاحظات إدارية اختيارية" /><ErrorNotice error={error} /></form></Modal> : null}
  </>;
}
