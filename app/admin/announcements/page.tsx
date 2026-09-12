'use client';

import { useEffect, useState } from 'react';
import { Badge, Button, Card, EmptyState, ErrorNotice, Input, Notice, PageHeader, Textarea } from '@/components/ui';
import { Modal } from '@/components/modal';
import { useToast } from '@/components/toast';
import { useSession } from '@/context/session';
import { deleteAnnouncement, fetchAnnouncements, upsertAnnouncement } from '@/lib/api';
import type { Announcement } from '@/lib/types';
import { can } from '@/lib/rbac';
import { formatDate } from '@/lib/utils';

const initial = { id: '', title: '', body: '', pinned: false };

export default function AnnouncementsPage() {
  const { profile } = useSession();
  const toast = useToast();
  const centerId = profile?.center_id;
  const [rows, setRows] = useState<Announcement[]>([]);
  const [form, setForm] = useState(initial);
  const [open, setOpen] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const load = async () => { if (!centerId) return; setError(null); try { setRows(await fetchAnnouncements(centerId)); } catch (err) { setError(err); } };
  useEffect(() => { void load(); }, [centerId]);

  const change = (patch: Partial<typeof form>) => { setForm((f) => ({ ...f, ...patch })); setDirty(true); };
  const addNew = () => { setForm(initial); setDirty(false); setError(null); setOpen(true); };
  const edit = (a: Announcement) => { setForm({ id: a.id, title: a.title, body: a.body, pinned: a.pinned }); setDirty(false); setError(null); setOpen(true); };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); if (!centerId) return;
    setBusy(true); setError(null);
    try { await upsertAnnouncement(centerId, { id: form.id || undefined, title: form.title, body: form.body, pinned: form.pinned }); toast.success('تم حفظ الإعلان', form.title); setForm(initial); setDirty(false); setOpen(false); await load(); }
    catch (err) { setError(err); }
    finally { setBusy(false); }
  };

  const remove = async (id: string) => { if (!confirm('حذف الإعلان؟')) return; try { await deleteAnnouncement(id); await load(); toast.success('تم حذف الإعلان'); } catch (err) { setError(err); } };

  if (profile && !can(profile, 'announcements')) {
    return <Card><Notice tone="error">ليس لديك صلاحية الإعلانات.</Notice></Card>;
  }

  return (
    <>
      <PageHeader title="الإعلانات" subtitle="إعلانات تظهر للطلاب في الويب والتطبيق." actions={<Button type="button" onClick={addNew}>+ إعلان جديد</Button>} />
      <ErrorNotice error={error} />
      <Card className="stack" style={{ marginBottom: 18 }}>
        <div className="row-between"><h2 className="h3">كل الإعلانات</h2><Badge tone="info">{rows.length}</Badge></div>
        {rows.length === 0 ? <EmptyState title="لا توجد إعلانات" /> : <div className="grid grid-2">
          {rows.map((a) => <div key={a.id} className="card compact soft stack">
            <div className="row-between"><strong>{a.title}</strong>{a.pinned ? <Badge tone="warn">مثبت</Badge> : null}</div>
            <p className="muted small" style={{ lineHeight: 1.8 }}>{a.body}</p>
            <div className="row-between"><span className="tiny muted">{formatDate(a.created_at)}</span><div className="row"><Button type="button" variant="secondary" onClick={() => edit(a)}>تعديل</Button><Button type="button" variant="danger" onClick={() => void remove(a.id)}>حذف</Button></div></div>
          </div>)}
        </div>}
      </Card>

      <Modal
        open={open}
        title={form.id ? 'تعديل إعلان' : 'إعلان جديد'}
        subtitle={form.title || ''}
        dirty={dirty}
        onClose={() => setOpen(false)}
        onSave={() => void submit({ preventDefault: () => {} } as React.FormEvent)}
        saveLabel={busy ? 'جاري الحفظ...' : 'حفظ الإعلان'}
        footer={<Button disabled={busy} type="submit" form="ann-form">{busy ? 'جاري الحفظ...' : 'حفظ الإعلان'}</Button>}
      >
        <form id="ann-form" className="stack" onSubmit={submit}>
          <Input label="العنوان" value={form.title} onChange={(e) => change({ title: e.target.value })} required />
          <Textarea label="نص الإعلان" value={form.body} onChange={(e) => change({ body: e.target.value })} required />
          <label className="row small muted"><input type="checkbox" checked={form.pinned} onChange={(e) => change({ pinned: e.target.checked })} /> إعلان مثبت (يظهر أولاً في التطبيق والويب)</label>
          <ErrorNotice error={error} />
        </form>
      </Modal>
    </>
  );
}
