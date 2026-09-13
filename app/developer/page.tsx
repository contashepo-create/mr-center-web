'use client';

import { useEffect, useState } from 'react';
import { Badge, Button, Card, EmptyState, ErrorNotice, LinkButton, PageHeader } from '@/components/ui';
import { devFetchCenters, devFetchPendingRequests, devFetchProfilesCount, type CenterWithSub } from '@/lib/api';
import { devFetchVisitorStats, devListCenterOwnerPresence, devListVisitors, devSetDeviceBlocked, type CenterOwnerPresence, type VisitorRow, type VisitorStats } from '@/lib/features';
import type { SubscriptionRequest } from '@/lib/types';
import { formatDate } from '@/lib/utils';

export default function DeveloperDashboardPage() {
  const [centers, setCenters] = useState<CenterWithSub[]>([]);
  const [requests, setRequests] = useState<SubscriptionRequest[]>([]);
  const [profiles, setProfiles] = useState<{ total: number; byRole: Record<string, number> } | null>(null);
  const [visitors, setVisitors] = useState<VisitorStats | null>(null);
  const [devices, setDevices] = useState<VisitorRow[] | null>(null);
  const [ownerPresence, setOwnerPresence] = useState<CenterOwnerPresence[] | null>(null);
  const [blockBusy, setBlockBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  const load = async () => {
    try {
      const [c, r, p, v, d, presence] = await Promise.all([
        devFetchCenters(),
        devFetchPendingRequests(),
        devFetchProfilesCount(),
        devFetchVisitorStats().catch(() => null),
        devListVisitors().catch(() => null),
        devListCenterOwnerPresence().catch(() => null),
      ]);
      setCenters(c); setRequests(r); setProfiles(p); setVisitors(v); setDevices(d); setOwnerPresence(presence);
    } catch (err) { setError(err); }
  };
  useEffect(() => { void load(); }, []);

  const toggleBlock = async (row: VisitorRow) => {
    setBlockBusy(row.device_id);
    setError(null);
    try {
      await devSetDeviceBlocked(row.device_id, !row.blocked);
      await load();
    } catch (err) { setError(err); }
    finally { setBlockBusy(null); }
  };

  return <>
    <PageHeader title="لوحة المطور" subtitle="إدارة النظام كله من نسخة الويب." actions={<LinkButton href="/developer/centers">إدارة السناتر</LinkButton>} />
    <ErrorNotice error={error} />

    <div className="grid grid-4" style={{ marginBottom: 18 }}>
      <Card className="compact kpi"><span className="muted">السناتر</span><div className="kpi-value">{centers.length}</div></Card>
      <Card className="compact kpi"><span className="muted">سناتر نشطة</span><div className="kpi-value">{centers.filter((c) => c.status === 'active').length}</div></Card>
      <Card className="compact kpi"><span className="muted">طلبات معلقة</span><div className="kpi-value">{requests.length}</div></Card>
      <Card className="compact kpi"><span className="muted">المستخدمون</span><div className="kpi-value">{profiles?.total ?? '—'}</div></Card>
    </div>

    <div className="grid grid-2" style={{ marginBottom: 18 }}>
      <Card className="stack">
        <div className="row-between">
          <h2 className="h3">عداد الزوار</h2>
          <Badge tone="info">كل جهاز يُعدّ مرة واحدة</Badge>
        </div>
        {!visitors ? (
          <EmptyState title="لا توجد بيانات" body="يظهر العداد بعد تطبيق ترحيل 20260912_fiscal_accounting.sql على قاعدة البيانات." />
        ) : (
          <div className="grid grid-3">
            <div className="kpi"><span className="muted">إجمالي الأجهزة</span><div className="kpi-value">{visitors.total}</div></div>
            <div className="kpi"><span className="muted">اليوم</span><div className="kpi-value">{visitors.today}</div></div>
            <div className="kpi"><span className="muted">آخر 7 أيام</span><div className="kpi-value">{visitors.week}</div></div>
          </div>
        )}
      </Card>
      <Card className="stack">
        <h2 className="h3">الأدوار</h2>
        <div className="row">
          {Object.entries(profiles?.byRole ?? {}).map(([role, count]) => <Badge key={role} tone="info">{role}: {count}</Badge>)}
        </div>
      </Card>
    </div>

    <Card className="stack" style={{ marginBottom: 18 }}>
      <div className="row-between"><div><h2 className="h3">آخر زيارة لأصحاب السناتر</h2><p className="muted small" style={{ margin: '5px 0 0' }}>حضور الحساب المسجل فقط؛ لا يعتمد على عنوان IP ولا يكشف الأجهزة للسناتر.</p></div><Badge tone="info">{ownerPresence?.length ?? 0}</Badge></div>
      {!ownerPresence ? <EmptyState title="لا توجد بيانات حضور بعد" body="تظهر الزيارة بعد تطبيق ترحيل مركز التواصل وفتح صاحب السنتر للتطبيق." /> : ownerPresence.length === 0 ? <EmptyState title="لا يوجد أصحاب سناتر بعد" /> : <div className="table-wrap"><table><thead><tr><th>السنتر</th><th>صاحب السنتر</th><th>آخر زيارة</th><th>المنصة</th></tr></thead><tbody>{ownerPresence.map((owner) => <tr key={owner.account_id}><td>{owner.center_name}<span className="tiny muted"> · {owner.center_code}</span></td><td>{owner.owner_name}</td><td>{owner.last_seen ? formatDate(owner.last_seen) : 'لم يفتح النسخة المحدثة بعد'}</td><td>{owner.platform || '—'}</td></tr>)}</tbody></table></div>}
    </Card>

    <Card className="stack" style={{ marginBottom: 18 }}>
      <div className="row-between">
        <h2 className="h3">الأجهزة المسجلة</h2>
        <Badge tone={devices?.some((d) => d.blocked) ? 'danger' : 'default'}>{devices?.filter((d) => d.blocked).length ?? 0} محجوب</Badge>
      </div>
      {!devices ? (
        <EmptyState title="لا توجد بيانات أجهزة" body="تظهر القائمة بعد تطبيق الترحيل وتسجيل أول زيارة." />
      ) : devices.length === 0 ? (
        <EmptyState title="لا توجد أجهزة مسجلة بعد" />
      ) : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>معرّف الجهاز</th><th>أول ظهور</th><th>آخر نشاط</th><th>الحالة</th><th>إجراء</th></tr></thead>
            <tbody>
              {devices.map((d) => (
                <tr key={d.id}>
                  <td dir="ltr" style={{ fontFamily: 'monospace', fontSize: '.8rem' }}>{d.device_id}</td>
                  <td>{formatDate(d.first_seen)}</td>
                  <td>{formatDate(d.last_seen)}</td>
                  <td><Badge tone={d.blocked ? 'danger' : 'success'}>{d.blocked ? 'محجوب' : 'نشط'}</Badge></td>
                  <td><Button type="button" variant={d.blocked ? 'secondary' : 'danger'} disabled={blockBusy === d.device_id} onClick={() => void toggleBlock(d)}>{blockBusy === d.device_id ? 'جارٍ...' : d.blocked ? 'إلغاء الحجب' : 'حجب الجهاز'}</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>

    <Card className="stack">
      <h2 className="h3">اختصارات</h2>
      <div className="grid grid-2">
        <LinkButton href="/developer/subscriptions" variant="secondary">طلبات الاشتراك</LinkButton>
        <LinkButton href="/developer/broadcast" variant="secondary">إرسال إشعار</LinkButton>
        <LinkButton href="/developer/support" variant="secondary">الدعم</LinkButton>
        <LinkButton href="/developer/app-info" variant="secondary">حول التطبيق</LinkButton>
      </div>
    </Card>
  </>;
}
