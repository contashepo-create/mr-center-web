'use client';

import { useEffect, useMemo, useState } from 'react';
import { Badge, Button, Card, EmptyState, ErrorNotice, Input, Notice, PageHeader, Select } from '@/components/ui';
import { Modal } from '@/components/modal';
import { useToast } from '@/components/toast';
import { useSession } from '@/context/session';
import { addGrade, deleteGrade, deleteGroup, fetchCenterStudentGroups, fetchGrades, fetchGroups, fetchStudents, moveGrade, updateGrade, upsertGroup } from '@/lib/api';
import type { BillingType, Grade, Group, Student } from '@/lib/types';
import { isOwner, useTeacherGroupIds } from '@/lib/staff';
import { WEEK_DAYS, arabicDay, billingLabel, findGroupConflicts, formatDays, formatMoney } from '@/lib/utils';

const initial = { id: '', name: '', teacher_name: '', teacher_phone: '', grade_id: '', start_time: '', end_time: '', monthly_fee: '0', billing_type: 'monthly', weekly_price: '0', session_price: '0', due_mode: 'manual', attendance_due_amount: '0', days: [] as string[] };
type StudentGroupLink = { student_id: string; group_id: string };

export default function GroupsPage() {
  const { profile } = useSession();
  const toast = useToast();
  const centerId = profile?.center_id;
  const [groups, setGroups] = useState<Group[]>([]);
  const [grades, setGrades] = useState<Grade[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [memberLinks, setMemberLinks] = useState<StudentGroupLink[]>([]);
  const [newGrade, setNewGrade] = useState('');
  const [editingGrade, setEditingGrade] = useState<{ id: string; name: string } | null>(null);
  const [form, setForm] = useState(initial);
  const [open, setOpen] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [search, setSearch] = useState('');
  const [gradeFilter, setGradeFilter] = useState('all');
  const [expandedGrades, setExpandedGrades] = useState<string[]>([]);
  const teacherScope = useTeacherGroupIds();
  const canManage = isOwner(profile);
  const visibleGroups = useMemo(() => teacherScope ? groups.filter((group) => teacherScope.includes(group.id)) : groups, [groups, teacherScope]);
  const filteredGroups = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('ar-EG');
    return visibleGroups.filter((group) => {
      if (gradeFilter !== 'all' && group.grade_id !== gradeFilter) return false;
      if (!query) return true;
      const gradeName = grades.find((grade) => grade.id === group.grade_id)?.name ?? '';
      return `${group.name} ${group.teacher_name} ${gradeName} ${formatDays(group.days ?? [])}`.toLocaleLowerCase('ar-EG').includes(query);
    });
  }, [visibleGroups, gradeFilter, search, grades]);
  const activeStudents = useMemo(() => students.filter((student) => student.status === 'active'), [students]);
  const groupMemberIds = useMemo(() => {
    const map = new Map<string, Set<string>>();
    const activeIds = new Set(activeStudents.map((student) => student.id));
    const add = (groupId: string, studentId: string) => map.set(groupId, new Set([...(map.get(groupId) ?? []), studentId]));
    activeStudents.forEach((student) => { if (student.group_id) add(student.group_id, student.id); });
    // روابط العضوية قد تحتفظ بطلاب مؤرشفين؛ الإحصاءات هنا تعرض النشطين فقط.
    memberLinks.forEach((link) => { if (activeIds.has(link.student_id)) add(link.group_id, link.student_id); });
    return map;
  }, [activeStudents, memberLinks]);
  const groupStudentCount = (groupId: string) => groupMemberIds.get(groupId)?.size ?? 0;
  const gradeStudentCount = (gradeId: string) => activeStudents.filter((student) => student.grade_id === gradeId).length;
  const gradeGroupCount = (gradeId: string) => visibleGroups.filter((group) => group.grade_id === gradeId).length;
  const scheduleConflicts = useMemo(() => findGroupConflicts(visibleGroups), [visibleGroups]);
  const draftConflicts = useMemo(() => {
    if (!open || !form.days.length || !form.start_time || !form.end_time) return [];
    return findGroupConflicts([...groups.filter((group) => group.id !== form.id), { id: '__draft__', name: form.name || 'المجموعة الحالية', days: form.days, start_time: form.start_time, end_time: form.end_time }]).filter((item) => item.aName === 'المجموعة الحالية' || item.bName === 'المجموعة الحالية');
  }, [open, form, groups]);

  const load = async () => {
    if (!centerId) return;
    setError(null);
    try {
      const [nextGroups, nextGrades, nextStudents, nextLinks] = await Promise.all([fetchGroups(centerId), fetchGrades(centerId), fetchStudents(centerId), fetchCenterStudentGroups(centerId)]);
      setGroups(nextGroups); setGrades(nextGrades); setStudents(nextStudents); setMemberLinks(nextLinks);
    } catch (err) { setError(err); }
  };
  useEffect(() => { void load(); }, [centerId]);

  const renameGrade = async () => {
    if (!editingGrade?.name.trim()) return;
    setError(null);
    try { await updateGrade(editingGrade.id, editingGrade.name); setEditingGrade(null); await load(); toast.success('تم تعديل الصف'); } catch (err) { setError(err); }
  };
  const removeGrade = async (id: string) => {
    if (!window.confirm('حذف الصف سيفك ارتباطه بالمجموعات والطلاب. هل تريد المتابعة؟')) return;
    setError(null); try { await deleteGrade(id); await load(); toast.success('تم حذف الصف'); } catch (err) { setError(err); }
  };
  const shiftGrade = async (id: string, direction: -1 | 1) => { setError(null); try { await moveGrade(id, direction); await load(); } catch (err) { setError(err); } };
  const change = (patch: Partial<typeof form>) => { setForm((value) => ({ ...value, ...patch })); setDirty(true); };
  const toggleDay = (day: string) => { setForm((value) => ({ ...value, days: value.days.includes(day) ? value.days.filter((item) => item !== day) : [...value.days, day] })); setDirty(true); };
  const addNew = (gradeId = '') => { setForm({ ...initial, grade_id: gradeId }); setDirty(false); setError(null); setOpen(true); };
  const edit = (group: Group) => { setForm({ id: group.id, name: group.name, teacher_name: group.teacher_name ?? '', teacher_phone: group.teacher_phone ?? '', grade_id: group.grade_id ?? '', start_time: group.start_time ?? '', end_time: group.end_time ?? '', monthly_fee: String(group.monthly_fee ?? 0), billing_type: group.billing_type ?? 'monthly', weekly_price: String(group.weekly_price ?? 0), session_price: String(group.session_price ?? 0), due_mode: group.due_mode ?? 'manual', attendance_due_amount: String(group.attendance_due_amount ?? 0), days: group.days ?? [] }); setDirty(false); setError(null); setOpen(true); };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); if (!centerId || !form.name.trim()) return setError(new Error('أدخل اسم المجموعة.'));
    setBusy(true); setError(null);
    try {
      if (!form.grade_id) throw new Error('اختر الصف المرتبط بالمجموعة.');
      if (form.due_mode === 'attendance' && Number(form.attendance_due_amount) <= 0) throw new Error('أدخل قيمة موجبة للاستحقاق عند الحضور.');
      await upsertGroup(centerId, { id: form.id || undefined, name: form.name, teacher_name: form.teacher_name, teacher_phone: form.teacher_phone || null, grade_id: form.grade_id, days: form.days, start_time: form.start_time, end_time: form.end_time, monthly_fee: Number(form.monthly_fee) || 0, billing_type: form.billing_type as BillingType, weekly_price: Number(form.weekly_price) || 0, session_price: Number(form.session_price) || 0, due_mode: form.due_mode as 'manual' | 'attendance', attendance_due_amount: Number(form.attendance_due_amount) || 0 });
      toast.success(form.id ? 'تم تحديث المجموعة' : 'تم إنشاء المجموعة', form.name); setForm(initial); setDirty(false); setOpen(false); await load();
    } catch (err) { setError(err); } finally { setBusy(false); }
  };
  const createGrade = async () => { if (!centerId || !newGrade.trim()) return; setError(null); try { await addGrade(centerId, newGrade); setNewGrade(''); await load(); toast.success('تمت إضافة الصف', newGrade); } catch (err) { setError(err); } };
  const removeGroup = async (id: string) => { if (!window.confirm('حذف المجموعة سيفك ارتباطها من الطلاب. هل تريد المتابعة؟')) return; setError(null); try { await deleteGroup(id); await load(); toast.success('تم حذف المجموعة'); } catch (err) { setError(err); } };
  const toggleGrade = (id: string) => setExpandedGrades((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  const groupPrice = (group: Group) => group.billing_type === 'weekly' ? group.weekly_price : group.billing_type === 'per_session' ? group.session_price : group.monthly_fee;
  const isGradeExpanded = (gradeId: string) => !!search.trim() || gradeFilter === gradeId || expandedGrades.includes(gradeId);

  const renderGroup = (group: Group) => <article className="grade-group-row" key={group.id}>
    <div className="grade-group-main"><span className="grade-group-icon">◈</span><div><strong>{group.name}</strong><div className="grade-group-meta"><span>👥 {groupStudentCount(group.id)} طالب</span><span>🗓 {group.days?.length ? formatDays(group.days) : 'لم تحدد أيام'}</span><span dir="ltr">◷ {group.start_time || '--:--'} — {group.end_time || '--:--'}</span></div></div></div>
    <div className="grade-group-side"><Badge tone={group.due_mode === 'attendance' ? 'success' : 'default'}>{group.due_mode === 'attendance' ? `بالحضور · ${formatMoney(Number(group.attendance_due_amount || 0))}` : 'استحقاق يدوي'}</Badge><span className="group-price">{formatMoney(Number(groupPrice(group) || 0))}<small> / {billingLabel(group.billing_type)}</small></span>{group.teacher_name ? <span className="tiny muted">المدرس: {group.teacher_name}</span> : null}{canManage ? <div className="row"><Button type="button" variant="ghost" onClick={() => edit(group)}>تعديل</Button><Button type="button" variant="ghost" onClick={() => void removeGroup(group.id)}>حذف</Button></div> : null}</div>
  </article>;

  return <>
    <PageHeader title="الصفوف والمجموعات" subtitle="أنشئ الصف أولاً، ثم مجموعاته وجدولها وأسعارها؛ كل مجموعة مرتبطة بصف واضح." actions={canManage ? <div className="row"><Button type="button" variant="secondary" onClick={() => setExpandedGrades(grades.map((grade) => grade.id))}>توسيع الكل</Button><Button type="button" onClick={() => addNew()}>+ إضافة مجموعة</Button></div> : undefined} />
    <ErrorNotice error={error} />
    <div className="grid grid-4 workspace-kpis" style={{ margin: '16px 0' }}><Card className="compact kpi workspace-stat purple"><span className="workspace-stat-icon">▦</span><span className="muted">الصفوف</span><div className="kpi-value">{grades.length}</div></Card><Card className="compact kpi workspace-stat blue"><span className="workspace-stat-icon">◈</span><span className="muted">المجموعات الظاهرة</span><div className="kpi-value">{visibleGroups.length}</div></Card><Card className="compact kpi workspace-stat green"><span className="workspace-stat-icon">👥</span><span className="muted">طلاب نشطون</span><div className="kpi-value">{activeStudents.length}</div></Card><Card className="compact kpi workspace-stat amber"><span className="workspace-stat-icon">!</span><span className="muted">تعارضات جدول</span><div className="kpi-value" style={{ color: scheduleConflicts.length ? 'var(--danger)' : 'var(--success)' }}>{scheduleConflicts.length}</div></Card></div>
    {scheduleConflicts.length ? <Notice tone="warn">يوجد تعارض في مواعيد بعض المجموعات: {scheduleConflicts.slice(0, 3).map((item) => `${item.aName} مع ${item.bName} (${item.days})`).join(' · ')}{scheduleConflicts.length > 3 ? '…' : ''}.</Notice> : null}

    <Card className="workspace-filters stack"><div className="workspace-filter-grid two"><Input label="بحث عن صف أو مجموعة أو مدرس" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="اكتب الاسم أو اليوم أو المدرس" /><Select label="الصف" value={gradeFilter} onChange={(event) => setGradeFilter(event.target.value)}><option value="all">كل الصفوف</option>{grades.map((grade) => <option key={grade.id} value={grade.id}>{grade.name}</option>)}</Select></div><div className="row-between"><span className="tiny muted">{filteredGroups.length} مجموعة مطابقة للبحث</span><Button type="button" variant="ghost" onClick={() => { setSearch(''); setGradeFilter('all'); }}>مسح الفلاتر</Button></div></Card>

    <section className="grade-workspace-list">
      {grades.filter((grade) => gradeFilter === 'all' || grade.id === gradeFilter || filteredGroups.some((group) => group.grade_id === grade.id)).map((grade, index) => {
        const gradeGroups = filteredGroups.filter((group) => group.grade_id === grade.id);
        const expanded = isGradeExpanded(grade.id);
        return <Card className={`grade-workspace-card ${expanded ? 'expanded' : ''}`} key={grade.id}><div className="grade-workspace-head" onClick={() => toggleGrade(grade.id)} role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') toggleGrade(grade.id); }}><div className="grade-workspace-title"><span className="grade-workspace-icon">▦</span><div>{editingGrade?.id === grade.id ? <div className="row" onClick={(event) => event.stopPropagation()}><Input label="اسم الصف" value={editingGrade.name} onChange={(event) => setEditingGrade({ id: grade.id, name: event.target.value })} /><Button type="button" variant="secondary" onClick={() => void renameGrade()}>حفظ</Button><Button type="button" variant="ghost" onClick={() => setEditingGrade(null)}>إلغاء</Button></div> : <><h2>{grade.name}</h2><p>{gradeGroupCount(grade.id)} مجموعة · {gradeStudentCount(grade.id)} طالب نشط · الترتيب {index + 1}</p></>}</div></div><div className="row" onClick={(event) => event.stopPropagation()}>{canManage && editingGrade?.id !== grade.id ? <><Button type="button" variant="ghost" disabled={index === 0} onClick={() => void shiftGrade(grade.id, -1)} title="نقل لأعلى">↑</Button><Button type="button" variant="ghost" disabled={index === grades.length - 1} onClick={() => void shiftGrade(grade.id, 1)} title="نقل لأسفل">↓</Button><Button type="button" variant="ghost" onClick={() => setEditingGrade({ id: grade.id, name: grade.name })}>تعديل</Button><Button type="button" variant="ghost" onClick={() => void removeGrade(grade.id)}>حذف</Button><Button type="button" variant="secondary" onClick={() => addNew(grade.id)}>+ مجموعة</Button></> : null}<span className="grade-chevron">{expanded ? '⌃' : '⌄'}</span></div></div>{expanded ? <div className="grade-workspace-body">{gradeGroups.length ? gradeGroups.map(renderGroup) : <EmptyState title={search || gradeFilter !== 'all' ? 'لا توجد مجموعات مطابقة' : 'لا توجد مجموعات في هذا الصف'} body={canManage ? 'أضف أول مجموعة للصف من الزر بالأعلى.' : 'ستظهر هنا المجموعات المسندة لك.'} action={canManage ? <Button type="button" onClick={() => addNew(grade.id)}>إضافة مجموعة</Button> : undefined} />}</div> : null}</Card>;
      })}
      {!grades.length ? <Card><EmptyState title="ابدأ بإضافة صف دراسي" body="بعدها أضف المجموعات التابعة له؛ لن تظهر مجموعة جديدة بلا صف." action={canManage ? <Button type="button" onClick={() => document.getElementById('new-grade-input')?.focus()}>إضافة صف</Button> : undefined} /></Card> : null}
    </section>

    {canManage ? <Card className="grade-quick-add"><div><h2 className="h3">صف جديد</h2><p className="muted small">أنشئ الصف ثم أضف له المجموعات. تستطيع تعديل الترتيب لاحقاً.</p></div><div className="row"><Input label="اسم الصف" id="new-grade-input" value={newGrade} onChange={(event) => setNewGrade(event.target.value)} placeholder="مثال: الصف الأول الثانوي" /><Button type="button" variant="secondary" onClick={() => void createGrade()}>إضافة الصف</Button></div></Card> : <Notice tone="info">يظهر لك فقط ما أُسند إليك من مجموعات. إنشاء الصفوف والمجموعات لصاحب السنتر.</Notice>}

    {canManage ? <Modal open={open} title={form.id ? 'تعديل المجموعة' : 'إضافة مجموعة جديدة'} subtitle="المجموعة ترتبط بصف محدد، ثم تضبط موعدها وتسعيرها وطريقة إنشاء الاستحقاق." dirty={dirty} onClose={() => setOpen(false)} onSave={() => void submit({ preventDefault: () => undefined } as React.FormEvent)} saveLabel={busy ? 'جارٍ الحفظ…' : 'حفظ المجموعة'} wide footer={<Button disabled={busy} type="submit" form="group-form">{busy ? 'جارٍ الحفظ…' : 'حفظ المجموعة'}</Button>}><form id="group-form" className="stack" onSubmit={submit}><div className="grid grid-2"><Input label="اسم المجموعة" value={form.name} onChange={(event) => change({ name: event.target.value })} required /><Select label="الصف المرتبط" value={form.grade_id} onChange={(event) => change({ grade_id: event.target.value })}><option value="">اختر الصف</option>{grades.map((grade) => <option key={grade.id} value={grade.id}>{grade.name}</option>)}</Select><Input label="اسم المدرس (للعرض)" value={form.teacher_name} onChange={(event) => change({ teacher_name: event.target.value })} /><Input label="رقم المدرس (للعرض)" value={form.teacher_phone} onChange={(event) => change({ teacher_phone: event.target.value })} /><Input label="بداية الحصة" type="time" value={form.start_time} onChange={(event) => change({ start_time: event.target.value })} /><Input label="نهاية الحصة" type="time" value={form.end_time} onChange={(event) => change({ end_time: event.target.value })} /><Select label="نظام الدفع" value={form.billing_type} onChange={(event) => change({ billing_type: event.target.value })}><option value="monthly">شهري</option><option value="weekly">أسبوعي</option><option value="per_session">بالحصة</option></Select><Input label="السعر الشهري" type="number" min="0" value={form.monthly_fee} onChange={(event) => change({ monthly_fee: event.target.value })} /><Input label="السعر الأسبوعي" type="number" min="0" value={form.weekly_price} onChange={(event) => change({ weekly_price: event.target.value })} /><Input label="سعر الحصة" type="number" min="0" value={form.session_price} onChange={(event) => change({ session_price: event.target.value })} /><Select label="إنشاء الاستحقاق" value={form.due_mode} onChange={(event) => change({ due_mode: event.target.value })}><option value="manual">يدوي من التحصيل</option><option value="attendance">تلقائي عند الحضور</option></Select>{form.due_mode === 'attendance' ? <Input label="قيمة الاستحقاق لكل حضور" type="number" min="0" value={form.attendance_due_amount} onChange={(event) => change({ attendance_due_amount: event.target.value })} /> : <div className="card compact soft"><strong>استحقاق يدوي</strong><p className="muted small">يُنشأ من صفحة التحصيل للفترة التي تختارها.</p></div>}</div><Notice tone="info">عند اختيار «تلقائي عند الحضور» يُنشأ استحقاق واحد لكل طالب حاضر أو متأخر في كل حصة، ويُخصم من رصيده المقدم تلقائياً.</Notice><div className="stack"><span className="label">أيام المجموعة</span><div className="row">{WEEK_DAYS.map((day) => <button className={`tab ${form.days.includes(day) ? 'active' : ''}`} type="button" key={day} onClick={() => toggleDay(day)}>{arabicDay(day)}</button>)}</div></div>{draftConflicts.length ? <Notice tone="warn">تنبيه تعارض: {draftConflicts.map((item) => `${item.aName === 'المجموعة الحالية' ? item.bName : item.aName} في ${item.days}`).join(' · ')}. راجع الجدول قبل الحفظ.</Notice> : null}<Notice tone="info">إسناد حساب المدرس وصلاحياته يتم من «فريق العمل». هذه الحقول تعرض بيانات المدرس مع المجموعة فقط.</Notice><ErrorNotice error={error} /></form></Modal> : null}
  </>;
}
