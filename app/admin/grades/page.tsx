'use client';

import { useEffect, useMemo, useState } from 'react';
import { Badge, Button, Card, EmptyState, ErrorNotice, Input, Notice, PageHeader, Select } from '@/components/ui';
import { useSession } from '@/context/session';
import { addManualGrade, deleteManualGrade, fetchGroups, fetchManualGradesForMonth, fetchStudents } from '@/lib/api';
import type { Group, ManualGrade, Student } from '@/lib/types';
import { can } from '@/lib/rbac';
import { arabicMonth, formatDate } from '@/lib/utils';

export default function GradesPage() {
  const { profile } = useSession();
  const centerId = profile?.center_id;
  const now = new Date();
  const [month, setMonth] = useState(String(now.getMonth() + 1));
  const [year, setYear] = useState(String(now.getFullYear()));
  const [students, setStudents] = useState<Student[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [rows, setRows] = useState<ManualGrade[]>([]);
  const [form, setForm] = useState({ studentId: '', title: '', score: '', maxScore: '10', notes: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [message, setMessage] = useState<string | null>(null);
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

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); if (!centerId || !form.studentId) return;
    setBusy(true); setError(null); setMessage(null);
    try {
      await addManualGrade({ centerId, studentId: form.studentId, title: form.title, score: Number(form.score), maxScore: Number(form.maxScore), month: Number(month), year: Number(year), notes: form.notes });
      setForm({ ...form, title: '', score: '', notes: '' });
      setMessage('تم حفظ الدرجة. ستظهر للطالب في التطبيق والويب.');
      await load();
    } catch (err) { setError(err); }
    finally { setBusy(false); }
  };

  const remove = async (id: string) => {
    if (!confirm('حذف الدرجة؟')) return;
    try { await deleteManualGrade(id); await load(); } catch (err) { setError(err); }
  };

  if (profile && !can(profile, 'grades')) {
    return <Card><Notice tone="error">ليس لديك صلاحية الدرجات والتقييم.</Notice></Card>;
  }

  return (
    <>
      <PageHeader title="الدرجات اليدوية" subtitle="إضافة درجات شهرية للطلاب تظهر فوراً في حساب الطالب." />
      <ErrorNotice error={error} />
      {message ? <Notice tone="success">{message}</Notice> : null}

      <div className="grid grid-2">
        <Card className="stack">
          <h2 className="h3">إضافة درجة</h2>
          <form className="stack" onSubmit={submit}>
            <div className="grid grid-2">
              <Select label="الطالب" value={form.studentId} onChange={(e) => setForm({ ...form, studentId: e.target.value })}>{students.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>
              <Input label="عنوان التقييم" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="اختبار شهر سبتمبر" />
              <Input label="الدرجة" type="number" value={form.score} onChange={(e) => setForm({ ...form, score: e.target.value })} />
              <Input label="من" type="number" value={form.maxScore} onChange={(e) => setForm({ ...form, maxScore: e.target.value })} />
              <Input label="ملاحظات" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </div>
            <Button disabled={busy || !form.studentId} type="submit">حفظ الدرجة</Button>
          </form>
        </Card>
        <Card className="stack">
          <h2 className="h3">الفترة</h2>
          <div className="grid grid-2">
            <Select label="الشهر" value={month} onChange={(e) => setMonth(e.target.value)}>{Array.from({ length: 12 }, (_, i) => <option key={i + 1} value={i + 1}>{arabicMonth(i + 1)}</option>)}</Select>
            <Input label="السنة" type="number" value={year} onChange={(e) => setYear(e.target.value)} />
          </div>
          <div className="notice">عدد الدرجات في هذه الفترة: {rows.length}</div>
        </Card>
      </div>

      <Card className="stack" style={{ marginTop: 18 }}>
        <div className="row-between"><h2 className="h3">سجل الدرجات</h2><Badge tone="info">{rows.length}</Badge></div>
        {rows.length === 0 ? <EmptyState title="لا توجد درجات" /> : <div className="table-wrap"><table><thead><tr><th>الطالب</th><th>المجموعة</th><th>التقييم</th><th>النتيجة</th><th>التاريخ</th><th>إجراءات</th></tr></thead><tbody>
          {rows.map((r) => <tr key={r.id}><td>{studentsMap.get(r.student_id)?.name ?? '—'}</td><td>{r.group_id ? groupsMap.get(r.group_id)?.name ?? '—' : '—'}</td><td>{r.title}</td><td><strong>{r.score}</strong> / {r.max_score}</td><td>{formatDate(r.created_at)}</td><td><Button type="button" variant="danger" onClick={() => void remove(r.id)}>حذف</Button></td></tr>)}
        </tbody></table></div>}
      </Card>
    </>
  );
}
