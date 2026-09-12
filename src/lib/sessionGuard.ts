// ============================================================
// جلسة واحدة لكل حساب: تسجيل الدخول من جهاز ثانٍ يُخرج الأول تلقائياً.
// - عند الدخول: يبطل جلسات الحساب الأخرى ثم يطالب بجلسة جديدة.
// - دورياً: يتحقق الجهاز أنه لا يزال صاحب الجلسة؛ إن طُرد يخرج فوراً.
// لا يحجب المستخدم أبداً عند فشل مؤقت أو قبل تطبيق الترحيل.
// ============================================================

import { getSupabase } from './supabase';

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
    if (!key) return true; // لا مفتاح مسجل — لا نفرض حجباً
    const { data, error } = await getSupabase().rpc('check_session', { p_key: key });
    if (error) return true;
    return data !== false;
  } catch {
    return true;
  }
}
