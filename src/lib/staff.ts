'use client';

import { useEffect, useState } from 'react';
import { useSession } from '@/context/session';
import { fetchTeacherGroups } from './api';

export {
  TEACHER_PERMS, STAFF_ROLES, isStaff, isOwner, can, roleLabel,
  TEACHER_TABS, TEACHER_SCREENS,
} from './rbac';

export type { TeacherPermKey } from './types';

/**
 * معرفات المجموعات المسندة للمدرس/فريق العمل.
 * null تعني أن الحساب ليس مدرساً، وبالتالي يرى نطاق السنتر كله.
 * [] تعني أن الحساب مدرس لكن لم تُسند له أي مجموعات بعد.
 */
export function useTeacherGroupIds(): string[] | null {
  const { profile } = useSession();
  const [ids, setIds] = useState<string[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (profile?.role === 'teacher' && profile?.id) {
      fetchTeacherGroups(profile.id)
        .then((rows) => { if (!cancelled) setIds(rows.map((x) => x.group_id)); })
        .catch(() => { if (!cancelled) setIds([]); });
    } else {
      setIds(null);
    }
    return () => { cancelled = true; };
  }, [profile?.role, profile?.id]);

  return ids;
}
