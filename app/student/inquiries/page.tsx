'use client';

import { useEffect, useState } from 'react';
import { Badge, Button, Card, EmptyState, ErrorNotice, Input, Notice, PageHeader, Select, Textarea, formatStatus } from '@/components/ui';
import { Modal } from '@/components/modal';
import { useToast } from '@/components/toast';
import { useSession } from '@/context/session';
import { addInquiry, fetchMyInquiries } from '@/lib/api';
import type { AppInquiry, InquiryKind } from '@/lib/types';
import { formatDate } from '@/lib/utils';

const initialForm = { kind: 'question' as InquiryKind, subject: '', body: '' };

export default function StudentInquiriesPage() {
  const { profile } = useSession();
  const toast = useToast();
  const [rows, setRows] = useState<AppInquiry[]>([]);
  const [form, setForm] = useState(initialForm);
  const [open, setOpen] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const load = async () => { if (profile?.student_id) try { setRows(await fetchMyInquiries(profile.student_id)); } catch (err) { setError(err); } };
  useEffect(() => { void load(); }, [profile?.student_id]);

  const openNew = () => { setForm(initialForm); setDirty(false); setError(null); setOpen(true); };
  const change = (patch: Partial<typeof form>) => { setForm((f) => ({ ...f, ...patch })); setDirty(true); };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); if (!profile?.center_id || !profile.student_id) return;
    setBusy(true); setError(null);
    try {
      await addInquiry({ centerId: profile.center_id, studentId: profile.student_id, kind: form.kind, subject: form.subject, body: form.body });
      toast.success('تم إرسال الطلب', 'وصل لإدارة السنتر وسيردون عليك في هذه الصفحة.');
      setDirty(false); setOpen(false); setForm(initialForm); await load();
    } catch (err) { setError(err); }
    finally { setBusy(false); }
  };

  return <>
    <PageHeader
      title="طلباتي واستفساراتي"
      subtitle="تواصل مع إدارة السنتر من الويب."
      actions={<Button type="button" onClick={openNew}>+ طلب جديد</Button>}
    />
    <ErrorNotice error={error} />
    <Card className="stack">
      <h2 className="h3">سجل الطلبات</h2>
      {rows.length === 0 ? <EmptyState title="لا توجد طلبات" /> : rows.map((r) => { const st = formatStatus(r.status); return <div key={r.id} className="card compact soft"><div className="row-between"><strong>{r.subject}</strong><Badge tone={st.tone}>{st.text}</Badge></div><p className="muted small">{r.body}</p>{r.reply ? <Notice tone="success">رد الإدارة: {r.reply}</Notice> : null}<span className="tiny muted">{formatDate(r.created_at)}</span></div>; })}
    </Card>

    <Modal
      open={open}
      title="طلب جديد"
      dirty={dirty}
      onClose={() => setOpen(false)}
      onSave={() => void submit({ preventDefault: () => {} } as React.FormEvent)}
      saveLabel={busy ? 'جاري الإرسال...' : 'إرسال'}
      footer={<Button disabled={busy} type="submit" form="inquiry-form">{busy ? 'جاري الإرسال...' : 'إرسال'}</Button>}
    >
      <form id="inquiry-form" className="stack" onSubmit={submit}>
        <Select label="النوع" value={form.kind} onChange={(e) => change({ kind: e.target.value as InquiryKind })}><option value="question">سؤال</option><option value="transfer">نقل مجموعة</option><option value="registration">تسجيل</option><option value="other">أخرى</option></Select>
        <Input label="الموضوع" value={form.subject} onChange={(e) => change({ subject: e.target.value })} required />
        <Textarea label="التفاصيل" value={form.body} onChange={(e) => change({ body: e.target.value })} required />
        <ErrorNotice error={error} />
      </form>
    </Modal>
  </>;
}
