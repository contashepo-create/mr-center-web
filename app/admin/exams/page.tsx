'use client';

import { useEffect, useMemo, useState } from 'react';
import { Badge, Button, Card, EmptyState, ErrorNotice, Input, Notice, PageHeader, Select, Textarea } from '@/components/ui';
import { Modal } from '@/components/modal';
import { useToast } from '@/components/toast';
import { useSession } from '@/context/session';
import { ExamPaper, ElectronicExamView } from '@/components/exam/paper';
import { ExamQuestionInput, UnderlinedQuestionText, isExamQuestionAnswered } from '@/components/exam/interactive-input';
import { QuestionImage, StampEditor } from '@/components/exam/ornaments';
import { answerLabel, correctLabel } from '@/components/exam/review';
import { ALL_ORNAMENTS, ornamentsForSubject, subjectLabelFor } from '@/lib/exam-ornaments';
import { EGYPT_TYPES, egyptMeta } from '@/lib/exam-egyptian';
import { deleteExam, fetchAttemptsForExam, fetchCenterPrintBranding, fetchExams, fetchGrades, fetchGroups, fetchStudents, gradeAttemptManually, upsertExam } from '@/lib/api';
import { can } from '@/lib/rbac';
import { printCenterExamPaper } from '@/lib/report';
import type { CenterPrintBranding } from '@/lib/printing';
import type { AppExam, ExamAnswer, ExamAttempt, ExamAvailabilityMode, ExamDeliveryMode, ExamOrnaments, ExamQuestion, ExamQuestionType, ExamResultMode, Grade, Group, OnlineExamMode, PaperTemplate, Student } from '@/lib/types';
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

function newSectionId(): string { return `section-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`; }

/** السؤال المخزن هو سؤال فرعي فعلي؛ sectionId يجمعه تحت رأس واحد كما في Center Publish. */
function newQuestion(type: ExamQuestionType = 'mcq', sectionId = newSectionId()): ExamQuestion {
  const base = { type, q: '', choices: [], marks: 1, sectionId };
  if (type === 'tf') return { ...base, choices: ['صح', 'خطأ'] };
  if (type === 'match') return { ...base, pairs: [{ l: '', r: '' }, { l: '', r: '' }] };
  if (type === 'essay' || type === 'short') return base;
  if (type === 'complete') return { ...base, answer: '' };
  if (type === 'correct') return { ...base, answer: '', underlined: { start: 0, count: 0 } };
  return { ...base, choices: ['', '', '', ''] };
}

function defaultAnswer(q: ExamQuestion): ExamAnswer {
  if (q.type === 'tf' || q.type === 'mcq') return 0;
  if (q.type === 'multi') return [];
  if (q.type === 'match') return (q.pairs ?? []).map((_, i) => i);
  if (q.type === 'complete' || q.type === 'correct') return q.answer ?? '';
  return null;
}

function normalizeQuestions(questions: ExamQuestion[]): ExamQuestion[] {
  return questions.map((q, index) => {
    const base = { ...newQuestion(q.type, q.sectionId || `legacy-${index}`), ...q, choices: q.choices ?? [] };
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

function QuestionEditor({ q, answer, mainNumber, subNumber, onQuestion, onAnswer, onDelete, onMove }: {
  q: ExamQuestion;
  answer: ExamAnswer;
  mainNumber: number;
  subNumber: number;
  onQuestion: (q: ExamQuestion) => void;
  onAnswer: (a: ExamAnswer) => void;
  onDelete: () => void;
  onMove: (delta: number) => void;
}) {
  // السؤال الفرعي الذي يُضاف الآن يفتح فوراً؛ الطي قرار يدوي فقط.
  const [expanded, setExpanded] = useState(true);
  const meta = egyptMeta(q.type);
  const setChoice = (choiceIndex: number, choice: string) => onQuestion({ ...q, choices: q.choices.map((item, index) => index === choiceIndex ? choice : item) });
  const toggleMulti = (choiceIndex: number, checked: boolean) => {
    const selected = Array.isArray(answer) ? answer as number[] : [];
    onAnswer(checked ? [...selected, choiceIndex].sort() : selected.filter((item) => item !== choiceIndex));
  };
  const pairs = q.pairs ?? [];
  const correctionWords = q.type === 'correct' ? q.q.trim().split(/\s+/).filter(Boolean) : [];
  const selectedRange = q.underlined ?? { start: 0, count: 0 };
  const toggleUnderlinedWord = (wordIndex: number) => {
    const start = Math.max(0, selectedRange.start - 1);
    const count = selectedRange.count || 0;
    if (!count) { onQuestion({ ...q, underlined: { start: wordIndex + 1, count: 1 } }); return; }
    if (wordIndex >= start && wordIndex < start + count) {
      if (count === 1) onQuestion({ ...q, underlined: { start: 0, count: 0 } });
      else if (wordIndex === start) onQuestion({ ...q, underlined: { start: start + 2, count: count - 1 } });
      else if (wordIndex === start + count - 1) onQuestion({ ...q, underlined: { start: start + 1, count: count - 1 } });
      else onQuestion({ ...q, underlined: { start: wordIndex + 1, count: 1 } });
      return;
    }
    const nextStart = Math.min(start, wordIndex);
    const nextEnd = Math.max(start + count - 1, wordIndex);
    onQuestion({ ...q, underlined: { start: nextStart + 1, count: nextEnd - nextStart + 1 } });
  };

  return <article className="exam-subquestion-card">
    <div className="exam-subquestion-head"><div className="row"><span className="subquestion-number">{mainNumber}.{subNumber}</span><strong>السؤال الفرعي {subNumber}</strong><span className="tiny muted">{meta.label}</span></div><div className="row"><Button type="button" variant="ghost" onClick={() => setExpanded((value) => !value)}>{expanded ? 'طي' : 'تعديل'}</Button><Button type="button" variant="secondary" onClick={() => onMove(-1)} title="تحريك لأعلى">↑</Button><Button type="button" variant="secondary" onClick={() => onMove(1)} title="تحريك لأسفل">↓</Button><Button type="button" variant="danger" onClick={onDelete}>حذف</Button></div></div>
    {!expanded ? <div className="exam-question-summary"><span><UnderlinedQuestionText question={q} /></span><span>{q.marks} درجة</span></div> : <div className="exam-question-body stack">
      <div className="grid grid-2"><Input label="الدرجة" type="number" min={1} value={q.marks} onChange={(event) => onQuestion({ ...q, marks: Number(event.target.value) || 1 })} help="الافتراضي درجة واحدة لكل سؤال فرعي." /><div className="input-wrap"><span className="label">التصحيح</span><div className={`notice ${meta.manual ? 'warn' : 'success'}`} style={{ padding: '9px 11px' }}>{meta.manual ? 'يدوي بعد التسليم' : 'تلقائي'}</div></div></div>
      {q.type === 'correct' ? <div className="stack"><Input label="نص الجملة" value={q.q} onChange={(event) => onQuestion({ ...q, q: event.target.value, underlined: { start: 0, count: 0 } })} placeholder="اكتب الجملة، ثم اختر الكلمة التي تحتها خط" required />{correctionWords.length ? <div className="underline-picker"><div className="row-between"><strong>اضغط الكلمة أو الكلمات التي تريد وضع خط تحتها</strong>{selectedRange.count ? <Button type="button" variant="ghost" onClick={() => onQuestion({ ...q, underlined: { start: 0, count: 0 } })}>إلغاء التحديد</Button> : null}</div><div className="underline-words">{correctionWords.map((word, wordIndex) => { const active = selectedRange.count > 0 && wordIndex >= selectedRange.start - 1 && wordIndex < selectedRange.start - 1 + selectedRange.count; return <button type="button" key={`${word}-${wordIndex}`} className={active ? 'active' : ''} onClick={() => toggleUnderlinedWord(wordIndex)}>{word}</button>; })}</div>{selectedRange.count ? <div className="tiny"><span className="muted">سيظهر تحت خط للطالب:</span> <strong><UnderlinedQuestionText question={q} /></strong></div> : <p className="tiny muted">اختر كلمة واحدة على الأقل حتى يظهر سؤال التصويب بالشكل الصحيح في الورقة والاختبار الإلكتروني.</p>}</div> : null}<Input label="التصويب النموذجي" value={typeof answer === 'string' ? answer : ''} onChange={(event) => { onAnswer(event.target.value); onQuestion({ ...q, answer: event.target.value }); }} placeholder="الكلمة أو العبارة الصحيحة" /></div> : <Textarea label="نص السؤال" value={q.q} onChange={(event) => onQuestion({ ...q, q: event.target.value })} required />}
      {q.type === 'mcq' || q.type === 'multi' ? <div className="grid grid-2">{q.choices.slice(0, 4).map((choice, choiceIndex) => <div key={choiceIndex} className="row" style={{ alignItems: 'end' }}><div style={{ flex: 1 }}><Input label={`الاختيار (${['أ', 'ب', 'ج', 'د'][choiceIndex]})`} value={choice} onChange={(event) => setChoice(choiceIndex, event.target.value)} /></div><label className="row tiny muted" style={{ gap: 5, paddingBottom: 12 }} title="حدد الإجابة الصحيحة"><input type={q.type === 'mcq' ? 'radio' : 'checkbox'} name={`correct-${q.sectionId}-${subNumber}`} checked={q.type === 'mcq' ? answer === choiceIndex : Array.isArray(answer) && (answer as number[]).includes(choiceIndex)} onChange={(event) => q.type === 'mcq' ? onAnswer(choiceIndex) : toggleMulti(choiceIndex, event.target.checked)} />صحيح</label></div>)}</div> : null}
      {q.type === 'tf' ? <div className="tabs"><button type="button" className={`tab ${answer === 0 ? 'active' : ''}`} onClick={() => onAnswer(0)}>✓ صح</button><button type="button" className={`tab ${answer === 1 ? 'active' : ''}`} onClick={() => onAnswer(1)}>✗ خطأ</button></div> : null}
      {q.type === 'complete' ? <Input label="الإجابة النموذجية (للمطابقة الآلية)" value={typeof answer === 'string' ? answer : ''} onChange={(event) => { onAnswer(event.target.value); onQuestion({ ...q, answer: event.target.value }); }} /> : null}
      {q.type === 'match' ? <div className="stack"><div className="row-between"><div><strong>أزواج التوصيل</strong><p className="tiny muted">كل صف هو زوج صحيح؛ ستظهر بطاقات العمود (ب) بترتيب مختلف للطالب ليختارها تفاعلياً.</p></div><Button type="button" variant="secondary" onClick={() => { const next = [...pairs, { l: '', r: '' }]; onQuestion({ ...q, pairs: next }); onAnswer(next.map((_, index) => index)); }}>إضافة زوج</Button></div>{pairs.map((pair, pairIndex) => <div className="grid grid-2" key={pairIndex}><Input label={`العمود (أ) — ${pairIndex + 1}`} value={pair.l} onChange={(event) => onQuestion({ ...q, pairs: pairs.map((item, index) => index === pairIndex ? { ...item, l: event.target.value } : item) })} /><div className="row" style={{ alignItems: 'end' }}><div style={{ flex: 1 }}><Input label={`العمود (ب) المطابق — ${pairIndex + 1}`} value={pair.r} onChange={(event) => onQuestion({ ...q, pairs: pairs.map((item, index) => index === pairIndex ? { ...item, r: event.target.value } : item) })} /></div>{pairs.length > 2 ? <Button type="button" variant="ghost" onClick={() => { const next = pairs.filter((_, index) => index !== pairIndex); onQuestion({ ...q, pairs: next }); onAnswer(next.map((_, index) => index)); }}>حذف</Button> : null}</div></div>)}</div> : null}
      <details><summary className="small muted" style={{ cursor: 'pointer' }}>🖼 صورة السؤال (اختيارية) {q.image ? '— مضافة' : ''}</summary><div className="grid grid-2" style={{ marginTop: 8 }}><Input label="رابط الصورة" value={q.image ?? ''} onChange={(event) => onQuestion({ ...q, image: event.target.value || null })} placeholder="https://… أو رابط من التخزين" /><Select label="مكان الصورة" value={q.imagePosition ?? 'beside'} onChange={(event) => onQuestion({ ...q, imagePosition: event.target.value as ExamQuestion['imagePosition'] })}><option value="beside">بجانب السؤال (ورقي)</option><option value="above">فوق السؤال</option><option value="below">تحت السؤال</option></Select></div>{q.image ? <div className="row" style={{ alignItems: 'center', marginTop: 8 }}><img src={q.image} alt="معاينة" style={{ maxHeight: 90, maxWidth: 220, borderRadius: 8, border: '1px solid var(--border)' }} onError={(event) => { (event.target as HTMLImageElement).style.display = 'none'; }} /><span className="tiny muted">تظهر الصورة وفق الموضع المحدد.</span></div> : null}</details>
    </div>}
  </article>;
}

function CreatorExamTryout({ title, subject, duration, questions, onClose }: { title: string; subject: string; duration: number; questions: ExamQuestion[]; onClose: () => void }) {
  const [answers, setAnswers] = useState<ExamAnswer[]>(() => questions.map(defaultAnswer));
  const [current, setCurrent] = useState(0);
  const [finished, setFinished] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(Math.max(1, duration) * 60);
  useEffect(() => { setAnswers(questions.map(defaultAnswer)); setCurrent(0); setFinished(false); setSecondsLeft(Math.max(1, duration) * 60); }, [questions, duration]);
  useEffect(() => {
    if (finished || secondsLeft <= 0) return;
    const timer = window.setTimeout(() => setSecondsLeft((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [finished, secondsLeft]);
  const progress = useMemo(() => {
    const answered = answers.filter((answer, index) => isExamQuestionAnswered(questions[index], answer)).length;
    return { answered, total: questions.length, percentage: questions.length ? Math.round((answered / questions.length) * 100) : 0 };
  }, [answers, questions]);
  const question = questions[current];
  const time = `${String(Math.floor(secondsLeft / 60)).padStart(2, '0')}:${String(secondsLeft % 60).padStart(2, '0')}`;
  return <main className="exam-tryout-page" dir="rtl"><header className="exam-tryout-head"><div><span className="exam-tryout-kicker">وضع تجربة المنشئ</span><h1>{title.trim() || 'اختبار غير محفوظ'}</h1><p>{subject || 'بدون مادة'} · تجربة تفاعلية لا تحفظ أي إجابة أو نتيجة</p></div><div className="row"><Badge tone={secondsLeft < 60 ? 'danger' : 'info'}>⏱ {time}</Badge><Button type="button" variant="secondary" onClick={onClose}>← الرجوع للمحرر</Button></div></header><div className="exam-tryout-content">{finished ? <Card className="stack exam-tryout-finish"><div className="logo">✓</div><h2 className="h2">انتهت التجربة</h2><p className="muted">لم تحفظ إجاباتك ولم تُسجل أي نتيجة أو محاولة طالب.</p><p className="small">أجبت عن {progress.answered} من {progress.total} أسئلة تجريبية.</p><Button type="button" onClick={onClose}>العودة لتعديل الاختبار</Button></Card> : <><Card className="stack compact"><div className="row-between"><span className="muted small">التقدم التجريبي: {progress.answered} من {progress.total}</span><span className="muted small">{progress.percentage}%</span></div><div className="progress-track"><div className="progress-fill" style={{ width: `${progress.percentage}%` }} /></div><div className="exam-nav">{questions.map((item, index) => <button type="button" key={index} className={`exam-nav-btn ${index === current ? 'on' : ''} ${isExamQuestionAnswered(item, answers[index]) ? 'done' : ''}`} onClick={() => setCurrent(index)}>{index + 1}</button>)}</div></Card>{question ? <Card className="stack exam-tryout-question"><div className="row-between"><Badge tone="info">{EXAM_TYPE_LABEL[question.type] ?? question.type}</Badge><Badge>{question.marks} درجة</Badge></div>{question.image && question.imagePosition !== 'below' ? <QuestionImage q={question} mode="screen" /> : null}<h2>{current + 1}. <UnderlinedQuestionText question={question} /></h2><ExamQuestionInput question={question} value={answers[current]} onChange={(value) => setAnswers((old) => old.map((item, index) => index === current ? value : item))} />{question.image && question.imagePosition === 'below' ? <QuestionImage q={question} mode="screen" /> : null}</Card> : <EmptyState title="أضف سؤالاً لتبدأ التجربة" />}<div className="row-between"><Button type="button" variant="secondary" disabled={current === 0} onClick={() => setCurrent((value) => Math.max(0, value - 1))}>→ السابق</Button><Button type="button" onClick={() => setFinished(true)}>{secondsLeft <= 0 ? 'إنهاء التجربة' : 'إنهاء دون حفظ'}</Button><Button type="button" variant="secondary" disabled={current >= questions.length - 1} onClick={() => setCurrent((value) => Math.min(questions.length - 1, value + 1))}>التالي ←</Button></div></>}</div></main>;
}

type ExamLibraryType = 'all' | ExamDeliveryMode;
type ExamSettingsDraft = {
  duration: string;
  attempts: string;
  show_result: ExamResultMode;
  is_published: boolean;
  grade_id: string;
  target_group_ids: string[];
  availability_mode: ExamAvailabilityMode;
  available_from: string;
  available_until: string;
  paper_template: PaperTemplate;
};

const PAPER_TEMPLATES: { id: PaperTemplate; title: string; description: string; symbol: string }[] = [
  { id: 'classic', title: 'الوزاري الكلاسيكي', description: 'حدود مزدوجة وحقول الطالب.', symbol: '▤' },
  { id: 'lab', title: 'المختبر العلمي', description: 'إطار معملي تركوازي هادئ.', symbol: '⚗' },
  { id: 'life', title: 'عالم الحياة', description: 'درجات الأخضر للأحياء والعلوم.', symbol: '⌬' },
  { id: 'cosmos', title: 'الطاقة والكون', description: 'كحلي وذهبي بطابع فضائي.', symbol: '✦' },
  { id: 'explorer', title: 'المستكشف الصغير', description: 'ملوّن ومبهج للمرحلة الابتدائية.', symbol: '◈' },
  { id: 'royal', title: 'الديواني الفاخر', description: 'كحلي ذهبي رسمي للاختبارات النهائية.', symbol: '♛' },
  { id: 'parchment', title: 'الرقّي العريق', description: 'لون رقّ وإطار ذهبي ناعم.', symbol: '▧' },
  { id: 'wedding', title: 'الأصالة الهادئة', description: 'زمردي وذهبي ببراويز أنيقة.', symbol: '❖' },
  { id: 'modern', title: 'النقاء الأنيق', description: 'أبيض بسيط وحدود هندسية رفيعة.', symbol: '◫' },
  { id: 'formal', title: 'الرسمي', description: 'القالب السابق المتوافق للاختبارات الرسمية.', symbol: '▥' },
];
type PaperPreviewLayout = 'comfortable' | 'two_pages';

/** أدوات مباشرة داخل المعاينة: ما يراه المستخدم هنا هو ما سيطبع، من دون أي تحجيم مشوّه. */
function PaperPreviewControls({
  subject, template, ornaments, layout, onTemplate, onOrnaments, onLayout,
}: {
  subject: string;
  template: PaperTemplate;
  ornaments: ExamOrnaments;
  layout: PaperPreviewLayout;
  onTemplate: (template: PaperTemplate) => void;
  onOrnaments: (ornaments: ExamOrnaments) => void;
  onLayout: (layout: PaperPreviewLayout) => void;
}) {
  return <section className="paper-preview-controls stack" aria-label="تحكم مباشر في شكل الورقة">
    <div className="row-between"><div><h3 className="h3">تحكم سريع في الورقة</h3><p className="muted small">طبّق التغيير مباشرة على المعاينة قبل الطباعة.</p></div><Badge tone={layout === 'two_pages' ? 'info' : 'default'}>{layout === 'two_pages' ? 'وضع صفحتين' : 'تخطيط مريح'}</Badge></div>
    <div className="paper-preview-layouts" role="group" aria-label="تخطيط الطباعة"><button type="button" className={layout === 'comfortable' ? 'active' : ''} onClick={() => onLayout('comfortable')}><strong>مريح وطبيعي</strong><small>يتدفق حسب حجم الورقة.</small></button><button type="button" className={layout === 'two_pages' ? 'active' : ''} onClick={() => onLayout('two_pages')}><strong>استهداف صفحتين</strong><small>يقلل الفراغات فقط ويحافظ على القراءة.</small></button></div>
    <div className="template-picker paper-preview-template-picker">{PAPER_TEMPLATES.map((item) => <button type="button" key={item.id} className={template === item.id ? 'active' : ''} onClick={() => onTemplate(item.id)}><span>{item.symbol}</span><strong>{item.title}</strong><small>{item.description}</small></button>)}</div>
    <details className="exam-appearance-panel" open><summary>🎨 الزخارف والأختام</summary><div className="stack" style={{ marginTop: 12 }}><div className="row-between"><p className="muted small">يمكنك تغيير التوزيع أو اختيار العناصر، ثم وضع الأختام فوق الورقة حين تختار الوضع اليدوي.</p><Button type="button" variant="secondary" onClick={() => onOrnaments({ ...ornaments, kinds: ornamentsForSubject(subject).map((item) => item.kind) })}>حسب المادة ({subjectLabelFor(subject)})</Button></div><div className="grid grid-3"><Select label="أسلوب التوزيع" value={ornaments.placement} onChange={(event) => onOrnaments({ ...ornaments, placement: event.target.value as 'auto' | 'manual' })}><option value="auto">تلقائي على الحواف</option><option value="manual">يدوي (أختام)</option></Select><Select label="الكثافة" value={ornaments.density} onChange={(event) => onOrnaments({ ...ornaments, density: event.target.value as ExamOrnaments['density'] })}><option value="low">خفيفة</option><option value="medium">متوسطة</option><option value="high">كثيفة</option></Select><div className="input-wrap"><span className="label">الشفافية: {Math.round((ornaments.opacity ?? 0.18) * 100)}%</span><input className="input" type="range" min={4} max={50} value={Math.round((ornaments.opacity ?? 0.18) * 100)} onChange={(event) => onOrnaments({ ...ornaments, opacity: Number(event.target.value) / 100 })} /></div></div><div className="stamp-palette">{ALL_ORNAMENTS.map((item) => { const active = ornaments.kinds.includes(item.kind); return <button key={item.kind} type="button" title={item.label} className={`stamp-chip ${active ? 'active' : ''}`} onClick={() => onOrnaments({ ...ornaments, kinds: active ? ornaments.kinds.filter((kind) => kind !== item.kind) : [...ornaments.kinds, item.kind] })}>{item.glyph}</button>; })}</div>{ornaments.placement === 'manual' ? <Notice tone="info">اختر ختماً من اللوحة التي تحيط بالورقة، ثم اضغط موضعه داخل المعاينة. حدده لتعديل حجمه أو حذفه مباشرة.</Notice> : null}</div></details>
    {layout === 'two_pages' ? <Notice tone="info">وضع الصفحتين لا يستخدم تصغيراً أو قصاً. إذا كان نص الاختبار أطول فعلياً من صفحتين، ستضاف صفحات للحفاظ على جميع الأسئلة واضحة.</Notice> : null}
  </section>;
}

const ONLINE_MODES: { id: OnlineExamMode; title: string; lead: string; description: string }[] = [
  { id: 'objective', title: 'موضوعي', lead: 'تصحيح تلقائي', description: 'اختيار من متعدد، متعدد الإجابات، صح وخطأ، أكمل ووصل.' },
  { id: 'essay', title: 'مقالي', lead: 'مراجعة المعلم', description: 'أسئلة مقالية وإجابات قصيرة وتصويب مع درجات يدوية.' },
  { id: 'mixed', title: 'مختلط', lead: 'تلقائي + يدوي', description: 'اجمع أنواع الأسئلة كلها في اختبار واحد.' },
];

export default function AdminExamsPage() {
  const { profile } = useSession();
  const toast = useToast();
  const centerId = profile?.center_id;
  const [exams, setExams] = useState<AppExam[]>([]);
  const [grades, setGrades] = useState<Grade[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [attempts, setAttempts] = useState<ExamAttempt[]>([]);
  const [manualScores, setManualScores] = useState<Record<string, string>>({});
  const [form, setForm] = useState({ id: '', title: '', subject: '', grade_id: '', duration: '30', attempts: '1', show_result: 'end' as ExamResultMode, is_published: false, delivery_mode: 'online' as ExamDeliveryMode, online_mode: 'mixed' as OnlineExamMode, target_group_ids: [] as string[], availability_mode: 'always' as ExamAvailabilityMode, available_from: '', available_until: '', paper_template: 'classic' as PaperTemplate, paper_footer: '' });
  const [questions, setQuestions] = useState<ExamQuestion[]>([newQuestion('mcq')]);
  const [answers, setAnswers] = useState<ExamAnswer[]>([0]);
  const [ornaments, setOrnaments] = useState<ExamOrnaments>(defaultOrnaments(''));
  const [printBranding, setPrintBranding] = useState<CenterPrintBranding | null>(null);
  const [selected, setSelected] = useState<AppExam | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [preview, setPreview] = useState(false);
  /** الاختبار المحفوظ الذي تفتحه المعاينة من المكتبة؛ null يعني معاينة المسودة في المحرر. */
  const [previewSource, setPreviewSource] = useState<AppExam | null>(null);
  const [previewMode, setPreviewMode] = useState<'paper' | 'electronic'>('paper');
  /** تعديلات شكل الورقة للاختبار المحفوظ تبقى محلية حتى يختار المستخدم حفظها. */
  const [previewPaperTemplate, setPreviewPaperTemplate] = useState<PaperTemplate>('classic');
  const [previewPaperOrnaments, setPreviewPaperOrnaments] = useState<ExamOrnaments>(defaultOrnaments(''));
  const [previewPaperLayout, setPreviewPaperLayout] = useState<PaperPreviewLayout>('comfortable');
  const [savingPreviewPaper, setSavingPreviewPaper] = useState(false);
  const [tryoutOpen, setTryoutOpen] = useState(false);
  const [titleError, setTitleError] = useState(false);
  const [resultsExam, setResultsExam] = useState<AppExam | null>(null);
  const [settingsExam, setSettingsExam] = useState<AppExam | null>(null);
  const [settingsForm, setSettingsForm] = useState<ExamSettingsDraft | null>(null);
  const [savingSettings, setSavingSettings] = useState(false);
  const [workspace, setWorkspace] = useState<'library' | 'builder'>('library');
  const [chooseTypeOpen, setChooseTypeOpen] = useState(false);
  const [chooseOnlineModeOpen, setChooseOnlineModeOpen] = useState(false);
  const [librarySearch, setLibrarySearch] = useState('');
  const [libraryGrade, setLibraryGrade] = useState('all');
  const [libraryStatus, setLibraryStatus] = useState<'all' | 'published' | 'draft'>('all');
  const [libraryType, setLibraryType] = useState<ExamLibraryType>('all');
  const [libraryView, setLibraryView] = useState<'grid' | 'list'>('grid');
  const [reviewAttempt, setReviewAttempt] = useState<ExamAttempt | null>(null);
  const [reviewScores, setReviewScores] = useState<Record<number, string>>({});
  const [reviewTotal, setReviewTotal] = useState('');
  const [savingReview, setSavingReview] = useState(false);

  const studentName = useMemo(() => new Map(students.map((student) => [student.id, student.name])), [students]);
  const validation = useMemo(() => validateExamDraft(questions.map((question, index) => ({ ...question, answer: typeof answers[index] === 'string' ? answers[index] as string : question.answer, corrects: Array.isArray(answers[index]) ? answers[index] as number[] : undefined }))), [questions, answers]);
  const total = examMarksTotal(questions);
  const groupsOfSelectedGrade = useMemo(() => form.grade_id ? groups.filter((group) => group.grade_id === form.grade_id) : [], [groups, form.grade_id]);
  const questionSections = useMemo(() => {
    const sections: Array<{ id: string; type: ExamQuestionType; indices: number[] }> = [];
    const byId = new Map<string, { id: string; type: ExamQuestionType; indices: number[] }>();
    questions.forEach((question, index) => {
      const id = question.sectionId || `legacy-${index}`;
      let section = byId.get(id);
      if (!section) { section = { id, type: question.type, indices: [] }; byId.set(id, section); sections.push(section); }
      section.indices.push(index);
    });
    return sections;
  }, [questions]);
  const filteredExams = useMemo(() => {
    const query = librarySearch.trim().toLocaleLowerCase('ar-EG');
    return exams.filter((exam) => {
      const delivery = exam.delivery_mode ?? 'online';
      if (libraryGrade !== 'all' && exam.grade_id !== libraryGrade) return false;
      if (libraryStatus === 'published' && !exam.is_published) return false;
      if (libraryStatus === 'draft' && exam.is_published) return false;
      if (libraryType !== 'all' && delivery !== libraryType) return false;
      return !query || `${exam.title} ${exam.subject} ${grades.find((grade) => grade.id === exam.grade_id)?.name ?? ''}`.toLocaleLowerCase('ar-EG').includes(query);
    });
  }, [exams, librarySearch, libraryGrade, libraryStatus, libraryType, grades]);

  const load = async () => {
    if (!centerId) return;
    setError(null);
    try {
      const [nextExams, nextGrades, nextGroups, nextStudents] = await Promise.all([fetchExams(centerId), fetchGrades(centerId), fetchGroups(centerId), fetchStudents(centerId)]);
      setExams(nextExams); setGrades(nextGrades); setGroups(nextGroups); setStudents(nextStudents);
    } catch (err) { setError(err); }
  };
  useEffect(() => { void load(); }, [centerId]);
  useEffect(() => {
    if (!centerId) { setPrintBranding(null); return; }
    void fetchCenterPrintBranding(centerId).then(setPrintBranding).catch(() => setPrintBranding(null));
  }, [centerId]);
  if (profile && !can(profile, 'exams')) return <Card><Notice tone="error">ليس لديك صلاحية الاختبارات.</Notice></Card>;

  const updateQuestion = (index: number, question: ExamQuestion) => setQuestions((old) => old.map((item, itemIndex) => itemIndex === index ? question : item));
  const updateAnswer = (index: number, answer: ExamAnswer) => setAnswers((old) => old.map((item, itemIndex) => itemIndex === index ? answer : item));
  const move = (index: number, delta: number) => {
    const nextIndex = index + delta;
    if (nextIndex < 0 || nextIndex >= questions.length || questions[index]?.sectionId !== questions[nextIndex]?.sectionId) return;
    const nextQuestions = [...questions]; const nextAnswers = [...answers];
    [nextQuestions[index], nextQuestions[nextIndex]] = [nextQuestions[nextIndex], nextQuestions[index]];
    [nextAnswers[index], nextAnswers[nextIndex]] = [nextAnswers[nextIndex], nextAnswers[index]];
    setQuestions(nextQuestions); setAnswers(nextAnswers);
  };
  const addQuestion = (type: ExamQuestionType) => { const question = newQuestion(type); setQuestions((old) => [...old, question]); setAnswers((old) => [...old, defaultAnswer(question)]); };
  const addSubQuestion = (sectionId: string, type: ExamQuestionType) => {
    const question = newQuestion(type, sectionId);
    const lastIndex = questions.reduce((last, item, index) => item.sectionId === sectionId ? index : last, -1);
    setQuestions((old) => [...old.slice(0, lastIndex + 1), question, ...old.slice(lastIndex + 1)]);
    setAnswers((old) => [...old.slice(0, lastIndex + 1), defaultAnswer(question), ...old.slice(lastIndex + 1)]);
  };
  const removeQuestion = (index: number) => { if (questions.length === 1) return; setQuestions((old) => old.filter((_, itemIndex) => itemIndex !== index)); setAnswers((old) => old.filter((_, itemIndex) => itemIndex !== index)); };

  const reset = () => {
    setSelected(null); setAttempts([]); setManualScores({});
    setForm({ id: '', title: '', subject: '', grade_id: '', duration: '30', attempts: '1', show_result: 'end', is_published: false, delivery_mode: 'online', online_mode: 'mixed', target_group_ids: [], availability_mode: 'always', available_from: '', available_until: '', paper_template: 'classic', paper_footer: '' });
    setQuestions([newQuestion('mcq')]); setAnswers([0]); setOrnaments(defaultOrnaments(''));
  };
  const openEditor = (delivery: ExamDeliveryMode, onlineMode: OnlineExamMode = 'mixed') => {
    reset(); setForm((current) => ({ ...current, delivery_mode: delivery, online_mode: onlineMode }));
    setPreviewMode(delivery === 'paper' ? 'paper' : 'electronic');
    setChooseTypeOpen(false); setChooseOnlineModeOpen(false); setWorkspace('builder');
  };
  const beginCreate = (delivery: ExamDeliveryMode) => {
    if (delivery === 'online') { setChooseTypeOpen(false); setChooseOnlineModeOpen(true); return; }
    openEditor('paper');
  };
  const edit = async (exam: AppExam) => {
    const delivery = exam.delivery_mode ?? 'online';
    setWorkspace('builder'); setSelected(exam);
    setForm({ id: exam.id, title: exam.title, subject: exam.subject, grade_id: exam.grade_id ?? '', duration: String(exam.duration_minutes), attempts: String(exam.attempts_allowed ?? 1), show_result: (exam.show_result ?? 'end') as ExamResultMode, is_published: exam.is_published, delivery_mode: delivery, online_mode: exam.online_mode ?? 'mixed', target_group_ids: exam.target_group_ids ?? [], availability_mode: exam.availability_mode ?? 'always', available_from: exam.available_from ? exam.available_from.slice(0, 16) : '', available_until: exam.available_until ? exam.available_until.slice(0, 16) : '', paper_template: exam.paper_template ?? 'classic', paper_footer: exam.paper_footer ?? '' });
    const normalized = normalizeQuestions(exam.questions);
    setQuestions(normalized); setAnswers(normalized.map((question, index) => exam.answers[index] ?? defaultAnswer(question))); setOrnaments(exam.ornaments ?? defaultOrnaments(exam.subject)); setPreviewMode(delivery === 'paper' ? 'paper' : 'electronic');
    try { setAttempts(await fetchAttemptsForExam(exam.id)); } catch (err) { setError(err); }
  };
  const setExamGrade = (gradeId: string) => setForm((current) => ({ ...current, grade_id: gradeId, target_group_ids: [] }));
  const toggleTargetGroup = (groupId: string) => setForm((current) => ({ ...current, target_group_ids: current.target_group_ids.includes(groupId) ? current.target_group_ids.filter((id) => id !== groupId) : [...current.target_group_ids, groupId] }));

  const saveError = (message: string, focusTitle = false) => {
    const next = new Error(message); setError(next); toast.error('تعذر حفظ الاختبار', message);
    if (focusTitle) window.setTimeout(() => document.getElementById('exam-title')?.focus(), 0);
  };
  const submit = async (event?: React.FormEvent) => {
    event?.preventDefault();
    if (!centerId) return;
    if (!form.title.trim()) { setTitleError(true); saveError('اكتب عنوان الاختبار أولاً ثم احفظ المسودة.', true); return; }
    if (validation) { saveError(validation); return; }
    if (form.delivery_mode === 'online' && form.availability_mode === 'scheduled') {
      const from = new Date(form.available_from); const until = new Date(form.available_until);
      if (!form.available_from || !form.available_until || Number.isNaN(from.getTime()) || Number.isNaN(until.getTime()) || from >= until) { saveError('حدد وقت فتح وإغلاق صحيحين؛ يجب أن يكون الإغلاق بعد الفتح.'); return; }
    }
    setBusy(true); setError(null);
    try {
      const examId = await upsertExam(centerId, { id: form.id || undefined, title: form.title, subject: form.subject, grade_id: form.grade_id || null, duration_minutes: Number(form.duration) || 30, questions, answers, total_score: total, is_published: form.delivery_mode === 'online' && form.is_published, attempts_allowed: Math.max(1, Number(form.attempts) || 1), show_result: form.show_result, delivery_mode: form.delivery_mode, online_mode: form.online_mode, target_group_ids: form.grade_id ? form.target_group_ids : [], availability_mode: form.delivery_mode === 'online' ? form.availability_mode : 'always', available_from: form.delivery_mode === 'online' && form.availability_mode === 'scheduled' ? new Date(form.available_from).toISOString() : null, available_until: form.delivery_mode === 'online' && form.availability_mode === 'scheduled' ? new Date(form.available_until).toISOString() : null, paper_template: form.paper_template, paper_footer: form.paper_footer, ornaments });
      setForm((current) => ({ ...current, id: examId }));
      toast.success('تم حفظ الاختبار', form.delivery_mode === 'paper' ? 'حُفظت ورقة الاختبار؛ يمكنك طباعتها أو تحميلها PDF.' : form.is_published ? 'الاختبار محفوظ ومنشور للطلاب المستهدفين.' : 'الاختبار محفوظ كمسودة.');
      await load();
    } catch (err) { setError(err); toast.error('تعذر حفظ الاختبار', err instanceof Error ? err.message : 'تحقق من اتصالك ثم أعد المحاولة.'); }
    finally { setBusy(false); }
  };
  const remove = async (id: string) => { if (!confirm('حذف الاختبار ومحاولاته؟')) return; try { await deleteExam(id); setSelected(null); setAttempts([]); setWorkspace('library'); await load(); toast.success('تم حذف الاختبار'); } catch (err) { setError(err); } };
  const grade = async (id: string) => { const score = Number(manualScores[id]); if (Number.isNaN(score)) return; try { await gradeAttemptManually(id, score); if (selected) setAttempts(await fetchAttemptsForExam(selected.id)); } catch (err) { setError(err); } };
  const openReview = (attempt: ExamAttempt) => {
    setReviewAttempt(attempt);
    const scores: Record<number, string> = {}; let auto = 0;
    (selected?.questions ?? []).forEach((question, index) => {
      const result = suggestGrade(question, selected?.answers?.[index], (attempt.answers ?? [])[index]);
      if (result.correct !== null) { scores[index] = String(result.earned); auto += result.earned; } else scores[index] = '';
    });
    setReviewScores(scores); setReviewTotal(String(auto)); setError(null);
  };
  const reviewManualTotal = () => {
    let sum = 0;
    (selected?.questions ?? []).forEach((question, index) => {
      const result = suggestGrade(question, selected?.answers?.[index], (reviewAttempt?.answers ?? [])[index]);
      if (result.correct !== null) sum += result.earned;
      else { const value = Number(reviewScores[index]); if (!Number.isNaN(value) && value >= 0) sum += value; }
    });
    return Math.round(sum * 100) / 100;
  };
  const saveReview = async () => {
    if (!reviewAttempt) return;
    const score = Number(reviewTotal);
    if (Number.isNaN(score) || score < 0) return setError(new Error('أدخل الدرجة النهائية الصحيحة'));
    setSavingReview(true); setError(null);
    try { await gradeAttemptManually(reviewAttempt.id, Math.min(score, reviewAttempt.max_score)); toast.success('تم اعتماد الدرجة وتحرير النتيجة للطالب'); setReviewAttempt(null); if (selected) setAttempts(await fetchAttemptsForExam(selected.id)); }
    catch (err) { setError(err); } finally { setSavingReview(false); }
  };

  const openPreview = (exam: AppExam) => {
    setPreviewSource(exam);
    setPreviewPaperTemplate(exam.paper_template ?? 'classic');
    setPreviewPaperOrnaments(exam.ornaments ?? defaultOrnaments(exam.subject));
    setPreviewPaperLayout('comfortable');
    setPreviewMode((exam.delivery_mode ?? 'online') === 'paper' ? 'paper' : 'electronic');
    setPreview(true);
  };
  const openDraftPreview = () => {
    setPreviewSource(null);
    setPreviewPaperTemplate(form.paper_template);
    setPreviewPaperOrnaments(ornaments);
    setPreviewPaperLayout('comfortable');
    setPreviewMode(form.delivery_mode === 'paper' ? 'paper' : 'electronic');
    setPreview(true);
  };
  const updatePreviewPaperTemplate = (template: PaperTemplate) => {
    setPreviewPaperTemplate(template);
    if (!previewSource) setForm((current) => ({ ...current, paper_template: template }));
  };
  const updatePreviewPaperOrnaments = (next: ExamOrnaments) => {
    setPreviewPaperOrnaments(next);
    if (!previewSource) setOrnaments(next);
  };
  const savePreviewPaperAppearance = async () => {
    if (!centerId || !previewSource) return;
    setSavingPreviewPaper(true); setError(null);
    try {
      const saved = { ...previewSource, paper_template: previewPaperTemplate, ornaments: previewPaperOrnaments };
      await upsertExam(centerId, saved);
      setPreviewSource(saved);
      await load();
      toast.success('تم حفظ قالب وزخارف ورقة الاختبار');
    } catch (err) {
      setError(err);
      toast.error('تعذر حفظ شكل الورقة', err instanceof Error ? err.message : 'حاول مرة أخرى.');
    } finally { setSavingPreviewPaper(false); }
  };
  const openResults = async (exam: AppExam) => {
    setSelected(exam);
    setResultsExam(exam);
    setManualScores({});
    setError(null);
    try { setAttempts(await fetchAttemptsForExam(exam.id)); } catch (err) { setError(err); }
  };
  const openSettings = (exam: AppExam) => {
    setSettingsExam(exam);
    setSettingsForm({
      duration: String(exam.duration_minutes), attempts: String(exam.attempts_allowed ?? 1), show_result: exam.show_result ?? 'end',
      is_published: exam.is_published, grade_id: exam.grade_id ?? '', target_group_ids: exam.target_group_ids ?? [],
      availability_mode: exam.availability_mode ?? 'always', available_from: exam.available_from ? exam.available_from.slice(0, 16) : '',
      available_until: exam.available_until ? exam.available_until.slice(0, 16) : '', paper_template: exam.paper_template ?? 'classic',
    });
  };
  const settingsGroups = useMemo(() => settingsForm?.grade_id ? groups.filter((group) => group.grade_id === settingsForm.grade_id) : [], [groups, settingsForm?.grade_id]);
  const toggleSettingsGroup = (groupId: string) => setSettingsForm((current) => current ? { ...current, target_group_ids: current.target_group_ids.includes(groupId) ? current.target_group_ids.filter((id) => id !== groupId) : [...current.target_group_ids, groupId] } : current);
  const saveSettings = async () => {
    if (!centerId || !settingsExam || !settingsForm) return;
    const delivery = settingsExam.delivery_mode ?? 'online';
    if (delivery === 'online' && settingsForm.availability_mode === 'scheduled') {
      const from = new Date(settingsForm.available_from); const until = new Date(settingsForm.available_until);
      if (!settingsForm.available_from || !settingsForm.available_until || Number.isNaN(from.getTime()) || Number.isNaN(until.getTime()) || from >= until) return setError(new Error('حدد وقت فتح وإغلاق صحيحين؛ يجب أن يكون الإغلاق بعد الفتح.'));
    }
    setSavingSettings(true); setError(null);
    try {
      await upsertExam(centerId, { ...settingsExam, duration_minutes: Math.max(1, Number(settingsForm.duration) || 30), questions: settingsExam.questions, answers: settingsExam.answers, total_score: settingsExam.total_score, is_published: delivery === 'online' && settingsForm.is_published, attempts_allowed: Math.max(1, Number(settingsForm.attempts) || 1), show_result: settingsForm.show_result, grade_id: settingsForm.grade_id || null, target_group_ids: settingsForm.grade_id ? settingsForm.target_group_ids : [], availability_mode: delivery === 'online' ? settingsForm.availability_mode : 'always', available_from: delivery === 'online' && settingsForm.availability_mode === 'scheduled' ? new Date(settingsForm.available_from).toISOString() : null, available_until: delivery === 'online' && settingsForm.availability_mode === 'scheduled' ? new Date(settingsForm.available_until).toISOString() : null, paper_template: settingsForm.paper_template });
      setSettingsExam(null); setSettingsForm(null); await load(); toast.success('تم حفظ إعدادات الاختبار');
    } catch (err) { setError(err); } finally { setSavingSettings(false); }
  };

  const renderExamBadges = (exam: AppExam) => {
    const delivery = exam.delivery_mode ?? 'online';
    const grade = grades.find((item) => item.id === exam.grade_id)?.name ?? 'كل الصفوف';
    const selectedGroups = exam.target_group_ids ?? [];
    return <div className="exam-library-badges">
      <Badge tone={delivery === 'online' ? 'info' : 'default'}>{delivery === 'online' ? '◉ اختبار إلكتروني' : '🖨 اختبار ورقي'}</Badge>
      <Badge tone="default">{grade}</Badge>
      <Badge tone="default">{exam.questions.length} سؤال</Badge>
      <Badge tone="default">{exam.duration_minutes} دقيقة</Badge>
      {delivery === 'online' ? <><Badge tone={exam.is_published ? 'success' : 'warn'}>{exam.is_published ? 'منشور للطلاب' : 'مسودة غير منشورة'}</Badge><Badge tone="default">{ONLINE_MODES.find((mode) => mode.id === (exam.online_mode ?? 'mixed'))?.title ?? 'مختلط'}</Badge><Badge tone="default">{selectedGroups.length ? `${selectedGroups.length} مجموعات` : 'كل مجموعات الصف'}</Badge><Badge tone={exam.availability_mode === 'scheduled' ? 'warn' : 'default'}>{exam.availability_mode === 'scheduled' ? 'إتاحة مجدولة' : 'مفتوح دائماً'}</Badge></> : <Badge tone="default">{PAPER_TEMPLATES.find((template) => template.id === exam.paper_template)?.title ?? 'الكلاسيكي'}</Badge>}
    </div>;
  };
  const renderExamActions = (exam: AppExam, layout: 'card' | 'row') => {
    const online = (exam.delivery_mode ?? 'online') === 'online';
    return <div className={`exam-action-set ${layout}`}>
      <Button type="button" variant="secondary" onClick={() => openPreview(exam)}>معاينة</Button>
      <Button type="button" variant="secondary" onClick={() => openSettings(exam)}>إعدادات</Button>
      {online ? <Button type="button" variant="secondary" onClick={() => void openResults(exam)}>مراجعة النتائج</Button> : null}
      <Button type="button" variant="ghost" onClick={() => void edit(exam)}>تحرير</Button>
      <Button type="button" variant="ghost" onClick={() => void remove(exam.id)}>حذف</Button>
    </div>;
  };
  const previewPaperTemplateValue = previewSource ? previewPaperTemplate : form.paper_template;
  const previewPaperOrnamentsValue = previewSource ? previewPaperOrnaments : ornaments;
  const previewPaperQuestions = previewSource?.questions ?? questions;
  const previewPaperSubject = previewSource?.subject ?? form.subject;
  const previewIsSavedPaper = Boolean(previewSource && (previewSource.delivery_mode ?? 'online') === 'paper');

  if (tryoutOpen) return <CreatorExamTryout title={form.title} subject={form.subject} duration={Number(form.duration) || 30} questions={questions} onClose={() => setTryoutOpen(false)} />;

  const library = <>
    <PageHeader title="الاختبارات" subtitle="أنشئ اختباراً ورقياً للطباعة، أو اختباراً إلكترونياً يؤديه الطلاب من بوابتهم وتصل محاولاتهم إليك مباشرة." actions={<Button type="button" onClick={() => setChooseTypeOpen(true)}>+ إنشاء اختبار جديد</Button>} />
    <ErrorNotice error={error} />
    <div className="exam-type-guide"><div className="exam-type-guide-head"><div><h2 className="h3">أنواع الأسئلة</h2><p>رأس كل سؤال وتخطيطه يجهزان تلقائياً، وشارة ملوّنة تميّز نوعه أثناء الإنشاء.</p></div><Badge tone="info">{EGYPT_TYPES.length} أنواع</Badge></div><div className="exam-type-guide-grid">{EGYPT_TYPES.map((type) => <div key={type.type} className="exam-guide-type"><span className="exam-guide-icon">{type.icon}</span><strong>{type.label}</strong><small>{type.manual ? 'تصحيح يدوي من لوحة النتائج' : 'تصحيح تلقائي'}</small></div>)}</div></div>
    <div className="grid grid-4 workspace-kpis" style={{ margin: '16px 0' }}><Card className="compact kpi workspace-stat purple"><span className="workspace-stat-icon">📝</span><span className="muted">كل الاختبارات</span><div className="kpi-value">{exams.length}</div></Card><Card className="compact kpi workspace-stat blue"><span className="workspace-stat-icon">◉</span><span className="muted">إلكترونية</span><div className="kpi-value">{exams.filter((exam) => (exam.delivery_mode ?? 'online') === 'online').length}</div></Card><Card className="compact kpi workspace-stat green"><span className="workspace-stat-icon">✓</span><span className="muted">منشورة للطلاب</span><div className="kpi-value">{exams.filter((exam) => exam.is_published).length}</div></Card><Card className="compact kpi workspace-stat amber"><span className="workspace-stat-icon">?</span><span className="muted">إجمالي الأسئلة</span><div className="kpi-value">{exams.reduce((sum, exam) => sum + exam.questions.length, 0)}</div></Card></div>
    {exams.length ? <Card className="workspace-filters stack"><div className="workspace-filter-grid"><Input label="بحث" value={librarySearch} onChange={(event) => setLibrarySearch(event.target.value)} placeholder="عنوان أو مادة أو صف" /><Select label="الصف" value={libraryGrade} onChange={(event) => setLibraryGrade(event.target.value)}><option value="all">كل الصفوف ({exams.length})</option>{grades.map((grade) => <option key={grade.id} value={grade.id}>{grade.name} ({exams.filter((exam) => exam.grade_id === grade.id).length})</option>)}</Select><Select label="نوع الاختبار" value={libraryType} onChange={(event) => setLibraryType(event.target.value as ExamLibraryType)}><option value="all">الكل — ورقي وإلكتروني</option><option value="paper">ورقي</option><option value="online">إلكتروني</option></Select><Select label="الحالة" value={libraryStatus} onChange={(event) => setLibraryStatus(event.target.value as typeof libraryStatus)}><option value="all">كل الحالات</option><option value="published">منشور</option><option value="draft">مسودة / ورقي</option></Select></div><div className="row-between exam-filter-footer"><div className="row"><Badge tone="default">النتائج: {filteredExams.length} من {exams.length}</Badge>{libraryGrade !== 'all' ? <Badge tone="default">الصف: {grades.find((grade) => grade.id === libraryGrade)?.name}</Badge> : null}{libraryType !== 'all' ? <Badge tone={libraryType === 'online' ? 'info' : 'default'}>{libraryType === 'online' ? 'إلكتروني' : 'ورقي'}</Badge> : null}</div><div className="row"><div className="view-switch" role="group" aria-label="طريقة عرض الاختبارات"><button type="button" className={libraryView === 'grid' ? 'active' : ''} onClick={() => setLibraryView('grid')}>▦ كروت</button><button type="button" className={libraryView === 'list' ? 'active' : ''} onClick={() => setLibraryView('list')}>☷ قائمة</button></div>{librarySearch || libraryGrade !== 'all' || libraryType !== 'all' || libraryStatus !== 'all' ? <Button type="button" variant="ghost" onClick={() => { setLibrarySearch(''); setLibraryGrade('all'); setLibraryType('all'); setLibraryStatus('all'); }}>إعادة تعيين الفلاتر</Button> : null}</div></div></Card> : null}
    {filteredExams.length === 0 ? <Card><EmptyState title={exams.length ? 'لا توجد اختبارات مطابقة للفلاتر' : 'لا توجد اختبارات بعد'} body={exams.length ? 'جرّب تغيير الفلاتر أو إعادة تعيينها.' : 'اختر اختباراً ورقياً أو إلكترونياً لبدء الإنشاء.'} action={<Button type="button" onClick={() => setChooseTypeOpen(true)}>إنشاء أول اختبار</Button>} /></Card> : libraryView === 'grid' ? <section key="exams-grid" className="exam-library-grid">{filteredExams.map((exam) => <Card className="exam-library-card" key={exam.id}><div className="exam-library-card-top"><span className={`exam-card-icon ${exam.delivery_mode ?? 'online'}`}>{(exam.delivery_mode ?? 'online') === 'paper' ? '🖨' : '◉'}</span><Badge tone="default">{formatDate(exam.created_at)}</Badge></div><div className="exam-card-title"><h2 className="h3">{exam.title}</h2><p className="muted small">{exam.subject || 'بدون مادة'}</p></div>{renderExamBadges(exam)}<div className="exam-card-footer">{renderExamActions(exam, 'card')}</div></Card>)}</section> : <section key="exams-list" className="exam-library-list">{filteredExams.map((exam) => <Card className="exam-library-row" key={exam.id}><span className={`exam-card-icon ${exam.delivery_mode ?? 'online'}`}>{(exam.delivery_mode ?? 'online') === 'paper' ? '🖨' : '◉'}</span><div className="exam-row-main"><div className="row"><h2 className="h3">{exam.title}</h2><Badge tone="default">{exam.questions.length} سؤال</Badge></div><p className="muted small">{exam.subject || 'بدون مادة'} · {grades.find((grade) => grade.id === exam.grade_id)?.name ?? 'كل الصفوف'} · أُنشئ {formatDate(exam.created_at)}</p>{renderExamBadges(exam)}</div>{renderExamActions(exam, 'row')}</Card>)}</section>}
  </>;

  const builder = <section className="exam-editor-fullscreen" dir="rtl"><header className="exam-editor-topbar"><div><div className="row"><h1 className="h3">{form.id ? 'تعديل الاختبار' : 'إنشاء اختبار جديد'}</h1><Badge tone={form.delivery_mode === 'online' ? 'info' : 'default'}>{form.delivery_mode === 'online' ? `إلكتروني — ${ONLINE_MODES.find((mode) => mode.id === form.online_mode)?.title}` : 'ورقي للطباعة'}</Badge></div><p className="muted small">{form.delivery_mode === 'online' ? 'اضبط الإتاحة والمجموعات، ثم انشر الاختبار عندما يصبح جاهزاً.' : 'اكتب الورقة، اختر قالبها وزخارفها، ثم اطبعها أو احفظها PDF.'}</p></div><div className="row"><span className="editor-save-state">{form.id ? '✓ مسودة محفوظة' : 'لم يُحفظ بعد'}</span><Button type="button" variant="secondary" onClick={() => setWorkspace('library')}>← العودة للاختبارات</Button></div></header><main className="exam-editor-main"><ErrorNotice error={error} /><div className="exam-builder-steps"><span className="active">1. الإعداد والنطاق</span><span>2. التحكم والإتاحة</span><span>3. الأسئلة</span><span>4. المعاينة والحفظ</span></div><div className="exam-builder-layout"><div className="stack exam-editor-stack"><section className="exam-workspace-section"><div className="exam-editor-section-title"><span>1</span><div><h2 className="h3">بيانات الاختبار والنطاق</h2><p>اختر الصف أولاً؛ بعدها تظهر مجموعاته فقط للتحكم في من يرى الاختبار.</p></div></div><Card className="stack"><div className="grid grid-3"><Input id="exam-title" label="عنوان الاختبار" value={form.title} onChange={(event) => { setForm({ ...form, title: event.target.value }); setTitleError(false); }} required aria-invalid={titleError} help={titleError ? 'عنوان الاختبار مطلوب قبل الحفظ.' : undefined} /><Input label="المادة" value={form.subject} onChange={(event) => setForm({ ...form, subject: event.target.value })} /><Select label="الصف المستهدف" value={form.grade_id} onChange={(event) => setExamGrade(event.target.value)}><option value="">كل الصفوف</option>{grades.map((grade) => <option key={grade.id} value={grade.id}>{grade.name}</option>)}</Select><Input label="المدة بالدقائق" type="number" min={1} value={form.duration} onChange={(event) => setForm({ ...form, duration: event.target.value })} /><Input label="عدد المحاولات لكل طالب" type="number" min={1} value={form.attempts} onChange={(event) => setForm({ ...form, attempts: event.target.value })} /><Select label="إظهار النتيجة" value={form.show_result} onChange={(event) => setForm({ ...form, show_result: event.target.value as ExamResultMode })}><option value="end">بعد التسليم</option><option value="after_each">بعد كل سؤال</option><option value="never">بعد تحرير النتائج فقط</option></Select></div>{form.delivery_mode === 'paper' ? <Textarea label="عبارة ختام الاختبار (اختيارية)" value={form.paper_footer} onChange={(event) => setForm({ ...form, paper_footer: event.target.value })} placeholder="مثال: راجع إجاباتك جيداً قبل تسليم الورقة." help="تظهر هذه العبارة في نهاية ورقة الاختبار بدلاً من العبارة الافتراضية." /> : null}{form.delivery_mode === 'online' ? <div className="scope-picker"><div className="row-between"><div><strong>المجموعات المستهدفة</strong><p className="muted small">اتركها بلا اختيار ليظهر الاختبار لجميع مجموعات الصف. لا تظهر أبداً مجموعات صف آخر.</p></div><Badge tone="info">{form.target_group_ids.length ? `${form.target_group_ids.length} محددة` : 'كل مجموعات الصف'}</Badge></div>{form.grade_id ? <div className="target-group-chips">{groupsOfSelectedGrade.length ? groupsOfSelectedGrade.map((group) => <button type="button" key={group.id} className={form.target_group_ids.includes(group.id) ? 'active' : ''} onClick={() => toggleTargetGroup(group.id)}>{form.target_group_ids.includes(group.id) ? '✓ ' : ''}{group.name}</button>) : <Notice tone="warn">لا توجد مجموعات في هذا الصف.</Notice>}</div> : <Notice tone="info">الاختبار العام يظهر لكل الصفوف؛ اختر صفاً لإتاحة اختيار المجموعات.</Notice>}</div> : null}</Card></section><section className="exam-workspace-section"><div className="exam-editor-section-title"><span>2</span><div><h2 className="h3">التحكم والشكل</h2><p>{form.delivery_mode === 'online' ? 'حدد نمط الأداء والإتاحة قبل النشر.' : 'اختر قالب الورقة والزخارف التي تناسب المادة.'}</p></div></div><Card className="stack">{form.delivery_mode === 'online' ? <><div className="online-mode-row">{ONLINE_MODES.map((mode) => <button type="button" key={mode.id} className={form.online_mode === mode.id ? 'active' : ''} onClick={() => setForm({ ...form, online_mode: mode.id })}><strong>{mode.title}</strong><small>{mode.lead}</small><em>{mode.description}</em></button>)}</div><div className="row-between"><div><strong>نشر الاختبار للطلاب</strong><p className="muted small">يمكن حفظ المسودة أولاً ثم النشر بعد استكمال الأسئلة.</p></div><label className="switch-row"><input type="checkbox" checked={form.is_published} onChange={(event) => setForm({ ...form, is_published: event.target.checked })} /><span>{form.is_published ? 'منشور' : 'مسودة'}</span></label></div><div className="availability-panel"><strong>إتاحة الاختبار</strong><div className="tabs"><button type="button" className={`tab ${form.availability_mode === 'always' ? 'active' : ''}`} onClick={() => setForm({ ...form, availability_mode: 'always' })}>مفتوح دائماً</button><button type="button" className={`tab ${form.availability_mode === 'scheduled' ? 'active' : ''}`} onClick={() => setForm({ ...form, availability_mode: 'scheduled' })}>فترة زمنية محددة</button></div>{form.availability_mode === 'scheduled' ? <div className="grid grid-2"><Input label="يفتح في" type="datetime-local" value={form.available_from} onChange={(event) => setForm({ ...form, available_from: event.target.value })} /><Input label="يغلق في" type="datetime-local" value={form.available_until} onChange={(event) => setForm({ ...form, available_until: event.target.value })} /></div> : <p className="muted small">سيظهر الاختبار المنشور فوراً للطلاب المستهدفين.</p>}</div></> : <><div className="template-picker">{PAPER_TEMPLATES.map((template) => <button type="button" key={template.id} className={form.paper_template === template.id ? 'active' : ''} onClick={() => setForm({ ...form, paper_template: template.id })}><span>{template.symbol}</span><strong>{template.title}</strong><small>{template.description}</small></button>)}</div><details className="exam-appearance-panel"><summary>🎨 تخصيص الزخارف والأختام (اختياري)</summary><div className="stack" style={{ marginTop: 12 }}><div className="row-between"><h3 className="h3">زخارف ورقة الاختبار</h3><Button type="button" variant="secondary" onClick={() => setOrnaments({ ...ornaments, kinds: ornamentsForSubject(form.subject).map((ornament) => ornament.kind) })}>تعبئة حسب المادة ({subjectLabelFor(form.subject)})</Button></div><div className="grid grid-3"><Select label="أسلوب التوزيع" value={ornaments.placement} onChange={(event) => setOrnaments({ ...ornaments, placement: event.target.value as 'auto' | 'manual' })}><option value="auto">تلقائي على الحواف</option><option value="manual">يدوي (أختام)</option></Select><Select label="الكثافة" value={ornaments.density} onChange={(event) => setOrnaments({ ...ornaments, density: event.target.value as ExamOrnaments['density'] })}><option value="low">خفيفة</option><option value="medium">متوسطة</option><option value="high">كثيفة</option></Select><div className="input-wrap"><span className="label">الشفافية: {Math.round((ornaments.opacity ?? 0.18) * 100)}%</span><input className="input" type="range" min={4} max={50} value={Math.round((ornaments.opacity ?? 0.18) * 100)} onChange={(event) => setOrnaments({ ...ornaments, opacity: Number(event.target.value) / 100 })} /></div></div><div className="stamp-palette">{ALL_ORNAMENTS.map((ornament) => { const active = ornaments.kinds.includes(ornament.kind); return <button key={ornament.kind} type="button" title={ornament.label} className={`stamp-chip ${active ? 'active' : ''}`} onClick={() => setOrnaments({ ...ornaments, kinds: active ? ornaments.kinds.filter((kind) => kind !== ornament.kind) : [...ornaments.kinds, ornament.kind] })}>{ornament.glyph}</button>; })}</div>{ornaments.placement === 'manual' ? <Notice tone="info">افتح المعاينة الورقية ثم اختر ختماً واضغط على الورقة لوضعه.</Notice> : null}</div></details></>}</Card></section><section className="exam-workspace-section">
  <div className="exam-editor-section-title"><span>3</span><div><h2 className="h3">بناء الأسئلة</h2><p>أضف سؤالاً رئيسياً من النوع المطلوب، ثم أضف تحته الأسئلة الفرعية كما في Center Publish.</p></div></div>
  <Card className="stack"><div className="exam-type-palette">{EGYPT_TYPES.map((type) => <button key={type.type} type="button" className="exam-type-btn" onClick={() => addQuestion(type.type)}><span className="exam-type-icon">{type.icon}</span><span>إضافة سؤال رئيسي: {type.label}</span></button>)}</div></Card>
  <div className="questions-workspace">{questionSections.map((section, mainIndex) => { const meta = egyptMeta(section.type); return <section key={section.id} className="exam-main-question"><div className="exam-main-question-head"><div><span className="exam-main-question-index">السؤال {mainIndex + 1}</span><h3>{meta.header}</h3><p>{meta.manual ? 'تصحيح يدوي بعد التسليم' : 'تصحيح تلقائي عند التسليم'}</p></div><Badge tone="info">{section.indices.length} سؤال فرعي</Badge></div><div className="exam-subquestions">{section.indices.map((questionIndex, subIndex) => <QuestionEditor key={`${section.id}-${questionIndex}`} q={questions[questionIndex]} answer={answers[questionIndex]} mainNumber={mainIndex + 1} subNumber={subIndex + 1} onQuestion={(next) => updateQuestion(questionIndex, next)} onAnswer={(next) => updateAnswer(questionIndex, next)} onDelete={() => removeQuestion(questionIndex)} onMove={(delta) => move(questionIndex, delta)} />)}</div><Button type="button" variant="secondary" className="block" onClick={() => addSubQuestion(section.id, section.type)}>＋ إضافة سؤال فرعي جديد ({section.indices.length + 1})</Button></section>; })}</div>
  <p className="exam-builder-total">إجمالي الاختبار: <strong>{questions.length}</strong> سؤال فرعي · <strong>{total}</strong> درجة</p>
</section>{selected ? <section className="exam-workspace-section"><div className="exam-editor-section-title"><span>4</span><div><h2 className="h3">المحاولات والتصحيح</h2><p>راجع إجابات الطلاب سؤالاً بسؤال وحرر النتيجة بعد اعتمادها.</p></div><Badge tone="info">{attempts.length} محاولة</Badge></div><Card className="stack">{attempts.length === 0 ? <EmptyState title="لا توجد محاولات بعد" /> : <div className="table-wrap"><table><thead><tr><th>الطالب</th><th>الدرجة</th><th>الحالة</th><th>التاريخ</th><th>إجراء</th></tr></thead><tbody>{attempts.map((attempt) => <tr key={attempt.id}><td><strong>{studentName.get(attempt.student_id) ?? attempt.student_id}</strong></td><td>{attempt.score} / {attempt.max_score}</td><td><Badge tone={attempt.status === 'graded' ? 'success' : 'warn'}>{attempt.status === 'graded' ? 'مصححة' : 'بانتظار المراجعة'}</Badge></td><td>{formatDate(attempt.created_at)}</td><td><div className="row"><Button type="button" variant="secondary" onClick={() => openReview(attempt)}>مراجعة</Button><input className="input" style={{ width: 86 }} value={manualScores[attempt.id] ?? ''} onChange={(event) => setManualScores({ ...manualScores, [attempt.id]: event.target.value })} placeholder="درجة" inputMode="decimal" /><Button type="button" variant="ghost" onClick={() => void grade(attempt.id)}>حفظ سريع</Button></div></td></tr>)}</tbody></table></div>}</Card></section> : null}</div></div></main><footer className="exam-editor-footer"><div>{validation ? <span className="editor-validation">⚠ {validation}</span> : <span className="editor-validation good">✓ الاختبار يحتوي على {questions.length} سؤال و{total} درجة</span>}</div><div className="row"><Button type="button" variant="secondary" onClick={() => setTryoutOpen(true)}>اختبر كطالب</Button><Button type="button" variant="secondary" onClick={openDraftPreview}>معاينة قبل الحفظ</Button><Button type="button" disabled={busy} onClick={() => void submit()}>{busy ? 'جاري الحفظ...' : form.delivery_mode === 'paper' ? '💾 حفظ ورقة الاختبار' : form.is_published ? '💾 حفظ ونشر الاختبار' : '💾 حفظ المسودة'}</Button></div></footer></section>;

  return <>
    {workspace === 'library' ? library : builder}
    <Modal open={chooseTypeOpen} title="اختر نوع الاختبار" subtitle="اختر طريقة أداء الطلاب أولاً؛ ستفتح لك مساحة إنشاء مناسبة لكل مسار." onClose={() => setChooseTypeOpen(false)} wide footer={<Button type="button" variant="ghost" onClick={() => setChooseTypeOpen(false)}>إلغاء</Button>}><div className="exam-create-choices"><button type="button" className="exam-create-choice paper" onClick={() => beginCreate('paper')}><span className="exam-create-icon">🖨</span><strong>اختبار ورقي</strong><span>اكتب الأسئلة، اختر قالب الورقة والزخارف، ثم عاينها واطبعها PDF.</span><em>ورقة مطبوعة</em></button><button type="button" className="exam-create-choice online" onClick={() => beginCreate('online')}><span className="exam-create-icon">◉</span><strong>اختبار إلكتروني</strong><span>يؤديه الطلاب من حسابهم، مع النشر، الإتاحة، المجموعات، المحاولات والتصحيح.</span><em>أداء إلكتروني ونتائج</em></button></div></Modal>
    <Modal open={chooseOnlineModeOpen} title="اختر نمط الاختبار الإلكتروني" subtitle="يمكنك تغييره لاحقاً من مساحة التحكم، مع بقاء كل أنواع أسئلة Mr Center متاحة." onClose={() => setChooseOnlineModeOpen(false)} wide footer={<Button type="button" variant="ghost" onClick={() => setChooseOnlineModeOpen(false)}>إلغاء</Button>}><div className="online-mode-row dialog">{ONLINE_MODES.map((mode) => <button type="button" key={mode.id} onClick={() => openEditor('online', mode.id)}><strong>{mode.title}</strong><small>{mode.lead}</small><em>{mode.description}</em></button>)}</div></Modal>
    <Modal
      open={preview}
      title={previewSource?.title || form.title || 'معاينة الاختبار'}
      subtitle={`${previewSource?.questions.length ?? questions.length} سؤال · ${previewSource?.total_score ?? total} درجة · ${previewSource?.duration_minutes ?? form.duration} دقيقة`}
      onClose={() => { setPreview(false); setPreviewSource(null); }}
      wide
      footer={<div className="row">{previewIsSavedPaper && previewMode === 'paper' ? <Button type="button" variant="secondary" disabled={savingPreviewPaper} onClick={() => void savePreviewPaperAppearance()}>{savingPreviewPaper ? 'جارٍ حفظ شكل الورقة...' : 'حفظ القالب والزخارف'}</Button> : null}<Button type="button" variant="secondary" onClick={() => void printCenterExamPaper(centerId)}>طباعة احترافية / PDF</Button><Button type="button" onClick={() => { setPreview(false); setPreviewSource(null); }}>إغلاق</Button></div>}
    >
      <div className="tabs" style={{ marginBottom: 16 }}><button type="button" className={`tab ${previewMode === 'paper' ? 'active' : ''}`} onClick={() => setPreviewMode('paper')}>🖨 ورقي (للطباعة)</button><button type="button" className={`tab ${previewMode === 'electronic' ? 'active' : ''}`} onClick={() => setPreviewMode('electronic')}>◉ إلكتروني</button></div>
      {previewMode === 'paper' ? <div className="paper-preview-workspace"><PaperPreviewControls subject={previewPaperSubject} template={previewPaperTemplateValue} ornaments={previewPaperOrnamentsValue} layout={previewPaperLayout} onTemplate={updatePreviewPaperTemplate} onOrnaments={updatePreviewPaperOrnaments} onLayout={setPreviewPaperLayout} /><div className="paper-preview-canvas">{previewPaperOrnamentsValue.placement === 'manual' ? <StampEditor ornaments={previewPaperOrnamentsValue} onChange={updatePreviewPaperOrnaments}><ExamPaper title={previewSource?.title ?? form.title} subject={previewPaperSubject} duration={String(previewSource?.duration_minutes ?? form.duration)} total={previewSource?.total_score ?? total} questions={previewPaperQuestions} ornaments={null} template={previewPaperTemplateValue} printLayout={previewPaperLayout} footerText={previewSource?.paper_footer ?? form.paper_footer} branding={printBranding} /></StampEditor> : <ExamPaper title={previewSource?.title ?? form.title} subject={previewPaperSubject} duration={String(previewSource?.duration_minutes ?? form.duration)} total={previewSource?.total_score ?? total} questions={previewPaperQuestions} ornaments={previewPaperOrnamentsValue} template={previewPaperTemplateValue} printLayout={previewPaperLayout} footerText={previewSource?.paper_footer ?? form.paper_footer} branding={printBranding} />}</div></div> : <ElectronicExamView questions={previewSource?.questions ?? questions} />}
    </Modal>

    <Modal
      open={!!settingsExam && !!settingsForm}
      title="إعدادات الاختبار"
      subtitle={settingsExam ? `تحكم في الإتاحة والمحاولات وطريقة النتيجة لاختبار: ${settingsExam.title}` : ''}
      onClose={() => { setSettingsExam(null); setSettingsForm(null); }}
      wide
      footer={<div className="row"><Button type="button" variant="ghost" onClick={() => { setSettingsExam(null); setSettingsForm(null); }}>إلغاء</Button><Button type="button" disabled={savingSettings} onClick={() => void saveSettings()}>{savingSettings ? 'جارٍ الحفظ...' : 'حفظ الإعدادات'}</Button></div>}
    >
      {settingsExam && settingsForm ? <div className="stack exam-settings-dialog">
        <div className="grid grid-3"><Input label="مدة الاختبار بالدقائق" type="number" min={1} value={settingsForm.duration} onChange={(event) => setSettingsForm({ ...settingsForm, duration: event.target.value })} /><Input label="المحاولات لكل طالب" type="number" min={1} value={settingsForm.attempts} onChange={(event) => setSettingsForm({ ...settingsForm, attempts: event.target.value })} /><Select label="إظهار النتيجة" value={settingsForm.show_result} onChange={(event) => setSettingsForm({ ...settingsForm, show_result: event.target.value as ExamResultMode })}><option value="end">بعد التسليم</option><option value="after_each">بعد كل سؤال</option><option value="never">بعد المراجعة فقط</option></Select></div>
        {(settingsExam.delivery_mode ?? 'online') === 'online' ? <><div className="settings-surface"><div className="row-between"><div><strong>نشر الاختبار للطلاب</strong><p className="muted small">الحفظ لا ينشر تلقائياً إلا عند تفعيل هذا الخيار.</p></div><label className="switch-row"><input type="checkbox" checked={settingsForm.is_published} onChange={(event) => setSettingsForm({ ...settingsForm, is_published: event.target.checked })} /><span>{settingsForm.is_published ? 'منشور' : 'مسودة'}</span></label></div></div><div className="settings-surface stack"><div className="row-between"><div><strong>الصف والمجموعات المستهدفة</strong><p className="muted small">لا يمكن اختيار إلا مجموعات الصف المحدد. عدم اختيار مجموعة يعني كل مجموعات الصف.</p></div><Badge tone="info">{settingsForm.target_group_ids.length ? `${settingsForm.target_group_ids.length} مجموعات` : 'كل المجموعات'}</Badge></div><Select label="الصف المستهدف" value={settingsForm.grade_id} onChange={(event) => setSettingsForm({ ...settingsForm, grade_id: event.target.value, target_group_ids: [] })}><option value="">كل الصفوف</option>{grades.map((grade) => <option key={grade.id} value={grade.id}>{grade.name}</option>)}</Select>{settingsForm.grade_id ? <div className="target-group-chips">{settingsGroups.length ? settingsGroups.map((group) => <button type="button" key={group.id} className={settingsForm.target_group_ids.includes(group.id) ? 'active' : ''} onClick={() => toggleSettingsGroup(group.id)}>{settingsForm.target_group_ids.includes(group.id) ? '✓ ' : ''}{group.name}</button>) : <Notice tone="warn">لا توجد مجموعات لهذا الصف.</Notice>}</div> : <Notice tone="info">الاختبار العام لا يحتاج اختيار مجموعات.</Notice>}</div><div className="settings-surface stack"><strong>نافذة الإتاحة</strong><div className="tabs"><button type="button" className={`tab ${settingsForm.availability_mode === 'always' ? 'active' : ''}`} onClick={() => setSettingsForm({ ...settingsForm, availability_mode: 'always' })}>مفتوح دائماً</button><button type="button" className={`tab ${settingsForm.availability_mode === 'scheduled' ? 'active' : ''}`} onClick={() => setSettingsForm({ ...settingsForm, availability_mode: 'scheduled' })}>فتح وإغلاق مجدول</button></div>{settingsForm.availability_mode === 'scheduled' ? <div className="grid grid-2"><Input label="يفتح في" type="datetime-local" value={settingsForm.available_from} onChange={(event) => setSettingsForm({ ...settingsForm, available_from: event.target.value })} /><Input label="يغلق في" type="datetime-local" value={settingsForm.available_until} onChange={(event) => setSettingsForm({ ...settingsForm, available_until: event.target.value })} /></div> : <p className="muted small">سيظهر الاختبار المنشور فوراً للطلاب المستهدفين.</p>}</div></> : <div className="settings-surface stack"><strong>قالب الورقة</strong><div className="template-picker">{PAPER_TEMPLATES.map((template) => <button type="button" key={template.id} className={settingsForm.paper_template === template.id ? 'active' : ''} onClick={() => setSettingsForm({ ...settingsForm, paper_template: template.id })}><span>{template.symbol}</span><strong>{template.title}</strong><small>{template.description}</small></button>)}</div></div>}
      </div> : null}
    </Modal>

    <Modal
      open={!!resultsExam}
      title="نتائج الاختبار ومراجعتها"
      subtitle={resultsExam ? `${resultsExam.title} · ${attempts.length} محاولة` : ''}
      onClose={() => setResultsExam(null)}
      wide
      footer={<div className="row"><Button type="button" variant="secondary" onClick={() => resultsExam && void openResults(resultsExam)}>تحديث القائمة</Button><Button type="button" onClick={() => setResultsExam(null)}>إغلاق</Button></div>}
    >
      {resultsExam ? attempts.length === 0 ? <EmptyState title="لا توجد محاولات لهذا الاختبار حتى الآن" body="عند أداء الطلاب للاختبار الإلكتروني ستظهر محاولاتهم ودرجاتهم هنا." /> : <div className="table-wrap results-table"><table><thead><tr><th>الطالب</th><th>الدرجة</th><th>الحالة</th><th>وقت المحاولة</th><th>المراجعة</th></tr></thead><tbody>{attempts.map((attempt) => <tr key={attempt.id}><td><strong>{studentName.get(attempt.student_id) ?? attempt.student_id}</strong></td><td><strong>{attempt.score} / {attempt.max_score}</strong></td><td><Badge tone={attempt.status === 'graded' ? 'success' : 'warn'}>{attempt.status === 'graded' ? 'مصححة' : 'بانتظار المراجعة'}</Badge></td><td>{formatDate(attempt.created_at)}</td><td><div className="row"><Button type="button" variant="secondary" onClick={() => openReview(attempt)}>مراجعة الإجابات</Button><input className="input" style={{ width: 82 }} value={manualScores[attempt.id] ?? ''} onChange={(event) => setManualScores({ ...manualScores, [attempt.id]: event.target.value })} placeholder="درجة" inputMode="decimal" /><Button type="button" variant="ghost" onClick={() => void grade(attempt.id)}>حفظ</Button></div></td></tr>)}</tbody></table></div> : null}
    </Modal>

    <Modal open={!!reviewAttempt} title="مراجعة المحاولة سؤالاً بسؤال" subtitle={reviewAttempt ? `${studentName.get(reviewAttempt.student_id) ?? reviewAttempt.student_id} · ${reviewAttempt.score} / ${reviewAttempt.max_score}` : ''} onClose={() => setReviewAttempt(null)} wide footer={<div className="row-between"><div className="row"><Button type="button" variant="secondary" onClick={() => setReviewTotal(String(reviewManualTotal()))}>اعتماد الدرجة المقترحة ({reviewManualTotal()})</Button><label className="row small muted" style={{ gap: 8 }}>الدرجة النهائية<input className="input" style={{ width: 100 }} type="number" min={0} value={reviewTotal} onChange={(event) => setReviewTotal(event.target.value)} /></label></div><Button type="button" disabled={savingReview} onClick={() => void saveReview()}>{savingReview ? 'جارٍ الحفظ...' : 'حفظ وتحرير النتيجة'}</Button></div>}>{reviewAttempt && selected ? <div className="stack">{selected.questions.map((question, index) => { const key = selected.answers?.[index]; const given = (reviewAttempt.answers ?? [])[index]; const result = suggestGrade(question, key, given); const manual = result.correct === null; const tone = result.correct === true ? 'success' : result.correct === false ? 'danger' : 'warn'; return <div key={index} className={`card compact soft stack ${result.correct === true ? 'review-correct' : result.correct === false ? 'review-wrong' : ''}`} style={{ gap: 8 }}><div className="row-between"><strong style={{ flex: 1 }}>{index + 1}. {question.q}</strong><div className="row" style={{ gap: 8 }}><Badge tone="info">{EXAM_TYPE_LABEL[question.type] ?? question.type} · {question.marks} درجة</Badge>{manual ? <label className="row tiny muted" style={{ gap: 6 }}>درجة يدوية<input className="input" style={{ width: 76 }} type="number" min={0} max={question.marks} value={reviewScores[index] ?? ''} onChange={(event) => setReviewScores({ ...reviewScores, [index]: event.target.value })} /></label> : <Badge tone={tone as 'success' | 'danger' | 'warn'}>{result.earned} / {question.marks}</Badge>}</div></div><div className="row small notice"><span style={{ flex: 1 }}><b>إجابة الطالب: </b>{answerLabel(question, given)}</span></div><div className="row small notice" style={{ background: 'var(--success)14', border: '1px solid var(--success)44' }}><span><b>الإجابة النموذجية: </b>{correctLabel(question, key)}</span></div></div>; })}</div> : null}</Modal>
  </>;
}
