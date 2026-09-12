'use client';

import { useEffect, useState } from 'react';
import { Badge, Card, EmptyState, ErrorNotice, PageHeader, formatStatus } from '@/components/ui';
import { useSession } from '@/context/session';
import { fetchMyAttendance } from '@/lib/api';
import type { Attendance, SessionRecord } from '@/lib/types';
import { formatDate } from '@/lib/utils';

export default function StudentAttendancePage() {
  const { profile } = useSession();
  const [rows, setRows] = useState<(Attendance & { sessions?: SessionRecord | null })[]>([]);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => { if (profile?.student_id) fetchMyAttendance(profile.student_id).then(setRows).catch(setError); }, [profile?.student_id]);
  return <><PageHeader title="سجل حضوري" subtitle="كل حضورك المسجل من التطبيق أو الويب." /><ErrorNotice error={error} /><Card className="stack">{rows.length === 0 ? <EmptyState title="لا يوجد حضور" /> : <div className="table-wrap"><table><thead><tr><th>التاريخ</th><th>الحالة</th><th>ملاحظات</th></tr></thead><tbody>{rows.map((r) => { const st = formatStatus(r.status); return <tr key={r.id}><td>{r.sessions?.session_date ? formatDate(r.sessions.session_date) : formatDate(r.created_at)}</td><td><Badge tone={st.tone}>{st.text}</Badge></td><td>{r.notes ?? '—'}</td></tr>; })}</tbody></table></div>}</Card></>;
}
