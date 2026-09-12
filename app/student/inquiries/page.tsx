'use client';

import { useEffect, useState } from 'react';
import { Badge, Button, Card, EmptyState, ErrorNotice, Input, Notice, PageHeader, Select, Textarea, formatStatus } from '@/components/ui';
import { useSession } from '@/context/session';
import { addInquiry, fetchMyInquiries } from '@/lib/api';
import type { AppInquiry, InquiryKind } from '@/lib/types';
import { formatDate } from '@/lib/utils';

export default function StudentInquiriesPage() {
  const { profile } = useSession();
  const [rows, setRows] = useState<AppInquiry[]>([]);
  const [form, setForm] = useState({ kind: 'question' as InquiryKind, subject: '', body: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [message, setMessage] = useState<string | null>(null);
  const load = async () => { if (profile?.student_id) try { setRows(await fetchMyInquiries(profile.student_id)); } catch (err) { setError(err); } };
  useEffect(() => { void load(); }, [profile?.student_id]);
  const submit = async (e: React.FormEvent) => { e.preventDefault(); if (!profile?.center_id || !profile.student_id) return; setBusy(true); setError(null); setMessage(null); try { await addInquiry({ centerId: profile.center_id, studentId: profile.student_id, kind: form.kind, subject: form.subject, body: form.body }); setForm({ kind: 'question', subject: '', body: '' }); setMessage('تم إرسال الطلب للإدارة.'); await load(); } catch (err) { setError(err); } finally { setBusy(false); } };
  return <><PageHeader title="طلباتي واستفساراتي" subtitle="تواصل مع إدارة السنتر من الويب." /><ErrorNotice error={error} />{message ? <Notice tone="success">{message}</Notice> : null}<div className="grid grid-2"><Card className="stack"><h2 className="h3">طلب جديد</h2><form className="stack" onSubmit={submit}><Select label="النوع" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as InquiryKind })}><option value="question">سؤال</option><option value="transfer">نقل مجموعة</option><option value="registration">تسجيل</option><option value="other">أخرى</option></Select><Input label="الموضوع" value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} required /><Textarea label="التفاصيل" value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} required /><Button disabled={busy} type="submit">إرسال</Button></form></Card><Card className="stack"><h2 className="h3">سجل الطلبات</h2>{rows.length === 0 ? <EmptyState title="لا توجد طلبات" /> : rows.map((r) => { const st = formatStatus(r.status); return <div key={r.id} className="card compact soft"><div className="row-between"><strong>{r.subject}</strong><Badge tone={st.tone}>{st.text}</Badge></div><p className="muted small">{r.body}</p>{r.reply ? <Notice tone="success">رد الإدارة: {r.reply}</Notice> : null}<span className="tiny muted">{formatDate(r.created_at)}</span></div>; })}</Card></div></>;
}
