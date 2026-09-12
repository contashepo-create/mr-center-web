// يجدد رمز الوصول باستخدام رمز التجديد من كوكيز HttpOnly.
// لا يُعيد رمز التجديد للمتصفح أبداً — يُكتب مباشرة في الكوكيز الخادمي.
import { NextRequest, NextResponse } from 'next/server';
import { REFRESH_COOKIE, REFRESH_COOKIE_MAX_AGE } from '@/lib/auth/constants';
import { getServerSupabaseConfig, refreshSupabaseSession } from '@/lib/auth/server';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const refreshToken = req.cookies.get(REFRESH_COOKIE)?.value ?? '';
  if (!refreshToken) return NextResponse.json({ error: 'no_refresh' }, { status: 401 });

  const cfg = await getServerSupabaseConfig();
  if (!cfg) return NextResponse.json({ error: 'config_unavailable' }, { status: 503 });

  const session = await refreshSupabaseSession(cfg, refreshToken);
  if (!session) return NextResponse.json({ error: 'refresh_failed' }, { status: 401 });

  const res = NextResponse.json({
    access_token: session.access_token,
    expires_at: session.expires_at,
    expires_in: session.expires_in,
    user: session.user,
  });
  res.cookies.set(REFRESH_COOKIE, session.refresh_token, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: REFRESH_COOKIE_MAX_AGE,
  });
  return res;
}
