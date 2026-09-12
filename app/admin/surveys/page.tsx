'use client';

import { useEffect, useMemo, useState } from 'react';
import { Badge, Button, Card, EmptyState, ErrorNotice, Input, Notice, PageHeader, formatStatus } from '@/components/ui';
import { Modal } from '@/components/modal';
import { useToast } from '@/components/toast';
import { useSession } from '@/context/session';
import { deleteSurvey, fetchStudents, fetchSurveyResponses, fetchSurveys, toggleSurvey, upsertSurvey } from '@/lib/api';
import { can } from '@/lib/rbac';
import type { AppSurvey, AppSurveyResponse, Student } from '@/lib/types';
import { formatDate } from '@/lib/utils';

const initialForm = { id: '', title: '', questionsText: '', is_active: true };

export default function AdminSurveysPage() {
  const { profile } = useSession();
  const toast = useToast();
  const centerId = profile?.center_id;
  const [rows, setRows] = useState<AppSurvey[]>([]);
  const [responses, setResponses] = useState<AppSurveyResponse[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [selected, setSelected] = useState<AppSurvey | null>(null);
  const [form, setForm] = useState(initialForm);
  const [open, setOpen] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const studentName = useMemo(() => new Map(students.map((s) => [s.id, s.name])), [students]);

  const load = async () => { if (!centerId) return; setError(null); try { const [surveys, st] = await Promise.all([fetchSurveys(centerId), fetchStudents(centerId)]); setRows(surveys); setStudents(st); } catch (err) { setError(err); } };
  useEffect(() => { void load(); }, [centerId]);
  if (profile && !can(profile, 'surveys')) return <Card><Notice tone="error">ليس لديك صلاحية الاستبيانات.</Notice></Card>;

  const openNew = () => { setForm(initialForm); setDirty(false); setError(null); setOpen(true); };
  const openEdit = async (s: AppSurvey) => {
    setForm({ id: s.id, title: s.title, questionsText: s.questions.join('\n'), is_active: s.is_active });
    setDirty(false); setError(null); setOpen(true);
    setSelected(s);
    try { setResponses(await fetchSurveyResponses(s.id)); } catch (err) { setError(err); }
  };
  const change = (patch: Partial<typeof form>) => { setForm((f) => ({ ...f, ...patch })); setDirty(true); };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); if (!centerId) return;
    setBusy(true); setError(null);
    try {
      await upsertSurvey(centerId, { id: form.id || undefined, title: form.title, questions: form.questionsText.split('\n').map((x) => x.trim()).filter(Boolean), is_active: form.is_active });
      toast.success('تم حفظ الاستبيان', form.id ? 'تم تحديث الاستبيان.' : 'أصبح متاحاً للطلاب.');
      setDirty(false); setOpen(false); setForm(initialForm); setSelected(null); setResponses([]); await load();
    } catch (err) { setError(err); }
    finally { setBusy(false); }
  };
  const remove = async (id: string) => { if (!confirm('حذف الاستبيان وإجاباته؟')) return; try { await deleteSurvey(id); await load(); toast.success('تم حذف الاستبيان'); if (selected?.id === id) { setSelected(null); setResponses([]); } } catch (err) { setError(err); } };

  return <>
    <PageHeader
      title="الاستبيانات"
      subtitle="إنشاء استبيانات ومتابعة إجابات الطلاب."
      actions={<Button type="button" onClick={openNew}>+ استبيان جديد</Button>}
    />
    <ErrorNotice error={error} />
    <Card className="stack">
      <div className="row-between"><h2 className="h3">الاستبيانات</h2><Badge tone="info">{rows.length}</Badge></div>
      {rows.length === 0 ? <EmptyState title="لا توجد استبيانات" /> : rows.map((s) => { const st = formatStatus(s.is_active ? 'active' : 'suspended'); return <div key={s.id} className="card compact soft stack"><div className="row-between"><strong>{s.title}</strong><Badge tone={st.tone}>{s.is_active ? 'نشط' : 'موقوف'}</Badge></div><p className="muted tiny">{s.questions.length} أسئلة · {formatDate(s.created_at)}</p><div className="row"><Button type="button" variant="secondary" onClick={() => void openEdit(s)}>النتائج/تعديل</Button><Button type="button" variant="secondary" onClick={async () => { await toggleSurvey(s.id, !s.is_active); await load(); toast.success(s.is_active ? 'تم إيقاف الاستبيان' : 'تم تفعيل الاستبيان'); }}>{s.is_active ? 'إيقاف' : 'تفعيل'}</Button><Button type="button" variant="danger" onClick={() => void remove(s.id)}>حذف</Button></div></div>; })}
    </Card>
    {selected ? <Card className="stack" style={{ marginTop: 18 }}><div className="row-between"><h2 className="h3">نتائج: {selected.title}</h2><Badge tone="info">{responses.length} إجابة</Badge></div>{responses.length === 0 ? <EmptyState title="لا توجد إجابات" /> : <div className="table-wrap"><table><thead><tr><th>الطالب</th>{selected.questions.map((q, i) => <th key={i}>{q}</th>)}<th>التاريخ</th></tr></thead><tbody>{responses.map((r) => <tr key={r.id}><td>{studentName.get(r.student_id) ?? r.student_id}</td>{selected.questions.map((_, i) => <td key={i}>{r.answers[i] ?? '—'}</td>)}<td>{formatDate(r.created_at)}</td></tr>)}</tbody></table></div>}</Card> : null}

    <Modal
      open={open}
      title={form.id ? 'تعديل استبيان' : 'استبيان جديد'}
      dirty={dirty}
      onClose={() => setOpen(false)}
      onSave={() => void submit({ preventDefault: () => {} } as React.FormEvent)}
      saveLabel={busy ? 'جاري الحفظ...' : 'حفظ'}
      footer={<Button disabled={busy} type="submit" form="survey-form">{busy ? 'جاري الحفظ...' : 'حفظ'}</Button>}
    >
      <form id="survey-form" className="stack" onSubmit={submit}>
        <Input label="العنوان" value={form.title} onChange={(e) => change({ title: e.target.value })} required />
        <label className="input-wrap"><span className="label">الأسئلة — كل سؤال في سطر</span><textarea className="textarea" value={form.questionsText} onChange={(e) => change({ questionsText: e.target.value })} required /></label>
        <label className="row small muted"><input type="checkbox" checked={form.is_active} onChange={(e) => change({ is_active: e.target.checked })} /> نشط للطلاب</label>
        <ErrorNotice error={error} />
      </form>
    </Modal>
  </>;
}
