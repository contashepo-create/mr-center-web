'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useSession } from '@/context/session';
import { isDevUnlocked, setDevUnlocked } from '@/lib/devMode';
import { getSupabase } from '@/lib/supabase';
import { Button, ErrorNotice, Input } from './ui';

/**
 * نموذج طلب الرقم السري مرة أخرى قبل فتح لوحة المطور.
 * التحقق يتم عبر إعادة الدخول بنفس البريد وكلمة المرور (Supabase Auth).
 */
export function DevUnlockForm({ onSuccess }: { onSuccess?: () => void }) {
  const { profile } = useSession();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const email = profile?.email ?? '';
    if (!email) return setError(new Error('لا يوجد بريد مسجل لهذا الحساب.'));
    if (!password) return setError(new Error('أدخل الرقم السري للمتابعة.'));
    setBusy(true);
    try {
      const { error: authError } = await getSupabase().auth.signInWithPassword({ email, password });
      if (authError) throw authError;
      setDevUnlocked(true);
      onSuccess?.();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="stack" onSubmit={submit}>
      <p className="muted" style={{ lineHeight: 1.8, margin: 0 }}>
        هذه منطقة خاصة بالمطور. أدخل الرقم السري مرة أخرى لتأكيد الهوية والمتابعة.
      </p>
      <Input
        label="الرقم السري"
        type="password"
        autoComplete="current-password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="••••••••"
        dir="ltr"
      />
      <ErrorNotice error={error} />
      <Button disabled={busy} type="submit" className="block">{busy ? 'جارٍ التحقق...' : 'دخول لوحة المطور'}</Button>
    </form>
  );
}

export function DevUnlockScreen() {
  return (
    <main className="auth-page">
      <div className="card auth-card stack-lg" style={{ textAlign: 'center' }}>
        <div className="logo" style={{ margin: '0 auto' }}>⌘</div>
        <div>
          <h1 className="h2">لوحة المطور</h1>
          <p className="muted">يُطلب الرقم السري في كل مرة تنتقل فيها إلى لوحة المطور.</p>
        </div>
        <DevUnlockForm onSuccess={() => window.location.reload()} />
        <Link href="/admin" className="btn secondary block">العودة إلى لوحة السنتر</Link>
      </div>
    </main>
  );
}

/** بوابة تمنع فتح صفحات المطور قبل إعادة إدخال الرقم السري. */
export function DeveloperGate({ children }: { children: React.ReactNode }) {
  const [unlocked, setUnlocked] = useState(false);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    setUnlocked(isDevUnlocked());
    setChecked(true);
  }, []);

  if (!checked) return null;
  if (!unlocked) return <DevUnlockScreen />;
  return <>{children}</>;
}
