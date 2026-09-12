'use client';

import { useEffect, useMemo, useState } from 'react';
import { Badge, Button, Card, EmptyState, ErrorNotice, Input, Notice, PageHeader, Select, formatStatus } from '@/components/ui';
import { Modal } from '@/components/modal';
import { useToast } from '@/components/toast';
import { useSession } from '@/context/session';
import { addGrade, deleteGrade, deleteGroup, fetchGrades, fetchGroups, fetchStudents, moveGrade, updateGrade, upsertGroup } from '@/lib/api';
import type { BillingType, Grade, Group, Student } from '@/lib/types';
import { isOwner, useTeacherGroupIds } from '@/lib/staff';
import { WEEK_DAYS, arabicDay, billingLabel, formatDays, formatMoney } from '@/lib/utils';

const initial = {
  id: '', name: '', teacher_name: '', teacher_phone: '', grade_id: '', start_time: '', end_time: '',
  monthly_fee: '0', billing_type: 'monthly', weekly_price: '0', session_price: '0', days: [] as string[],
};

export default function GroupsPage() {
  const { profile } = useSession();
  const toast = useToast();
  const centerId = profile?.center_id;
  const [groups, setGroups] = useState<Group[]>([]);
  const [grades, setGrades] = useState<Grade[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [newGrade, setNewGrade] = useState('');
  const [editingGrade, setEditingGrade] = useState<{ id: string; name: string } | null>(null);
  const [form, setForm] = useState(initial);
  const [open, setOpen] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const teacherScope = useTeacherGroupIds();
  const canManage = isOwner(profile);
  const visibleGroups = useMemo(() => teacherScope ? groups.filter((g) => teacherScope.includes(g.id)) : groups, [groups, teacherScope]);

  const load = async () => {
    if (!centerId) return;
    setError(null);
    try { const [g, gr, st] = await Promise.all([fetchGrades(centerId), fetchGroups(centerId), fetchStudents(centerId)]); setGrades(g); setGroups(gr); setStudents(st); }
    catch (err) { setError(err); }
  };
  useEffect(() => { void load(); }, [centerId]);

  const gradeStudentCount = (id: string) => students.filter((s) => s.grade_id === id && s.status === 'active').length;
  const gradeGroupCount = (id: string) => groups.filter((g) => g.grade_id === id).length;

  const renameGrade = async () => {
    if (!editingGrade || !editingGrade.name.trim()) return;
    setError(null);
    try { await updateGrade(editingGrade.id, editingGrade.name); setEditingGrade(null); await load(); toast.success('تم تعديل الصف'); }
    catch (err) { setError(err); }
  };

  const removeGrade = async (id: string) => {
    if (!confirm('حذف الصف سيفك ارتباطه بالمجموعات والطلاب. هل تريد المتابعة؟')) return;
    setError(null);
    try { await deleteGrade(id); await load(); toast.success('تم حذف الصف'); } catch (err) { setError(err); }
  };

  const shiftGrade = async (id: string, dir: -1 | 1) => {
    setError(null);
    try { await moveGrade(id, dir); await load(); } catch (err) { setError(err); }
  };

  const change = (patch: Partial<typeof form>) => { setForm((f) => ({ ...f, ...patch })); setDirty(true); };
  const toggleDay = (day: string) => setForm((f) => ({ ...f, days: f.days.includes(day) ? f.days.filter((d) => d !== day) : [...f.days, day] }));
  const addNew = () => { setForm(initial); setDirty(false); setError(null); setOpen(true); };
  const edit = (g: Group) => {
    setForm({
      id: g.id, name: g.name, teacher_name: g.teacher_name ?? '', teacher_phone: g.teacher_phone ?? '', grade_id: g.grade_id ?? '',
      start_time: g.start_time ?? '', end_time: g.end_time ?? '', monthly_fee: String(g.monthly_fee ?? 0),
      billing_type: g.billing_type ?? 'monthly', weekly_price: String(g.weekly_price ?? 0), session_price: String(g.session_price ?? 0), days: g.days ?? [],
    });
    setDirty(false); setError(null); setOpen(true);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); if (!centerId) return;
    setBusy(true); setError(null);
    try {
      await upsertGroup(centerId, {
        id: form.id || undefined,
        name: form.name,
        teacher_name: form.teacher_name,
        teacher_phone: form.teacher_phone || null,
        grade_id: form.grade_id || null,
        days: form.days,
        start_time: form.start_time,
        end_time: form.end_time,
        monthly_fee: Number(form.monthly_fee) || 0,
        billing_type: form.billing_type as BillingType,
        weekly_price: Number(form.weekly_price) || 0,
        session_price: Number(form.session_price) || 0,
      });
      toast.success(form.id ? 'تم تحديث المجموعة' : 'تم إنشاء المجموعة', form.name);
      setForm(initial); setDirty(false); setOpen(false); await load();
    } catch (err) { setError(err); }
    finally { setBusy(false); }
  };

  const createGrade = async () => {
    if (!centerId || !newGrade.trim()) return;
    setError(null);
    try { await addGrade(centerId, newGrade); setNewGrade(''); await load(); toast.success('تمت إضافة الصف', newGrade); }
    catch (err) { setError(err); }
  };

  const removeGroup = async (id: string) => {
    if (!confirm('حذف المجموعة سيفك ارتباطها من الطلاب. هل تريد المتابعة؟')) return;
    setError(null); try { await deleteGroup(id); await load(); toast.success('تم حذف المجموعة'); } catch (err) { setError(err); }
  };

  return (
    <>
      <PageHeader title="المجموعات والصفوف" subtitle="إدارة صفوف ومجموعات السنتر بنفس الجداول المستخدمة في التطبيق." actions={canManage ? <Button type="button" onClick={addNew}>+ إضافة مجموعة</Button> : undefined} />
      <ErrorNotice error={error} />

      <div className="grid grid-2">
        <Card className="stack">
          <div className="row-between"><h2 className="h3">المراحل الدراسية</h2><Badge tone="info">{grades.length}</Badge></div>
          <div className="row"><Input label="مرحلة جديدة" value={newGrade} onChange={(e) => setNewGrade(e.target.value)} placeholder="مثال: الصف الأول الثانوي" /><Button type="button" variant="secondary" onClick={createGrade}>إضافة</Button></div>
          {grades.length === 0 ? <span className="muted small">لا توجد مراحل بعد</span> : (
            <div className="stack" style={{ gap: 6 }}>
              {grades.map((g, i) => (
                <div key={g.id} className="card compact soft row-between">
                  {editingGrade?.id === g.id ? (
                    <div className="row" style={{ flex: 1 }}>
                      <Input label="" value={editingGrade.name} onChange={(e) => setEditingGrade({ id: g.id, name: e.target.value })} />
                      <Button type="button" variant="secondary" onClick={renameGrade}>حفظ</Button>
                      <Button type="button" variant="ghost" onClick={() => setEditingGrade(null)}>إلغاء</Button>
                    </div>
                  ) : (
                    <>
                      <span><strong>{g.name}</strong> <span className="tiny muted">· {gradeStudentCount(g.id)} طالب · {gradeGroupCount(g.id)} مجموعة</span></span>
                      {canManage ? <span className="row" style={{ gap: 4 }}>
                        <Button type="button" variant="ghost" onClick={() => void shiftGrade(g.id, -1)} disabled={i === 0} title="أعلى">↑</Button>
                        <Button type="button" variant="ghost" onClick={() => void shiftGrade(g.id, 1)} disabled={i === grades.length - 1} title="أسفل">↓</Button>
                        <Button type="button" variant="ghost" onClick={() => setEditingGrade({ id: g.id, name: g.name })} title="تعديل">✎</Button>
                        <Button type="button" variant="ghost" onClick={() => void removeGrade(g.id)} title="حذف">✕</Button>
                      </span> : null}
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
          <Notice tone="warn">المدرس يُعيَّن للمجموعة من شاشة «فريق العمل» (تفعيل الحساب + إسناد المجموعات) — لا يُختار من هنا.</Notice>
        </Card>

        {!canManage ? <Card className="stack"><h2 className="h3">عرض المجموعات</h2><Notice>حساب فريق العمل يشاهد المجموعات المسندة له فقط؛ إنشاء وتعديل الصفوف والمجموعات لصاحب السنتر.</Notice></Card> : <Card className="stack"><h2 className="h3">إدارة المجموعات</h2><div className="notice">اضغط «+ إضافة مجموعة» أعلى الصفحة أو «تعديل» بجوار أي مجموعة في القائمة بالأسفل — سيُفتح نموذج منبثق لا يُغلق بالخطأ إلا بعد حفظ أو تجاهل تعديلاتك.</div></Card>}
      </div>

      <Card className="stack" style={{ marginTop: 18 }}>
        <div className="row-between"><h2 className="h3">قائمة المجموعات</h2><Badge tone="info">{visibleGroups.length}</Badge></div>
        {visibleGroups.length === 0 ? <EmptyState title="لا توجد مجموعات" body={teacherScope ? 'لم تُسند لك مجموعات بعد.' : 'ابدأ بإضافة صف ومجموعة للطلاب.'} /> : (
          <div className="table-wrap"><table><thead><tr><th>المجموعة</th><th>المدرس</th><th>المواعيد</th><th>الدفع</th><th>الطلاب</th><th>إجراءات</th></tr></thead><tbody>
            {visibleGroups.map((g) => {
              const status = formatStatus('active');
              const price = g.billing_type === 'weekly' ? g.weekly_price : g.billing_type === 'per_session' ? g.session_price : g.monthly_fee;
              return <tr key={g.id}>
                <td><strong>{g.name}</strong><div className="tiny muted">{grades.find((x) => x.id === g.grade_id)?.name ?? 'بدون صف'}</div></td>
                <td>{g.teacher_name || '—'}<div className="tiny muted" dir="ltr">{g.teacher_phone || ''}</div></td>
                <td>{formatDays(g.days ?? [])}<div className="tiny muted" dir="ltr">{g.start_time || '--:--'} → {g.end_time || '--:--'}</div></td>
                <td><Badge tone={status.tone}>{billingLabel(g.billing_type)}</Badge><div className="tiny muted">{formatMoney(Number(price || 0))}</div></td>
                <td>{g.students_count ?? 0}</td>
                <td>{canManage ? <div className="row"><Button type="button" variant="secondary" onClick={() => edit(g)}>تعديل</Button><Button type="button" variant="danger" onClick={() => void removeGroup(g.id)}>حذف</Button></div> : <span className="muted small">عرض فقط</span>}</td>
              </tr>;
            })}
          </tbody></table></div>
        )}
      </Card>

      {canManage ? (
        <Modal
          open={open}
          title={form.id ? 'تعديل مجموعة' : 'إضافة مجموعة'}
          subtitle={form.name || 'بيانات المجموعة الجديدة'}
          dirty={dirty}
          onClose={() => setOpen(false)}
          onSave={() => void submit({ preventDefault: () => {} } as React.FormEvent)}
          saveLabel={busy ? 'جاري الحفظ...' : 'حفظ المجموعة'}
          wide
          footer={<Button disabled={busy} type="submit" form="group-form">{busy ? 'جاري الحفظ...' : 'حفظ المجموعة'}</Button>}
        >
          <form id="group-form" className="stack" onSubmit={submit}>
            <div className="grid grid-2">
              <Input label="اسم المجموعة" value={form.name} onChange={(e) => change({ name: e.target.value })} required />
              <Select label="الصف" value={form.grade_id} onChange={(e) => change({ grade_id: e.target.value })}>
                <option value="">بدون</option>
                {grades.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
              </Select>
              <Input label="بداية الحصة" type="time" value={form.start_time} onChange={(e) => change({ start_time: e.target.value })} />
              <Input label="نهاية الحصة" type="time" value={form.end_time} onChange={(e) => change({ end_time: e.target.value })} />
              <Select label="نظام الدفع" value={form.billing_type} onChange={(e) => change({ billing_type: e.target.value })}>
                <option value="monthly">شهري</option>
                <option value="weekly">أسبوعي</option>
                <option value="per_session">بالحصة</option>
              </Select>
              <Input label="السعر الشهري" type="number" value={form.monthly_fee} onChange={(e) => change({ monthly_fee: e.target.value })} />
              <Input label="السعر الأسبوعي" type="number" value={form.weekly_price} onChange={(e) => change({ weekly_price: e.target.value })} />
              <Input label="سعر الحصة" type="number" value={form.session_price} onChange={(e) => change({ session_price: e.target.value })} />
            </div>
            <div className="stack">
              <span className="label">الأيام</span>
              <div className="row">
                {WEEK_DAYS.map((day) => <button className={`tab ${form.days.includes(day) ? 'active' : ''}`} type="button" key={day} onClick={() => toggleDay(day)}>{arabicDay(day)}</button>)}
              </div>
            </div>
            <ErrorNotice error={error} />
          </form>
        </Modal>
      ) : null}
    </>
  );
}
