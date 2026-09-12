'use client';

// قسم الشكاوي العام — يعمل للزوار والمسجلين على حد سواء.
// محمي بحد محاولات خادمي (3 لكل هاتف في الساعة) وآمن من الحقن
// (كل النصوص تمر كمعاملات ولا تُفسَّر كاستعلام)، ويُتتبع الشكوى
// برقم الهاتف ورقم الشكوى مع تذكير بالاحتفاظ بالرقم.

import { useMemo, useState } from 'react';
import { Button, Card, ErrorNotice, Input, Notice, Select, Textarea } from './ui';
import { lookupComplaint, submitComplaint, type ComplaintLookup } from '@/lib/complaints';
import { isValidPhone, normalizePhone } from '@/lib/utils';

const SUBJECTS = ['مشكلة تقنية', 'اقتراح تحسين', 'شكوى من خدمة', 'استفسار عام', 'أخرى'];

export function ComplaintsSection({ ready }: { ready: boolean }) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [subject, setSubject] = useState(SUBJECTS[0]);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [ticket, setTicket] = useState<string | null>(null);

  // التتبع
  const [trackPhone, setTrackPhone] = useState('');
  const [trackTicket, setTrackTicket] = useState('');
  const [trackBusy, setTrackBusy] = useState(false);
  const [trackError, setTrackError] = useState<unknown>(null);
  const [trackResult, setTrackResult] = useState<ComplaintLookup | null>(null);

  const bodyLen = body.length;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setTicket(null);
    if (!isValidPhone(phone)) return setError(new Error('أدخل رقم هاتف صحيحاً (8 إلى 15 رقماً) لتتمكن من تتبع شكواك.'));
    if (!body.trim()) return setError(new Error('اكتب نص الشكوى أو الاقتراح أولاً.'));
    setBusy(true);
    try {
      const no = await submitComplaint({ phone: normalizePhone(phone), name, subject, body });
      setTicket(no);
      setBody('');
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const track = async (e: React.FormEvent) => {
    e.preventDefault();
    setTrackError(null);
    setTrackResult(null);
    if (!isValidPhone(trackPhone)) return setTrackError(new Error('أدخل رقم الهاتف المسجل في الشكوى.'));
    if (!trackTicket.trim()) return setTrackError(new Error('أدخل رقم الشكوى.'));
    setTrackBusy(true);
    try {
      setTrackResult(await lookupComplaint(trackPhone, trackTicket));
    } catch (err) {
      setTrackError(err);
    } finally {
      setTrackBusy(false);
    }
  };

  const statusLabel = useMemo(() => (s: string | undefined) => {
    if (s === 'open') return { text: 'قيد المراجعة', tone: 'warn' as const };
    if (s === 'in_progress') return { text: 'جارٍ المعالجة', tone: 'info' as const };
    if (s === 'closed') return { text: 'تمت المعالجة', tone: 'success' as const };
    return { text: s ?? '—', tone: 'default' as const };
  }, []);

  return (
    <Card className="stack-lg" id="complaints">
      <div>
        <h2 className="h2">إدارة الشكاوي والاقتراحات</h2>
        <p className="muted" style={{ lineHeight: 1.9 }}>
          واجهت مشكلة أو لديك اقتراح؟ أرسله لنا من هنا — متاح للجميع حتى بلا تسجيل.
          بعد الإرسال ستحصل على <b>رقم شكوى</b>: احتفظ به جيداً لأنه مرجعك الوحيد
          لمتابعة حالتها معنا لاحقاً برقم هاتفك.
        </p>
      </div>

      <div className="grid grid-2">
        <form className="stack" onSubmit={submit}>
          <div className="grid grid-2">
            <Input label="الاسم (اختياري)" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
            <Input label="رقم الهاتف للتتبع" value={phone} onChange={(e) => setPhone(e.target.value)} dir="ltr" placeholder="01xxxxxxxxx" inputMode="tel" required />
          </div>
          <Select label="الموضوع" value={subject} onChange={(e) => setSubject(e.target.value)}>
            {SUBJECTS.map((s) => <option key={s} value={s}>{s}</option>)}
          </Select>
          <Textarea label="نص الشكوى أو الاقتراح" value={body} onChange={(e) => setBody(e.target.value.slice(0, 2000))} rows={5} placeholder="اشرح المشكلة أو الاقتراح بوضوح..." />
          <div className="tiny muted" style={{ textAlign: 'left' }}>{bodyLen} / 2000</div>
          <ErrorNotice error={error} />
          <Button type="submit" disabled={!ready || busy}>{busy ? 'جارٍ الإرسال...' : 'إرسال الشكوى'}</Button>
          {!ready ? <p className="tiny muted">الاتصال بالخدمة غير متاح حالياً — حاول لاحقاً.</p> : null}
          {ticket ? (
            <Notice tone="success">
              تم استلام شكواك بنجاح. <b>رقم الشكوى:</b>{' '}
              <b dir="ltr" style={{ fontSize: '1.1rem' }}>{ticket}</b>
              <br />
              ⚠️ <b>احتفظ بهذا الرقم</b> — استخدمه مع رقم هاتفك لمتابعة حالة الشكوى من أي وقت.
            </Notice>
          ) : null}
        </form>

        <Card className="soft stack">
          <div>
            <h3 className="h3">تتبع شكواك</h3>
            <p className="muted small">أدخل رقم الهاتف ورقم الشكوى لمعرفة حالتها الحالية.</p>
          </div>
          <form className="stack" onSubmit={track}>
            <Input label="رقم الهاتف" value={trackPhone} onChange={(e) => setTrackPhone(e.target.value)} dir="ltr" inputMode="tel" />
            <Input label="رقم الشكوى" value={trackTicket} onChange={(e) => setTrackTicket(e.target.value)} dir="ltr" placeholder="MR-26-000000" />
            <ErrorNotice error={trackError} />
            <Button type="submit" variant="secondary" disabled={!ready || trackBusy}>{trackBusy ? 'جارٍ البحث...' : 'عرض الحالة'}</Button>
          </form>
          {trackResult ? (
            trackResult.found ? (
              <Notice tone="info">
                <div className="row-between">
                  <span>رقم الشكوى: <b dir="ltr">{trackResult.ticket_no}</b></span>
                  <span className="badge">{statusLabel(trackResult.status).text}</span>
                </div>
                <div className="tiny muted" style={{ marginTop: 6 }}>
                  الموضوع: {trackResult.subject} · أُرسلت {trackResult.created_at ? new Date(trackResult.created_at).toLocaleDateString('ar-EG') : ''}
                </div>
              </Notice>
            ) : (
              <Notice tone="warn">لم نعثر على شكوى مطابقة لهذا الرقم والهاتف — تأكد من البيانات وأعد المحاولة.</Notice>
            )
          ) : null}
        </Card>
      </div>
    </Card>
  );
}
