'use client';

import { useEffect, useState } from 'react';
import { Button, Card, ErrorNotice, Input, Notice, PageHeader, Textarea } from '@/components/ui';
import { devFetchPublicConfig, devSavePublicConfig } from '@/lib/api';
import type { PublicConfig } from '@/lib/types';

export default function DeveloperAppInfoPage() {
  const [cfg, setCfg] = useState<PublicConfig>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => { devFetchPublicConfig().then(setCfg).catch(setError); }, []);
  const submit = async (e: React.FormEvent) => { e.preventDefault(); setBusy(true); setError(null); setMessage(null); try { await devSavePublicConfig(cfg); setMessage('تم حفظ بيانات حول التطبيق.'); } catch (err) { setError(err); } finally { setBusy(false); } };
  return <><PageHeader title="حول التطبيق" subtitle="محتوى عام يظهر في الويب والتطبيق." /><ErrorNotice error={error} />{message ? <Notice tone="success">{message}</Notice> : null}<Card className="stack"><form className="stack" onSubmit={submit}><Input label="عنوان حول التطبيق" value={cfg.about_title ?? ''} onChange={(e) => setCfg({ ...cfg, about_title: e.target.value })} /><Textarea label="وصف التطبيق" value={cfg.about_body ?? ''} onChange={(e) => setCfg({ ...cfg, about_body: e.target.value })} /><Input label="واتساب التواصل" value={cfg.contact_whatsapp ?? ''} onChange={(e) => setCfg({ ...cfg, contact_whatsapp: e.target.value })} dir="ltr" /><Input label="البريد" value={cfg.contact_email ?? ''} onChange={(e) => setCfg({ ...cfg, contact_email: e.target.value })} dir="ltr" /><Textarea label="رسالة عامة تظهر في الرئيسية" value={cfg.global_message ?? ''} onChange={(e) => setCfg({ ...cfg, global_message: e.target.value })} /><Button disabled={busy} type="submit">{busy ? 'جاري الحفظ...' : 'حفظ'}</Button></form></Card></>;
}
