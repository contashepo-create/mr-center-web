'use client';

import { useEffect, useMemo, useState } from 'react';
import { Badge, Button, Card, EmptyState, ErrorNotice, Input, Notice, PageHeader, Select } from '@/components/ui';
import { Modal } from '@/components/modal';
import { useToast } from '@/components/toast';
import { useSession } from '@/context/session';
import { addManualGrade, deleteManualGrade, fetchGroups, fetchManualGradesForMonth, fetchStudents } from '@/lib/api';
import type { Group, ManualGrade, Student } from '@/lib/types';
import { can } from '@/lib/rbac';
import { arabicMonth, formatDate } from '@/lib/utils';

const initialForm = { studentId: '', title: '', score: '', maxScore: '10', notes: '' };

export default function GradesPage() {
  const { profile } = useSession();
  const toast = useToast();
  const centerId = profile?.center_id;
  const now = new Date();
  const [month, setMonth] = useState(String(now.getMonth() + 1));
  const [year, setYear] = useState(String(now.getFullYear()));
  const [students, setStudents] = useState<Student[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [rows, setRows] = useState<ManualGrade[]>([]);
  const [form, setForm] = useState(initialForm);
  const [open, setOpen] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const studentsMap = useMemo(() => new Map(students.map((s) => [s.id, s])), [students]);
  const groupsMap = useMemo(() => new Map(groups.map((g) => [g.id, g])), [groups]);

  const load = async () => {
    if (!centerId) return;
    setError(null);
    try {
      const [s, g, r] = await Promise.all([fetchStudents(centerId), fetchGroups(centerId), fetchManualGradesForMonth(centerId, Number(month), Number(year))]);
      setStudents(s); setGroups(g); setRows(r);
      if (!form.studentId && s[0]) setForm((f) => ({ ...f, studentId: s[0].id }));
    } catch (err) { setError(err); }
  };
  useEffect(() => { void load(); }, [centerId, month, year]);

  const change = (patch: Partial<typeof form>) => { setForm((f) => ({ ...f, ...patch })); setDirty(true); };
  const addNew = () => {
    setForm({ ...initialForm, studentId: students[0]?.id ?? '' });
    setDirty(false); setError(null); setOpen(true);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); if (!centerId || !form.studentId) return;
    setBusy(true); setError(null);
    try {
      await addManualGrade({ centerId, studentId: form.studentId, title: form.title, score: Number(form.score), maxScore: Number(form.maxScore), month: Number(month), year: Number(year), notes: form.notes });
      toast.success('تم حفظ الدرجة', 'ستظهر للطالب في التطبيق والويب.');
      setForm({ ...form, title: '', score: '', notes: '' });
      setDirty(false); setOpen(false); await load();
    } catch (err) { setError(err); }
    finally { setBusy(false); }
  };

  const remove = async (id: string) => {
    if (!confirm('حذف الدرجة؟')) return;
    try { await deleteManualGrade(id); await load(); toast.success('تم حذف الدرجة'); } catch (err) { setError(err); }
  };

  if (profile && !can(profile, 'grades')) {
    return <Card><Notice tone="error">ليس لديك صلاحية الدرجات والتقييم.</Notice></Card>;
  }

  return (
    <>
      <PageHeader title="الدرجات اليدوية" subtitle="إضافة درجات شهرية للطلاب تظهر فوراً في حساب الطالب." actions={<Button type="button" onClick={addNew}>+ إضافة درجة</Button>} />
      <ErrorNotice error={error} />

      <div className="grid grid-2">
        <Card className="stack">
          <h2 className="h3">الفترة</h2>
          <div className="grid grid-2">
            <Select label="الشهر" value={month} onChange={(e) => setMonth(e.target.value)}>{Array.from({ length: 12 }, (_, i) => <option key={i + 1} value={i + 1}>{arabicMonth(i + 1)}</option>)}</Select>
            <Input label="السنة" type="number" value={year} onChange={(e) => setYear(e.target.value)} />
          </div>
          <div className="notice">عدد الدرجات في هذه الفترة: {rows.length}</div>
        </Card>
        <Card className="stack">
          <h2 className="h3">إضافة درجة</h2>
          <div className="notice">اضغط «+ إضافة درجة» أعلى الصفحة لفتح نموذج منبثق لإدخال تقييم جديد لطالب في هذه الفترة.</div>
        </Card>
      </div>

      <Card className="stack" style={{ marginTop: 18 }}>
        <div className="row-between"><h2 className="h3">سجل الدرجات</h2><Badge tone="info">{rows.length}</Badge></div>
        {rows.length === 0 ? <EmptyState title="لا توجد درجات" /> : <div className="table-wrap"><table><thead><tr><th>الطالب</th><th>المجموعة</th><th>التقييم</th><th>النتيجة</th><th>التاريخ</th><th>إجراءات</th></tr></thead><tbody>
          {rows.map((r) => <tr key={r.id}><td>{studentsMap.get(r.student_id)?.name ?? '—'}</td><td>{r.group_id ? groupsMap.get(r.group_id)?.name ?? '—' : '—'}</td><td>{r.title}</td><td><strong>{r.score}</strong> / {r.max_score}</td><td>{formatDate(r.created_at)}</td><td><Button type="button" variant="danger" onClick={() => void remove(r.id)}>حذف</Button></td></tr>)}
        </tbody></table></div>}
      </Card>

      <Modal
        open={open}
        title="إضافة درجة"
        subtitle={`${studentsMap.get(form.studentId)?.name ?? ''} · ${arabicMonth(Number(month))} ${year}`}
        dirty={dirty}
        onClose={() => setOpen(false)}
        onSave={() => void submit({ preventDefault: () => {} } as React.FormEvent)}
        saveLabel={busy ? 'جاري الحفظ...' : 'حفظ الدرجة'}
        footer={<Button disabled={busy || !form.studentId} type="submit" form="grade-form">{busy ? 'جاري الحفظ...' : 'حفظ الدرجة'}</Button>}
      >
        <form id="grade-form" className="stack" onSubmit={submit}>
          <Select label="الطالب" value={form.studentId} onChange={(e) => change({ studentId: e.target.value })}>{students.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>
          <div className="grid grid-2">
            <Input label="عنوان التقييم" value={form.title} onChange={(e) => change({ title: e.target.value })} placeholder="اختبار شهر سبتمبر" />
            <Input label="الدرجة" type="number" value={form.score} onChange={(e) => change({ score: e.target.value })} />
            <Input label="من" type="number" value={form.maxScore} onChange={(e) => change({ maxScore: e.target.value })} />
            <Input label="ملاحظات" value={form.notes} onChange={(e) => change({ notes: e.target.value })} />
          </div>
          <ErrorNotice error={error} />
        </form>
      </Modal>
    </>
  );
}
