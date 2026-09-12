'use client';

import { useEffect, useMemo, useState } from 'react';
import { Badge, Button, Card, EmptyState, ErrorNotice, Input, Notice, PageHeader, Select, Textarea } from '@/components/ui';
import { Modal } from '@/components/modal';
import { useToast } from '@/components/toast';
import { useSession } from '@/context/session';
import { ExamPaper, ElectronicExamView } from '@/components/exam/paper';
import { StampEditor } from '@/components/exam/ornaments';
import { answerLabel, correctLabel } from '@/components/exam/review';
import { ALL_ORNAMENTS, ornamentGlyph, ornamentsForSubject, subjectLabelFor } from '@/lib/exam-ornaments';
import { EGYPT_TYPES, egyptMeta } from '@/lib/exam-egyptian';
import { deleteExam, fetchAttemptsForExam, fetchExams, fetchGrades, fetchStudents, gradeAttemptManually, toggleExamPublished, upsertExam } from '@/lib/api';
import { can } from '@/lib/rbac';
import type { AppExam, ExamAnswer, ExamAttempt, ExamOrnaments, ExamQuestion, ExamQuestionType, ExamResultMode, Grade, Student } from '@/lib/types';
import { EXAM_TYPE_LABEL, examMarksTotal, formatDate, normalizeAnswerText, validateExamDraft } from '@/lib/utils';

function defaultOrnaments(subject: string): ExamOrnaments {
  return {
    placement: 'auto',
    density: 'medium',
    opacity: 0.18,
    kinds: ornamentsForSubject(subject).map((o) => o.kind),
    stamps: [],
  };
}

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

/** تصحيح تلقائي مقترح لسؤال واحد (للأنواع الموضوعية فقط) */
function suggestGrade(q: ExamQuestion, key: ExamAnswer | undefined, given: ExamAnswer | undefined): { correct: boolean | null; earned: number } {
  const marks = Number(q.marks) || 1;
  if (q.type === 'mcq' || q.type === 'tf') {
    const ok = given === key;
    return { correct: ok, earned: ok ? marks : 0 };
  }
  if (q.type === 'multi') {
    const g = Array.isArray(given) ? [...given].sort((a, b) => a - b) : [];
    const k = Array.isArray(key) ? [...key].sort((a, b) => a - b) : [];
    const ok = g.length === k.length && g.every((x, i) => x === k[i]);
    return { correct: ok, earned: ok ? marks : 0 };
  }
  if (q.type === 'match') {
    const g = Array.isArray(given) ? given : [];
    const k = Array.isArray(key) ? key : [];
    const ok = k.length > 0 && g.length === k.length && g.every((x, i) => x === k[i]);
    return { correct: ok, earned: ok ? marks : 0 };
  }
  if (q.type === 'complete') {
    const ok = normalizeAnswerText(typeof given === 'string' ? given : '') === normalizeAnswerText(typeof key === 'string' ? key : '');
    return { correct: ok, earned: ok ? marks : 0 };
  }
  return { correct: null, earned: 0 };
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
  const meta = egyptMeta(q.type);
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
    <div className="row-between">
      <h3 className="h3" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span className="exam-paper-sec-mark">{meta.paperMark}</span>
        سؤال {index + 1}
        <Badge tone="info">{meta.label}</Badge>
      </h3>
      <div className="row">
        <Button type="button" variant="secondary" onClick={() => onMove(-1)} title="تحريك لأعلى">↑</Button>
        <Button type="button" variant="secondary" onClick={() => onMove(1)} title="تحريك لأسفل">↓</Button>
        <Button type="button" variant="danger" onClick={onDelete}>حذف</Button>
      </div>
    </div>

    <div className="grid grid-3">
      <Select label="نوع السؤال" value={q.type} onChange={(e) => setType(e.target.value as ExamQuestionType)}>
        {EGYPT_TYPES.map((t) => <option key={t.type} value={t.type}>{t.label}</option>)}
      </Select>
      <Input label="الدرجة" type="number" min={1} value={q.marks} onChange={(e) => onQuestion({ ...q, marks: Number(e.target.value) || 1 })} />
      <div className="input-wrap"><span className="label">التصحيح</span><div className={`notice ${meta.manual ? 'warn' : 'success'}`} style={{ padding: '9px 11px' }}>{meta.manual ? 'يدوي (مراجعة المعلم)' : 'تلقائي'}</div></div>
    </div>

    <Textarea label="نص السؤال" value={q.q} onChange={(e) => onQuestion({ ...q, q: e.target.value })} required />

    {q.type === 'mcq' || q.type === 'multi' ? (
      <div className="grid grid-2">
        {q.choices.slice(0, 4).map((c, i) => (
          <div key={i} className="row" style={{ alignItems: 'end' }}>
            <div style={{ flex: 1 }}><Input label={`الاختيار (${['أ', 'ب', 'ج', 'د'][i]})`} value={c} onChange={(e) => setChoice(i, e.target.value)} /></div>
            <label className="row tiny muted" style={{ gap: 5, paddingBottom: 12 }} title="حدد الإجابة الصحيحة">
              <input type={q.type === 'mcq' ? 'radio' : 'checkbox'} name={`correct-${index}`} checked={q.type === 'mcq' ? answer === i : Array.isArray(answer) && (answer as number[]).includes(i)} onChange={(e) => q.type === 'mcq' ? onAnswer(i) : toggleMulti(i, e.target.checked)} />
              صحيح
            </label>
          </div>
        ))}
        <Notice tone="info">{q.type === 'mcq' ? 'حدد اختياراً واحداً صحيحاً' : 'حدد كل الاختيارات الصحيحة'}</Notice>
      </div>
    ) : null}

    {q.type === 'tf' ? (
      <div className="tabs">
        <button type="button" className={`tab ${answer === 0 ? 'active' : ''}`} onClick={() => onAnswer(0)}>✓ صح</button>
        <button type="button" className={`tab ${answer === 1 ? 'active' : ''}`} onClick={() => onAnswer(1)}>✗ خطأ</button>
      </div>
    ) : null}

    {q.type === 'complete' ? (
      <Input label="الإجابة النموذجية (للمطابقة الآلية)" value={typeof answer === 'string' ? answer : ''} onChange={(e) => { onAnswer(e.target.value); onQuestion({ ...q, answer: e.target.value }); }} />
    ) : null}

    {q.type === 'correct' ? (
      <Input label="الإجابة النموذجية (اختياري — تُعتمد آلياً عند التطابق التام)" value={typeof answer === 'string' ? answer : ''} onChange={(e) => { onAnswer(e.target.value); onQuestion({ ...q, answer: e.target.value }); }} />
    ) : null}

    {q.type === 'match' ? (
      <div className="stack">
        <div className="row-between">
          <strong>أزواج التوصيل (العمود أ ↔ العمود ب)</strong>
          <Button type="button" variant="secondary" onClick={() => { const next = [...pairs, { l: '', r: '' }]; onQuestion({ ...q, pairs: next }); onAnswer(next.map((_, i) => i)); }}>إضافة زوج</Button>
        </div>
        {pairs.map((p, i) => (
          <div key={i} className="grid grid-2">
            <Input label={`العمود أ ${i + 1}`} value={p.l} onChange={(e) => onQuestion({ ...q, pairs: pairs.map((x, idx) => idx === i ? { ...x, l: e.target.value } : x) })} />
            <Input label={`العمود ب ${i + 1}`} value={p.r} onChange={(e) => onQuestion({ ...q, pairs: pairs.map((x, idx) => idx === i ? { ...x, r: e.target.value } : x) })} />
          </div>
        ))}
        <div className="notice">حدد لكل بند في العمود (أ) البند المطابق من العمود (ب):</div>
        {pairs.map((p, i) => (
          <div key={`m-${i}`} className="row-between card compact soft">
            <span>{(p.l || `أ ${i + 1}`)} ⟶</span>
            <select className="select" style={{ width: '60%' }} value={Array.isArray(answer) ? answer[i] ?? i : i} onChange={(e) => { const arr = Array.isArray(answer) ? [...answer] : pairs.map((_, idx) => idx); arr[i] = Number(e.target.value); onAnswer(arr); }}>
              {pairs.map((x, idx) => <option key={idx} value={idx}>{x.r || `ب ${idx + 1}`}</option>)}
            </select>
          </div>
        ))}
      </div>
    ) : null}

    {/* صورة السؤال */}
    <details>
      <summary className="small muted" style={{ cursor: 'pointer' }}>🖼 صورة السؤال (اختيارية) {q.image ? '— مضافة' : ''}</summary>
      <div className="grid grid-2" style={{ marginTop: 8 }}>
        <Input label="رابط الصورة" value={q.image ?? ''} onChange={(e) => onQuestion({ ...q, image: e.target.value || null })} placeholder="https://… أو رابط من التخزين" />
        <Select label="مكان الصورة" value={q.imagePosition ?? 'beside'} onChange={(e) => onQuestion({ ...q, imagePosition: e.target.value as ExamQuestion['imagePosition'] })}>
          <option value="beside">بجانب السؤال (ورقي)</option>
          <option value="above">فوق السؤال</option>
          <option value="below">تحت السؤال</option>
        </Select>
        <div className="input-wrap"><span className="label">حجم الصورة (px)</span><input className="input" type="number" min={80} max={600} value={q.imageSize ?? 160} onChange={(e) => onQuestion({ ...q, imageSize: Number(e.target.value) || 160 })} /></div>
      </div>
      {q.image ? <div className="row" style={{ alignItems: 'center', marginTop: 8 }}><img src={q.image} alt="معاينة" style={{ maxHeight: 90, maxWidth: 220, borderRadius: 8, border: '1px solid var(--border)' }} onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} /><span className="tiny muted">تظهر الصورة بجانب السؤال في الورق، وفوقه/تحته إلكترونياً حسب اختيارك.</span></div> : null}
    </details>
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
  const [ornaments, setOrnaments] = useState<ExamOrnaments>(defaultOrnaments(''));
  const [selected, setSelected] = useState<AppExam | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [preview, setPreview] = useState(false);
  const [previewMode, setPreviewMode] = useState<'paper' | 'electronic'>('paper');
  const [reviewAttempt, setReviewAttempt] = useState<ExamAttempt | null>(null);
  const [reviewScores, setReviewScores] = useState<Record<number, string>>({});
  const [reviewTotal, setReviewTotal] = useState('');
  const [savingReview, setSavingReview] = useState(false);

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

  const reset = () => { setSelected(null); setAttempts([]); setManualScores({}); setForm({ id: '', title: '', subject: '', grade_id: '', duration: '30', attempts: '1', show_result: 'end', is_published: false }); setQuestions([newQuestion('mcq')]); setAnswers([0]); setOrnaments(defaultOrnaments('')); };
  const edit = async (exam: AppExam) => {
    setSelected(exam);
    setForm({ id: exam.id, title: exam.title, subject: exam.subject, grade_id: exam.grade_id ?? '', duration: String(exam.duration_minutes), attempts: String(exam.attempts_allowed ?? 1), show_result: (exam.show_result ?? 'end') as ExamResultMode, is_published: exam.is_published });
    const qs = normalizeQuestions(exam.questions);
    setQuestions(qs); setAnswers(qs.map((q, i) => exam.answers[i] ?? defaultAnswer(q))); setOrnaments(exam.ornaments ?? defaultOrnaments(exam.subject));
    try { setAttempts(await fetchAttemptsForExam(exam.id)); } catch (err) { setError(err); }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); if (!centerId) return; if (validation) return setError(new Error(validation));
    setBusy(true); setError(null);
    try { await upsertExam(centerId, { id: form.id || undefined, title: form.title, subject: form.subject, grade_id: form.grade_id || null, duration_minutes: Number(form.duration) || 30, questions, answers, total_score: total, is_published: form.is_published, attempts_allowed: Math.max(1, Number(form.attempts) || 1), show_result: form.show_result, ornaments }); toast.success('تم حفظ الاختبار', form.is_published ? 'الاختبار محفوظ ومنشور للطلاب.' : 'الاختبار محفوظ كمسودة.'); await load(); }
    catch (err) { setError(err); }
    finally { setBusy(false); }
  };
  const remove = async (id: string) => { if (!confirm('حذف الاختبار ومحاولاته؟')) return; try { await deleteExam(id); reset(); await load(); } catch (err) { setError(err); } };
  const grade = async (id: string) => { const score = Number(manualScores[id]); if (Number.isNaN(score)) return; try { await gradeAttemptManually(id, score); if (selected) setAttempts(await fetchAttemptsForExam(selected.id)); } catch (err) { setError(err); } };

  const openReview = (a: ExamAttempt) => {
    setReviewAttempt(a);
    const qs = selected?.questions ?? [];
    const scores: Record<number, string> = {};
    let auto = 0;
    qs.forEach((q, i) => {
      const key = selected?.answers?.[i];
      const given = (a.answers ?? [])[i];
      const r = suggestGrade(q, key, given);
      if (r.correct !== null) { scores[i] = String(r.earned); auto += r.earned; }
      else scores[i] = '';
    });
    setReviewScores(scores);
    setReviewTotal(String(auto));
    setError(null);
  };

  const reviewManualTotal = () => {
    const qs = selected?.questions ?? [];
    let sum = 0;
    qs.forEach((q, i) => {
      const r = suggestGrade(q, selected?.answers?.[i], (reviewAttempt?.answers ?? [])[i]);
      if (r.correct !== null) sum += r.earned;
      else { const v = Number(reviewScores[i]); if (!Number.isNaN(v) && v >= 0) sum += v; }
    });
    return Math.round(sum * 100) / 100;
  };

  const saveReview = async () => {
    if (!reviewAttempt) return;
    const score = Number(reviewTotal);
    if (Number.isNaN(score) || score < 0) return setError(new Error('أدخل الدرجة النهائية الصحيحة'));
    setSavingReview(true); setError(null);
    try {
      await gradeAttemptManually(reviewAttempt.id, Math.min(score, reviewAttempt.max_score));
      toast.success('تم اعتماد الدرجة وتحرير النتيجة للطالب');
      setReviewAttempt(null);
      if (selected) setAttempts(await fetchAttemptsForExam(selected.id));
    } catch (err) { setError(err); }
    finally { setSavingReview(false); }
  };

  return <>
    <PageHeader title="الاختبارات الإلكترونية" subtitle="باني أسئلة بصيغة الورقة الامتحانية المصرية مع معاينة حية فورية ونشر وتصحيح ومحاولات." actions={<Button type="button" variant="secondary" onClick={reset}>+ اختبار جديد</Button>} />
    <ErrorNotice error={error} />

    <div className="exam-builder-layout">
      <div className="stack">
        <Card className="stack">
          <div className="row-between">
            <h2 className="h3">{form.id ? `تعديل: ${form.title || 'اختبار'}` : 'إنشاء اختبار جديد'}</h2>
            <Badge tone={validation ? 'danger' : 'success'}>{validation ? 'راجع بيانات الأسئلة' : `المجموع ${total} درجة`}</Badge>
          </div>
          <form className="stack" onSubmit={submit}>
            <div className="grid grid-3">
              <Input label="عنوان الاختبار" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required />
              <Input label="المادة" value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} />
              <Select label="الصف" value={form.grade_id} onChange={(e) => setForm({ ...form, grade_id: e.target.value })}>
                <option value="">كل الصفوف</option>
                {grades.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
              </Select>
              <Input label="المدة بالدقائق" type="number" value={form.duration} onChange={(e) => setForm({ ...form, duration: e.target.value })} />
              <Input label="عدد المحاولات لكل طالب" type="number" min={1} value={form.attempts} onChange={(e) => setForm({ ...form, attempts: e.target.value })} />
              <Select label="إظهار النتيجة" value={form.show_result} onChange={(e) => setForm({ ...form, show_result: e.target.value as ExamResultMode })}>
                <option value="end">بعد نهاية الاختبار</option>
                <option value="after_each">بعد كل سؤال</option>
                <option value="never">لا تُظهر إلا بعد تحرير جميع النتائج</option>
              </Select>
            </div>

            <div className="row-between">
              <label className="row small muted"><input type="checkbox" checked={form.is_published} onChange={(e) => setForm({ ...form, is_published: e.target.checked })} /> نشر للطلاب</label>
              <div className="row">
                <Button type="button" variant="secondary" onClick={() => setPreview(true)}>👁 معاينة الاختبار</Button>
                <Button disabled={busy} type="submit">{busy ? 'جاري الحفظ...' : '💾 حفظ الاختبار'}</Button>
              </div>
            </div>
            {validation ? <Notice tone="error">{validation}</Notice> : null}
          </form>
        </Card>

        <Card className="stack">
          <h3 className="h3">أنواع الأسئلة — اضغط لإضافة سؤال</h3>
          <div className="exam-type-palette">
            {EGYPT_TYPES.map((t) => (
              <button key={t.type} type="button" className="exam-type-btn" onClick={() => addQuestion(t.type)}>
                <span className="exam-type-icon">{t.icon}</span>
                <span>{t.label}</span>
              </button>
            ))}
          </div>
        </Card>

        <Card className="stack">
          <div className="row-between">
            <h3 className="h3">🎨 زخارف ورقة الاختبار</h3>
            <Button type="button" variant="secondary" onClick={() => setOrnaments({ ...ornaments, kinds: ornamentsForSubject(form.subject).map((o) => o.kind) })}>تعبئة حسب المادة ({subjectLabelFor(form.subject)})</Button>
          </div>
          <div className="grid grid-3">
            <Select label="أسلوب التوزيع" value={ornaments.placement} onChange={(e) => setOrnaments({ ...ornaments, placement: e.target.value as 'auto' | 'manual' })}>
              <option value="auto">تلقائي على الحواف</option>
              <option value="manual">يدوي (أختام)</option>
            </Select>
            <Select label="الكثافة" value={ornaments.density} onChange={(e) => setOrnaments({ ...ornaments, density: e.target.value as ExamOrnaments['density'] })}>
              <option value="low">خفيفة</option>
              <option value="medium">متوسطة</option>
              <option value="high">كثيفة</option>
            </Select>
            <div className="input-wrap"><span className="label">الشفافية: {Math.round((ornaments.opacity ?? 0.18) * 100)}%</span><input className="input" type="range" min={4} max={50} value={Math.round((ornaments.opacity ?? 0.18) * 100)} onChange={(e) => setOrnaments({ ...ornaments, opacity: Number(e.target.value) / 100 })} /></div>
          </div>
          <div className="stack">
            <span className="label">الزخارف المختارة ({ornaments.kinds.length}) — اضغط زخرفة لإزالتها</span>
            <div className="stamp-palette">{ornaments.kinds.length === 0 ? <span className="tiny muted">لا توجد زخارف مختارة — اختر من «كل الزخارف» بالأسفل أو اضغط «تعبئة حسب المادة».</span> : ornaments.kinds.map((k) => <button key={k} type="button" title={k} className="stamp-chip active" onClick={() => setOrnaments({ ...ornaments, kinds: ornaments.kinds.filter((x) => x !== k) })}>{ornamentGlyph(k)}</button>)}</div>
          </div>
          <details>
            <summary className="small muted" style={{ cursor: 'pointer' }}>كل الزخارف ({ALL_ORNAMENTS.length}) — اضغط للإضافة</summary>
            <div className="stamp-palette" style={{ marginTop: 8 }}>
              {ALL_ORNAMENTS.map((o) => {
                const on = ornaments.kinds.includes(o.kind);
                return <button key={o.kind} type="button" title={o.label} className={`stamp-chip ${on ? 'active' : ''}`} onClick={() => setOrnaments({ ...ornaments, kinds: on ? ornaments.kinds.filter((x) => x !== o.kind) : [...ornaments.kinds, o.kind] })}>{o.glyph}</button>;
              })}
            </div>
          </details>
          {ornaments.placement === 'manual' ? <Notice tone="info">وضع الأختام اليدوي يتم من المعاينة (ورقي): اختر ختماً ثم اضغط على الورقة لوضعه، أو استخدم «توزيع عشوائي».</Notice> : null}
        </Card>

        {questions.map((q, i) => (
          <QuestionEditor key={i} q={q} answer={answers[i]} index={i} onQuestion={(next) => updateQuestion(i, next)} onAnswer={(next) => updateAnswer(i, next)} onDelete={() => removeQuestion(i)} onMove={(d) => move(i, d)} />
        ))}

        <Notice tone="info">{questions.length} سؤال · {total} درجة — الأسئلة المتتالية من نفس النوع تُجمع تحت قسم واحد في الورقة.</Notice>
      </div>

      <div className="exam-preview-col">
        <Card className="stack" style={{ position: 'sticky', top: 16 }}>
          <div className="row-between">
            <h2 className="h3">معاينة حية</h2>
            <div className="tabs">
              <button type="button" className={`tab ${previewMode === 'paper' ? 'active' : ''}`} onClick={() => setPreviewMode('paper')}>🖨 ورقي</button>
              <button type="button" className={`tab ${previewMode === 'electronic' ? 'active' : ''}`} onClick={() => setPreviewMode('electronic')}>🖥 إلكتروني</button>
            </div>
          </div>
          <div className="exam-preview-scroll">
            {previewMode === 'paper' ? (
              ornaments.placement === 'manual' ? (
                <StampEditor ornaments={ornaments} onChange={setOrnaments}>
                  <ExamPaper title={form.title || 'عنوان الاختبار'} subject={form.subject} duration={form.duration} total={total} questions={questions} ornaments={null} />
                </StampEditor>
              ) : (
                <ExamPaper title={form.title || 'عنوان الاختبار'} subject={form.subject} duration={form.duration} total={total} questions={questions} ornaments={ornaments} />
              )
            ) : (
              <ElectronicExamView questions={questions} />
            )}
          </div>
          <div className="row">
            <Button type="button" variant="secondary" onClick={() => window.print()}>🖨 طباعة الورقة / PDF</Button>
          </div>
        </Card>
      </div>
    </div>

    <Card className="stack" style={{ marginTop: 18 }}>
      <div className="row-between"><h2 className="h3">الاختبارات المحفوظة</h2><Badge tone="info">{exams.length}</Badge></div>
      {exams.length === 0 ? <EmptyState title="لا توجد اختبارات" /> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>الاختبار</th><th>المادة</th><th>الأسئلة</th><th>الدرجة</th><th>الحالة</th><th>التاريخ</th><th>إجراءات</th></tr></thead>
            <tbody>
              {exams.map((exam) => (
                <tr key={exam.id}>
                  <td><strong>{exam.title}</strong></td>
                  <td>{exam.subject || '—'}</td>
                  <td>{exam.questions.length}</td>
                  <td>{exam.total_score}</td>
                  <td><Badge tone={exam.is_published ? 'success' : 'default'}>{exam.is_published ? 'منشور' : 'مسودة'}</Badge></td>
                  <td>{formatDate(exam.created_at)}</td>
                  <td>
                    <div className="row" style={{ gap: 6 }}>
                      <Button type="button" variant="secondary" onClick={() => void edit(exam)}>تعديل / محاولات</Button>
                      <Button type="button" variant="secondary" onClick={async () => { await toggleExamPublished(exam.id, !exam.is_published); await load(); }}>{exam.is_published ? 'إلغاء النشر' : 'نشر'}</Button>
                      <Button type="button" variant="danger" onClick={() => void remove(exam.id)}>حذف</Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>

    {selected ? (
      <Card className="stack" style={{ marginTop: 18 }}>
        <div className="row-between"><h2 className="h3">محاولات: {selected.title}</h2><Badge tone="info">{attempts.length} محاولة</Badge></div>
        {attempts.length === 0 ? <EmptyState title="لا توجد محاولات بعد" /> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>الطالب</th><th>الدرجة</th><th>الحالة</th><th>التاريخ</th><th>إجراءات</th></tr></thead>
              <tbody>
                {attempts.map((a) => (
                  <tr key={a.id}>
                    <td><strong>{studentName.get(a.student_id) ?? a.student_id}</strong></td>
                    <td>{a.score} / {a.max_score}</td>
                    <td><Badge tone={a.status === 'graded' ? 'success' : 'warn'}>{a.status === 'graded' ? 'مصحّحة' : 'بانتظار المراجعة'}</Badge></td>
                    <td>{formatDate(a.created_at)}</td>
                    <td>
                      <div className="row" style={{ gap: 6, alignItems: 'center' }}>
                        <Button type="button" variant="secondary" onClick={() => openReview(a)}>مراجعة سؤال بسؤال</Button>
                        <input className="input" style={{ width: 84 }} value={manualScores[a.id] ?? ''} onChange={(e) => setManualScores({ ...manualScores, [a.id]: e.target.value })} placeholder="درجة" inputMode="decimal" />
                        <Button type="button" variant="secondary" onClick={() => void grade(a.id)}>اعتماد</Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    ) : null}

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
        ornaments.placement === 'manual' ? (
          <StampEditor ornaments={ornaments} onChange={setOrnaments}>
            <ExamPaper title={form.title} subject={form.subject} duration={form.duration} total={total} questions={questions} ornaments={null} />
          </StampEditor>
        ) : (
          <ExamPaper title={form.title} subject={form.subject} duration={form.duration} total={total} questions={questions} ornaments={ornaments} />
        )
      ) : (
        <ElectronicExamView questions={questions} />
      )}
    </Modal>

    <Modal
      open={!!reviewAttempt}
      title="مراجعة المحاولة سؤالاً بسؤال"
      subtitle={reviewAttempt ? `${studentName.get(reviewAttempt.student_id) ?? reviewAttempt.student_id} · ${reviewAttempt.score} / ${reviewAttempt.max_score}` : ''}
      onClose={() => setReviewAttempt(null)}
      wide
      footer={<div className="row-between">
        <div className="row">
          <Button type="button" variant="secondary" onClick={() => setReviewTotal(String(reviewManualTotal()))}>اعتماد الدرجة المقترحة ({reviewManualTotal()})</Button>
          <label className="row small muted" style={{ gap: 8 }}>الدرجة النهائية<input className="input" style={{ width: 100 }} type="number" min={0} value={reviewTotal} onChange={(e) => setReviewTotal(e.target.value)} /></label>
        </div>
        <Button type="button" disabled={savingReview} onClick={() => void saveReview()}>{savingReview ? 'جارٍ الحفظ...' : 'حفظ وتحرير النتيجة'}</Button>
      </div>}
    >
      {reviewAttempt && selected ? (
        <div className="stack">
          {selected.questions.map((q, i) => {
            const key = selected.answers?.[i];
            const given = (reviewAttempt.answers ?? [])[i];
            const r = suggestGrade(q, key, given);
            const manual = r.correct === null;
            const tone = r.correct === true ? 'success' : r.correct === false ? 'danger' : 'warn';
            return (
              <div key={i} className={`card compact soft stack ${r.correct === true ? 'review-correct' : r.correct === false ? 'review-wrong' : ''}`} style={{ gap: 8 }}>
                <div className="row-between">
                  <strong style={{ flex: 1 }}>{i + 1}. {q.q}</strong>
                  <div className="row" style={{ gap: 8 }}>
                    <Badge tone="info">{EXAM_TYPE_LABEL[q.type] ?? q.type} · {q.marks} درجة</Badge>
                    {manual ? <label className="row tiny muted" style={{ gap: 6 }}>درجة يدوية<input className="input" style={{ width: 76 }} type="number" min={0} max={q.marks} value={reviewScores[i] ?? ''} onChange={(e) => setReviewScores({ ...reviewScores, [i]: e.target.value })} /></label> : <Badge tone={tone as 'success' | 'danger' | 'warn'}>{r.earned} / {q.marks}</Badge>}
                  </div>
                </div>
                <div className="row small notice" style={{ border: '1px solid var(--border)' }}>
                  <span style={{ flex: 1 }}><b>إجابة الطالب: </b>{answerLabel(q, given)}</span>
                </div>
                <div className="row small notice" style={{ background: 'var(--success)14', border: '1px solid var(--success)44' }}>
                  <span><b>الإجابة النموذجية: </b>{correctLabel(q, key)}</span>
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
    </Modal>
  </>;
}
