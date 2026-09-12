'use client';

import { useEffect, useState } from 'react';
import { Badge, Button, Card, EmptyState, ErrorNotice, Input, Notice, PageHeader, formatStatus } from '@/components/ui';
import { fetchMyExamAttempts, fetchPublishedExams, submitExam } from '@/lib/api';
import type { ExamAnswer, ExamAttempt, ExamQuestion, PublishedExam } from '@/lib/types';
import { EXAM_TYPE_LABEL, formatDate, normalizeAnswerText } from '@/lib/utils';
import { useSession } from '@/context/session';

function defaultAnswer(q: ExamQuestion): ExamAnswer {
  if (q.type === 'multi' || q.type === 'match') return [];
  if (q.type === 'complete' || q.type === 'correct' || q.type === 'essay' || q.type === 'short') return '';
  return null;
}

function QuestionInput({ q, value, onChange }: { q: ExamQuestion; value: ExamAnswer; onChange: (v: ExamAnswer) => void }) {
  if (q.type === 'mcq' || q.type === 'tf') {
    const choices = q.type === 'tf' && (!q.choices || q.choices.length === 0) ? ['صح', 'خطأ'] : q.choices;
    return <div className="tabs">{choices.map((c, i) => <button type="button" key={i} className={`tab ${value === i ? 'active' : ''}`} onClick={() => onChange(i)}>{c}</button>)}</div>;
  }
  if (q.type === 'multi') {
    const arr = Array.isArray(value) ? value : [];
    return <div className="stack">{q.choices.map((c, i) => <label key={i} className="row small"><input type="checkbox" checked={arr.includes(i)} onChange={(e) => onChange(e.target.checked ? [...arr, i] : arr.filter((x) => x !== i))} /> {c}</label>)}</div>;
  }
  if (q.type === 'match') {
    const arr = Array.isArray(value) ? value : [];
    const pairs = q.pairs ?? [];
    return <div className="stack">{pairs.map((p, i) => <div key={i} className="grid grid-2"><div className="notice">{p.l}</div><select className="select" value={arr[i] ?? ''} onChange={(e) => { const next = [...arr]; next[i] = Number(e.target.value); onChange(next); }}><option value="">اختر المطابق</option>{pairs.map((x, idx) => <option key={idx} value={idx}>{x.r}</option>)}</select></div>)}</div>;
  }
  return <Input label="إجابتك" value={typeof value === 'string' ? value : ''} onChange={(e) => onChange(e.target.value)} />;
}

export default function StudentExamsPage() {
  const { profile } = useSession();
  const [exams, setExams] = useState<PublishedExam[]>([]);
  const [attempts, setAttempts] = useState<ExamAttempt[]>([]);
  const [active, setActive] = useState<PublishedExam | null>(null);
  const [answers, setAnswers] = useState<ExamAnswer[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = async () => { setError(null); try { const [e, a] = await Promise.all([fetchPublishedExams(), profile?.student_id ? fetchMyExamAttempts(profile.student_id) : Promise.resolve([])]); setExams(e); setAttempts(a); } catch (err) { setError(err); } };
  useEffect(() => { void load(); }, [profile?.student_id]);
  const start = (exam: PublishedExam) => { setActive(exam); setAnswers(exam.questions.map(defaultAnswer)); setMessage(null); setError(null); };
  const submit = async () => {
    if (!active) return;
    setBusy(true); setError(null); setMessage(null);
    try {
      // تطبيع الإجابات بنفس طريقة تطبيق Android (complete نص مطبَّع، multi مرتب)
      const clean = active.questions.map((q, i) => {
        const a = answers[i];
        if ((q.type === 'complete' || q.type === 'correct') && typeof a === 'string') return normalizeAnswerText(a);
        if (q.type === 'multi' && Array.isArray(a)) return [...(a as number[])].sort((x, y) => x - y);
        return a;
      });
      const res = await submitExam(active.id, clean);
      setMessage(`تم التسليم. نتيجتك ${res.score} من ${res.max_score} — ${res.status === 'pending_review' ? 'بانتظار المراجعة' : 'تم التصحيح'}`);
      setActive(null);
      await load();
    } catch (err) { setError(err); }
    finally { setBusy(false); }
  };

  return <>
    <PageHeader title="اختباراتي" subtitle="الاختبارات المنشورة من السنتر." />
    <ErrorNotice error={error} />{message ? <Notice tone="success">{message}</Notice> : null}
    {!active ? <Card className="stack"><div className="row-between"><h2 className="h3">المتاح</h2><Badge tone="info">{exams.length}</Badge></div>{exams.length === 0 ? <EmptyState title="لا توجد اختبارات منشورة" /> : exams.map((e) => { const done = attempts.some((a) => a.exam_id === e.id); return <div key={e.id} className="card compact soft stack"><div className="row-between"><strong>{e.title}</strong><Badge tone={done ? 'success' : 'info'}>{done ? 'تمت المحاولة' : 'متاح'}</Badge></div><p className="muted small">{e.subject || 'بدون مادة'} · {e.questions.length} سؤال · {e.total_score} درجة · {e.duration_minutes} دقيقة · {formatDate(e.created_at)}</p><Button type="button" disabled={done} onClick={() => start(e)}>{done ? 'تم أداء الاختبار' : 'بدء الاختبار'}</Button></div>; })}</Card> : <Card className="stack"><div className="row-between"><div><h2 className="h3">{active.title}</h2><p className="muted small">{active.duration_minutes} دقيقة · {active.total_score} درجة</p></div><Button variant="secondary" type="button" onClick={() => setActive(null)}>خروج</Button></div>{active.questions.map((q, i) => <div key={i} className="card compact soft stack"><div className="row-between"><Badge tone="info">{EXAM_TYPE_LABEL[q.type] ?? q.type}</Badge><Badge>{q.marks} درجة</Badge></div><strong>{i + 1}. {q.q}</strong><QuestionInput q={q} value={answers[i]} onChange={(v) => setAnswers((old) => old.map((x, idx) => idx === i ? v : x))} /></div>)}<Button disabled={busy} type="button" onClick={submit}>{busy ? 'جاري التسليم...' : 'تسليم الاختبار'}</Button></Card>}
    <Card className="stack" style={{ marginTop: 18 }}><h2 className="h3">محاولاتي السابقة</h2>{attempts.length === 0 ? <EmptyState title="لا توجد محاولات" /> : <div className="table-wrap"><table><thead><tr><th>الاختبار</th><th>الدرجة</th><th>الحالة</th><th>التاريخ</th></tr></thead><tbody>{attempts.map((a) => { const st = formatStatus(a.status); return <tr key={a.id}><td>{exams.find((e) => e.id === a.exam_id)?.title ?? a.exam_id}</td><td>{a.score} / {a.max_score}</td><td><Badge tone={st.tone}>{st.text}</Badge></td><td>{formatDate(a.created_at)}</td></tr>; })}</tbody></table></div>}</Card>
  </>;
}
