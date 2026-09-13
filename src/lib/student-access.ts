// ============================================================================
// إدارة وصول أجهزة الطلاب داخل السنتر فقط.
// لا تستخدم حجب الزوار العام حتى لا يؤثر تصرف طالب في سنتر آخر على جهازه.
// ============================================================================

import { getSupabase } from './supabase';

export interface StudentDeviceSession {
  id: string;
  center_id: string;
  student_id: string;
  device_id: string;
  blocked: boolean;
  note: string;
  first_seen: string;
  last_seen: string;
  blocked_at: string | null;
}

/** أجهزة حساب طالب واحد؛ تعيدها RPC محمية بأن يكون الطالب تابعاً لسنتر المالك. */
export async function fetchStudentDevices(studentId: string): Promise<StudentDeviceSession[]> {
  const { data, error } = await getSupabase().rpc('list_student_devices', { p_student: studentId });
  if (error) throw error;
  return (Array.isArray(data) ? data : []) as StudentDeviceSession[];
}

/** حجب جهاز الطالب أو إلغاء حجبه، ضمن حدود سنتر المالك حصراً. */
export async function setStudentDeviceBlocked(studentId: string, deviceId: string, blocked: boolean, note = ''): Promise<void> {
  const { error } = await getSupabase().rpc('set_student_device_blocked', {
    p_student: studentId, p_device: deviceId, p_blocked: blocked, p_note: note.trim(),
  });
  if (error) throw error;
}

/** إنهاء جلسة الطالب المفتوحة الآن. يستطيع الدخول مجدداً ما لم يُحجب جهازه. */
export async function disconnectStudentSession(studentId: string): Promise<void> {
  const { error } = await getSupabase().rpc('disconnect_student_session', { p_student: studentId });
  if (error) throw error;
}
