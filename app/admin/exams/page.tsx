'use client';

import { useEffect, useMemo, useState } from 'react';
import { Badge, Button, Card, EmptyState, ErrorNotice, Input, Notice, PageHeader, Select, Textarea, formatStatus } from '@/components/ui';
import { Modal } from '@/components/modal';
import { useToast } from '@/components/toast';
import { useSession } from '@/context/session';
import { deleteExam, fetchAttemptsForExam, fetchExams, fetchGrades, fetchStudents, gradeAttemptManually, toggleExamPublished, upsertExam } from '@/lib/api';
import { can } from '@/lib/rbac';
import type { AppExam, ExamAnswer, ExamAttempt, ExamQuestion, ExamQuestionType, ExamResultMode, Grade, Student } from '@/lib/types';
import { EXAM_TYPE_LABEL, examMarksTotal, formatDate, validateExamDraft } from '@/lib/utils';

const TYPES: ExamQuestionType[] = ['mcq', 'multi', 'tf', 'complete', 'match', 'correct', 'essay', 'short'];

function newQuestion(type: ExamQuestionType = 'mcq'): ExamQuestion {
  if (type === 'tf') return { type, q: '', choices: ['صح', 'خطأ'], marks: 1 };
  if (type === 'match') return { type, q: '', choices: [], pairs: [{ l: '', r: '' }, { l: '', r: '' }], marks: 2 };
  if (type === 'essay' || type === 'short') return { type, q: '', choices: [], marks: 3 };
  if (type === 'complete' || type === 'correct') return { type, q: '', choices: [], answer: '', marks: 2 };
  return { type, q: '', choices: ['', '', '', ''], marks: 2 };
}

function defaultAnswer(q: ExamQuestion): ExamAnswer {
  if (q.type === 'tf' || q.type === 'mcq') return 0;
  if (q.type === 'multi') return [];
  if (q.type === 'match') return (q.pairs ?? []).map((_, i) => i);
  if (q.type === 'complete' || q.type === 'correct') return q.answer ?? '';
  return null;
}

function normalizeQuestions(questions: ExamQuestion[]): ExamQuestion[] {
  return questions.map((q) => {
    const base = { ...newQuestion(q.type), ...q, choices: q.choices ?? [] };
    if ((base.type === 'mcq' || base.type === 'multi') && base.choices.length < 4) base.choices = [...base.choices, '', '', '', ''].slice(0, 4);
    if (base.type === 'tf') base.choices = ['صح', 'خطأ'];
    if (base.type === 'match' && (!base.pairs || base.pairs.length < 2)) base.pairs = [{ l: '', r: '' }, { l: '', r: '' }];
    return base;
  });
}

function QuestionEditor({ q, answer, index, onQuestion, onAnswer, onDelete, onMove }: {
  q: ExamQuestion;
  answer: ExamAnswer;
  index: number;
  onQuestion: (q: ExamQuestion) => void;
  onAnswer: (a: ExamAnswer) => void;
  onDelete: () => void;
  onMove: (delta: number) => void;
}) {
  const setType = (type: ExamQuestionType) => {
    const nq = newQuestion(type);
    onQuestion(nq);
    onAnswer(defaultAnswer(nq));
  };
  const setChoice = (idx: number, value: string) => onQuestion({ ...q, choices: q.choices.map((c, i) => i === idx ? value : c) });
  const toggleMulti = (idx: number, checked: boolean) => {
    const arr = Array.isArray(answer) ? answer as number[] : [];
    onAnswer(checked ? [...arr, idx].sort() : arr.filter((x) => x !== idx));
  };
  const pairs = q.pairs ?? [];

  return <div className="card compact soft stack">
    <div className="row-between"><h3 className="h3">سؤال {index + 1}</h3><div className="row"><Button type="button" variant="secondary" onClick={() => onMove(-1)}>↑</Button><Button type="button" variant="secondary" onClick={() => onMove(1)}>↓</Button><Button type="button" variant="danger" onClick={onDelete}>حذف</Button></div></div>
    <div className="grid grid-3"><Select label="نوع السؤال" value={q.type} onChange={(e) => setType(e.target.value as ExamQuestionType)}>{TYPES.map((t) => <option key={t} value={t}>{EXAM_TYPE_LABEL[t] ?? t}</option>)}</Select><Input label="الدرجة" type="number" value={q.marks} onChange={(e) => onQuestion({ ...q, marks: Number(e.target.value) || 1 })} /><div className="input-wrap"><span className="label">التصحيح</span><div className="notice">{q.type === 'essay' || q.type === 'short' ? 'يدوي' : 'تلقائي'}</div></div></div>
    <Textarea label="نص السؤال" value={q.q} onChange={(e) => onQuestion({ ...q, q: e.target.value })} required />
    {(q.type === 'mcq' || q.type === 'multi') ? <div className="grid grid-2">{q.choices.slice(0, 4).map((c, i) => <div key={i} className="row" style={{ alignItems: 'end' }}><Input label={`اختيار ${i + 1}`} value={c} onChange={(e) => setChoice(i, e.target.value)} /><label className="row tiny muted"><input type={q.type === 'mcq' ? 'radio' : 'checkbox'} name={`correct-${index}`} checked={q.type === 'mcq' ? answer === i : Array.isArray(answer) && answer.includes(i)} onChange={(e) => q.type === 'mcq' ? onAnswer(i) : toggleMulti(i, e.target.checked)} /> صحيح</label></div>)}</div> : null}
    {q.type === 'tf' ? <div className="tabs"><button type="button" className={`tab ${answer === 0 ? 'active' : ''}`} onClick={() => onAnswer(0)}>صح</button><button type="button" className={`tab ${answer === 1 ? 'active' : ''}`} onClick={() => onAnswer(1)}>خطأ</button></div> : null}
    {(q.type === 'complete' || q.type === 'correct') ? <Input label="الإجابة النموذجية" value={typeof answer === 'string' ? answer : ''} onChange={(e) => { onAnswer(e.target.value); onQuestion({ ...q, answer: e.target.value }); }} /> : null}
    {q.type === 'match' ? <div className="stack"><div className="row-between"><strong>أزواج التوصيل</strong><Button type="button" variant="secondary" onClick={() => { const next = [...pairs, { l: '', r: '' }]; onQuestion({ ...q, pairs: next }); onAnswer(next.map((_, i) => i)); }}>إضافة زوج</Button></div>{pairs.map((p, i) => <div key={i} className="grid grid-2"><Input label={`الطرف الأيسر ${i + 1}`} value={p.l} onChange={(e) => onQuestion({ ...q, pairs: pairs.map((x, idx) => idx === i ? { ...x, l: e.target.value } : x) })} /><Input label={`الطرف الأيمن ${i + 1}`} value={p.r} onChange={(e) => onQuestion({ ...q, pairs: pairs.map((x, idx) => idx === i ? { ...x, r: e.target.value } : x) })} /></div>)}</div> : null}
  </div>;
}

export default function AdminExamsPage() {
  const { profile } = useSession();
  const toast = useToast();
  const centerId = profile?.center_id;
  const [exams, setExams] = useState<AppExam[]>([]);
  const [grades, setGrades] = useState<Grade[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [attempts, setAttempts] = useState<ExamAttempt[]>([]);
  const [manualScores, setManualScores] = useState<Record<string, string>>({});
  const [form, setForm] = useState({ id: '', title: '', subject: '', grade_id: '', duration: '30', attempts: '1', show_result: 'end' as ExamResultMode, is_published: false });
  const [questions, setQuestions] = useState<ExamQuestion[]>([newQuestion('mcq')]);
  const [answers, setAnswers] = useState<ExamAnswer[]>([0]);
  const [selected, setSelected] = useState<AppExam | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [preview, setPreview] = useState(false);
  const [previewMode, setPreviewMode] = useState<'paper' | 'electronic'>('paper');

  const studentName = useMemo(() => new Map(students.map((s) => [s.id, s.name])), [students]);
  const validation = useMemo(() => validateExamDraft(questions.map((q, i) => ({ ...q, answer: typeof answers[i] === 'string' ? answers[i] as string : q.answer, corrects: Array.isArray(answers[i]) ? answers[i] as number[] : undefined }))), [questions, answers]);
  const total = examMarksTotal(questions);

  const load = async () => {
    if (!centerId) return;
    setError(null);
    try { const [e, g, s] = await Promise.all([fetchExams(centerId), fetchGrades(centerId), fetchStudents(centerId)]); setExams(e); setGrades(g); setStudents(s); }
    catch (err) { setError(err); }
  };
  useEffect(() => { void load(); }, [centerId]);
  if (profile && !can(profile, 'exams')) return <Card><Notice tone="error">ليس لديك صلاحية الاختبارات.</Notice></Card>;

  const updateQuestion = (idx: number, q: ExamQuestion) => setQuestions((old) => old.map((x, i) => i === idx ? q : x));
  const updateAnswer = (idx: number, a: ExamAnswer) => setAnswers((old) => old.map((x, i) => i === idx ? a : x));
  const move = (idx: number, delta: number) => {
    const nextIdx = idx + delta; if (nextIdx < 0 || nextIdx >= questions.length) return;
    const q = [...questions]; const a = [...answers];
    [q[idx], q[nextIdx]] = [q[nextIdx], q[idx]]; [a[idx], a[nextIdx]] = [a[nextIdx], a[idx]];
    setQuestions(q); setAnswers(a);
  };
  const addQuestion = (type: ExamQuestionType) => { const q = newQuestion(type); setQuestions((old) => [...old, q]); setAnswers((old) => [...old, defaultAnswer(q)]); };
  const removeQuestion = (idx: number) => { if (questions.length === 1) return; setQuestions((old) => old.filter((_, i) => i !== idx)); setAnswers((old) => old.filter((_, i) => i !== idx)); };

  const reset = () => { setSelected(null); setAttempts([]); setManualScores({}); setForm({ id: '', title: '', subject: '', grade_id: '', duration: '30', attempts: '1', show_result: 'end', is_published: false }); setQuestions([newQuestion('mcq')]); setAnswers([0]); };
  const edit = async (exam: AppExam) => { setSelected(exam); setForm({ id: exam.id, title: exam.title, subject: exam.subject, grade_id: exam.grade_id ?? '', duration: String(exam.duration_minutes), attempts: String(exam.attempts_allowed ?? 1), show_result: (exam.show_result ?? 'end') as ExamResultMode, is_published: exam.is_published }); const qs = normalizeQuestions(exam.questions); setQuestions(qs); setAnswers(qs.map((q, i) => exam.answers[i] ?? defaultAnswer(q))); try { setAttempts(await fetchAttemptsForExam(exam.id)); } catch (err) { setError(err); } };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); if (!centerId) return; if (validation) return setError(new Error(validation));
    setBusy(true); setError(null);
    try { await upsertExam(centerId, { id: form.id || undefined, title: form.title, subject: form.subject, grade_id: form.grade_id || null, duration_minutes: Number(form.duration) || 30, questions, answers, total_score: total, is_published: form.is_published, attempts_allowed: Math.max(1, Number(form.attempts) || 1), show_result: form.show_result }); toast.success('تم حفظ الاختبار', form.is_published ? 'الاختبار محفوظ ومنشور للطلاب.' : 'الاختبار محفوظ كمسودة.'); await load(); }
    catch (err) { setError(err); }
    finally { setBusy(false); }
  };
  const remove = async (id: string) => { if (!confirm('حذف الاختبار ومحاولاته؟')) return; try { await deleteExam(id); reset(); await load(); } catch (err) { setError(err); } };
  const grade = async (id: string) => { const score = Number(manualScores[id]); if (Number.isNaN(score)) return; try { await gradeAttemptManually(id, score); if (selected) setAttempts(await fetchAttemptsForExam(selected.id)); } catch (err) { setError(err); } };

  return <>
    <PageHeader title="الاختبارات الإلكترونية" subtitle="باني أسئلة مرئي يدعم الأنواع الثمانية مع نشر وتصحيح ومحاولات الطلاب." actions={<Button type="button" variant="secondary" onClick={reset}>اختبار جديد</Button>} />
    <ErrorNotice error={error} />
    <div className="grid grid-2">
      <Card className="stack"><h2 className="h3">{form.id ? 'تعديل اختبار' : 'إنشاء اختبار'}</h2><form className="stack" onSubmit={submit}><div className="grid grid-2"><Input label="العنوان" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required /><Input label="المادة" value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} /><Select label="الصف" value={form.grade_id} onChange={(e) => setForm({ ...form, grade_id: e.target.value })}><option value="">كل الصفوف</option>{grades.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</Select><Input label="المدة بالدقائق" type="number" value={form.duration} onChange={(e) => setForm({ ...form, duration: e.target.value })} /><Input label="عدد المحاولات لكل طالب" type="number" min={1} value={form.attempts} onChange={(e) => setForm({ ...form, attempts: e.target.value })} /><Select label="إظهار النتيجة" value={form.show_result} onChange={(e) => setForm({ ...form, show_result: e.target.value as ExamResultMode })}><option value="end">بعد نهاية الاختبار</option><option value="after_each">بعد كل سؤال</option><option value="never">لا تُظهر نهائياً إلا بعد تحرير جميع النتائج</option></Select></div><div className="row"><Badge tone={validation ? 'danger' : 'success'}>{validation ? 'راجع بيانات الأسئلة' : `المجموع ${total} درجة`}</Badge><label className="row small muted"><input type="checkbox" checked={form.is_published} onChange={(e) => setForm({ ...form, is_published: e.target.checked })} /> نشر للطلاب</label><Button type="button" variant="secondary" onClick={() => setPreview(true)}>معاينة الاختبار</Button></div>{validation ? <Notice tone="error">{validation}</Notice> : null}{questions.map((q, i) => <QuestionEditor key={i} q={q} answer={answers[i]} index={i} onQuestion={(next) => updateQuestion(i, next)} onAnswer={(next) => updateAnswer(i, next)} onDelete={() => removeQuestion(i)} onMove={(d) => move(i, d)} />)}<div className="row"><Select label="نوع سؤال جديد" defaultValue="mcq" onChange={(e) => addQuestion(e.target.value as ExamQuestionType)}><option value="mcq">إضافة: اختيار</option>{TYPES.filter((t) => t !== 'mcq').map((t) => <option key={t} value={t}>إضافة: {EXAM_TYPE_LABEL[t] ?? t}</option>)}</Select><Button disabled={busy} type="submit">{busy ? 'جاري الحفظ...' : 'حفظ الاختبار'}</Button></div></form></Card>
      <Card className="stack"><div className="row-between"><h2 className="h3">الاختبارات</h2><Badge tone="info">{exams.length}</Badge></div>{exams.length === 0 ? <EmptyState title="لا توجد اختبارات" /> : exams.map((exam) => { const st = formatStatus(exam.is_published ? 'active' : 'suspended'); return <div key={exam.id} className="card compact soft stack"><div className="row-between"><strong>{exam.title}</strong><Badge tone={st.tone}>{exam.is_published ? 'منشور' : 'مسودة'}</Badge></div><p className="muted small">{exam.subject || 'بدون مادة'} · {exam.questions.length} سؤال · {exam.total_score} درجة · {formatDate(exam.created_at)}</p><div className="row"><Button type="button" variant="secondary" onClick={() => void edit(exam)}>تعديل/محاولات</Button><Button type="button" variant="secondary" onClick={async () => { await toggleExamPublished(exam.id, !exam.is_published); await load(); }}>{exam.is_published ? 'إلغاء النشر' : 'نشر'}</Button><Button type="button" variant="danger" onClick={() => void remove(exam.id)}>حذف</Button></div></div>; })}</Card>
    </div>
    {selected ? <Card className="stack" style={{ marginTop: 18 }}><div className="row-between"><h2 className="h3">محاولات: {selected.title}</h2><Badge tone="info">{attempts.length}</Badge></div>{attempts.length === 0 ? <EmptyState title="لا توجد محاولات" /> : <div className="table-wrap"><table><thead><tr><th>الطالب</th><th>الدرجة</th><th>الحالة</th><th>التاريخ</th><th>تصحيح يدوي</th></tr></thead><tbody>{attempts.map((a) => { const st = formatStatus(a.status); return <tr key={a.id}><td>{studentName.get(a.student_id) ?? a.student_id}</td><td><strong>{a.score}</strong> / {a.max_score}</td><td><Badge tone={st.tone}>{st.text}</Badge></td><td>{formatDate(a.created_at)}</td><td><div className="row"><input className="input" style={{ width: 90 }} value={manualScores[a.id] ?? ''} onChange={(e) => setManualScores({ ...manualScores, [a.id]: e.target.value })} placeholder="درجة" /><Button type="button" variant="secondary" onClick={() => void grade(a.id)}>حفظ</Button></div></td></tr>; })}</tbody></table></div>}</Card> : null}

    <Modal
      open={preview}
      title="معاينة الاختبار"
      subtitle={`${form.title || 'بدون عنوان'} · ${questions.length} سؤال · ${total} درجة · ${form.duration} دقيقة`}
      onClose={() => setPreview(false)}
      wide
      footer={<div className="row"><Button type="button" variant="secondary" onClick={() => window.print()}>طباعة</Button><Button type="button" onClick={() => setPreview(false)}>إغلاق</Button></div>}
    >
      <div className="tabs" style={{ marginBottom: 16 }}>
        <button type="button" className={`tab ${previewMode === 'paper' ? 'active' : ''}`} onClick={() => setPreviewMode('paper')}>🖨 ورقي (للطباعة)</button>
        <button type="button" className={`tab ${previewMode === 'electronic' ? 'active' : ''}`} onClick={() => setPreviewMode('electronic')}>🖥 إلكتروني</button>
      </div>
      {previewMode === 'paper' ? (
        <div style={{ background: '#fff', color: '#111', borderRadius: 12, padding: 26, minHeight: 400 }}>
          <div style={{ textAlign: 'center', borderBottom: '2px solid #111', paddingBottom: 12, marginBottom: 18 }}>
            <h2 style={{ margin: 0 }}>{form.title || 'اختبار'}</h2>
            <div style={{ marginTop: 6 }}>{form.subject ? `المادة: ${form.subject}` : ''} · الزمن: {form.duration} دقيقة · الدرجة: {total}</div>
          </div>
          <div style={{ display: 'flex', gap: 12, marginBottom: 18 }}>
            <span>الاسم: ________________________</span>
            <span>المجموعة: ____________</span>
            <span>التاريخ: ____ / ____ / ________</span>
          </div>
          <div className="stack">
            {questions.map((q, i) => (
              <div key={i} style={{ borderBottom: '1px solid #ddd', paddingBottom: 12 }}>
                <div style={{ fontWeight: 700, marginBottom: 6 }}>{i + 1}. {q.q} <span style={{ fontWeight: 400 }}>({q.marks} درجة)</span></div>
                {(q.type === 'mcq' || q.type === 'multi') ? (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                    {q.choices.slice(0, 4).map((c, j) => (
                      <div key={j}>{q.type === 'mcq' ? '◯' : '□'} {['أ', 'ب', 'ج', 'د'][j]}. {c || '—'}</div>
                    ))}
                  </div>
                ) : null}
                {q.type === 'tf' ? <div>◯ صح &nbsp;&nbsp;&nbsp; ◯ خطأ</div> : null}
                {(q.type === 'complete' || q.type === 'essay' || q.type === 'short' || q.type === 'correct') ? (
                  <div style={{ marginTop: 8, borderBottom: '1px dotted #999', height: 44 }} />
                ) : null}
                {q.type === 'match' ? (
                  <div style={{ display: 'grid', gap: 6 }}>
                    {(q.pairs ?? []).map((p, j) => (
                      <div key={j} style={{ display: 'flex', gap: 10 }}>
                        <span style={{ flex: 1 }}>{p.l}</span>
                        <span style={{ width: 40, borderBottom: '1px dotted #999' }} />
                        <span style={{ flex: 1 }}>{p.r}</span>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="stack">
          {questions.map((q, i) => (
            <div key={i} className="card compact soft stack">
              <div className="row-between">
                <strong>{i + 1}. {q.q}</strong>
                <Badge tone="info">{EXAM_TYPE_LABEL[q.type] ?? q.type} · {q.marks} درجة</Badge>
              </div>
              {(q.type === 'mcq' || q.type === 'multi') ? (
                <div className="stack">
                  {q.choices.slice(0, 4).map((c, j) => (
                    <label key={j} className="row small">
                      <input type={q.type === 'mcq' ? 'radio' : 'checkbox'} disabled name={`pv-${i}`} /> {c || '—'}
                    </label>
                  ))}
                </div>
              ) : null}
              {q.type === 'tf' ? <div className="tabs"><span className="tab">صح</span><span className="tab">خطأ</span></div> : null}
              {q.type === 'match' ? (
                <div className="grid grid-2">
                  {(q.pairs ?? []).map((p, j) => (
                    <div key={j} className="row">
                      <span>{p.l}</span>
                      <select className="select" disabled style={{ width: 140 }}><option>اختر المطابق</option></select>
                      <span>{p.r}</span>
                    </div>
                  ))}
                </div>
              ) : null}
              {(q.type === 'complete' || q.type === 'essay' || q.type === 'short' || q.type === 'correct') ? (
                <Input label="إجابة الطالب" disabled placeholder="يكتب الطالب إجابته هنا" />
              ) : null}
            </div>
          ))}
        </div>
      )}
    </Modal>
  </>;
}
