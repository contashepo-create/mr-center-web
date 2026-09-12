'use client';

import { useEffect, useMemo, useState } from 'react';
import { Badge, Button, Card, EmptyState, ErrorNotice, Input, Notice, PageHeader } from '@/components/ui';
import { useSession } from '@/context/session';
import { fetchActiveSurveys, fetchMySurveyResponses, fetchStudentById, fetchStudentGroups, submitSurveyResponse } from '@/lib/api';
import { deadlineLabel, emptyAnswer, isAnswered, isSurveyOpen, QUESTION_TYPE_LABELS, surveyForStudent, YES, NO } from '@/lib/survey';
import type { AppSurvey, AppSurveyResponse, SurveyAnswer } from '@/lib/types';
import { formatDate } from '@/lib/utils';

export default function StudentSurveysPage() {
  const { profile } = useSession();
  const [surveys, setSurveys] = useState<AppSurvey[]>([]);
  const [responses, setResponses] = useState<AppSurveyResponse[]>([]);
  const [active, setActive] = useState<AppSurvey | null>(null);
  const [answers, setAnswers] = useState<Record<string, SurveyAnswer>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = async () => {
    if (!profile?.center_id || !profile.student_id) return;
    try {
      const [s, r, st, extra] = await Promise.all([
        fetchActiveSurveys(profile.center_id),
        fetchMySurveyResponses(profile.student_id),
        fetchStudentById(profile.student_id),
        fetchStudentGroups(profile.student_id),
      ]);
      setSurveys(s.filter((x) => st ? surveyForStudent(x, st, extra.map((g) => g.group_id)) : true));
      setResponses(r);
    } catch (err) { setError(err); }
  };
  useEffect(() => { void load(); }, [profile?.center_id, profile?.student_id]);

  const start = (s: AppSurvey) => {
    setActive(s);
    const init: Record<string, SurveyAnswer> = {};
    for (const q of s.questions) init[q.id] = emptyAnswer(q);
    setAnswers(init);
    setError(null); setMessage(null);
  };

  const setAnswer = (q: AppSurvey['questions'][number], patch: Partial<SurveyAnswer>) => {
    setAnswers((old) => ({ ...old, [q.id]: { ...(old[q.id] ?? emptyAnswer(q)), ...patch } }));
  };
  const toggleChoice = (q: AppSurvey['questions'][number], opt: string, multi: boolean) => {
    setAnswers((old) => {
      const cur = old[q.id] ?? emptyAnswer(q);
      const choice = [...(cur.choice ?? [])];
      const idx = choice.indexOf(opt);
      if (multi) { if (idx >= 0) choice.splice(idx, 1); else choice.push(opt); }
      else { if (idx >= 0) choice.splice(idx, 1); else { choice.length = 0; choice.push(opt); } }
      return { ...old, [q.id]: { ...cur, choice } };
    });
  };

  const submit = async () => {
    if (!active || !profile?.center_id || !profile.student_id) return;
    const missing = active.questions.find((q) => q.required && !isAnswered(answers[q.id]));
    if (missing) { setError(new Error(`أجب عن السؤال الإجباري: ${missing.title}`)); return; }
    setBusy(true); setError(null);
    try {
      await submitSurveyResponse({ centerId: profile.center_id, surveyId: active.id, studentId: profile.student_id, answers, lockAfterSubmit: active.lock_after_submit });
      setActive(null); setMessage('تم إرسال إجابتك.'); await load();
    } catch (err) {
      if (String((err as any)?.message ?? '').includes('already_answered')) setError(new Error('أُرسلت إجابتك ولا يمكن تعديلها.'));
      else setError(err);
    } finally { setBusy(false); }
  };

  const doneIds = useMemo(() => new Set(responses.map((r) => r.survey_id)), [responses]);

  return <>
    <PageHeader title="استبياناتي" subtitle="أجب عن استبيانات السنتر النشطة الموجهة إليك." />
    <ErrorNotice error={error} />
    {message ? <Notice tone="success">{message}</Notice> : null}
    {!active ? (
      <Card className="stack">
        <div className="row-between"><h2 className="h3">المتاح</h2><Badge tone="info">{surveys.length}</Badge></div>
        {surveys.length === 0 ? <EmptyState title="لا توجد استبيانات" body="لم يوجّه لك أي استبيان نشط حالياً." /> : surveys.map((s) => {
          const done = doneIds.has(s.id);
          const open = isSurveyOpen(s);
          return <div key={s.id} className="card compact soft stack">
            <div className="row-between"><strong>{s.title}</strong><Badge tone={done ? 'success' : open ? 'info' : 'default'}>{done ? 'تمت الإجابة' : open ? 'متاح' : 'منتهي'}</Badge></div>
            {s.description ? <p className="muted small">{s.description}</p> : null}
            <p className="muted tiny">{s.questions.length} أسئلة · {deadlineLabel(s)} · {formatDate(s.created_at)}</p>
            <Button disabled={done || !open} type="button" onClick={() => start(s)}>{done ? (s.lock_after_submit ? 'مقفلة' : 'تمت الإجابة') : open ? 'إجابة الاستبيان' : 'منتهي'}</Button>
          </div>;
        })}
      </Card>
    ) : (
      <Card className="stack">
        <div className="row-between"><h2 className="h3">{active.title}</h2><Button type="button" variant="secondary" onClick={() => setActive(null)}>إلغاء</Button></div>
        {active.description ? <p className="muted small">{active.description}</p> : null}
        {active.anonymous ? <Notice tone="info">إجاباتك مجهولة — لن يظهر اسمك في النتائج.</Notice> : null}
        {active.questions.map((q, i) => (
          <div key={q.id} className="card compact soft stack" style={{ gap: 8 }}>
            <div className="row-between"><strong>{i + 1}. {q.title}</strong><span className="tiny muted">{QUESTION_TYPE_LABELS[q.type]}{q.required ? ' · إجباري' : ''}</span></div>
            {q.type === 'single' || q.type === 'multi' ? (
              <div className="stack" style={{ gap: 6 }}>
                {(q.options ?? []).map((o) => (
                  <label key={o} className="row small" style={{ alignItems: 'center', gap: 8 }}>
                    <input type={q.type === 'multi' ? 'checkbox' : 'radio'} name={q.id} checked={(answers[q.id]?.choice ?? []).includes(o)} onChange={() => toggleChoice(q, o, q.type === 'multi')} />
                    <span>{o}</span>
                  </label>
                ))}
              </div>
            ) : null}
            {q.type === 'yesno' ? (
              <div className="row" style={{ gap: 10 }}>
                {[YES, NO].map((o) => (
                  <Button key={o} type="button" variant={(answers[q.id]?.choice ?? []).includes(o) ? 'primary' : 'secondary'} onClick={() => toggleChoice(q, o, false)}>{o}</Button>
                ))}
              </div>
            ) : null}
            {q.type === 'rating' ? (
              <div className="row" style={{ gap: 8 }}>
                {Array.from({ length: q.maxRating || 5 }, (_, k) => k + 1).map((v) => (
                  <button key={v} type="button" className={`rate-dot ${(answers[q.id]?.rating ?? 0) >= v ? 'on' : ''}`} onClick={() => setAnswer(q, { rating: v })} aria-label={`${v} من ${q.maxRating || 5}`}>{v}</button>
                ))}
                <span className="tiny muted">{(answers[q.id]?.rating || 0) > 0 ? `${answers[q.id]?.rating} / ${q.maxRating || 5}` : 'اختر تقييماً'}</span>
              </div>
            ) : null}
            {q.type === 'text' ? (
              <Input label={q.placeholder || 'إجابتك'} value={answers[q.id]?.text ?? ''} onChange={(e) => setAnswer(q, { text: e.target.value })} />
            ) : null}
          </div>
        ))}
        <Button disabled={busy} type="button" onClick={submit}>{busy ? 'جارٍ الإرسال...' : 'إرسال الإجابات'}</Button>
      </Card>
    )}
  </>;
}
