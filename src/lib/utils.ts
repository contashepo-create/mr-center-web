// ============================================================
// أدوات مساعدة: مولد معرفات، تطبيع الهاتف/الكود، تواريخ، رسائل الأخطاء
// ============================================================

/** توليد UUID نصي (متوافق مع المعرفات النصية في مخطط الموقع) */
export function uuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/** تطبيع رقم الهاتف: إزالة المسافات والرموز، تحويل الأرقام العربية للاتينية */
export function normalizePhone(input: string): string {
  const arabicDigits = '٠١٢٣٤٥٦٧٨٩';
  let out = '';
  for (const ch of input.trim()) {
    const idx = arabicDigits.indexOf(ch);
    if (idx >= 0) { out += String(idx); continue; }
    if (/[0-9+]/.test(ch)) out += ch;
  }
  return out;
}

/** تطبيع كود السنتر: حروف كبيرة إنجليزية أو عربية وأرقام فقط، بدون مسافات */
export function normalizeCenterCode(input: string): string {
  return input
    .trim()
    .replace(/\s+/g, '')
    .toUpperCase();
}

/** التحقق من صيغة كود السنتر: 3-8 حروف/أرقام (إنجليزي أو عربي) */
export function isValidCenterCode(code: string): boolean {
  return /^[A-Z0-9\u0621-\u064A]{3,8}$/.test(code);
}

/** التحقق من صيغة البريد الإلكتروني */
export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

/** نطاقات البريد الموثوقة فقط — لمنع الإيميلات المؤقتة والوهمية */
const TRUSTED_EMAIL_DOMAINS = [
  'gmail.com', 'yahoo.com', 'yahoo.co.uk', 'outlook.com', 'hotmail.com',
  'live.com', 'msn.com', 'icloud.com', 'me.com', 'mac.com',
  'proton.me', 'protonmail.com', 'yandex.com', 'yandex.ru',
  'aol.com', 'gmx.com', 'zoho.com',
];

export function emailDomain(email: string): string {
  const parts = email.trim().toLowerCase().split('@');
  return parts.length === 2 ? parts[1] : '';
}

/** هل نطاق البريد من الموفرين المعروفين؟ */
export function isAllowedEmailDomain(email: string): boolean {
  return TRUSTED_EMAIL_DOMAINS.includes(emailDomain(email));
}

/** بريد صالح + نطاق موثوق (للتسجيل الجديد) */
export function isValidSignupEmail(email: string): boolean {
  return isValidEmail(email) && isAllowedEmailDomain(email);
}

/** التحقق من رقم هاتف مصري/دولي (8 إلى 15 رقم) */
export function isValidPhone(phone: string): boolean {
  const p = normalizePhone(phone).replace(/^\+/, '');
  return /^\d{8,15}$/.test(p);
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

const AR_MONTHS = [
  'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
  'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر',
];

export function arabicMonth(month: number): string {
  return AR_MONTHS[(month - 1 + 12) % 12];
}

const AR_DAYS: Record<string, string> = {
  sat: 'السبت', sun: 'الأحد', mon: 'الاثنين', tue: 'الثلاثاء',
  wed: 'الأربعاء', thu: 'الخميس', fri: 'الجمعة',
};

export const WEEK_DAYS = ['sat', 'sun', 'mon', 'tue', 'wed', 'thu', 'fri'] as const;

export function arabicDay(key: string): string {
  return AR_DAYS[key] ?? key;
}

export function formatDays(days: string[]): string {
  if (!days || days.length === 0) return '—';
  return days.map(arabicDay).join(' · ');
}

/** تنسيق تاريخ ISO إلى "١٢ مارس ٢٠٢٦" بصيغة عربية بسيطة */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso.slice(0, 10);
  return `${d.getDate()} ${arabicMonth(d.getMonth() + 1)} ${d.getFullYear()}`;
}

/** تنسيق المبلغ بالجنيه */
export function formatMoney(amount: number | null | undefined): string {
  const n = amount ?? 0;
  return `${n.toLocaleString('en-EG', { maximumFractionDigits: 2 })} ج.م`;
}

/** تحويل نص وقت ("HH:MM" أو "h:mm ص/م") إلى دقائق منذ منتصف الليل */
export function timeToMinutes(t: string | null | undefined): number | null {
  if (!t) return null;
  const s = t.trim().replace(/\s+/g, ' ');
  let m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (m) {
    const h = Number(m[1]);
    const mm = Number(m[2]);
    if (h >= 0 && h < 24 && mm >= 0 && mm < 60) return h * 60 + mm;
    return null;
  }
  m = s.match(/^(\d{1,2}):(\d{2}) (ص|م|صباحاً|مساءً|AM|PM|am|pm)$/);
  if (m) {
    let h = Number(m[1]);
    const mm = Number(m[2]);
    const per = m[3];
    if (h < 1 || h > 12 || mm < 0 || mm > 59) return null;
    const isPm = per === 'م' || per === 'مساءً' || per.toLowerCase() === 'pm';
    if (h === 12) h = isPm ? 12 : 0;
    else if (isPm) h += 12;
    return h * 60 + mm;
  }
  return null;
}

/** تحويل دقائق منذ منتصف الليل إلى "HH:MM" */
export function minutesToTime24(min: number): string {
  const h = Math.floor(min / 60) % 24;
  const mm = min % 60;
  return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

/** تنسيق نص وقت للعرض العربي ("4:30 م") */
export function formatTimeAr(t: string | null | undefined): string {
  const min = timeToMinutes(t);
  if (min === null) return t?.trim() ? String(t).trim() : '—';
  const h24 = Math.floor(min / 60) % 24;
  const mm = min % 60;
  const period = h24 < 12 ? 'ص' : 'م';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(mm).padStart(2, '0')} ${period}`;
}

/** التحقق من صلاحية أسئلة امتحان قبل الحفظ/النشر — يرد رسالة الخطأ أو null */
/** تسميات أنواع الأسئلة الثمانية (يعرضها المعلم والطالب) */
export const EXAM_TYPE_LABEL: Record<string, string> = {
  mcq: 'اختياري', multi: 'متعدد الإجابات', tf: 'صح/خطأ', complete: 'أكمل',
  match: 'وصل', correct: 'صحّح الخطأ', essay: 'مقالي', short: 'إجابة قصيرة',
};

/** الأنواع التي تُصحَّح يدوياً (قيد مراجعة المعلم) */
export const MANUAL_EXAM_TYPES = ['essay', 'correct', 'short'] as const;

/** هل السؤال يُصحَّح يدوياً؟ (النوع الغائب يُعامل mcq تلقائي) */
export function isManualExamType(t: string | null | undefined): boolean {
  return (MANUAL_EXAM_TYPES as readonly string[]).includes((t ?? 'mcq') as string);
}

/**
 * تطبيع نص الإجابة للمطابقة الآلية (أكمل/صحّح):
 * إزالة التشكيل والتطويل والترقيم، توحيد الألفات والياء والتاء المربوطة،
 * توحيد المسافات والحالة — فيستوي «الأَمْثِلَة» و «الامثلة».
 */
export function normalizeAnswerText(s: string): string {
  return (s ?? '')
    .replace(/[\u064B-\u065F\u0670]/g, '')   // التشكيل
    .replace(/\u0640/g, '')                    // التطويل
    .replace(/[\u0623\u0625\u0622]/g, 'ا')  // أ إ آ → ا
    .replace(/\u0649/g, 'ي')                   // ى → ي
    .replace(/\u0629/g, 'ه')                   // ة → ه
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, '')        // الترقيم والرموز
    .replace(/\s+/g, ' ')
    .trim();
}

/** خلط ثابت لنفس البذرة (لعرض خيارات التوصيل بترتيب مبعثر مستقر) */
export function seededShuffle(n: number, seed: string): number[] {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  let a = (h >>> 0) || 1;
  const next = () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const arr = Array.from({ length: Math.max(0, n) }, (_, i) => i);
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function validateExamDraft(qs: {
  q: string; type: string; choices: string[]; marks: number;
  answer?: string; pairs?: { l: string; r: string }[]; corrects?: number[];
}[]): string | null {
  if (!qs || qs.length === 0) return 'أضف سؤالاً واحداً على الأقل';
  for (let i = 0; i < qs.length; i++) {
    const n = i + 1;
    const q = qs[i];
    if (!q.q.trim()) return `اكتب نص السؤال رقم ${n}`;
    if (!(Number(q.marks) > 0)) return `حدد درجة صحيحة للسؤال رقم ${n}`;
    if ((q.type === 'mcq' || q.type === 'multi') && q.choices.slice(0, 4).some((c) => !c.trim())) {
      return `أكمل الاختيارات الأربعة للسؤال رقم ${n}`;
    }
    if (q.type === 'multi' && !(q.corrects ?? []).length) {
      return `حدد إجابة واحدة صحيحة على الأقل للسؤال رقم ${n} (متعدد الإجابات)`;
    }
    if (q.type === 'complete' && !(q.answer ?? '').trim()) {
      return `اكتب الإجابة النموذجية للسؤال رقم ${n} (أكمل الفراغ)`;
    }
    if (q.type === 'match') {
      const pairs = q.pairs ?? [];
      if (pairs.filter((p) => p.l.trim() && p.r.trim()).length < 2) {
        return `أضف بندين مكتملين على الأقل للتوصيل في السؤال رقم ${n}`;
      }
      if (pairs.some((p) => !p.l.trim() || !p.r.trim())) {
        return `أكمل نصوص طرفي التوصيل كاملة في السؤال رقم ${n}`;
      }
    }
  }
  return null;
}

/** مجموع درجات أسئلة امتحان */
export function examMarksTotal(qs: { marks: number }[]): number {
  return qs.reduce((s, q) => s + (Number(q.marks) || 0), 0);
}

/** وصف نظام التسعير لمجموعة */
export function billingLabel(billingType: string | null | undefined): string {
  if (billingType === 'weekly') return 'أسبوعي';
  if (billingType === 'per_session') return 'بالحصة';
  return 'شهري';
}

/** كشف تعارض المواعيد بين المجموعات (أيام مشتركة + أوقات متقاطعة) */
export function findGroupConflicts(groups: {
  id: string; name: string; days: string[] | null;
  start_time: string | null; end_time: string | null;
}[]): { aName: string; bName: string; days: string }[] {
  const out: { aName: string; bName: string; days: string }[] = [];
  for (let i = 0; i < groups.length; i++) {
    for (let j = i + 1; j < groups.length; j++) {
      const a = groups[i];
      const b = groups[j];
      const shared = (a.days ?? []).filter((d) => (b.days ?? []).includes(d));
      if (shared.length === 0) continue;
      const s1 = timeToMinutes(a.start_time);
      const e1 = timeToMinutes(a.end_time);
      const s2 = timeToMinutes(b.start_time);
      const e2 = timeToMinutes(b.end_time);
      if (s1 === null || e1 === null || s2 === null || e2 === null) continue;
      if (Math.max(s1, s2) < Math.min(e1, e2)) {
        out.push({ aName: a.name, bName: b.name, days: formatDays(shared) });
      }
    }
  }
  return out;
}

/** إزاحة تاريخ ISO (YYYY-MM-DD) بعدد أيام */
export function shiftDateIso(iso: string, deltaDays: number): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + deltaDays);
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${mo}-${day}`;
}

/** التحقق من صيغة رابط ويب عام (ملفات/روابط السنتر) */
export function isValidHttpUrl(url: string): boolean {
  try {
    const u = new URL(url.trim());
    return (u.protocol === 'https:' || u.protocol === 'http:') && u.hostname.includes('.');
  } catch {
    return false;
  }
}

/** التحقق من صيغة رابط قاعدة البيانات */
export function isValidSupabaseUrl(url: string): boolean {
  try {
    const u = new URL(url.trim());
    return u.protocol === 'https:' && u.hostname.length > 3;
  } catch {
    return false;
  }
}

/** استخراج مفاتيح قاعدة البيانات من ردّ كلاود فلير */
export function dbConfigFromRemote(remote: unknown): { url: string; anonKey: string } | null {
  const db = (remote as { database?: { url?: string; anon_key?: string } } | null)?.database;
  if (!db) return null;
  const url = (db.url ?? '').trim();
  const key = (db.anon_key ?? '').trim();
  if (url && key && isValidSupabaseUrl(url)) return { url, anonKey: key };
  return null;
}

/** مقارنة أرقام الإصدارات النصية: "1.0.10" أكبر من "1.0.2" */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((x) => parseInt(x, 10) || 0);
  const pb = b.split('.').map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const da = pa[i] ?? 0;
    const db = pb[i] ?? 0;
    if (da !== db) return da - db;
  }
  return 0;
}

/** تحويل رسائل أخطاء Supabase إلى رسائل عربية مفهومة */
export function arabicError(err: unknown): string {
  const raw = String((err as any)?.message ?? err ?? '');
  const msg = raw.toLowerCase();
  if (!msg) return 'حدث خطأ غير متوقع، حاول مرة أخرى';
  if (msg.includes('email_confirmation_required')) return 'تم إنشاء حسابك — أكّد بريدك من الرابط المرسل إليك ثم سجّل دخولك وسيُستكمل تسجيلك تلقائياً';
  if (msg.includes('not_authenticated')) return 'تعذر إتمام التسجيل — سجّل دخولك أولاً ثم أعد المحاولة، وإن تكرر تواصل مع المطور';
  if (msg.includes('already_registered')) return 'هذا الحساب مسجل من قبل — سجّل دخولك مباشرة';
  if (msg.includes('invalid login')) return 'البريد الإلكتروني أو كلمة المرور غير صحيحة';
  if (msg.includes('email not confirmed')) return 'بريدك غير مؤكد بعد — افتح رابط التأكيد المرسل إلى بريدك ثم سجّل دخولك';
  if (msg.includes('rate limit') || msg.includes('over_email_send_rate_limit')
    || msg.includes('over_request_rate_limit') || msg.includes('over_sms_send_rate_limit')
    || msg.includes('too many') || msg.includes('too many requests')
    || msg.includes('for security purposes') || msg.includes('once every 60 seconds')
    || msg.includes('once every second') || msg.includes('429'))
    return 'ضغط مؤقت على خدمة البريد — انتظر دقيقة إلى دقيقتين ثم أعد المحاولة (رسائل التسجيل محدودة عددياً كل ساعة لمنع الإساءة)';
  if (msg.includes('user already registered') || msg.includes('already been registered'))
    return 'هذا البريد الإلكتروني مستخدم من قبل — سجّل دخولك أو استخدم بريداً آخر';
  if (msg.includes('password') && msg.includes('at least'))
    return 'كلمة المرور قصيرة — يجب ألا تقل عن 6 أحرف';
  if (msg.includes('network') || msg.includes('fetch') || msg.includes('failed to fetch'))
    return 'تعذر الاتصال بالخادم — تحقق من الإنترنت وحاول مجدداً';
  if (msg.includes('center_code_taken') || msg.includes('centers_code') || msg.includes('code_taken'))
    return 'هذا الكود غير متاح — اختر كوداً آخر';
  if (msg.includes('phone_taken') || msg.includes('profiles_phone'))
    return 'رقم الهاتف مستخدم من قبل — لا يمكن تكراره';
  if (msg.includes('email_taken'))
    return 'البريد الإلكتروني مستخدم من قبل';
  if (msg.includes('center_not_found') || msg.includes('invalid_center_code'))
    return 'كود السنتر غير صحيح — تأكد من الكود مع إدارة السنتر';
  if (msg.includes('center_suspended')) return 'هذا السنتر موقوف حالياً — تواصل مع إدارة التطبيق';
  if (msg.includes('no_group_for_attendance')) return 'الطالب غير مسند لمجموعة — أسنده أولاً من ملفه ثم سجّل حضوره';
  if (msg.includes('student_not_active')) return 'هذا الطالب غير نشط (موقوف أو مؤرشف) — لا يمكن تحضيره';
  if (msg.includes('registration_closed')) return 'التسجيل مغلق حالياً في هذا السنتر — تواصل مع الإدارة';
  if (msg.includes('same_guardian_phone')) return 'رقم ولي الأمر يجب أن يختلف عن رقم الطالب';
  if (msg.includes('staff_limit_reached')) return 'اكتمل عدد هذا الدور في باقتك — رقِّ الباقة أو أوقف فرداً أولاً';
  if (msg.includes('students_limit_reached')) return 'وصلت للحد الأقصى لطلاب باقتك (200) — رقِّ الباقة لسنتر';
  if (msg.includes('staff_not_allowed')) return 'الحساب المنفرد بلا فريق تابع — رقِّ لسنتر متكامل أولاً';
  if (msg.includes('invalid_role')) return 'الدور المطلوب غير صالح';
  if (msg.includes('already_attempted')) return 'أديت هذا الامتحان من قبل — لا يمكن تكرار المحاولة';
  if (msg.includes('already_answered')) return 'أجبت على هذا الاستبيان من قبل';
  if (msg.includes('exam_not_found')) return 'الامتحان غير متاح حالياً';
  if (msg.includes('invalid_payment_amount')) return 'أدخل مبلغ تحصيل صحيحاً أكبر من صفر';
  if (msg.includes('invalid_payment_period')) return 'شهر أو سنة التحصيل غير صحيحين';
  if (msg.includes('due_not_found')) return 'المستحق المحدد غير موجود أو لا تملك صلاحية تحصيله';
  if (msg.includes('invalid_group')) return 'المجموعة المختارة لا تخص هذا السنتر — أعد اختيارها';
  if (msg.includes('invalid_grade')) return 'الصف المختار لا يخص هذا السنتر — أعد اختياره';
  if (msg.includes('sharing_unavailable')) return 'المشاركة غير متاحة على هذا الجهاز';
  if (msg.includes('row-level security')) return 'ليس لديك صلاحية لتنفيذ هذا الإجراء';
  if (msg.includes('duplicate key')) return 'البيانات مسجلة من قبل ولا يمكن تكرارها';
  return (err as any)?.message ?? 'حدث خطأ غير متوقع، حاول مرة أخرى';
}
