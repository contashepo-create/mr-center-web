# خريطة مساواة تطبيق Android مع نسخة الويب

الغرض: الويب ليس تحويلًا للتطبيق، بل واجهة مستقلة لنفس المنتج ونفس قاعدة Supabase.

## مكتمل في هذه النسخة

| المجال | الحالة | المسارات |
|---|---:|---|
| تأسيس Next.js + RTL + Supabase | ✅ | كل المشروع |
| جلسة المستخدم وحارس الأدوار | ✅ | `src/context/session.tsx`, `src/components/guards.tsx` |
| تسجيل الدخول للأدوار | ✅ | `/auth/login` |
| تسجيل سنتر/طالب/فريق | ✅ | `/auth/register-*` |
| لوحة مسئول السنتر | ✅ | `/admin` |
| الطلاب + ملف شامل | ✅ | `/admin/students`, `/admin/students/[id]`, `/admin/student/[id]` |
| الصفوف والمجموعات | ✅ | `/admin/groups`, `/admin/grades-list` |
| الحضور + QR | ✅ | `/admin/attendance`, `/admin/scan`, `/student/profile` |
| المستحقات والتحصيل | ✅ | `/admin/payments`, `/student/payments` |
| الدرجات اليدوية | ✅ | `/admin/grades`, `/student/grades` |
| الاختبارات الإلكترونية | ✅ | `/admin/exams`, `/student/exams` — باني أسئلة مرئي ومحاولات وتصحيح |
| الاستبيانات | ✅ | `/admin/surveys`, `/student/surveys` |
| المكتبة ولوحة الشرف والروابط | ✅ | `/admin/library`, `/student/library` |
| الجدول الأسبوعي | ✅ | `/admin/schedule`, `/student/schedule` |
| التقارير و PDF/Print | ✅ | `/admin/reports`, ملف الطالب، الجدول |
| الإعلانات | ✅ | `/admin/announcements`, `/student` |
| الإشعارات الداخلية | ✅ | `/admin/notifications`, `/student/notifications`, `/developer/broadcast` |
| طلبات الطلاب | ✅ | `/admin/inquiries`, `/student/inquiries` |
| واتساب | ✅ | `/admin/whatsapp` |
| فريق العمل والصلاحيات | ✅ | `/admin/staff` |
| الاشتراكات | ✅ | `/admin/subscription`, `/developer/subscriptions` |
| دعم المالك والمطور | ✅ | `/admin/support`, `/developer/support` |
| المحاسبة | ✅ | `/admin/accounting` — تحصيل آلي، مصروفات، رواتب، سلف، عمولات |
| عهدة التحصيل | ✅ | `/admin/custody` |
| تنبيهات المطور للمالك | ✅ | `/admin/dev-notices` |
| إعدادات السنتر والنسخ الاحتياطي | ✅ | `/admin/settings`, `/admin/admin-settings` |
| سجل النشاط | ✅ | `/admin/activity` |
| لوحة المطور والسناتر | ✅ | `/developer`, `/developer/centers`, `/developer/centers/[id]` |
| Aliases توافق Android | ✅ | `/admin/dashboard`, `/admin/more`, `/student/home`, `/student/my-*` |
| حول التطبيق والاتصال | ✅ | `/about`, `/developer/app-info`, `/developer/connection` |

## ملاحظات مهمة

- المشروع يستخدم `anon key` في المتصفح فقط، ويعتمد على RLS/RPC الموجودة في Supabase.
- تمت مقارنة الويب آلياً مع ريبو Android عبر `npm run compare:android`؛ التقرير التفصيلي في `docs/ANDROID_WEB_PARITY_AUDIT.md`.
- نطاق المدرس في الواجهة يفلتر المجموعات/الطلاب حسب `teacher_groups` مثل تطبيق Android، مع بقاء RLS هو خط الدفاع الخادمي.
- أي وظيفة حساسة لا يجب نقلها إلى Service Role داخل المتصفح.
- بعض وظائف الموبايل التي لا معنى لها على الويب تم استبدالها ببدائل ويب:
  - تحديث APK الذاتي غير مطلوب لأن Vercel يحدث النسخة تلقائياً عند النشر.
  - مشاركة الملفات أصبحت روابط وفتح/تحميل من المتصفح.
  - الطباعة/PDF تتم عبر نافذة طباعة المتصفح.
  - QR Scanner يستخدم BarcodeDetector إن دعمه المتصفح مع إدخال يدوي احتياطي.

## تحسينات مستقبلية اختيارية

| المجال | المقترح |
|---|---|
| واجهة الاختبارات | تحسينات UX اختيارية مثل السحب والإفلات ومعاينة قبل النشر؛ الباني المرئي الأساسي منفذ. |
| Realtime | اشتراكات Supabase realtime لتحديث الجداول بدون إعادة تحميل. |
| Web Push | إشعارات Web Push للمتصفح بجانب إشعارات التطبيق. |
| رفع ملفات Storage | واجهة رفع مباشرة إلى Supabase Storage بدلاً من إدخال روابط الملفات يدوياً. |
| تحليلات متقدمة | رسوم بيانية للإيرادات والحضور والدرجات. |

## مبادئ ممنوع كسرها

1. استخدام نفس Supabase project الخاص بالتطبيق.
2. لا يتم استخدام `service_role_key` في المتصفح.
3. كل العمليات تمر عبر RLS/RPC الحالية.
4. الحفاظ على عزل `center_id`.
5. الطالب لا يرى إلا بياناته.
6. فريق العمل يخضع لصلاحيات `perms` في الواجهة إضافة إلى RLS.
