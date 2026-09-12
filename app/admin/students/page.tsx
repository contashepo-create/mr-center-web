'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { Badge, Button, Card, EmptyState, ErrorNotice, Input, Notice, PageHeader, Select, formatStatus } from '@/components/ui';
import { useSession } from '@/context/session';
import { deleteStudent, fetchGrades, fetchGroups, fetchStudents, upsertStudent } from '@/lib/api';
import type { Grade, Group, Student } from '@/lib/types';
import { isOwner, useTeacherGroupIds } from '@/lib/staff';
import { formatDate } from '@/lib/utils';

const initialForm = { id: '', name: '', phone: '', guardian_phone: '', grade_id: '', group_id: '', status: 'active', notes: '' };

export default function StudentsPage() {
  const { profile } = useSession();
  const centerId = profile?.center_id;
  const [students, setStudents] = useState<Student[]>([]);
  const [grades, setGrades] = useState<Grade[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [search, setSearch] = useState('');
  const [includeArchived, setIncludeArchived] = useState(false);
  const [form, setForm] = useState(initialForm);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [message, setMessage] = useState<string | null>(null);

  const teacherScope = useTeacherGroupIds();
  const canManage = isOwner(profile);
  const visibleGroups = useMemo(() => teacherScope ? groups.filter((g) => teacherScope.includes(g.id)) : groups, [groups, teacherScope]);
  const visibleStudents = useMemo(() => students
    .filter((s) => !teacherScope || (!!s.group_id && teacherScope.includes(s.group_id)))
    .sort((a, b) => a.name.localeCompare(b.name, 'ar')),
  [students, teacherScope]);
  const groupName = useMemo(() => new Map(groups.map((g) => [g.id, g.name])), [groups]);
  const gradeName = useMemo(() => new Map(grades.map((g) => [g.id, g.name])), [grades]);

  const load = async () => {
    if (!centerId) return;
    setError(null);
    try {
      const [s, g, gr] = await Promise.all([
        fetchStudents(centerId, search, includeArchived),
        fetchGrades(centerId),
        fetchGroups(centerId),
      ]);
      setStudents(s); setGrades(g); setGroups(gr);
    } catch (err) { setError(err); }
  };

  useEffect(() => { void load(); }, [centerId, includeArchived]);

  const edit = (s: Student) => setForm({
    id: s.id, name: s.name, phone: s.phone ?? '', guardian_phone: s.guardian_phone ?? '',
    grade_id: s.grade_id ?? '', group_id: s.group_id ?? '', status: s.status, notes: s.notes ?? '',
  });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!centerId) return;
    setBusy(true); setError(null); setMessage(null);
    try {
      await upsertStudent(centerId, {
        id: form.id || undefined,
        name: form.name,
        phone: form.phone || null,
        guardian_phone: form.guardian_phone || null,
        grade_id: form.grade_id || null,
        group_id: form.group_id || null,
        status: form.status as Student['status'],
        notes: form.notes || null,
      });
      setForm(initialForm);
      setMessage(form.id ? 'تم تحديث الطالب.' : 'تمت إضافة الطالب.');
      await load();
    } catch (err) { setError(err); }
    finally { setBusy(false); }
  };

  const remove = async (id: string) => {
    if (!confirm('هل تريد حذف الطالب؟')) return;
    setError(null);
    try { await deleteStudent(id); await load(); }
    catch (err) { setError(err); }
  };

  return (
    <>
      <PageHeader title="الطلاب" subtitle="إضافة وتعديل الطلاب على نفس جدول الطلاب المستخدم في التطبيق." />
      <ErrorNotice error={error} />
      {message ? <Notice tone="success">{message}</Notice> : null}

      <div className="grid grid-2">
        {canManage ? <Card className="stack">
          <h2 className="h3">{form.id ? 'تعديل طالب' : 'إضافة طالب'}</h2>
          <form className="stack" onSubmit={submit}>
            <Input label="اسم الطالب" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            <div className="grid grid-2">
              <Input label="رقم الطالب" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} dir="ltr" />
              <Input label="رقم ولي الأمر" value={form.guardian_phone} onChange={(e) => setForm({ ...form, guardian_phone: e.target.value })} dir="ltr" />
              <Select label="الصف" value={form.grade_id} onChange={(e) => setForm({ ...form, grade_id: e.target.value })}>
                <option value="">بدون</option>
                {grades.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
              </Select>
              <Select label="المجموعة الأساسية" value={form.group_id} onChange={(e) => setForm({ ...form, group_id: e.target.value })}>
                <option value="">بدون</option>
                {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
              </Select>
              <Select label="الحالة" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                <option value="active">نشط</option>
                <option value="suspended">موقوف</option>
                <option value="archived">مؤرشف</option>
              </Select>
            </div>
            <Input label="ملاحظات" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            <div className="row">
              <Button disabled={busy} type="submit">{busy ? 'جاري الحفظ...' : form.id ? 'حفظ التعديل' : 'إضافة الطالب'}</Button>
              {form.id ? <Button type="button" variant="secondary" onClick={() => setForm(initialForm)}>إلغاء</Button> : null}
            </div>
          </form>
        </Card> : <Card className="stack"><h2 className="h3">عرض الطلاب</h2><Notice>أنت داخل كحساب فريق عمل؛ الإضافة والتعديل والحذف متاحة لصاحب السنتر فقط، وسترى طلاب المجموعات المسندة لك.</Notice></Card>}

        <Card className="stack">
          <h2 className="h3">بحث وفلاتر</h2>
          <div className="row">
            <Input label="بحث بالاسم/الهاتف/البريد" value={search} onChange={(e) => setSearch(e.target.value)} />
            <Button type="button" variant="secondary" onClick={() => void load()}>بحث</Button>
          </div>
          <label className="row small muted"><input type="checkbox" checked={includeArchived} onChange={(e) => setIncludeArchived(e.target.checked)} /> إظهار المؤرشف</label>
          <div className="notice">يعرض حالياً {visibleStudents.length} طالب{teacherScope ? ' داخل مجموعاتك المسندة' : ''}.</div>
          {teacherScope ? <div className="row">{visibleGroups.map((g) => <Badge key={g.id} tone="info">{g.name}</Badge>)}</div> : null}
        </Card>
      </div>

      <Card className="stack" style={{ marginTop: 18 }}>
        <div className="row-between"><h2 className="h3">قائمة الطلاب</h2><Badge tone="info">{visibleStudents.length}</Badge></div>
        {visibleStudents.length === 0 ? <EmptyState title="لا يوجد طلاب" body={teacherScope ? 'لم تُسند لك مجموعات بها طلاب بعد.' : 'أضف أول طالب أو سجل الطلاب من شاشة التسجيل بالكود.'} /> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>الطالب</th><th>الهاتف</th><th>الصف</th><th>المجموعة</th><th>الحالة</th><th>أضيف في</th><th>إجراءات</th></tr></thead>
              <tbody>
                {visibleStudents.map((s) => {
                  const st = formatStatus(s.status);
                  return <tr key={s.id}>
                    <td><Link href={`/admin/students/${s.id}`}><strong>{s.name}</strong></Link><div className="tiny muted">{s.email}</div></td>
                    <td dir="ltr">{s.phone ?? '—'}<div className="tiny muted" dir="ltr">ولي: {s.guardian_phone ?? '—'}</div></td>
                    <td>{s.grade_id ? gradeName.get(s.grade_id) ?? '—' : '—'}</td>
                    <td>{s.group_id ? groupName.get(s.group_id) ?? '—' : '—'}</td>
                    <td><Badge tone={st.tone}>{st.text}</Badge></td>
                    <td>{formatDate(s.created_at)}</td>
                    <td>{canManage ? <div className="row"><Button type="button" variant="secondary" onClick={() => edit(s)}>تعديل</Button><Button type="button" variant="danger" onClick={() => void remove(s.id)}>حذف</Button></div> : <Link className="btn secondary" href={`/admin/students/${s.id}`}>فتح</Link>}</td>
                  </tr>;
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
