// ============================================================
// جلسة واحدة لكل حساب: تسجيل الدخول من جهاز ثانٍ يُخرج الأول تلقائياً.
// - عند الدخول: يبطل جلسات الحساب الأخرى ثم يطالب بجلسة جديدة.
// - دورياً: يتحقق الجهاز أنه لا يزال صاحب الجلسة؛ إن طُرد يخرج فوراً.
// لا يحجب المستخدم أبداً عند فشل مؤقت أو قبل تطبيق الترحيل.
// ============================================================

import { getSupabase } from './supabase';
import { getDeviceId } from './visitors';

const KEY = 'mrcenter.web.session.key';

function generateKey(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

function readKey(): string {
  if (typeof window === 'undefined') return '';
  try { return window.localStorage.getItem(KEY) ?? ''; } catch { return ''; }
}

function writeKey(key: string): void {
  if (typeof window === 'undefined') return;
  try { window.localStorage.setItem(KEY, key); } catch { /* ignore */ }
}

/** يسجل متصفح الطالب في سجل جهاز سنتره فقط، بلا تأثير على حجب الزوار العام. */
export async function registerMyStudentDevice(): Promise<void> {
  try {
    const device = getDeviceId();
    if (device) await getSupabase().rpc('register_current_student_device', { p_device: device });
  } catch {
    // توافق آمن مع قواعد بيانات لم يطبّق عليها الترحيل بعد أو اتصال مؤقت.
  }
}

/**
 * يُستدعى بعد تسجيل الدخول مباشرة:
 * يبطل أي جلسة أخرى لنفس الحساب (يبقى هذا الجهاز فقط) ثم يسجل جلسة جديدة.
 */
export async function claimMySession(): Promise<void> {
  try {
    const sb = getSupabase();
    try { await sb.auth.signOut({ scope: 'others' }); } catch { /* ignore */ }
    // مفتاح ثابت لكل جهاز (يُنشأ مرة واحدة) — حتى لا تتغير الجلسة مع كل استدعاء
    let key = readKey();
    if (!key) {
      key = generateKey();
      writeKey(key);
    }
    await sb.rpc('claim_session', { p_key: key });
    await registerMyStudentDevice();
  } catch {
    // لا نمنع الدخول إن لم يُطبَّق الترحيل بعد أو فشل الاتصال مؤقتاً
  }
}

/**
 * هل هذا الجهاز لا يزال صاحب الجلسة الحالية؟
 * يُرجع true عند أي فشل مؤقت (حتى لا يُحجب المستخدم بلا داعٍ).
 */
export async function isMySessionCurrent(): Promise<boolean> {
  try {
    const key = readKey();
    const sb = getSupabase();
    if (key) {
      const { data, error } = await sb.rpc('check_session', { p_key: key });
      if (error || data === false) return error ? true : false;
    }
    // فحص إضافي لحجب جهاز الطالب المسجل لهذا السنتر فقط. إن لم يطبّق
    // الترحيل بعد نتجاهل الخطأ كي لا نحجب مستخدماً بلا داعٍ.
    const device = getDeviceId();
    if (device) {
      const access = await sb.rpc('check_current_student_device', { p_device: device });
      if (!access.error && access.data === false) return false;
    }
    return true;
  } catch {
    return true;
  }
}
