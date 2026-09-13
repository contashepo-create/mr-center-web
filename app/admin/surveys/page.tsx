'use client';

import { useEffect, useState } from 'react';
import { Badge, Button, Card, EmptyState, ErrorNotice, Input, Notice, PageHeader, Select, formatStatus } from '@/components/ui';
import { Modal } from '@/components/modal';
import { SurveyResultsDashboard } from '@/components/survey/results-dashboard';
import { useToast } from '@/components/toast';
import { useSession } from '@/context/session';
import { deleteSurvey, fetchCenterStudentGroups, fetchGrades, fetchGroups, fetchStudents, fetchSurveyResponseCounts, fetchSurveyResponses, fetchSurveys, toggleSurvey, upsertSurvey } from '@/lib/api';
import { can } from '@/lib/rbac';
import { audienceLabel, deadlineLabel, nextVersionAfterEdit, QUESTION_TYPES, QUESTION_TYPE_LABELS, surveyCsv } from '@/lib/survey';
import type { AppSurvey, AppSurveyResponse, Grade, Group, Student, SurveyAudience, SurveyQuestion, SurveyQuestionType } from '@/lib/types';
import { uuid } from '@/lib/utils';

type QDraft = { key: string; type: SurveyQuestionType; title: string; required: boolean; options: string[]; maxRating: number; placeholder: string };
type FormState = {
  id: string; title: string; description: string; audience: SurveyAudience; grade_id: string; group_ids: string[];
  questions: QDraft[]; deadline: string; anonymous: boolean; lock_after_submit: boolean; is_active: boolean; version: number;
  prevQuestions: SurveyQuestion[];
};

const newQuestion = (): QDraft => ({ key: uuid(), type: 'single', title: '', required: false, options: ['', ''], maxRating: 5, placeholder: '' });
const initialForm: FormState = { id: '', title: '', description: '', audience: 'all', grade_id: '', group_ids: [], questions: [newQuestion()], deadline: '', anonymous: false, lock_after_submit: false, is_active: true, version: 1, prevQuestions: [] };

const toSurveyQuestions = (qs: QDraft[]): SurveyQuestion[] => qs.map((q) => ({
  id: q.key, type: q.type, title: q.title.trim(), required: q.required,
  options: (q.type === 'single' || q.type === 'multi') ? q.options.map((o) => o.trim()).filter(Boolean) : undefined,
  maxRating: q.type === 'rating' ? q.maxRating : undefined,
  placeholder: q.type === 'text' ? q.placeholder : undefined,
}));

export default function AdminSurveysPage() {
  const { profile } = useSession();
  const toast = useToast();
  const centerId = profile?.center_id;
  const [rows, setRows] = useState<AppSurvey[]>([]);
  const [responses, setResponses] = useState<AppSurveyResponse[]>([]);
  const [responseCounts, setResponseCounts] = useState<Record<string, number>>({});
  const [studentGroups, setStudentGroups] = useState<Array<{ student_id: string; group_id: string }>>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [grades, setGrades] = useState<Grade[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [selected, setSelected] = useState<AppSurvey | null>(null);
  const [resultsOpen, setResultsOpen] = useState(false);
  const [resultsLoading, setResultsLoading] = useState(false);
  const [form, setForm] = useState<FormState>(initialForm);
  const [open, setOpen] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const load = async () => {
    if (!centerId) return;
    setError(null);
    try {
      const [surveys, st, gr, gp, counts, memberships] = await Promise.all([
        fetchSurveys(centerId), fetchStudents(centerId), fetchGrades(centerId), fetchGroups(centerId),
        fetchSurveyResponseCounts(centerId), fetchCenterStudentGroups(centerId),
      ]);
      setRows(surveys); setStudents(st); setGrades(gr); setGroups(gp); setResponseCounts(counts); setStudentGroups(memberships);
    } catch (err) { setError(err); }
  };
  useEffect(() => { void load(); }, [centerId]);
  if (profile && !can(profile, 'surveys')) return <Card><Notice tone="error">ليس لديك صلاحية الاستبيانات.</Notice></Card>;

  const change = (patch: Partial<FormState>) => { setForm((f) => ({ ...f, ...patch })); setDirty(true); };
  const changeQuestion = (key: string, patch: Partial<QDraft>) => {
    setForm((f) => ({ ...f, questions: f.questions.map((q) => q.key === key ? { ...q, ...patch } : q) }));
    setDirty(true);
  };
  const addQuestion = () => { setForm((f) => ({ ...f, questions: [...f.questions, newQuestion()] })); setDirty(true); };
  const removeQuestion = (key: string) => {
    setForm((f) => ({ ...f, questions: f.questions.length > 1 ? f.questions.filter((q) => q.key !== key) : [newQuestion()] }));
    setDirty(true);
  };
  const moveQuestion = (i: number, d: number) => {
    setForm((f) => {
      const qs = [...f.questions]; const j = i + d;
      if (j < 0 || j >= qs.length) return f;
      [qs[i], qs[j]] = [qs[j], qs[i]];
      return { ...f, questions: qs };
    });
    setDirty(true);
  };
  const changeOption = (key: string, i: number, v: string) => {
    setForm((f) => ({ ...f, questions: f.questions.map((q) => q.key === key ? { ...q, options: q.options.map((o, idx) => idx === i ? v : o) } : q) }));
    setDirty(true);
  };
  const addOption = (key: string) => {
    setForm((f) => ({ ...f, questions: f.questions.map((q) => q.key === key ? { ...q, options: [...q.options, ''] } : q) }));
    setDirty(true);
  };
  const removeOption = (key: string, i: number) => {
    setForm((f) => ({ ...f, questions: f.questions.map((q) => q.key === key ? { ...q, options: q.options.length > 1 ? q.options.filter((_, idx) => idx !== i) : [''] } : q) }));
    setDirty(true);
  };
  const toggleGroup = (gid: string, on: boolean) => {
    setForm((f) => ({ ...f, group_ids: on ? [...f.group_ids, gid] : f.group_ids.filter((x) => x !== gid) }));
    setDirty(true);
  };

  const openNew = () => { setForm(initialForm); setDirty(false); setError(null); setOpen(true); };
  const openEdit = async (s: AppSurvey) => {
    const qs: QDraft[] = (s.questions?.length ? s.questions : [{ id: uuid(), type: 'single', title: '', required: false, options: ['', ''] }] as SurveyQuestion[])
      .map((q) => ({ key: q.id || uuid(), type: q.type || 'single', title: q.title ?? '', required: !!q.required, options: (q.options?.length ? q.options : ['', '']), maxRating: q.maxRating || 5, placeholder: q.placeholder ?? '' }));
    setForm({
      id: s.id, title: s.title, description: s.description ?? '', audience: s.audience ?? 'all',
      grade_id: s.grade_id ?? '', group_ids: s.group_ids ?? [],
      questions: qs.length ? qs : [newQuestion()], deadline: s.deadline ? s.deadline.slice(0, 16) : '',
      anonymous: !!s.anonymous, lock_after_submit: !!s.lock_after_submit, is_active: s.is_active, version: s.version ?? 1,
      prevQuestions: s.questions ?? [],
    });
    setDirty(false); setError(null); setOpen(true);
  };

  const openResults = async (survey: AppSurvey) => {
    setSelected(survey); setResponses([]); setResultsLoading(true); setResultsOpen(true); setError(null);
    try { setResponses(await fetchSurveyResponses(survey.id)); }
    catch (err) { setError(err); }
    finally { setResultsLoading(false); }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); if (!centerId) return;
    const clean = toSurveyQuestions(form.questions).filter((q) => q.title.trim().length > 0);
    if (clean.length === 0) { setError(new Error('أضف سؤالاً واحداً على الأقل بعنوان')); return; }
    if (form.audience === 'grade' && !form.grade_id) { setError(new Error('اختر الصف المستهدف')); return; }
    if (form.audience === 'group' && form.group_ids.length === 0) { setError(new Error('اختر مجموعة واحدة على الأقل')); return; }
    setBusy(true); setError(null);
    try {
      await upsertSurvey(centerId, {
        id: form.id || undefined, title: form.title, description: form.description,
        questions: clean, audience: form.audience, grade_id: form.grade_id, group_ids: form.group_ids,
        deadline: form.deadline || null, anonymous: form.anonymous, lock_after_submit: form.lock_after_submit,
        is_active: form.is_active, version: nextVersionAfterEdit(form.id ? { version: form.version, questions: form.prevQuestions } : undefined, clean),
      });
      toast.success('تم حفظ الاستبيان', form.id ? 'تم تحديث الاستبيان.' : 'أصبح متاحاً للطلاب.');
      setDirty(false); setOpen(false); setForm(initialForm); await load();
    } catch (err) { setError(err); }
    finally { setBusy(false); }
  };

  const remove = async (id: string) => {
    if (!confirm('حذف الاستبيان وإجاباته؟')) return;
    try { await deleteSurvey(id); await load(); toast.success('تم حذف الاستبيان'); if (selected?.id === id) { setSelected(null); setResponses([]); setResultsOpen(false); } } catch (err) { setError(err); }
  };

  const exportCsv = (s: AppSurvey) => {
    const csv = surveyCsv(s, responses, students);
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `${s.title || 'survey'}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  const targetCount = (survey: AppSurvey) => {
    if (survey.audience === 'all') return students.length;
    if (survey.audience === 'grade') return students.filter((student) => student.grade_id === survey.grade_id).length;
    const targetGroups = new Set(survey.group_ids ?? []);
    return students.filter((student) => targetGroups.has(student.group_id ?? '') || studentGroups.some((membership) => membership.student_id === student.id && targetGroups.has(membership.group_id))).length;
  };

  return <>
    <PageHeader
      title="الاستبيانات"
      subtitle="استبيانات احترافية: أنواع أسئلة، جمهور مستهدف، موعد نهائي، ونتائج مجمّعة مع تصدير Excel."
      actions={<Button type="button" onClick={openNew}>+ استبيان جديد</Button>}
    />
    <ErrorNotice error={error} />
    <section className="survey-library">
      <div className="survey-library-head"><div><h2 className="h2">مركز الاستبيانات</h2><p>تابع المشاركة والنتائج من القائمة مباشرة، ثم افتح التحليل الكامل بعلامة العين.</p></div><Badge tone="info">{rows.length} استبيان</Badge></div>
      {rows.length === 0 ? <Card><EmptyState title="لا توجد استبيانات" body="أنشئ استبياناً واختر نوع كل سؤال وجمهوره وموعده النهائي." /></Card> : <div className="survey-library-grid">{rows.map((survey) => {
        const status = formatStatus(survey.is_active ? 'active' : 'suspended');
        const available = !survey.deadline || new Date(survey.deadline).getTime() >= Date.now();
        const target = targetCount(survey);
        const count = responseCounts[survey.id] ?? 0;
        const rate = target ? Math.min(100, Math.round((count / target) * 100)) : 0;
        return <article key={survey.id} className="survey-library-card">
          <header><div className="survey-library-icon">▤</div><div className="survey-library-title"><h3>{survey.title}</h3><p>{survey.description || 'استبيان بدون وصف.'}</p></div><Badge tone={status.tone}>{survey.is_active ? available ? 'نشط' : 'انتهى الموعد' : 'موقوف'}</Badge></header>
          <div className="survey-library-meta"><span>{survey.questions.length} أسئلة</span><span>{audienceLabel(survey, grades, groups)}</span><span>{deadlineLabel(survey)}</span></div>
          <div className="survey-library-participation"><div className="row-between"><span>المشاركة</span><strong>{count}{target ? ` / ${target}` : ' رد'}</strong></div>{target ? <><div className="progress-track"><div className="progress-fill" style={{ width: `${rate}%` }} /></div><small>{rate}% من الطلاب المستهدفين</small></> : <small>لا يوجد جمهور محدد للحساب</small>}</div>
          <footer><Button type="button" variant="secondary" className="survey-eye-button" title="عرض نتائج الاستبيان" aria-label={`عرض نتائج ${survey.title}`} onClick={() => void openResults(survey)}>👁 <span>النتائج</span></Button><Button type="button" variant="ghost" onClick={() => void openEdit(survey)}>تعديل</Button><Button type="button" variant="ghost" onClick={async () => { try { await toggleSurvey(survey.id, !survey.is_active); await load(); toast.success(survey.is_active ? 'تم إيقاف الاستبيان' : 'تم تفعيل الاستبيان'); } catch (err) { setError(err); } }}>{survey.is_active ? 'إيقاف' : 'تفعيل'}</Button><Button type="button" variant="danger" onClick={() => void remove(survey.id)}>حذف</Button></footer>
        </article>;
      })}</div>}
    </section>

    <Modal open={resultsOpen && !!selected} title="نتائج الاستبيان" subtitle={selected ? `${selected.questions.length} أسئلة · ${audienceLabel(selected, grades, groups)}` : ''} onClose={() => setResultsOpen(false)} wide footer={<Button type="button" onClick={() => setResultsOpen(false)}>إغلاق</Button>}>
      {selected ? <SurveyResultsDashboard survey={selected} responses={responses} students={students} targetCount={targetCount(selected)} loading={resultsLoading} onExport={() => exportCsv(selected)} /> : null}
    </Modal>

    <Modal
      open={open}
      title={form.id ? 'تعديل استبيان' : 'استبيان جديد'}
      subtitle="أنواع أسئلة وجمهور مستهدف وموعد نهائي وخصوصية"
      dirty={dirty}
      wide
      onClose={() => setOpen(false)}
      onSave={() => void submit({ preventDefault: () => {} } as React.FormEvent)}
      saveLabel={busy ? 'جاري الحفظ...' : 'حفظ'}
      footer={<Button disabled={busy} type="submit" form="survey-form">{busy ? 'جاري الحفظ...' : 'حفظ'}</Button>}
    >
      <form id="survey-form" className="stack" onSubmit={submit}>
        <Input label="عنوان الاستبيان" value={form.title} onChange={(e) => change({ title: e.target.value })} required />
        <Input label="وصف مختصر (اختياري)" value={form.description} onChange={(e) => change({ description: e.target.value })} />

        <div className="grid grid-2">
          <Select label="الجمهور المستهدف" value={form.audience} onChange={(e) => change({ audience: e.target.value as SurveyAudience })}>
            <option value="all">الجميع</option>
            <option value="grade">صف محدد</option>
            <option value="group">مجموعات محددة</option>
          </Select>
          <Input label="الموعد النهائي (اختياري)" type="datetime-local" value={form.deadline} onChange={(e) => change({ deadline: e.target.value })} />
        </div>

        {form.audience === 'grade' ? (
          <Select label="الصف" value={form.grade_id} onChange={(e) => change({ grade_id: e.target.value })}>
            <option value="">اختر الصف</option>
            {grades.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </Select>
        ) : null}
        {form.audience === 'group' ? (
          <div className="stack" style={{ gap: 6 }}>
            <span className="muted small">المجموعات المستهدفة:</span>
            {groups.length === 0 ? <Notice tone="info">لا توجد مجموعات بعد.</Notice> : groups.map((g) => (
              <label key={g.id} className="row small muted"><input type="checkbox" checked={form.group_ids.includes(g.id)} onChange={(e) => toggleGroup(g.id, e.target.checked)} /> {g.name}</label>
            ))}
          </div>
        ) : null}

        <div className="stack" style={{ gap: 10 }}>
          <div className="row-between"><h2 className="h3">الأسئلة</h2><Button type="button" variant="secondary" onClick={addQuestion}>+ إضافة سؤال</Button></div>
          {form.questions.map((q, i) => (
            <div key={q.key} className="card compact soft stack" style={{ gap: 8 }}>
              <div className="row" style={{ alignItems: 'end' }}>
                <div style={{ flex: 1 }}><Input label={`سؤال ${i + 1}`} value={q.title} onChange={(e) => changeQuestion(q.key, { title: e.target.value })} placeholder="اكتب نص السؤال" /></div>
                <Select label="النوع" value={q.type} onChange={(e) => changeQuestion(q.key, { type: e.target.value as SurveyQuestionType })}>{QUESTION_TYPES.map((t) => <option key={t} value={t}>{QUESTION_TYPE_LABELS[t]}</option>)}</Select>
                <Button type="button" variant="ghost" onClick={() => moveQuestion(i, -1)} disabled={i === 0} title="أعلى">↑</Button>
                <Button type="button" variant="ghost" onClick={() => moveQuestion(i, 1)} disabled={i === form.questions.length - 1} title="أسفل">↓</Button>
                <Button type="button" variant="ghost" onClick={() => removeQuestion(q.key)} title="حذف">✕</Button>
              </div>
              {(q.type === 'single' || q.type === 'multi') ? (
                <div className="stack" style={{ gap: 6 }}>
                  <span className="muted tiny">الخيارات {q.type === 'multi' ? '(يختار الطالب أكثر من واحد)' : '(يختار الطالب واحداً)'}:</span>
                  {q.options.map((o, oi) => (
                    <div key={oi} className="row" style={{ alignItems: 'end' }}>
                      <div style={{ flex: 1 }}><Input label="" value={o} onChange={(e) => changeOption(q.key, oi, e.target.value)} placeholder={`خيار ${oi + 1}`} /></div>
                      <Button type="button" variant="ghost" onClick={() => removeOption(q.key, oi)} disabled={q.options.length <= 1} title="حذف الخيار">✕</Button>
                    </div>
                  ))}
                  <Button type="button" variant="secondary" onClick={() => addOption(q.key)}>+ خيار</Button>
                </div>
              ) : null}
              {q.type === 'rating' ? (
                <div className="grid grid-2">
                  <Input label="أقصى قيمة للتقييم" type="number" min={2} max={10} value={String(q.maxRating)} onChange={(e) => changeQuestion(q.key, { maxRating: Math.max(2, Math.min(10, Number(e.target.value) || 5)) })} />
                </div>
              ) : null}
              {q.type === 'text' ? (
                <Input label="نص إرشادي (اختياري)" value={q.placeholder} onChange={(e) => changeQuestion(q.key, { placeholder: e.target.value })} placeholder="مثال: اكتب رأيك باختصار" />
              ) : null}
              <label className="row small muted"><input type="checkbox" checked={q.required} onChange={(e) => changeQuestion(q.key, { required: e.target.checked })} /> سؤال إجباري</label>
            </div>
          ))}
        </div>

        <div className="grid grid-2">
          <div className="stack" style={{ gap: 6 }}>
            <label className="row small muted"><input type="checkbox" checked={form.anonymous} onChange={(e) => change({ anonymous: e.target.checked })} /> إجابات مجهولة (لا يظهر اسم الطالب في النتائج)</label>
            <label className="row small muted"><input type="checkbox" checked={form.lock_after_submit} onChange={(e) => change({ lock_after_submit: e.target.checked })} /> قفل الإجابة بعد إرسالها (لا تعديل)</label>
            <label className="row small muted"><input type="checkbox" checked={form.is_active} onChange={(e) => change({ is_active: e.target.checked })} /> نشط للطلاب</label>
          </div>
          <Notice>تعديل الأسئلة يرفع رقم النسخة تلقائياً، فيستطيع من أجاب سابقاً الإجابة على الأسئلة الجديدة.</Notice>
        </div>
        <ErrorNotice error={error} />
      </form>
    </Modal>
  </>;
}
