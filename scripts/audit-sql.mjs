#!/usr/bin/env node
// ============================================================================
// تدقيق أمني آلي لمخطط قاعدة البيانات (supabase/android_multitenant_schema.sql)
// يتحقق من ثوابت الأمان الحرجة ويرفض أي تراجع مستقبلي:
//   • العزل بـ center_id موجود لكل الجداول المشتركة
//   • لا سياسات واسعة USING (true)
//   • قائمة legacy_admins البيضاء (وليس «بلا ملف = أدمن»)
//   • حماية كود السنتر وحالة الإيقاف
//   • قيود الفرادة (الكود/البريد/الهاتف)
//   • صلاحيات تنفيذ دوال RPC
//   • سلامة بنية الملف (معاملة one-shot وعلامات الدوال)
// التشغيل: node scripts/audit-sql.mjs
// ============================================================================

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sql = readFileSync(join(root, 'supabase/android_multitenant_schema.sql'), 'utf8');

let passed = 0; let failed = 0;
function check(name, cond) {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}`); }
}
const has = (s) => sql.includes(s);
const re = (r) => r.test(sql);

console.log('\n━━ ١) سلامة البنية ━');
check('معاملة واحدة (BEGIN ... COMMIT)', /^\s*BEGIN;/m.test(sql) && /\bCOMMIT;/m.test(sql));
check('علامات $$ متوازنة', (sql.match(/\$\$/g) || []).length % 2 === 0);
check('لا يحوي DROP TABLE نهائي (بدون IF EXISTS)', !/DROP\s+TABLE\s+(?!IF\s+EXISTS)/i.test(sql));
check('لا يحوي DELETE جماعي بلا WHERE', !/DELETE\s+FROM\s+public\.\w+\s*;/i.test(sql));

console.log('\n━━ ٢) الجداول الأساسية لتعدد السناتر ━');
for (const t of ['centers', 'profiles', 'center_subscriptions', 'app_config']) {
  check(`جدول ${t} يُنشأ مع RLS`,
    has(`CREATE TABLE IF NOT EXISTS public.${t}`) && has(`ENABLE ROW LEVEL SECURITY`) && re(new RegExp(`ALTER TABLE public\\.${t}\\s+ENABLE ROW LEVEL SECURITY`)));
}

console.log('\n━━ ٣) العزل بـ center_id في الجداول المشتركة ━');
const shared = ['grades', 'groups', 'students', 'dues', 'payments', 'sessions', 'attendance', 'announcements', 'manual_grades'];
for (const t of shared) {
  check(`${t}: عمود center_id + RLS`,
    re(new RegExp(`ALTER TABLE public\\.${t}\\s+ADD COLUMN IF NOT EXISTS center_id`)) &&
    re(new RegExp(`ALTER TABLE public\\.${t}\\s+ENABLE ROW LEVEL SECURITY`)));
}

console.log('\n━━ ٤) منع السياسات الواسعة الخطرة ━');
check('لا توجد سياسة USING (true) إطلاقاً', !/USING\s*\(\s*true\s*\)/i.test(sql));
check('لا توجد WITH CHECK (true) إطلاقاً', !/WITH\s+CHECK\s*\(\s*true\s*\)/i.test(sql));
for (const t of shared) {
  check(`إزالة السياسة القديمة الواسعة عن ${t}`,
    has(`DROP POLICY IF EXISTS "authenticated full access" ON public.${t}`));
}

console.log('\n━━ ٥) عزل الطالب: قراءة نفسه فقط ━');
for (const [tbl, pol] of [
  ['students', 'students_self_read'],
  ['dues', 'dues_self_read'],
  ['payments', 'payments_self_read'],
  ['attendance', 'attendance_self_read'],
  ['manual_grades', 'manual_grades_self_read'],
]) {
  check(`${tbl}: سياسة ${pol} بـ my_student_id()`,
    has(`CREATE POLICY "${pol}" ON public.${tbl} FOR SELECT`) &&
    re(new RegExp(`"${pol}"[\\s\\S]{0,300}my_student_id\\(\\)`)));
}
check('members يقرأون بيانات سنترهم فقط (groups/grades/sessions)',
  ['groups', 'grades', 'sessions', 'announcements'].every((t) =>
    re(new RegExp(`"${t}_member_read"[\\s\\S]{0,300}my_center_id\\(\\)`))));

console.log('\n━━ ٦) القائمة البيضاء للنظام القديم (سد ثغرة «بلا ملف = أدمن») ━');
check('بذر legacy_admins من حسابات ما قبل الترحيل',
  has(`INSERT INTO public.app_config (key, value)`) && has(`'legacy_admins'`) && has(`FROM auth.users`));
check('is_legacy_admin يفحص العضوية في القائمة البيضاء',
  re(/is_legacy_admin\(\)[\s\S]{0,400}legacy_admins[\s\S]{0,200}auth\.uid\(\)/));
check('is_legacy_admin لا يعتمد على «بلا ملف شخصي»',
  !re(/is_legacy_admin\(\)[\s\S]{0,500}NOT EXISTS \(SELECT 1 FROM public\.profiles/));

console.log('\n━━ ٧) حماية ثوابت السنتر (سد ثغرة إعادة التفعيل الذاتي) ━');
check('مشغل guard_center_code موجود ومفعّل', has('CREATE TRIGGER trg_guard_center_code'));
check('حماية الكود (code_is_fixed)', has('RAISE EXCEPTION \'code_is_fixed\''));
check('حماية حالة الإيقاف (status_managed_by_developer)', has('RAISE EXCEPTION \'status_managed_by_developer\''));
check('حماية هوية الملف الشخصي (identity_protected)', has('RAISE EXCEPTION \'identity_protected\''));

console.log('\n━━ ٨) قيود الفرادة العالمية ━');
check('كود السنتر فريد (upper)', has('CREATE UNIQUE INDEX IF NOT EXISTS centers_code_unique'));
check('البريد فريد على مستوى النظام', has('profiles_email_unique'));
check('الهاتف فريد على مستوى النظام', has('profiles_phone_unique'));

console.log('\n━━ ٩) صلاحيات دوال RPC ━');
check('lookup_center_by_code متاح للزائر (قبل التسجيل)',
  has('GRANT EXECUTE ON FUNCTION public.lookup_center_by_code(TEXT) TO anon, authenticated'));
check('check_registration_availability متاح للزائر',
  has('GRANT EXECUTE ON FUNCTION public.check_registration_availability(TEXT, TEXT) TO anon, authenticated'));
check('complete_center_registration للمصادقين فقط',
  has('GRANT EXECUTE ON FUNCTION public.complete_center_registration(TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated')
  && !has('complete_center_registration(TEXT, TEXT, TEXT, TEXT, TEXT) TO anon,'));
check('نوعا الحساب center/solo', has("p_kind TEXT") && has("CHECK (kind IN ('center','solo'))"));
check('complete_student_registration للمصادقين فقط',
  has('GRANT EXECUTE ON FUNCTION public.complete_student_registration(UUID, TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated')
  && !has('complete_student_registration(UUID, TEXT, TEXT, TEXT, TEXT, TEXT) TO anon,'));
check('تسجيل الطالب يحفظ الصف والمجموعة مع التحقق من السنتر',
  has('invalid_group') && has('invalid_grade') && has('p_group_id'));
check('get_my_subscription للمصادقين فقط',
  has('GRANT EXECUTE ON FUNCTION public.get_my_subscription() TO authenticated'));

console.log('\n━━ ١٠) منطق التسجيل الحساس ━');
check('رسالة الكود المكرر (center_code_taken)', has('EXCEPTION \'center_code_taken\''));
check('رسالة الهاتف المكرر (phone_taken)', has('EXCEPTION \'phone_taken\''));
check('رفض السنتر الموقوف عند تسجيل الطالب', has('EXCEPTION \'center_suspended\''));
check('إنشاء اشتراك تجريبي تلقائي للسنتر الجديد', has('اشتراك تجريبي'));
check('الاشتراك التجريبي 14 يوماً بخطة trial', has('CURRENT_DATE + 14') && has("'trial'"));
check('منتجات الباقات في القيد', has("'center_full','center_medium','solo_teacher'")); 
check('حظر تكرار التسجيل لنفس الحساب (already_registered)', has('EXCEPTION \'already_registered\''));
check('الطوابع الزمنية TIMESTAMPTZ لا TEXT (منع خطأ created_at)', !/v_now TEXT/.test(sql));

console.log('\n━━ ١١) app_config — قراءة عامة مقيدة ━');
check('قراءة عامة لصف public_config فقط',
  has(`CREATE POLICY "app_config_public_read" ON public.app_config FOR SELECT TO anon, authenticated`)
  && has(`USING (key = 'public_config')`));
check('الكتابة للمطور فقط', has('"app_config_super_admin"'));

check('صلاحيات service_role لعمليات الخادم (دفع/إدارة)',
  has('TO anon, authenticated, service_role'));

console.log('\n━━ ١٢/ب) جداول الأقسام الجديدة ━');
for (const t of ['app_exams', 'app_exam_attempts', 'app_inquiries', 'app_surveys', 'app_survey_responses', 'center_settings']) {
  check(`${t}: إنشاء + RLS + عزل`,
    has(`CREATE TABLE IF NOT EXISTS public.${t}`) &&
    re(new RegExp(`ALTER TABLE public\\.${t}\\s+ENABLE ROW LEVEL SECURITY`)) &&
    re(new RegExp(`ON public\\.${t}[\\s\\S]{0,600}admin_owns_center`)));
}
check('التسعير المتقدم للمجموعات (billing_type/session_price)',
  has('billing_type') && has('session_price') && has('weekly_price'));
check('بوابة فتح/إغلاق التسجيل (registration_closed)', has('EXCEPTION \'registration_closed\''));
check('منع تكرار محاولة الامتحان (already_attempted)', has('EXCEPTION \'already_attempted\''));
check('ربط الحساب بسجل موجود بنفس الهاتف', has('NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.student_id = s.id)'));
check('ربط التكريم بالطالب والمجموعة', has('ADD COLUMN IF NOT EXISTS student_id TEXT') && has('ADD COLUMN IF NOT EXISTS group_id TEXT'));
check('مدرس المجموعة (اسم ورقم)', has('ADD COLUMN IF NOT EXISTS teacher_name TEXT') && has('ADD COLUMN IF NOT EXISTS teacher_phone TEXT'));
check('رمز الدفع profiles.push_token', has('ADD COLUMN IF NOT EXISTS push_token TEXT'));
check('طلبات الترقية + سجل العمليات + RLS', ['subscription_requests', 'activity_log', 'subreq_owner_all', 'activity_staff_insert'].every((s) => has(s)));
check('حدود الباقات خادمياً (فريق + 200 طالب)', has('staff_limit_reached') && has('students_limit_reached') && has('trg_staff_limit_check')); 
check('قناة owners للمطور (قيد + سياسات)', has("'owners'") && has('app_reads_owner_insert') && has('app_reads_owner_read'));
check('جدول قناة الدعم (مالك ↔ مطور)', has('CREATE TABLE IF NOT EXISTS public.support_messages'));
check('سياسات قناة الدعم الثلاث', has('"support_owner_read"') && has('"support_owner_insert"') && has('"support_super_admin"'));
check('الأنواع اليدوية للامتحانات تُراجع خادمياً', has("v_type IN ('essay', 'correct', 'short')"));
check('صحّح الخطأ بالمطابقة التامة تُحسب آلياً', has("v_type = 'correct' AND (v_exam.answers -> i) IS NOT NULL"));
check('حالة مراجعة المحاولة (pending_review)', has('pending_review'));
check('تصحيح بدرجات لكل سؤال وأنواع أسئلة', has('mcq') && has('essay'));
check('get_published_exams للمصادقين فقط',
  has('GRANT EXECUTE ON FUNCTION public.get_published_exams() TO authenticated'));
check('submit_exam_attempt للمصادقين فقط',
  has('GRANT EXECUTE ON FUNCTION public.submit_exam_attempt(TEXT, JSONB) TO authenticated'));
check('الطالب لا يقرأ جدول الامتحانات مباشرة (عبر RPC فقط)',
  !re(/CREATE POLICY "app_exams_member_read"/));
check('البحث بالكود يميز السنتر الموقوف', has('owner_name TEXT, status TEXT'));
check('إسقاط الدوال قبل تغيير توقيعها (منع خطأ 42P13)',
  has('DROP FUNCTION IF EXISTS public.lookup_center_by_code(TEXT)')
  && has('DROP FUNCTION IF EXISTS public.complete_center_registration(TEXT, TEXT, TEXT, TEXT)')
  && has('DROP FUNCTION IF EXISTS public.complete_student_registration(UUID, TEXT, TEXT, TEXT)'));
check('قوائم التسجيل العامة للزائر', has('get_center_signup_lists') && has('GRANT EXECUTE ON FUNCTION public.get_center_signup_lists(UUID) TO anon, authenticated'));
check('جداول الإشعارات + RLS + عزل', ['app_notifications', 'app_notif_admin_all', 'app_notification_reads', 'app_reads_admin_all'].every((s) => has(s)));
check('إشعارات الطالب عبر RPC مفلتر فقط',
  has('GRANT EXECUTE ON FUNCTION public.get_my_notifications() TO authenticated')
  && !re(/CREATE POLICY "app_notif_member_read"/));

console.log('\n━━ ١٢/ج) المدرس التابع وأنواع الحسابات والربط المتعدد ━');
check('دور teacher بسياسات سنتره', has('teacher_center_ok') && has('students_teacher_read') && has('attendance_teacher_all'));
check('قيد الدور يشمل الفريق كاملاً', has("CHECK (role IN ('super_admin','center_admin','student','teacher','manager','secretary'))"));
check('لا إدخال مباشر للمحاولات (التصحيح خادمي فقط)', !re(/CREATE POLICY "app_attempts_self_insert"/));
check('الطالب يقرأ عضوياته الإضافية', has('student_groups_self_read'));
check('تفعيل المدرس بيد المسئول (سياسة + مشغل)',
  has('profiles_teacher_manage') && has("OLD.role IN ('teacher','manager','secretary')"));
check('حذف الفريق للمسئول فقط (بلا حذف مالك/طالب)',
  has('profiles_staff_delete') && has("role IN ('teacher','manager','secretary')"));
check('تسجيل حساب فريق خامل للمصادقين فقط',
  has('GRANT EXECUTE ON FUNCTION public.register_staff_account(UUID, TEXT, TEXT, TEXT) TO authenticated'));
check('أنواع الحسابات center/solo', has("CHECK (kind IN ('center','solo'))"));
check('صلاحيات المدرس profiles.perms', has('ADD COLUMN IF NOT EXISTS perms JSONB'));
check('ربط الطالب متعدد المجموعات', has('CREATE TABLE IF NOT EXISTS public.student_groups') && has('trg_sync_group_count_junction'));
check('إسناد المجموعات للمدرس', has('CREATE TABLE IF NOT EXISTS public.teacher_groups'));
check('رقم الولي يختلف عن الطالب', has("EXCEPTION 'same_guardian_phone'"));
for (const fn of ['teacher_is_active', 'teacher_center_ok', 'register_staff_account', 'staff_limit_check']) {
  check(`دالة ${fn}`, re(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${fn}\\s*\\(`)));
}
check('دوال المدرس معرّفة قبل السياسات التي تستخدمها',
  sql.indexOf('CREATE OR REPLACE FUNCTION public.teacher_center_ok') <
  sql.indexOf('student_groups_teacher_rw'));
check('لا نسخ قديمة تطغى على الجديدة (تعريف واحد فعال لكل دالة)', (() => {
  const countDef = (fn) => (sql.match(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${fn}\\s*\\(`, 'g')) || []).length;
  return countDef('teacher_is_active') === 1
    && sql.includes("role IN ('teacher','manager','secretary')");
})());

console.log('\n━━ ١٢) دوال العزل الأساسية موجودة ━');
for (const fn of ['my_role()', 'my_center_id()', 'my_student_id()', 'is_legacy_admin()', 'center_is_active(UUID)', 'admin_owns_center(UUID)', 'get_my_subscription()', 'guard_profile_identity()', 'sync_group_student_count()']) {
  const base = fn.split('(')[0];
  check(`دالة ${base}`, re(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${base}\\s*\\(`)));
}
for (const fn of ['get_published_exams', 'submit_exam_attempt']) {
  check(`دالة ${fn}`, re(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${fn}\\s*\\(`)));
}

console.log(`\n━━━ النتيجة: ${passed} فحص ناجح / ${failed} فاشل ━━━\n`);
process.exit(failed ? 1 : 0);
