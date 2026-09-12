# Mr Center Web

نسخة ويب حقيقية مبنية بـ **Next.js + TypeScript + Supabase** لتعمل كمنصة ثانية لنفس نظام تطبيق Android الموجود في مستودع `Mr-center-android-`.

الفكرة الأساسية:

```txt
Android App (Expo / React Native)
        │
        ▼
Supabase واحد: Auth + PostgreSQL + RLS + RPC
        ▲
        │
Next.js Web App (Vercel)
```

أي بيانات تُنشأ أو تُعدّل من الويب تظهر في التطبيق، والعكس صحيح، لأن المنصتين تستخدمان نفس الجداول ونفس دوال RPC ونفس سياسات RLS.

---

## ما تم تنفيذه الآن

### البنية الأساسية

- Next.js App Router
- TypeScript
- تصميم عربي RTL كامل
- عميل Supabase للويب
- Session Provider للجلسة والملف الشخصي والاشتراك
- حماية صفحات حسب الدور:
  - `super_admin`
  - `center_admin`
  - `teacher`
  - `manager`
  - `secretary`
  - `student`
- نقل مكتبات المنطق المشتركة من تطبيق Android:
  - `src/lib/api.ts`
  - `src/lib/types.ts`
  - `src/lib/utils.ts`
  - `src/lib/rbac.ts`
  - `src/lib/billing.ts`
- نسخ مخطط Supabase المستخدم في التطبيق داخل `supabase/`

### صفحات الويب الحالية

#### عامة ومصادقة

- `/` الصفحة الرئيسية
- `/about` حول التطبيق من `app_config.public_config`
- `/auth/login` دخول مسئول/طالب/فريق/مطور
- `/auth/register-center` إنشاء سنتر أو مدرس مستقل
- `/auth/register-student` تسجيل طالب بكود السنتر
- `/auth/register-staff` انضمام فريق عمل بكود السنتر

#### لوحة مسئول السنتر / الفريق

- `/admin` لوحة إحصائيات
- `/admin/students` إدارة الطلاب
- `/admin/groups` الصفوف والمجموعات
- `/admin/attendance` تسجيل الحضور
- `/admin/payments` المستحقات والتحصيل
- `/admin/grades` الدرجات اليدوية
- `/admin/announcements` الإعلانات
- `/admin/notifications` الإشعارات الداخلية
- `/admin/inquiries` طلبات واستفسارات الطلاب
- `/admin/exams` الاختبارات الإلكترونية بباني أسئلة مرئي وتصحيح محاولات
- `/admin/surveys` الاستبيانات
- `/admin/library` المكتبة ولوحة الشرف والروابط
- `/admin/schedule` الجدول الأسبوعي
- `/admin/reports` التقارير والطباعة PDF من المتصفح
- `/admin/scan` ماسح QR للحضور
- `/admin/whatsapp` رسائل واتساب جاهزة
- `/admin/accounting` المحاسبة: إيرادات التحصيل الآلية، المصروفات، الرواتب، السلف، العمولات
- `/admin/custody` عهدة التحصيل اليومية
- `/admin/settings` إعدادات السنتر و QR السنتر
- `/admin/dev-notices` تنبيهات المطور لصاحب السنتر
- `/admin/activity` سجل النشاط
- `/admin/staff` إدارة فريق العمل والصلاحيات
- `/admin/students/[id]` ملف الطالب الشامل
- `/admin/subscription` الباقات وطلبات الاشتراك
- `/admin/support` محادثة الدعم مع المطور
- `/admin/guide` دليل الاستخدام
- Aliases توافق Android: `/admin/dashboard`, `/admin/more`, `/admin/teachers`, `/admin/admin-settings`, `/admin/student/[id]`

#### لوحة الطالب

- `/student` الرئيسية
- `/student/attendance` سجل الحضور
- `/student/grades` الدرجات
- `/student/payments` المدفوعات والمستحقات
- `/student/notifications` الإشعارات
- `/student/inquiries` الطلبات والاستفسارات
- `/student/exams` أداء الاختبارات الإلكترونية
- `/student/surveys` إجابة الاستبيانات
- `/student/library` المكتبة ولوحة الشرف
- `/student/schedule` الجدول الأسبوعي
- `/student/profile` بيانات الطالب و QR الحضور
- Aliases توافق Android: `/student/home`, `/student/my-attendance`, `/student/my-grades`, `/student/my-payments`, `/student/my-exams`, `/student/my-surveys`, `/student/my-library`, `/student/my-schedule`, `/student/my-notifications`, `/student/my-inquiries`

#### لوحة المطور

- `/developer` إحصائيات عامة
- `/developer/centers` إدارة السناتر وتفعيل/إيقاف
- `/developer/subscriptions` اعتماد طلبات الاشتراك أو إضافة اشتراك يدوي
- `/developer/broadcast` إرسال إشعار لسنتر
- `/developer/support` دعم العملاء
- `/developer/app-info` تعديل محتوى حول التطبيق والرسالة العامة
- `/developer/connection` إعدادات اتصال Supabase المؤقتة
- `/developer/centers/[id]` ملف سنتر تفصيلي

---

## التشغيل المحلي

```bash
npm install
npm run dev
```

ثم افتح:

```txt
http://localhost:3000
```

---

## متغيرات البيئة

**لا تحتاج إلى أي متغيرات بيئة.** الويب يقرأ مفاتيح قاعدة البيانات تلقائياً من خادم الإعدادات المركزي (كلاود فلير) — نفس الطريقة التي يعمل بها تطبيق Android تماماً، وكل الأسرار موجودة على كلاود فلير فقط.

ترتيب الأولوية عند التشغيل:
1. إعدادات يدوية أدخلها المطور على هذا المتصفح (للتجربة فقط — تُحفظ محلياً).
2. كلاود فلير — المصدر المركزي (نفس عامل `mr-center-config` الخاص بالتطبيق).
3. آخر إعدادات ناجحة مخزنة محلياً (عند انقطاع الشبكة).
4. متغيرات البيئة كملاذ أخير (اختياري لمن يفضّل ضبطاً يدوياً على خادمه).

لتغيير خادم الإعدادات عن الافتراضي (نادراً ما تحتاجه):

```env
NEXT_PUBLIC_CONFIG_URL=https://your-worker.workers.dev/config
```

> مهم: لا تضع أبداً `service_role` أو أي مفتاح سري في متغير يبدأ بـ `NEXT_PUBLIC_`. الواجهة تستخدم مفتاح الوصول العام فقط (يأتي من كلاود فلير) والحماية كلها في سياسات RLS.

---

## النشر على Vercel

1. اربط هذا المستودع بـ Vercel (بدون أي Environment Variables).
2. Build Command:

```bash
npm run build
```

3. Output تلقائي من Next.js.
4. في Supabase Auth اضبط:
   - Site URL على دومين Vercel النهائي.
   - Redirect URLs لتشمل دومين Vercel.

---

## قاعدة البيانات

استخدم نفس مشروع Supabase الخاص بتطبيق Android. المخطط موجود هنا:

```txt
supabase/android_multitenant_schema.sql
```

لا تنشئ قاعدة بيانات جديدة للويب. الويب والتطبيق يجب أن يستخدما نفس Supabase project حتى تكون البيانات مشتركة.

الترحيلات التالية (تُشغَّل مرة واحدة بالترتيب في Supabase SQL Editor وهي idempotent):

```txt
supabase/android_multitenant_schema.sql          # المخطط الأساسي الكامل (شامل تكافؤ المحاسبة/الدعوات/المدير)
supabase/20260912_fiscal_accounting.sql          # السنة المالية + المحاسبة + الاشتراكات + الزوار
supabase/20260912_security.sql                   # السباقات + جلسة واحدة + منع الروبوتات
supabase/20260912_parity_invites.sql             # (تكافؤ Android) بوابة المحاسبة الخادمية + دعوات الفريق + المدير الوحيد
```

---

## خريطة الإكمال

تمت إضافة خريطة تفصيلية لما تم وما يتبقى في:

```txt
docs/WEB_PARITY_ROADMAP.md
```

## أوامر التحقق والفحص

```bash
npm test                  # typecheck صار يشمل noUnused + route/code/security/accounting audits
npm run compare:android   # يحتاج نسخة Android في ANDROID_REPO_PATH أو /tmp/mr-center-android
npm run build
npm audit --omit=dev
SMOKE_BASE_URL=http://127.0.0.1:3000 npm run smoke
```

للاختبار الحي الكامل على Supabase حقيقي:

```bash
E2E_SUPABASE_URL="..." E2E_ANON_KEY="..." E2E_SERVICE_KEY="..." npm run test:e2e:live
```

تقارير الفحص والمقارنة موجودة في:

```txt
docs/SECURITY_AND_TEST_REPORT.md
docs/ANDROID_WEB_PARITY_AUDIT.md
```
