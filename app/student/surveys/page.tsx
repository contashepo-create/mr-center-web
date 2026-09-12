'use client';

import { useEffect, useState } from 'react';
import { Badge, Button, Card, EmptyState, ErrorNotice, Input, Notice, PageHeader } from '@/components/ui';
import { useSession } from '@/context/session';
import { fetchActiveSurveys, fetchMySurveyResponses, submitSurveyResponse } from '@/lib/api';
import type { AppSurvey, AppSurveyResponse } from '@/lib/types';
import { formatDate } from '@/lib/utils';

export default function StudentSurveysPage() {
  const { profile } = useSession();
  const [surveys, setSurveys] = useState<AppSurvey[]>([]);
  const [responses, setResponses] = useState<AppSurveyResponse[]>([]);
  const [active, setActive] = useState<AppSurvey | null>(null);
  const [answers, setAnswers] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [message, setMessage] = useState<string | null>(null);
  const load = async () => { if (!profile?.center_id || !profile.student_id) return; try { const [s, r] = await Promise.all([fetchActiveSurveys(profile.center_id), fetchMySurveyResponses(profile.student_id)]); setSurveys(s); setResponses(r); } catch (err) { setError(err); } };
  useEffect(() => { void load(); }, [profile?.center_id, profile?.student_id]);
  const start = (s: AppSurvey) => { setActive(s); setAnswers(s.questions.map(() => '')); setError(null); setMessage(null); };
  const submit = async () => { if (!active || !profile?.center_id || !profile.student_id) return; setBusy(true); setError(null); try { await submitSurveyResponse({ centerId: profile.center_id, surveyId: active.id, studentId: profile.student_id, answers }); setActive(null); setMessage('تم إرسال إجابتك.'); await load(); } catch (err) { setError(err); } finally { setBusy(false); } };
  return <><PageHeader title="استبياناتي" subtitle="الاستبيانات النشطة من السنتر." /><ErrorNotice error={error} />{message ? <Notice tone="success">{message}</Notice> : null}{!active ? <Card className="stack"><div className="row-between"><h2 className="h3">المتاح</h2><Badge tone="info">{surveys.length}</Badge></div>{surveys.length === 0 ? <EmptyState title="لا توجد استبيانات" /> : surveys.map((s) => { const done = responses.some((r) => r.survey_id === s.id); return <div key={s.id} className="card compact soft stack"><div className="row-between"><strong>{s.title}</strong><Badge tone={done ? 'success' : 'info'}>{done ? 'تمت الإجابة' : 'متاح'}</Badge></div><p className="muted small">{s.questions.length} أسئلة · {formatDate(s.created_at)}</p><Button disabled={done} type="button" onClick={() => start(s)}>{done ? 'تمت الإجابة' : 'إجابة الاستبيان'}</Button></div>; })}</Card> : <Card className="stack"><div className="row-between"><h2 className="h3">{active.title}</h2><Button type="button" variant="secondary" onClick={() => setActive(null)}>إلغاء</Button></div>{active.questions.map((q, i) => <Input key={i} label={`${i + 1}. ${q}`} value={answers[i] ?? ''} onChange={(e) => setAnswers((old) => old.map((x, idx) => idx === i ? e.target.value : x))} />)}<Button disabled={busy} type="button" onClick={submit}>إرسال الإجابات</Button></Card>}</>;
}
