'use client';

import { useEffect, useState } from 'react';
import { Badge, Card, EmptyState, ErrorNotice, PageHeader, formatStatus } from '@/components/ui';
import { useSession } from '@/context/session';
import { fetchDuesForStudent, fetchPaymentsForStudent, fetchStudentAccount } from '@/lib/api';
import type { Due, Payment, StudentAccount } from '@/lib/types';
import { arabicMonth, formatDate, formatMoney } from '@/lib/utils';

export default function StudentPaymentsPage() {
  const { profile } = useSession();
  const [dues, setDues] = useState<Due[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [account, setAccount] = useState<StudentAccount | null>(null);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    if (!profile?.student_id || !profile.center_id) return;
    Promise.all([fetchDuesForStudent(profile.student_id), fetchPaymentsForStudent(profile.student_id), fetchStudentAccount(profile.center_id, profile.student_id)])
      .then(([d, p, a]) => { setDues(d); setPayments(p); setAccount(a); }).catch(setError);
  }, [profile?.student_id, profile?.center_id]);
  return <><PageHeader title="حسابي ومدفوعاتي" subtitle="راجع المستحقات والدفعات والرصيد المقدم المتاح في حسابك." /><ErrorNotice error={error} />{account ? <div className="grid grid-3" style={{ marginBottom: 18 }}><Card className="compact kpi"><span className="muted">رصيد مقدم متاح</span><div className="kpi-value">{formatMoney(Number(account.summary.credit_balance || 0))}</div></Card><Card className="compact kpi"><span className="muted">مستحقات متبقية</span><div className="kpi-value">{formatMoney(Number(account.summary.amount_due || 0))}</div></Card><Card className="compact kpi"><span className="muted">صافي الحساب</span><div className="kpi-value">{Number(account.summary.net_balance || 0) >= 0 ? '+' : ''}{formatMoney(Number(account.summary.net_balance || 0))}</div></Card></div> : null}<div className="grid grid-2"><Card className="stack"><h2 className="h3">المستحقات</h2>{dues.length === 0 ? <EmptyState title="لا توجد مستحقات" /> : <div className="table-wrap"><table><thead><tr><th>الفترة</th><th>المبلغ</th><th>الحالة</th></tr></thead><tbody>{dues.map((d) => { const st = formatStatus(d.status); return <tr key={d.id}><td>{d.due_source === 'attendance' ? 'استحقاق حضور' : `${arabicMonth(d.month)} ${d.due_year}`}</td><td>{formatMoney(d.amount)}</td><td><Badge tone={st.tone}>{st.text}</Badge></td></tr>; })}</tbody></table></div>}</Card><Card className="stack"><h2 className="h3">الدفعات</h2>{payments.length === 0 ? <EmptyState title="لا توجد دفعات" /> : <div className="table-wrap"><table><thead><tr><th>التاريخ</th><th>المبلغ</th><th>النوع</th><th>ملاحظات</th></tr></thead><tbody>{payments.map((p) => <tr key={p.id}><td>{formatDate(p.payment_date)}</td><td>{formatMoney(p.amount)}</td><td>{p.payment_kind === 'credit' ? 'رصيد مقدم' : 'سداد مستحق'}</td><td>{p.notes ?? '—'}</td></tr>)}</tbody></table></div>}</Card></div></>;
}
