// ============================================================
// مساعد الجلسة من جهة العميل:
// - establishSession: يكتب رمز الوصول + المستخدم في التخزين المحلي
//   (بدون رمز التجديد — يبقى في كوكيز HttpOnly الخادمي).
// - refreshAccessToken: يطلب تجديداً من الخادم الذي يستخدم كوكيز HttpOnly.
// ============================================================
import { AUTH_API, AUTH_STORAGE_KEY } from './constants';

export interface SessionPayload {
  access_token: string;
  expires_at?: number;
  expires_in?: number;
  user?: unknown;
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
    const res = await fetch(AUTH_API.refresh, { method: 'POST' });
    if (!res.ok) return false;
    const data = (await res.json()) as Partial<SessionPayload>;
    if (!data || typeof data.access_token !== 'string') return false;
    writeLocalSession(data as SessionPayload);
    return true;
  } catch {
    return false;
  }
}
