'use client';

import { useEffect, useMemo, useState } from 'react';
import { Badge, Card, EmptyState, ErrorNotice, PageHeader } from '@/components/ui';
import { QrCode } from '@/components/qr-code';
import { useSession } from '@/context/session';
import { fetchGrades, fetchGroups, fetchMyCenter, fetchStudentById, fetchStudentGroups } from '@/lib/api';
import { encodeStudentQr } from '@/lib/qr';
import type { Center, Grade, Group, Student } from '@/lib/types';
import { formatDate, todayIso } from '@/lib/utils';

export default function StudentProfilePage() {
  const { profile } = useSession();
  const [student, setStudent] = useState<Student | null>(null);
  const [center, setCenter] = useState<Center | null>(null);
  const [groups, setGroups] = useState<Group[]>([]);
  const [grades, setGrades] = useState<Grade[]>([]);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    if (!profile?.center_id || !profile.student_id) return;
    Promise.all([fetchStudentById(profile.student_id), fetchMyCenter(profile.center_id), fetchGroups(profile.center_id), fetchGrades(profile.center_id), fetchStudentGroups(profile.student_id)])
      .then(([nextStudent, nextCenter, allGroups, allGrades, extra]) => { const ids = new Set([nextStudent?.group_id, ...extra.map((row) => row.group_id)].filter(Boolean) as string[]); setStudent(nextStudent); setCenter(nextCenter); setGroups(allGroups.filter((group) => ids.has(group.id))); setGrades(allGrades); })
      .catch(setError);
  }, [profile?.center_id, profile?.student_id]);
  const gradeName = useMemo(() => grades.find((grade) => grade.id === student?.grade_id)?.name ?? 'غير محدد', [grades, student?.grade_id]);
  const qr = profile?.center_id && profile.student_id ? encodeStudentQr(profile.center_id, profile.student_id, todayIso()) : '';
  return <><PageHeader title="حسابي" subtitle="بياناتك الدراسية ومجموعاتك ومدرسوك وباركود حضور اليوم." /><ErrorNotice error={error} /><div className="grid grid-2"><Card className="stack"><div className="row-between"><h2 className="h3">بياناتي الدراسية</h2><Badge tone="info">{gradeName}</Badge></div><div className="profile-details-grid"><span>الاسم</span><strong>{student?.name ?? profile?.full_name}</strong><span>البريد</span><strong dir="ltr">{profile?.email ?? student?.email ?? '—'}</strong><span>هاتف الطالب</span><strong dir="ltr">{student?.phone ?? '—'}</strong><span>هاتف ولي الأمر</span><strong dir="ltr">{student?.guardian_phone ?? '—'}</strong><span>تاريخ التسجيل</span><strong>{student?.created_at ? formatDate(student.created_at) : '—'}</strong></div><div className="stack"><h3 className="h3">المجموعات والمدرسون</h3>{groups.length ? groups.map((group) => <article className="student-teacher-card" key={group.id}><span className="teacher-avatar">{group.teacher_name?.slice(0, 1) || 'م'}</span><div><strong>{group.name}{group.id === student?.group_id ? <Badge tone="success">أساسية</Badge> : <Badge>إضافية</Badge>}</strong><p>المدرس: {group.teacher_name || 'لم يُحدد بعد'}{group.teacher_phone ? <span dir="ltr"> · {group.teacher_phone}</span> : ''}</p><small>{group.days?.length ? `${group.days.join('، ')} · ${group.start_time || '--:--'} - ${group.end_time || '--:--'}` : 'لم يُحدد جدول المجموعة'}</small></div></article>) : <EmptyState title="لا توجد مجموعة مسندة" />}</div></Card><Card className="stack"><h2 className="h3">باركود حضور اليوم</h2><p className="muted">اعرض هذا الباركود لمسئول السنتر لمسحه من الويب أو التطبيق.</p>{qr ? <><QrCode value={qr} /><textarea className="textarea" readOnly dir="ltr" value={qr} /></> : null}<p className="muted small">السنتر: {center?.name ?? '—'} · الكود: <span dir="ltr">{center?.code ?? '—'}</span></p></Card></div></>;
}
