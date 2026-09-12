'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Badge, Card, EmptyState, ErrorNotice, PageHeader, formatStatus } from '@/components/ui';
import { planLabel } from '@/lib/billing';
import { getSupabase } from '@/lib/supabase';
import type { Center, Profile, Student, Subscription } from '@/lib/types';
import { formatDate } from '@/lib/utils';

export default function DeveloperCenterDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [center, setCenter] = useState<Center | null>(null);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [subs, setSubs] = useState<Subscription[]>([]);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => { const load = async () => { try { const sb = getSupabase(); const [c, p, s, sub] = await Promise.all([sb.from('centers').select('*').eq('id', id).maybeSingle(), sb.from('profiles').select('*').eq('center_id', id).order('created_at', { ascending: false }).limit(300), sb.from('students').select('*').eq('center_id', id).order('created_at', { ascending: false }).limit(300), sb.from('center_subscriptions').select('*').eq('center_id', id).order('ends_on', { ascending: false }).limit(50)]); if (c.error) throw c.error; if (p.error) throw p.error; if (s.error) throw s.error; if (sub.error) throw sub.error; setCenter(c.data as Center | null); setProfiles((p.data ?? []) as Profile[]); setStudents((s.data ?? []) as Student[]); setSubs((sub.data ?? []) as Subscription[]); } catch (err) { setError(err); } }; void load(); }, [id]);
  return <><PageHeader title={center?.name ?? 'ملف السنتر'} subtitle="تفاصيل كاملة للمطور" actions={<Link className="btn secondary" href="/developer/centers">رجوع</Link>} /><ErrorNotice error={error} />{!center ? <EmptyState title="لم يتم العثور على السنتر" /> : <><div className="grid grid-4" style={{ marginBottom: 18 }}><Card className="compact kpi"><span className="muted">الكود</span><div className="kpi-value">{center.code}</div></Card><Card className="compact kpi"><span className="muted">الحالة</span><div className="kpi-value">{center.status}</div></Card><Card className="compact kpi"><span className="muted">الطلاب</span><div className="kpi-value">{students.length}</div></Card><Card className="compact kpi"><span className="muted">المستخدمون</span><div className="kpi-value">{profiles.length}</div></Card></div><div className="grid grid-2"><Card className="stack"><h2 className="h3">فريق وحسابات</h2>{profiles.length === 0 ? <EmptyState title="لا توجد حسابات" /> : profiles.map((p) => <div key={p.id} className="card compact soft"><div className="row-between"><strong>{p.full_name}</strong><Badge tone={p.is_active ? 'success' : 'warn'}>{p.role}</Badge></div><div className="tiny muted">{p.email} · {p.phone}</div></div>)}</Card><Card className="stack"><h2 className="h3">الاشتراكات</h2>{subs.length === 0 ? <EmptyState title="لا توجد اشتراكات" /> : subs.map((s) => { const st = formatStatus(s.status); return <div key={s.id} className="card compact soft"><div className="row-between"><strong>{planLabel(s.plan_type)}</strong><Badge tone={st.tone}>{st.text}</Badge></div><p className="muted small">{formatDate(s.starts_on)} → {formatDate(s.ends_on)}</p></div>; })}</Card></div><Card className="stack" style={{ marginTop: 18 }}><div className="row-between"><h2 className="h3">آخر الطلاب</h2><Badge tone="info">{students.length}</Badge></div>{students.length === 0 ? <EmptyState title="لا يوجد طلاب" /> : <div className="table-wrap"><table><thead><tr><th>الطالب</th><th>الهاتف</th><th>الحالة</th><th>تاريخ</th></tr></thead><tbody>{students.map((s) => { const st = formatStatus(s.status); return <tr key={s.id}><td>{s.name}</td><td dir="ltr">{s.phone}</td><td><Badge tone={st.tone}>{st.text}</Badge></td><td>{formatDate(s.created_at)}</td></tr>; })}</tbody></table></div>}</Card></>}</>;
}
