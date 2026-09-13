// ============================================================
// واجهة البيانات: كل استعلامات التطبيق (مصادقة + إدارة + طالب + مطور)
// كل الاستعلامات محمية بسياسات RLS على الخادم + تصفية center_id هنا
// ============================================================

import { getSupabase } from './supabase';
import { getDeviceId } from './visitors';
import { normalizeAnswerText, nowIso, todayIso, uuid } from './utils';
import { brandForCenter, normalizeCenterPrintSettings, type CenterPrintBranding } from './printing';
import type {
  Announcement, AppExam, AppInquiry, AppNotification, AppSurvey, AppSurveyResponse, Attendance, AttendanceStatus,
  Center, CenterLookup, CenterSettings, Due, ExamAttempt, Grade,
  ExamAnswer, ExamQuestion, Group, InquiryKind, InquiryStatus, ManualGrade, MyNotification, NotificationAudience, Payment, PlanType, Profile, PublicConfig,
  PublishedExam, SessionRecord, Student, Subscription, SubscriptionRequest, ActivityLog, SupportMessage, TeacherPerms,
  SurveyAnswer, SurveyQuestion, StudentAccount,
} from './types';

// ------------------------------------------------------------
// المصادقة والتسجيل
// ------------------------------------------------------------

export async function loginWithEmail(email: string, password: string) {
  const normalized = email.trim().toLowerCase();
  const device = getDeviceId();
  const sb = getSupabase();

  // حماية خادمية من تخمين كلمات المرور: يمنع تجاوز الحد قبل محاولة الدخول
  try {
    await sb.rpc('check_login_allowed', { p_email: normalized, p_device: device || null });
  } catch (e) {
    // إن لم يكن الترحيل مطبقاً بعد نتجاهل الخطأ ولا نمنع الدخول
    if (String((e as any)?.message ?? '').includes('login_rate_limited')) throw e;
  }

  const { data, error } = await sb.auth.signInWithPassword({ email: normalized, password });
  if (error) {
    try { await sb.rpc('record_login_attempt', { p_email: normalized, p_device: device || null, p_success: false }); } catch { /* ignore */ }
    throw error;
  }
  try { await sb.rpc('record_login_attempt', { p_email: normalized, p_device: device || null, p_success: true }); } catch { /* ignore */ }

  // جلسة واحدة لكل حساب: هذا الجهاز يستحوذ على الجلسة ويُخرج أي جهاز آخر
  const { claimMySession } = await import('./sessionGuard');
  await claimMySession();
  return data;
}

export async function sendPasswordReset(email: string) {
  const redirectTo = typeof window !== 'undefined' ? `${window.location.origin}/auth/update-password` : undefined;
  const { error } = await getSupabase().auth.resetPasswordForEmail(email.trim().toLowerCase(), redirectTo ? { redirectTo } : undefined);
  if (error) throw error;
}

export async function lookupCenterByCode(code: string): Promise<CenterLookup | null> {
  const { data, error } = await getSupabase().rpc('lookup_center_by_code', { p_code: code });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return (row as CenterLookup) ?? null;
}

/** قوائم سنتر العامة لشاشة تسجيل الطالب (تعمل قبل الدخول) */
export async function fetchSignupLists(centerId: string): Promise<{
  grades: { id: string; name: string }[]; groups: { id: string; name: string; grade_id: string | null }[];
}> {
  const { data, error } = await getSupabase().rpc('get_center_signup_lists', { p_center_id: centerId });
  if (error) throw error;
  const d = (data ?? {}) as { grades?: { id: string; name: string }[]; groups?: { id: string; name: string; grade_id: string | null }[] };
  return { grades: d.grades ?? [], groups: d.groups ?? [] };
}

export async function checkAvailability(email: string, phone: string): Promise<{ email_taken: boolean; phone_taken: boolean }> {
  const { data, error } = await getSupabase().rpc('check_registration_availability', {
    p_email: email.trim().toLowerCase(),
    p_phone: phone.trim(),
  });
  if (error) throw error;
  return data as { email_taken: boolean; phone_taken: boolean };
}

/**
 * بعد signUp: إن وُجدت جلسة فالتأكيد معطّل ونُتم التسجيل فوراً.
 * وإن غابت الجلسة (Confirm email مفعّل) نرمي email_confirmation_required
 * لتحفظ الشاشة البيانات معلقة ويرجع المستخدم بعد تأكيد بريده.
 */
async function ensureSessionAfterSignUp(email: string, password: string): Promise<void> {
  const sb = getSupabase();
  const { data: sess } = await sb.auth.getSession();
  if (sess.session) return;
  // محاولة دخول مباشرة (تنجح لو التأكيد معطّل أو البريد مؤكد مسبقاً)
  const { error: signInError } = await sb.auth.signInWithPassword({
    email: email.trim().toLowerCase(),
    password,
  });
  if (!signInError) return;
  try { await sb.auth.signOut(); } catch { /* تجاهل */ }
  const m = String((signInError as any)?.message ?? '').toLowerCase();
  if (m.includes('email not confirmed') || m.includes('not confirmed') || m.includes('invalid login')) {
    throw new Error('email_confirmation_required');
  }
  throw signInError;
}

/** استكمال تسجيل سنتر معلق — يُستدعى بعد تأكيد البريد والدخول (الجلسة موجودة) */
export async function completePendingCenter(input: {
  centerName: string; code: string; ownerName: string; phone: string; kind?: string;
}): Promise<void> {
  const { error } = await getSupabase().rpc('complete_center_registration', {
    p_center_name: input.centerName,
    p_code: input.code,
    p_owner_name: input.ownerName,
    p_phone: input.phone,
    p_kind: input.kind ?? 'center',
  });
  if (error) throw error;
}

/** استكمال تسجيل طالب معلق — يُستدعى بعد تأكيد البريد والدخول (الجلسة موجودة) */
export async function completePendingStudent(input: {
  centerId: string; fullName: string; phone: string; guardianPhone: string;
  gradeId?: string | null; groupId?: string | null;
}): Promise<void> {
  const { error } = await getSupabase().rpc('complete_student_registration', {
    p_center_id: input.centerId,
    p_full_name: input.fullName,
    p_phone: input.phone,
    p_guardian_phone: input.guardianPhone,
    p_grade_id: input.gradeId ?? null,
    p_group_id: input.groupId ?? null,
  });
  if (error) throw error;
}

/** تسجيل صاحب سنتر: حساب مصادقة ثم إتمام التسجيل في معاملة خادمية واحدة */
export async function registerCenterOwner(input: {
  centerName: string; code: string; ownerName: string;
  email: string; phone: string; password: string; kind?: string;
}): Promise<void> {
  const sb = getSupabase();
  const email = input.email.trim().toLowerCase();
  const { data, error } = await sb.auth.signUp({
    email,
    password: input.password,
  });
  if (error) throw error;
  if (!data.user) throw new Error('email_taken');
  await ensureSessionAfterSignUp(email, input.password);
  await completePendingCenter({
    centerName: input.centerName,
    code: input.code,
    ownerName: input.ownerName,
    phone: input.phone,
    kind: input.kind ?? 'center',
  });
}

/** تسجيل طالب جديد مع كود السنتر */
export async function registerStudent(input: {
  centerId: string; fullName: string; email: string; phone: string;
  guardianPhone: string; password: string;
  gradeId?: string | null; groupId?: string | null;
}): Promise<void> {
  const sb = getSupabase();
  const email = input.email.trim().toLowerCase();
  const { data, error } = await sb.auth.signUp({
    email,
    password: input.password,
  });
  if (error) throw error;
  if (!data.user) throw new Error('email_taken');
  await ensureSessionAfterSignUp(email, input.password);
  await completePendingStudent({
    centerId: input.centerId,
    fullName: input.fullName,
    phone: input.phone,
    guardianPhone: input.guardianPhone,
    gradeId: input.gradeId ?? null,
    groupId: input.groupId ?? null,
  });
}

// ------------------------------------------------------------
// المدرسون التابعون + عضوية الطلاب متعددة المجموعات
// ------------------------------------------------------------

export async function registerStaffAccount(input: {
  centerId: string; fullName: string; phone: string; role?: string;
}): Promise<void> {
  const { error } = await getSupabase().rpc('register_staff_account', {
    p_center_id: input.centerId,
    p_full_name: input.fullName,
    p_phone: input.phone,
    p_role: input.role ?? 'teacher',
  });
  if (error) throw error;
}

// ------------------------------------------------------------
// دعوات فريق العمل (تطابق Android): سكرتير/مدرس فقط — المدير هو صاحب السنتر
// ------------------------------------------------------------

export interface StaffInviteRow {
  id: string; center_id: string; code: string; name: string; phone: string | null;
  role: 'teacher' | 'secretary'; status: 'pending' | 'accepted' | 'revoked'; created_at: string;
}

/** توليد كود دعوة رقمي من 10 خانات على الأقل (واضح وسهل النسخ والإملاء) */
export function generateInviteCode(): string {
  const digits: number[] = [];
  try {
    const rnd = new Uint32Array(10);
    crypto.getRandomValues(rnd);
    for (let i = 0; i < 10; i++) digits.push(rnd[i] % 10);
  } catch {
    // بيئة بلا Web Crypto (نادر على الويب) — تراجع آمن بلا تعطيل
    for (let i = 0; i < 10; i++) digits.push(Math.floor(Math.random() * 10));
  }
  if (digits[0] === 0) digits[0] = 1 + (Math.floor(Math.random() * 9));
  return digits.join('');
}

export async function createStaffInvite(input: {
  centerId: string; name: string; phone: string; role: 'teacher' | 'secretary';
  perms?: TeacherPerms;
}): Promise<string> {
  const sb = getSupabase();
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateInviteCode();
    const { error } = await sb.from('staff_invites').insert({
      center_id: input.centerId, code, name: input.name.trim(),
      phone: input.phone.trim() || null, role: input.role,
      perms: input.perms ?? {}, group_ids: [],
    });
    if (!error) return code;
    if (!String((error as { message?: string }).message ?? '').includes('duplicate key')) throw error;
  }
  throw new Error('تعذر توليد كود فريد — حاول مجدداً');
}

export async function fetchStaffInvites(centerId: string): Promise<StaffInviteRow[]> {
  const { data, error } = await getSupabase().from('staff_invites').select('*')
    .eq('center_id', centerId).order('created_at', { ascending: false }).limit(100);
  if (error) throw error;
  return (data ?? []) as StaffInviteRow[];
}

export async function revokeStaffInvite(id: string): Promise<void> {
  const { error } = await getSupabase().from('staff_invites')
    .update({ status: 'revoked' }).eq('id', id);
  if (error) throw error;
}

export async function getInviteInfo(code: string): Promise<{
  found: boolean; suspended?: boolean; usable?: boolean;
  center_id?: string; center_name?: string; role?: 'teacher' | 'secretary'; name?: string;
}> {
  const { data, error } = await getSupabase().rpc('get_invite_info', { p_code: code.trim().toUpperCase() });
  if (error) throw error;
  return (data ?? { found: false }) as {
    found: boolean; suspended?: boolean; usable?: boolean;
    center_id?: string; center_name?: string; role?: 'teacher' | 'secretary'; name?: string;
  };
}

export async function acceptStaffInvite(code: string): Promise<void> {
  const { error } = await getSupabase().rpc('accept_staff_invite', { p_code: code.trim().toUpperCase() });
  if (error) throw error;
}

/** تسجيل موظف بدعوة — يرجع true إذا اكتمل الملف فوراً وfalse إذا علّق لتأكيد البريد */
export async function registerStaffByInvite(input: {
  inviteCode: string; email: string; password: string;
}): Promise<boolean> {
  const sb = getSupabase();
  const email = input.email.trim().toLowerCase();
  const { data, error } = await sb.auth.signUp({ email, password: input.password });
  if (error) throw error;
  if (!data.user) throw new Error('email_taken');
  try {
    await ensureSessionAfterSignUp(email, input.password);
  } catch (e) {
    if ((e as Error).message === 'email_confirmation_required') return false;
    throw e;
  }
  try {
    await acceptStaffInvite(input.inviteCode);
  } catch (e) {
    const m = String((e as any)?.message ?? '').toLowerCase();
    if (m.includes('already_registered')) return true;
    throw e;
  }
  return true;
}

/** سجل العمليات: من فعل ماذا (يستدعى بعد العمليات المهمة) */
export async function logActivity(centerId: string, action: string, details: string): Promise<void> {
  try {
    const sb = getSupabase();
    const { data: sess } = await sb.auth.getSession();
    const uid = sess.session?.user.id ?? '';
    let actorName = '';
    if (uid) {
      const { data: prof } = await sb.from('profiles').select('full_name, role').eq('id', uid).maybeSingle();
      const p = prof as { full_name?: string; role?: string } | null;
      // نشاط المطور (super_admin) لا يظهر في سجل نشاطات المستخدمين — يبقى السجل
      // خاصاً بعمليات صاحب السنتر وفريقه داخل سنتره فقط.
      if (p?.role === 'super_admin') return;
      actorName = p?.full_name ?? '';
    }
    await sb.from('activity_log').insert({
      id: uuid(), center_id: centerId, actor_id: uid,
      actor_name: actorName, action, details
    });
  } catch {
    // السجل إضافي — لا يكسر العملية الأساسية أبداً
  }
}

/** طلبات الترقية (المالك) */
export async function fetchSubscriptionRequests(centerId: string): Promise<SubscriptionRequest[]> {
  const { data, error } = await getSupabase().from('subscription_requests').select('*')
    .eq('center_id', centerId).order('created_at', { ascending: false }).limit(50);
  if (error) throw error;
  return (data ?? []) as SubscriptionRequest[];
}

export async function createSubscriptionRequest(input: {
  centerId: string; plan: string; months: number; amount: number; transferAt: string; notes?: string;
}): Promise<void> {
  const { error } = await getSupabase().from('subscription_requests').insert({
    id: uuid(), center_id: input.centerId, plan: input.plan, months: input.months,
    amount: input.amount, transfer_at: input.transferAt.trim(),
    status: 'pending', notes: input.notes?.trim() || null,
  });
  if (error) throw error;
}

/** كل طلبات الترقية المعلقة (المطور) */
export async function devFetchPendingRequests(): Promise<(SubscriptionRequest & { center_name?: string; center_code?: string })[]> {
  const sb = getSupabase();
  const { data, error } = await sb.from('subscription_requests').select('*')
    .eq('status', 'pending').order('created_at', { ascending: false }).limit(100);
  if (error) throw error;
  const rows = (data ?? []) as SubscriptionRequest[];
  const { data: centers } = await sb.from('centers').select('id,name,code');
  const byId = new Map(((centers ?? []) as { id: string; name: string; code: string }[]).map((c) => [c.id, c]));
  return rows.map((r) => ({ ...r, center_name: byId.get(r.center_id)?.name, center_code: byId.get(r.center_id)?.code }));
}

export async function devResolveRequest(id: string, approve: boolean): Promise<void> {
  const { error } = await getSupabase().from('subscription_requests')
    .update({ status: approve ? 'approved' : 'rejected' }).eq('id', id);
  if (error) throw error;
}

/** سجل معاملات السنتر مع المطور: كل الاشتراكات المفعّلة عبر الزمن */
export async function fetchSubscriptionsHistory(centerId: string): Promise<Subscription[]> {
  const { data, error } = await getSupabase().from('center_subscriptions').select('*')
    .eq('center_id', centerId).order('created_at', { ascending: false }).limit(50);
  if (error) throw error;
  return (data ?? []) as Subscription[];
}

/** سجل عمليات سنتر (للمالك) */
export async function fetchActivityLog(centerId: string): Promise<ActivityLog[]> {
  const { data, error } = await getSupabase().from('activity_log').select('*')
    .eq('center_id', centerId).order('created_at', { ascending: false }).limit(200);
  if (error) throw error;
  return (data ?? []) as ActivityLog[];
}

export async function fetchTeachers(centerId: string): Promise<Profile[]> {
  const { data, error } = await getSupabase().from('profiles').select('*')
    .eq('center_id', centerId).eq('role', 'teacher').order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as Profile[];
}

/** كل فريق العمل التابع (مدرس/مدير/سكرتير) */
export async function fetchStaff(centerId: string): Promise<Profile[]> {
  const { data, error } = await getSupabase().from('profiles').select('*')
    .eq('center_id', centerId).in('role', ['teacher', 'manager', 'secretary'])
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as Profile[];
}

export async function setTeacherActive(id: string, active: boolean): Promise<void> {
  const { error } = await getSupabase().from('profiles').update({ is_active: active }).eq('id', id);
  if (error) throw error;
}

export async function setTeacherPerms(id: string, perms: TeacherPerms): Promise<void> {
  const { error } = await getSupabase().from('profiles').update({ perms }).eq('id', id);
  if (error) throw error;
}

export async function deleteTeacher(id: string): Promise<void> {
  const sb = getSupabase();
  await sb.from('teacher_groups').delete().eq('teacher_id', id);
  const { error } = await sb.from('profiles').delete().eq('id', id);
  if (error) throw error;
}

export async function fetchTeacherGroups(teacherId: string): Promise<{ group_id: string }[]> {
  const { data, error } = await getSupabase().from('teacher_groups').select('group_id')
    .eq('teacher_id', teacherId);
  if (error) throw error;
  return (data ?? []) as { group_id: string }[];
}

export async function assignTeacherGroups(centerId: string, teacherId: string, groupIds: string[]): Promise<void> {
  const sb = getSupabase();
  const { error: delErr } = await sb.from('teacher_groups').delete().eq('teacher_id', teacherId);
  if (delErr) throw delErr;
  if (groupIds.length === 0) return;
  const { error } = await sb.from('teacher_groups').insert(
    groupIds.map((g) => ({ teacher_id: teacherId, group_id: g, center_id: centerId })),
  );
  if (error) throw error;
}

/** مجموعات الطالب الإضافية (بجانب الأساسية) */
export async function fetchStudentGroups(studentId: string): Promise<{ group_id: string }[]> {
  const { data, error } = await getSupabase().from('student_groups').select('group_id')
    .eq('student_id', studentId);
  if (error) throw error;
  return (data ?? []) as { group_id: string }[];
}

export async function addStudentToGroup(centerId: string, studentId: string, groupId: string): Promise<void> {
  const { error } = await getSupabase().from('student_groups').insert({
    student_id: studentId, group_id: groupId, center_id: centerId,
  });
  if (error) throw error;
}

export async function removeStudentFromGroup(studentId: string, groupId: string): Promise<void> {
  const { error } = await getSupabase().from('student_groups')
    .delete().eq('student_id', studentId).eq('group_id', groupId);
  if (error) throw error;
}

/** كل روابط الطلاب-المجموعات الإضافية في سنتر (للفلاتر الجماعية) */
export async function fetchCenterStudentGroups(centerId: string): Promise<{ student_id: string; group_id: string }[]> {
  const { data, error } = await getSupabase().from('student_groups').select('student_id, group_id')
    .eq('center_id', centerId).limit(5000);
  if (error) throw error;
  return (data ?? []) as { student_id: string; group_id: string }[];
}

/** أعضاء مجموعة (الأساسية + الإضافية) — للتحضير والمستحقات */
export async function fetchGroupMembers(centerId: string, groupId: string): Promise<Student[]> {
  const sb = getSupabase();
  const { data: extra, error: jErr } = await sb.from('student_groups').select('student_id')
    .eq('center_id', centerId).eq('group_id', groupId);
  if (jErr) throw jErr;
  const extraIds = ((extra ?? []) as { student_id: string }[]).map((r) => r.student_id);
  let q = sb.from('students').select('*').eq('center_id', centerId).eq('status', 'active');
  if (extraIds.length > 0) {
    q = q.or(`group_id.eq.${groupId},id.in.(${extraIds.join(',')})`);
  } else {
    q = q.eq('group_id', groupId);
  }
  const { data, error } = await q.order('name');
  if (error) throw error;
  return (data ?? []) as Student[];
}

// ------------------------------------------------------------
// إدارة السنتر (مسئول السنتر)
// ------------------------------------------------------------

export async function fetchMyCenter(centerId: string): Promise<Center | null> {
  const { data, error } = await getSupabase()
    .from('centers').select('*').eq('id', centerId).maybeSingle();
  if (error) throw error;
  return (data as Center) ?? null;
}

export async function fetchGrades(centerId: string): Promise<Grade[]> {
  const { data, error } = await getSupabase()
    .from('grades').select('*').eq('center_id', centerId).order('sort_order').order('created_at');
  if (error) throw error;
  return (data ?? []) as Grade[];
}

export async function addGrade(centerId: string, name: string): Promise<void> {
  const { data: rows } = await getSupabase().from('grades').select('sort_order').eq('center_id', centerId);
  const nextOrder = rows?.length ? Math.max(0, ...rows.map((r) => Number(r.sort_order) || 0)) + 1 : 0;
  const { error } = await getSupabase().from('grades').insert({
    id: uuid(), center_id: centerId, name: name.trim(),
    academic_year: '', sort_order: nextOrder, created_at: nowIso(),
  });
  if (error) throw error;
}

export async function deleteGrade(id: string): Promise<void> {
  const sb = getSupabase();
  // فك ارتباط الصف قبل حذفه حتى لا تبقى مراجع يتيمة
  for (const t of ['groups', 'students', 'app_exams'] as const) {
    const { error: unlinkErr } = await sb.from(t).update({ grade_id: null }).eq('grade_id', id);
    if (unlinkErr) throw unlinkErr;
  }
  const { error } = await sb.from('grades').delete().eq('id', id);
  if (error) throw error;
}

export async function updateGrade(id: string, name: string): Promise<void> {
  const { error } = await getSupabase().from('grades').update({ name: name.trim() }).eq('id', id);
  if (error) throw error;
}

/** تحريك صف لأعلى/أسفل ضمن ترتيب المراحل */
export async function moveGrade(id: string, dir: -1 | 1): Promise<void> {
  const sb = getSupabase();
  const { data: current } = await sb.from('grades').select('center_id, sort_order').eq('id', id).maybeSingle();
  if (!current) return;
  const order = current.sort_order;
  const cmp = dir < 0 ? 'lt' : 'gt';
  const { data: neighbor } = await sb.from('grades')
    .select('id, sort_order').eq('center_id', current.center_id)
    .neq('id', id)
    .filter('sort_order', cmp, order)
    .order('sort_order', { ascending: dir < 0 })
    .limit(1).maybeSingle();
  if (!neighbor) return;
  await sb.from('grades').update({ sort_order: neighbor.sort_order }).eq('id', id);
  await sb.from('grades').update({ sort_order: order }).eq('id', neighbor.id);
}

export async function fetchGroups(centerId: string): Promise<Group[]> {
  const { data, error } = await getSupabase()
    .from('groups').select('*').eq('center_id', centerId).order('name');
  if (error) throw error;
  return (data ?? []) as Group[];
}

export async function upsertGroup(centerId: string, group: Partial<Group> & { name: string }): Promise<void> {
  const payload = {
    center_id: centerId,
    name: group.name.trim(),
    teacher_name: group.teacher_name?.trim() ?? '',
    teacher_phone: group.teacher_phone?.trim() || null,
    grade_id: group.grade_id ?? null,
    days: group.days ?? [],
    start_time: group.start_time ?? '',
    end_time: group.end_time ?? '',
    monthly_fee: group.monthly_fee ?? 0,
    billing_type: group.billing_type ?? 'monthly',
    weekly_price: group.weekly_price ?? 0,
    session_price: group.session_price ?? 0,
    due_mode: group.due_mode ?? 'manual',
    attendance_due_amount: group.attendance_due_amount ?? 0,
  };
  if (group.id) {
    const { error } = await getSupabase().from('groups').update(payload).eq('id', group.id);
    if (error) throw error;
  } else {
    const { error } = await getSupabase().from('groups').insert({ id: uuid(), ...payload, students_count: 0 });
    if (error) throw error;
  }
}

export async function deleteGroup(id: string): Promise<void> {
  const sb = getSupabase();
  // إبقاء الطلاب لكن بلا مجموعة (فك الارتباط قبل الحذف)
  const { error: unlinkErr } = await sb.from('students').update({ group_id: null }).eq('group_id', id);
  if (unlinkErr) throw unlinkErr;
  const { error } = await sb.from('groups').delete().eq('id', id);
  if (error) throw error;
}

export async function fetchStudents(centerId: string, search?: string, includeArchived = false): Promise<Student[]> {
  let q = getSupabase().from('students').select('*')
    .eq('center_id', centerId)
    .order('created_at', { ascending: false }).limit(500);
  if (!includeArchived) q = q.neq('status', 'archived');
  if (search && search.trim()) {
    // تعقيم البحث: الفواصل والأقواس تكسر صيغة or في PostgREST
    const clean = search.trim().replace(/[,()"%\\]/g, '').slice(0, 40);
    if (clean) {
      q = q.or(`name.ilike.%${clean}%,phone.ilike.%${clean}%,email.ilike.%${clean}%`);
    }
  }
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as Student[];
}

export async function fetchStudentById(id: string): Promise<Student | null> {
  const { data, error } = await getSupabase()
    .from('students').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return (data as Student) ?? null;
}

export async function upsertStudent(centerId: string, s: Partial<Student> & { name: string }): Promise<string> {
  const studentId = s.id ?? uuid();
  const payload = {
    center_id: centerId,
    name: s.name.trim(),
    phone: s.phone?.trim() || null,
    guardian_phone: s.guardian_phone?.trim() || null,
    grade_id: s.grade_id ?? null,
    group_id: s.group_id ?? null,
    status: s.status ?? 'active',
    notes: s.notes?.trim() || null,
    updated_at: nowIso(),
  };
  if (s.id) {
    const { error } = await getSupabase().from('students').update(payload).eq('id', s.id);
    if (error) throw error;
  } else {
    const { error } = await getSupabase().from('students')
      .insert({ id: studentId, created_at: nowIso(), ...payload });
    if (error) throw error;
  }
  return studentId;
}

export async function deleteStudent(id: string): Promise<void> {
  const { error } = await getSupabase().from('students').delete().eq('id', id);
  if (error) throw error;
}

// ---------- الحصص والحضور ----------

/** البحث عن حصة موجودة دون إنشائها (حتى لا تتراكم حصص فارغة) */
export async function findSession(centerId: string, groupId: string, date: string): Promise<SessionRecord | null> {
  const { data, error } = await getSupabase().from('sessions').select('*')
    .eq('center_id', centerId).eq('group_id', groupId).eq('session_date', date).maybeSingle();
  if (error) throw error;
  return (data as SessionRecord) ?? null;
}

export async function getOrCreateSession(centerId: string, groupId: string, date: string): Promise<SessionRecord> {
  const sb = getSupabase();
  const { data: existing, error: findErr } = await sb.from('sessions')
    .select('*').eq('center_id', centerId).eq('group_id', groupId)
    .eq('session_date', date).maybeSingle();
  if (findErr) throw findErr;
  if (existing) return existing as SessionRecord;
  const { data, error } = await sb.from('sessions').insert({
    id: uuid(), center_id: centerId, group_id: groupId,
    session_date: date, start_time: '', end_time: '', created_at: nowIso(),
  }).select('*').single();
  if (error) throw error;
  return data as SessionRecord;
}

export async function fetchAttendanceForSession(sessionId: string): Promise<Attendance[]> {
  const { data, error } = await getSupabase()
    .from('attendance').select('*').eq('session_id', sessionId);
  if (error) throw error;
  return (data ?? []) as Attendance[];
}

export async function saveAttendance(
  centerId: string, sessionId: string,
  records: { student_id: string; status: AttendanceStatus }[],
): Promise<void> {
  const existing = await fetchAttendanceForSession(sessionId);
  const byStudent = new Map(existing.map((a) => [a.student_id, a]));
  const upserts = records.map((r) => ({
    id: byStudent.get(r.student_id)?.id ?? uuid(),
    center_id: centerId,
    session_id: sessionId,
    student_id: r.student_id,
    status: r.status,
    created_at: byStudent.get(r.student_id)?.created_at ?? nowIso(),
  }));
  if (upserts.length === 0) return;
  const sb = getSupabase();
  const { error } = await sb.from('attendance').upsert(upserts);
  if (error) throw error;
  // الدالة خادمية وidempotent: لا تنشئ مستحقين للحصة نفسها، وتطبق الرصيد المقدم تلقائياً.
  const { error: duesError } = await sb.rpc('sync_attendance_dues_for_session', { p_center: centerId, p_session: sessionId });
  if (duesError) throw duesError;
}

// ---------- التحصيل والمستحقات ----------

export async function fetchDues(centerId: string, month: number, year: number): Promise<Due[]> {
  const { data, error } = await getSupabase().from('dues').select('*')
    .eq('center_id', centerId).eq('month', month).eq('due_year', year);
  if (error) throw error;
  return (data ?? []) as Due[];
}

/** توليد استحقاقات شهرية لكل طلاب مجموعة (يتجاوز الموجود مسبقاً) */
export async function generateDuesForGroup(
  centerId: string, group: Group, month: number, year: number,
): Promise<{ created: number; amount: number; skippedNoSessions: boolean }> {
  const { data, error } = await getSupabase().rpc('generate_manual_dues_for_group', {
    p_center: centerId, p_group: group.id, p_month: month, p_year: year,
  });
  if (error) throw error;
  const result = (data ?? {}) as { created?: number; amount?: number; skipped_no_sessions?: boolean };
  return {
    created: Number(result.created ?? 0),
    amount: Number(result.amount ?? 0),
    skippedNoSessions: Boolean(result.skipped_no_sessions),
  };
}

/** مبلغ الاستحقاق حسب نظام التسعير — null إن كان بالحصة ولا حصص مسجلة بعد */
export async function dueAmountForGroup(
  centerId: string, group: Group, month: number, year: number,
): Promise<number | null> {
  const billing = group.billing_type ?? 'monthly';
  if (billing === 'weekly') return Number(group.weekly_price || 0) * 4;
  if (billing === 'per_session') {
    const sessions = await fetchSessionsForGroupMonth(centerId, group.id, month, year);
    if (sessions.length === 0) return null;
    return Number(group.session_price || 0) * sessions.length;
  }
  return Number(group.monthly_fee || 0);
}

/** حصص مجموعة في شهر معين */
export async function fetchSessionsForGroupMonth(
  centerId: string, groupId: string, month: number, year: number,
): Promise<SessionRecord[]> {
  const last = new Date(year, month, 0).getDate();
  const from = `${year}-${String(month).padStart(2, '0')}-01`;
  const to = `${year}-${String(month).padStart(2, '0')}-${String(last).padStart(2, '0')}`;
  const { data, error } = await getSupabase().from('sessions').select('*')
    .eq('center_id', centerId).eq('group_id', groupId)
    .gte('session_date', from).lte('session_date', to).order('session_date');
  if (error) throw error;
  return (data ?? []) as SessionRecord[];
}

/** حصص السنتر في شهر معين (للتقارير) */
export async function fetchSessionsForCenterMonth(
  centerId: string, month: number, year: number,
): Promise<SessionRecord[]> {
  const last = new Date(year, month, 0).getDate();
  const from = `${year}-${String(month).padStart(2, '0')}-01`;
  const to = `${year}-${String(month).padStart(2, '0')}-${String(last).padStart(2, '0')}`;
  const { data, error } = await getSupabase().from('sessions').select('*')
    .eq('center_id', centerId)
    .gte('session_date', from).lte('session_date', to).order('session_date');
  if (error) throw error;
  return (data ?? []) as SessionRecord[];
}

/** حضور مجموعة حصص دفعة واحدة (للتقارير) */
export async function fetchAttendanceForSessions(sessionIds: string[]): Promise<Attendance[]> {
  if (sessionIds.length === 0) return [];
  const { data, error } = await getSupabase().from('attendance').select('*').in('session_id', sessionIds);
  if (error) throw error;
  return (data ?? []) as Attendance[];
}

/** كل المستحقات المعلقة للسنتر (لرسائل الواتساب) */
export async function fetchAllPendingDues(centerId: string): Promise<Due[]> {
  const { data, error } = await getSupabase().from('dues').select('*')
    .eq('center_id', centerId).neq('status', 'paid').order('created_at', { ascending: false }).limit(2000);
  if (error) throw error;
  return (data ?? []) as Due[];
}

/** مدفوعات شهر معين (للتقارير) */
export async function fetchPaymentsForMonth(centerId: string, month: number, year: number): Promise<Payment[]> {
  const { data, error } = await getSupabase().from('payments').select('*')
    .eq('center_id', centerId).eq('month', month).eq('payment_year', year).order('payment_date', { ascending: false }).limit(500);
  if (error) throw error;
  return (data ?? []) as Payment[];
}

/** درجات يدوية لشهر معين (للتقارير) */
export async function fetchManualGradesForMonth(centerId: string, month: number, year: number): Promise<ManualGrade[]> {
  const { data, error } = await getSupabase().from('manual_grades').select('*')
    .eq('center_id', centerId).eq('month', month).eq('grade_year', year).limit(500);
  if (error) throw error;
  return (data ?? []) as ManualGrade[];
}

export async function fetchPaymentsForStudent(studentId: string): Promise<Payment[]> {
  const { data, error } = await getSupabase().from('payments').select('*')
    .eq('student_id', studentId).order('payment_date', { ascending: false }).limit(100);
  if (error) throw error;
  return (data ?? []) as Payment[];
}

export async function fetchDuesForStudent(studentId: string): Promise<Due[]> {
  const { data, error } = await getSupabase().from('dues').select('*')
    .eq('student_id', studentId).order('due_year', { ascending: false }).order('month', { ascending: false }).limit(60);
  if (error) throw error;
  return (data ?? []) as Due[];
}

export async function recordPayment(input: {
  centerId: string; studentId: string; dueId?: string | null;
  amount: number; month: number; year: number; notes?: string;
}): Promise<void> {
  const amount = Number(input.amount);
  if (!amount || amount <= 0) throw new Error('invalid_payment_amount');
  if (input.month < 1 || input.month > 12 || input.year < 2000) throw new Error('invalid_payment_period');

  // التحصيل يتم خادمياً ذرياً عبر record_payment RPC:
  // يقفل صف المستحق ويمنع السباق (Race Condition) وتجاوز المبلغ من جهازين في نفس اللحظة.
  const { error } = await getSupabase().rpc('record_payment', {
    p_center: input.centerId,
    p_student: input.studentId,
    p_due: input.dueId ?? null,
    p_amount: amount,
    p_month: input.month,
    p_year: input.year,
    p_notes: input.notes?.trim() || null,
  });
  if (error) throw error;
}

/** تحصيل مقدم للطالب: يظهر رصيداً دائنًا ويُطبّق تلقائياً على مستحق قائم إن وجد. */
export async function recordStudentCredit(input: {
  centerId: string; studentId: string; amount: number; month: number; year: number; notes?: string;
}): Promise<void> {
  await recordPayment({ ...input, dueId: null });
}

/** تحصيل المستحقات المختارة من مجموعة في معاملة واحدة؛ الاختيار نفسه لا يحفظ شيئاً. */
export async function recordBulkDuePayments(input: {
  centerId: string; month: number; year: number; items: { dueId: string; amount: number }[]; notes?: string;
}): Promise<{ count: number; total: number }> {
  if (input.items.length === 0) throw new Error('اختر طالباً واحداً على الأقل.');
  const { data, error } = await getSupabase().rpc('record_bulk_due_payments', {
    p_center: input.centerId,
    p_month: input.month,
    p_year: input.year,
    p_items: input.items.map((item) => ({ due_id: item.dueId, amount: Number(item.amount) })),
    p_notes: input.notes?.trim() || null,
  });
  if (error) throw error;
  const result = (data ?? {}) as { count?: number; total?: number };
  return { count: Number(result.count ?? 0), total: Number(result.total ?? 0) };
}

/** كشف موحد للمستحقات والرصيد المقدم والتسويات؛ مصدره RPC محمي. */
export async function fetchStudentAccount(centerId: string, studentId: string): Promise<StudentAccount> {
  const { data, error } = await getSupabase().rpc('get_student_account', { p_center: centerId, p_student: studentId });
  if (error) throw error;
  return (data ?? {}) as StudentAccount;
}

/** تصفير الرصيد أو المديونية دون إدراج دفعة جديدة أو خلق إيراد ثانٍ. */
export async function settleStudentAccount(centerId: string, studentId: string, notes?: string): Promise<{ creditSettled: number; debtSettled: number }> {
  const { data, error } = await getSupabase().rpc('settle_student_account', {
    p_center: centerId, p_student: studentId, p_notes: notes?.trim() || null,
  });
  if (error) throw error;
  const result = (data ?? {}) as { credit_settled?: number; debt_settled?: number };
  return { creditSettled: Number(result.credit_settled ?? 0), debtSettled: Number(result.debt_settled ?? 0) };
}

export async function updateStudentGroup(studentId: string, groupId: string | null, gradeId: string | null): Promise<void> {
  const { error } = await getSupabase().from('students')
    .update({ group_id: groupId, grade_id: gradeId, updated_at: nowIso() }).eq('id', studentId);
  if (error) throw error;
}

/** تحضير طالب واحد اليوم (من مسح الباركود) — يبني حصة اليوم تلقائياً */
export async function markStudentPresentToday(centerId: string, student: { id: string; group_id: string | null }): Promise<void> {
  if (!student.group_id) throw new Error('no_group_for_attendance');
  const sess = await getOrCreateSession(centerId, student.group_id, todayIso());
  await saveAttendance(centerId, sess.id, [{ student_id: student.id, status: 'present' }]);
}

// ---------- الدرجات اليدوية ----------

export async function fetchGradesForStudent(studentId: string): Promise<ManualGrade[]> {
  const { data, error } = await getSupabase().from('manual_grades').select('*')
    .eq('student_id', studentId).order('created_at', { ascending: false }).limit(100);
  if (error) throw error;
  return (data ?? []) as ManualGrade[];
}

export async function addManualGrade(input: {
  centerId: string; studentId: string; title: string;
  score: number; maxScore: number; month: number; year: number; notes?: string;
}): Promise<void> {
  const { error } = await getSupabase().from('manual_grades').insert({
    id: uuid(), center_id: input.centerId, student_id: input.studentId,
    title: input.title.trim() || 'تقييم', score: input.score, max_score: input.maxScore,
    month: input.month, grade_year: input.year, notes: input.notes?.trim() || null,
    created_at: nowIso(),
  });
  if (error) throw error;
}

export async function deleteManualGrade(id: string): Promise<void> {
  const { error } = await getSupabase().from('manual_grades').delete().eq('id', id);
  if (error) throw error;
}

// ---------- الإعلانات ----------

export async function fetchAnnouncements(centerId: string): Promise<Announcement[]> {
  const { data, error } = await getSupabase().from('announcements').select('*')
    .eq('center_id', centerId)
    .order('pinned', { ascending: false }).order('created_at', { ascending: false }).limit(100);
  if (error) throw error;
  return (data ?? []) as Announcement[];
}

export async function upsertAnnouncement(centerId: string, a: Partial<Announcement> & { title: string; body: string }): Promise<void> {
  const payload = { title: a.title.trim(), body: a.body.trim(), pinned: a.pinned ?? false };
  if (a.id) {
    const { error } = await getSupabase().from('announcements').update(payload).eq('id', a.id);
    if (error) throw error;
  } else {
    const { error } = await getSupabase().from('announcements')
      .insert({ id: uuid(), center_id: centerId, created_at: nowIso(), ...payload });
    if (error) throw error;
  }
}

export async function deleteAnnouncement(id: string): Promise<void> {
  const { error } = await getSupabase().from('announcements').delete().eq('id', id);
  if (error) throw error;
}

// ---------- إحصائيات لوحة مسئول السنتر ----------

export interface AdminStats {
  students: number;
  groups: number;
  presentToday: number;
  absentToday: number;
  unpaidDues: number;
  paidThisMonth: number;
}

export async function fetchAdminStats(centerId: string): Promise<AdminStats> {
  const sb = getSupabase();
  const today = todayIso();
  const now = new Date();
  const [students, groups, dues, paid] = await Promise.all([
    sb.from('students').select('id', { count: 'exact', head: true })
      .eq('center_id', centerId).eq('status', 'active'),
    sb.from('groups').select('id', { count: 'exact', head: true }).eq('center_id', centerId),
    sb.from('dues').select('id', { count: 'exact', head: true })
      .eq('center_id', centerId).eq('status', 'pending'),
    sb.from('payments').select('amount')
      .eq('center_id', centerId).eq('month', now.getMonth() + 1).eq('payment_year', now.getFullYear()),
  ]);
  const { data: todaySessions } = await sb.from('sessions').select('id')
    .eq('center_id', centerId).eq('session_date', today);
  const sessionIds = (todaySessions ?? []).map((s) => s.id);
  let presentToday = 0;
  let absentToday = 0;
  if (sessionIds.length > 0) {
    const { data: att } = await sb.from('attendance').select('status').in('session_id', sessionIds);
    for (const a of att ?? []) {
      if (a.status === 'present' || a.status === 'late') presentToday++;
      else if (a.status === 'absent') absentToday++;
    }
  }
  const paidThisMonth = (paid.data ?? []).reduce((sum: number, p: any) => sum + (Number(p.amount) || 0), 0);
  return {
    students: students.count ?? 0,
    groups: groups.count ?? 0,
    presentToday,
    absentToday,
    unpaidDues: dues.count ?? 0,
    paidThisMonth,
  };
}

// ------------------------------------------------------------
// بوابة الطالب
// ------------------------------------------------------------

export async function fetchMyAttendance(studentId: string): Promise<(Attendance & { sessions?: SessionRecord | null })[]> {
  // نجلب الحضور ثم الحصص منفصلتين ونجمعهما هنا — بدل select مدمج يعتمد على
  // علاقة foreign key بين attendance و sessions قد لا تكون معرفة في قاعدة البيانات.
  const { data, error } = await getSupabase().from('attendance').select('*')
    .eq('student_id', studentId).order('created_at', { ascending: false }).limit(100);
  if (error) throw error;
  const rows = (data ?? []) as Attendance[];
  const sessionIds = Array.from(new Set(rows.map((r) => r.session_id).filter(Boolean)));
  if (sessionIds.length === 0) return rows;
  const { data: sessions, error: sessErr } = await getSupabase().from('sessions').select('*')
    .in('id', sessionIds);
  if (sessErr) throw sessErr;
  const byId = new Map((sessions ?? []).map((s) => [s.id, s as SessionRecord]));
  return rows.map((r) => ({ ...r, sessions: byId.get(r.session_id) ?? null }));
}

// ------------------------------------------------------------
// لوحة المطور
// ------------------------------------------------------------

export interface CenterWithSub extends Center {
  latest_sub?: Pick<Subscription, 'plan_type' | 'ends_on' | 'status'> | null;
  students_count?: number;
}

export async function devFetchCenters(): Promise<CenterWithSub[]> {
  const sb = getSupabase();
  const { data: centers, error } = await sb.from('centers').select('*').order('created_at', { ascending: false });
  if (error) throw error;
  const { data: subs } = await sb.from('center_subscriptions').select('*').order('ends_on', { ascending: false }).limit(5000);
  const { data: students } = await sb.from('students').select('center_id').limit(5000);
  const subByCenter = new Map<string, Subscription>();
  for (const s of (subs ?? []) as Subscription[]) {
    if (!subByCenter.has(s.center_id)) subByCenter.set(s.center_id, s);
  }
  const countByCenter = new Map<string, number>();
  for (const st of (students ?? []) as { center_id: string | null }[]) {
    if (st.center_id) countByCenter.set(st.center_id, (countByCenter.get(st.center_id) ?? 0) + 1);
  }
  return ((centers ?? []) as Center[]).map((c) => ({
    ...c,
    latest_sub: subByCenter.get(c.id) ?? null,
    students_count: countByCenter.get(c.id) ?? 0,
  }));
}

export async function devSetCenterStatus(centerId: string, status: 'active' | 'suspended'): Promise<void> {
  const { error } = await getSupabase().from('centers').update({ status }).eq('id', centerId);
  if (error) throw error;
}

export async function devUpsertSubscription(input: {
  centerId: string; planType: PlanType; months: number; status: 'active' | 'suspended'; notes?: string;
}): Promise<void> {
  const starts = new Date();
  const ends = new Date();
  ends.setMonth(ends.getMonth() + input.months);
  const { error } = await getSupabase().from('center_subscriptions').insert({
    center_id: input.centerId,
    plan_type: input.planType,
    starts_on: starts.toISOString().slice(0, 10),
    ends_on: ends.toISOString().slice(0, 10),
    status: input.status,
    notes: input.notes?.trim() || null,
  });
  if (error) throw error;
}

export async function devFetchPublicConfig(): Promise<PublicConfig> {
  const { data, error } = await getSupabase()
    .from('app_config').select('value').eq('key', 'public_config').maybeSingle();
  if (error) throw error;
  return (data?.value ?? {}) as PublicConfig;
}

export async function devSavePublicConfig(cfg: PublicConfig): Promise<void> {
  const { error } = await getSupabase().from('app_config')
    .upsert({ key: 'public_config', value: cfg, updated_at: nowIso() });
  if (error) throw error;
}

// ------------------------------------------------------------
// الاختبارات الإلكترونية (إدارة + تأدية الطالب عبر RPC آمن)
// ------------------------------------------------------------

export async function fetchExams(centerId: string): Promise<AppExam[]> {
  const { data, error } = await getSupabase().from('app_exams').select('*')
    .eq('center_id', centerId).order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as AppExam[];
}

export async function upsertExam(centerId: string, exam: Partial<AppExam> & {
  title: string; questions: ExamQuestion[]; answers: ExamAnswer[];
}): Promise<string> {
  const examId = exam.id || uuid();
  const marksSum = exam.questions.reduce((s, q) => s + (Number(q.marks) || 1), 0);
  const total = exam.questions.length > 0
    ? Number(exam.total_score || 0) || marksSum
    : 0;

  // تطبيع النماذج بنفس طريقة تطبيق Android:
  // - complete/correct: تطبيع النص العربي (أ/إ/آ ← ا، إزالة الزوائد)
  // - multi: ترتيب فهارس الإجابات حتى لا يتأثر التصحيح بترتيب الاختيار
  const questions = exam.questions.map((q) =>
    (q.type === 'complete' || q.type === 'correct')
      ? { ...q, answer: normalizeAnswerText(typeof q.answer === 'string' ? q.answer : '') }
      : q,
  );
  const answers = exam.answers.map((a, i) => {
    const t = questions[i]?.type;
    if ((t === 'complete' || t === 'correct') && typeof a === 'string') return normalizeAnswerText(a);
    if (t === 'multi' && Array.isArray(a)) return [...(a as number[])].sort((x, y) => x - y);
    return a;
  });

  const payload = {
    center_id: centerId,
    title: exam.title.trim(),
    subject: exam.subject?.trim() || '',
    grade_id: exam.grade_id ?? null,
    duration_minutes: exam.duration_minutes ?? 30,
    questions,
    answers,
    total_score: total,
    is_published: exam.is_published ?? false,
    attempts_allowed: exam.attempts_allowed ?? 1,
    show_result: exam.show_result ?? 'end',
    delivery_mode: exam.delivery_mode ?? 'online',
    online_mode: exam.online_mode ?? 'mixed',
    target_group_ids: exam.target_group_ids ?? [],
    availability_mode: exam.availability_mode ?? 'always',
    available_from: exam.availability_mode === 'scheduled' ? exam.available_from ?? null : null,
    available_until: exam.availability_mode === 'scheduled' ? exam.available_until ?? null : null,
    paper_template: exam.paper_template ?? 'classic',
    paper_footer: exam.paper_footer?.trim().slice(0, 350) ?? '',
    ornaments: exam.ornaments ?? null,
  };
  if (exam.id) {
    const { error } = await getSupabase().from('app_exams').update(payload).eq('id', examId);
    if (error) throw error;
  } else {
    const { error } = await getSupabase().from('app_exams').insert({ id: examId, ...payload });
    if (error) throw error;
  }
  return examId;
}

export async function deleteExam(id: string): Promise<void> {
  const sb = getSupabase();
  const { error: attErr } = await sb.from('app_exam_attempts').delete().eq('exam_id', id);
  if (attErr) throw attErr;
  const { error } = await sb.from('app_exams').delete().eq('id', id);
  if (error) throw error;
}

export async function toggleExamPublished(id: string, published: boolean): Promise<void> {
  const { error } = await getSupabase().from('app_exams').update({ is_published: published }).eq('id', id);
  if (error) throw error;
}

export async function fetchPublishedExams(): Promise<PublishedExam[]> {
  const { data, error } = await getSupabase().rpc('get_published_exams');
  if (error) throw error;
  return (data ?? []) as PublishedExam[];
}

export interface ExamResult {
  score: number;
  max_score: number;
  correct: number;
  total: number;
  status: string;
  attempts_used?: number;
  attempts_allowed?: number;
  /** مراجعة سؤال بسؤال؛ model = الإجابة النموذجية (إن أُرفقت من الخادم) */
  per_question?: { q: number; correct: boolean | null; earned: number; marks: number; model?: ExamAnswer }[];
}

export async function submitExam(examId: string, answers: ExamAnswer[]): Promise<ExamResult> {
  const { data, error } = await getSupabase().rpc('submit_exam_attempt', {
    p_exam_id: examId, p_answers: answers,
  });
  if (error) throw error;
  return data as ExamResult;
}

/** تصحيح يدوي لمحاولة فيها مقالي (المعلم يضع الدرجة النهائية) */
export async function gradeAttemptManually(attemptId: string, score: number): Promise<void> {
  const { error } = await getSupabase().from('app_exam_attempts')
    .update({ score, status: 'graded' }).eq('id', attemptId);
  if (error) throw error;
}

export async function fetchAttemptsForExam(examId: string): Promise<ExamAttempt[]> {
  const { data, error } = await getSupabase().from('app_exam_attempts').select('*')
    .eq('exam_id', examId).order('score', { ascending: false }).limit(200);
  if (error) throw error;
  return (data ?? []) as ExamAttempt[];
}

export async function fetchMyExamAttempts(studentId: string): Promise<ExamAttempt[]> {
  const { data, error } = await getSupabase().from('app_exam_attempts').select('*')
    .eq('student_id', studentId).order('created_at', { ascending: false }).limit(100);
  if (error) throw error;
  return (data ?? []) as ExamAttempt[];
}

// ------------------------------------------------------------
// الطلبات والاستفسارات
// ------------------------------------------------------------

export async function fetchInquiries(centerId: string, status?: string): Promise<AppInquiry[]> {
  let q = getSupabase().from('app_inquiries').select('*')
    .eq('center_id', centerId).order('created_at', { ascending: false }).limit(200);
  if (status && status !== 'all') q = q.eq('status', status);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as AppInquiry[];
}

export async function fetchMyInquiries(studentId: string): Promise<AppInquiry[]> {
  const { data, error } = await getSupabase().from('app_inquiries').select('*')
    .eq('student_id', studentId).order('created_at', { ascending: false }).limit(100);
  if (error) throw error;
  return (data ?? []) as AppInquiry[];
}

export async function addInquiry(input: {
  centerId: string; studentId: string; kind: InquiryKind; subject: string; body: string;
  fromGroupId?: string | null; toGroupId?: string | null;
}): Promise<void> {
  const { error } = await getSupabase().from('app_inquiries').insert({
    id: uuid(), center_id: input.centerId, student_id: input.studentId,
    kind: input.kind, subject: input.subject.trim(), body: input.body.trim(),
    from_group_id: input.kind === 'transfer' ? input.fromGroupId ?? null : null,
    to_group_id: input.kind === 'transfer' ? input.toGroupId ?? null : null,
    status: 'pending', created_at: nowIso(), updated_at: nowIso(),
  });
  if (error) throw error;
}

export async function replyInquiry(id: string, reply: string, status: InquiryStatus): Promise<void> {
  const { error } = await getSupabase().from('app_inquiries')
    .update({ reply: reply.trim(), status, updated_at: nowIso() }).eq('id', id);
  if (error) throw error;
}

/** قبول/رفض طلب نقل موثق؛ القبول يغيّر المجموعة الأساسية داخل RPC ذرية. */
export async function resolveStudentTransfer(id: string, status: 'approved' | 'rejected', reply = ''): Promise<void> {
  const { error } = await getSupabase().rpc('resolve_student_transfer', {
    p_inquiry_id: id, p_status: status, p_reply: reply.trim() || null,
  });
  if (error) throw error;
}

// ------------------------------------------------------------
// الاستبيانات
// ------------------------------------------------------------

export async function fetchSurveys(centerId: string): Promise<AppSurvey[]> {
  const { data, error } = await getSupabase().from('app_surveys').select('*')
    .eq('center_id', centerId).order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as AppSurvey[];
}

export async function fetchActiveSurveys(centerId: string): Promise<AppSurvey[]> {
  const { data, error } = await getSupabase().from('app_surveys').select('*')
    .eq('center_id', centerId).eq('is_active', true).order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as AppSurvey[];
}

export async function upsertSurvey(centerId: string, survey: Partial<AppSurvey> & {
  title: string; questions: SurveyQuestion[];
}): Promise<void> {
  const payload = {
    center_id: centerId,
    title: survey.title.trim(),
    description: (survey.description ?? '').trim(),
    questions: survey.questions,
    audience: survey.audience ?? 'all',
    grade_id: survey.audience === 'grade' ? survey.grade_id ?? null : null,
    group_ids: survey.audience === 'group' ? survey.group_ids ?? [] : [],
    is_active: survey.is_active ?? true,
    anonymous: survey.anonymous ?? false,
    lock_after_submit: survey.lock_after_submit ?? false,
    deadline: survey.deadline || null,
    version: survey.version ?? 1,
  };
  if (survey.id) {
    const { error } = await getSupabase().from('app_surveys').update(payload).eq('id', survey.id);
    if (error) throw error;
  } else {
    const { error } = await getSupabase().from('app_surveys').insert({ id: uuid(), ...payload });
    if (error) throw error;
  }
}

export async function deleteSurvey(id: string): Promise<void> {
  const sb = getSupabase();
  const { error: resErr } = await sb.from('app_survey_responses').delete().eq('survey_id', id);
  if (resErr) throw resErr;
  const { error } = await sb.from('app_surveys').delete().eq('id', id);
  if (error) throw error;
}

export async function toggleSurvey(id: string, active: boolean): Promise<void> {
  const { error } = await getSupabase().from('app_surveys').update({ is_active: active }).eq('id', id);
  if (error) throw error;
}

export async function submitSurveyResponse(input: {
  centerId: string; surveyId: string; studentId: string; answers: Record<string, SurveyAnswer>;
  lockAfterSubmit?: boolean;
}): Promise<void> {
  // ردّ واحد لكل طالب في كل استبيان: إن كان القفل مفعّلاً نرفض التكرار،
  // وإلا نُحدّث ردّه السابق بدل إدراج صف ثانٍ.
  const { error } = await getSupabase().from('app_survey_responses').upsert({
    id: uuid(), center_id: input.centerId, survey_id: input.surveyId,
    student_id: input.studentId, answers: input.answers,
  }, { onConflict: 'survey_id,student_id' });
  if (error) {
    if (input.lockAfterSubmit && String((error as any)?.message ?? '').includes('duplicate key')) {
      throw new Error('already_answered');
    }
    throw error;
  }
}

export async function fetchSurveyResponses(surveyId: string): Promise<AppSurveyResponse[]> {
  const { data, error } = await getSupabase().from('app_survey_responses').select('*')
    .eq('survey_id', surveyId).order('created_at', { ascending: false }).limit(500);
  if (error) throw error;
  return (data ?? []) as AppSurveyResponse[];
}

/** أعداد الردود لكل استبيان، لتظهر حالة المشاركة في القائمة دون فتح كل استبيان. */
export async function fetchSurveyResponseCounts(centerId: string): Promise<Record<string, number>> {
  const { data, error } = await getSupabase().from('app_survey_responses').select('survey_id')
    .eq('center_id', centerId).limit(5000);
  if (error) throw error;
  return (data ?? []).reduce<Record<string, number>>((counts, row) => {
    const id = String((row as { survey_id?: string }).survey_id ?? '');
    if (id) counts[id] = (counts[id] ?? 0) + 1;
    return counts;
  }, {});
}

export async function fetchMySurveyResponses(studentId: string): Promise<AppSurveyResponse[]> {
  const { data, error } = await getSupabase().from('app_survey_responses').select('*')
    .eq('student_id', studentId).limit(200);
  if (error) throw error;
  return (data ?? []) as AppSurveyResponse[];
}

// ------------------------------------------------------------
// الإشعارات الداخلية (بث جماعي بضغطة: صف واحد لكل رسالة)
// ------------------------------------------------------------

export async function fetchNotifications(centerId: string): Promise<AppNotification[]> {
  const { data, error } = await getSupabase().from('app_notifications').select('*')
    .eq('center_id', centerId).order('created_at', { ascending: false }).limit(200);
  if (error) throw error;
  return (data ?? []) as AppNotification[];
}

export async function sendNotification(input: {
  centerId: string; audience: NotificationAudience; audienceId?: string | null;
  title: string; body: string;
}): Promise<void> {
  const { error } = await getSupabase().from('app_notifications').insert({
    id: uuid(), center_id: input.centerId, audience: input.audience,
    audience_id: input.audienceId ?? null,
    title: input.title.trim(), body: input.body.trim(),
  });
  if (error) throw error;
}

export async function deleteNotification(id: string): Promise<void> {
  const sb = getSupabase();
  const { error: readsErr } = await sb.from('app_notification_reads').delete().eq('notification_id', id);
  if (readsErr) throw readsErr;
  const { error } = await sb.from('app_notifications').delete().eq('id', id);
  if (error) throw error;
}

export async function fetchNotificationReadCount(notificationId: string): Promise<number> {
  const counts = await fetchNotificationReadCounts([notificationId]);
  return counts.get(notificationId) ?? 0;
}

/** عدّاد المقروء لمجموعة إشعارات باستعلام واحد (بدل N استعلام) */
export async function fetchNotificationReadCounts(notificationIds: string[]): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (notificationIds.length === 0) return map;
  const { data, error } = await getSupabase().from('app_notification_reads').select('notification_id')
    .in('notification_id', notificationIds.slice(0, 500)).limit(5000);
  if (error) throw error;
  for (const r of (data ?? []) as { notification_id: string }[]) {
    map.set(r.notification_id, (map.get(r.notification_id) ?? 0) + 1);
  }
  return map;
}

export async function fetchMyNotifications(): Promise<MyNotification[]> {
  const { data, error } = await getSupabase().rpc('get_my_notifications');
  if (error) throw error;
  return (data ?? []) as MyNotification[];
}

/** إشعارات المطور الخاصة بأصحاب السنتر (قناة owners) */
export async function fetchOwnerNotices(centerId: string): Promise<AppNotification[]> {
  const { data, error } = await getSupabase().from('app_notifications').select('*')
    .eq('center_id', centerId).eq('audience', 'owners')
    .order('created_at', { ascending: false }).limit(100);
  if (error) throw error;
  return (data ?? []) as AppNotification[];
}

/** تعليم إشعار مطور كمقروء (يُخزن بمعرف حساب المسئول) */
export async function markOwnerNoticeRead(centerId: string, notificationId: string): Promise<void> {
  const { data: sess } = await getSupabase().auth.getSession();
  const uid = sess.session?.user.id;
  if (!uid) throw new Error('not_authenticated');
  const { data: mine } = await getSupabase().from('app_notification_reads').select('id')
    .eq('notification_id', notificationId).eq('student_id', uid).maybeSingle();
  if (mine) return;
  const { error } = await getSupabase().from('app_notification_reads').insert({
    id: uuid(), center_id: centerId, notification_id: notificationId, student_id: uid,
  });
  if (error) throw error;
}

// ------------------------------------------------------------
// قناة الدعم: تواصل ثنائي بين مالك السنتر والمطور
// ------------------------------------------------------------

async function myDisplayName(): Promise<string> {
  const sb = getSupabase();
  const { data: sess } = await sb.auth.getSession();
  const uid = sess.session?.user.id ?? '';
  if (!uid) return '';
  const { data: prof } = await sb.from('profiles').select('full_name').eq('id', uid).maybeSingle();
  return (prof as { full_name?: string } | null)?.full_name ?? '';
}

export async function fetchSupportMessages(centerId: string): Promise<SupportMessage[]> {
  const { data, error } = await getSupabase().from('support_messages').select('*')
    .eq('center_id', centerId)
    .order('created_at', { ascending: true })
    .limit(300);
  if (error) throw error;
  return (data ?? []) as SupportMessage[];
}

/** المالك يراسل المطور (رسائل سنتره فقط بفضل RLS) */
export async function sendSupportMessage(centerId: string, body: string): Promise<void> {
  const text = body.trim();
  if (!text) throw new Error('empty_message');
  const { error } = await getSupabase().from('support_messages').insert({
    id: uuid(), center_id: centerId,
    sender_role: 'owner', sender_name: await myDisplayName(), body: text,
  });
  if (error) throw error;
}

/** كل رسائل الدعم لكل السناتر (المطور فقط — RLS super_admin) */
export async function devFetchSupportMessages(): Promise<SupportMessage[]> {
  const { data, error } = await getSupabase().from('support_messages').select('*')
    .order('created_at', { ascending: true })
    .limit(3000);
  if (error) throw error;
  return (data ?? []) as SupportMessage[];
}

/** رد المطور على سنتر */
export async function devSendSupportMessage(centerId: string, body: string): Promise<void> {
  const text = body.trim();
  if (!text) throw new Error('empty_message');
  const { error } = await getSupabase().from('support_messages').insert({
    id: uuid(), center_id: centerId,
    sender_role: 'developer', sender_name: await myDisplayName(), body: text,
  });
  if (error) throw error;
}

export async function markNotificationRead(centerId: string, notificationId: string, studentId: string): Promise<void> {
  const { error } = await getSupabase().from('app_notification_reads').insert({
    id: uuid(), center_id: centerId, notification_id: notificationId, student_id: studentId,
  });
  if (error && !String((error as { message?: string }).message ?? '').includes('duplicate key')) throw error;
}

// ------------------------------------------------------------
// إعدادات السنتر التشغيلية
// ------------------------------------------------------------

export async function fetchCenterSettings(centerId: string): Promise<CenterSettings> {
  const { data, error } = await getSupabase()
    .from('center_settings').select('settings').eq('center_id', centerId).maybeSingle();
  if (error) throw error;
  const s = (data?.settings ?? {}) as Partial<CenterSettings>;
  return {
    whatsapp: s.whatsapp ?? '',
    contact_email: s.contact_email ?? '',
    registration_open: s.registration_open ?? true,
    archive_year: s.archive_year ?? '',
    print: normalizeCenterPrintSettings(s.print),
  };
}

/** هوية الوثائق في كل شاشة طباعة؛ تُقرأ وقت الطباعة حتى يطبق آخر تعديل فوراً. */
export async function fetchCenterPrintBranding(centerId: string): Promise<CenterPrintBranding> {
  const [settings, center] = await Promise.all([fetchCenterSettings(centerId), fetchMyCenter(centerId)]);
  return brandForCenter(center?.name, settings.print);
}

export async function saveCenterSettings(centerId: string, s: CenterSettings): Promise<void> {
  const { error } = await getSupabase().from('center_settings').upsert({
    center_id: centerId,
    settings: {
      whatsapp: s.whatsapp.trim(),
      contact_email: s.contact_email.trim(),
      registration_open: !!s.registration_open,
      archive_year: s.archive_year.trim(),
      print: normalizeCenterPrintSettings(s.print),
    },
    updated_at: nowIso(),
  });
  if (error) throw error;
}

// ------------------------------------------------------------
// لوحة الشرف والملفات والروابط (إدارة السنتر + عرض الطالب)
// ------------------------------------------------------------

export interface Honoree {
  id: string; center_id: string | null; name: string; details: string | null;
  student_id: string | null; group_id: string | null; created_at: string;
}
export interface SharedFile { id: string; center_id: string | null; name: string; file_url: string | null; created_at: string }
export interface ImportantLink { id: string; center_id: string | null; name: string; url: string | null; created_at: string }

export async function fetchHonorees(centerId: string): Promise<Honoree[]> {
  const { data, error } = await getSupabase().from('honorees').select('*')
    .eq('center_id', centerId).order('created_at', { ascending: false }).limit(200);
  if (error) throw error;
  return (data ?? []) as Honoree[];
}

export async function upsertHonoree(centerId: string, h: {
  id?: string; name: string; details: string; student_id?: string | null; group_id?: string | null;
}): Promise<void> {
  const payload = {
    center_id: centerId, name: h.name.trim(), details: h.details.trim() || null,
    student_id: h.student_id ?? null, group_id: h.group_id ?? null,
  };
  if (h.id) {
    const { error } = await getSupabase().from('honorees').update(payload).eq('id', h.id);
    if (error) throw error;
  } else {
    const { error } = await getSupabase().from('honorees').insert({ id: uuid(), ...payload });
    if (error) throw error;
  }
}

export async function deleteHonoree(id: string): Promise<void> {
  const { error } = await getSupabase().from('honorees').delete().eq('id', id);
  if (error) throw error;
}

export async function fetchSharedFiles(centerId: string): Promise<SharedFile[]> {
  const { data, error } = await getSupabase().from('shared_files').select('*')
    .eq('center_id', centerId).order('created_at', { ascending: false }).limit(200);
  if (error) throw error;
  return (data ?? []) as SharedFile[];
}

export async function upsertSharedFile(centerId: string, f: { id?: string; name: string; file_url: string }): Promise<void> {
  const payload = { center_id: centerId, name: f.name.trim(), file_url: f.file_url.trim() };
  if (f.id) {
    const { error } = await getSupabase().from('shared_files').update(payload).eq('id', f.id);
    if (error) throw error;
  } else {
    const { error } = await getSupabase().from('shared_files').insert({ id: uuid(), ...payload });
    if (error) throw error;
  }
}

export async function deleteSharedFile(id: string): Promise<void> {
  const { error } = await getSupabase().from('shared_files').delete().eq('id', id);
  if (error) throw error;
}

export async function fetchImportantLinks(centerId: string): Promise<ImportantLink[]> {
  const { data, error } = await getSupabase().from('important_links').select('*')
    .eq('center_id', centerId).order('created_at', { ascending: false }).limit(200);
  if (error) throw error;
  return (data ?? []) as ImportantLink[];
}

export async function upsertImportantLink(centerId: string, l: { id?: string; name: string; url: string }): Promise<void> {
  const payload = { center_id: centerId, name: l.name.trim(), url: l.url.trim() };
  if (l.id) {
    const { error } = await getSupabase().from('important_links').update(payload).eq('id', l.id);
    if (error) throw error;
  } else {
    const { error } = await getSupabase().from('important_links').insert({ id: uuid(), ...payload });
    if (error) throw error;
  }
}

export async function deleteImportantLink(id: string): Promise<void> {
  const { error } = await getSupabase().from('important_links').delete().eq('id', id);
  if (error) throw error;
}

export async function devFetchProfilesCount(): Promise<{ total: number; byRole: Record<string, number> }> {
  const { data, error } = await getSupabase().from('profiles').select('role').limit(5000);
  if (error) throw error;
  const byRole: Record<string, number> = {};
  for (const p of (data ?? []) as Pick<Profile, 'role'>[]) {
    byRole[p.role] = (byRole[p.role] ?? 0) + 1;
  }
  return { total: data?.length ?? 0, byRole };
}
