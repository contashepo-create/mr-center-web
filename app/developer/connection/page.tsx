'use client';

import { useState } from 'react';
import { Button, Card, ErrorNotice, Input, Notice, PageHeader } from '@/components/ui';
import { useSession } from '@/context/session';
import { clearOverrideConfig, getActiveConfig, saveOverrideConfig } from '@/lib/supabase';

export default function DeveloperConnectionPage() {
  const { reinitConnection } = useSession();
  const active = getActiveConfig();
  const [url, setUrl] = useState(active?.url ?? '');
  const [key, setKey] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [message, setMessage] = useState<string | null>(null);
  const save = async (e: React.FormEvent) => { e.preventDefault(); setError(null); setMessage(null); try { await saveOverrideConfig(url, key); await reinitConnection(); setMessage('تم تغيير الاتصال لهذا المتصفح. سجّل الدخول مرة أخرى إذا لزم.'); } catch (err) { setError(err); } };
  const clear = async () => { setError(null); setMessage(null); try { await clearOverrideConfig(); await reinitConnection(); setMessage('تم حذف الاتصال اليدوي والرجوع للبيئة/كلاود فلير.'); } catch (err) { setError(err); } };
  return <><PageHeader title="إعدادات الاتصال" subtitle="عرض أو تغيير اتصال Supabase محلياً في هذا المتصفح فقط." /><ErrorNotice error={error} />{message ? <Notice tone="success">{message}</Notice> : null}<div className="grid grid-2"><Card className="stack"><h2 className="h3">الاتصال الحالي</h2><p className="muted">المصدر: <b>{active?.source ?? 'غير مضبوط'}</b></p><p className="muted" dir="ltr">{active?.url ?? '—'}</p><Notice>على Vercel الأفضل استخدام Environment Variables. التغيير اليدوي هنا للتجارب فقط.</Notice></Card><Card className="stack"><h2 className="h3">تغيير مؤقت</h2><form className="stack" onSubmit={save}><Input label="Supabase URL" value={url} onChange={(e) => setUrl(e.target.value)} dir="ltr" /><Input label="Anon Key" value={key} onChange={(e) => setKey(e.target.value)} dir="ltr" /><Button type="submit">تطبيق الاتصال</Button><Button type="button" variant="secondary" onClick={clear}>حذف الاتصال اليدوي</Button></form></Card></div></>;
}
