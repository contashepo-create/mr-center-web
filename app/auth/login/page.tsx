'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { Button, ErrorNotice, Input, LinkButton, LoadingScreen, Notice } from '@/components/ui';
import { ThemeToggle } from '@/components/theme-toggle';
import { useSession } from '@/context/session';
import { completePendingCenter, completePendingStudent, loginWithEmail, registerStaffAccount, sendPasswordReset } from '@/lib/api';
import { clearPendingRegistration, loadPendingRegistration } from '@/lib/pendingRegistration';
import { getSupabase } from '@/lib/supabase';
import { isValidEmail } from '@/lib/utils';
import type { Role } from '@/lib/types';

type LoginRole = 'owner' | 'staff' | 'student';

const ROLE_TILES: { key: LoginRole; icon: string; title: string; desc: string }[] = [
  { key: 'owner', icon: '🏢', title: 'صاحب السنتر', desc: 'إدارة كاملة للسنتر والطلاب والفريق' },
  { key: 'staff', icon: '🧑‍🏫', title: 'فريق العمل', desc: 'مدرس · مدير · سكرتير بصلاحياتك المسموحة' },
  { key: 'student', icon: '🎓', title: 'طالب', desc: 'حضورك ودرجاتك ومدفوعاتك واختباراتك' },
];

function roleTitle(role: LoginRole): string {
  if (role === 'student') return 'أهلاً بك أيها الطالب';
  if (role === 'staff') return 'أهلاً بك في فريق العمل';
  return 'أهلاً بك صاحب السنتر';
}

function targetForRole(role: Role): string {
  if (role === 'student') return '/student';
  return '/admin';
}

function roleAllowed(expected: LoginRole, actual: Role | null): boolean {
  if (!actual) return false;
  if (expected === 'student') return actual === 'student';
  if (expected === 'staff') return actual === 'teacher' || actual === 'manager' || actual === 'secretary';
  return actual === 'center_admin' || actual === 'super_admin';
}

function roleFromParam(param: string | null): LoginRole {
  if (param === 'student') return 'student';
  if (param === 'teacher' || param === 'staff') return 'staff';
  return 'owner';
}

function LoginForm() {
  const search = useSearchParams();
  const router = useRouter();
  const { ready, configured, refresh } = useSession();
  const [role, setRole] = useState<LoginRole>(roleFromParam(search.get('role')));
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [forgotBusy, setForgotBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [honeypot, setHoneypot] = useState('');
  const startedAt = useState(() => Date.now())[0];

  if (!ready) return <LoadingScreen />;
  if (!configured) {
    return (
      <div className="auth-page"><div className="card auth-card"><Notice tone="warn">لم يتم ضبط الاتصال بعد — تواصل مع الإدارة.</Notice></div></div>
    );
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setMessage(null);
    // حقل شرك: تملؤه الروبوتات فقط — نرفض بصمت
    if (honeypot.trim()) return;
    // بوابة زمنية: الروبوتات ترسل فوراً — نرفض الإرسال الأسرع من اللازم
    if (Date.now() - startedAt < 1200) return setError(new Error('حاول مرة أخرى بعد لحظة'));
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
          const kindOk = ((role === 'owner' || role === 'staff') && (pending.kind === 'center' || pending.kind === 'teacher'))
            || (role === 'student' && pending.kind === 'student');
          if (!kindOk) throw new Error('نوع التسجيل المعلق لا يطابق نوع الدخول المختار. اختر النوع الصحيح.');

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
      if (!prof || !actualRole) throw new Error('هذا الحساب غير مكتمل التسجيل. أكمل التسجيل أولاً.');
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
      <div className="container" style={{ width: 'min(600px, 100%)', position: 'relative' }}>
        <div className="row-between" style={{ marginBottom: 18 }}>
          <Link href="/" className="brand" style={{ margin: 0 }}>
            <div className="logo">MR</div>
            <div><strong>Mr Center</strong><div className="tiny muted">بوابة الدخول</div></div>
          </Link>
          <div className="row">
            <ThemeToggle variant="secondary" />
            <LinkButton href="/" variant="secondary">الرئيسية</LinkButton>
          </div>
        </div>

        <form className="card stack-lg" onSubmit={submit}>
          <div>
            <h1 className="h2">{roleTitle(role)}</h1>
            <p className="muted" style={{ lineHeight: 1.8 }}>
              اختر نوع حسابك ثم أدخل بيانات الدخول، وستفتح لك صلاحياتك فقط.
            </p>
          </div>

          <div className="role-tiles">
            {ROLE_TILES.map((t) => (
              <button
                key={t.key}
                type="button"
                className={`role-tile ${role === t.key ? 'active' : ''}`}
                onClick={() => setRole(t.key)}
              >
                <span className="role-icon">{t.icon}</span>
                <span className="role-body">
                  <strong>{t.title}</strong>
                  <span className="tiny muted">{t.desc}</span>
                </span>
                <span className="role-check">✓</span>
              </button>
            ))}
          </div>

          <div className="stack">
            <Input label="البريد الإلكتروني" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="example@mail.com" dir="ltr" />
            <Input label="كلمة المرور" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" dir="ltr" />
            {/* حقل شرك مخفي: لا يملؤه البشر — يرفض أي روبوت يملؤه تلقائياً */}
            <input
              type="text"
              name="website"
              value={honeypot}
              onChange={(e) => setHoneypot(e.target.value)}
              tabIndex={-1}
              autoComplete="off"
              aria-hidden="true"
              style={{ position: 'absolute', left: '-9999px', width: '1px', height: '1px', opacity: 0 }}
            />
          </div>

          <ErrorNotice error={error} />
          {message ? <Notice tone="success">{message}</Notice> : null}

          <Button disabled={busy} type="submit" className="block">{busy ? 'جاري الدخول...' : 'تسجيل الدخول'}</Button>
          <Button disabled={forgotBusy} type="button" variant="ghost" onClick={forgot}>{forgotBusy ? 'جاري الإرسال...' : 'نسيت كلمة المرور؟'}</Button>

          <div className="row" style={{ justifyContent: 'center' }}>
            <Link href="/auth/register-center" className="muted small">إنشاء سنتر</Link>
            <span className="muted">·</span>
            <Link href="/auth/register-student" className="muted small">تسجيل طالب</Link>
            <span className="muted">·</span>
            <Link href="/auth/register-staff" className="muted small">انضمام فريق</Link>
          </div>
        </form>
      </div>
    </main>
  );
}

export default function LoginPage() {
  return <Suspense fallback={<LoadingScreen />}><LoginForm /></Suspense>;
}
