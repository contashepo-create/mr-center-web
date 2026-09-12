'use client';

import { useEffect, useMemo, useState } from 'react';
import { Badge, Button, Card, EmptyState, ErrorNotice, Input, Notice, PageHeader, Select, Textarea } from '@/components/ui';
import { useSession } from '@/context/session';
import { deleteHonoree, deleteImportantLink, deleteSharedFile, fetchGroups, fetchHonorees, fetchImportantLinks, fetchSharedFiles, fetchStudents, type Honoree, type ImportantLink, type SharedFile, upsertHonoree, upsertImportantLink, upsertSharedFile } from '@/lib/api';
import { can } from '@/lib/rbac';
import type { Group, Student } from '@/lib/types';
import { formatDate, isValidHttpUrl } from '@/lib/utils';

export default function AdminLibraryPage() {
  const { profile } = useSession();
  const centerId = profile?.center_id;
  const [tab, setTab] = useState<'honors' | 'files' | 'links'>('honors');
  const [honors, setHonors] = useState<Honoree[]>([]);
  const [files, setFiles] = useState<SharedFile[]>([]);
  const [links, setLinks] = useState<ImportantLink[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [honorForm, setHonorForm] = useState({ id: '', name: '', details: '', student_id: '', group_id: '' });
  const [fileForm, setFileForm] = useState({ id: '', name: '', file_url: '' });
  const [linkForm, setLinkForm] = useState({ id: '', name: '', url: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [message, setMessage] = useState<string | null>(null);
  const studentName = useMemo(() => new Map(students.map((s) => [s.id, s.name])), [students]);
  const groupName = useMemo(() => new Map(groups.map((g) => [g.id, g.name])), [groups]);

  const load = async () => {
    if (!centerId) return;
    setError(null);
    try {
      const [h, f, l, s, g] = await Promise.all([fetchHonorees(centerId), fetchSharedFiles(centerId), fetchImportantLinks(centerId), fetchStudents(centerId), fetchGroups(centerId)]);
      setHonors(h); setFiles(f); setLinks(l); setStudents(s); setGroups(g);
    } catch (err) { setError(err); }
  };
  useEffect(() => { void load(); }, [centerId]);

  if (profile && !can(profile, 'honors')) return <Card><Notice tone="error">ليس لديك صلاحية المكتبة ولوحة الشرف.</Notice></Card>;

  const saveHonor = async (e: React.FormEvent) => { e.preventDefault(); if (!centerId) return; setBusy(true); setError(null); setMessage(null); try { await upsertHonoree(centerId, { id: honorForm.id || undefined, name: honorForm.name, details: honorForm.details, student_id: honorForm.student_id || null, group_id: honorForm.group_id || null }); setHonorForm({ id: '', name: '', details: '', student_id: '', group_id: '' }); setMessage('تم حفظ التكريم.'); await load(); } catch (err) { setError(err); } finally { setBusy(false); } };
  const saveFile = async (e: React.FormEvent) => { e.preventDefault(); if (!centerId) return; if (!isValidHttpUrl(fileForm.file_url)) return setError(new Error('رابط الملف غير صحيح')); setBusy(true); setError(null); setMessage(null); try { await upsertSharedFile(centerId, { id: fileForm.id || undefined, name: fileForm.name, file_url: fileForm.file_url }); setFileForm({ id: '', name: '', file_url: '' }); setMessage('تم حفظ الملف.'); await load(); } catch (err) { setError(err); } finally { setBusy(false); } };
  const saveLink = async (e: React.FormEvent) => { e.preventDefault(); if (!centerId) return; if (!isValidHttpUrl(linkForm.url)) return setError(new Error('الرابط غير صحيح')); setBusy(true); setError(null); setMessage(null); try { await upsertImportantLink(centerId, { id: linkForm.id || undefined, name: linkForm.name, url: linkForm.url }); setLinkForm({ id: '', name: '', url: '' }); setMessage('تم حفظ الرابط.'); await load(); } catch (err) { setError(err); } finally { setBusy(false); } };

  return <>
    <PageHeader title="المكتبة ولوحة الشرف" subtitle="تكريم الطلاب ومشاركة ملفات وروابط تظهر للطلاب." />
    <ErrorNotice error={error} />{message ? <Notice tone="success">{message}</Notice> : null}
    <div className="tabs" style={{ marginBottom: 18 }}><button className={`tab ${tab === 'honors' ? 'active' : ''}`} onClick={() => setTab('honors')}>لوحة الشرف</button><button className={`tab ${tab === 'files' ? 'active' : ''}`} onClick={() => setTab('files')}>الملفات</button><button className={`tab ${tab === 'links' ? 'active' : ''}`} onClick={() => setTab('links')}>الروابط</button></div>
    {tab === 'honors' ? <div className="grid grid-2"><Card className="stack"><h2 className="h3">تكريم جديد</h2><form className="stack" onSubmit={saveHonor}><Input label="الاسم/العنوان" value={honorForm.name} onChange={(e) => setHonorForm({ ...honorForm, name: e.target.value })} required /><Textarea label="التفاصيل" value={honorForm.details} onChange={(e) => setHonorForm({ ...honorForm, details: e.target.value })} /><Select label="طالب مرتبط" value={honorForm.student_id} onChange={(e) => setHonorForm({ ...honorForm, student_id: e.target.value })}><option value="">بدون</option>{students.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select><Select label="مجموعة" value={honorForm.group_id} onChange={(e) => setHonorForm({ ...honorForm, group_id: e.target.value })}><option value="">بدون</option>{groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</Select><Button disabled={busy} type="submit">حفظ</Button></form></Card><Card className="stack"><div className="row-between"><h2 className="h3">التكريمات</h2><Badge tone="info">{honors.length}</Badge></div>{honors.length === 0 ? <EmptyState title="لا توجد تكريمات" /> : honors.map((h) => <div key={h.id} className="card compact soft"><strong>{h.name}</strong><p className="muted small">{h.details}</p><div className="row-between"><span className="tiny muted">{h.student_id ? studentName.get(h.student_id) : ''} {h.group_id ? `· ${groupName.get(h.group_id)}` : ''} · {formatDate(h.created_at)}</span><Button type="button" variant="danger" onClick={async () => { await deleteHonoree(h.id); await load(); }}>حذف</Button></div></div>)}</Card></div> : null}
    {tab === 'files' ? <div className="grid grid-2"><Card className="stack"><h2 className="h3">ملف جديد</h2><form className="stack" onSubmit={saveFile}><Input label="اسم الملف" value={fileForm.name} onChange={(e) => setFileForm({ ...fileForm, name: e.target.value })} required /><Input label="رابط الملف" value={fileForm.file_url} onChange={(e) => setFileForm({ ...fileForm, file_url: e.target.value })} dir="ltr" required /><Button disabled={busy} type="submit">حفظ</Button></form></Card><Card className="stack">{files.length === 0 ? <EmptyState title="لا توجد ملفات" /> : files.map((f) => <div key={f.id} className="card compact soft"><a href={f.file_url ?? '#'} target="_blank"><strong>{f.name}</strong></a><div className="row-between"><span className="tiny muted">{formatDate(f.created_at)}</span><Button type="button" variant="danger" onClick={async () => { await deleteSharedFile(f.id); await load(); }}>حذف</Button></div></div>)}</Card></div> : null}
    {tab === 'links' ? <div className="grid grid-2"><Card className="stack"><h2 className="h3">رابط جديد</h2><form className="stack" onSubmit={saveLink}><Input label="اسم الرابط" value={linkForm.name} onChange={(e) => setLinkForm({ ...linkForm, name: e.target.value })} required /><Input label="URL" value={linkForm.url} onChange={(e) => setLinkForm({ ...linkForm, url: e.target.value })} dir="ltr" required /><Button disabled={busy} type="submit">حفظ</Button></form></Card><Card className="stack">{links.length === 0 ? <EmptyState title="لا توجد روابط" /> : links.map((l) => <div key={l.id} className="card compact soft"><a href={l.url ?? '#'} target="_blank"><strong>{l.name}</strong></a><div className="row-between"><span className="tiny muted">{formatDate(l.created_at)}</span><Button type="button" variant="danger" onClick={async () => { await deleteImportantLink(l.id); await load(); }}>حذف</Button></div></div>)}</Card></div> : null}
  </>;
}
