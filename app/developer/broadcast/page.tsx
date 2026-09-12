'use client';

import { useEffect, useState } from 'react';
import { Button, Card, ErrorNotice, Input, Notice, PageHeader, Select, Textarea } from '@/components/ui';
import { devFetchCenters, sendNotification, type CenterWithSub } from '@/lib/api';
import type { NotificationAudience } from '@/lib/types';

export default function DeveloperBroadcastPage() {
  const [centers, setCenters] = useState<CenterWithSub[]>([]);
  const [form, setForm] = useState({ centerId: '', audience: 'owners' as NotificationAudience, title: '', body: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => { devFetchCenters().then((c) => { setCenters(c); if (c[0]) setForm((f) => ({ ...f, centerId: c[0].id })); }).catch(setError); }, []);
  const submit = async (e: React.FormEvent) => { e.preventDefault(); setBusy(true); setError(null); setMessage(null); try { await sendNotification({ centerId: form.centerId, audience: form.audience, title: form.title, body: form.body }); setForm({ ...form, title: '', body: '' }); setMessage('تم إرسال الإشعار.'); } catch (err) { setError(err); } finally { setBusy(false); } };
  return <><PageHeader title="بث وإشعارات" subtitle="إرسال إشعار لسنتر محدد أو لأصحابه عبر قناة owners." /><ErrorNotice error={error} />{message ? <Notice tone="success">{message}</Notice> : null}<Card className="stack"><form className="stack" onSubmit={submit}><Select label="السنتر" value={form.centerId} onChange={(e) => setForm({ ...form, centerId: e.target.value })}>{centers.map((c) => <option key={c.id} value={c.id}>{c.name} — {c.code}</option>)}</Select><Select label="الجمهور" value={form.audience} onChange={(e) => setForm({ ...form, audience: e.target.value as NotificationAudience })}><option value="owners">صاحب السنتر</option><option value="all">كل الطلاب</option></Select><Input label="العنوان" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required /><Textarea label="نص الرسالة" value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} required /><Button disabled={busy || !form.centerId} type="submit">إرسال</Button></form></Card></>;
}
