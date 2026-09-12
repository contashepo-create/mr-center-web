// ============================================================
// منطق الصلاحيات النقي (بلا أي تبعية React Native) — يُختبر آلياً
// في Node مباشرة. staff.ts يعيد تصديره ويضيف الـ Hooks فوقه.
// ============================================================

import type { Profile, TeacherPermKey, TeacherPerms } from './types';

/** صلاحيات فريق العمل العشر — يمنحها المالك من شاشة الفريق */
export const TEACHER_PERMS: { key: TeacherPermKey; label: string; hint: string }[] = [
  { key: 'attendance', label: 'تسجيل الحضور', hint: 'كشف الحضور والمسح بالباركود' },
  { key: 'exams', label: 'الاختبارات', hint: 'إنشاء ونشر وتصحيح' },
  { key: 'grades', label: 'الدرجات والتقييم', hint: 'درجات يدوية وتقييم الطلاب' },
  { key: 'collect', label: 'التحصيل', hint: 'تسجيل دفعات وتحصيل مستحقات' },
  { key: 'reports', label: 'التقارير', hint: 'عرض تقارير الشهر وتقارير الطلاب' },
  { key: 'announcements', label: 'الإعلانات', hint: 'نشر وتثبيت إعلانات' },
  { key: 'surveys', label: 'الاستبيانات', hint: 'إنشاء ومتابعة النتائج' },
  { key: 'honors', label: 'التكريم', hint: 'إضافة للوحة الشرف' },
  { key: 'inquiries', label: 'الرد على الطلبات', hint: 'الرد على استفسارات الطلاب' },
  { key: 'notify', label: 'الإشعارات', hint: 'بث إشعارات للطلاب' },
];

/** أدوار فريق العمل التابع (صلاحيات مفصلة وتفعيل بيد المالك) */
export const STAFF_ROLES = ['teacher', 'manager', 'secretary'] as const;

/** هل الحساب من فريق العمل التابع؟ */
export function isStaff(profile: Profile | null): boolean {
  return !!profile && (STAFF_ROLES as readonly string[]).includes(profile.role);
}

/** هل الحساب هو مالك السنتر (صلاحيات كاملة)؟ */
export function isOwner(profile: Profile | null): boolean {
  return !!profile && profile.role === 'center_admin';
}

/** هل يملك البروفايل صلاحية معينة؟ (المالك = كامل دوماً — الفريق الخامل = لا شيء) */
export function can(profile: Profile | null, perm: TeacherPermKey): boolean {
  if (!profile) return false;
  if (profile.role === 'center_admin' || profile.role === 'super_admin') return true;
  if (!isStaff(profile) || !profile.is_active) return false;
  return (profile.perms as TeacherPerms)?.[perm] === true;
}

/** اسم الدور بالعربية */
export function roleLabel(role: string): string {
  if (role === 'teacher') return 'مدرس';
  if (role === 'manager') return 'مدير';
  if (role === 'secretary') return 'سكرتير';
  if (role === 'center_admin') return 'صاحب السنتر';
  if (role === 'super_admin') return 'المطور';
  return role;
}

/** تبويبات المدرس حسب صلاحياته: اسم الشاشة ← مفتاح الصلاحية (null = دائماً) */
export const TEACHER_TABS: { route: string; perm: TeacherPermKey | null }[] = [
  { route: 'dashboard', perm: null },
  { route: 'students', perm: null },
  { route: 'groups', perm: null },
  { route: 'attendance', perm: 'attendance' },
  { route: 'more', perm: null },
];

/** شاشات الإدارة الداخلية ← الصلاحية المطلوبة (null = متاحة دوماً للمفعّل) */
export const TEACHER_SCREENS: { route: string; perm: TeacherPermKey | null }[] = [
  { route: 'scan', perm: 'attendance' },
  { route: 'exams', perm: 'exams' },
  { route: 'inquiries', perm: 'inquiries' },
  { route: 'surveys', perm: 'surveys' },
  { route: 'library', perm: 'honors' },
  { route: 'schedule', perm: null },
  { route: 'reports', perm: 'reports' },
  { route: 'payments', perm: 'collect' },
  { route: 'announcements', perm: 'announcements' },
  { route: 'notifications', perm: 'notify' },
  { route: 'grades-list', perm: null },
  { route: 'student', perm: null },
];
