'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Badge, Button, Card, EmptyState, ErrorNotice, PageHeader, formatStatus } from '@/components/ui';
import { devFetchCenters, devSetCenterStatus, type CenterWithSub } from '@/lib/api';
import { devGetAccountingState, devSetAccounting } from '@/lib/features';
import { planLabel } from '@/lib/billing';
import { formatDate } from '@/lib/utils';

export default function DeveloperCentersPage() {
  const [rows, setRows] = useState<CenterWithSub[]>([]);
  const [accMap, setAccMap] = useState<Record<string, boolean>>({});
  const [accBusy, setAccBusy] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<unknown>(null);

  const load = async () => {
    try {
      const data = await devFetchCenters();
      setRows(data);
      // قراءة حالة خدمة المحاسبة لكل سنتر لعرضها في القائمة
      const states = await Promise.allSettled(data.map((c) => devGetAccountingState(c.id)));
      const map: Record<string, boolean> = {};
      data.forEach((c, i) => {
        const s = states[i];
        map[c.id] = s.status === 'fulfilled' ? s.value.enabled : false;
      });
      setAccMap(map);
    } catch (err) { setError(err); }
  };
  useEffect(() => { void load(); }, []);

  const toggle = async (c: CenterWithSub) => { try { await devSetCenterStatus(c.id, c.status === 'active' ? 'suspended' : 'active'); await load(); } catch (err) { setError(err); } };

  const toggleAccounting = async (c: CenterWithSub) => {
    setAccBusy((m) => ({ ...m, [c.id]: true }));
    setError(null);
    try {
      const next = !(accMap[c.id] ?? false);
      await devSetAccounting(c.id, next);
      setAccMap((m) => ({ ...m, [c.id]: next }));
    } catch (err) { setError(err); }
    finally { setAccBusy((m) => ({ ...m, [c.id]: false })); }
  };

  return <><PageHeader title="السناتر" subtitle="إيقاف/تفعيل أي سنتر، ومراجعة الاشتراك وعدد الطلاب، وتفعيل/إيقاف خدمة المحاسبة لكل سنتر." /><ErrorNotice error={error} /><Card className="stack">{rows.length === 0 ? <EmptyState title="لا توجد سناتر" /> : <div className="table-wrap"><table><thead><tr><th>السنتر</th><th>الكود</th><th>المالك</th><th>الطلاب</th><th>الاشتراك</th><th>الحالة</th><th>المحاسبة</th><th>إجراءات</th></tr></thead><tbody>{rows.map((c) => { const st = formatStatus(c.status); const acc = accMap[c.id] ?? false; return <tr key={c.id}><td><Link href={`/developer/centers/${c.id}`}><strong>{c.name}</strong></Link><div className="tiny muted">{c.kind === 'solo' ? 'مدرس خصوصي' : 'سنتر'}</div></td><td dir="ltr">{c.code}</td><td>{c.owner_name}<div className="tiny muted" dir="ltr">{c.owner_phone}</div></td><td>{c.students_count ?? 0}</td><td>{planLabel(c.latest_sub?.plan_type)}<div className="tiny muted">{c.latest_sub?.ends_on ? formatDate(c.latest_sub.ends_on) : '—'}</div></td><td><Badge tone={st.tone}>{st.text}</Badge></td><td><div className="row" style={{ gap: 6 }}><Badge tone={acc ? 'success' : 'default'}>{acc ? 'مفعّلة' : 'غير مفعّلة'}</Badge><Button type="button" variant={acc ? 'danger' : 'secondary'} disabled={accBusy[c.id]} onClick={() => void toggleAccounting(c)}>{accBusy[c.id] ? '...' : acc ? 'إيقاف' : 'تفعيل'}</Button></div></td><td><Button type="button" variant={c.status === 'active' ? 'danger' : 'secondary'} onClick={() => void toggle(c)}>{c.status === 'active' ? 'إيقاف' : 'تفعيل'}</Button></td></tr>; })}</tbody></table></div>}</Card></>;
}
