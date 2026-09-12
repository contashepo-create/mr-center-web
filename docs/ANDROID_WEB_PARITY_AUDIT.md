# مقارنة تطبيق Android مع مشروع الويب — Mr Center

تاريخ المقارنة: 2026-09-12  
مصدر Android المقارن: `contashepo-create/Mr-center-android-` داخل `/tmp/mr-center-android`  
مشروع الويب: `/home/user/mr-center-web`

## الخلاصة التنفيذية

النتيجة: ✅ مشروع الويب الحالي مناسب للعمل على **نفس قاعدة بيانات Supabase** الخاصة بتطبيق Android، وكل الأقسام التشغيلية الأساسية الموجودة في Android لها مقابل Web أو alias واضح في Next.js.

تم التأكد آلياً من الآتي:

- كل شاشة فعلية في Android بعد استبعاد ملفات `_layout.tsx` لها مقابل Web أو alias مذكور صراحة.
- ملفا SQL في `supabase/` مطابقان بين الريبوين byte-for-byte.
- طبقة البيانات `src/lib/api.ts` في الويب تطابق Android في أسماء الدوال ومراجع الجداول و RPC.
- المنطق المشترك `billing`, `pendingRegistration`, `qr`, `rbac`, `types`, `utils` متطابق في الواجهات المصدّرة.
- لا يوجد `service_role` في كود المتصفح، ولا اعتماد React Native/Expo داخل طبقة الويب.

## أوامر التحقق التي تم تشغيلها

```bash
npm run compare:android
npm test
npm run build
SMOKE_BASE_URL=http://127.0.0.1:3000 npm run smoke
npm audit --omit=dev
npm run test:e2e:live
```

النتائج النهائية:

| الفحص | النتيجة |
|---|---:|
| مقارنة Android/Web | ✅ 55 شاشة Android mapped — لا توجد شاشة غير mapped |
| Route surface | ✅ 74 ملف/مسار |
| Code health/dead code | ✅ 103 source files + 74 route checks |
| Security audit | ✅ 108 ملف مفحوص |
| Accounting audit | ✅ ledger/trigger/custody/payroll/commissions |
| Production build | ✅ 72 route |
| Smoke HTTP | ✅ 70 route |
| npm audit | ✅ 0 vulnerabilities |
| E2E Supabase live | ⏭️ جاهز ويتطلب مفاتيح `E2E_*` حقيقية |

## ما أضيف في المقارنة الدقيقة الثانية

- شددت `npm run compare:android` ليحسب كل ملفات Android تحت `app/` تلقائياً، ويُفشل لو ظهرت شاشة Android غير موجودة في خريطة الويب.
- شددت `npm run typecheck` بإضافة `--noUnusedLocals --noUnusedParameters` لاكتشاف الأكواد الميتة/imports غير المستخدمة.
- أضفت `npm run audit:code` لفحص الروابط الداخلية، hooks بدون `use client`, مراجع الجداول/RPC مقابل SQL، وتكرار exports.
- أضفت `npm run audit:accounting` لفحص منطق المحاسبة وربطه بالمخطط.
- أصلحت نقاط محاسبية اكتُشفت أثناء المراجعة: منع الإيراد اليدوي من الواجهة، وإبقاء الإيرادات آلية من trigger الدفعات فقط، وحساب حالة المستحق cumulatively عند الدفع الجزئي.

## توافق قاعدة البيانات و Supabase

| العنصر | الحالة | الدليل |
|---|---:|---|
| `supabase/android_multitenant_schema.sql` | ✅ مطابق Android | hash: `c6f63dad1685c6f6` |
| `supabase/20260911_safe_production_migration.sql` | ✅ مطابق Android | hash: `040c324983bf75a4` |
| أسماء دوال API في `src/lib/api.ts` | ✅ مطابقة | `npm run compare:android` |
| جداول `.from(...)` المستخدمة | ✅ مطابقة | نفس أسماء الجداول بين Android/Web |
| RPC `.rpc(...)` المستخدمة | ✅ مطابقة | نفس دوال التسجيل/الاختبارات/الإشعارات/الاشتراكات |
| RLS / `center_id` | ✅ نفس المخطط | العزل على الخادم وليس داخل الواجهة فقط |
| مفاتيح Supabase | ✅ Web-safe | `anon key` فقط في المتصفح؛ لا `service_role` |

ملاحظات اختلاف مقصودة:

- `sendPasswordReset` في الويب يضيف `redirectTo` إلى `/auth/update-password` لأن تدفق إعادة تعيين كلمة المرور في المتصفح يحتاج رابط رجوع واضح.
- `recordPayment` في الويب يحسب حالة المستحق بعد الدفعات الجزئية بشكل تراكمي؛ هذا يحافظ على نفس الجداول والـ trigger، ويمنع بقاء المستحق `partial` بعد اكتمال المدفوعات من الويب.
- طبقات التخزين/المشاركة مختلفة منصةً فقط: Android يستخدم AsyncStorage/Expo Sharing، والويب يستخدم localStorage/تنزيل/طباعة المتصفح.

## خريطة الأقسام بين Android و Web

### عام ومصادقة

| Android | Web | الحالة |
|---|---|---:|
| `app/index.tsx` | `/` | ✅ |
| `app/about.tsx` | `/about` | ✅ |
| `app/blocked.tsx` | `/blocked` | ✅ |
| `auth/login-admin` | `/auth/login-admin` → `/auth/login?role=admin` | ✅ |
| `auth/login-student` | `/auth/login-student` → `/auth/login?role=student` | ✅ |
| `auth/login-teacher` | `/auth/login-teacher` → `/auth/login?role=teacher` | ✅ |
| `auth/register-center` | `/auth/register-center` | ✅ |
| `auth/register-student` | `/auth/register-student` | ✅ |
| `auth/register-teacher` | `/auth/register-teacher` → `/auth/register-staff` | ✅ |
| Reset password web-only | `/auth/update-password` | ✅ مناسب للويب |

### لوحة مسئول السنتر / فريق العمل

| Android | Web | الحالة |
|---|---|---:|
| `dashboard.tsx` | `/admin` + `/admin/dashboard` | ✅ |
| `students.tsx` | `/admin/students` | ✅ |
| `student/[id].tsx` | `/admin/students/[id]` + `/admin/student/[id]` | ✅ |
| `groups.tsx` | `/admin/groups` | ✅ |
| `grades-list.tsx` | `/admin/grades-list` → `/admin/groups` | ✅ |
| `attendance.tsx` | `/admin/attendance` | ✅ |
| `scan.tsx` | `/admin/scan` | ✅ |
| `payments.tsx` | `/admin/payments` | ✅ |
| manual grades داخل Android | `/admin/grades` | ✅ Web route إضافي واضح |
| `exams.tsx` | `/admin/exams` | ✅ |
| `surveys.tsx` | `/admin/surveys` | ✅ |
| `library.tsx` | `/admin/library` | ✅ |
| `schedule.tsx` | `/admin/schedule` | ✅ |
| `reports.tsx` | `/admin/reports` | ✅ |
| `announcements.tsx` | `/admin/announcements` | ✅ |
| `notifications.tsx` | `/admin/notifications` | ✅ |
| `dev-notices.tsx` | `/admin/dev-notices` | ✅ |
| `inquiries.tsx` | `/admin/inquiries` | ✅ |
| `whatsapp.tsx` | `/admin/whatsapp` | ✅ |
| `teachers.tsx` | `/admin/teachers` → `/admin/staff` | ✅ |
| `subscription.tsx` | `/admin/subscription` | ✅ |
| `support.tsx` | `/admin/support` | ✅ |
| `accounting.tsx` | `/admin/accounting` | ✅ |
| `custody.tsx` | `/admin/custody` | ✅ |
| `admin-settings.tsx` | `/admin/admin-settings` → `/admin/settings` | ✅ |
| `activity.tsx` | `/admin/activity` | ✅ |
| `guide.tsx` | `/admin/guide` | ✅ |
| `more.tsx` | `/admin/more` → `/admin/guide` | ✅ Web navigation بديل للتبويب |

### الطالب

| Android | Web | الحالة |
|---|---|---:|
| `home.tsx` | `/student` + `/student/home` | ✅ |
| `my-attendance.tsx` | `/student/attendance` + `/student/my-attendance` | ✅ |
| `my-grades.tsx` | `/student/grades` + `/student/my-grades` | ✅ |
| `my-payments.tsx` | `/student/payments` + `/student/my-payments` | ✅ |
| `profile.tsx` | `/student/profile` | ✅ |
| `my-exams.tsx` | `/student/exams` + `/student/my-exams` | ✅ |
| `my-inquiries.tsx` | `/student/inquiries` + `/student/my-inquiries` | ✅ |
| `my-library.tsx` | `/student/library` + `/student/my-library` | ✅ |
| `my-notifications.tsx` | `/student/notifications` + `/student/my-notifications` | ✅ |
| `my-schedule.tsx` | `/student/schedule` + `/student/my-schedule` | ✅ |
| `my-surveys.tsx` | `/student/surveys` + `/student/my-surveys` | ✅ |

### المطور / Super Admin

| Android | Web | الحالة |
|---|---|---:|
| `developer/index.tsx` | `/developer` | ✅ |
| `developer/connection.tsx` | `/developer/connection` | ✅ |
| `developer/centers.tsx` | `/developer/centers` | ✅ |
| `developer/center-detail.tsx` | `/developer/centers/[id]` | ✅ |
| `developer/subscriptions.tsx` | `/developer/subscriptions` | ✅ |
| `developer/broadcast.tsx` | `/developer/broadcast` | ✅ |
| `developer/support.tsx` | `/developer/support` | ✅ |
| `developer/app-info.tsx` | `/developer/app-info` | ✅ |

## مطابقات طريقة العمل المهمة

- التسجيل والدخول يستخدمان نفس Supabase Auth ونفس RPC:
  - `complete_center_registration`
  - `complete_student_registration`
  - `register_staff_account`
  - `lookup_center_by_code`
  - `check_registration_availability`
- صلاحيات الأدوار متوافقة مع Android:
  - `super_admin`
  - `center_admin`
  - `student`
  - `teacher`
  - `manager`
  - `secretary`
- فريق العمل في الويب أصبح يلتزم بنطاق مجموعات المدرس في الواجهة مثل Android عبر `useTeacherGroupIds` في صفحات الطلاب/المجموعات/الحضور/المدفوعات/التقارير/الجدول/واتساب/الإشعارات.
- الاختبارات الإلكترونية تستخدم نفس الجداول و RPC:
  - `app_exams`
  - `app_exam_attempts`
  - `submit_exam`
- الإشعارات تستخدم نفس الجداول و RPC:
  - `app_notifications`
  - `app_notification_reads`
  - `get_my_notifications`
- الطالب يرى بياناته عبر نفس `profile.student_id` ونفس RLS.
- تعدد المجموعات للطالب مدعوم عبر `student_groups` في ملف الطالب وجدول الطالب.
- النسخ الاحتياطي في الويب يصدّر نفس 23 جدولاً التي يصدرها Android، لكن عبر تحميل JSON من المتصفح بدلاً من مشاركة ملف Expo.

## مراجعة الجزء المحاسبي

الجزء المحاسبي تمت مراجعته كدفتر مالي مرتبط بالتحصيل وليس كجدول منفصل مستقل:

- جدول `payments` هو مصدر دفعات الطلاب.
- Trigger `trg_payment_income` ينشئ سطر إيراد تلقائياً في `center_ledger` من كل دفعة.
- يوجد unique index على `source_payment_id` حتى لا تتكرر نفس الدفعة كإيراد أكثر من مرة.
- واجهة `/admin/accounting` لم تعد تسمح بإدخال إيراد يدوي؛ الإدخال اليدوي محصور في المصروفات/الرواتب/السلف/المكافآت/الإيجار/المرافق/المشتريات.
- عند تسجيل دفعة مرتبطة بمستحق، يتم حساب حالة المستحق من مجموع الدفعات السابقة + الدفعة الجديدة:
  - `paid` عند اكتمال أو تجاوز مبلغ المستحق.
  - `partial` عند السداد الجزئي.
- العهدة `/admin/custody` تعتمد على `submit_staff_custody` وتحسب المتوقع من إيرادات `payment_collection` الخاصة بالموظف في اليوم.
- العمولات تقرأ وتكتب `staff_commission_rules`، وتُعرض دون تغيير إجمالي الإيراد.
- كشف الرواتب يستخدم `buildPayrollReportHtml` ويحسب: راتب + مكافآت/عمولات - خصومات - سلف.

## اختلافات مقصودة بسبب اختلاف المنصة

هذه ليست نواقص في التكامل مع قاعدة البيانات، بل بدائل مناسبة للويب:

| Android | Web |
|---|---|
| `expo-camera` للماسح | BarcodeDetector في المتصفح + إدخال يدوي احتياطي |
| PDF عبر `expo-print`/`expo-sharing` | نافذة طباعة المتصفح وحفظ PDF |
| self-update APK عبر R2 | نشر Vercel يحدث نسخة الويب مباشرة |
| Expo Push Token | إشعارات داخلية داخل التطبيق/الويب؛ Web Push يمكن إضافته لاحقاً لو مطلوب |
| AsyncStorage | `localStorage` + Environment Variables + Cloudflare config URL |

## الحكم النهائي

✅ بعد المقارنة، المشروع الحالي يحتوي أقسام Android الأساسية ومناسب للعمل على نفس قاعدة Supabase.  
✅ طبقة البيانات والمخطط متوافقان مع Android.  
✅ الفحوصات البرمجية والأمنية والوظيفية ناجحة.  
✅ أي عملية تتم من الويب على الجداول/RPC نفسها ستظهر في تطبيق Android والعكس، مع بقاء العزل الحقيقي تحت RLS في Supabase.
