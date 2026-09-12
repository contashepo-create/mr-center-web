'use client';

import { useEffect, useMemo, useState } from 'react';
import { Badge, Button, Card, EmptyState, ErrorNotice, Notice, PageHeader, Select, Textarea, formatStatus } from '@/components/ui';
import { useSession } from '@/context/session';
import { fetchInquiries, fetchStudents, replyInquiry } from '@/lib/api';
import { can } from '@/lib/rbac';
import type { AppInquiry, InquiryStatus, Student } from '@/lib/types';
import { formatDate } from '@/lib/utils';

export default function AdminInquiriesPage() {
  const { profile } = useSession();
  const centerId = profile?.center_id;
  const [status, setStatus] = useState('all');
  const [rows, setRows] = useState<AppInquiry[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [replyFor, setReplyFor] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');
  const [replyStatus, setReplyStatus] = useState<InquiryStatus>('answered');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [message, setMessage] = useState<string | null>(null);
  const studentsMap = useMemo(() => new Map(students.map((s) => [s.id, s.name])), [students]);

  const load = async () => {
    if (!centerId) return;
    setError(null);
    try { const [inq, st] = await Promise.all([fetchInquiries(centerId, status), fetchStudents(centerId)]); setRows(inq); setStudents(st); }
    catch (err) { setError(err); }
  };
  useEffect(() => { void load(); }, [centerId, status]);

  const submitReply = async (e: React.FormEvent) => {
    e.preventDefault(); if (!replyFor) return;
    setBusy(true); setError(null); setMessage(null);
    try { await replyInquiry(replyFor, replyText, replyStatus); setReplyFor(null); setReplyText(''); setMessage('تم الرد على الطلب.'); await load(); }
    catch (err) { setError(err); }
    finally { setBusy(false); }
  };

  if (profile && !can(profile, 'inquiries')) return <Card><Notice tone="error">ليس لديك صلاحية الرد على طلبات الطلاب.</Notice></Card>;

  return <>
    <PageHeader title="طلبات الطلاب" subtitle="متابعة استفسارات الطلاب والرد عليها." />
    <ErrorNotice error={error} />{message ? <Notice tone="success">{message}</Notice> : null}
    <Card className="stack" style={{ marginBottom: 18 }}><div className="row-between"><Select label="الحالة" value={status} onChange={(e) => setStatus(e.target.value)}><option value="all">الكل</option><option value="pending">معلق</option><option value="answered">تم الرد</option><option value="approved">مقبول</option><option value="rejected">مرفوض</option><option value="closed">مغلق</option></Select><Badge tone="info">{rows.length} طلب</Badge></div></Card>
    <div className="grid grid-2">
      <Card className="stack">
        <h2 className="h3">الطلبات</h2>
        {rows.length === 0 ? <EmptyState title="لا توجد طلبات" /> : rows.map((r) => { const st = formatStatus(r.status); return <div key={r.id} className="card compact soft stack"><div className="row-between"><div><strong>{r.subject}</strong><div className="tiny muted">{r.student_id ? studentsMap.get(r.student_id) ?? r.student_id : 'بدون طالب'} · {formatDate(r.created_at)}</div></div><Badge tone={st.tone}>{st.text}</Badge></div><p className="muted small" style={{ lineHeight: 1.8 }}>{r.body}</p>{r.reply ? <Notice tone="success">الرد: {r.reply}</Notice> : null}<Button type="button" variant="secondary" onClick={() => { setReplyFor(r.id); setReplyText(r.reply ?? ''); setReplyStatus(r.status === 'pending' ? 'answered' : r.status); }}>رد/تحديث</Button></div>; })}
      </Card>
      <Card className="stack">
        <h2 className="h3">الرد</h2>
        {!replyFor ? <Notice>اختر طلباً من القائمة للرد عليه.</Notice> : <form className="stack" onSubmit={submitReply}><Select label="حالة الطلب" value={replyStatus} onChange={(e) => setReplyStatus(e.target.value as InquiryStatus)}><option value="answered">تم الرد</option><option value="approved">قبول</option><option value="rejected">رفض</option><option value="closed">إغلاق</option><option value="pending">معلق</option></Select><Textarea label="نص الرد" value={replyText} onChange={(e) => setReplyText(e.target.value)} /><Button disabled={busy} type="submit">حفظ الرد</Button></form>}
      </Card>
    </div>
  </>;
}
