// ============================================================
// خادمي فقط (Route Handlers): جلب إعدادات Supabase من Cloudflare
// (بدون أي مفاتيح في الريبو) + تجديد الجلسة مقابل Supabase.
// ============================================================
import { DEFAULT_CONFIG_URL } from './constants';

export interface ServerSupabaseConfig {
  url: string;
  anonKey: string;
}

let cachedConfig: { value: ServerSupabaseConfig | null; at: number } = { value: null, at: 0 };
const CONFIG_TTL_MS = 60_000;

function configUrl(): string {
  // يجب أن يستخدم Route Handler المصدر نفسه الذي يستخدمه العميل؛ وإلا ينجح
  // الاتصال الأول ثم يفشل تجديد الجلسة عندما يحدد النشر NEXT_PUBLIC_CONFIG_URL.
  return (process.env.NEXT_PUBLIC_CONFIG_URL ?? '').trim() || DEFAULT_CONFIG_URL;
}

/** يُقرأ من Cloudflare (نفس المصدر الذي يقرأه Android) مع تخزين مؤقت قصير. */
export async function getServerSupabaseConfig(): Promise<ServerSupabaseConfig | null> {
  const now = Date.now();
  if (cachedConfig.value && now - cachedConfig.at < CONFIG_TTL_MS) return cachedConfig.value;
  try {
    const res = await fetch(configUrl(), { headers: { Accept: 'application/json' }, cache: 'no-store' });
    if (!res.ok) return cachedConfig.value;
    const data = (await res.json()) as { database?: { url?: string; anon_key?: string } };
    const url = data?.database?.url?.trim();
    const anonKey = data?.database?.anon_key?.trim();
    if (url && anonKey) {
      cachedConfig = { value: { url, anonKey }, at: now };
      return cachedConfig.value;
    }
    return cachedConfig.value;
  } catch {
    return cachedConfig.value;
  }
}

export interface RefreshedSession {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  expires_in: number;
  user: unknown;
}

/** يبادل رمز التجديد بجلسة جديدة عبر واجهة Supabase Auth مباشرة. */
export async function refreshSupabaseSession(
  cfg: ServerSupabaseConfig,
  refreshToken: string,
): Promise<RefreshedSession | null> {
  try {
    const res = await fetch(`${cfg.url}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: { apikey: cfg.anonKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      access_token?: string; refresh_token?: string; expires_in?: number; user?: unknown;
    };
    if (!data.access_token || !data.refresh_token) return null;
    const expiresIn = data.expires_in ?? 3600;
    return {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: Math.floor(Date.now() / 1000) + expiresIn,
      expires_in: expiresIn,
      user: data.user ?? null,
    };
  } catch {
    return null;
  }
}
