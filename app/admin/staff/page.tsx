'use client';

import { useEffect, useMemo, useState } from 'react';
import { Badge, Button, Card, EmptyState, ErrorNotice, Notice, PageHeader } from '@/components/ui';
import { useSession } from '@/context/session';
import { assignTeacherGroups, deleteTeacher, fetchGroups, fetchStaff, fetchTeacherGroups, setTeacherActive, setTeacherPerms } from '@/lib/api';
import { isOwner, roleLabel, TEACHER_PERMS } from '@/lib/rbac';
import type { Group, Profile, TeacherPerms } from '@/lib/types';

export default function StaffPage() {
  const { profile } = useSession();
  const centerId = profile?.center_id;
  const [staff, setStaff] = useState<Profile[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [selected, setSelected] = useState<Profile | null>(null);
  const [selectedGroups, setSelectedGroups] = useState<string[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [message, setMessage] = useState<string | null>(null);
  const groupName = useMemo(() => new Map(groups.map((g) => [g.id, g.name])), [groups]);

  const load = async () => {
    if (!centerId) return;
    setError(null);
    try { const [s, g] = await Promise.all([fetchStaff(centerId), fetchGroups(centerId)]); setStaff(s); setGroups(g); }
    catch (err) { setError(err); }
  };
  useEffect(() => { void load(); }, [centerId]);

  if (!isOwner(profile)) {
    return <Card><Notice tone="error">إدارة فريق العمل متاحة لصاحب السنتر فقط.</Notice></Card>;
  }

  const open = async (p: Profile) => {
    setSelected(p);
    try { setSelectedGroups((await fetchTeacherGroups(p.id)).map((x) => x.group_id)); }
    catch { setSelectedGroups([]); }
  };

  const togglePerm = async (p: Profile, key: keyof TeacherPerms) => {
    const next = { ...(p.perms ?? {}), [key]: !(p.perms ?? {})[key] } as TeacherPerms;
    setError(null);
    try { await setTeacherPerms(p.id, next); await load(); setMessage('تم تحديث الصلاحيات.'); }
    catch (err) { setError(err); }
  };

  const toggleActive = async (p: Profile) => {
    setError(null);
    try { await setTeacherActive(p.id, !p.is_active); await load(); }
    catch (err) { setError(err); }
  };

  const saveGroups = async () => {
    if (!centerId || !selected) return;
    setError(null);
    try { await assignTeacherGroups(centerId, selected.id, selectedGroups); setMessage('تم حفظ مجموعات الفريق.'); }
    catch (err) { setError(err); }
  };

  const remove = async (id: string) => { if (!confirm('حذف عضو الفريق؟')) return; try { await deleteTeacher(id); await load(); } catch (err) { setError(err); } };

  return (
    <>
      <PageHeader title="فريق العمل" subtitle="تفعيل حسابات الفريق وتحديد صلاحياتهم ومجموعاتهم." />
      <ErrorNotice error={error} />
      {message ? <Notice tone="success">{message}</Notice> : null}
      <div className="grid grid-2">
        <Card className="stack">
          <div className="row-between"><h2 className="h3">الأعضاء</h2><Badge tone="info">{staff.length}</Badge></div>
          {staff.length === 0 ? <EmptyState title="لا يوجد فريق" body="يرسل المدرس/السكرتير طلب انضمام بكود السنتر ثم يظهر هنا." /> : <div className="stack">
            {staff.map((p) => <div key={p.id} className="card compact soft stack">
              <div className="row-between"><div><strong>{p.full_name}</strong><div className="tiny muted">{roleLabel(p.role)} · {p.email}</div></div><Badge tone={p.is_active ? 'success' : 'warn'}>{p.is_active ? 'مفعل' : 'خامل'}</Badge></div>
              <div className="row"><Button variant="secondary" type="button" onClick={() => void toggleActive(p)}>{p.is_active ? 'إيقاف' : 'تفعيل'}</Button><Button variant="secondary" type="button" onClick={() => void open(p)}>المجموعات</Button><Button variant="danger" type="button" onClick={() => void remove(p.id)}>حذف</Button></div>
              <div className="row">
                {TEACHER_PERMS.map((perm) => <button key={perm.key} className={`tab ${(p.perms ?? {})[perm.key] ? 'active' : ''}`} type="button" onClick={() => void togglePerm(p, perm.key)}>{perm.label}</button>)}
              </div>
            </div>)}
          </div>}
        </Card>

        <Card className="stack">
          <h2 className="h3">مجموعات العضو</h2>
          {!selected ? <Notice>اختر عضو فريق لإسناد المجموعات.</Notice> : <>
            <p className="muted">العضو: <b>{selected.full_name}</b></p>
            <div className="stack">
              {groups.map((g) => <label key={g.id} className="row small"><input type="checkbox" checked={selectedGroups.includes(g.id)} onChange={(e) => setSelectedGroups((old) => e.target.checked ? [...old, g.id] : old.filter((id) => id !== g.id))} /> {groupName.get(g.id)}</label>)}
            </div>
            <Button type="button" onClick={saveGroups}>حفظ المجموعات</Button>
          </>}
        </Card>
      </div>
    </>
  );
}
