# 🤖 AGENTS.md — الملف التوجيهي الشامل لمنصة Mr Center (الويب)

> **هذا الملف موجه لوكيل الذكاء الاصطناعي الذي سيعمل على مشروع الويب.**
> اقرأه كاملاً قبل لمس أي سطر — المرجع النهائي لفهم المنصة.
> آخر تحديث: سبتمبر 2026.

---

## جدول المحتويات

1. [الهوية والرؤية](#1-الهوية-والرؤية)
2. [ما يريده المالك حرفياً](#2-ما-يريده-المالك-حرفيا)
3. [الخريطة المعمارية](#3-الخريطة-المعمارية)
4. [تعدد السناتر والصلاحيات](#4-تعدد-السناسر-والصلاحيات)
5. [قاعدة البيانات](#5-قاعدة-البيانات)
6. [كلاود فلير](#6-كلاود-فلير)
7. [بنية كود الويب](#7-بنية-كود-الويب)
8. [التدفقات الحرجة](#8-التدفقات-الحريرة)
9. [الثوابت](#9-الثوابت)
10. [الاختبارات](#10-الاختبارات)
11. [البناء والنشر](#11-البناء-والنشر)
12. [تطبيق الموبايل](#12-تطبيق-الموبايل)
13. [بيئة العمل](#13-بيئة-العمل)
14. [قيود معروفة](#14-قيود-معروفة)
15. [القاموس](#15-القاموس)
16. [قائمة الفحص](#16-قائمة-الفحص)

---

## 1) الهوية والرؤية

- **المنتج**: منصة متكاملة لإدارة «السناتر» التعليمية المصرية — تعمل على **ويب وموبايل معاً** كمنتج واحد بوجهين.
- **التقنية**: ويب (Next.js 16 + TS + React 19) + موبايل (Expo SDK 52 + TS).
- **القاعدة واحدة**: Supabase — **نفس المشروع** للويب والموبايل.
- **اللغة**: عربية 100% RTL على الوجهين.
- **الهوية البصرية**: «كربون المستقبل» — فحمي + نعناعي `#00E5A0` + كهرماني. يدعم الفاتح والداكن.
- **الوسيط**: عامل Cloudflare واحد يقرأه الويب والموبايل معاً.

### المستودعات
| المستودع | الوجه |
|---|---|
| `contashepo-create/mr-center-web` (هذا) | 🌐 ويب |
| `contashepo-create/Mr-center-android-` | 📱 موبايل |

**مبدأ حاسم**: المستودعان وجهان لنفس المنتج. التغيير في المخطط/الصلاحيات/البيانات يجب أن يُنشر في المستودعين معاً.

---

## 2) ما يريده المالك حرفياً

1. منصة ويب + موبايل كاملة — بنفس البيانات والصلاحيات.
2. نفس قاعدة Supabase — ويب ⇄ موبايل فوراً.
3. صلاحيات أربعة: سوبر أدمن · صاحب السنتر · فريق عمل (خامل + 10 صلاحيات) · طالب.
4. عزل كامل بـ `center_id` على الوجهين.
5. كود السنتر: 3–8 ثابت وفريد + باركود.
6. تسجيل الطالب مرة واحدة — الكود لا يُطلب بعدها.
7. حسابات فريدة + موفرين معروفين + ولي مختلف.
8. نوعا الحسابات: سنتر متكامل + مدرس مستقل.
9. الصفحة الرئيسية: دخول + تسجيل + فريق + حول.
10. لوحة المطور مخفية — بوابة بريد محمية.
11. من لوحة المطور: مفاتيح · باقات · إيقاف/تفعيل · ملفات · بث.
12. الباقات: تجريبية ١٤ يوماً → شاملة/متوسطة/خصوصية.
13. مفاتيح قاعدة البيانات عبر كلاود فلير واحد.

---

## 3) الخريطة المعمارية

```
┌──────── ويب (Next.js) ───────┐     ┌──────── موبايل (Expo) ─────────┐
│  🌐 كل المتصفحات            │     │  📱 Android · iOS لاحقاً       │
└──────────┬────────────┘     └──────────┬─────────────┘
           │ GET <configUrl>              │ GET <configUrl>
           ▼                              ▼
┌────────────────────────────────────────────────────────┐
│   عامل Cloudflare Worker واحد (config + push + cron)   │
└──────────┬─────────────────────────────────────────────┘
           │ عميل Supabase
           ▼
┌────────────────────────────────────────────────────────┐
│   Supabase واحد = نفس الجداول = نفس المستخدمين = RLS   │
│   ويب ⇄ موبايل = بيانات متطابقة فوراً                   │
└────────────────────────────────────────────────────────┘
```

**التطابق التام**: كل جدول، كل عمود، كل سياسة RLS، كل دالة RPC يخدم الويب والموبايل معاً. الاختلاف فقط في طبقة العرض.

---

## 4) تعدد السناتر والصلاحيات

### الجداول الأساسية
- `centers` (كود ثابت + نوع center/solo) · `profiles` (6 أدوار + center_id + perms) · `student_groups` / `teacher_groups` · `center_subscriptions` · `center_ledger` · `center_fiscal_years` · `staff_invites` · `center_entitlements`

### قواعد RLS
- طالب = نفسه فقط · فريق مفعّل = سنتره + صلاحيات · مسئول = كامل · مطور = كامل

### RPC الحرجة
`get_published_exams` · `submit_exam_attempt` · `lookup_center_by_code` · `complete_center_registration` · `complete_student_registration` · `register_staff_account` · `get_my_notifications` · `get_my_subscription` · `accounting_enabled` · `open_fiscal_year` · `close_fiscal_year` · `get_invite_info` · `accept_staff_invite` · `claim_session` · `check_session`

---

## 5) قاعدة البيانات

ملف المخطط الوحيد: **`supabase/android_multitenant_schema.sql`** — يخدم الويب والموبايل. آمن لإعادة التشغيل. **لا تُعيد تشغيل مخطط الموقع القديم بعده أبداً.** Auth: «Confirm email» مفعّل. البريد من موفرين معروفين فقط.

---

## 6) كلاود فلير (الوسيط المركزي)

العامل (`cloudflare/worker.js`) يقرأه الويب والموبايل معاً. المسارات: `/config` · `/version` · `/database` · `/push/notify` (POST + `x-push-secret`). CORS مفتوح، كاش 60 ثانية. الويب يقرأه عبر `fetchRemoteConfig()` في `src/lib/supabase.ts`. `NEXT_PUBLIC_CONFIG_URL` اختياري.

---

## 7) بنية كود الويب ملفاً ملفاً

```
app/
├─ layout.tsx    جذر: SessionProvider + CookieConsent + VisitorTracker + RTL
├─ page.tsx      ترحيب: دخول + تسجيل + فريق + حول
├─ auth/         login/register-center/register-student/register-staff/update-password
├─ admin/        لوحة المالك والفريق (RequireAuth + AppFrame)
├─ student/      لوحة الطالب (RequireAuth + AppFrame)
├─ developer/    لوحة المطور (DeveloperGate)
└─ api/auth/     refresh/session routes

src/components/    app-frame · guards · dev-gate · ui
src/context/session.tsx  SessionProvider (جلسة واحدة + subscription + features)
src/lib/  supabase · sessionGuard · api · rbac · billing · qr · whatsapp · types · utils

scripts/  audit-sql · audit-security · audit-accounting · audit-code-health · check-routes · test-pure · compare-android-parity · e2e-live · smoke-pages
```

**الملفات المشتركة**: `android_multitenant_schema.sql` · `cloudflare/worker.js` · `src/lib/rbac.ts` · `src/lib/billing.ts` · `src/lib/types.ts` · `src/lib/utils.ts` · `src/lib/qr.ts` · `src/lib/whatsapp.ts`

---

## 8) تدفقات الاستخدام الحرجة

- تسجيل سنتر ← فحص ← signUp ← `/admin`
- تسجيل طالب ← كود ← صف/مجموعة ← `/student`
- تسجيل فريق ← دعوة ← خامل ← فعال
- دخول ← فحص ← حارس ← توجيه
- طلب ترقية ← خطة+تحويل ← `pending` ← يعتمده المطور

---

## 9) الثوابت التي يُمنع كسرها

1. لا RLS واسعة `USING (true)` أبداً.
2. العزل خادر بـ `center_id`.
3. كود السنتر ثابت وفريد.
4. الطالب قراءة نفسه فقط.
5. `legacy_admins` فقط.
6. البريد/الهاتف فريدان + ولي مختلف.
7. `TRIAL_DAYS = 14`.
8. RTL على `<html lang="ar" dir="rtl">`.
9. التصحيح الخادر للامتحانات.
10. **تكافؤ الويب والموبايل**: نفس الجداول ونفس RPC ونفس RLS.
11. **لا تضع `service_role` في `NEXT_PUBLIC_*`** — الحماية كلها RLS.
12. جلسة واحدة لكل حساب — `claimMySession`.

---

## 10) الاختبارات والتحقق

| الأمر | الوصف |
|---|---|
| `npm run typecheck` | tsc --noEmit --noUnused* |
| `npm run test:pure` | منطق نقي (billing+utils) |
| `npm run test:routes` | فحص التنقل |
| `npm run audit:code` | صحة الكود |
| `npm run audit:security` | أمان الكود |
| `npm run audit:accounting` | المحاسبة |
| `node scripts/audit-sql.mjs` | بنية/RLS/عزل |
| `npm run compare:android` | مقارنة مع الموبايل |
| `npm run test:e2e:live` | اختبار حي |

`npm test` = كله. بعد كل تعديل: `npm test && npm run build`.

---

## 11) البناء والنشر

- `npm install && npm run dev` ← `http://localhost:3000`
- النشر على Vercel بدون Environment Variables.
- Build: `npm run build`. Site URL + Redirect URLs في Supabase Auth.

---

## 12) تطبيق الموبايل — الوجه الأول للمنتج

> **الويب والتطبيق منصة واحدة بوجهين.** نفس قاعدة البيانات، نفس RLS، نفس RPC، نفس الباقات. المخطط واحد. كلاود فلير واحد. الاختلاف فقط في طبقة العرض.

- الموبايل: Expo SDK 52 + expo-router + AsyncStorage + expo-notifications + expo-camera
- الويب: Next.js + localStorage + HttpOnly cookies + كاميرا المتصفح
- **لا تكسر الموبايل من أجل الويب والعكس**

---

## 13) بيئة العمل

- Node 24 / npm. PowerShell: بلا `&&` (استخدم `;`). لا أسرار في الريبو.

---

## 14) قيود معروفة

- التسعير الأسبوعي = السعر ×4. الوقت بتوقيت الجهاز (مصر آمنة).

---

## 15) قاموس مصطلحات المالك

| يقصد | المعنى |
|---|---|
| «المنصة» | ويب + موبايل كمنتج واحد |
| «الويب» | Next.js — هذا المستودع |
| «الموبايل» | Expo — المستودع الآخر |
| «نفس البيانات» | نفس الجداول ونفس RLS |
| «السنتر» | center (فريق تابع) |
| «مدرس منفرد» | solo (حتى 200 طالب) |
| «الباقة» | trial → center_full / center_medium / solo_teacher |
| «المطور» | super_admin |

---

## 16) قائمة فحص قبل التسليم

- [ ] `npm run typecheck` — صفر أخطاء.
- [ ] `npm test` — كل الأجنحة خضراء.
- [ ] `npm run build` — تُبنى.
- [ ] العربية RTL.
- [ ] **تكافؤ الموبايل**: التغييرات مُنشررة في `Mr-center-android-`.
- [ ] كوميت عربي واضح + بلا أسرار.


