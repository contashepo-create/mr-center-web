'use client';

import { useEffect, useMemo, useState } from 'react';
import { Badge, Button, Card, EmptyState, ErrorNotice, Input, Notice, PageHeader, formatStatus } from '@/components/ui';
import { useSession } from '@/context/session';
import { deleteSurvey, fetchStudents, fetchSurveyResponses, fetchSurveys, toggleSurvey, upsertSurvey } from '@/lib/api';
import { can } from '@/lib/rbac';
import type { AppSurvey, AppSurveyResponse, Student } from '@/lib/types';
import { formatDate } from '@/lib/utils';

export default function AdminSurveysPage() {
  const { profile } = useSession();
  const centerId = profile?.center_id;
  const [rows, setRows] = useState<AppSurvey[]>([]);
  const [responses, setResponses] = useState<AppSurveyResponse[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [selected, setSelected] = useState<AppSurvey | null>(null);
  const [form, setForm] = useState({ id: '', title: '', questionsText: '', is_active: true });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [message, setMessage] = useState<string | null>(null);
  const studentName = useMemo(() => new Map(students.map((s) => [s.id, s.name])), [students]);

  const load = async () => { if (!centerId) return; setError(null); try { const [surveys, st] = await Promise.all([fetchSurveys(centerId), fetchStudents(centerId)]); setRows(surveys); setStudents(st); } catch (err) { setError(err); } };
  useEffect(() => { void load(); }, [centerId]);
  if (profile && !can(profile, 'surveys')) return <Card><Notice tone="error">ليس لديك صلاحية الاستبيانات.</Notice></Card>;

  const select = async (s: AppSurvey) => { setSelected(s); setForm({ id: s.id, title: s.title, questionsText: s.questions.join('\n'), is_active: s.is_active }); try { setResponses(await fetchSurveyResponses(s.id)); } catch (err) { setError(err); } };
  const submit = async (e: React.FormEvent) => { e.preventDefault(); if (!centerId) return; setBusy(true); setError(null); setMessage(null); try { await upsertSurvey(centerId, { id: form.id || undefined, title: form.title, questions: form.questionsText.split('\n').map((x) => x.trim()).filter(Boolean), is_active: form.is_active }); setForm({ id: '', title: '', questionsText: '', is_active: true }); setSelected(null); setResponses([]); setMessage('تم حفظ الاستبيان.'); await load(); } catch (err) { setError(err); } finally { setBusy(false); } };
  const remove = async (id: string) => { if (!confirm('حذف الاستبيان وإجاباته؟')) return; try { await deleteSurvey(id); await load(); if (selected?.id === id) { setSelected(null); setResponses([]); } } catch (err) { setError(err); } };

  return <>
    <PageHeader title="الاستبيانات" subtitle="إنشاء استبيانات ومتابعة إجابات الطلاب." />
    <ErrorNotice error={error} />{message ? <Notice tone="success">{message}</Notice> : null}
    <div className="grid grid-2">
      <Card className="stack"><h2 className="h3">{form.id ? 'تعديل استبيان' : 'استبيان جديد'}</h2><form className="stack" onSubmit={submit}><Input label="العنوان" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required /><label className="input-wrap"><span className="label">الأسئلة — كل سؤال في سطر</span><textarea className="textarea" value={form.questionsText} onChange={(e) => setForm({ ...form, questionsText: e.target.value })} required /></label><label className="row small muted"><input type="checkbox" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} /> نشط للطلاب</label><div className="row"><Button disabled={busy} type="submit">حفظ</Button>{form.id ? <Button type="button" variant="secondary" onClick={() => { setForm({ id: '', title: '', questionsText: '', is_active: true }); setSelected(null); setResponses([]); }}>جديد</Button> : null}</div></form></Card>
      <Card className="stack"><div className="row-between"><h2 className="h3">الاستبيانات</h2><Badge tone="info">{rows.length}</Badge></div>{rows.length === 0 ? <EmptyState title="لا توجد استبيانات" /> : rows.map((s) => { const st = formatStatus(s.is_active ? 'active' : 'suspended'); return <div key={s.id} className="card compact soft stack"><div className="row-between"><strong>{s.title}</strong><Badge tone={st.tone}>{s.is_active ? 'نشط' : 'موقوف'}</Badge></div><p className="muted tiny">{s.questions.length} أسئلة · {formatDate(s.created_at)}</p><div className="row"><Button type="button" variant="secondary" onClick={() => void select(s)}>النتائج/تعديل</Button><Button type="button" variant="secondary" onClick={async () => { await toggleSurvey(s.id, !s.is_active); await load(); }}>{s.is_active ? 'إيقاف' : 'تفعيل'}</Button><Button type="button" variant="danger" onClick={() => void remove(s.id)}>حذف</Button></div></div>; })}</Card>
    </div>
    {selected ? <Card className="stack" style={{ marginTop: 18 }}><div className="row-between"><h2 className="h3">نتائج: {selected.title}</h2><Badge tone="info">{responses.length} إجابة</Badge></div>{responses.length === 0 ? <EmptyState title="لا توجد إجابات" /> : <div className="table-wrap"><table><thead><tr><th>الطالب</th>{selected.questions.map((q, i) => <th key={i}>{q}</th>)}<th>التاريخ</th></tr></thead><tbody>{responses.map((r) => <tr key={r.id}><td>{studentName.get(r.student_id) ?? r.student_id}</td>{selected.questions.map((_, i) => <td key={i}>{r.answers[i] ?? '—'}</td>)}<td>{formatDate(r.created_at)}</td></tr>)}</tbody></table></div>}</Card> : null}
  </>;
}
