'use client';

import { useEffect, useMemo, useState } from 'react';
import { Badge, Button, Card, EmptyState, ErrorNotice, Notice, PageHeader, Select, Textarea, formatStatus } from '@/components/ui';
import { Modal } from '@/components/modal';
import { useToast } from '@/components/toast';
import { useSession } from '@/context/session';
import { fetchGroups, fetchInquiries, fetchStudents, replyInquiry, resolveStudentTransfer } from '@/lib/api';
import { can } from '@/lib/rbac';
import type { AppInquiry, Group, InquiryStatus, Student } from '@/lib/types';
import { formatDate } from '@/lib/utils';

export default function AdminInquiriesPage() {
  const { profile } = useSession();
  const toast = useToast();
  const centerId = profile?.center_id;
  const [status, setStatus] = useState('all');
  const [rows, setRows] = useState<AppInquiry[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [replyFor, setReplyFor] = useState<AppInquiry | null>(null);
  const [replyText, setReplyText] = useState('');
  const [replyStatus, setReplyStatus] = useState<InquiryStatus>('answered');
  const [open, setOpen] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const studentsMap = useMemo(() => new Map(students.map((s) => [s.id, s.name])), [students]);
  const groupsMap = useMemo(() => new Map(groups.map((group) => [group.id, group.name])), [groups]);

  const load = async () => {
    if (!centerId) return;
    setError(null);
    try { const [inq, st, nextGroups] = await Promise.all([fetchInquiries(centerId, status), fetchStudents(centerId), fetchGroups(centerId)]); setRows(inq); setStudents(st); setGroups(nextGroups); }
    catch (err) { setError(err); }
  };
  useEffect(() => { void load(); }, [centerId, status]);

  const openReply = (r: AppInquiry) => {
    setReplyFor(r);
    setReplyText(r.reply ?? '');
    setReplyStatus(r.status === 'pending' ? 'answered' : r.status);
    setDirty(false); setError(null); setOpen(true);
  };

  const submitReply = async (e: React.FormEvent) => {
    e.preventDefault(); if (!replyFor) return;
    setBusy(true); setError(null);
    try {
      if (replyFor.kind === 'transfer' && replyFor.status === 'pending' && (replyStatus === 'approved' || replyStatus === 'rejected')) {
        await resolveStudentTransfer(replyFor.id, replyStatus, replyText);
        toast.success(replyStatus === 'approved' ? 'تمت الموافقة ونقل الطالب' : 'تم رفض طلب النقل', 'تم تحديث الطلب ووصل القرار للطالب.');
      } else {
        await replyInquiry(replyFor.id, replyText, replyStatus);
        toast.success('تم الرد على الطلب', 'وصل الرد للطالب في الويب والتطبيق.');
      }
      setDirty(false); setOpen(false); setReplyFor(null); setReplyText(''); await load();
    }
    catch (err) { setError(err); }
    finally { setBusy(false); }
  };

  if (profile && !can(profile, 'inquiries')) return <Card><Notice tone="error">ليس لديك صلاحية الرد على طلبات الطلاب.</Notice></Card>;

  return <>
    <PageHeader title="طلبات الطلاب" subtitle="متابعة استفسارات الطلاب والرد عليها." />
    <ErrorNotice error={error} />
    <Card className="stack" style={{ marginBottom: 18 }}><div className="row-between"><Select label="الحالة" value={status} onChange={(e) => setStatus(e.target.value)}><option value="all">الكل</option><option value="pending">معلق</option><option value="answered">تم الرد</option><option value="approved">مقبول</option><option value="rejected">مرفوض</option><option value="closed">مغلق</option></Select><Badge tone="info">{rows.length} طلب</Badge></div></Card>
    <Card className="stack">
      <h2 className="h3">الطلبات</h2>
      {rows.length === 0 ? <EmptyState title="لا توجد طلبات" /> : rows.map((r) => { const st = formatStatus(r.status); const isTransfer = r.kind === 'transfer'; return <div key={r.id} className={`card compact soft stack ${isTransfer ? 'transfer-request-card' : ''}`}><div className="row-between"><div><div className="row"><strong>{r.subject}</strong>{isTransfer ? <Badge tone="info">طلب نقل مجموعة</Badge> : null}</div><div className="tiny muted">{r.student_id ? studentsMap.get(r.student_id) ?? r.student_id : 'بدون طالب'} · {formatDate(r.created_at)}</div></div><Badge tone={st.tone}>{st.text}</Badge></div>{isTransfer ? <div className="transfer-request-route"><span>{groupsMap.get(r.from_group_id ?? '') ?? 'المجموعة الحالية'}</span><b>←</b><span>{groupsMap.get(r.to_group_id ?? '') ?? 'المجموعة المطلوبة'}</span></div> : null}{r.body ? <p className="muted small" style={{ lineHeight: 1.8 }}>{r.body}</p> : null}{r.reply ? <Notice tone={r.status === 'approved' ? 'success' : r.status === 'rejected' ? 'error' : 'info'}>الرد: {r.reply}</Notice> : null}<Button type="button" variant="secondary" onClick={() => openReply(r)}>{isTransfer && r.status === 'pending' ? 'مراجعة والموافقة على النقل' : 'رد/تحديث'}</Button></div>; })}
    </Card>

    <Modal
      open={open}
      title="الرد على الطلب"
      subtitle={replyFor?.subject}
      dirty={dirty}
      onClose={() => setOpen(false)}
      onSave={() => void submitReply({ preventDefault: () => {} } as React.FormEvent)}
      saveLabel={busy ? 'جاري الحفظ...' : 'حفظ الرد'}
      footer={<Button disabled={busy} type="submit" form="reply-form">{busy ? 'جاري الحفظ...' : 'حفظ الرد'}</Button>}
    >
      <form id="reply-form" className="stack" onSubmit={submitReply}>
        {replyFor?.body ? <Notice tone="info">نص الطلب: {replyFor.body}</Notice> : null}
        <Select label="حالة الطلب" value={replyStatus} onChange={(e) => { setReplyStatus(e.target.value as InquiryStatus); setDirty(true); }}><option value="answered">تم الرد</option><option value="approved">قبول</option><option value="rejected">رفض</option><option value="closed">إغلاق</option><option value="pending">معلق</option></Select>
        <Textarea label="نص الرد" value={replyText} onChange={(e) => { setReplyText(e.target.value); setDirty(true); }} />
        <ErrorNotice error={error} />
      </form>
    </Modal>
  </>;
}
