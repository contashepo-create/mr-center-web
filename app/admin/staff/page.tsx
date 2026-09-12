'use client';

import { useEffect, useMemo, useState } from 'react';
import { Badge, Button, Card, EmptyState, ErrorNotice, Input, Notice, PageHeader, Select } from '@/components/ui';
import { Modal } from '@/components/modal';
import { useToast } from '@/components/toast';
import { useSession } from '@/context/session';
import { assignTeacherGroups, createStaffInvite, deleteTeacher, fetchGroups, fetchStaff, fetchStaffInvites, fetchTeacherGroups, revokeStaffInvite, setTeacherActive, setTeacherPerms } from '@/lib/api';
import { isOwner, roleLabel, TEACHER_PERMS } from '@/lib/rbac';
import type { Group, Profile, StaffInviteRow, TeacherPerms } from '@/lib/types';

const initialInvite = { name: '', phone: '', role: 'secretary' as 'teacher' | 'secretary', perms: {} as TeacherPerms };

export default function StaffPage() {
  const { profile } = useSession();
  const toast = useToast();
  const centerId = profile?.center_id;
  const [staff, setStaff] = useState<Profile[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [selected, setSelected] = useState<Profile | null>(null);
  const [selectedGroups, setSelectedGroups] = useState<string[]>([]);
  const [groupsOpen, setGroupsOpen] = useState(false);
  const [groupsDirty, setGroupsDirty] = useState(false);
  const [invites, setInvites] = useState<StaffInviteRow[]>([]);
  const [inv, setInv] = useState(initialInvite);
  const [invOpen, setInvOpen] = useState(false);
  const [invDirty, setInvDirty] = useState(false);
  const [invCode, setInvCode] = useState<string | null>(null);
  const [invBusy, setInvBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const groupName = useMemo(() => new Map(groups.map((g) => [g.id, g.name])), [groups]);

  const load = async () => {
    if (!centerId) return;
    setError(null);
    try { const [s, g] = await Promise.all([fetchStaff(centerId), fetchGroups(centerId)]); setStaff(s); setGroups(g); }
    catch (err) { setError(err); }
  };
  const loadInvites = async () => {
    if (!centerId) return;
    try { setInvites(await fetchStaffInvites(centerId)); } catch { /* ignore */ }
  };
  useEffect(() => { void load(); void loadInvites(); }, [centerId]);

  if (!isOwner(profile)) {
    return <Card><Notice tone="error">إدارة فريق العمل متاحة لصاحب السنتر فقط.</Notice></Card>;
  }

  const openGroups = async (p: Profile) => {
    setSelected(p);
    try { setSelectedGroups((await fetchTeacherGroups(p.id)).map((x) => x.group_id)); }
    catch { setSelectedGroups([]); }
    setGroupsDirty(false); setError(null); setGroupsOpen(true);
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
    try { await assignTeacherGroups(centerId, selected.id, selectedGroups); toast.success('تم حفظ المجموعات', `حُفظت مجموعات «${selected.full_name}» بنجاح.`); setGroupsDirty(false); setGroupsOpen(false); await load(); }
    catch (err) { setError(err); }
  };

  const remove = async (id: string) => { if (!confirm('حذف عضو الفريق؟')) return; try { await deleteTeacher(id); await load(); toast.success('تم حذف العضو'); } catch (err) { setError(err); } };

  const openInvite = () => { setInv(initialInvite); setInvCode(null); setInvDirty(false); setError(null); setInvOpen(true); };
  const changeInv = (patch: Partial<typeof inv>) => { setInv((f) => ({ ...f, ...patch })); setInvDirty(true); };

  const createInvite = async () => {
    if (!centerId || !inv.name.trim()) { setError(new Error('اكتب اسم الموظف')); return; }
    setInvBusy(true); setError(null); setInvCode(null);
    try {
      const code = await createStaffInvite({ centerId, name: inv.name, phone: inv.phone, role: inv.role, perms: inv.perms });
      setInvCode(code); await loadInvites();
      toast.success('تم توليد كود الدعوة', `كود «${inv.name}» جاهز — أرسله للموظف للتسجيل.`);
    } catch (err) { setError(err); }
    finally { setInvBusy(false); }
  };
  const copyInvite = (code: string) => { void navigator.clipboard?.writeText(code); toast.success('تم نسخ الكود', code); };
  const revokeInvite = async (invRow: StaffInviteRow) => {
    if (!confirm(`إلغاء كود دعوة «${invRow.name}»؟`)) return;
    try { await revokeStaffInvite(invRow.id); await loadInvites(); toast.success('تم سحب الدعوة', `أُلغيت دعوة «${invRow.name}».`); } catch (err) { setError(err); }
  };

  const pendingInvites = invites.filter((i) => i.status === 'pending');

  return (
    <>
      <PageHeader title="فريق العمل" subtitle="تفعيل حسابات الفريق وتحديد صلاحياتهم ومجموعاتهم." actions={<Button type="button" onClick={openInvite}>+ دعوة موظف جديد</Button>} />
      <ErrorNotice error={error} />
      <div className="grid grid-2">
        <Card className="stack">
          <div className="row-between"><h2 className="h3">الأعضاء</h2><Badge tone="info">{staff.length}</Badge></div>
          {staff.length === 0 ? <EmptyState title="لا يوجد فريق" body="ولّد كود دعوة بالسكرتير/المدرس أرِسله له، ثم يظهر حسابه هنا للتفعيل وتحديد الصلاحيات." /> : <div className="stack">
            {staff.map((p) => <div key={p.id} className="card compact soft stack">
              <div className="row-between"><div><strong>{p.full_name}</strong><div className="tiny muted">{roleLabel(p.role)} · {p.email}</div></div><Badge tone={p.is_active ? 'success' : 'warn'}>{p.is_active ? 'مفعل' : 'خامل'}</Badge></div>
              <div className="row"><Button variant="secondary" type="button" onClick={() => void toggleActive(p)}>{p.is_active ? 'إيقاف' : 'تفعيل'}</Button><Button variant="secondary" type="button" onClick={() => void openGroups(p)}>المجموعات</Button><Button variant="danger" type="button" onClick={() => void remove(p.id)}>حذف</Button></div>
              <div className="row">
                {TEACHER_PERMS.map((perm) => <button key={perm.key} className={`tab ${(p.perms ?? {})[perm.key] ? 'active' : ''}`} type="button" onClick={() => void togglePerm(p, perm.key)}>{perm.label}</button>)}
              </div>
            </div>)}
          </div>}
        </Card>

        <Card className="stack">
          <div className="row-between"><h2 className="h3">دعوات بانتظار التسجيل</h2><Badge tone="info">{pendingInvites.length}</Badge></div>
          {pendingInvites.length === 0 ? <Notice>لا توجد دعوات معلقة. اضغط «+ دعوة موظف جديد» لإصدار كود تسجيل لسكرتير أو مدرس.</Notice> : <div className="stack">
            {pendingInvites.map((invRow) => (
              <div key={invRow.id} className="row-between card compact soft">
                <span>{invRow.name} — {roleLabel(invRow.role)}<div className="tiny muted" dir="ltr">{invRow.code}</div></span>
                <div className="row">
                  <Button type="button" variant="secondary" onClick={() => copyInvite(invRow.code)}>نسخ</Button>
                  <Button type="button" variant="danger" onClick={() => void revokeInvite(invRow)}>سحب</Button>
                </div>
              </div>
            ))}
          </div>}
          <Notice tone="warn">المدير هو صاحب السنتر — لا يُضاف مدير إضافي. الدعوة لسكرتير/مدرس فقط، ويُفرض حد الباقة آلياً.</Notice>
        </Card>
      </div>

      <Modal
        open={groupsOpen}
        title="مجموعات العضو"
        subtitle={selected?.full_name ?? ''}
        dirty={groupsDirty}
        onClose={() => setGroupsOpen(false)}
        onSave={saveGroups}
        saveLabel="حفظ المجموعات"
        footer={<Button type="button" onClick={saveGroups}>حفظ المجموعات</Button>}
      >
        <div className="stack">
          {groups.length === 0 ? <Notice>لا توجد مجموعات بعد — أنشئها من صفحة المجموعات.</Notice> : groups.map((g) => (
            <label key={g.id} className="row small">
              <input type="checkbox" checked={selectedGroups.includes(g.id)} onChange={(e) => { setSelectedGroups((old) => e.target.checked ? [...old, g.id] : old.filter((id) => id !== g.id)); setGroupsDirty(true); }} />
              {groupName.get(g.id)}
            </label>
          ))}
        </div>
      </Modal>

      <Modal
        open={invOpen}
        title="دعوة موظف جديد"
        subtitle="سكرتير أو مدرس — بصلاحيات تحددها أنت"
        dirty={invDirty}
        onClose={() => setInvOpen(false)}
        onSave={() => void createInvite()}
        saveLabel={invBusy ? 'جاري التوليد...' : 'توليد كود دعوة'}
        footer={
          invCode ? (
            <div className="row">
              <Button variant="secondary" type="button" onClick={() => copyInvite(invCode)}>نسخ الكود</Button>
              <Button type="button" onClick={() => setInvOpen(false)}>إغلاق</Button>
            </div>
          ) : (
            <Button disabled={invBusy} type="button" onClick={() => void createInvite()}>{invBusy ? 'جاري التوليد...' : 'توليد كود دعوة'}</Button>
          )
        }
      >
        <div className="stack">
          <div className="grid grid-2">
            <Input label="اسم الموظف" value={inv.name} onChange={(e) => changeInv({ name: e.target.value })} />
            <Input label="رقم الهاتف (اختياري)" value={inv.phone} onChange={(e) => changeInv({ phone: e.target.value })} dir="ltr" />
          </div>
          <Select label="الدور" value={inv.role} onChange={(e) => changeInv({ role: e.target.value as 'teacher' | 'secretary' })}>
            <option value="secretary">سكرتير</option>
            <option value="teacher">مدرس</option>
          </Select>
          <div className="stack">
            <span className="label">صلاحيات الموظف (تُطبق فور تسجيله)</span>
            <div className="row">
              {TEACHER_PERMS.map((perm) => {
                const on = !!inv.perms[perm.key];
                return (
                  <button
                    key={perm.key}
                    type="button"
                    title={perm.hint}
                    className={`tab ${on ? 'active' : ''}`}
                    onClick={() => setInv((old) => ({ ...old, perms: { ...old.perms, [perm.key]: !on } }))}
                  >
                    {perm.label}
                  </button>
                );
              })}
            </div>
            <span className="tiny muted">حدد ما يستطيع هذا الموظف فعله داخل سنترك — يمكنك تعديلها لاحقاً من صفحة الفريق.</span>
          </div>
          {invCode ? <Notice tone="success">كود الدعوة: <b style={{ direction: 'ltr', fontSize: '1.15rem' }}>{invCode}</b> — أرسله للموظف ليتسجل به من «انضمام فريق عمل».</Notice> : null}
          <ErrorNotice error={error} />
        </div>
      </Modal>
    </>
  );
}
