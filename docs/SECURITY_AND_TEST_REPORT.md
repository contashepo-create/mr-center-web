# تقرير الفحص الأمني والبرمجي والوظيفي — Mr Center Web

تاريخ الفحص: 2026-09-12

## نطاق الفحص

- مشروع Next.js Web بالكامل.
- ملفات الواجهة داخل `app/` و `src/`.
- سكربتات الاختبار داخل `scripts/`.
- توافق المسارات مع وظائف تطبيق Android.
- عدم وجود مفاتيح حساسة داخل كود المتصفح.
- بناء الإنتاج وقابلية النشر على Vercel.

## النتائج

| الفحص | الأمر | النتيجة |
|---|---|---:|
| TypeScript + كشف الأكواد غير المستخدمة | `npm run typecheck` | ✅ ناجح — `--noUnusedLocals --noUnusedParameters` |
| اختبارات المنطق النقي | `npm run test:pure` | ✅ ناجح |
| فحص اكتمال المسارات | `npm run test:routes` | ✅ ناجح — 74 ملف/مسار متوقع |
| فحص صحة الكود والروابط | `npm run audit:code` | ✅ ناجح — 103 source files + 74 route checks |
| فحص أمني مخصص | `npm run audit:security` | ✅ ناجح — 108 ملف مفحوص |
| فحص محاسبي مخصص | `npm run audit:accounting` | ✅ ناجح — ledger/trigger/custody/payroll/commissions |
| مقارنة Android/Web | `npm run compare:android` | ✅ ناجح — 55 شاشة Android لها مقابل Web + API/SQL متطابقان |
| بناء الإنتاج | `npm run build` | ✅ ناجح — 72 route |
| فحص الحزم | `npm audit --omit=dev` | ✅ 0 vulnerabilities |
| Smoke HTTP للصفحات | `SMOKE_BASE_URL=http://127.0.0.1:3000 npm run smoke` | ✅ ناجح — 70 صفحة/مسار HTTP |
| E2E حي على Supabase | `npm run test:e2e:live` | ⏭️ جاهز، يتطلب مفاتيح Supabase حقيقية |

## مقارنة الريبو الحالي مع تطبيق Android

تمت إضافة وتشغيل `scripts/compare-android-parity.mjs` للمقارنة مع الريبو المرجعي `Mr-center-android-`، ويتحقق من:

- وجود مقابل Web لكل شاشة فعلية في Android بعد استبعاد ملفات `_layout.tsx`، بما في ذلك aliases مثل `/admin/dashboard`, `/admin/more`, `/student/home`, و`my-*`.
- تطابق ملفي SQL الخاصين بالمخطط والترحيل الآمن byte-for-byte مع Android.
- تطابق أسماء دوال `src/lib/api.ts` ومراجع جداول Supabase و RPC بين المشروعين.
- تطابق exports المنطق المشترك في `billing`, `pendingRegistration`, `qr`, `rbac`, `types`, و`utils`.
- عدم وجود اعتماد React Native/Expo أو service role داخل طبقة الويب.

## فحص صحة الكود

يتحقق `scripts/audit-code-health.mjs` من:

- عدم وجود روابط داخلية مكسورة في `Link`, `LinkButton`, `router.push/replace`, و`redirect`.
- عدم استخدام React hooks داخل صفحة App Router بدون `'use client'`.
- أن مراجع `.from(...)` للجداول و`.rpc(...)` للدوال موجودة في SQL المرجعي.
- عدم وجود export functions مكررة في طبقة API.
- وجود `.env.example` لتوثيق مفاتيح التشغيل بدون تسريب قيم حقيقية.

## فحص المحاسبة

يتحقق `scripts/audit-accounting.mjs` من:

- وجود `center_ledger`, `staff_custody`, `staff_commission_rules` في SQL.
- وجود trigger `trg_payment_income` و unique index `uq_ledger_payment` لمنع تكرار الإيرادات الناتجة عن دفعات الطلاب.
- أن واجهة المحاسبة لا تسمح بإيراد يدوي؛ الإيراد يأتي من `payment_collection` فقط.
- أن `recordPayment` يرفض المبالغ غير الصحيحة ويحسب حالة المستحق تراكميًا بعد الدفعات الجزئية.
- أن العهدة والرواتب والعمولات مرتبطة بالـ RPC والجداول الصحيحة.

## الفحص الأمني المخصص

يتحقق `scripts/audit-security.mjs` من:

- عدم وجود `service_role` أو مفاتيح Service داخل `app/` أو `src/`.
- عدم استخدام `dangerouslySetInnerHTML`.
- عدم استخدام `eval`.
- عدم وجود استدعاءات `localhost/127.0.0.1` داخل كود المتصفح.
- عدم وجود أنماط مفاتيح شائعة Hardcoded مثل JWT أو مفاتيح دفع.

## حماية إضافية (ترقية أمان 2026-09-12)

ترحيل `supabase/20260912_security.sql` (يُشغَّل بعد `android_multitenant_schema.sql` و`20260912_fiscal_accounting.sql`) يضيف:

### 1) منع السباق في التحصيل (Race Condition)
- `record_payment` RPC يقفل صف المستحق `FOR UPDATE` ثم يتحقق من المتبقي قبل الإدراج،
  فيمنع تجاوز قيمة المستحق أو التحصيل المزدوج من جهازين في نفس اللحظة.
- الواجهة (`src/lib/api.ts`) تستدعي الـ RPC مباشرة بدل الحساب من جانب العميل.

### 2) جلسة واحدة لكل حساب (منع جهازين في نفس الوقت)
- جدول `user_active_sessions` + دالتي `claim_session` و`check_session`.
- عند الدخول يُطرد الجهاز الآخر تلقائياً (`signOut({ scope: 'others' })` + استحواذ على الجلسة)،
  وفحص دوري كل 30 ثانية يخرج الجهاز الذي فقد جلسته فوراً.
- لا تُحجب الجلسة عند فشل مؤقت أو قبل تطبيق الترحيل.

### 3) منع تكرار محاولة الامتحان تحت التزامن
- `submit_exam_attempt` يستخدم `ON CONFLICT (exam_id, student_id) DO NOTHING`
  بدل فحص-ثم-إدراج، فتصبح المحاولة الواحدة مضمونة حتى تحت التزامن.

### 4) حماية الروبوتات (خيارات مجانية فقط)
- حدّ المحاولات الخادمي: جدول `login_attempts` + `check_login_allowed`/`record_login_attempt`
  يمنع تجاوز حد المحاولات الفاشلة لكل بريد/جهاز.
- حدّ المحاولات المدمج في Supabase Auth (تأخير/حظر تلقائي بعد فشل متكرر).
- حقل شرك (honeypot) + بوابة زمنية في نموذج الدخول تحجب الروبوتات البسيطة.

### 5) نموذج الكوكيز الهجين (HttpOnly)
- **رمز التجديد (refresh token)** يُحفظ في كوكيز `mr-refresh-token` **HttpOnly + Secure + SameSite=Lax**
  خادمياً فقط (`/api/auth/store-refresh`) — لا يستطيع أي سكربت متصفح سرقته (حماية من XSS).
- **رمز الوصول (access token)** قصير العمر (~ساعة) يبقى مقروءاً من المتصفح (قيد تقني معروف في Supabase)
  ويُجدد استباقياً عبر `/api/auth/refresh` الذي يستخدم الكوكيز HttpOnly.
- `autoRefreshToken` معطّل والتجديد يتم عبر خادمنا؛ قراءة الكوكيز الخادمية تعيد دائماً سلسلة
  نصية (`?? ''`) ولا تعيد `null` أبداً، والانعدام يُعالج صراحةً بـ 401 `no_refresh`.

## ملاحظات أمان مهمة

1. الويب يستخدم `anon key` فقط في المتصفح.
2. العزل الحقيقي يتم عبر Supabase RLS و RPC الموجودة في المخطط.
3. أي استخدام لـ `E2E_SERVICE_KEY` محصور في سكربت الاختبار الحي داخل Node.js فقط، وليس في الواجهة.
4. لا يتم تخزين مفاتيح Supabase داخل الكود؛ تستخدم `.env.local` أو Vercel Environment Variables أو Cloudflare Worker.

## حدود الفحص الحالي

تم تنفيذ كل فحص آمن يمكن تشغيله بدون مفاتيح قاعدة الإنتاج. الاختبار الحي الكامل على Supabase يتطلب:

```env
E2E_SUPABASE_URL=...
E2E_ANON_KEY=...
E2E_SERVICE_KEY=...
```

عند توفرها، يشغّل `scripts/e2e-live.mjs` دورة كاملة تشمل إنشاء سنتر/طالب مؤقت، حضور، مستحقات، دفع، درجة، إعلان، إشعار، امتحان، استبيان، وفحص عزل الطالب، ثم تنظيف البيانات المؤقتة.
