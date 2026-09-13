// ============================================================
// مساعد الجلسة من جهة العميل:
// - establishSession: يكتب رمز الوصول + المستخدم في التخزين المحلي
//   (بدون رمز التجديد — يبقى في كوكيز HttpOnly الخادمي).
// - refreshAccessToken: يطلب تجديداً من الخادم الذي يستخدم كوكيز HttpOnly.
// ============================================================
import { AUTH_API, AUTH_STORAGE_KEY, ACCESS_TOKEN_SAFE_READ_MARGIN_MS } from './constants';

export interface SessionPayload {
  access_token: string;
  expires_at?: number;
  expires_in?: number;
  user?: unknown;
}

/**
 * هل يستطيع عميل Supabase قراءة الجلسة المخزنة بأمان؟
 *
 * لا يوجد رمز التجديد في localStorage عمداً. لذلك، إذا صار رمز الوصول
 * قريباً جداً من الانتهاء، لا نمرر الجلسة إلى SDK كي لا يحاول التجديد
 * برمز فارغ ويصدر AuthSessionMissingError. يستعيد SessionProvider الجلسة
 * أولاً من كوكيز HttpOnly عبر /api/auth/refresh.
 */
export function shouldExposeStoredSession(raw: string | null, now = Date.now()): boolean {
  if (!raw) return false;
  try {
    const session = JSON.parse(raw) as {
      access_token?: unknown;
      refresh_token?: unknown;
      expires_at?: unknown;
    };
    // جلسة قديمة تحتوي رمز تجديد كامل: يظل سلوك Supabase الاعتيادي صالحاً.
    if (typeof session.refresh_token === 'string' && session.refresh_token.length > 0) return true;
    if (typeof session.access_token !== 'string' || !session.access_token) return false;
    if (typeof session.expires_at !== 'number' || !Number.isFinite(session.expires_at)) return false;
    return session.expires_at * 1000 - now > ACCESS_TOKEN_SAFE_READ_MARGIN_MS;
  } catch {
    return false;
  }
}

function writeLocalSession(payload: SessionPayload): void {
  if (typeof window === 'undefined') return;
  const expiresIn = payload.expires_in ?? 3600;
  const session = {
    access_token: payload.access_token,
    refresh_token: '', // حصرياً في كوكيز HttpOnly — لا يُخزَّن محلياً أبداً
    token_type: 'bearer',
    expires_in: expiresIn,
    expires_at: payload.expires_at ?? Math.floor(Date.now() / 1000) + expiresIn,
    user: payload.user ?? null,
  };
  try {
    window.localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(session));
  } catch { /* تجاهل */ }
}

/** يمسح رمز الوصول المحلي الفاسد/المنتهي دون لمس كوكيز HttpOnly. */
export function clearLocalAccessSession(): void {
  if (typeof window === 'undefined') return;
  try { window.localStorage.removeItem(AUTH_STORAGE_KEY); } catch { /* تجاهل */ }
}

/** يكتب جلسة (رمز وصول + مستخدم) في التخزين المحلي بدون رمز التجديد. */
export function establishSession(payload: SessionPayload): void {
  writeLocalSession(payload);
}

/**
 * يجدد رمز الوصول عبر خادمنا (يستخدم كوكيز HttpOnly تلقائياً).
 * يعيد false عند انعدام الجلسة القابلة للتجديد — على المتصل تنظيف الجلسة.
 */
export async function refreshAccessToken(): Promise<boolean> {
  try {
    const res = await fetch(AUTH_API.refresh, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return false;
    const data = (await res.json()) as Partial<SessionPayload>;
    if (!data || typeof data.access_token !== 'string') return false;
    writeLocalSession(data as SessionPayload);
    return true;
  } catch {
    return false;
  }
}
