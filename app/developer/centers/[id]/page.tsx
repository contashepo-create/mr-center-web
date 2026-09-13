'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Badge, Button, Card, EmptyState, ErrorNotice, Notice, PageHeader, formatStatus } from '@/components/ui';
import { planLabel } from '@/lib/billing';
import { devGetAccountingState, devSetAccounting, type AccountingState } from '@/lib/features';
import { getSupabase } from '@/lib/supabase';
import type { Center, Profile, Student, Subscription } from '@/lib/types';
import { formatDate } from '@/lib/utils';

export default function DeveloperCenterDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [center, setCenter] = useState<Center | null>(null);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [subs, setSubs] = useState<Subscription[]>([]);
  const [accounting, setAccounting] = useState<AccountingState | null>(null);
  const [toggling, setToggling] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = async () => {
    try {
      const sb = getSupabase();
      const [c, p, s, sub, acc] = await Promise.all([
        sb.from('centers').select('*').eq('id', id).maybeSingle(),
        sb.from('profiles').select('*').eq('center_id', id).order('created_at', { ascending: false }).limit(300),
        sb.from('students').select('*').eq('center_id', id).order('created_at', { ascending: false }).limit(300),
        sb.from('center_subscriptions').select('*').eq('center_id', id).order('ends_on', { ascending: false }).limit(50),
        devGetAccountingState(id).catch(() => null),
      ]);
      if (c.error) throw c.error;
      if (p.error) throw p.error;
      if (s.error) throw s.error;
      if (sub.error) throw sub.error;
      setCenter(c.data as Center | null);
      setProfiles((p.data ?? []) as Profile[]);
      setStudents((s.data ?? []) as Student[]);
      setSubs((sub.data ?? []) as Subscription[]);
      setAccounting(acc);
    } catch (err) { setError(err); }
  };
  useEffect(() => { void load(); }, [id]);

  const toggleAccounting = async () => {
    if (!accounting) return;
    setToggling(true);
    setError(null);
    setMessage(null);
    try {
      await devSetAccounting(id, !accounting.enabled);
      setMessage(accounting.enabled ? 'تم إيقاف خدمة المحاسبة لهذا السنتر.' : 'تم تفعيل خدمة المحاسبة لهذا السنتر.');
      await load();
    } catch (err) { setError(err); }
    finally { setToggling(false); }
  };

  return <><PageHeader title={center?.name ?? 'ملف السنتر'} subtitle="تفاصيل كاملة للمطور" actions={<Link className="btn secondary" href="/developer/centers">رجوع</Link>} /><ErrorNotice error={error} />{message ? <Notice tone="success">{message}</Notice> : null}{!center ? <EmptyState title="لم يتم العثور على السنتر" /> : <><div className="grid grid-4" style={{ marginBottom: 18 }}><Card className="compact kpi"><span className="muted">الكود</span><div className="kpi-value">{center.code}</div></Card><Card className="compact kpi"><span className="muted">الحالة</span><div className="kpi-value">{center.status}</div></Card><Card className="compact kpi"><span className="muted">الطلاب</span><div className="kpi-value">{students.length}</div></Card><Card className="compact kpi"><span className="muted">المستخدمون</span><div className="kpi-value">{profiles.length}</div></Card></div><Card className="stack" style={{ marginBottom: 18 }}><div className="row-between"><div><h2 className="h3">بوابة المحاسبة (خدمة مدفوعة)</h2><p className="muted small" style={{ margin: '6px 0 0' }}>عند انتهاء/إيقاف الخدمة تُحجب واجهة المحاسبة والعمليات اليدوية فقط، ولا يفترض النظام تحصيل المستحقات. يستمر حفظ التحصيلات المسجلة فعلاً كسجل خلفي كي لا تختلف العهدة عن الإيصالات؛ وعند إعادة التفعيل تظهر كل الحركات السابقة وتبقى المصروفات والإيرادات غير المرتبطة بالتحصيل يدوية.</p></div><Badge tone={accounting?.enabled ? 'success' : 'default'}>{accounting?.enabled ? 'مفعّلة' : 'غير مفعّلة'}</Badge></div>{accounting && (accounting.viaEntitlement ? <p className="muted small">عبر ترخيص خاص{accounting.openEnded ? ' مفتوح بلا نهاية' : ` من ${accounting.startsOn ?? '—'} إلى ${accounting.endsOn ?? '—'}`}.</p> : null)}<Button type="button" variant={accounting?.enabled ? 'danger' : 'secondary'} disabled={toggling || !accounting} onClick={toggleAccounting}>{toggling ? 'جارٍ...' : accounting?.enabled ? 'إيقاف الخدمة' : 'تفعيل الخدمة'}</Button></Card><div className="grid grid-2"><Card className="stack"><h2 className="h3">فريق وحسابات</h2>{profiles.length === 0 ? <EmptyState title="لا توجد حسابات" /> : profiles.map((p) => <div key={p.id} className="card compact soft"><div className="row-between"><strong>{p.full_name}</strong><Badge tone={p.is_active ? 'success' : 'warn'}>{p.role}</Badge></div><div className="tiny muted">{p.email} · {p.phone}</div></div>)}</Card><Card className="stack"><h2 className="h3">الاشتراكات</h2>{subs.length === 0 ? <EmptyState title="لا توجد اشتراكات" /> : subs.map((s) => { const st = formatStatus(s.status); return <div key={s.id} className="card compact soft"><div className="row-between"><strong>{planLabel(s.plan_type)}</strong><Badge tone={st.tone}>{st.text}</Badge></div><p className="muted small">{formatDate(s.starts_on)} → {formatDate(s.ends_on)}</p></div>; })}</Card></div><Card className="stack" style={{ marginTop: 18 }}><div className="row-between"><h2 className="h3">آخر الطلاب</h2><Badge tone="info">{students.length}</Badge></div>{students.length === 0 ? <EmptyState title="لا يوجد طلاب" /> : <div className="table-wrap"><table><thead><tr><th>الطالب</th><th>الهاتف</th><th>الحالة</th><th>تاريخ</th></tr></thead><tbody>{students.map((s) => { const st = formatStatus(s.status); return <tr key={s.id}><td>{s.name}</td><td dir="ltr">{s.phone}</td><td><Badge tone={st.tone}>{st.text}</Badge></td><td>{formatDate(s.created_at)}</td></tr>; })}</tbody></table></div>}</Card></>}</>;
}
