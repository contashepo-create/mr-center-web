'use client';

import { useEffect, useMemo, useState } from 'react';
import { Badge, Button, Card, EmptyState, ErrorNotice, Input, Notice, PageHeader } from '@/components/ui';
import { useToast } from '@/components/toast';
import { useSession } from '@/context/session';
import { assignTeacherGroups, createStaffInvite, deleteTeacher, fetchGroups, fetchStaff, fetchStaffInvites, fetchTeacherGroups, revokeStaffInvite, setTeacherActive, setTeacherPerms } from '@/lib/api';
import { isOwner, roleLabel, TEACHER_PERMS } from '@/lib/rbac';
import type { Group, Profile, StaffInviteRow, TeacherPerms } from '@/lib/types';

export default function StaffPage() {
  const { profile } = useSession();
  const toast = useToast();
  const centerId = profile?.center_id;
  const [staff, setStaff] = useState<Profile[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [selected, setSelected] = useState<Profile | null>(null);
  const [selectedGroups, setSelectedGroups] = useState<string[]>([]);
  const [error, setError] = useState<unknown>(null);
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
    try { await setTeacherPerms(p.id, next); await load(); toast.success('تم تحديث الصلاحيات', `صلاحيات «${p.full_name}» حُدثت بنجاح.`); }
    catch (err) { setError(err); }
  };

  const toggleActive = async (p: Profile) => {
    setError(null);
    try { await setTeacherActive(p.id, !p.is_active); await load(); toast.success(p.is_active ? 'تم إيقاف العضو' : 'تم تفعيل العضو', `«${p.full_name}» ${p.is_active ? 'أصبح غير نشط' : 'أصبح نشطاً'}.`); }
    catch (err) { setError(err); }
  };

  const saveGroups = async () => {
    if (!centerId || !selected) return;
    setError(null);
    try { await assignTeacherGroups(centerId, selected.id, selectedGroups); toast.success('تم حفظ المجموعات', `حُفظت مجموعات «${selected.full_name}» بنجاح.`); }
    catch (err) { setError(err); }
  };

  const remove = async (id: string) => { if (!confirm('حذف عضو الفريق؟')) return; try { await deleteTeacher(id); await load(); toast.success('تم حذف العضو'); } catch (err) { setError(err); } };

  // --- دعوة موظف جديد (سكرتير/مدرس فقط) ---
  const [invites, setInvites] = useState<StaffInviteRow[]>([]);
  const [invName, setInvName] = useState('');
  const [invPhone, setInvPhone] = useState('');
  const [invRole, setInvRole] = useState<'teacher' | 'secretary'>('secretary');
  const [invPerms, setInvPerms] = useState<TeacherPerms>({});
  const [invCode, setInvCode] = useState<string | null>(null);
  const [invBusy, setInvBusy] = useState(false);

  const loadInvites = async () => {
    if (!centerId) return;
    try { setInvites(await fetchStaffInvites(centerId)); } catch { /* ignore */ }
  };
  useEffect(() => { void loadInvites(); }, [centerId]);

  const createInvite = async () => {
    if (!centerId || !invName.trim()) { setError(new Error('اكتب اسم الموظف')); return; }
    setInvBusy(true); setError(null); setInvCode(null);
    try {
      const code = await createStaffInvite({ centerId, name: invName, phone: invPhone, role: invRole, perms: invPerms });
      setInvCode(code); await loadInvites();
      toast.success('تم توليد كود الدعوة', `كود «${invName}» جاهز — أرسله للموظف للتسجيل.`);
    } catch (err) { setError(err); }
    finally { setInvBusy(false); }
  };
  const copyInvite = (code: string) => { void navigator.clipboard?.writeText(code); toast.success('تم نسخ الكود', code); };
  const revokeInvite = async (inv: StaffInviteRow) => {
    if (!confirm(`إلغاء كود دعوة «${inv.name}»؟`)) return;
    try { await revokeStaffInvite(inv.id); await loadInvites(); toast.success('تم سحب الدعوة', `أُلغيت دعوة «${inv.name}».`); } catch (err) { setError(err); }
  };

  return (
    <>
      <PageHeader title="فريق العمل" subtitle="تفعيل حسابات الفريق وتحديد صلاحياتهم ومجموعاتهم." />
      <ErrorNotice error={error} />
      <div className="grid grid-2">
        <Card className="stack">
          <div className="row-between"><h2 className="h3">الأعضاء</h2><Badge tone="info">{staff.length}</Badge></div>
          {staff.length === 0 ? <EmptyState title="لا يوجد فريق" body="ولّد كود دعوة بالسكرتير/المدرس أرِسله له، ثم يظهر حسابه هنا للتفعيل وتحديد الصلاحيات." /> : <div className="stack">
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
        <Card className="stack">
          <h2 className="h3">دعوة موظف جديد</h2>
          <Notice tone="warn">المدير هو صاحب السنتر — لا يُضاف مدير إضافي. الدعوة لسكرتير/مدرس فقط، ويُفرض حد الباقة آلياً.</Notice>
          <div className="row">
            <Input label="اسم الموظف" value={invName} onChange={(e) => setInvName(e.target.value)} />
            <Input label="رقم الهاتف (اختياري)" value={invPhone} onChange={(e) => setInvPhone(e.target.value)} dir="ltr" />
          </div>
          <select className="select block" value={invRole} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setInvRole(e.target.value as 'teacher' | 'secretary')}>
            <option value="secretary">سكرتير</option>
            <option value="teacher">مدرس</option>
          </select>
          <div className="stack">
            <span className="label">صلاحيات الموظف (تُطبق فور تسجيله)</span>
            <div className="row">
              {TEACHER_PERMS.map((perm) => {
                const on = !!invPerms[perm.key];
                return (
                  <button
                    key={perm.key}
                    type="button"
                    title={perm.hint}
                    className={`tab ${on ? 'active' : ''}`}
                    onClick={() => setInvPerms((old) => ({ ...old, [perm.key]: !on }))}
                  >
                    {perm.label}
                  </button>
                );
              })}
            </div>
            <span className="tiny muted">حدد ما يستطيع هذا الموظف فعله داخل سنترك — يمكنك تعديلها لاحقاً من صفحة الفريق.</span>
          </div>
          {invCode ? <Notice tone="success">كود الدعوة: <b style={{ direction: 'ltr', fontSize: '1.15rem' }}>{invCode}</b> — أرسله للموظف ليتسجل به من «انضمام فريق عمل».</Notice> : null}
          <div className="row">
            <Button disabled={invBusy} type="button" onClick={() => void createInvite()}>{invBusy ? 'جاري التوليد...' : 'توليد كود دعوة'}</Button>
            {invCode ? <Button variant="secondary" type="button" onClick={() => copyInvite(invCode)}>نسخ الكود</Button> : null}
          </div>
          {invites.filter((i) => i.status === 'pending').length > 0 ? (
            <div className="stack">
              <h3 className="h4">دعوات بانتظار التسجيل</h3>
              {invites.filter((i) => i.status === 'pending').map((inv) => (
                <div key={inv.id} className="row-between card compact soft">
                  <span>{inv.name} — {roleLabel(inv.role)}<div className="tiny muted" dir="ltr">{inv.code}</div></span>
                  <div className="row">
                    <Button type="button" variant="secondary" onClick={() => copyInvite(inv.code)}>نسخ</Button>
                    <Button type="button" variant="danger" onClick={() => void revokeInvite(inv)}>سحب</Button>
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </Card>
      </div>
    </>
  );
}
