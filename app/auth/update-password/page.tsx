'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Button, ErrorNotice, Input, LinkButton, Notice } from '@/components/ui';
import { getSupabase } from '@/lib/supabase';

export default function UpdatePasswordPage() {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [message, setMessage] = useState<string | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null); setMessage(null);
    if (password.length < 6) return setError(new Error('كلمة المرور لا تقل عن 6 أحرف'));
    setBusy(true);
    try {
      const { error } = await getSupabase().auth.updateUser({ password });
      if (error) throw error;
      setMessage('تم تغيير كلمة المرور بنجاح. يمكنك تسجيل الدخول الآن.');
    } catch (err) { setError(err); }
    finally { setBusy(false); }
  };
  return <main className="auth-page"><form className="card auth-card stack-lg" onSubmit={submit}><div className="row-between"><Link href="/" className="brand" style={{ margin: 0 }}><div className="logo">MR</div><div><strong>تغيير كلمة المرور</strong><div className="tiny muted">حساب موحد</div></div></Link><LinkButton href="/auth/login" variant="secondary">تسجيل الدخول</LinkButton></div><Notice>افتح هذه الصفحة من رابط إعادة تعيين كلمة المرور المرسل إلى بريدك.</Notice><Input label="كلمة المرور الجديدة" type="password" value={password} onChange={(e) => setPassword(e.target.value)} dir="ltr" /><ErrorNotice error={error} />{message ? <Notice tone="success">{message}</Notice> : null}<Button disabled={busy} type="submit">حفظ كلمة المرور</Button></form></main>;
}
