'use client';

import { useEffect, useMemo, useState } from 'react';
import { Badge, Button, Card, EmptyState, ErrorNotice, Input, Notice, PageHeader, Select, Textarea } from '@/components/ui';
import { Modal } from '@/components/modal';
import { useToast } from '@/components/toast';
import { useSession } from '@/context/session';
import { deleteNotification, fetchGrades, fetchGroups, fetchNotificationReadCounts, fetchNotifications, fetchStudents, sendNotification } from '@/lib/api';
import { can, isOwner } from '@/lib/rbac';
import { useTeacherGroupIds } from '@/lib/staff';
import type { AppNotification, Grade, Group, NotificationAudience, Student } from '@/lib/types';
import { formatDate } from '@/lib/utils';

const initialForm = { audience: 'all' as NotificationAudience, audienceId: '', title: '', body: '' };

export default function AdminNotificationsPage() {
  const { profile } = useSession();
  const toast = useToast();
  const centerId = profile?.center_id;
  const [rows, setRows] = useState<AppNotification[]>([]);
  const [readCounts, setReadCounts] = useState<Map<string, number>>(new Map());
  const [grades, setGrades] = useState<Grade[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [form, setForm] = useState(initialForm);
  const [open, setOpen] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const teacherScope = useTeacherGroupIds();
  const visibleGroups = useMemo(() => {
    if (profile?.role !== 'teacher') return groups;
    if (!teacherScope) return [];
    return groups.filter((g) => teacherScope.includes(g.id));
  }, [groups, profile?.role, teacherScope]);
  const visibleGroupIds = useMemo(() => new Set(visibleGroups.map((g) => g.id)), [visibleGroups]);
  const scopedStudents = useMemo(() => profile?.role === 'teacher' ? students.filter((s) => !!s.group_id && visibleGroupIds.has(s.group_id)) : students, [students, profile?.role, visibleGroupIds]);

  const audienceOptions = useMemo(() => {
    if (form.audience === 'grade') return grades.map((g) => ({ id: g.id, label: g.name }));
    if (form.audience === 'group') return visibleGroups.map((g) => ({ id: g.id, label: g.name }));
    if (form.audience === 'student') return scopedStudents.map((s) => ({ id: s.id, label: s.name }));
    return [];
  }, [form.audience, grades, visibleGroups, scopedStudents]);

  const load = async () => {
    if (!centerId) return;
    setError(null);
    try {
      const [n, gr, gp, st] = await Promise.all([fetchNotifications(centerId), fetchGrades(centerId), fetchGroups(centerId), fetchStudents(centerId)]);
      setRows(n); setGrades(gr); setGroups(gp); setStudents(st); setReadCounts(await fetchNotificationReadCounts(n.map((x) => x.id)));
    } catch (err) { setError(err); }
  };
  useEffect(() => { void load(); }, [centerId]);

  const change = (patch: Partial<typeof form>) => { setForm((f) => ({ ...f, ...patch })); setDirty(true); };
  const openCompose = () => { setForm(initialForm); setDirty(false); setError(null); setOpen(true); };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); if (!centerId) return;
    setBusy(true); setError(null);
    try {
      await sendNotification({ centerId, audience: form.audience, audienceId: form.audienceId || null, title: form.title, body: form.body });
      toast.success('تم إرسال الإشعار', 'وصل للجمهور المحدد فوراً.');
      setDirty(false); setOpen(false); setForm(initialForm); await load();
    }
    catch (err) { setError(err); }
    finally { setBusy(false); }
  };
  const remove = async (id: string) => { if (!confirm('حذف الإشعار؟')) return; try { await deleteNotification(id); await load(); toast.success('تم حذف الإشعار'); } catch (err) { setError(err); } };

  if (profile && !can(profile, 'notify')) return <Card><Notice tone="error">ليس لديك صلاحية بث الإشعارات.</Notice></Card>;

  return <>
    <PageHeader
      title="الإشعارات"
      subtitle="إرسال إشعارات داخلية للطلاب أو أصحاب السنتر."
      actions={<Button type="button" onClick={openCompose}>+ إشعار جديد</Button>}
    />
    <ErrorNotice error={error} />
    <Card className="stack">
      <div className="row-between"><h2 className="h3">سجل الإشعارات</h2><Badge tone="info">{rows.length}</Badge></div>
      {rows.length === 0 ? <EmptyState title="لا توجد إشعارات" /> : rows.map((n) => <div key={n.id} className="card compact soft stack"><div className="row-between"><strong>{n.title}</strong><Badge tone="info">{n.audience}</Badge></div><p className="muted small" style={{ lineHeight: 1.8 }}>{n.body}</p><div className="row-between"><span className="tiny muted">{formatDate(n.created_at)} · قرأها {readCounts.get(n.id) ?? 0}</span><Button type="button" variant="danger" onClick={() => void remove(n.id)}>حذف</Button></div></div>)}
    </Card>

    <Modal
      open={open}
      title="إشعار جديد"
      dirty={dirty}
      onClose={() => setOpen(false)}
      onSave={() => void submit({ preventDefault: () => {} } as React.FormEvent)}
      saveLabel={busy ? 'جاري الإرسال...' : 'إرسال'}
      footer={<Button disabled={busy || !form.title.trim() || !form.body.trim()} type="submit" form="notify-form">{busy ? 'جاري الإرسال...' : 'إرسال'}</Button>}
    >
      <form id="notify-form" className="stack" onSubmit={submit}>
        <Select label="الجمهور" value={form.audience} onChange={(e) => change({ audience: e.target.value as NotificationAudience, audienceId: '' })}><option value="all">كل الطلاب</option><option value="grade">صف محدد</option><option value="group">مجموعة محددة</option><option value="student">طالب محدد</option>{isOwner(profile) ? <option value="owners">صاحب السنتر / الإدارة</option> : null}</Select>
        {audienceOptions.length > 0 ? <Select label="اختيار الجمهور" value={form.audienceId} onChange={(e) => change({ audienceId: e.target.value })}><option value="">اختر</option>{audienceOptions.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</Select> : null}
        <Input label="العنوان" value={form.title} onChange={(e) => change({ title: e.target.value })} required />
        <Textarea label="الرسالة" value={form.body} onChange={(e) => change({ body: e.target.value })} required />
        <ErrorNotice error={error} />
      </form>
    </Modal>
  </>;
}
