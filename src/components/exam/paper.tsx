'use client';

// ============================================================
// ورقة الاختبار (للطباعة والمعاينة) — مطابقة لقالب الامتحان المصري:
// ترويسة + سطر بيانات الطالب + أسئلة بأنواعها + صورة السؤال
// بجانب النص + زخارف الحواف (تلقائية أو أختام يدوية).
// ============================================================

import type { ExamOrnaments, ExamQuestion } from '@/lib/types';
import { EXAM_TYPE_LABEL } from '@/lib/utils';
import { PaperOrnaments, QuestionImage } from './ornaments';

export function ExamPaper({
  title,
  subject,
  duration,
  total,
  questions,
  ornaments,
  centerName,
}: {
  title: string;
  subject: string;
  duration: number | string;
  total: number;
  questions: ExamQuestion[];
  ornaments?: ExamOrnaments | null;
  centerName?: string | null;
}) {
  return (
    <div className="exam-paper" dir="rtl">
      <PaperOrnaments ornaments={ornaments} />
      <div className="exam-paper-inner">
        <div className="exam-paper-head">
          {centerName ? <div className="exam-paper-center">{centerName}</div> : null}
          <h2 className="exam-paper-title">{title || 'اختبار'}</h2>
          <div className="exam-paper-sub">
            {subject ? <span>المادة: {subject}</span> : null}
            {subject ? ' · ' : ''}الزمن: {duration} دقيقة · الدرجة: {total}
          </div>
        </div>
        <div className="exam-paper-meta">
          <span>الاسم: ________________________</span>
          <span>المجموعة: ____________</span>
          <span>التاريخ: ____ / ____ / ________</span>
        </div>
        <div className="exam-paper-body">
          {questions.map((q, i) => (
            <div key={i} className="exam-paper-q">
              <div className={`exam-paper-q-row ${q.image && q.imagePosition !== 'above' && q.imagePosition !== 'below' ? 'has-image' : ''}`}>
                {q.image && (q.imagePosition === 'above') ? <QuestionImage q={q} mode="paper" /> : null}
                <div className="exam-paper-q-text">
                  <div className="exam-paper-q-line">
                    <span className="exam-paper-q-no">{i + 1}.</span>
                    <span className="exam-paper-q-body">{q.q}</span>
                    <span className="exam-paper-q-marks">({q.marks} درجة)</span>
                  </div>
                  <div className="exam-paper-q-answers">
                    {q.type === 'mcq' || q.type === 'multi' ? (
                      <div className="exam-paper-choices">
                        {q.choices.slice(0, 4).map((c, j) => (
                          <div key={j} className="exam-paper-choice">
                            <span className="exam-paper-choice-mark">{q.type === 'mcq' ? '◯' : '□'}</span>
                            <span>{['أ', 'ب', 'ج', 'د'][j]}.</span>
                            <span>{c || '—'}</span>
                          </div>
                        ))}
                      </div>
                    ) : null}
                    {q.type === 'tf' ? <div className="exam-paper-choice"><span className="exam-paper-choice-mark">◯</span> صح &nbsp;&nbsp;&nbsp; <span className="exam-paper-choice-mark">◯</span> خطأ</div> : null}
                    {q.type === 'complete' || q.type === 'essay' || q.type === 'short' || q.type === 'correct' ? (
                      <div className="exam-paper-lines">
                        {Array.from({ length: q.type === 'essay' ? 2 : 1 }, (_, n) => <div key={n} className="exam-paper-dots" />)}
                      </div>
                    ) : null}
                    {q.type === 'match' ? (
                      <div className="exam-paper-match">
                        {(q.pairs ?? []).map((p, j) => (
                          <div key={j} className="exam-paper-match-row">
                            <span className="exam-paper-match-l">{p.l}</span>
                            <span className="exam-paper-match-blank" />
                            <span className="exam-paper-match-r">{p.r}</span>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </div>
                {q.image && q.imagePosition !== 'above' && q.imagePosition !== 'below' ? <QuestionImage q={q} mode="paper" /> : null}
              </div>
              {q.image && q.imagePosition === 'below' ? <QuestionImage q={q} mode="paper" /> : null}
            </div>
          ))}
        </div>
        <div className="exam-paper-footer">بالتوفيق والنجاح 🌟</div>
      </div>
    </div>
  );
}

/** المعاينة الإلكترونية (كما يراها الطالب) مع صورة السؤال فوق/تحت */
export function ElectronicExamView({ questions }: { questions: ExamQuestion[] }) {
  return (
    <div className="stack">
      {questions.map((q, i) => (
        <div key={i} className="card compact soft stack">
          <div className="row-between">
            <strong>{i + 1}. {q.q}</strong>
            <span className="badge info">{EXAM_TYPE_LABEL[q.type] ?? q.type} · {q.marks} درجة</span>
          </div>
          {q.image && q.imagePosition !== 'below' ? <QuestionImage q={q} mode="screen" /> : null}
          {q.type === 'mcq' || q.type === 'multi' ? (
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
          {q.type === 'complete' || q.type === 'essay' || q.type === 'short' || q.type === 'correct' ? (
            <div className="input-wrap"><span className="label">إجابة الطالب</span><input className="input" disabled placeholder="يكتب الطالب إجابته هنا" /></div>
          ) : null}
          {q.image && q.imagePosition === 'below' ? <QuestionImage q={q} mode="screen" /> : null}
        </div>
      ))}
    </div>
  );
}
