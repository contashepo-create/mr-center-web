'use client';

import { useEffect, useState } from 'react';
import { Badge, Card, ErrorNotice, LinkButton, PageHeader } from '@/components/ui';
import { devFetchCenters, devFetchPendingRequests, devFetchProfilesCount, type CenterWithSub } from '@/lib/api';
import type { SubscriptionRequest } from '@/lib/types';

export default function DeveloperDashboardPage() {
  const [centers, setCenters] = useState<CenterWithSub[]>([]);
  const [requests, setRequests] = useState<SubscriptionRequest[]>([]);
  const [profiles, setProfiles] = useState<{ total: number; byRole: Record<string, number> } | null>(null);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => { Promise.all([devFetchCenters(), devFetchPendingRequests(), devFetchProfilesCount()]).then(([c, r, p]) => { setCenters(c); setRequests(r); setProfiles(p); }).catch(setError); }, []);
  return <><PageHeader title="لوحة المطور" subtitle="إدارة النظام كله من نسخة الويب بنفس صلاحية super_admin." actions={<LinkButton href="/developer/centers">إدارة السناتر</LinkButton>} /><ErrorNotice error={error} /><div className="grid grid-4" style={{ marginBottom: 18 }}><Card className="compact kpi"><span className="muted">السناتر</span><div className="kpi-value">{centers.length}</div></Card><Card className="compact kpi"><span className="muted">سناتر نشطة</span><div className="kpi-value">{centers.filter((c) => c.status === 'active').length}</div></Card><Card className="compact kpi"><span className="muted">طلبات معلقة</span><div className="kpi-value">{requests.length}</div></Card><Card className="compact kpi"><span className="muted">المستخدمون</span><div className="kpi-value">{profiles?.total ?? '—'}</div></Card></div><div className="grid grid-2"><Card className="stack"><h2 className="h3">الأدوار</h2><div className="row">{Object.entries(profiles?.byRole ?? {}).map(([role, count]) => <Badge key={role} tone="info">{role}: {count}</Badge>)}</div></Card><Card className="stack"><h2 className="h3">اختصارات</h2><div className="grid grid-2"><LinkButton href="/developer/subscriptions" variant="secondary">طلبات الاشتراك</LinkButton><LinkButton href="/developer/broadcast" variant="secondary">إرسال إشعار</LinkButton><LinkButton href="/developer/support" variant="secondary">الدعم</LinkButton><LinkButton href="/developer/app-info" variant="secondary">حول التطبيق</LinkButton></div></Card></div></>;
}
