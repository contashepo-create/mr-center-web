'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Badge, Button, Card, EmptyState, ErrorNotice, PageHeader, formatStatus } from '@/components/ui';
import { devFetchCenters, devSetCenterStatus, type CenterWithSub } from '@/lib/api';
import { planLabel } from '@/lib/billing';
import { formatDate } from '@/lib/utils';

export default function DeveloperCentersPage() {
  const [rows, setRows] = useState<CenterWithSub[]>([]);
  const [error, setError] = useState<unknown>(null);
  const load = async () => { try { setRows(await devFetchCenters()); } catch (err) { setError(err); } };
  useEffect(() => { void load(); }, []);
  const toggle = async (c: CenterWithSub) => { try { await devSetCenterStatus(c.id, c.status === 'active' ? 'suspended' : 'active'); await load(); } catch (err) { setError(err); } };
  return <><PageHeader title="السناتر" subtitle="إيقاف/تفعيل أي سنتر ومراجعة الاشتراك وعدد الطلاب." /><ErrorNotice error={error} /><Card className="stack">{rows.length === 0 ? <EmptyState title="لا توجد سناتر" /> : <div className="table-wrap"><table><thead><tr><th>السنتر</th><th>الكود</th><th>المالك</th><th>الطلاب</th><th>الاشتراك</th><th>الحالة</th><th>إجراءات</th></tr></thead><tbody>{rows.map((c) => { const st = formatStatus(c.status); return <tr key={c.id}><td><Link href={`/developer/centers/${c.id}`}><strong>{c.name}</strong></Link><div className="tiny muted">{c.kind === 'solo' ? 'مدرس خصوصي' : 'سنتر'}</div></td><td dir="ltr">{c.code}</td><td>{c.owner_name}<div className="tiny muted" dir="ltr">{c.owner_phone}</div></td><td>{c.students_count ?? 0}</td><td>{planLabel(c.latest_sub?.plan_type)}<div className="tiny muted">{c.latest_sub?.ends_on ? formatDate(c.latest_sub.ends_on) : '—'}</div></td><td><Badge tone={st.tone}>{st.text}</Badge></td><td><Button type="button" variant={c.status === 'active' ? 'danger' : 'secondary'} onClick={() => void toggle(c)}>{c.status === 'active' ? 'إيقاف' : 'تفعيل'}</Button></td></tr>; })}</tbody></table></div>}</Card></>;
}
