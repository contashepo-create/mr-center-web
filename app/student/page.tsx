'use client';

import { useEffect, useState } from 'react';
import { Badge, Card, EmptyState, ErrorNotice, LinkButton, PageHeader, formatStatus } from '@/components/ui';
import { useSession } from '@/context/session';
import { fetchAnnouncements, fetchDuesForStudent, fetchGradesForStudent, fetchMyAttendance } from '@/lib/api';
import type { Announcement, Attendance, Due, ManualGrade, SessionRecord } from '@/lib/types';
import { formatDate, formatMoney } from '@/lib/utils';

export default function StudentHomePage() {
  const { profile } = useSession();
  const centerId = profile?.center_id;
  const studentId = profile?.student_id;
  const [attendance, setAttendance] = useState<(Attendance & { sessions?: SessionRecord | null })[]>([]);
  const [dues, setDues] = useState<Due[]>([]);
  const [grades, setGrades] = useState<ManualGrade[]>([]);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    if (!studentId || !centerId) return;
    Promise.all([fetchMyAttendance(studentId), fetchDuesForStudent(studentId), fetchGradesForStudent(studentId), fetchAnnouncements(centerId)])
      .then(([a, d, g, an]) => { setAttendance(a); setDues(d); setGrades(g); setAnnouncements(an.slice(0, 3)); })
      .catch(setError);
  }, [studentId, centerId]);

  const pending = dues.filter((d) => d.status !== 'paid');
  const avg = grades.length ? Math.round((grades.reduce((sum, g) => sum + (Number(g.score) / Math.max(1, Number(g.max_score))) * 100, 0) / grades.length)) : null;

  return <>
    <PageHeader title={`أهلاً ${profile?.full_name ?? ''}`} subtitle="حساب الطالب متصل بنفس بيانات تطبيق Android." />
    <ErrorNotice error={error} />
    <div className="grid grid-4" style={{ marginBottom: 18 }}>
      <Card className="compact kpi"><span className="muted">سجلات الحضور</span><div className="kpi-value">{attendance.length}</div></Card>
      <Card className="compact kpi"><span className="muted">مستحقات معلقة</span><div className="kpi-value">{pending.length}</div></Card>
      <Card className="compact kpi"><span className="muted">المبلغ المعلق</span><div className="kpi-value">{formatMoney(pending.reduce((s, d) => s + Number(d.amount || 0), 0))}</div></Card>
      <Card className="compact kpi"><span className="muted">متوسط الدرجات</span><div className="kpi-value">{avg === null ? '—' : `${avg}%`}</div></Card>
    </div>
    <div className="grid grid-2">
      <Card className="stack"><div className="row-between"><h2 className="h3">آخر الحضور</h2><LinkButton href="/student/attendance" variant="secondary">عرض الكل</LinkButton></div>{attendance.length === 0 ? <EmptyState title="لا يوجد حضور" /> : attendance.slice(0, 5).map((a) => { const st = formatStatus(a.status); return <div key={a.id} className="row-between card compact soft"><span>{a.sessions?.session_date ? formatDate(a.sessions.session_date) : formatDate(a.created_at)}</span><Badge tone={st.tone}>{st.text}</Badge></div>; })}</Card>
      <Card className="stack"><div className="row-between"><h2 className="h3">الإعلانات</h2><Badge tone="info">{announcements.length}</Badge></div>{announcements.length === 0 ? <EmptyState title="لا توجد إعلانات" /> : announcements.map((a) => <div key={a.id} className="card compact soft"><strong>{a.title}</strong><p className="muted small">{a.body}</p></div>)}</Card>
    </div>
  </>;
}
