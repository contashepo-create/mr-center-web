'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Button, ErrorNotice, Input, LinkButton, LoadingScreen, Notice, Select } from '@/components/ui';
import { useSession } from '@/context/session';
import { checkAvailability, registerCenterOwner } from '@/lib/api';
import { savePendingRegistration } from '@/lib/pendingRegistration';
import { isValidCenterCode, isValidPhone, isValidSignupEmail, normalizeCenterCode, normalizePhone } from '@/lib/utils';

export default function RegisterCenterPage() {
  const { ready, configured } = useSession();
  const [form, setForm] = useState({
    centerName: '', code: '', ownerName: '', email: '', phone: '', password: '', kind: 'center',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [done, setDone] = useState<string | null>(null);

  if (!ready) return <LoadingScreen />;
  if (!configured) return <main className="auth-page"><div className="card auth-card"><Notice tone="warn">اضبط مفاتيح Supabase أولاً.</Notice></div></main>;

  const update = (key: keyof typeof form, value: string) => setForm((f) => ({ ...f, [key]: value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null); setDone(null);
    const code = normalizeCenterCode(form.code);
    const phone = normalizePhone(form.phone);
    if (form.centerName.trim().length < 2) return setError(new Error('اكتب اسم السنتر'));
    if (!isValidCenterCode(code)) return setError(new Error('كود السنتر من 3 إلى 8 حروف أو أرقام بدون مسافات'));
    if (form.ownerName.trim().length < 2) return setError(new Error('اكتب اسم صاحب السنتر'));
    if (!isValidSignupEmail(form.email)) return setError(new Error('استخدم بريد Gmail/Yahoo/Outlook أو مزود معروف'));
    if (!isValidPhone(phone)) return setError(new Error('رقم الهاتف غير صحيح'));
    if (form.password.length < 6) return setError(new Error('كلمة المرور لا تقل عن 6 أحرف'));

    setBusy(true);
    try {
      const availability = await checkAvailability(form.email, phone);
      if (availability.email_taken) throw new Error('email_taken');
      if (availability.phone_taken) throw new Error('phone_taken');
      await registerCenterOwner({
        centerName: form.centerName,
        code,
        ownerName: form.ownerName,
        email: form.email,
        phone,
        password: form.password,
        kind: form.kind,
      });
      setDone('تم إنشاء السنتر بنجاح. يمكنك تسجيل الدخول الآن.');
    } catch (err) {
      if (String((err as { message?: string }).message ?? err).includes('email_confirmation_required')) {
        await savePendingRegistration({
          kind: 'center', email: form.email.trim().toLowerCase(), centerName: form.centerName,
          code, ownerName: form.ownerName, phone, centerKind: form.kind,
        });
        setDone('تم إنشاء حسابك. أكّد البريد من الرسالة المرسلة إليك، ثم ادخل من شاشة مسئول السنتر وسيُستكمل إنشاء السنتر تلقائياً.');
      } else {
        setError(err);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="auth-page">
      <form className="card auth-card stack-lg" onSubmit={submit}>
        <div className="row-between">
          <Link href="/" className="brand" style={{ margin: 0 }}><div className="logo">MR</div><div><strong>إنشاء سنتر</strong><div className="tiny muted">حساب مسئول جديد</div></div></Link>
          <LinkButton href="/auth/login?role=admin" variant="secondary">لدي حساب</LinkButton>
        </div>
        <Notice tone="warn">كود السنتر ثابت وفريد ولا يتغير لاحقاً. الطلاب وفريق العمل سيستخدمونه للانضمام.</Notice>
        <div className="grid grid-2">
          <Input label="اسم السنتر" value={form.centerName} onChange={(e) => update('centerName', e.target.value)} />
          <Input label="كود السنتر" value={form.code} onChange={(e) => update('code', e.target.value)} placeholder="ABC123" dir="ltr" />
          <Input label="اسم صاحب السنتر" value={form.ownerName} onChange={(e) => update('ownerName', e.target.value)} />
          <Select label="نوع الحساب" value={form.kind} onChange={(e) => update('kind', e.target.value)}>
            <option value="center">سنتر متكامل</option>
            <option value="solo">مدرس خصوصي مستقل</option>
          </Select>
          <Input label="البريد الإلكتروني" type="email" value={form.email} onChange={(e) => update('email', e.target.value)} dir="ltr" />
          <Input label="رقم الهاتف" value={form.phone} onChange={(e) => update('phone', e.target.value)} dir="ltr" />
          <Input label="كلمة المرور" type="password" value={form.password} onChange={(e) => update('password', e.target.value)} dir="ltr" />
        </div>
        <ErrorNotice error={error} />
        {done ? <Notice tone="success">{done}</Notice> : null}
        <Button disabled={busy} type="submit" className="block">{busy ? 'جاري إنشاء الحساب...' : 'إنشاء الحساب'}</Button>
      </form>
    </main>
  );
}
