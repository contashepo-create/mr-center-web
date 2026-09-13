'use client';

import { useEffect, useMemo, useState } from 'react';
import { Badge, Button, Card, EmptyState, ErrorNotice, Input, Notice, PageHeader, Select, Textarea, formatStatus } from '@/components/ui';
import { Modal } from '@/components/modal';
import { useToast } from '@/components/toast';
import { useSession } from '@/context/session';
import { addInquiry, fetchGrades, fetchGroups, fetchMyInquiries, fetchStudentById, fetchStudentGroups } from '@/lib/api';
import type { AppInquiry, Grade, Group, InquiryKind, Student } from '@/lib/types';
import { formatDate } from '@/lib/utils';

const initialForm = { kind: 'question' as InquiryKind, subject: '', body: '', fromGroupId: '', toGroupId: '' };

export default function StudentInquiriesPage() {
  const { profile } = useSession();
  const toast = useToast();
  const [rows, setRows] = useState<AppInquiry[]>([]);
  const [student, setStudent] = useState<Student | null>(null);
  const [groups, setGroups] = useState<Group[]>([]);
  const [grades, setGrades] = useState<Grade[]>([]);
  const [memberGroupIds, setMemberGroupIds] = useState<string[]>([]);
  const [form, setForm] = useState(initialForm);
  const [open, setOpen] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const groupName = useMemo(() => new Map(groups.map((group) => [group.id, group.name])), [groups]);
  const gradeName = useMemo(() => new Map(grades.map((grade) => [grade.id, grade.name])), [grades]);
  const groupMap = useMemo(() => new Map(groups.map((group) => [group.id, group])), [groups]);
  const currentMembershipIds = useMemo(() => [...new Set([student?.group_id, ...memberGroupIds].filter(Boolean) as string[])], [student?.group_id, memberGroupIds]);
  const sourceGroups = useMemo(() => groups.filter((group) => currentMembershipIds.includes(group.id)), [groups, currentMembershipIds]);
  const eligibleTargetGroups = useMemo(() => groups.filter((group) => group.grade_id === student?.grade_id && !currentMembershipIds.includes(group.id)), [groups, student?.grade_id, currentMembershipIds]);

  const load = async () => {
    if (!profile?.student_id || !profile.center_id) return;
    setError(null);
    try {
      const [requests, nextStudent, allGroups, allGrades, links] = await Promise.all([fetchMyInquiries(profile.student_id), fetchStudentById(profile.student_id), fetchGroups(profile.center_id), fetchGrades(profile.center_id), fetchStudentGroups(profile.student_id)]);
      setRows(requests); setStudent(nextStudent); setGroups(allGroups); setGrades(allGrades); setMemberGroupIds(links.map((row) => row.group_id));
    } catch (err) { setError(err); }
  };
  useEffect(() => { void load(); }, [profile?.student_id, profile?.center_id]);

  const openNew = () => { setForm({ ...initialForm, fromGroupId: student?.group_id || currentMembershipIds[0] || '' }); setDirty(false); setError(null); setOpen(true); };
  const change = (patch: Partial<typeof form>) => { setForm((current) => ({ ...current, ...patch })); setDirty(true); };
  const chooseKind = (kind: InquiryKind) => change({ kind, fromGroupId: kind === 'transfer' ? student?.group_id || currentMembershipIds[0] || '' : '', toGroupId: '' });

  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); if (!profile?.center_id || !profile.student_id) return;
    if (form.kind === 'transfer' && (!form.fromGroupId || !form.toGroupId)) return setError(new Error('اختر المجموعة الحالية والمجموعة المطلوبة.'));
    if (form.kind !== 'transfer' && (!form.subject.trim() || !form.body.trim())) return setError(new Error('اكتب الموضوع والتفاصيل.'));
    const source = groupMap.get(form.fromGroupId); const target = groupMap.get(form.toGroupId);
    setBusy(true); setError(null);
    try {
      await addInquiry({ centerId: profile.center_id, studentId: profile.student_id, kind: form.kind, subject: form.kind === 'transfer' ? `طلب انتقال: ${source?.name ?? 'مجموعة'} ← ${target?.name ?? 'مجموعة'}` : form.subject, body: form.body || (form.kind === 'transfer' ? 'طلب انتقال المجموعة من بوابة الطالب.' : ''), fromGroupId: form.kind === 'transfer' ? form.fromGroupId : null, toGroupId: form.kind === 'transfer' ? form.toGroupId : null });
      toast.success('تم إرسال الطلب', form.kind === 'transfer' ? 'سيظهر للإدارة بالمجموعة الحالية والوجهة، وتنتقل تلقائياً عند الموافقة.' : 'وصل لإدارة السنتر وسيردون عليك في هذه الصفحة.');
      setDirty(false); setOpen(false); setForm(initialForm); await load();
    } catch (err) { setError(err); } finally { setBusy(false); }
  };

  return <>
    <PageHeader title="طلباتي واستفساراتي" subtitle="تواصل مع إدارة السنتر أو اطلب الانتقال بين مجموعات صفك." actions={<Button type="button" onClick={openNew}>+ طلب جديد</Button>} />
    <ErrorNotice error={error} />
    <div className="grid grid-2"><Card className="student-transfer-guide stack"><div className="row-between"><div><h2 className="h3">طلب انتقال مجموعة</h2><p className="muted small">تظهر لك مجموعات صفك فقط. عند الموافقة تنتقل مجموعتك الأساسية تلقائياً ويُسجل القرار في طلبك.</p></div><span className="transfer-guide-icon">↔</span></div><div className="row"><Badge tone="info">صفك: {student ? gradeName.get(student.grade_id ?? '') ?? 'غير محدد' : 'جارٍ التحميل'}</Badge><Badge tone="default">{eligibleTargetGroups.length} مجموعات متاحة للنقل</Badge></div><Button type="button" variant="secondary" disabled={!sourceGroups.length || !eligibleTargetGroups.length} onClick={() => { openNew(); setForm((current) => ({ ...current, kind: 'transfer' })); }}>طلب انتقال الآن</Button></Card><Card className="stack"><h2 className="h3">مجموعاتي ومدرسوها</h2>{sourceGroups.length ? sourceGroups.map((group) => <div className="transfer-group-info" key={group.id}><span>◈</span><div><strong>{group.name}{group.id === student?.group_id ? ' · أساسية' : ''}</strong><p>المدرس: {group.teacher_name || 'لم يُحدد بعد'}{group.teacher_phone ? <span dir="ltr"> · {group.teacher_phone}</span> : ''}</p></div></div>) : <EmptyState title="لا توجد مجموعة مسندة" />}</Card></div>
    <Card className="stack" style={{ marginTop: 18 }}><div className="row-between"><h2 className="h3">سجل الطلبات</h2><Badge tone="info">{rows.length} طلب</Badge></div>{rows.length === 0 ? <EmptyState title="لا توجد طلبات" /> : rows.map((row) => { const status = formatStatus(row.status); const isTransfer = row.kind === 'transfer'; return <article key={row.id} className="student-inquiry-row"><div className="inquiry-kind-icon">{isTransfer ? '↔' : '?'}</div><div className="inquiry-main"><div className="row"><strong>{row.subject || (isTransfer ? 'طلب انتقال مجموعة' : 'طلب')}</strong><Badge tone={status.tone}>{status.text}</Badge></div>{isTransfer ? <p>من: <b>{groupName.get(row.from_group_id ?? '') ?? '—'}</b> ← إلى: <b>{groupName.get(row.to_group_id ?? '') ?? '—'}</b></p> : <p>{row.body}</p>}{row.reply ? <Notice tone={row.status === 'approved' ? 'success' : row.status === 'rejected' ? 'error' : 'info'}>رد الإدارة: {row.reply}</Notice> : null}</div><time>{formatDate(row.created_at)}</time></article>; })}</Card>

    <Modal open={open} title={form.kind === 'transfer' ? 'طلب انتقال إلى مجموعة' : 'طلب جديد'} subtitle={form.kind === 'transfer' ? 'تظهر لك فقط المجموعات التابعة لصفك وغير المسندة إليك حالياً.' : 'أرسل استفسارك أو طلبك إلى إدارة السنتر.'} dirty={dirty} onClose={() => setOpen(false)} onSave={() => void submit({ preventDefault: () => undefined } as React.FormEvent)} saveLabel={busy ? 'جاري الإرسال...' : 'إرسال الطلب'} footer={<Button disabled={busy} type="submit" form="inquiry-form">{busy ? 'جاري الإرسال...' : 'إرسال الطلب'}</Button>}>
      <form id="inquiry-form" className="stack" onSubmit={submit}><Select label="نوع الطلب" value={form.kind} onChange={(event) => chooseKind(event.target.value as InquiryKind)}><option value="question">سؤال أو استفسار</option><option value="transfer">نقل مجموعة</option><option value="registration">طلب تسجيل</option><option value="other">أخرى</option></Select>{form.kind === 'transfer' ? <><Notice tone="info">لن تظهر أي مجموعة من صف آخر، ولا يمكن إرسال الطلب إلى مجموعة من مجموعاتك الحالية.</Notice><div className="grid grid-2"><Select label="المجموعة الحالية" value={form.fromGroupId} onChange={(event) => change({ fromGroupId: event.target.value })}><option value="">اختر المجموعة</option>{sourceGroups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</Select><Select label="المجموعة المطلوبة" value={form.toGroupId} onChange={(event) => change({ toGroupId: event.target.value })}><option value="">اختر من مجموعات صفك</option>{eligibleTargetGroups.map((group) => <option key={group.id} value={group.id}>{group.name}{group.teacher_name ? ` — ${group.teacher_name}` : ''}{group.start_time ? ` (${group.start_time})` : ''}</option>)}</Select></div>{form.toGroupId ? <Notice tone="success">المدرس: {groupMap.get(form.toGroupId)?.teacher_name || 'لم يُحدد بعد'}{groupMap.get(form.toGroupId)?.teacher_phone ? <span dir="ltr"> · {groupMap.get(form.toGroupId)?.teacher_phone}</span> : ''}</Notice> : null}<Textarea label="سبب أو ملاحظة للإدارة (اختياري)" value={form.body} onChange={(event) => change({ body: event.target.value })} placeholder="مثال: الوقت المناسب للمجموعة الأخرى" /></> : <><Input label="الموضوع" value={form.subject} onChange={(event) => change({ subject: event.target.value })} required /><Textarea label="التفاصيل" value={form.body} onChange={(event) => change({ body: event.target.value })} required /></>}<ErrorNotice error={error} /></form>
    </Modal>
  </>;
}
