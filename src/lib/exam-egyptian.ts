// ============================================================
// أدوات الورقة الامتحانية المصرية — مطابقة لشكل النسخة الأصلية:
// عناوين الأسئلة (السؤال الأول/الثاني...) وترقيم عربي هندي
// وأسطر النقاط وتسميات أنواع الأسئلة وأرقام الاختيارات (أ/ب/ج/د).
// ============================================================

import type { ExamQuestion, ExamQuestionType } from './types';

/** الترتيب اللفظي للأسئلة: الأول، الثاني، الثالث... */
export const ARABIC_ORDINALS = [
  'الأول', 'الثاني', 'الثالث', 'الرابع', 'الخامس',
  'السادس', 'السابع', 'الثامن', 'التاسع', 'العاشر',
  'الحادي عشر', 'الثاني عشر', 'الثالث عشر', 'الرابع عشر', 'الخامس عشر',
  'السادس عشر', 'السابع عشر', 'الثامن عشر', 'التاسع عشر', 'العشرون',
];

/** الأرقام العربية الهندية (١٢٣...) للترقيم داخل السؤال */
const ARABIC_DIGITS = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];

export function arabicNum(n: number): string {
  return String(Math.max(0, Math.floor(n))).replace(/\d/g, (d) => ARABIC_DIGITS[Number(d)]);
}

/** حروف الاختيارات الأبجدية المصرية */
export const CHOICE_KEYS = ['أ', 'ب', 'ج', 'د', 'هـ', 'و'];

export interface EgyptTypeMeta {
  type: ExamQuestionType;
  label: string;        // تسمية قصيرة في الواجهة
  header: string;       // عنوان السؤال في الورقة (السؤال الأول: ...)
  paperMark: string;    // وسم مختصر في زاوية القسم
  icon: string;
  lines: number;        // عدد أسطر الإجابة الافتراضية
  /** الأنواع التي تُصحَّح يدوياً */
  manual?: boolean;
}

/** تسميات الأنواع الثمانية بأسلوب الورقة المصرية */
export const EGYPT_TYPES: EgyptTypeMeta[] = [
  { type: 'mcq', label: 'اختر الإجابة الصحيحة', header: 'اختر الإجابة الصحيحة مما بين القوسين', paperMark: 'اختر', icon: '🔘', lines: 0, manual: false },
  { type: 'multi', label: 'اختر كل ما ينطبق', header: 'اختر كل الإجابات الصحيحة', paperMark: 'متعدد', icon: '☑️', lines: 0, manual: false },
  { type: 'tf', label: 'صح أو خطأ', header: 'ضع علامة (√) أمام العبارة الصحيحة وعلامة (×) أمام العبارة الخاطئة', paperMark: '√ ×', icon: '✅', lines: 0, manual: false },
  { type: 'complete', label: 'أكمل العبارات', header: 'أكمل العبارات الآتية بما يناسبها', paperMark: 'أكمل', icon: '✏️', lines: 0, manual: false },
  { type: 'correct', label: 'صوّب ما تحته خط', header: 'صوّب ما تحته خط', paperMark: 'صوّب', icon: '🖍', lines: 1, manual: true },
  { type: 'match', label: 'وصل (مطابقة)', header: 'صل من العمود (أ) بما يناسبه من العمود (ب)', paperMark: 'وصل', icon: '🔗', lines: 0, manual: false },
  { type: 'essay', label: 'مقالي / علّل / فسّر', header: 'أجب عن الأسئلة الآتية', paperMark: 'مقالي', icon: '📝', lines: 2, manual: true },
  { type: 'short', label: 'إجابة قصيرة / مصطلح', header: 'اكتب المصطلح العلمي أو الإجابة المختصرة', paperMark: 'مصطلح', icon: '🔤', lines: 1, manual: true },
];

export function egyptMeta(type: ExamQuestionType): EgyptTypeMeta {
  return EGYPT_TYPES.find((t) => t.type === type) ?? EGYPT_TYPES[0];
}

/** قسم ورقي = مجموعة أسئلة متتالية من نفس النوع تحت عنوان واحد */
export interface PaperSection {
  type: ExamQuestionType;
  sectionId: string;
  header: string;
  meta: EgyptTypeMeta;
  items: ExamQuestion[];
  marks: number;
}

/** يجمع السؤال الرئيسي وأسئلته الفرعية. تبقى الاختبارات القديمة مجمعة حسب النوع للتوافق. */
export function paperSections(questions: ExamQuestion[]): PaperSection[] {
  const sections: PaperSection[] = [];
  for (const q of questions) {
    const meta = egyptMeta(q.type);
    const sectionId = q.sectionId || `legacy-${q.type}`;
    const last = sections[sections.length - 1];
    if (last && last.sectionId === sectionId) {
      last.items.push(q);
      last.marks += Number(q.marks) || 0;
    } else {
      sections.push({ type: q.type, sectionId, header: meta.header, meta, items: [q], marks: Number(q.marks) || 0 });
    }
  }
  return sections;
}
