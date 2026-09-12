'use client';

import { useEffect, useState } from 'react';
import { Badge, Button, Card, EmptyState, ErrorNotice, Input, Notice, PageHeader, Textarea } from '@/components/ui';
import { useSession } from '@/context/session';
import { deleteAnnouncement, fetchAnnouncements, upsertAnnouncement } from '@/lib/api';
import type { Announcement } from '@/lib/types';
import { can } from '@/lib/rbac';
import { formatDate } from '@/lib/utils';

const initial = { id: '', title: '', body: '', pinned: false };

export default function AnnouncementsPage() {
  const { profile } = useSession();
  const centerId = profile?.center_id;
  const [rows, setRows] = useState<Announcement[]>([]);
  const [form, setForm] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = async () => { if (!centerId) return; setError(null); try { setRows(await fetchAnnouncements(centerId)); } catch (err) { setError(err); } };
  useEffect(() => { void load(); }, [centerId]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); if (!centerId) return;
    setBusy(true); setError(null); setMessage(null);
    try { await upsertAnnouncement(centerId, { id: form.id || undefined, title: form.title, body: form.body, pinned: form.pinned }); setForm(initial); setMessage('تم حفظ الإعلان.'); await load(); }
    catch (err) { setError(err); }
    finally { setBusy(false); }
  };

  const remove = async (id: string) => { if (!confirm('حذف الإعلان؟')) return; try { await deleteAnnouncement(id); await load(); } catch (err) { setError(err); } };

  if (profile && !can(profile, 'announcements')) {
    return <Card><Notice tone="error">ليس لديك صلاحية الإعلانات.</Notice></Card>;
  }

  return (
    <>
      <PageHeader title="الإعلانات" subtitle="إعلانات تظهر للطلاب في الويب والتطبيق." />
      <ErrorNotice error={error} />
      {message ? <Notice tone="success">{message}</Notice> : null}
      <div className="grid grid-2">
        <Card className="stack">
          <h2 className="h3">{form.id ? 'تعديل إعلان' : 'إعلان جديد'}</h2>
          <form className="stack" onSubmit={submit}>
            <Input label="العنوان" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required />
            <Textarea label="نص الإعلان" value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} required />
            <label className="row small muted"><input type="checkbox" checked={form.pinned} onChange={(e) => setForm({ ...form, pinned: e.target.checked })} /> إعلان مثبت</label>
            <div className="row"><Button disabled={busy} type="submit">حفظ</Button>{form.id ? <Button type="button" variant="secondary" onClick={() => setForm(initial)}>إلغاء</Button> : null}</div>
          </form>
        </Card>
        <Card className="stack"><h2 className="h3">ملاحظات</h2><div className="notice">الإعلان المثبت يظهر أولاً في التطبيق والويب. استخدمه للتنبيهات المهمة.</div></Card>
      </div>
      <Card className="stack" style={{ marginTop: 18 }}>
        <div className="row-between"><h2 className="h3">كل الإعلانات</h2><Badge tone="info">{rows.length}</Badge></div>
        {rows.length === 0 ? <EmptyState title="لا توجد إعلانات" /> : <div className="grid grid-2">
          {rows.map((a) => <div key={a.id} className="card compact soft stack">
            <div className="row-between"><strong>{a.title}</strong>{a.pinned ? <Badge tone="warn">مثبت</Badge> : null}</div>
            <p className="muted small" style={{ lineHeight: 1.8 }}>{a.body}</p>
            <div className="row-between"><span className="tiny muted">{formatDate(a.created_at)}</span><div className="row"><Button type="button" variant="secondary" onClick={() => setForm({ id: a.id, title: a.title, body: a.body, pinned: a.pinned })}>تعديل</Button><Button type="button" variant="danger" onClick={() => void remove(a.id)}>حذف</Button></div></div>
          </div>)}
        </div>}
      </Card>
    </>
  );
}
