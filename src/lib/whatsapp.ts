import { normalizePhone } from './utils';

/** تحويل أي صيغة هاتف لصيغة wa.me: أرقام بكود الدولة بلا +. */
export function toWaNumber(phone: string | null | undefined): string | null {
  const d = normalizePhone(phone ?? '').replace(/^\+/, '').replace(/\D/g, '');
  if (!d) return null;
  if (/^01\d{9}$/.test(d)) return `2${d}`;
  if (d.length >= 8 && d.length <= 15) return d;
  return null;
}

/** رابط محادثة واتساب برقم ونص جاهز — null لو الرقم غير صالح. */
export function waLink(phone: string | null | undefined, text: string): string | null {
  const n = toWaNumber(phone);
  if (!n) return null;
  return `https://wa.me/${n}?text=${encodeURIComponent(text)}`;
}

/** فتح محادثة واتساب من المتصفح. */
export async function openWhatsApp(phone: string | null | undefined, text: string): Promise<boolean> {
  const url = waLink(phone, text);
  if (!url || typeof window === 'undefined') return false;
  try {
    window.open(url, '_blank', 'noopener,noreferrer');
    return true;
  } catch {
    return false;
  }
}

export function guardianReportText(input: {
  centerName: string; studentName: string; pendingTotal: number; pendingCount: number;
  present?: number; absent?: number; avgText?: string;
}): string {
  const present = input.present ?? 0;
  const absent = input.absent ?? 0;
  const rate = present + absent > 0 ? ` (نسبة الحضور ${Math.round((present / (present + absent)) * 100)}%)` : '';
  return [
    `تقرير ${input.studentName} — ${input.centerName}`,
    typeof input.present === 'number' ? `الحضور: ${present} · الغياب: ${absent}${rate}` : '',
    input.avgText ? `متوسط الدرجات: ${input.avgText}` : '',
    input.pendingCount > 0 ? `المستحق المعلق: ${input.pendingTotal} ج.م (${input.pendingCount}) — برجاء السداد` : 'لا توجد مستحقات معلقة — شكراً لالتزامكم',
  ].filter(Boolean).join('\n');
}

export function examAlertText(centerName: string, title: string, subject: string, count: number, minutes: number): string {
  return [
    `امتحان جديد في ${centerName}`,
    `«${title}»${subject ? ` — ${subject}` : ''}`,
    `${count} أسئلة · المدة ${minutes} دقيقة · محاولة واحدة`,
    'ادخل تطبيق/ويب Mr Center ← الاختبارات لأدائه قبل إغلاقه',
  ].join('\n');
}

export function duesReminderText(centerName: string, studentName: string, monthLabel: string, amount: number): string {
  return [
    `${centerName} — تذكير بمستحق`,
    `الطالب: ${studentName}`,
    `${monthLabel}: ${amount} ج.م — برجاء السداد في أقرب وقت`,
  ].join('\n');
}

export function generalNoticeText(centerName: string, body: string): string {
  return `${centerName}\n${body}`;
}
