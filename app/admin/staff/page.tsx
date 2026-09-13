'use client';

import { useEffect, useMemo, useState } from 'react';
import { Badge, Button, Card, EmptyState, ErrorNotice, Input, Notice, PageHeader, Select } from '@/components/ui';
import { Modal } from '@/components/modal';
import { useToast } from '@/components/toast';
import { useSession } from '@/context/session';
import { assignTeacherGroups, createStaffInvite, deleteTeacher, fetchGroups, fetchStaff, fetchStaffInvites, fetchTeacherGroups, revokeStaffInvite, setTeacherActive, setTeacherPerms } from '@/lib/api';
import { LEDGER_ENTRY_LABEL, summarizeEmployeePayroll, valueOf, type AccountingLedgerRow } from '@/lib/accounting';
import { buildReportHtml, printCenterReport } from '@/lib/report';
import { isOwner, roleLabel, TEACHER_PERMS } from '@/lib/rbac';
import { getSupabase } from '@/lib/supabase';
import type { Group, Profile, StaffInviteRow, TeacherPerms } from '@/lib/types';
import { formatDate, formatMoney } from '@/lib/utils';

type DirectoryView = 'cards' | 'list';
type StatementLedger = AccountingLedgerRow & {
  id: string;
  category: string;
  description: string;
  occurred_on: string;
  created_by: string | null;
};
type StaffDeduction = {
  id: string;
  staff_id: string;
  amount: number | string;
  applied_amount: number | string;
  reason: string;
  notes: string;
  occurred_on: string;
  status: 'open' | 'partial' | 'settled';
};

const initialInvite = { name: '', phone: '', role: 'secretary' as 'teacher' | 'secretary', perms: {} as TeacherPerms };

function allPermissions(enabled: boolean): TeacherPerms {
  return Object.fromEntries(TEACHER_PERMS.map((permission) => [permission.key, enabled])) as TeacherPerms;
}

function enabledPermissions(perms: TeacherPerms | null | undefined) {
  return TEACHER_PERMS.filter((permission) => perms?.[permission.key]);
}

function initials(name: string): string {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part.charAt(0)).join('') || 'عضو';
}

export default function StaffPage() {
  const { profile, features } = useSession();
  const toast = useToast();
  const centerId = profile?.center_id;
  const [staff, setStaff] = useState<Profile[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [selected, setSelected] = useState<Profile | null>(null);
  const [selectedGroups, setSelectedGroups] = useState<string[]>([]);
  const [groupsOpen, setGroupsOpen] = useState(false);
  const [groupsDirty, setGroupsDirty] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [permissionsOpen, setPermissionsOpen] = useState(false);
  const [permissionDraft, setPermissionDraft] = useState<TeacherPerms>({});
  const [permissionsDirty, setPermissionsDirty] = useState(false);
  const [directoryView, setDirectoryView] = useState<DirectoryView>('cards');
  const [statementBusyId, setStatementBusyId] = useState<string | null>(null);
  const [invites, setInvites] = useState<StaffInviteRow[]>([]);
  const [inv, setInv] = useState(initialInvite);
  const [invOpen, setInvOpen] = useState(false);
  const [invDirty, setInvDirty] = useState(false);
  const [invCode, setInvCode] = useState<string | null>(null);
  const [invBusy, setInvBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const groupName = useMemo(() => new Map(groups.map((group) => [group.id, group.name])), [groups]);
  const selectedGroupNames = selectedGroups.map((id) => groupName.get(id)).filter(Boolean) as string[];

  const load = async () => {
    if (!centerId) return;
    setError(null);
    try {
      const [members, centerGroups] = await Promise.all([fetchStaff(centerId), fetchGroups(centerId)]);
      setStaff(members); setGroups(centerGroups);
    } catch (err) { setError(err); }
  };
  const loadInvites = async () => {
    if (!centerId) return;
    try { setInvites(await fetchStaffInvites(centerId)); } catch { /* ليست ضرورية لإدارة الحسابات القائمة */ }
  };
  useEffect(() => { void load(); void loadInvites(); }, [centerId]);

  if (!isOwner(profile)) {
    return <Card><Notice tone="error">إدارة فريق العمل متاحة لصاحب السنتر فقط.</Notice></Card>;
  }

  const loadMemberGroups = async (member: Profile) => {
    setSelected(member);
    try { setSelectedGroups((await fetchTeacherGroups(member.id)).map((row) => row.group_id)); }
    catch { setSelectedGroups([]); }
  };
  const openGroups = async (member: Profile) => {
    await loadMemberGroups(member);
    setGroupsDirty(false); setError(null); setGroupsOpen(true);
  };
  const openProfile = async (member: Profile) => {
    await loadMemberGroups(member);
    setError(null); setProfileOpen(true);
  };
  const openPermissions = (member: Profile) => {
    setSelected(member); setPermissionDraft({ ...(member.perms ?? {}) }); setPermissionsDirty(false); setError(null); setPermissionsOpen(true);
  };

  const savePermissions = async () => {
    if (!selected) return;
    try {
      setError(null);
      await setTeacherPerms(selected.id, permissionDraft);
      toast.success('تم حفظ الصلاحيات', `حُدثت صلاحيات «${selected.full_name}» دفعة واحدة.`);
      setPermissionsDirty(false); setPermissionsOpen(false); await load();
    } catch (err) { setError(err); }
  };
  const toggleActive = async (member: Profile) => {
    setError(null);
    try {
      await setTeacherActive(member.id, !member.is_active); await load();
      toast.success(member.is_active ? 'تم إيقاف العضو' : 'تم تفعيل العضو', `«${member.full_name}» ${member.is_active ? 'أصبح غير نشط' : 'أصبح نشطاً'}.`);
    } catch (err) { setError(err); }
  };
  const saveGroups = async () => {
    if (!centerId || !selected) return;
    setError(null);
    try {
      await assignTeacherGroups(centerId, selected.id, selectedGroups);
      toast.success('تم حفظ المجموعات', `حُفظت مجموعات «${selected.full_name}» بنجاح.`);
      setGroupsDirty(false); setGroupsOpen(false); await load();
    } catch (err) { setError(err); }
  };
  const remove = async (id: string) => {
    if (!confirm('حذف عضو الفريق؟')) return;
    try { await deleteTeacher(id); await load(); toast.success('تم حذف العضو'); } catch (err) { setError(err); }
  };

  const printEmployeeStatement = async (member: Profile) => {
    if (!centerId) return;
    if (!features?.accounting) {
      toast.info('كشف الحساب المالي غير متاح', 'يتطلب طباعة كشف الرواتب والسلف والخصومات تفعيل خدمة المحاسبة لسنترك.');
      return;
    }
    setStatementBusyId(member.id); setError(null);
    try {
      const sb = getSupabase();
      const [ledgerResult, deductionsResult] = await Promise.all([
        sb.from('center_ledger')
          .select('id,kind,entry_type,amount,deduction,gross_amount,bonus_amount,commission_amount,advance_applied,affects_profit,employee_id,created_by,category,description,occurred_on')
          .eq('center_id', centerId)
          .or(`employee_id.eq.${member.id},and(entry_type.eq.payment_collection,created_by.eq.${member.id})`)
          .order('occurred_on', { ascending: false }).limit(600),
        sb.from('staff_deductions').select('id,staff_id,amount,applied_amount,reason,notes,occurred_on,status')
          .eq('center_id', centerId).eq('staff_id', member.id).order('occurred_on', { ascending: false }).limit(300),
      ]);
      if (ledgerResult.error) throw ledgerResult.error;
      if (deductionsResult.error) throw deductionsResult.error;
      const rows = (ledgerResult.data ?? []) as StatementLedger[];
      const deductions = (deductionsResult.data ?? []) as StaffDeduction[];
      const summary = summarizeEmployeePayroll(rows, member.id);
      const openDeductions = deductions.reduce((sum, item) => sum + valueOf(item.amount) - valueOf(item.applied_amount), 0);
      await printCenterReport(centerId, (branding) => buildReportHtml(`كشف حساب الموظف — ${member.full_name}`, 'من بداية التعامل حتى اليوم', [
        { title: 'بيانات الموظف', headers: ['البند', 'البيان'], rows: [['الدور', roleLabel(member.role)], ['البريد الإلكتروني', member.email || '—'], ['الهاتف', member.phone || '—'], ['حالة الحساب', member.is_active ? 'مفعّل' : 'موقوف']] },
        { title: 'ملخص المستحقات والذمم', headers: ['البند', 'القيمة'], rows: [['الراتب والمكافآت المسجلة', formatMoney(summary.baseSalary + summary.bonuses)], ['عمولات مصروفة / ضمن الراتب', formatMoney(summary.commissions)], ['صافي النقد المدفوع', formatMoney(summary.cashPaid)], ['سلف قائمة', formatMoney(summary.advancesOutstanding)], ['خصومات مسجلة متبقية', formatMoney(openDeductions)]] },
        { title: 'الحركات المرتبطة', headers: ['التاريخ', 'الحركة', 'البيان', 'الأثر النقدي', 'التفاصيل'], rows: rows.length ? rows.map((row) => [formatDate(row.occurred_on), LEDGER_ENTRY_LABEL[row.entry_type], row.description || row.category, `${row.kind === 'income' ? '+' : '−'} ${formatMoney(valueOf(row.amount))}`, row.entry_type === 'advance' ? `سلفة: ${formatMoney(valueOf(row.amount))}` : row.entry_type === 'salary' ? `سلفة ${formatMoney(valueOf(row.advance_applied))} · خصم ${formatMoney(valueOf(row.deduction))}` : row.entry_type === 'payment_collection' ? 'تحصيل باسم الموظف' : '—']) : [['—', 'لا توجد حركات', '—', '—', '—']] },
        { title: 'سجل الخصومات', headers: ['التاريخ', 'السبب', 'الإجمالي', 'المعالج', 'المتبقي', 'الحالة'], rows: deductions.length ? deductions.map((item) => [formatDate(item.occurred_on), `${item.reason}${item.notes ? ` — ${item.notes}` : ''}`, formatMoney(valueOf(item.amount)), formatMoney(valueOf(item.applied_amount)), formatMoney(valueOf(item.amount) - valueOf(item.applied_amount)), item.status === 'settled' ? 'مُعالج' : item.status === 'partial' ? 'جزئي' : 'بانتظار الصرف']) : [['—', 'لا توجد خصومات مستقلة', '—', '—', '—', '—']] },
      ], { name: profile?.full_name, branding }));
    } catch (err) { setError(err); }
    finally { setStatementBusyId(null); }
  };

  const openInvite = () => { setInv(initialInvite); setInvCode(null); setInvDirty(false); setError(null); setInvOpen(true); };
  const changeInv = (patch: Partial<typeof inv>) => { setInv((form) => ({ ...form, ...patch })); setInvDirty(true); };
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
  const revokeInvite = async (invite: StaffInviteRow) => {
    if (!confirm(`إلغاء كود دعوة «${invite.name}»؟`)) return;
    try { await revokeStaffInvite(invite.id); await loadInvites(); toast.success('تم سحب الدعوة', `أُلغيت دعوة «${invite.name}».`); } catch (err) { setError(err); }
  };

  const pendingInvites = invites.filter((invite) => invite.status === 'pending');

  return (
    <>
      <PageHeader title="فريق العمل" subtitle="دليل عملي للموظفين: معاينة بياناتهم، صلاحياتهم، مجموعاتهم وكشوف حسابهم." actions={<Button type="button" onClick={openInvite}>+ دعوة موظف جديد</Button>} />
      <ErrorNotice error={error} />
      <div className="grid grid-2">
        <Card className="stack">
          <div className="row-between"><div><h2 className="h3">الأعضاء</h2><p className="tiny muted">اختر عرض البطاقات أو القائمة، ثم استخدم الإجراء المناسب بجوار كل عضو.</p></div><div className="row"><Badge tone="info">{staff.length}</Badge><div className="staff-view-toggle" aria-label="شكل عرض الفريق"><button type="button" className={directoryView === 'cards' ? 'active' : ''} onClick={() => setDirectoryView('cards')}>▦ بطاقات</button><button type="button" className={directoryView === 'list' ? 'active' : ''} onClick={() => setDirectoryView('list')}>☷ قائمة</button></div></div></div>
          {staff.length === 0 ? <EmptyState title="لا يوجد فريق" body="ولّد كود دعوة بالسكرتير/المدرس وأرسله له، ثم يظهر حسابه هنا للتفعيل وتحديد الصلاحيات." /> : <div className={`staff-directory ${directoryView}`}>
            {staff.map((member) => {
              const granted = enabledPermissions(member.perms);
              return <article key={member.id} className="staff-member">
                <div className="staff-member-main"><div className="staff-member-avatar" aria-hidden="true">{initials(member.full_name)}</div><div className="staff-member-info"><h3>{member.full_name}</h3><p dir="ltr">{member.email || member.phone || 'لم تُسجل وسيلة تواصل'}</p><div className="staff-member-meta"><Badge tone="info">{roleLabel(member.role)}</Badge><Badge tone={member.is_active ? 'success' : 'warn'}>{member.is_active ? 'مفعّل' : 'موقوف'}</Badge><Badge>{granted.length} صلاحيات</Badge></div></div></div>
                <div className="staff-member-actions"><Button type="button" variant="secondary" onClick={() => void openProfile(member)}>⌕ معاينة</Button><Button type="button" variant="secondary" disabled={statementBusyId === member.id} onClick={() => void printEmployeeStatement(member)}>{statementBusyId === member.id ? 'جارٍ التجهيز…' : '🖨 كشف حساب'}</Button><Button type="button" variant="secondary" onClick={() => openPermissions(member)}>✓ الصلاحيات</Button><Button type="button" variant="secondary" onClick={() => void openGroups(member)}>المجموعات</Button><Button type="button" variant={member.is_active ? 'ghost' : 'secondary'} onClick={() => void toggleActive(member)}>{member.is_active ? 'إيقاف' : 'تفعيل'}</Button><Button type="button" variant="danger" onClick={() => void remove(member.id)}>حذف</Button></div>
              </article>;
            })}
          </div>}
        </Card>

        <Card className="stack">
          <div className="row-between"><h2 className="h3">دعوات بانتظار التسجيل</h2><Badge tone="info">{pendingInvites.length}</Badge></div>
          {pendingInvites.length === 0 ? <Notice>لا توجد دعوات معلقة. اضغط «+ دعوة موظف جديد» لإصدار كود تسجيل لسكرتير أو مدرس.</Notice> : <div className="stack">
            {pendingInvites.map((invite) => <div key={invite.id} className="row-between card compact soft"><span>{invite.name} — {roleLabel(invite.role)}<div className="tiny muted" dir="ltr">{invite.code}</div></span><div className="row"><Button type="button" variant="secondary" onClick={() => copyInvite(invite.code)}>نسخ</Button><Button type="button" variant="danger" onClick={() => void revokeInvite(invite)}>سحب</Button></div></div>)}
          </div>}
          <Notice tone="warn">المدير هو صاحب السنتر — لا يُضاف مدير إضافي. الدعوة لسكرتير/مدرس فقط، ويُفرض حد الباقة آلياً.</Notice>
        </Card>
      </div>

      <Modal open={profileOpen} title="بطاقة الموظف" subtitle={selected?.full_name ?? ''} onClose={() => setProfileOpen(false)} wide footer={<div className="row"><Button type="button" variant="secondary" disabled={!selected || statementBusyId === selected?.id} onClick={() => selected && void printEmployeeStatement(selected)}>{statementBusyId === selected?.id ? 'جارٍ التجهيز…' : '🖨 طباعة كشف الحساب'}</Button><Button type="button" disabled={!selected} onClick={() => { setProfileOpen(false); if (selected) openPermissions(selected); }}>تعديل الصلاحيات</Button></div>}>
        {selected ? <div className="stack"><div className="staff-profile-grid"><div className="staff-profile-item"><span>الدور</span><strong>{roleLabel(selected.role)}</strong></div><div className="staff-profile-item"><span>حالة الحساب</span><strong>{selected.is_active ? 'مفعّل' : 'موقوف'}</strong></div><div className="staff-profile-item"><span>البريد الإلكتروني</span><strong dir="ltr">{selected.email || '—'}</strong></div><div className="staff-profile-item"><span>رقم الهاتف</span><strong dir="ltr">{selected.phone || '—'}</strong></div><div className="staff-profile-item"><span>تاريخ الانضمام</span><strong>{formatDate(selected.created_at)}</strong></div><div className="staff-profile-item"><span>المجموعات المعيّنة</span><strong>{selectedGroupNames.length || 'لا توجد مجموعات'}</strong></div></div><Card className="compact stack"><div className="row-between"><strong>المجموعات</strong><Button type="button" variant="ghost" onClick={() => { setProfileOpen(false); void openGroups(selected); }}>تعديل المجموعات</Button></div>{selectedGroupNames.length ? <div className="staff-permission-summary">{selectedGroupNames.map((name) => <Badge key={name} tone="info">{name}</Badge>)}</div> : <span className="tiny muted">لم تُسند إليه مجموعة بعد.</span>}</Card><Card className="compact stack"><div className="row-between"><strong>الصلاحيات الممنوحة</strong><Button type="button" variant="ghost" onClick={() => { setProfileOpen(false); openPermissions(selected); }}>تعديل الصلاحيات</Button></div>{enabledPermissions(selected.perms).length ? <div className="staff-permission-summary">{enabledPermissions(selected.perms).map((permission) => <Badge key={permission.key} tone="success">{permission.label}</Badge>)}</div> : <span className="tiny muted">لا توجد صلاحيات تشغيلية ممنوحة حالياً.</span>}</Card>{!features?.accounting ? <Notice tone="info">تتوفر طباعة كشف الحساب المالي تلقائياً عند تفعيل خدمة المحاسبة؛ تبقى بطاقة الموظف وصلاحياته ومجموعاته متاحة دائماً.</Notice> : null}</div> : null}
      </Modal>

      <Modal open={permissionsOpen} title="تعديل صلاحيات الموظف" subtitle={selected ? `${selected.full_name} — اختر الصلاحيات ثم احفظها دفعة واحدة.` : ''} dirty={permissionsDirty} onClose={() => setPermissionsOpen(false)} onSave={() => void savePermissions()} saveLabel="حفظ الصلاحيات" wide footer={<div className="row"><Button type="button" variant="ghost" onClick={() => { setPermissionDraft(allPermissions(false)); setPermissionsDirty(true); }}>إلغاء الكل</Button><Button type="button" variant="secondary" onClick={() => { setPermissionDraft(allPermissions(true)); setPermissionsDirty(true); }}>تحديد الكل</Button><Button type="button" onClick={() => void savePermissions()}>حفظ الصلاحيات</Button></div>}>
        <div className="stack"><Notice tone="info">كل مربع اختيار يحدد صلاحية واحدة. لا يحدث أي تعديل في الحساب حتى تضغط «حفظ الصلاحيات».</Notice><div className="permission-editor">{TEACHER_PERMS.map((permission) => <label key={permission.key} className="permission-option"><input type="checkbox" checked={!!permissionDraft[permission.key]} onChange={(event) => { setPermissionDraft((old) => ({ ...old, [permission.key]: event.target.checked })); setPermissionsDirty(true); }} /><span><strong>{permission.label}</strong><small>{permission.hint}</small></span></label>)}</div></div>
      </Modal>

      <Modal open={groupsOpen} title="مجموعات العضو" subtitle={selected?.full_name ?? ''} dirty={groupsDirty} onClose={() => setGroupsOpen(false)} onSave={saveGroups} saveLabel="حفظ المجموعات" footer={<Button type="button" onClick={saveGroups}>حفظ المجموعات</Button>}>
        <div className="stack">{groups.length === 0 ? <Notice>لا توجد مجموعات بعد — أنشئها من صفحة المجموعات.</Notice> : groups.map((group) => <label key={group.id} className="row small"><input type="checkbox" checked={selectedGroups.includes(group.id)} onChange={(event) => { setSelectedGroups((old) => event.target.checked ? [...old, group.id] : old.filter((id) => id !== group.id)); setGroupsDirty(true); }} />{groupName.get(group.id)}</label>)}</div>
      </Modal>

      <Modal open={invOpen} title="دعوة موظف جديد" subtitle="سكرتير أو مدرس — بصلاحيات تحددها أنت" dirty={invDirty} onClose={() => setInvOpen(false)} onSave={() => void createInvite()} saveLabel={invBusy ? 'جارٍ التوليد...' : 'توليد كود دعوة'} wide footer={invCode ? <div className="row"><Button variant="secondary" type="button" onClick={() => copyInvite(invCode)}>نسخ الكود</Button><Button type="button" onClick={() => setInvOpen(false)}>إغلاق</Button></div> : <Button disabled={invBusy} type="button" onClick={() => void createInvite()}>{invBusy ? 'جارٍ التوليد...' : 'توليد كود دعوة'}</Button>}>
        <div className="stack"><div className="grid grid-2"><Input label="اسم الموظف" value={inv.name} onChange={(event) => changeInv({ name: event.target.value })} /><Input label="رقم الهاتف (اختياري)" value={inv.phone} onChange={(event) => changeInv({ phone: event.target.value })} dir="ltr" /></div><Select label="الدور" value={inv.role} onChange={(event) => changeInv({ role: event.target.value as 'teacher' | 'secretary' })}><option value="secretary">سكرتير</option><option value="teacher">مدرس</option></Select><div className="row"><Button type="button" variant="ghost" onClick={() => changeInv({ perms: allPermissions(false) })}>إلغاء كل الصلاحيات</Button><Button type="button" variant="secondary" onClick={() => changeInv({ perms: allPermissions(true) })}>تحديد كل الصلاحيات</Button></div><div className="permission-editor">{TEACHER_PERMS.map((permission) => <label key={permission.key} className="permission-option"><input type="checkbox" checked={!!inv.perms[permission.key]} onChange={(event) => changeInv({ perms: { ...inv.perms, [permission.key]: event.target.checked } })} /><span><strong>{permission.label}</strong><small>{permission.hint}</small></span></label>)}</div>{invCode ? <Notice tone="success">كود الدعوة: <b style={{ direction: 'ltr', fontSize: '1.15rem' }}>{invCode}</b> — أرسله للموظف ليتسجل به من «انضمام فريق عمل».</Notice> : null}<ErrorNotice error={error} /></div>
      </Modal>
    </>
  );
}
