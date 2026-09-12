'use client';

import { useEffect, useMemo, useState } from 'react';
import { Badge, Button, Card, EmptyState, ErrorNotice, Input, Notice, PageHeader, Select, formatStatus } from '@/components/ui';
import { useSession } from '@/context/session';
import { fetchAttendanceForSession, fetchGroupMembers, fetchGroups, findSession, getOrCreateSession, saveAttendance } from '@/lib/api';
import type { AttendanceStatus, Group, Student } from '@/lib/types';
import { can } from '@/lib/rbac';
import { useTeacherGroupIds } from '@/lib/staff';
import { todayIso } from '@/lib/utils';

export default function AttendancePage() {
  const { profile } = useSession();
  const centerId = profile?.center_id;
  const [groups, setGroups] = useState<Group[]>([]);
  const [groupId, setGroupId] = useState('');
  const [date, setDate] = useState(todayIso());
  const [students, setStudents] = useState<Student[]>([]);
  const [records, setRecords] = useState<Record<string, AttendanceStatus>>({});
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [message, setMessage] = useState<string | null>(null);
  const teacherScope = useTeacherGroupIds();
  const visibleGroups = useMemo(() => {
    if (profile?.role !== 'teacher') return groups;
    if (!teacherScope) return [];
    return groups.filter((g) => teacherScope.includes(g.id));
  }, [groups, profile?.role, teacherScope]);

  const selectedGroup = useMemo(() => visibleGroups.find((g) => g.id === groupId), [visibleGroups, groupId]);

  useEffect(() => {
    if (!centerId) return;
    fetchGroups(centerId).then((list) => { setGroups(list); }).catch(setError);
  }, [centerId]);

  useEffect(() => {
    if (visibleGroups.length === 0) { setGroupId(''); return; }
    if (!groupId || !visibleGroups.some((g) => g.id === groupId)) setGroupId(visibleGroups[0].id);
  }, [visibleGroups, groupId]);

  const loadSheet = async () => {
    if (!centerId || !groupId) return;
    setBusy(true); setError(null); setMessage(null);
    try {
      const members = await fetchGroupMembers(centerId, groupId);
      setStudents(members);
      const sess = await findSession(centerId, groupId, date);
      setSessionId(sess?.id ?? null);
      if (sess) {
        const attendance = await fetchAttendanceForSession(sess.id);
        setRecords(Object.fromEntries(attendance.map((a) => [a.student_id, a.status])));
      } else {
        setRecords({});
      }
    } catch (err) { setError(err); }
    finally { setBusy(false); }
  };

  useEffect(() => { void loadSheet(); }, [centerId, groupId, date]);

  const setAll = (status: AttendanceStatus) => setRecords(Object.fromEntries(students.map((s) => [s.id, status])));

  const save = async () => {
    if (!centerId || !groupId) return;
    setBusy(true); setError(null); setMessage(null);
    try {
      const sess = sessionId ? { id: sessionId } : await getOrCreateSession(centerId, groupId, date);
      await saveAttendance(centerId, sess.id, students.map((s) => ({ student_id: s.id, status: records[s.id] ?? 'absent' })));
      setSessionId(sess.id);
      setMessage('تم حفظ كشف الحضور. سيظهر فوراً للطالب على التطبيق والويب.');
    } catch (err) { setError(err); }
    finally { setBusy(false); }
  };

  if (profile && !can(profile, 'attendance')) {
    return <Card><Notice tone="error">ليس لديك صلاحية تسجيل الحضور.</Notice></Card>;
  }

  return (
    <>
      <PageHeader title="الحضور" subtitle="اختيار مجموعة وتاريخ ثم تسجيل حضور الطلاب." />
      <ErrorNotice error={error} />
      {message ? <Notice tone="success">{message}</Notice> : null}

      <Card className="stack" style={{ marginBottom: 18 }}>
        <div className="grid grid-3">
          <Select label="المجموعة" value={groupId} onChange={(e) => setGroupId(e.target.value)}>
            <option value="">اختر مجموعة</option>
            {visibleGroups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </Select>
          <Input label="التاريخ" type="date" max={todayIso()} value={date} onChange={(e) => setDate(e.target.value)} />
          <div className="input-wrap"><span className="label">الحصة</span><div className="notice">{sessionId ? 'حصة محفوظة موجودة' : 'لن تُنشأ الحصة إلا عند الحفظ'}</div></div>
        </div>
        <div className="row">
          <Button type="button" variant="secondary" onClick={() => setAll('present')}>تحديد الكل حاضر</Button>
          <Button type="button" variant="secondary" onClick={() => setAll('absent')}>تحديد الكل غائب</Button>
          <Button type="button" disabled={busy || students.length === 0} onClick={save}>{busy ? 'جاري الحفظ...' : 'حفظ الحضور'}</Button>
        </div>
      </Card>

      <Card className="stack">
        <div className="row-between">
          <h2 className="h3">كشف {selectedGroup?.name ?? ''}</h2>
          <Badge tone="info">{students.length} طالب</Badge>
        </div>
        {students.length === 0 ? <EmptyState title="لا يوجد طلاب في المجموعة" body="أضف طلاباً للمجموعة من صفحة الطلاب أولاً." /> : (
          <div className="table-wrap"><table><thead><tr><th>الطالب</th><th>الهاتف</th><th>الحالة</th><th>تسجيل</th></tr></thead><tbody>
            {students.map((s) => {
              const status = records[s.id] ?? 'absent';
              const st = formatStatus(status);
              return <tr key={s.id}>
                <td><strong>{s.name}</strong></td>
                <td dir="ltr">{s.phone ?? '—'}</td>
                <td><Badge tone={st.tone}>{st.text}</Badge></td>
                <td><div className="tabs">
                  {(['present', 'late', 'absent'] as AttendanceStatus[]).map((x) => <button key={x} type="button" className={`tab ${status === x ? 'active' : ''}`} onClick={() => setRecords((r) => ({ ...r, [s.id]: x }))}>{formatStatus(x).text}</button>)}
                </div></td>
              </tr>;
            })}
          </tbody></table></div>
        )}
      </Card>
    </>
  );
}
