'use client';

import { useEffect, useMemo, useState } from 'react';
import { Badge, Input } from '@/components/ui';
import { QuestionImage } from '@/components/exam/ornaments';
import { CHOICE_KEYS } from '@/lib/exam-egyptian';
import type { ExamAnswer, ExamPair, ExamQuestion } from '@/lib/types';

export function isExamQuestionAnswered(question: ExamQuestion, answer: ExamAnswer): boolean {
  if (question.type === 'mcq' || question.type === 'tf') return answer !== null && answer !== undefined && answer !== '';
  if (question.type === 'multi') return Array.isArray(answer) && answer.length > 0;
  if (question.type === 'match') return Array.isArray(answer) && answer.length === (question.pairs?.length ?? 0) && answer.every((item) => typeof item === 'number' && item >= 0);
  return typeof answer === 'string' && answer.trim() !== '';
}

/** يعرض الجملة مع الكلمة/الكلمات التي اختارها المنشئ تحت خط في سؤال التصويب. */
export function UnderlinedQuestionText({ question }: { question: Pick<ExamQuestion, 'q' | 'type' | 'underlined'> }) {
  if (question.type !== 'correct' || !question.underlined?.count) return <>{question.q}</>;
  const start = Math.max(0, question.underlined.start - 1);
  const end = start + Math.max(0, question.underlined.count);
  let wordIndex = 0;
  return <>{question.q.split(/(\s+)/).map((piece, index) => {
    if (!piece.trim()) return <span key={index}>{piece}</span>;
    const underlined = wordIndex >= start && wordIndex < end;
    wordIndex += 1;
    return underlined ? <u key={index} className="exam-underlined-word">{piece}</u> : <span key={index}>{piece}</span>;
  })}</>;
}

function deterministicRightOrder(pairs: ExamPair[]): number[] {
  // ترتيب ثابت لكنه غير مطابق للعمود الأيسر؛ لا يعاد خلطه مع كل إجابة طالب.
  return pairs.map((pair, index) => ({ index, key: `${pair.r}|${pair.l}|${index}`.split('').reduce((sum, char) => ((sum * 31) + char.charCodeAt(0)) >>> 0, 17) }))
    .sort((a, b) => a.key - b.key).map((item) => item.index);
}

/** مطابقة تفاعلية مناسبة للهاتف: اختر بنداً من أ ثم البطاقة المطابقة من ب، مع إظهار الربط الحالي بوضوح. */
export function InteractiveMatch({ pairs, value, onChange }: { pairs: ExamPair[]; value: number[]; onChange: (value: ExamAnswer) => void }) {
  const [activeLeft, setActiveLeft] = useState<number | null>(null);
  const mapping = pairs.map((_, index) => typeof value[index] === 'number' ? value[index] : -1);
  const rightOrder = useMemo(() => deterministicRightOrder(pairs), [pairs]);
  useEffect(() => setActiveLeft(null), [pairs]);
  const unanswered = mapping.findIndex((rightIndex) => rightIndex < 0);
  const connect = (rightIndex: number) => {
    const leftIndex = activeLeft ?? unanswered;
    if (leftIndex < 0) return;
    const next = [...mapping];
    const priorOwner = next.findIndex((mapped) => mapped === rightIndex);
    if (priorOwner >= 0 && priorOwner !== leftIndex) next[priorOwner] = -1;
    next[leftIndex] = rightIndex;
    onChange(next);
    setActiveLeft(next.findIndex((mapped) => mapped < 0));
  };
  const clear = (leftIndex: number) => {
    const next = [...mapping]; next[leftIndex] = -1; onChange(next); setActiveLeft(leftIndex);
  };
  const complete = mapping.filter((item) => item >= 0).length;

  return <div className="interactive-match" dir="rtl">
    <div className="interactive-match-help"><div><strong>وصّل بين العمودين</strong><span>اختر بنداً من (أ)، ثم اضغط البطاقة المناسبة من (ب).</span></div><Badge tone={complete === pairs.length ? 'success' : 'info'}>{complete} / {pairs.length} روابط</Badge></div>
    <div className="interactive-match-board">
      <div className="match-column"><span className="match-column-title">العمود (أ)</span>{pairs.map((pair, leftIndex) => {
        const target = mapping[leftIndex];
        const selected = activeLeft === leftIndex;
        return <div className={`match-source ${selected ? 'active' : ''} ${target >= 0 ? 'matched' : ''}`} key={`left-${leftIndex}`}><button type="button" className="match-source-main" onClick={() => setActiveLeft(leftIndex)}><span className="match-index">{leftIndex + 1}</span><span>{pair.l || `البند ${leftIndex + 1}`}</span><small>{target >= 0 ? 'تم الاختيار' : selected ? 'اختر المطابق الآن' : 'اضغط للاختيار'}</small></button>{target >= 0 ? <button type="button" className="match-answer-chip" title="إلغاء هذا الربط" onClick={() => clear(leftIndex)}><span>↔ {pairs[target]?.r || `بند ${target + 1}`}</span><b>×</b></button> : null}</div>;
      })}</div>
      <div className="match-column match-target-column"><span className="match-column-title">العمود (ب)</span>{rightOrder.map((rightIndex) => {
        const owner = mapping.indexOf(rightIndex);
        const targetOfActive = activeLeft !== null && mapping[activeLeft] === rightIndex;
        return <button type="button" key={`right-${rightIndex}`} className={`match-target ${owner >= 0 ? 'used' : ''} ${targetOfActive ? 'selected-target' : ''}`} onClick={() => connect(rightIndex)}><span className="match-index">{CHOICE_KEYS[rightIndex] ?? rightIndex + 1}</span><span>{pairs[rightIndex]?.r || `البند ${rightIndex + 1}`}</span>{owner >= 0 ? <small>مرتبط بـ {owner + 1}</small> : <small>اضغط للتوصيل</small>}</button>;
      })}</div>
    </div>
  </div>;
}

/** عنصر إجابة موحد للطالب ولمحاكاة المنشئ، ليكون السلوك متطابقاً في الشاشتين. */
export function ExamQuestionInput({ question, value, onChange }: { question: ExamQuestion; value: ExamAnswer; onChange: (value: ExamAnswer) => void }) {
  if (question.type === 'mcq' || question.type === 'tf') {
    const choices = question.type === 'tf' && (!question.choices || question.choices.length === 0) ? ['صح', 'خطأ'] : question.choices;
    return <div className="stack" style={{ gap: 8 }}>{choices.map((choice, index) => <button type="button" key={index} className={`card compact soft row ${value === index ? 'choice-selected' : ''}`} style={{ width: '100%', textAlign: 'start', cursor: 'pointer', border: value === index ? '2px solid var(--accent)' : undefined }} onClick={() => onChange(index)}><span className={`choice-dot ${value === index ? 'on' : ''}`} />{question.type === 'tf' ? choice : `${CHOICE_KEYS[index]}) ${choice}`}</button>)}</div>;
  }
  if (question.type === 'multi') {
    const selected = Array.isArray(value) ? value : [];
    return <div className="stack">{question.choices.map((choice, index) => <label key={index} className="row small" style={{ padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 14, background: 'var(--soft)' }}><input type="checkbox" checked={selected.includes(index)} onChange={(event) => onChange(event.target.checked ? [...selected, index] : selected.filter((item) => item !== index))} /> {CHOICE_KEYS[index]}) {choice}</label>)}</div>;
  }
  if (question.type === 'match') return <InteractiveMatch pairs={question.pairs ?? []} value={Array.isArray(value) ? value : []} onChange={onChange} />;
  return <Input label={question.type === 'correct' ? 'التصويب الصحيح' : 'إجابتك'} value={typeof value === 'string' ? value : ''} onChange={(event) => onChange(event.target.value)} placeholder={question.type === 'correct' ? 'اكتب التصويب الصحيح للكلمة التي تحتها خط' : undefined} />;
}

export function ExamQuestionPrompt({ question, showImage = false }: { question: ExamQuestion; showImage?: boolean }) {
  return <>{showImage && question.image && question.imagePosition !== 'below' ? <QuestionImage q={question} mode="screen" /> : null}<strong className="exam-question-prompt"><UnderlinedQuestionText question={question} /></strong>{showImage && question.image && question.imagePosition === 'below' ? <QuestionImage q={question} mode="screen" /> : null}</>;
}
