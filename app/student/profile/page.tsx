'use client';

import { useEffect, useState } from 'react';
import { Badge, Card, ErrorNotice, PageHeader } from '@/components/ui';
import { QrCode } from '@/components/qr-code';
import { useSession } from '@/context/session';
import { fetchGroups, fetchMyCenter, fetchStudentById, fetchStudentGroups } from '@/lib/api';
import { encodeStudentQr } from '@/lib/qr';
import type { Center, Group, Student } from '@/lib/types';
import { formatDate, todayIso } from '@/lib/utils';

export default function StudentProfilePage() {
  const { profile } = useSession();
  const [student, setStudent] = useState<Student | null>(null);
  const [center, setCenter] = useState<Center | null>(null);
  const [groups, setGroups] = useState<Group[]>([]);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    if (!profile?.center_id || !profile.student_id) return;
    Promise.all([fetchStudentById(profile.student_id), fetchMyCenter(profile.center_id), fetchGroups(profile.center_id), fetchStudentGroups(profile.student_id)])
      .then(([st, c, all, extra]) => { setStudent(st); setCenter(c); const ids = new Set([st?.group_id, ...extra.map((x) => x.group_id)].filter(Boolean) as string[]); setGroups(all.filter((g) => ids.has(g.id))); })
      .catch(setError);
  }, [profile?.center_id, profile?.student_id]);
  const qr = profile?.center_id && profile.student_id ? encodeStudentQr(profile.center_id, profile.student_id, todayIso()) : '';
  return <><PageHeader title="حسابي" subtitle="بيانات الطالب وباركود حضور اليوم." /><ErrorNotice error={error} /><div className="grid grid-2"><Card className="stack"><h2 className="h3">بياناتي</h2><p className="muted">الاسم: <b>{student?.name ?? profile?.full_name}</b></p><p className="muted">البريد: <b dir="ltr">{profile?.email ?? student?.email ?? '—'}</b></p><p className="muted">هاتف الطالب: <b dir="ltr">{student?.phone ?? '—'}</b></p><p className="muted">هاتف ولي الأمر: <b dir="ltr">{student?.guardian_phone ?? '—'}</b></p><p className="muted">تاريخ التسجيل: <b>{student?.created_at ? formatDate(student.created_at) : '—'}</b></p><div className="row">{groups.map((g) => <Badge key={g.id} tone="info">{g.name}</Badge>)}</div></Card><Card className="stack"><h2 className="h3">باركود حضور اليوم</h2><p className="muted">اعرض هذا الباركود لمسئول السنتر لمسحه من الويب أو التطبيق.</p>{qr ? <><QrCode value={qr} /><textarea className="textarea" readOnly dir="ltr" value={qr} /></> : null}<p className="muted small">السنتر: {center?.name ?? '—'} · الكود: <span dir="ltr">{center?.code ?? '—'}</span></p></Card></div></>;
}
