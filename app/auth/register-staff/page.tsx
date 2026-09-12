'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Button, ErrorNotice, Input, LinkButton, LoadingScreen, Notice } from '@/components/ui';
import { useSession } from '@/context/session';
import { getInviteInfo, registerStaffByInvite } from '@/lib/api';
import { savePendingRegistration } from '@/lib/pendingRegistration';
import { getSupabase } from '@/lib/supabase';
import { isValidEmail } from '@/lib/utils';

export default function RegisterStaffPage() {
  const { ready, configured } = useSession();
  const [step, setStep] = useState<'code' | 'signup'>('code');
  const [code, setCode] = useState('');
  const [info, setInfo] = useState<{ name?: string; role?: string; center_name?: string } | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [lookupBusy, setLookupBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [done, setDone] = useState<string | null>(null);

  if (!ready) return <LoadingScreen />;
  if (!configured) return <main className="auth-page"><div className="card auth-card"><Notice tone="warn">اضبط مفاتيح Supabase أولاً.</Notice></div></main>;

  const checkCode = async () => {
    setError(null); setDone(null); setInfo(null);
    const normalized = code.trim().toUpperCase();
    if (!normalized) return setError(new Error('اكتب كود الدعوة أولاً'));
    setLookupBusy(true);
    try {
      const res = await getInviteInfo(normalized);
      if (!res.found) throw new Error('كود الدعوة غير صحيح');
      if (res.suspended) throw new Error('السنتر موقوف حالياً — تواصل مع مطور التطبيق');
      if (!res.usable) throw new Error('هذا الكود مستخدم أو ملغى — اطلب كوداً جديداً من صاحب السنتر');
      setInfo(res); setStep('signup');
    } catch (err) {
      setError(err);
    } finally {
      setLookupBusy(false);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null); setDone(null);
    const em = email.trim().toLowerCase();
    if (!isValidEmail(em)) return setError(new Error('البريد الإلكتروني غير صحيح'));
    if (password.length < 6) return setError(new Error('كلمة المرور لا تقل عن 6 أحرف'));
    setBusy(true);
    try {
      const doneNow = await registerStaffByInvite({ inviteCode: code, email: em, password });
      if (doneNow) {
        setDone('تم إنشاء حسابك. سجّل دخولك من «دخول فريق العمل» بعد أن يفعّلك صاحب السنتر.');
      } else {
        await savePendingRegistration({ kind: 'teacher', email: em, inviteCode: code.trim().toUpperCase() });
        setDone('أرسلنا رسالة تأكيد إلى بريدك — أكّده ثم سجّل دخولك من «دخول فريق العمل» وسيُكتمل ملفك تلقائياً.');
      }
      setStep('code'); setCode('');
      await getSupabase().auth.signOut();
    } catch (err) {
      const m = String((err as { message?: string }).message ?? err).toLowerCase();
      if (m.includes('email_taken')) setError(new Error('هذا البريد مستخدم بالفعل — سجّل دخولك من «دخول فريق العمل»'));
      else setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="auth-page">
      <form className="card auth-card stack-lg" onSubmit={submit}>
        <div className="row-between">
          <Link href="/" className="brand" style={{ margin: 0 }}><div className="logo">MR</div><div><strong>انضمام فريق عمل</strong><div className="tiny muted">حساب خامل حتى يفعّله المالك</div></div></Link>
          <LinkButton href="/auth/login?role=teacher" variant="secondary">دخول فريق</LinkButton>
        </div>
        <Notice tone="warn">التسجيل يتم حصراً بكود دعوة من صاحب السنتر — لا يوجد تسجيل ذاتي. المدير هو صاحب السنتر نفسه ولا يُضاف مدير إضافي.</Notice>
        {step === 'code' ? (
          <div className="card compact soft stack">
            <Input label="كود الدعوة" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="6 خانات من صاحب السنتر" dir="ltr" />
            <Button type="button" variant="secondary" disabled={lookupBusy} onClick={checkCode}>{lookupBusy ? 'جاري التحقق...' : 'تحقق من الكود'}</Button>
          </div>
        ) : (
          <div className="grid grid-2">
            <Input label="البريد الإلكتروني" type="email" value={email} onChange={(e) => setEmail(e.target.value)} dir="ltr" />
            <Input label="كلمة المرور" type="password" value={password} onChange={(e) => setPassword(e.target.value)} dir="ltr" />
          </div>
        )}
        {info && step === 'signup' ? <Notice tone="success">الدعوة موجهة إلى {info.name} — {info.role === 'secretary' ? 'سكرتير' : 'مدرس'} في «{info.center_name}»</Notice> : null}
        <ErrorNotice error={error} />
        {done ? <Notice tone="success">{done}</Notice> : null}
        {step === 'signup' ? (
          <Button disabled={busy} type="submit" className="block">{busy ? 'جاري إنشاء الحساب...' : 'إنشاء الحساب'}</Button>
        ) : null}
      </form>
    </main>
  );
}