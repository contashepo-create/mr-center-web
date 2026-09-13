'use client';

import { useMemo, useState } from 'react';
import { Badge, Button, Card, EmptyState, Select } from '@/components/ui';
import { answerToText, QUESTION_TYPE_LABELS, surveyStats } from '@/lib/survey';
import type { AppSurvey, AppSurveyResponse, Student, SurveyQuestion } from '@/lib/types';
import { formatDate } from '@/lib/utils';

type QuestionFilter = 'all' | string;

function percent(value: number, total: number): number {
  return total ? Math.round((value / total) * 100) : 0;
}

function responseText(question: SurveyQuestion, response: AppSurveyResponse): string {
  return answerToText(question, response.answers?.[question.id]);
}

/** لوحة نتائج الاستبيان: ملخص قابل للقراءة ثم تحليل سؤالاً بسؤال، مع قائمة الردود الأصلية. */
export function SurveyResultsDashboard({
  survey,
  responses,
  students,
  targetCount,
  loading = false,
  onExport,
}: {
  survey: AppSurvey;
  responses: AppSurveyResponse[];
  students: Student[];
  targetCount: number;
  loading?: boolean;
  onExport: () => void;
}) {
  const [filter, setFilter] = useState<QuestionFilter>('all');
  const [showResponses, setShowResponses] = useState(false);
  const stats = useMemo(() => surveyStats(survey, responses), [survey, responses]);
  const studentName = useMemo(() => new Map(students.map((student) => [student.id, student.name])), [students]);
  const completion = percent(responses.length, targetCount);
  const lastResponse = responses.reduce<string | null>((last, response) => !last || response.created_at > last ? response.created_at : last, null);
  const filtered = filter === 'all' ? stats : stats.filter((item) => item.question.id === filter);

  if (loading) return <Card className="survey-results-loading"><span className="spinner" /> جارٍ تحميل الإجابات والتحليل…</Card>;

  return <div className="survey-results-dashboard stack">
    <section className="survey-results-overview">
      <div className="survey-results-overview-copy">
        <span className="survey-results-kicker">لوحة المراجعة والتحليل</span>
        <h2>{survey.title}</h2>
        <p>{survey.description || 'نتائج إجابات الطلاب على هذا الاستبيان.'}</p>
      </div>
      <div className="row survey-results-actions"><Button type="button" variant="secondary" onClick={onExport}>⇩ تصدير Excel / CSV</Button></div>
    </section>

    <div className="grid grid-4 survey-result-kpis">
      <Card className="compact kpi workspace-stat purple"><span className="workspace-stat-icon">◉</span><span className="muted">إجمالي الردود</span><div className="kpi-value">{responses.length}</div></Card>
      <Card className="compact kpi workspace-stat blue"><span className="workspace-stat-icon">◎</span><span className="muted">الطلاب المستهدفون</span><div className="kpi-value">{targetCount || '—'}</div></Card>
      <Card className="compact kpi workspace-stat green"><span className="workspace-stat-icon">↗</span><span className="muted">نسبة المشاركة</span><div className="kpi-value">{targetCount ? `${completion}%` : '—'}</div></Card>
      <Card className="compact kpi workspace-stat amber"><span className="workspace-stat-icon">◷</span><span className="muted">آخر رد</span><div className="kpi-value survey-last-response">{lastResponse ? formatDate(lastResponse) : '—'}</div></Card>
    </div>

    <Card className="survey-result-progress stack" style={{ gap: 8 }}>
      <div className="row-between"><div><strong>معدل الاستجابة</strong><p className="tiny muted">{targetCount ? `${responses.length} من ${targetCount} طالب مستهدف` : `${responses.length} رد مسجل`}</p></div><Badge tone={completion >= 75 ? 'success' : completion >= 40 ? 'warn' : 'info'}>{targetCount ? `${completion}%` : 'بدون جمهور محسوب'}</Badge></div>
      {targetCount ? <div className="progress-track"><div className="progress-fill" style={{ width: `${Math.min(100, completion)}%` }} /></div> : null}
    </Card>

    {responses.length === 0 ? <EmptyState title="لا توجد إجابات حتى الآن" body="ستظهر نسب الاختيارات والتقييمات والتعليقات فور إرسال أول طالب لرده." /> : <>
      <div className="survey-results-toolbar">
        <div><strong>تحليل الأسئلة</strong><span>{stats.length} أسئلة · يُحسب كل سؤال على من أجاب عنه فعلاً</span></div>
        <Select label="" value={filter} onChange={(event) => setFilter(event.target.value)}><option value="all">كل الأسئلة</option>{stats.map((item, index) => <option key={item.question.id} value={item.question.id}>{index + 1}. {item.question.title}</option>)}</Select>
      </div>
      <div className="survey-question-results">
        {filtered.map((stat) => {
          const questionNumber = stats.findIndex((item) => item.question.id === stat.question.id) + 1;
          return <article key={stat.question.id} className="survey-question-result">
            <header><div className="survey-question-number">{questionNumber}</div><div><h3>{stat.question.title}</h3><p>{QUESTION_TYPE_LABELS[stat.question.type]} · أجاب {stat.answered} من {responses.length} ({percent(stat.answered, responses.length)}%)</p></div>{stat.average !== null ? <div className="survey-rating-average"><strong>{stat.average}</strong><span>/ {stat.question.maxRating || 5}</span><small>المتوسط</small></div> : null}</header>
            {stat.question.type === 'text' ? <div className="survey-text-responses">{responses.filter((response) => responseText(stat.question, response) !== '—').map((response) => <article className="survey-text-response" key={response.id}><p>“{responseText(stat.question, response)}”</p><small>{survey.anonymous ? 'رد مجهول' : studentName.get(response.student_id) ?? 'طالب'} · {formatDate(response.created_at)}</small></article>)}</div> : <div className="survey-distribution">{stat.counts.map((count) => { const ratio = percent(count.count, stat.answered); return <div className="survey-distribution-row" key={count.label}><div className="survey-distribution-label"><span>{count.label}</span><strong>{count.count} <small>({ratio}%)</small></strong></div><div className="survey-distribution-track"><div style={{ width: `${ratio}%` }} /></div></div>; })}</div>}
          </article>;
        })}
      </div>
      <Card className="stack survey-response-records">
        <div className="row-between"><div><h3 className="h3">الردود التفصيلية</h3><p className="muted tiny">راجع كل استجابة كما أرسلها الطالب عند الحاجة.</p></div><Button type="button" variant="secondary" onClick={() => setShowResponses((value) => !value)}>{showResponses ? 'إخفاء الجدول' : `عرض ${responses.length} رد`}</Button></div>
        {showResponses ? <div className="table-wrap"><table><thead><tr><th>{survey.anonymous ? 'الهوية' : 'الطالب'}</th>{survey.questions.map((question) => <th key={question.id}>{question.title}</th>)}<th>وقت الإرسال</th></tr></thead><tbody>{responses.map((response) => <tr key={response.id}><td>{survey.anonymous ? 'مجهول' : studentName.get(response.student_id) ?? response.student_id}</td>{survey.questions.map((question) => <td key={question.id}>{responseText(question, response)}</td>)}<td>{formatDate(response.created_at)}</td></tr>)}</tbody></table></div> : null}
      </Card>
    </>}
  </div>;
}
