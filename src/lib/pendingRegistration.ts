const KEY_PENDING = 'mrcenter.web.pending.registration';

export interface PendingCenterRegistration {
  kind: 'center';
  email: string;
  centerName: string;
  code: string;
  ownerName: string;
  phone: string;
  centerKind: string;
}

export interface PendingStudentRegistration {
  kind: 'student';
  email: string;
  centerId: string;
  fullName: string;
  phone: string;
  guardianPhone: string;
  gradeId: string | null;
  groupId: string | null;
}

export interface PendingTeacherRegistration {
  kind: 'teacher';
  email: string;
  inviteCode: string;
  // حقول قديمة للتوافق (تسجيل ذاتي سابق) — لم تعد تُنشأ
  centerId?: string;
  fullName?: string;
  phone?: string;
  staffRole?: string;
}

export type PendingRegistration = PendingCenterRegistration | PendingStudentRegistration | PendingTeacherRegistration;

function hasStorage(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

export async function savePendingRegistration(p: PendingRegistration): Promise<void> {
  if (!hasStorage()) return;
  window.localStorage.setItem(KEY_PENDING, JSON.stringify(p));
}

export async function loadPendingRegistration(): Promise<PendingRegistration | null> {
  if (!hasStorage()) return null;
  try {
    const raw = window.localStorage.getItem(KEY_PENDING);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PendingRegistration;
    if (!parsed || !parsed.email) return null;
    if (parsed.kind !== 'center' && parsed.kind !== 'student' && parsed.kind !== 'teacher') return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function clearPendingRegistration(): Promise<void> {
  if (!hasStorage()) return;
  window.localStorage.removeItem(KEY_PENDING);
}
