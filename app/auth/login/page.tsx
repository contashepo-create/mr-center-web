'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useMemo, useState } from 'react';
import { Button, ErrorNotice, Input, LinkButton, LoadingScreen, Notice, Select } from '@/components/ui';
import { useSession } from '@/context/session';
import { completePendingCenter, completePendingStudent, loginWithEmail, registerStaffAccount, sendPasswordReset } from '@/lib/api';
import { clearPendingRegistration, loadPendingRegistration } from '@/lib/pendingRegistration';
import { getSupabase } from '@/lib/supabase';
import { isValidEmail } from '@/lib/utils';
import type { Role } from '@/lib/types';

type LoginRole = 'admin' | 'student' | 'teacher' | 'developer';

function roleTitle(role: LoginRole): { title: string; subtitle: string } {
  if (role === 'student') return { title: 'دخول الطالب', subtitle: 'ادخل بحساب الطالب لعرض الحضور والدرجات والمدفوعات.' };
  if (role === 'teacher') return { title: 'دخول فريق العمل', subtitle: 'للمدرسين والمديرين والسكرتارية بعد تفعيل صاحب السنتر.' };
  if (role === 'developer') return { title: 'دخول المطور', subtitle: 'بوابة مخفية لإدارة السناتر والاشتراكات.' };
  return { title: 'دخول مسئول السنتر', subtitle: 'لصاحب السنتر أو المدير لفتح لوحة الإدارة.' };
}

function targetForRole(role: Role): string {
  if (role === 'super_admin') return '/developer';
  if (role === 'student') return '/student';
  return '/admin';
}

function roleAllowed(expected: LoginRole, actual: Role | null): boolean {
  if (!actual) return false;
  if (expected === 'developer') return actual === 'super_admin';
  if (expected === 'student') return actual === 'student';
  if (expected === 'teacher') return actual === 'teacher' || actual === 'manager' || actual === 'secretary';
  return actual === 'center_admin' || actual === 'super_admin' || actual === 'teacher' || actual === 'manager' || actual === 'secretary';
}

function LoginForm() {
  const search = useSearchParams();
  const router = useRouter();
  const { ready, configured, refresh } = useSession();
  const initialRole = (search.get('role') as LoginRole | null) ?? 'admin';
  const [role, setRole] = useState<LoginRole>(['admin', 'student', 'teacher', 'developer'].includes(initialRole) ? initialRole : 'admin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [forgotBusy, setForgotBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [message, setMessage] = useState<string | null>(null);
  const text = useMemo(() => roleTitle(role), [role]);

  if (!ready) return <LoadingScreen />;
  if (!configured) {
    return (
      <div className="auth-page"><div className="card auth-card"><Notice tone="warn">اضبط مفاتيح Supabase أولاً من ملف .env.local أو Vercel.</Notice></div></div>
    );
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setMessage(null);
    if (!isValidEmail(email)) return setError(new Error('أدخل بريداً إلكترونياً صحيحاً'));
    if (password.length < 6) return setError(new Error('كلمة المرور يجب ألا تقل عن 6 أحرف'));

    setBusy(true);
    try {
      const { user } = await loginWithEmail(email, password);
      let { data: prof } = await getSupabase()
        .from('profiles')
        .select('role, is_active')
        .eq('id', user.id)
        .maybeSingle();

      if (!prof) {
        const pending = await loadPendingRegistration();
        if (pending && pending.email.trim().toLowerCase() === email.trim().toLowerCase()) {
          const kindOk = ((role === 'admin' || role === 'teacher') && (pending.kind === 'center' || pending.kind === 'teacher'))
            || (role === 'student' && pending.kind === 'student');
          if (!kindOk) throw new Error('نوع التسجيل المعلق لا يطابق شاشة الدخول الحالية. افتح شاشة الدخول المناسبة.');

          if (pending.kind === 'center') {
            await completePendingCenter({
              centerName: pending.centerName,
              code: pending.code,
              ownerName: pending.ownerName,
              phone: pending.phone,
              kind: pending.centerKind ?? 'center',
            });
          } else if (pending.kind === 'student') {
            await completePendingStudent({
              centerId: pending.centerId,
              fullName: pending.fullName,
              phone: pending.phone,
              guardianPhone: pending.guardianPhone,
              gradeId: pending.gradeId ?? null,
              groupId: pending.groupId ?? null,
            });
          } else {
            await registerStaffAccount({
              centerId: pending.centerId,
              fullName: pending.fullName,
              phone: pending.phone,
              role: pending.staffRole ?? 'teacher',
            });
          }
          await clearPendingRegistration();
          const retry = await getSupabase().from('profiles').select('role, is_active').eq('id', user.id).maybeSingle();
          prof = retry.data;
        }
      }

      const actualRole = (prof?.role ?? null) as Role | null;
      if (!prof || !actualRole) throw new Error('هذا الحساب غير مكتمل التسجيل أو لا يملك ملف مستخدم.');
      if (prof.is_active === false) throw new Error('هذا الحساب غير مفعّل أو موقوف حالياً.');
      if (!roleAllowed(role, actualRole)) throw new Error('هذا الحساب لا يطابق نوع الدخول المختار.');

      await refresh();
      router.replace(search.get('next') || targetForRole(actualRole));
    } catch (err) {
      try { await getSupabase().auth.signOut(); } catch { /* ignore */ }
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const forgot = async () => {
    setError(null);
    setMessage(null);
    if (!isValidEmail(email)) return setError(new Error('اكتب البريد الإلكتروني أولاً.'));
    setForgotBusy(true);
    try {
      await sendPasswordReset(email);
      setMessage('تم إرسال رابط إعادة تعيين كلمة المرور إلى بريدك الإلكتروني.');
    } catch (err) {
      setError(err);
    } finally {
      setForgotBusy(false);
    }
  };

  return (
    <main className="auth-page">
      <form className="card auth-card stack-lg" onSubmit={submit}>
        <div className="row-between">
          <Link href="/" className="brand" style={{ margin: 0 }}>
            <div className="logo">MR</div>
            <div><strong>Mr Center</strong><div className="tiny muted">تسجيل الدخول</div></div>
          </Link>
          <LinkButton href="/" variant="secondary">الرئيسية</LinkButton>
        </div>

        <div>
          <h1 className="h2">{text.title}</h1>
          <p className="muted" style={{ lineHeight: 1.8 }}>{text.subtitle}</p>
        </div>

        <Select label="نوع الدخول" value={role} onChange={(e) => setRole(e.target.value as LoginRole)}>
          <option value="admin">مسئول السنتر</option>
          <option value="teacher">فريق العمل</option>
          <option value="student">طالب</option>
          <option value="developer">المطور</option>
        </Select>

        <Input label="البريد الإلكتروني" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="example@mail.com" dir="ltr" />
        <Input label="كلمة المرور" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" dir="ltr" />

        <ErrorNotice error={error} />
        {message ? <Notice tone="success">{message}</Notice> : null}

        <Button disabled={busy} type="submit" className="block">{busy ? 'جاري الدخول...' : 'دخول'}</Button>
        <Button disabled={forgotBusy} type="button" variant="ghost" onClick={forgot}>{forgotBusy ? 'جاري الإرسال...' : 'نسيت كلمة المرور؟'}</Button>

        <div className="row" style={{ justifyContent: 'center' }}>
          <Link href="/auth/register-center" className="muted small">إنشاء سنتر</Link>
          <span className="muted">·</span>
          <Link href="/auth/register-student" className="muted small">تسجيل طالب</Link>
          <span className="muted">·</span>
          <Link href="/auth/register-staff" className="muted small">انضمام فريق</Link>
        </div>
      </form>
    </main>
  );
}

export default function LoginPage() {
  return <Suspense fallback={<LoadingScreen />}><LoginForm /></Suspense>;
}
