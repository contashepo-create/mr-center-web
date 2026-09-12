'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Badge, Card, EmptyState, ErrorNotice, LinkButton, PageHeader } from '@/components/ui';
import { useSession } from '@/context/session';
import { fetchAdminStats, fetchAnnouncements, fetchMyCenter, type AdminStats } from '@/lib/api';
import { planLabel } from '@/lib/billing';
import { isOwner } from '@/lib/rbac';
import type { Announcement, Center } from '@/lib/types';
import { formatDate, formatMoney } from '@/lib/utils';

export default function AdminDashboardPage() {
  const { profile, subscription } = useSession();
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [center, setCenter] = useState<Center | null>(null);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [error, setError] = useState<unknown>(null);
  const centerId = profile?.center_id;

  useEffect(() => {
    if (!centerId) return;
    let cancelled = false;
    Promise.all([fetchAdminStats(centerId), fetchMyCenter(centerId), fetchAnnouncements(centerId)])
      .then(([s, c, a]) => { if (!cancelled) { setStats(s); setCenter(c); setAnnouncements(a.slice(0, 4)); } })
      .catch((err) => { if (!cancelled) setError(err); });
    return () => { cancelled = true; };
  }, [centerId]);

  const cards = [
    ['الطلاب النشطون', stats?.students ?? '—', '👥'],
    ['المجموعات', stats?.groups ?? '—', '🗂'],
    ['حضور اليوم', stats ? `${stats.presentToday} / ${stats.absentToday}` : '—', '✓'],
    ['تحصيل الشهر', stats ? formatMoney(stats.paidThisMonth) : '—', '💳'],
  ];

  return (
    <>
      <PageHeader
        title={`أهلاً ${profile?.full_name ?? ''}`}
        subtitle={center ? `${center.name} · كود السنتر ${center.code}` : 'لوحة إدارة السنتر المرتبطة بنفس بيانات تطبيق Android'}
        actions={<LinkButton href="/admin/students">إضافة/إدارة الطلاب</LinkButton>}
      />
      <ErrorNotice error={error} />

      <div className="grid grid-4" style={{ marginBottom: 18 }}>
        {cards.map(([label, value, icon]) => (
          <Card className="compact kpi" key={label}>
            <div className="row-between"><span className="muted">{label}</span><span>{icon}</span></div>
            <div className="kpi-value">{value}</div>
          </Card>
        ))}
      </div>

      <div className="grid grid-2">
        {isOwner(profile) ? (
          <Card className="stack">
            <div className="row-between">
              <h2 className="h3">الاشتراك</h2>
              <Badge tone={subscription?.status === 'active' ? 'success' : 'warn'}>{subscription?.status ?? '—'}</Badge>
            </div>
            <p className="muted">الباقة: <b>{planLabel(subscription?.plan_type)}</b></p>
            <p className="muted">ينتهي في: <b>{subscription?.ends_on ? formatDate(subscription.ends_on) : '—'}</b></p>
            {typeof subscription?.days_left === 'number' ? <p className="muted">المتبقي: <b>{subscription.days_left}</b> يوم</p> : null}
            <LinkButton href="/admin/subscription" variant="secondary">إدارة الاشتراك</LinkButton>
          </Card>
        ) : null}

        <Card className="stack">
          <div className="row-between">
            <h2 className="h3">إجراءات سريعة</h2>
            <Badge tone="info">Web</Badge>
          </div>
          <div className="grid grid-2">
            <LinkButton href="/admin/groups" variant="secondary">المجموعات</LinkButton>
            <LinkButton href="/admin/attendance" variant="secondary">الحضور</LinkButton>
            <LinkButton href="/admin/payments" variant="secondary">المدفوعات</LinkButton>
            <LinkButton href="/admin/announcements" variant="secondary">الإعلانات</LinkButton>
          </div>
        </Card>
      </div>

      <Card className="stack" style={{ marginTop: 18 }}>
        <div className="row-between">
          <h2 className="h3">آخر الإعلانات</h2>
          <Link href="/admin/announcements" className="muted small">عرض الكل</Link>
        </div>
        {announcements.length === 0 ? <EmptyState title="لا توجد إعلانات" body="أنشئ إعلاناً ليظهر للطلاب في التطبيق والويب." /> : (
          <div className="grid grid-2">
            {announcements.map((a) => (
              <div key={a.id} className="card compact soft">
                <div className="row-between"><strong>{a.title}</strong>{a.pinned ? <Badge tone="warn">مثبت</Badge> : null}</div>
                <p className="muted small" style={{ lineHeight: 1.7 }}>{a.body}</p>
              </div>
            ))}
          </div>
        )}
      </Card>
    </>
  );
}
