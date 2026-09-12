'use client';

import { useEffect, useState } from 'react';
import { Badge, Card, EmptyState, ErrorNotice, PageHeader, formatStatus } from '@/components/ui';
import { useSession } from '@/context/session';
import { fetchDuesForStudent, fetchPaymentsForStudent } from '@/lib/api';
import type { Due, Payment } from '@/lib/types';
import { arabicMonth, formatDate, formatMoney } from '@/lib/utils';

export default function StudentPaymentsPage() {
  const { profile } = useSession();
  const [dues, setDues] = useState<Due[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => { if (profile?.student_id) Promise.all([fetchDuesForStudent(profile.student_id), fetchPaymentsForStudent(profile.student_id)]).then(([d, p]) => { setDues(d); setPayments(p); }).catch(setError); }, [profile?.student_id]);
  return <><PageHeader title="مدفوعاتي" subtitle="المستحقات والدفعات المسجلة." /><ErrorNotice error={error} /><div className="grid grid-2"><Card className="stack"><h2 className="h3">المستحقات</h2>{dues.length === 0 ? <EmptyState title="لا توجد مستحقات" /> : <div className="table-wrap"><table><thead><tr><th>الفترة</th><th>المبلغ</th><th>الحالة</th></tr></thead><tbody>{dues.map((d) => { const st = formatStatus(d.status); return <tr key={d.id}><td>{arabicMonth(d.month)} {d.due_year}</td><td>{formatMoney(d.amount)}</td><td><Badge tone={st.tone}>{st.text}</Badge></td></tr>; })}</tbody></table></div>}</Card><Card className="stack"><h2 className="h3">الدفعات</h2>{payments.length === 0 ? <EmptyState title="لا توجد دفعات" /> : <div className="table-wrap"><table><thead><tr><th>التاريخ</th><th>المبلغ</th><th>ملاحظات</th></tr></thead><tbody>{payments.map((p) => <tr key={p.id}><td>{formatDate(p.payment_date)}</td><td>{formatMoney(p.amount)}</td><td>{p.notes ?? '—'}</td></tr>)}</tbody></table></div>}</Card></div></>;
}
