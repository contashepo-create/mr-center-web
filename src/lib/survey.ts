// ============================================================
// أدوات الاستبيان المشتركة (نموذج كامل: أنواع أسئلة/جمهور/موعد/خصوصية)
// ملف مستقل حتى يبقى api.ts مطابقاً لتطبيق Android.
// ============================================================

import type { AppSurvey, AppSurveyResponse, Grade, Group, Student, SurveyAnswer, SurveyQuestion, SurveyQuestionType } from './types';

export const QUESTION_TYPE_LABELS: Record<SurveyQuestionType, string> = {
  single: 'اختيار واحد',
  multi: 'اختيار متعدد',
  rating: 'تقييم',
  yesno: 'نعم / لا',
  text: 'إجابة نصية',
};

export const QUESTION_TYPES: SurveyQuestionType[] = ['single', 'multi', 'rating', 'yesno', 'text'];

export const YES = 'نعم';
export const NO = 'لا';

/** إجابة فارغة بحسب نوع السؤال */
export function emptyAnswer(q: SurveyQuestion): SurveyAnswer {
  switch (q.type) {
    case 'multi':
    case 'single':
    case 'yesno':
      return { choice: [] };
    case 'rating':
      return { rating: 0 };
    case 'text':
    default:
      return { text: '' };
  }
}

/** هل أُجيب على السؤال فعلاً؟ */
export function isAnswered(a?: SurveyAnswer): boolean {
  if (!a) return false;
  if (Array.isArray(a.choice)) return a.choice.length > 0;
  if (typeof a.text === 'string') return a.text.trim().length > 0;
  if (typeof a.rating === 'number') return a.rating > 0;
  return false;
}

/** نص الإجابة للعرض والتصدير */
export function answerToText(q: SurveyQuestion, a?: SurveyAnswer): string {
  if (!isAnswered(a)) return '—';
  if (typeof a!.text === 'string' && a!.text.trim()) return a!.text.trim();
  if (typeof a!.rating === 'number' && a!.rating > 0) {
    const max = q.maxRating || 5;
    return `${a!.rating} / ${max}`;
  }
  if (Array.isArray(a!.choice) && a!.choice.length) return a!.choice.join(' • ');
  return '—';
}

/** هل الاستبيان مفتوح للإجابة الآن؟ */
export function isSurveyOpen(s: Pick<AppSurvey, 'is_active' | 'deadline'>): boolean {
  if (!s.is_active) return false;
  if (s.deadline) {
    const d = new Date(s.deadline);
    if (!isNaN(d.getTime()) && d.getTime() < Date.now()) return false;
  }
  return true;
}

export function deadlineLabel(s: Pick<AppSurvey, 'deadline'>): string {
  if (!s.deadline) return 'بلا موعد نهائي';
  const d = new Date(s.deadline);
  if (isNaN(d.getTime())) return 'بلا موعد نهائي';
  return `حتى ${d.toLocaleDateString('ar-EG', { year: 'numeric', month: 'long', day: 'numeric' })}`;
}

/** وصف الجمهور المستهدف بالعربية */
export function audienceLabel(s: AppSurvey, grades: Grade[], groups: Group[]): string {
  if (s.audience === 'grade') {
    const g = grades.find((x) => x.id === s.grade_id);
    return g ? `صف ${g.name}` : 'صف محدد';
  }
  if (s.audience === 'group') {
    const names = (s.group_ids ?? []).map((id) => groups.find((g) => g.id === id)?.name).filter(Boolean) as string[];
    if (names.length === 0) return 'مجموعات محددة';
    if (names.length <= 3) return names.join(' • ');
    return `${names.length} مجموعات`;
  }
  return 'الجميع';
}

/** هل يظهر هذا الاستبيان لطالب معيّن؟ */
export function surveyForStudent(s: AppSurvey, student: Student, groupIds: string[]): boolean {
  if (s.audience === 'all') return true;
  if (s.audience === 'grade') return !!s.grade_id && student.grade_id === s.grade_id;
  const ids = s.group_ids ?? [];
  const mine = new Set<string>([...(student.group_id ? [student.group_id] : []), ...groupIds]);
  return ids.some((id) => mine.has(id));
}

/** بصمة الأسئلة — أي تغيير فيها يعني نسخة جديدة */
export function questionsFingerprint(questions: SurveyQuestion[]): string {
  return (questions || [])
    .map((q) => [
      q.id, q.type, (q.title || '').trim(), q.required ? '1' : '0',
      (q.options || []).map((o) => String(o).trim()).join('|'),
      q.type === 'rating' ? String(q.maxRating || 5) : '',
      q.type === 'text' ? (q.placeholder || '').trim() : '',
    ].join('\u0001'))
    .join('\u0002');
}

/** نسخة الاستبيان بعد التعديل: تغيّرت الأسئلة ⇒ نسخة أعلى بواحد */
export function nextVersionAfterEdit(prev: { version?: number; questions?: SurveyQuestion[] } | undefined, next: SurveyQuestion[]): number {
  const prevVersion = Math.max(1, Math.round(Number(prev?.version) || 1));
  if (!prev?.questions?.length) return prevVersion;
  return questionsFingerprint(prev.questions) === questionsFingerprint(next) ? prevVersion : prevVersion + 1;
}

export interface QuestionStat {
  question: SurveyQuestion;
  answered: number;
  counts: { label: string; count: number }[];
  average: number | null;
  texts: string[];
}

/** تجميع نتائج استبيان من ردوده */
export function surveyStats(survey: AppSurvey, responses: AppSurveyResponse[]): QuestionStat[] {
  return survey.questions.map((q) => {
    const answered: SurveyAnswer[] = [];
    for (const r of responses) {
      const a = r.answers?.[q.id];
      if (isAnswered(a)) answered.push(a!);
    }
    const counts: { label: string; count: number }[] = [];
    const texts: string[] = [];
    let sum = 0;
    let rated = 0;

    if (q.type === 'single' || q.type === 'multi' || q.type === 'yesno') {
      const options = q.type === 'yesno' ? [YES, NO] : q.options || [];
      const map = new Map<string, number>(options.map((o) => [o, 0]));
      for (const a of answered) {
        for (const c of a.choice || []) map.set(c, (map.get(c) || 0) + 1);
      }
      for (const [label, count] of map) counts.push({ label, count });
      counts.sort((x, y) => y.count - x.count);
    } else if (q.type === 'rating') {
      const max = q.maxRating || 5;
      const map = new Map<number, number>();
      for (let i = 1; i <= max; i++) map.set(i, 0);
      for (const a of answered) {
        const v = Math.round(a.rating || 0);
        if (v >= 1 && v <= max) {
          map.set(v, (map.get(v) || 0) + 1);
          sum += v;
          rated++;
        }
      }
      for (let i = max; i >= 1; i--) counts.push({ label: `${i} / ${max}`, count: map.get(i) || 0 });
    } else {
      for (const a of answered) {
        const t = (a.text || '').trim();
        if (t) texts.push(t);
      }
    }

    return { question: q, answered: answered.length, counts, average: rated > 0 ? Math.round((sum / rated) * 10) / 10 : null, texts };
  });
}

/** تصدير الردود CSV (يفتح في Excel) */
export function surveyCsv(survey: AppSurvey, responses: AppSurveyResponse[], students: Student[]): string {
  const studentName = new Map(students.map((s) => [s.id, s.name]));
  const esc = (v: unknown) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = ['الطالب', 'التاريخ', ...survey.questions.map((q) => q.title)];
  const rows = responses.map((r) => [
    survey.anonymous ? 'مجهول' : studentName.get(r.student_id) ?? r.student_id,
    r.created_at ? new Date(r.created_at).toLocaleString('ar-EG') : '',
    ...survey.questions.map((q) => answerToText(q, r.answers?.[q.id])),
  ]);
  return [head, ...rows].map((row) => row.map(esc).join(',')).join('\n');
}
