'use client';

import { useEffect, useMemo, useState } from 'react';
import { Badge, Button, Card, EmptyState, ErrorNotice, PageHeader } from '@/components/ui';
import { useSession } from '@/context/session';
import { fetchGroups } from '@/lib/api';
import { useTeacherGroupIds } from '@/lib/staff';
import type { Group } from '@/lib/types';
import { WEEK_DAYS, arabicDay, billingLabel, findGroupConflicts, formatMoney, formatTimeAr } from '@/lib/utils';
import { buildReportHtml, printCenterReport } from '@/lib/report';

export default function AdminSchedulePage() {
  const { profile } = useSession();
  const [groups, setGroups] = useState<Group[]>([]);
  const [error, setError] = useState<unknown>(null);
  const teacherScope = useTeacherGroupIds();
  useEffect(() => { if (profile?.center_id) fetchGroups(profile.center_id).then(setGroups).catch(setError); }, [profile?.center_id]);
  const visibleGroups = useMemo(() => {
    if (profile?.role !== 'teacher') return groups;
    if (!teacherScope) return [];
    return groups.filter((g) => teacherScope.includes(g.id));
  }, [groups, profile?.role, teacherScope]);
  const conflicts = useMemo(() => findGroupConflicts(visibleGroups.map((g) => ({ id: g.id, name: g.name, days: g.days, start_time: g.start_time, end_time: g.end_time }))), [visibleGroups]);
  const byDay = (day: string) => visibleGroups.filter((g) => (g.days ?? []).includes(day)).sort((a, b) => (a.start_time || '').localeCompare(b.start_time || ''));
  const print = () => void printCenterReport(profile?.center_id, (branding) => buildReportHtml('جدول الحصص', 'كل مجموعات السنتر حسب الأيام', WEEK_DAYS.map((day) => ({ title: arabicDay(day), headers: ['المجموعة', 'المدرس', 'الوقت', 'الدفع'], rows: byDay(day).map((g) => [g.name, g.teacher_name || '—', `${formatTimeAr(g.start_time)} - ${formatTimeAr(g.end_time)}`, `${billingLabel(g.billing_type)} · ${formatMoney(g.billing_type === 'weekly' ? g.weekly_price : g.billing_type === 'per_session' ? g.session_price : g.monthly_fee)}`]) })), { name: profile?.full_name, branding }));
  return <><PageHeader title="الجدول الأسبوعي" subtitle="عرض مواعيد كل المجموعات وكشف التعارضات." actions={<Button type="button" variant="secondary" onClick={print}>طباعة / PDF</Button>} /><ErrorNotice error={error} />{conflicts.length > 0 ? <Card className="stack" style={{ marginBottom: 18 }}><h2 className="h3">تعارضات محتملة</h2>{conflicts.map((c, i) => <div key={i} className="notice warn">تعارض بين {c.aName} و {c.bName} في {c.days}</div>)}</Card> : null}<div className="grid grid-2">{WEEK_DAYS.map((day) => <Card key={day} className="stack"><div className="row-between"><h2 className="h3">{arabicDay(day)}</h2><Badge tone="info">{byDay(day).length}</Badge></div>{byDay(day).length === 0 ? <EmptyState title="لا توجد حصص" /> : byDay(day).map((g) => <div key={g.id} className="card compact soft"><div className="row-between"><strong>{g.name}</strong><Badge tone="success">{billingLabel(g.billing_type)}</Badge></div><p className="muted small">{g.teacher_name || '—'} · {formatTimeAr(g.start_time)} - {formatTimeAr(g.end_time)}</p></div>)}</Card>)}</div></>;
}
