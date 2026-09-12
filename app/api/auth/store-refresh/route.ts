// يحفظ رمز التجديد في كوكيز HttpOnly خادمي (لا يصل إليه أي سكربت متصفح).
import { NextRequest, NextResponse } from 'next/server';
import { REFRESH_COOKIE, REFRESH_COOKIE_MAX_AGE } from '@/lib/auth/constants';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  let refreshToken = '';
  try {
    const body = (await req.json()) as { refresh_token?: unknown };
    refreshToken = typeof body?.refresh_token === 'string' ? body.refresh_token : '';
  } catch {
    refreshToken = '';
  }
  if (!refreshToken || refreshToken.length > 5000 || /[\x00-\x1f\x7f]/.test(refreshToken)) {
    return NextResponse.json({ ok: false, error: 'invalid_refresh_token' }, { status: 400 });
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(REFRESH_COOKIE, refreshToken, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: REFRESH_COOKIE_MAX_AGE,
  });
  return res;
}
