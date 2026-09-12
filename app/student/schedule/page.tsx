'use client';

import { useEffect, useMemo, useState } from 'react';
import { Badge, Card, EmptyState, ErrorNotice, PageHeader } from '@/components/ui';
import { useSession } from '@/context/session';
import { fetchGroups, fetchStudentById, fetchStudentGroups } from '@/lib/api';
import type { Group, Student } from '@/lib/types';
import { WEEK_DAYS, arabicDay, billingLabel, formatMoney, formatTimeAr } from '@/lib/utils';

export default function StudentSchedulePage() {
  const { profile } = useSession();
  const [student, setStudent] = useState<Student | null>(null);
  const [groups, setGroups] = useState<Group[]>([]);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    if (!profile?.center_id || !profile.student_id) return;
    Promise.all([fetchStudentById(profile.student_id), fetchGroups(profile.center_id), fetchStudentGroups(profile.student_id)])
      .then(([st, all, extra]) => { setStudent(st); const ids = new Set([st?.group_id, ...extra.map((x) => x.group_id)].filter(Boolean) as string[]); setGroups(all.filter((g) => ids.has(g.id))); })
      .catch(setError);
  }, [profile?.center_id, profile?.student_id]);
  const byDay = useMemo(() => Object.fromEntries(WEEK_DAYS.map((d) => [d, groups.filter((g) => (g.days ?? []).includes(d)).sort((a, b) => (a.start_time || '').localeCompare(b.start_time || ''))])), [groups]);
  return <><PageHeader title="جدولي" subtitle={`مجموعات ${student?.name ?? profile?.full_name ?? ''}`} /><ErrorNotice error={error} /><div className="grid grid-2">{WEEK_DAYS.map((day) => <Card key={day} className="stack"><div className="row-between"><h2 className="h3">{arabicDay(day)}</h2><Badge tone="info">{byDay[day].length}</Badge></div>{byDay[day].length === 0 ? <EmptyState title="لا توجد حصص" /> : byDay[day].map((g) => <div key={g.id} className="card compact soft"><strong>{g.name}</strong><p className="muted small">{g.teacher_name || '—'} · {formatTimeAr(g.start_time)} - {formatTimeAr(g.end_time)}</p><Badge>{billingLabel(g.billing_type)} · {formatMoney(g.billing_type === 'weekly' ? g.weekly_price : g.billing_type === 'per_session' ? g.session_price : g.monthly_fee)}</Badge></div>)}</Card>)}</div></>;
}
