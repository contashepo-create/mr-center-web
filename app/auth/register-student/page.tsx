'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { Button, ErrorNotice, Input, LinkButton, LoadingScreen, Notice, Select } from '@/components/ui';
import { useSession } from '@/context/session';
import { checkAvailability, fetchSignupLists, lookupCenterByCode, registerStudent } from '@/lib/api';
import { savePendingRegistration } from '@/lib/pendingRegistration';
import type { CenterLookup } from '@/lib/types';
import { isValidEmail, isValidPhone, normalizeCenterCode, normalizePhone } from '@/lib/utils';

export default function RegisterStudentPage() {
  const { ready, configured } = useSession();
  const [code, setCode] = useState('');
  const [center, setCenter] = useState<CenterLookup | null>(null);
  const [lists, setLists] = useState<{ grades: { id: string; name: string }[]; groups: { id: string; name: string; grade_id: string | null }[] }>({ grades: [], groups: [] });
  const [form, setForm] = useState({ fullName: '', email: '', phone: '', guardianPhone: '', password: '', gradeId: '', groupId: '' });
  const [busy, setBusy] = useState(false);
  const [lookupBusy, setLookupBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [done, setDone] = useState<string | null>(null);

  const filteredGroups = useMemo(() => lists.groups.filter((g) => !form.gradeId || !g.grade_id || g.grade_id === form.gradeId), [lists.groups, form.gradeId]);

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
      setLists(await fetchSignupLists(found.id));
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
    const phone = normalizePhone(form.phone);
    const guardianPhone = normalizePhone(form.guardianPhone);
    if (form.fullName.trim().length < 2) return setError(new Error('اكتب اسم الطالب'));
    if (!isValidEmail(form.email)) return setError(new Error('البريد الإلكتروني غير صحيح'));
    if (!isValidPhone(phone)) return setError(new Error('رقم الطالب غير صحيح'));
    if (!isValidPhone(guardianPhone)) return setError(new Error('رقم ولي الأمر غير صحيح'));
    if (phone === guardianPhone) return setError(new Error('رقم ولي الأمر يجب أن يختلف عن رقم الطالب'));
    if (form.password.length < 6) return setError(new Error('كلمة المرور لا تقل عن 6 أحرف'));

    setBusy(true);
    try {
      const availability = await checkAvailability(form.email, phone);
      if (availability.email_taken) throw new Error('email_taken');
      if (availability.phone_taken) throw new Error('phone_taken');
      await registerStudent({
        centerId: center.id,
        fullName: form.fullName,
        email: form.email,
        phone,
        guardianPhone,
        password: form.password,
        gradeId: form.gradeId || null,
        groupId: form.groupId || null,
      });
      setDone('تم تسجيل الطالب بنجاح. يمكنك تسجيل الدخول الآن.');
    } catch (err) {
      if (String((err as { message?: string }).message ?? err).includes('email_confirmation_required')) {
        await savePendingRegistration({
          kind: 'student', email: form.email.trim().toLowerCase(), centerId: center.id,
          fullName: form.fullName, phone, guardianPhone,
          gradeId: form.gradeId || null, groupId: form.groupId || null,
        });
        setDone('تم إنشاء حساب الطالب. أكّد البريد ثم ادخل من شاشة الطالب وسيتم ربطك بالسنتر تلقائياً.');
      } else setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="auth-page">
      <form className="card auth-card stack-lg" onSubmit={submit}>
        <div className="row-between">
          <Link href="/" className="brand" style={{ margin: 0 }}><div className="logo">MR</div><div><strong>تسجيل طالب</strong><div className="tiny muted">انضمام بكود السنتر مرة واحدة</div></div></Link>
          <LinkButton href="/auth/login?role=student" variant="secondary">دخول طالب</LinkButton>
        </div>

        <div className="card compact soft stack">
          <Input label="كود السنتر" value={code} onChange={(e) => setCode(e.target.value)} placeholder="ABC123" dir="ltr" />
          <Button type="button" variant="secondary" disabled={lookupBusy} onClick={lookup}>{lookupBusy ? 'جاري البحث...' : 'تأكيد كود السنتر'}</Button>
          {center ? <Notice tone="success">تم العثور على: {center.name} — صاحب السنتر: {center.owner_name}</Notice> : null}
        </div>

        <div className="grid grid-2">
          <Input label="اسم الطالب" value={form.fullName} onChange={(e) => update('fullName', e.target.value)} />
          <Input label="البريد الإلكتروني" type="email" value={form.email} onChange={(e) => update('email', e.target.value)} dir="ltr" />
          <Input label="رقم الطالب" value={form.phone} onChange={(e) => update('phone', e.target.value)} dir="ltr" />
          <Input label="رقم ولي الأمر" value={form.guardianPhone} onChange={(e) => update('guardianPhone', e.target.value)} dir="ltr" />
          <Select label="الصف" value={form.gradeId} onChange={(e) => update('gradeId', e.target.value)}>
            <option value="">بدون تحديد</option>
            {lists.grades.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </Select>
          <Select label="المجموعة" value={form.groupId} onChange={(e) => update('groupId', e.target.value)}>
            <option value="">بدون تحديد</option>
            {filteredGroups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </Select>
          <Input label="كلمة المرور" type="password" value={form.password} onChange={(e) => update('password', e.target.value)} dir="ltr" />
        </div>

        <ErrorNotice error={error} />
        {done ? <Notice tone="success">{done}</Notice> : null}
        <Button disabled={busy || !center} type="submit" className="block">{busy ? 'جاري التسجيل...' : 'تسجيل الطالب'}</Button>
      </form>
    </main>
  );
}
