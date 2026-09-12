'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Button, ErrorNotice, Input, LinkButton, LoadingScreen, Notice, Select } from '@/components/ui';
import { useSession } from '@/context/session';
import { checkAvailability, lookupCenterByCode, registerStaffAccount } from '@/lib/api';
import { savePendingRegistration } from '@/lib/pendingRegistration';
import { getSupabase } from '@/lib/supabase';
import type { CenterLookup } from '@/lib/types';
import { isValidEmail, isValidPhone, normalizeCenterCode, normalizePhone } from '@/lib/utils';

async function ensureSessionOrNeedsConfirmation(email: string, password: string): Promise<void> {
  const sb = getSupabase();
  const { data: current } = await sb.auth.getSession();
  if (current.session) return;
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (!error) return;
  throw new Error('email_confirmation_required');
}

export default function RegisterStaffPage() {
  const { ready, configured } = useSession();
  const [code, setCode] = useState('');
  const [center, setCenter] = useState<CenterLookup | null>(null);
  const [form, setForm] = useState({ fullName: '', email: '', phone: '', password: '', role: 'teacher' });
  const [busy, setBusy] = useState(false);
  const [lookupBusy, setLookupBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [done, setDone] = useState<string | null>(null);

  if (!ready) return <LoadingScreen />;
  if (!configured) return <main className="auth-page"><div className="card auth-card"><Notice tone="warn">اضبط مفاتيح Supabase أولاً.</Notice></div></main>;

  const lookup = async () => {
    setError(null); setDone(null); setCenter(null);
    const normalized = normalizeCenterCode(code);
    if (!normalized) return setError(new Error('اكتب كود السنتر أولاً'));
    setLookupBusy(true);
    try {
      const found = await lookupCenterByCode(normalized);
      if (!found) throw new Error('center_not_found');
      if (found.status === 'suspended') throw new Error('center_suspended');
      setCenter(found);
    } catch (err) {
      setError(err);
    } finally {
      setLookupBusy(false);
    }
  };

  const update = (key: keyof typeof form, value: string) => setForm((f) => ({ ...f, [key]: value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null); setDone(null);
    if (!center) return setError(new Error('ابحث عن السنتر بالكود أولاً'));
    const email = form.email.trim().toLowerCase();
    const phone = normalizePhone(form.phone);
    if (form.fullName.trim().length < 2) return setError(new Error('اكتب الاسم'));
    if (!isValidEmail(email)) return setError(new Error('البريد الإلكتروني غير صحيح'));
    if (!isValidPhone(phone)) return setError(new Error('رقم الهاتف غير صحيح'));
    if (form.password.length < 6) return setError(new Error('كلمة المرور لا تقل عن 6 أحرف'));

    setBusy(true);
    try {
      const availability = await checkAvailability(email, phone);
      if (availability.email_taken) throw new Error('email_taken');
      if (availability.phone_taken) throw new Error('phone_taken');
      const { data, error: signUpError } = await getSupabase().auth.signUp({ email, password: form.password });
      if (signUpError) throw signUpError;
      if (!data.user) throw new Error('email_taken');
      await ensureSessionOrNeedsConfirmation(email, form.password);
      await registerStaffAccount({ centerId: center.id, fullName: form.fullName, phone, role: form.role });
      setDone('تم إرسال طلب الانضمام. سيظهر لصاحب السنتر لتفعيل الحساب وتحديد الصلاحيات.');
    } catch (err) {
      if (String((err as { message?: string }).message ?? err).includes('email_confirmation_required')) {
        await savePendingRegistration({
          kind: 'teacher', email, centerId: center.id, fullName: form.fullName,
          phone, staffRole: form.role,
        });
        setDone('تم إنشاء الحساب. أكّد البريد ثم ادخل من شاشة فريق العمل وسيُرسل طلب التفعيل لصاحب السنتر تلقائياً.');
      } else setError(err);
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
        <div className="card compact soft stack">
          <Input label="كود السنتر" value={code} onChange={(e) => setCode(e.target.value)} placeholder="ABC123" dir="ltr" />
          <Button type="button" variant="secondary" disabled={lookupBusy} onClick={lookup}>{lookupBusy ? 'جاري البحث...' : 'تأكيد كود السنتر'}</Button>
          {center ? <Notice tone="success">تم العثور على: {center.name}</Notice> : null}
        </div>
        <div className="grid grid-2">
          <Input label="الاسم" value={form.fullName} onChange={(e) => update('fullName', e.target.value)} />
          <Select label="الدور المطلوب" value={form.role} onChange={(e) => update('role', e.target.value)}>
            <option value="teacher">مدرس</option>
            <option value="manager">مدير</option>
            <option value="secretary">سكرتير</option>
          </Select>
          <Input label="البريد الإلكتروني" type="email" value={form.email} onChange={(e) => update('email', e.target.value)} dir="ltr" />
          <Input label="رقم الهاتف" value={form.phone} onChange={(e) => update('phone', e.target.value)} dir="ltr" />
          <Input label="كلمة المرور" type="password" value={form.password} onChange={(e) => update('password', e.target.value)} dir="ltr" />
        </div>
        <ErrorNotice error={error} />
        {done ? <Notice tone="success">{done}</Notice> : null}
        <Button disabled={busy || !center} type="submit" className="block">{busy ? 'جاري إرسال الطلب...' : 'إنشاء حساب الفريق'}</Button>
      </form>
    </main>
  );
}
