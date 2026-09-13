'use client';

// ============================================================
// ورقة الاختبار (للطباعة والمعاينة) — مطابقة للورقة الامتحانية
// المصرية في النسخة الأصلية:
// ترويسة + بيانات الطالب + أقسام أسئلة معنونة (السؤال الأول...)
// بترقيم عربي هندي وأسطر نقاط + زخارف حواف تلقائية أو أختام يدوية
// + صورة السؤال حسب المكان والحجم المختارين.
// ============================================================

import type { ExamOrnaments, ExamQuestion, PaperTemplate } from '@/lib/types';
import { EXAM_TYPE_LABEL } from '@/lib/utils';
import { arabicNum, CHOICE_KEYS, paperSections } from '@/lib/exam-egyptian';
import { PaperOrnaments, QuestionImage } from './ornaments';

export function ExamPaper({
  title,
  subject,
  duration,
  total,
  questions,
  ornaments,
  centerName,
  template = 'classic',
}: {
  title: string;
  subject: string;
  duration: number | string;
  total: number;
  questions: ExamQuestion[];
  ornaments?: ExamOrnaments | null;
  centerName?: string | null;
  template?: PaperTemplate;
}) {
  const sections = paperSections(questions);
  return (
    <div className={`exam-paper exam-paper-${template}`} dir="rtl">
      <PaperOrnaments ornaments={ornaments} />
      <div className="exam-paper-inner">
        <div className="exam-paper-head">
          {centerName ? <div className="exam-paper-center">{centerName}</div> : null}
          <h2 className="exam-paper-title">{title || 'اختبار'}</h2>
          <div className="exam-paper-sub">
            {subject ? <span>المادة: {subject}</span> : null}
            {subject ? ' · ' : ''}الزمن: {duration} دقيقة · الدرجة الكلية: {total}
          </div>
        </div>
        <div className="exam-paper-meta">
          <span>اسم الطالب: <i className="exam-blank" /></span>
          <span>الفصل / المجموعة: <i className="exam-blank small" /></span>
          <span>التاريخ: ____ / ____ / ________</span>
        </div>

        <div className="exam-paper-body">
          {sections.map((sec, si) => (
            <section key={si} className="exam-paper-section">
              <div className="exam-paper-sec-head">
                <h3 className="exam-paper-sec-title">
                  <span className="exam-paper-sec-mark">{sec.meta.paperMark}</span>
                  السؤال {['الأول', 'الثاني', 'الثالث', 'الرابع', 'الخامس', 'السادس', 'السابع', 'الثامن', 'التاسع', 'العاشر'][si] ?? arabicNum(si + 1)}: {sec.header}
                </h3>
                <span className="exam-paper-sec-marks">({sec.marks} درجة)</span>
              </div>
              <div className="exam-paper-sec-items">
                {sec.items.map((q, qi) => (
                  <ExamItem key={qi} q={q} index={qi} />
                ))}
              </div>
            </section>
          ))}
        </div>

        <div className="exam-paper-footer">انتهت الأسئلة — بالتوفيق والنجاح 🌟</div>
      </div>
    </div>
  );
}

function answerLines(q: ExamQuestion): number {
  if (q.type === 'essay') return Math.min(4, Math.max(2, Math.ceil((Number(q.marks) || 2) / 2)));
  if (q.type === 'short' || q.type === 'correct') return 1;
  return 0;
}

function ExamItem({ q, index }: { q: ExamQuestion; index: number }) {
  const num = arabicNum(index + 1);
  const lines = answerLines(q);

  return (
    <div className="exam-paper-item">
      <div className={`exam-paper-q-row ${q.image && q.imagePosition !== 'above' && q.imagePosition !== 'below' ? 'has-image' : ''}`}>
        {q.image && q.imagePosition === 'above' ? <QuestionImage q={q} mode="paper" /> : null}
        <div className="exam-paper-q-text">
          {/* نص السؤال */}
          {q.type === 'complete' ? (
            <p className="exam-paper-q-body">
              <span className="exam-paper-q-no">{num} – </span>
              {q.q || '........................'} <i className="exam-blank inline" />
            </p>
          ) : (
            <p className="exam-paper-q-body">
              <span className="exam-paper-q-no">{num} – </span>
              {q.q}
            </p>
          )}

          {/* الاختيارات */}
          {q.type === 'mcq' || q.type === 'multi' ? (
            <div className="exam-paper-choices">
              {q.choices.slice(0, 4).map((c, j) => (
                <div key={j} className="exam-paper-choice">
                  <span className="exam-paper-choice-mark">{q.type === 'mcq' ? '◯' : '□'}</span>
                  <span className="exam-paper-choice-key">{CHOICE_KEYS[j] ?? j + 1})</span>
                  <span>{c || '—'}</span>
                </div>
              ))}
            </div>
          ) : null}

          {/* صح / خطأ */}
          {q.type === 'tf' ? (
            <div className="exam-paper-tf">
              <span className="exam-paper-tf-box">( &nbsp;&nbsp;&nbsp;&nbsp; )</span>
              <span className="exam-paper-tf-hint">√ أو ×</span>
            </div>
          ) : null}

          {/* أسطر الإجابة للمقالي / التعريف / صحّح الخطأ / القصير */}
          {q.type === 'essay' || q.type === 'short' || q.type === 'correct' ? (
            <div className="exam-paper-lines">
              {Array.from({ length: lines }).map((_, n) => <div key={n} className="exam-paper-dots" />)}
            </div>
          ) : null}

          {/* التوصيل */}
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
        {q.image && q.imagePosition !== 'above' && q.imagePosition !== 'below' ? <QuestionImage q={q} mode="paper" /> : null}
      </div>
      {q.image && q.imagePosition === 'below' ? <QuestionImage q={q} mode="paper" /> : null}
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
            <strong>{arabicNum(i + 1)}. {q.q}</strong>
            <span className="badge info">{EXAM_TYPE_LABEL[q.type] ?? q.type} · {q.marks} درجة</span>
          </div>
          {q.image && q.imagePosition !== 'below' ? <QuestionImage q={q} mode="screen" /> : null}
          {q.type === 'mcq' || q.type === 'multi' ? (
            <div className="stack">
              {q.choices.slice(0, 4).map((c, j) => (
                <label key={j} className="row small">
                  <input type={q.type === 'mcq' ? 'radio' : 'checkbox'} disabled name={`pv-${i}`} /> {CHOICE_KEYS[j]}) {c || '—'}
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
