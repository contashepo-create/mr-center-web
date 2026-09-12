'use client';

// ============================================================
// مراجعة الاختبار بعد التسليم — مطابقة لتجربة النسخة الأصلية:
// بطاقة الدرجة بتلوين حسب النسبة + مراجعة سؤال بسؤال تعرض إجابة
// الطالب وحكم التصحيح والإجابة الصحيحة تحت الإجابات الخاطئة
// وشارة «بانتظار تصحيح المعلم» للأسئلة اليدوية.
// ============================================================

import { Badge, Button, Card, Notice } from '@/components/ui';
import type { ExamResult } from '@/lib/api';
import type { ExamAnswer, ExamQuestion } from '@/lib/types';

/** لون الدرجة حسب النسبة: أخضر ≥85 · كهرماني ≥50 · أحمر أقل */
export function scoreColor(pct: number): string {
  if (pct >= 85) return 'var(--success)';
  if (pct >= 50) return 'var(--warn)';
  return 'var(--danger)';
}

export function scoreTone(pct: number): 'success' | 'warn' | 'danger' {
  if (pct >= 85) return 'success';
  if (pct >= 50) return 'warn';
  return 'danger';
}

/** نص إجابة الطالب كما كُتبت */
export function answerLabel(q: ExamQuestion, a: ExamAnswer | undefined): string {
  if (a === null || a === undefined || a === '') return 'لم تُجب';
  switch (q.type) {
    case 'mcq':
      return typeof a === 'number' ? (q.choices[a] ?? 'لم تُجب') : 'لم تُجب';
    case 'tf':
      return a === 1 ? 'صح' : a === 0 ? 'خطأ' : 'لم تُجب';
    case 'multi':
      return Array.isArray(a) && a.length > 0 ? a.map((i) => q.choices[i]).filter(Boolean).join('، ') : 'لم تُجب';
    case 'match': {
      if (!Array.isArray(a) || a.length === 0) return 'لم تُجب';
      const pairs = q.pairs ?? [];
      const parts = pairs.map((p, i) => `${p.l} ← ${pairs[a[i]]?.r ?? '—'}`);
      return parts.some((x) => x.includes('—')) && a.length !== pairs.length ? 'إجابة ناقصة' : parts.join(' · ');
    }
    default:
      return typeof a === 'string' && a.trim() !== '' ? a.trim() : 'لم تُجب';
  }
}

/** الإجابة النموذجية نصاً (من النموذج المرسل من الخادم أو من نص السؤال لأكمل/صحّح) */
export function correctLabel(q: ExamQuestion, model: ExamAnswer | undefined): string {
  if (model === null || model === undefined) return '—';
  switch (q.type) {
    case 'mcq':
      return typeof model === 'number' ? (q.choices[model] ?? '—') : '—';
    case 'tf':
      return model === 1 ? 'صح' : model === 0 ? 'خطأ' : '—';
    case 'multi':
      return Array.isArray(model) && model.length > 0 ? model.map((i) => q.choices[i]).filter(Boolean).join('، ') : '—';
    case 'match': {
      if (!Array.isArray(model)) return '—';
      const pairs = q.pairs ?? [];
      return pairs.map((p, i) => `${p.l} ← ${pairs[model[i]]?.r ?? '—'}`).join(' · ');
    }
    case 'complete':
    case 'correct':
      return typeof model === 'string' && model.trim() !== '' ? model.trim() : '—';
    default:
      return '—';
  }
}

/** هل نوع السؤال يدوي (مقالي/قصير/صحّح) ينتظر تصحيح المعلم */
function isManualType(q: ExamQuestion): boolean {
  return q.type === 'essay' || q.type === 'short' || q.type === 'correct';
}

export function ExamReview({
  result,
  questions,
  answers,
  studentName,
  onBack,
}: {
  result: ExamResult;
  questions: ExamQuestion[];
  /** إجابات الطالب المُسلَّمة — لعرضها في المراجعة */
  answers: ExamAnswer[];
  studentName?: string | null;
  onBack?: () => void;
}) {
  const pct = result.max_score > 0 ? Math.round((result.score / result.max_score) * 100) : null;
  const pending = result.status === 'pending_review';
  const tone = scoreTone(pct ?? 0);
  const perQuestion = result.per_question ?? [];

  return (
    <Card className="stack">
      {/* بطاقة الدرجة */}
      <div className="card compact soft stack" style={{ textAlign: 'center', padding: '26px 20px' }}>
        <div className="row" style={{ justifyContent: 'center' }}>
          <Badge tone={pending ? 'warn' : 'success'}>{pending ? 'بانتظار مراجعة المعلم' : 'تم التصحيح'}</Badge>
        </div>
        <div style={{ fontSize: 52, fontWeight: 900, lineHeight: 1.1, color: tone === 'success' ? 'var(--success)' : tone === 'warn' ? 'var(--warn)' : 'var(--danger)' }} dir="ltr">
          {result.score}
          <span style={{ fontSize: 22, color: 'var(--muted)', fontWeight: 700 }}> / {result.max_score || '—'}</span>
        </div>
        {pct !== null && <div style={{ fontSize: 22, fontWeight: 800, color: scoreColor(pct) }}>{pct}%</div>}
        <p className="muted small">
          {studentName ? `${studentName} · ` : ''}أجبت صحيحاً على {result.correct} من {result.total} سؤال
          {result.attempts_used && result.attempts_allowed ? ` · المحاولة ${result.attempts_used} من ${result.attempts_allowed}` : ''}
        </p>
      </div>

      {perQuestion.length > 0 ? (
        <div className="stack" style={{ gap: 10 }}>
          <h3 className="h3">مراجعة الإجابات</h3>
          {perQuestion.map((r) => {
            const q = questions[r.q];
            if (!q) return null;
            const a = answers[r.q];
            const manual = r.correct === null;
            const answered = answerLabel(q, a) !== 'لم تُجب';
            const myAnswer = answerLabel(q, a);
            // النموذج: من الخادم إن أُرفق، وإلا من نص السؤال (أكمل/صحّح)
            const model = r.model !== undefined ? r.model : (q.type === 'complete' || q.type === 'correct' ? q.answer : undefined);
            const key = correctLabel(q, model);
            const verdict: 'correct' | 'wrong' | 'pending' = manual ? 'pending' : r.correct ? 'correct' : 'wrong';
            return (
              <div key={r.q} className="card compact soft stack" style={{ gap: 8 }}>
                <div className="row-between">
                  <strong style={{ flex: 1 }}>{r.q + 1}. {q.q}</strong>
                  <Badge tone="info">{r.earned}/{r.marks} درجة</Badge>
                </div>
                <div className={`row small notice ${verdict === 'correct' ? 'review-correct' : verdict === 'wrong' ? 'review-wrong' : ''}`} style={{ border: '1px solid var(--border)' }}>
                  <span style={{ flex: 1 }}><b>إجابتك: </b>{myAnswer}</span>
                  {verdict === 'correct' && <Badge tone="success">✓ إجابة صحيحة</Badge>}
                  {verdict === 'wrong' && <Badge tone="danger">{answered ? '✗ إجابة خاطئة' : 'بدون إجابة'}</Badge>}
                  {verdict === 'pending' && <Badge tone="warn">بانتظار تصحيح المعلم</Badge>}
                </div>
                {verdict === 'wrong' && key !== '—' && (
                  <div className="row small notice" style={{ background: 'var(--success)18', border: '1px solid var(--success)55' }}>
                    <span><b>الإجابة الصحيحة: </b>{key}</span>
                  </div>
                )}
                {verdict === 'pending' && isManualType(q) && key !== '—' && (
                  <div className="row small notice" style={{ background: 'var(--info)14', border: '1px solid var(--info)44' }}>
                    <span><b>الإجابة النموذجية: </b>{key}</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <Notice tone="info">التفصيل سؤالاً بسؤال سيظهر بعد تحديث قاعدة البيانات (ترحيل المراجعة). النتيجة النهائية أعلاه دقيقة.</Notice>
      )}

      {onBack ? (
        <div className="row" style={{ justifyContent: 'flex-start' }}>
          <Button type="button" variant="secondary" onClick={onBack}>العودة إلى الاختبارات</Button>
        </div>
      ) : null}
    </Card>
  );
}
