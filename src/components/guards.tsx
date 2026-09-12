'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { useSession } from '@/context/session';
import { saveOverrideConfig } from '@/lib/supabase';
import type { Role } from '@/lib/types';
import { LoadingScreen, Notice, LinkButton } from './ui';

export function SetupNotice() {
  const { reinitConnection } = useSession();
  const [url, setUrl] = useState('');
  const [anonKey, setAnonKey] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await saveOverrideConfig(url, anonKey);
      await reinitConnection();
    } catch (err) {
      setError((err as Error)?.message ?? 'تعذر حفظ بيانات الاتصال');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="card auth-card stack">
        <div className="row">
          <div className="logo">MR</div>
          <div>
            <h1 className="h3">تعذر الوصول إلى البيانات</h1>
            <p className="muted" style={{ margin: 0 }}>المنصة تقرأ الاتصال تلقائياً من خادم الإعدادات المشترك — يبدو أنه غير متاح حالياً.</p>
          </div>
        </div>
        <Notice tone="warn">
          يمكنك إدخال بيانات اتصال مؤقتة لهذا المتصفح فقط للتجربة، أو التحقق من اتصال خادم الإعدادات والمحاولة مجدداً.
        </Notice>

        <form className="stack" onSubmit={save}>
          <label className="input-wrap">
            <span className="label">رابط قاعدة البيانات (لتجربة هذا المتصفح فقط)</span>
            <input className="input" dir="ltr" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://xxxxx.supabase.co" />
          </label>
          <label className="input-wrap">
            <span className="label">مفتاح الوصول العام</span>
            <input className="input" dir="ltr" value={anonKey} onChange={(e) => setAnonKey(e.target.value)} placeholder="eyJ..." />
          </label>
          {error ? <Notice tone="error">{error}</Notice> : null}
          <button className="btn" disabled={busy} type="submit">{busy ? 'جاري الحفظ...' : 'توصيل مؤقت'}</button>
        </form>

        <LinkButton href="/" variant="secondary">العودة للرئيسية</LinkButton>
      </div>
    </div>
  );
}

export function RequireAuth({ roles, children }: { roles?: Role[]; children: React.ReactNode }) {
  const { ready, configured, session, profile, subscription } = useSession();
  const pathname = usePathname();

  if (!ready) return <LoadingScreen />;
  if (!configured) return <SetupNotice />;
  if (!session) {
    return (
      <div className="auth-page">
        <div className="card auth-card stack" style={{ textAlign: 'center' }}>
          <div className="logo" style={{ marginInline: 'auto' }}>MR</div>
          <h1 className="h2">يلزم تسجيل الدخول</h1>
          <p className="muted">هذه الصفحة تتطلب حساباً للوصول إليها.</p>
          <div className="row" style={{ justifyContent: 'center' }}>
            <LinkButton href={`/auth/login?next=${encodeURIComponent(pathname)}`}>تسجيل الدخول</LinkButton>
            <LinkButton href="/" variant="secondary">الرئيسية</LinkButton>
          </div>
        </div>
      </div>
    );
  }
  if (!profile) return <LoadingScreen text="جاري تحميل ملف المستخدم..." />;
  if (profile.is_active === false) {
    return (
      <div className="auth-page">
        <div className="card auth-card stack">
          <Notice tone="error">هذا الحساب موقوف أو لم يتم تفعيله بعد.</Notice>
          <Link href="/">العودة للرئيسية</Link>
        </div>
      </div>
    );
  }
  if (roles && !roles.includes(profile.role)) {
    return (
      <div className="auth-page">
        <div className="card auth-card stack">
          <Notice tone="error">ليس لديك صلاحية فتح هذه الصفحة.</Notice>
          <LinkButton href="/" variant="secondary">الرئيسية</LinkButton>
        </div>
      </div>
    );
  }

  const blocked = profile.role !== 'super_admin'
    && subscription
    && (subscription.status === 'suspended' || subscription.status === 'expired');
  if (blocked) {
    return (
      <div className="auth-page">
        <div className="card auth-card stack">
          <h1 className="h2">الاشتراك غير نشط</h1>
          <Notice tone="error">السنتر موقوف أو الاشتراك منتهي. تواصل مع إدارة التطبيق لتجديد الخدمة.</Notice>
          <LinkButton href="/about" variant="secondary">بيانات التواصل</LinkButton>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}

export function HomeRedirect() {
  const { ready, configured, session, profile } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (!ready || !configured || !session || !profile) return;
    if (profile.role === 'student') router.replace('/student');
    else router.replace('/admin');
  }, [ready, configured, session, profile, router]);

  return null;
}
