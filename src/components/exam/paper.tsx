'use client';

// ============================================================
// ورقة الاختبار (للطباعة والمعاينة) — مطابقة للورقة الامتحانية
// المصرية في النسخة الأصلية:
// ترويسة + بيانات الطالب + أقسام أسئلة معنونة (السؤال الأول...)
// بترقيم عربي هندي وأسطر نقاط + زخارف حواف تلقائية أو أختام يدوية
// + صورة السؤال حسب المكان والحجم المختارين.
// ============================================================

import { useEffect, useState } from 'react';
import type { ExamAnswer, ExamOrnaments, ExamQuestion, PaperTemplate } from '@/lib/types';
import type { CenterPrintBranding } from '@/lib/printing';
import { EXAM_TYPE_LABEL } from '@/lib/utils';
import { arabicNum, CHOICE_KEYS, paperSections } from '@/lib/exam-egyptian';
import { PaperOrnaments, QuestionImage } from './ornaments';
import { ExamQuestionInput, UnderlinedQuestionText } from './interactive-input';

/** معاينة الهوية في المحرر فقط؛ نسخة الطباعة تضيف طبقة ثابتة تتكرر بكل صفحة. */
function PaperPreviewBranding({ branding }: { branding: CenterPrintBranding | null | undefined }) {
  if (!branding) return null;
  const watermarkText = branding.watermark_text.trim() || branding.center_name;
  return <>
    {branding.watermark_enabled ? <div className={`paper-preview-branding paper-preview-watermark ${branding.watermark_direction}`} style={{ opacity: branding.watermark_opacity }} aria-hidden="true">{branding.watermark_image ? <img src={branding.watermark_image} alt="" /> : null}<span>{watermarkText}</span></div> : null}
    {branding.logo_url ? <img className={`paper-preview-branding paper-preview-logo ${branding.logo_position}`} style={{ width: branding.logo_size }} src={branding.logo_url} alt={`شعار ${branding.center_name}`} /> : null}
  </>;
}

export function ExamPaper({
  title,
  subject,
  duration,
  total,
  questions,
  ornaments,
  centerName,
  footerText,
  branding,
  template = 'classic',
}: {
  title: string;
  subject: string;
  duration: number | string;
  total: number;
  questions: ExamQuestion[];
  ornaments?: ExamOrnaments | null;
  centerName?: string | null;
  /** عبارة ختام قابلة للكتابة عند إنشاء الاختبار الورقي. */
  footerText?: string | null;
  /** هوية طباعة السنتر؛ لا تظهر في الاختبارات الإلكترونية. */
  branding?: CenterPrintBranding | null;
  template?: PaperTemplate;
}) {
  const sections = paperSections(questions);
  return (
    <div className={`exam-paper exam-paper-${template}`} dir="rtl">
      <PaperOrnaments ornaments={ornaments} />
      <PaperPreviewBranding branding={branding} />
      <div className="exam-paper-inner">
        <div className="exam-paper-head">
          {(branding?.center_name || centerName) ? <div className="exam-paper-center">{branding?.center_name || centerName}</div> : null}
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

        <div className="exam-paper-footer">{footerText?.trim() || 'انتهت الأسئلة — بالتوفيق والنجاح 🌟'}</div>
        {(branding?.center_name || centerName) ? <div className="exam-paper-bottom-note">{branding?.center_name || centerName}{branding?.footer_address ? ` — ${branding.footer_address}` : ''}</div> : null}
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
              <UnderlinedQuestionText question={q} />
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

/** معاينة إلكترونية تفاعلية مطابقة لتجربة الطالب، من دون إرسال أو حفظ أي إجابات. */
export function ElectronicExamView({ questions }: { questions: ExamQuestion[] }) {
  const emptyAnswers = () => questions.map<ExamAnswer>(() => null);
  const [answers, setAnswers] = useState<ExamAnswer[]>(emptyAnswers);
  useEffect(() => { setAnswers(emptyAnswers()); }, [questions]);

  return (
    <div className="stack electronic-exam-preview">
      {questions.map((q, i) => (
        <div key={`${q.sectionId ?? 'question'}-${i}`} className="card compact soft stack">
          <div className="row-between">
            <strong>{arabicNum(i + 1)}. <UnderlinedQuestionText question={q} /></strong>
            <span className="badge info">{EXAM_TYPE_LABEL[q.type] ?? q.type} · {q.marks} درجة</span>
          </div>
          {q.image && q.imagePosition !== 'below' ? <QuestionImage q={q} mode="screen" /> : null}
          <ExamQuestionInput question={q} value={answers[i] ?? null} onChange={(answer) => setAnswers((old) => old.map((item, index) => index === i ? answer : item))} />
          {q.image && q.imagePosition === 'below' ? <QuestionImage q={q} mode="screen" /> : null}
        </div>
      ))}
    </div>
  );
}
