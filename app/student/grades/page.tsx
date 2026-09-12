'use client';

import { useEffect, useState } from 'react';
import { Card, EmptyState, ErrorNotice, PageHeader } from '@/components/ui';
import { useSession } from '@/context/session';
import { fetchGradesForStudent } from '@/lib/api';
import type { ManualGrade } from '@/lib/types';
import { arabicMonth, formatDate } from '@/lib/utils';

export default function StudentGradesPage() {
  const { profile } = useSession();
  const [rows, setRows] = useState<ManualGrade[]>([]);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => { if (profile?.student_id) fetchGradesForStudent(profile.student_id).then(setRows).catch(setError); }, [profile?.student_id]);
  return <><PageHeader title="درجاتي" subtitle="كل الدرجات التي سجلها السنتر." /><ErrorNotice error={error} /><Card className="stack">{rows.length === 0 ? <EmptyState title="لا توجد درجات" /> : <div className="table-wrap"><table><thead><tr><th>التقييم</th><th>الشهر</th><th>الدرجة</th><th>النسبة</th><th>التاريخ</th></tr></thead><tbody>{rows.map((r) => <tr key={r.id}><td><strong>{r.title}</strong><div className="tiny muted">{r.notes}</div></td><td>{arabicMonth(r.month)} {r.grade_year}</td><td><strong>{r.score}</strong> / {r.max_score}</td><td>{Math.round((Number(r.score) / Math.max(1, Number(r.max_score))) * 100)}%</td><td>{formatDate(r.created_at)}</td></tr>)}</tbody></table></div>}</Card></>;
}
