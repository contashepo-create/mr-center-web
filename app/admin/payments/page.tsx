'use client';

import { useEffect, useMemo, useState } from 'react';
import { Badge, Button, Card, EmptyState, ErrorNotice, Input, Notice, PageHeader, Select, formatStatus } from '@/components/ui';
import { ConfirmDialog, Modal } from '@/components/modal';
import { useToast } from '@/components/toast';
import { useSession } from '@/context/session';
import { CollectionQrScanner } from '@/components/payments/collection-qr-scanner';
import { fetchDues, fetchGrades, fetchGroupMembers, fetchGroups, fetchPaymentsForMonth, fetchStudentAccount, fetchStudents, generateDuesForGroup, recordBulkDuePayments, recordPayment, recordStudentCredit, settleStudentAccount } from '@/lib/api';
import type { Due, Grade, Group, Payment, Student, StudentAccount } from '@/lib/types';
import { can, isOwner } from '@/lib/rbac';
import { useTeacherGroupIds } from '@/lib/staff';
import { arabicMonth, formatDate, formatMoney, todayIso } from '@/lib/utils';
import { decodeStudentQr, isQrFresh } from '@/lib/qr';

type PickerIntent = 'collect' | 'statement';
type PickerMethod = 'search' | 'groups';

const money = (value: unknown) => formatMoney(Number(value || 0));

export default function PaymentsPage() {
  const { profile } = useSession();
  const toast = useToast();
  const centerId = profile?.center_id;
  const now = new Date();
  const [month, setMonth] = useState(String(now.getMonth() + 1));
  const [year, setYear] = useState(String(now.getFullYear()));
  const [groups, setGroups] = useState<Group[]>([]);
  const [grades, setGrades] = useState<Grade[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [dues, setDues] = useState<Due[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [selectedGroup, setSelectedGroup] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerIntent, setPickerIntent] = useState<PickerIntent>('collect');
  const [pickerMethod, setPickerMethod] = useState<PickerMethod>('search');
  const [studentSearch, setStudentSearch] = useState('');
  const [pickerGrade, setPickerGrade] = useState('');
  const [pickerGroup, setPickerGroup] = useState('');
  const [pickerGroupStudents, setPickerGroupStudents] = useState<Student[]>([]);

  const [collectOpen, setCollectOpen] = useState(false);
  const [collectStudentId, setCollectStudentId] = useState('');
  const [collectAccount, setCollectAccount] = useState<StudentAccount | null>(null);
  const [paymentDraft, setPaymentDraft] = useState({ target: '', amount: '', notes: '' });
  const [paymentDirty, setPaymentDirty] = useState(false);

  const [statementOpen, setStatementOpen] = useState(false);
  const [statementAccount, setStatementAccount] = useState<StudentAccount | null>(null);
  const [settleNotes, setSettleNotes] = useState('');
  const [settleConfirm, setSettleConfirm] = useState(false);

  const [batchOpen, setBatchOpen] = useState(false);
  const [batchGroup, setBatchGroup] = useState('');
  const [batchMembers, setBatchMembers] = useState<Student[]>([]);
  const [batchSelected, setBatchSelected] = useState<string[]>([]);
  const [batchNotes, setBatchNotes] = useState('');

  const teacherScope = useTeacherGroupIds();
  const visibleGroups = useMemo(() => {
    if (profile?.role !== 'teacher') return groups;
    if (!teacherScope) return [];
    return groups.filter((g) => teacherScope.includes(g.id));
  }, [groups, profile?.role, teacherScope]);
  const visibleGroupIds = useMemo(() => new Set(visibleGroups.map((g) => g.id)), [visibleGroups]);
  const visibleDues = useMemo(() => profile?.role === 'teacher' ? dues.filter((d) => !!d.group_id && visibleGroupIds.has(d.group_id)) : dues, [dues, profile?.role, visibleGroupIds]);
  const visibleStudentIds = useMemo(() => new Set(students.filter((s) => !profile || profile.role !== 'teacher' || (!!s.group_id && visibleGroupIds.has(s.group_id))).map((s) => s.id)), [students, profile, visibleGroupIds]);
  const visiblePayments = useMemo(() => profile?.role === 'teacher' ? payments.filter((p) => visibleStudentIds.has(p.student_id)) : payments, [payments, profile?.role, visibleStudentIds]);
  const studentsMap = useMemo(() => new Map(students.map((s) => [s.id, s])), [students]);
  const groupsMap = useMemo(() => new Map(groups.map((g) => [g.id, g])), [groups]);
  const pendingDues = visibleDues.filter((d) => d.status !== 'paid');
  const paidTotal = visiblePayments.reduce((sum, p) => sum + Number(p.amount || 0), 0);
  const dueTotal = visibleDues.reduce((sum, d) => sum + Number(d.amount || 0), 0);

  const filteredPickerStudents = useMemo(() => {
    const query = studentSearch.trim().toLocaleLowerCase('ar-EG');
    const source = profile?.role === 'teacher' ? students.filter((s) => visibleStudentIds.has(s.id)) : students;
    if (!query) return source.slice(0, 30);
    return source.filter((s) => `${s.name} ${s.phone ?? ''} ${s.guardian_phone ?? ''}`.toLocaleLowerCase('ar-EG').includes(query)).slice(0, 30);
  }, [studentSearch, students, profile?.role, visibleStudentIds]);
  const pickerGroups = useMemo(() => visibleGroups.filter((g) => !pickerGrade || g.grade_id === pickerGrade), [visibleGroups, pickerGrade]);

  const batchRows = useMemo(() => batchMembers.map((student) => {
    const studentDues = visibleDues.filter((due) => due.student_id === student.id && due.group_id === batchGroup && due.status !== 'paid');
    // المستحق الجزئي يُراجع فردياً حتى لا يفرض التحصيل الجماعي مبلغاً خاطئاً.
    const collectable = studentDues.filter((due) => due.status === 'pending');
    return { student, dues: collectable, hasPartial: studentDues.some((due) => due.status === 'partial'), total: collectable.reduce((sum, due) => sum + Number(due.amount || 0), 0) };
  }), [batchMembers, visibleDues, batchGroup]);
  const batchEligibleIds = useMemo(() => batchRows.filter((row) => row.dues.length > 0).map((row) => row.student.id), [batchRows]);
  const batchSelectedRows = useMemo(() => batchRows.filter((row) => batchSelected.includes(row.student.id) && row.dues.length > 0), [batchRows, batchSelected]);
  const batchTotal = useMemo(() => batchSelectedRows.reduce((sum, row) => sum + row.total, 0), [batchSelectedRows]);

  const load = async () => {
    if (!centerId) return;
    setError(null);
    try {
      const m = Number(month); const y = Number(year);
      const [g, gr, s, d, p] = await Promise.all([fetchGroups(centerId), fetchGrades(centerId), fetchStudents(centerId), fetchDues(centerId, m, y), fetchPaymentsForMonth(centerId, m, y)]);
      setGroups(g); setGrades(gr); setStudents(s); setDues(d); setPayments(p);
      if (!selectedGroup && g[0]) setSelectedGroup(g[0].id);
    } catch (err) { setError(err); }
  };
  useEffect(() => { void load(); }, [centerId, month, year]);
  useEffect(() => {
    if (visibleGroups.length === 0) { setSelectedGroup(''); return; }
    if (!selectedGroup || !visibleGroups.some((g) => g.id === selectedGroup)) setSelectedGroup(visibleGroups[0].id);
  }, [visibleGroups, selectedGroup]);
  useEffect(() => {
    if (!pickerOpen || pickerMethod !== 'groups' || !centerId || !pickerGroup) { setPickerGroupStudents([]); return; }
    void fetchGroupMembers(centerId, pickerGroup).then(setPickerGroupStudents).catch(setError);
  }, [pickerOpen, pickerMethod, centerId, pickerGroup]);
  useEffect(() => {
    if (!batchOpen || !centerId || !batchGroup) { setBatchMembers([]); return; }
    void fetchGroupMembers(centerId, batchGroup).then((items) => { setBatchMembers(items); setBatchSelected([]); }).catch(setError);
  }, [batchOpen, centerId, batchGroup]);

  const generate = async () => {
    if (!centerId || !selectedGroup) return;
    const group = groups.find((g) => g.id === selectedGroup);
    if (!group) return;
    setBusy(true); setError(null); setMessage(null);
    try {
      const res = await generateDuesForGroup(centerId, group, Number(month), Number(year));
      setMessage(res.skippedNoSessions ? 'لم يتم التوليد لأن نظام المجموعة بالحصة ولا توجد حصص لهذا الشهر.' : `تم توليد ${res.created} مستحق بقيمة ${formatMoney(res.amount)}.`);
      await load();
    } catch (err) { setError(err); }
    finally { setBusy(false); }
  };

  const openPicker = (intent: PickerIntent) => {
    setPickerIntent(intent); setPickerMethod('search'); setStudentSearch(''); setPickerGrade(''); setPickerGroup(''); setPickerGroupStudents([]); setError(null); setPickerOpen(true);
  };
  const readAccount = async (studentId: string) => {
    if (!centerId) return null;
    const account = await fetchStudentAccount(centerId, studentId);
    return account;
  };
  const openStudentCollection = async (studentId: string, preferredDueId = '') => {
    if (!centerId || !studentsMap.has(studentId)) throw new Error('الطالب خارج نطاق التحصيل المتاح لك.');
    setBusy(true); setError(null);
    try {
      const account = await readAccount(studentId);
      const firstDue = account?.dues.find((due) => due.id === preferredDueId && Number(due.remaining || 0) > 0)
        ?? account?.dues.find((due) => Number(due.remaining || 0) > 0);
      setCollectStudentId(studentId);
      setCollectAccount(account);
      setPaymentDraft({ target: firstDue?.id ?? 'credit', amount: firstDue ? String(Number(firstDue.remaining)) : '', notes: '' });
      setPaymentDirty(false); setCollectOpen(true);
    } catch (err) { setError(err); }
    finally { setBusy(false); }
  };
  const openStatement = async (studentId: string) => {
    if (!centerId || !studentsMap.has(studentId)) throw new Error('الطالب خارج نطاق التحصيل المتاح لك.');
    setBusy(true); setError(null);
    try { setStatementAccount(await readAccount(studentId)); setSettleNotes(''); setStatementOpen(true); }
    catch (err) { setError(err); }
    finally { setBusy(false); }
  };
  const chooseStudent = async (studentId: string) => {
    setPickerOpen(false);
    if (pickerIntent === 'collect') await openStudentCollection(studentId);
    else await openStatement(studentId);
  };

  /** مسح QR يعرّف الطالب ثم يفتح التحصيل للتأكيد، حتى لو لم يكن له مستحق حالياً (تحصيل مقدم). */
  const openCollectFromQr = async (raw: string) => {
    if (!centerId) throw new Error('اختر السنتر أولاً.');
    const decoded = decodeStudentQr(raw);
    if (!decoded) throw new Error('رمز QR غير صالح. امسح رمز الطالب الصادر من حسابه.');
    if (decoded.centerId !== centerId) throw new Error('هذا الرمز لا يخص سنترك.');
    if (!isQrFresh(decoded, todayIso())) throw new Error('رمز الطالب منتهي أو ليس رمز اليوم. اطلب منه فتح رمز اليوم من حسابه.');
    await openStudentCollection(decoded.studentId);
    toast.info('تم التعرف على الطالب', 'راجع المستحق أو اختر «رصيد مقدم» ثم أكد التحصيل.');
  };

  const collect = async (event?: React.FormEvent) => {
    event?.preventDefault();
    if (!centerId || !collectStudentId || !paymentDraft.target) return;
    const amount = Number(paymentDraft.amount);
    if (!amount || amount <= 0) return setError(new Error('أدخل مبلغاً صحيحاً أكبر من صفر.'));
    setBusy(true); setError(null);
    try {
      if (paymentDraft.target === 'credit') {
        await recordStudentCredit({ centerId, studentId: collectStudentId, amount, month: Number(month), year: Number(year), notes: paymentDraft.notes });
      } else {
        await recordPayment({ centerId, studentId: collectStudentId, dueId: paymentDraft.target, amount, month: Number(month), year: Number(year), notes: paymentDraft.notes });
      }
      toast.success('تم تسجيل التحصيل', paymentDraft.target === 'credit' ? 'سُجل المبلغ رصيداً مقدماً للطالب.' : 'حُدثت حالة المستحق بنجاح.');
      setCollectOpen(false); setPaymentDirty(false);
      await load();
    } catch (err) { setError(err); }
    finally { setBusy(false); }
  };
  const openCollectForDue = (due: Due) => void openStudentCollection(due.student_id, due.id);

  const openBatch = () => {
    const first = visibleGroups[0]?.id ?? '';
    setBatchGroup(selectedGroup && visibleGroups.some((g) => g.id === selectedGroup) ? selectedGroup : first);
    setBatchMembers([]); setBatchSelected([]); setBatchNotes(''); setError(null); setBatchOpen(true);
  };
  const toggleAllBatch = () => setBatchSelected((current) => current.length === batchEligibleIds.length ? [] : batchEligibleIds);
  const toggleBatchStudent = (studentId: string) => setBatchSelected((current) => current.includes(studentId) ? current.filter((id) => id !== studentId) : [...current, studentId]);
  const saveBatch = async () => {
    if (!centerId || batchSelectedRows.length === 0) return;
    setBusy(true); setError(null);
    try {
      const items = batchSelectedRows.flatMap((row) => row.dues.map((due) => ({ dueId: due.id, amount: Number(due.amount) })));
      const result = await recordBulkDuePayments({ centerId, month: Number(month), year: Number(year), items, notes: batchNotes });
      toast.success('تم حفظ التحصيل الجماعي', `تم تسجيل ${result.count} دفعة بإجمالي ${formatMoney(result.total)}.`);
      setBatchOpen(false); await load();
    } catch (err) { setError(err); }
    finally { setBusy(false); }
  };

  const settle = async () => {
    const studentId = statementAccount?.student.id;
    if (!centerId || !studentId) return;
    setBusy(true); setError(null);
    try {
      const result = await settleStudentAccount(centerId, studentId, settleNotes);
      toast.success('تمت تسوية حساب الطالب', `رصيد مصفّر: ${formatMoney(result.creditSettled)} · مديونية مسوّاة: ${formatMoney(result.debtSettled)}. لم يُنشأ أي إيراد جديد.`);
      setSettleConfirm(false);
      setStatementAccount(await readAccount(studentId));
      await load();
    } catch (err) { setError(err); }
    finally { setBusy(false); }
  };

  if (profile && !can(profile, 'collect')) {
    return <Card><Notice tone="error">ليس لديك صلاحية التحصيل.</Notice></Card>;
  }

  const selectedCollectStudent = studentsMap.get(collectStudentId);
  const collectDues = (collectAccount?.dues ?? []).filter((due) => Number(due.remaining || 0) > 0);
  const statementSummary = statementAccount?.summary;

  return (
    <>
      <PageHeader title="التحصيل وحسابات الطلاب" subtitle="تحصيل فردي أو جماعي، رصيد مقدم يخصم تلقائياً، وكشف حساب واضح لكل طالب." actions={<><Button type="button" variant="secondary" onClick={() => openPicker('statement')}>كشف حساب طالب</Button><Button type="button" variant="secondary" onClick={openBatch}>تحصيل جماعي</Button><Button type="button" onClick={() => openPicker('collect')}>+ تحصيل</Button><CollectionQrScanner onScanned={openCollectFromQr} /></>} />
      <ErrorNotice error={error} />
      {message ? <Notice tone="success">{message}</Notice> : null}

      <div className="grid grid-4" style={{ marginBottom: 18 }}>
        <Card className="compact kpi"><span className="muted">إجمالي المستحقات</span><div className="kpi-value">{formatMoney(dueTotal)}</div></Card>
        <Card className="compact kpi"><span className="muted">المحصل نقداً</span><div className="kpi-value">{formatMoney(paidTotal)}</div></Card>
        <Card className="compact kpi"><span className="muted">مستحقات معلقة</span><div className="kpi-value">{pendingDues.length}</div></Card>
        <Card className="compact kpi"><span className="muted">الفترة</span><div className="kpi-value">{arabicMonth(Number(month))}</div></Card>
      </div>

      <div className="grid grid-2">
        <Card className="stack">
          <div className="row-between"><h2 className="h3">الاستحقاق اليدوي</h2><Badge tone="info">شهري / أسبوعي / بالحصة</Badge></div>
          <div className="grid grid-2">
            <Select label="الشهر" value={month} onChange={(e) => setMonth(e.target.value)}>{Array.from({ length: 12 }, (_, i) => <option key={i + 1} value={i + 1}>{arabicMonth(i + 1)}</option>)}</Select>
            <Input label="السنة" type="number" value={year} onChange={(e) => setYear(e.target.value)} />
            <Select label="المجموعة" value={selectedGroup} onChange={(e) => setSelectedGroup(e.target.value)}>
              {visibleGroups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </Select>
          </div>
          {groupsMap.get(selectedGroup)?.due_mode === 'attendance' ? <Notice tone="info">هذه المجموعة تستخدم الاستحقاق التلقائي عند الحضور. غيّر الطريقة من «الصفوف والمجموعات» إذا احتجت التوليد اليدوي.</Notice> : <Button type="button" disabled={busy || !selectedGroup} onClick={generate}>توليد مستحقات المجموعة</Button>}
        </Card>

        <Card className="stack">
          <div className="row-between"><h2 className="h3">خيارات التحصيل السريع</h2><Badge tone="success">آمن وذري</Badge></div>
          <Notice>«تحصيل» يفتح ملف الطالب أولاً: يمكنك دفع مستحق محدد أو تسجيل مبلغ مقدم بلا مستحق. لا يُسجل أي مبلغ عند التحديد فقط.</Notice>
          <div className="grid grid-2">
            <Button type="button" variant="secondary" onClick={() => openPicker('collect')}>تحصيل من طالب</Button>
            <Button type="button" variant="secondary" onClick={openBatch}>تحصيل مجموعة</Button>
            <Button type="button" variant="ghost" onClick={() => openPicker('statement')}>عرض كشف الحساب</Button>
            <CollectionQrScanner onScanned={openCollectFromQr} />
          </div>
        </Card>
      </div>

      <Card className="stack" style={{ marginTop: 18 }}>
        <div className="row-between"><h2 className="h3">مستحقات الفترة</h2><Badge tone="info">{visibleDues.length}</Badge></div>
        {visibleDues.length === 0 ? <EmptyState title="لا توجد مستحقات" body="أنشئ المستحقات اليدوية أو فعّل الاستحقاق عند الحضور من إعدادات المجموعة." /> : (
          <div className="table-wrap"><table><thead><tr><th>الطالب</th><th>المجموعة</th><th>الطريقة</th><th>المبلغ</th><th>الحالة</th><th>تاريخ الإنشاء</th><th>إجراء</th></tr></thead><tbody>
            {visibleDues.map((due) => { const status = formatStatus(due.status); return <tr key={due.id}><td>{studentsMap.get(due.student_id)?.name ?? '—'}</td><td>{due.group_id ? groupsMap.get(due.group_id)?.name ?? '—' : '—'}</td><td><Badge tone={due.due_source === 'attendance' ? 'info' : 'default'}>{due.due_source === 'attendance' ? 'عند الحضور' : 'يدوي'}</Badge></td><td>{formatMoney(due.amount)}</td><td><Badge tone={status.tone}>{status.text}</Badge></td><td>{formatDate(due.created_at)}</td><td><div className="row"><Button type="button" variant="secondary" onClick={() => openCollectForDue(due)}>تحصيل</Button><Button type="button" variant="ghost" onClick={() => void openStatement(due.student_id)}>الحساب</Button></div></td></tr>; })}
          </tbody></table></div>
        )}
      </Card>

      <Modal open={pickerOpen} title={pickerIntent === 'collect' ? 'تحصيل من طالب' : 'اختيار طالب لكشف الحساب'} subtitle="ابحث بالاسم أو الهاتف، أو اختر الصف ثم المجموعة ثم الطالب." onClose={() => setPickerOpen(false)} wide footer={<Button type="button" variant="secondary" onClick={() => setPickerOpen(false)}>إغلاق</Button>}>
        <div className="stack">
          <div className="row"><Button type="button" variant={pickerMethod === 'search' ? 'primary' : 'secondary'} onClick={() => setPickerMethod('search')}>بحث بالاسم</Button><Button type="button" variant={pickerMethod === 'groups' ? 'primary' : 'secondary'} onClick={() => setPickerMethod('groups')}>الصف ← المجموعة ← الطالب</Button></div>
          {pickerMethod === 'search' ? <><Input label="اسم الطالب أو رقم الهاتف" value={studentSearch} onChange={(event) => setStudentSearch(event.target.value)} placeholder="اكتب الاسم أو الهاتف" autoFocus /><div className="stack">{filteredPickerStudents.length === 0 ? <EmptyState title="لا توجد نتائج" /> : filteredPickerStudents.map((student) => <button type="button" className="row-between card compact soft" key={student.id} onClick={() => void chooseStudent(student.id)}><span><strong>{student.name}</strong><small className="muted">{student.phone ?? student.guardian_phone ?? '—'} · {student.grade_id ? grades.find((grade) => grade.id === student.grade_id)?.name ?? 'صف غير محدد' : 'صف غير محدد'} · {student.group_id ? groupsMap.get(student.group_id)?.name ?? 'بلا مجموعة' : 'بلا مجموعة'}</small></span><span>‹</span></button>)}</div></> : <><div className="grid grid-2"><Select label="الصف" value={pickerGrade} onChange={(event) => { setPickerGrade(event.target.value); setPickerGroup(''); }}><option value="">اختر الصف</option>{grades.map((grade) => <option key={grade.id} value={grade.id}>{grade.name}</option>)}</Select><Select label="المجموعة" value={pickerGroup} disabled={!pickerGrade} onChange={(event) => setPickerGroup(event.target.value)}><option value="">اختر المجموعة</option>{pickerGroups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</Select></div>{pickerGroup ? <div className="stack">{pickerGroupStudents.length === 0 ? <EmptyState title="لا يوجد طلاب نشطون في المجموعة" /> : pickerGroupStudents.map((student) => <button type="button" className="row-between card compact soft" key={student.id} onClick={() => void chooseStudent(student.id)}><span><strong>{student.name}</strong><small className="muted" dir="ltr"> {student.phone ?? '—'}</small></span><span>‹</span></button>)}</div> : <Notice tone="info">اختر الصف ثم المجموعة لعرض أسماء طلابها.</Notice>}</>}
        </div>
      </Modal>

      <Modal open={collectOpen} title="تسجيل تحصيل" subtitle={selectedCollectStudent ? `${selectedCollectStudent.name} · راجع حساب الطالب قبل الحفظ` : 'التحصيل'} dirty={paymentDirty} onClose={() => setCollectOpen(false)} onSave={() => void collect()} saveLabel="تسجيل التحصيل" wide footer={<><Button type="button" variant="secondary" onClick={() => { setCollectOpen(false); void openStatement(collectStudentId); }}>كشف الحساب</Button><Button disabled={busy || !paymentDraft.target} type="button" onClick={() => void collect()}>{busy ? 'جاري الحفظ...' : 'تسجيل التحصيل'}</Button></>}>
        <div className="stack">
          {collectAccount ? <div className="grid grid-3"><Card className="compact soft kpi"><span className="muted">رصيد مقدم</span><div className="kpi-value">{money(collectAccount.summary.credit_balance)}</div></Card><Card className="compact soft kpi"><span className="muted">مبلغ مستحق</span><div className="kpi-value">{money(collectAccount.summary.amount_due)}</div></Card><Card className="compact soft kpi"><span className="muted">صافي الحساب</span><div className="kpi-value">{Number(collectAccount.summary.net_balance) >= 0 ? '+' : ''}{money(collectAccount.summary.net_balance)}</div></Card></div> : <Notice>جاري قراءة حساب الطالب…</Notice>}
          <div className="grid grid-2"><Select label="يوجّه التحصيل إلى" value={paymentDraft.target} onChange={(event) => { const target = event.target.value; const chosen = collectDues.find((due) => due.id === target); setPaymentDraft({ ...paymentDraft, target, amount: chosen ? String(Number(chosen.remaining)) : '' }); setPaymentDirty(true); }}><option value="credit">رصيد مقدم للطالب (بلا مستحق)</option>{collectDues.map((due) => <option key={due.id} value={due.id}>{due.due_source === 'attendance' ? 'استحقاق حضور' : `${arabicMonth(due.month)} ${due.due_year}`} · المتبقي {money(due.remaining)}</option>)}</Select><Input label="المبلغ المحصل" type="number" min="0" value={paymentDraft.amount} onChange={(event) => { setPaymentDraft({ ...paymentDraft, amount: event.target.value }); setPaymentDirty(true); }} /></div>
          <Input label="ملاحظات (اختياري)" value={paymentDraft.notes} onChange={(event) => { setPaymentDraft({ ...paymentDraft, notes: event.target.value }); setPaymentDirty(true); }} placeholder="مثال: دفع ولي الأمر نقداً" />
          {paymentDraft.target === 'credit' ? <Notice tone="info">يسجل هذا المبلغ مرة واحدة كتحصيل نقدي ورصيد دائن. سيُخصم تلقائياً من أي مستحق قائم أو من استحقاق الحضور التالي، دون إنشاء إيراد ثانٍ.</Notice> : <Notice>لا يمكن تجاوز المتبقي الظاهر للمستحق. يظهر كل توزيع للرصيد في كشف الحساب.</Notice>}
          <ErrorNotice error={error} />
        </div>
      </Modal>

      <Modal open={batchOpen} title="تحصيل جماعي سريع" subtitle="حدد الطلاب أولاً، راجعهم، ثم اضغط حفظ التحصيل. زر «تحديد الكل» لا يسجل أي مبلغ." onClose={() => setBatchOpen(false)} wide footer={<><Button type="button" variant="secondary" onClick={() => setBatchOpen(false)}>إلغاء</Button><Button type="button" disabled={busy || batchSelectedRows.length === 0} onClick={() => void saveBatch()}>{busy ? 'جاري الحفظ...' : `حفظ تحصيل ${batchSelectedRows.length} طالب`}</Button></>}>
        <div className="stack"><Select label="المجموعة" value={batchGroup} onChange={(event) => setBatchGroup(event.target.value)}><option value="">اختر المجموعة</option>{visibleGroups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</Select>{batchGroup ? <><div className="row-between"><span className="muted">المحدد: {batchSelectedRows.length} طالب · {formatMoney(batchTotal)}</span><Button type="button" variant="secondary" onClick={toggleAllBatch}>{batchSelected.length === batchEligibleIds.length && batchEligibleIds.length > 0 ? 'إلغاء تحديد الكل' : 'تحديد الكل'}</Button></div><Notice tone="info">تظهر المستحقات المعلقة كاملة القيمة فقط. المستحق الجزئي يُحصّل من نافذة الطالب لضمان المبلغ المتبقي الصحيح.</Notice><div className="table-wrap"><table><thead><tr><th>تحديد</th><th>الطالب</th><th>المستحقات الكاملة</th><th>القيمة</th><th>ملاحظة</th></tr></thead><tbody>{batchRows.map((row) => <tr key={row.student.id}><td><input aria-label={`تحديد ${row.student.name}`} type="checkbox" disabled={!row.dues.length} checked={batchSelected.includes(row.student.id)} onChange={() => toggleBatchStudent(row.student.id)} /></td><td>{row.student.name}</td><td>{row.dues.length}</td><td>{row.dues.length ? formatMoney(row.total) : '—'}</td><td>{row.hasPartial ? 'يوجد مستحق جزئي' : row.dues.length ? 'جاهز للتحصيل' : 'لا يوجد مستحق كامل'}</td></tr>)}</tbody></table></div>{batchRows.length === 0 ? <EmptyState title="لا يوجد طلاب في هذه المجموعة" /> : null}<Input label="ملاحظة مشتركة (اختياري)" value={batchNotes} onChange={(event) => setBatchNotes(event.target.value)} placeholder="تظهر في كل دفعة محفوظة" /></> : <Notice tone="info">اختر مجموعة لعرض كل طلابها.</Notice>}<ErrorNotice error={error} /></div>
      </Modal>

      <Modal open={statementOpen} title="كشف حساب الطالب" subtitle={statementAccount ? `${statementAccount.student.name} · كل الأرقام بعد توزيع الرصيد` : 'جاري تحميل الكشف'} onClose={() => setStatementOpen(false)} wide footer={<Button type="button" variant="secondary" onClick={() => setStatementOpen(false)}>إغلاق</Button>}>
        <div className="stack">{statementAccount ? <><div className="grid grid-3"><Card className="compact soft kpi"><span className="muted">رصيد دائن متاح</span><div className="kpi-value">{money(statementSummary?.credit_balance)}</div></Card><Card className="compact soft kpi"><span className="muted">مديونية متبقية</span><div className="kpi-value">{money(statementSummary?.amount_due)}</div></Card><Card className="compact soft kpi"><span className="muted">صافي الحساب</span><div className="kpi-value">{Number(statementSummary?.net_balance || 0) >= 0 ? '+' : ''}{money(statementSummary?.net_balance)}</div></Card></div><Card className="stack compact"><h3 className="h3">المستحقات</h3>{statementAccount.dues.length === 0 ? <p className="muted">لا توجد مستحقات.</p> : <div className="table-wrap"><table><thead><tr><th>النوع</th><th>القيمة</th><th>نقدي</th><th>من الرصيد</th><th>المتبقي</th></tr></thead><tbody>{statementAccount.dues.map((due) => <tr key={due.id}><td>{due.due_source === 'attendance' ? 'استحقاق حضور' : `${arabicMonth(due.month)} ${due.due_year}`}</td><td>{money(due.amount)}</td><td>{money(due.cash_paid)}</td><td>{money(due.credit_applied)}</td><td>{money(due.remaining)}</td></tr>)}</tbody></table></div>}</Card><Card className="stack compact"><h3 className="h3">التحصيلات المقدمة والرصيد</h3>{statementAccount.credits.length === 0 ? <p className="muted">لا يوجد رصيد مقدم مسجل.</p> : <div className="table-wrap"><table><thead><tr><th>التاريخ</th><th>المحصل</th><th>خُصم للمستحقات</th><th>المتبقي</th><th>ملاحظات</th></tr></thead><tbody>{statementAccount.credits.map((credit) => <tr key={credit.id}><td>{formatDate(credit.payment_date)}</td><td>{money(credit.amount)}</td><td>{money(credit.applied_to_dues)}</td><td>{money(credit.remaining)}</td><td>{credit.notes ?? '—'}</td></tr>)}</tbody></table></div>}</Card>{isOwner(profile) ? <Card className="stack compact"><h3 className="h3">تسوية الحساب إلى صفر</h3><p className="muted small">تستخدم فقط للإعفاء أو تصحيح الرصيد. لا تسجل دفعة جديدة، لذلك لا تكرر إيراد التحصيل.</p><Input label="سبب التسوية (اختياري)" value={settleNotes} onChange={(event) => setSettleNotes(event.target.value)} placeholder="مثال: إلغاء رصيد بموافقة الإدارة" /><Button type="button" variant="danger" disabled={busy || (Number(statementSummary?.credit_balance || 0) <= 0 && Number(statementSummary?.amount_due || 0) <= 0)} onClick={() => setSettleConfirm(true)}>تسوية الحساب إلى صفر</Button></Card> : null}</> : <Notice>جاري تحميل كشف الحساب…</Notice>}<ErrorNotice error={error} /></div>
      </Modal>

      <ConfirmDialog open={settleConfirm} title="تأكيد تسوية الحساب" body="ستُصفّر المديونية أو الرصيد المتبقي في كشف الطالب كتسوية موثقة، من دون تسجيل دفعة أو إيراد جديد. هل تريد المتابعة؟" confirmLabel="تأكيد التسوية" danger busy={busy} onConfirm={() => void settle()} onCancel={() => setSettleConfirm(false)} />
    </>
  );
}
