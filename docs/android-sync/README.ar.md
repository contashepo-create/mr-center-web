# حزمة مزامنة Mr Center Android ↔ Web

**مصدر الويب المرجعي:** `contashepo-create/mr-center-web` عند `c6f6701`
**مصدر Android الذي صُمم له الباتش:** `contashepo-create/Mr-center-android-` عند `b944636`
**تاريخ الحزمة:** 2026-09-13

هذه الحزمة لا تعدّل مستودع Android ولا تدفع إليه؛ فهي artefact قابل للتطبيق من فريق Android. السبب أن جلسة العمل الحالية مرتبطة إجبارياً بفرع الويب. لا يجوز وصف تحويل مكوّنات Next/HTML/CSS إلى React Native بأنه `git apply` تلقائي: مكوّنات الويب غير قابلة للتنفيذ في Expo. لذلك تفصل الحزمة بوضوح بين **باتش آلي قابل للتطبيق ومختبَر** و**خطة Port أصلية إلزامية** لبقية الواجهات.

> لا تعتبر المنصتان متطابقتين وظيفياً إلا بعد إنجاز بنود المرحلة 2 أدناه واختبارها؛ الباتش الآلي وحده يوحّد عقد القاعدة ويُنهي فرق بث المطور، لكنه لا يحوّل صفحات الويب إلى شاشات Native بطريقة وهمية.

---

## 1. الباتش القابل للتطبيق الآن

الملف: [`0001-shared-schema-and-developer-broadcast.patch`](./0001-shared-schema-and-developer-broadcast.patch)

- SHA-256: `d18dae3d3fa4dc3d7dcf85b28207b76e09f00a9df601b034b60e8760104ff147`
- يطبّق فقط على Android commit `b944636`.
- تم التحقق من `git apply --check` في clone نظيف مطابق لذلك الـ commit، ثم من `git diff --cached --check`.
- تم إجراء `npm ci --ignore-scripts` ثم `npm run typecheck` على نسخة Android المعدلة بنجاح.

### ما الذي يضيفه بالضبط

1. **نموذج قاعدة البيانات نفسه**: يستبدل `supabase/20260911_safe_production_migration.sql` بالنسخة المرجعية ويضيف الـ 22 migration المفقودة، من `20260912_entitlement_enforcement.sql` حتى `20260913_student_transfer_requests.sql`. وتشمل الحسابات، التحصيل، العهدة، الرواتب ومسيراتها، الاستبيانات، الاختبارات، الهوية الطباعية، عزل الجهاز، التحويلات وقنوات بث المطور.
2. **قنوات بث المطور الأساسية** في `app/developer/broadcast.tsx`؛ ويوسعها الباتش `0002` إلى مصفوفة المستلمين وطريقة الظهور الجديدة.
3. **لا يوجد اختيار جمهور في الهاتف يُعتد به وحده**: الإرسال صار عبر `developer_broadcast_notification`، وRPC يتحقق من دور المطور والنطاق وقواعد المركز على الخادم.
4. **صندوق إشعارات المطور** في `app/(admin)/dev-notices.tsx` صار متاحاً للمالك والموظف النشط، ويقرأ/يؤشر القراءة فقط عبر `get_my_developer_notifications` و`mark_developer_notification_read`. أزيل الاستعلام المباشر الواسع على `app_notifications`.
5. **عقود TypeScript** اللازمة (`staff` و`DeveloperBroadcastChannel` و`CenterBroadcastDelivery` و`DeveloperBroadcastResult`) وواجهات API الموازية للويب.
6. عنصر «إشعارات المطور» في قائمة «المزيد» لا يختفي عن الموظف؛ ويبقى الخادم هو من يحسم ما يراه.

### طريقة التطبيق

```bash
git clone https://github.com/contashepo-create/Mr-center-android-.git
cd Mr-center-android-
git checkout b944636

# انسخ ملفَي الباتش من هذه الحزمة إلى جذر مستودع Android، ثم:
git apply --check 0001-shared-schema-and-developer-broadcast.patch
git apply 0001-shared-schema-and-developer-broadcast.patch
git apply --check 0002-communication-hub-and-presence.patch
git apply 0002-communication-hub-and-presence.patch
npm ci --ignore-scripts
npm run typecheck
npm test
```

إذا كان Android قد تقدّم عن `b944636` فلا تستخدم `--3way` بلا مراجعة. طبّق أولاً `git apply --check`، ثم انقل فقط الـ hunks المتعارضة يدوياً مع إبقاء أسماء RPC والـ migration كما هي. بعدها راجع `git diff --check`.

### الباتش الإضافي: مركز التواصل والحضور

الملف: [`0002-communication-hub-and-presence.patch`](./0002-communication-hub-and-presence.patch)
SHA-256: `90c7b7f539f86ea8408d8b75779905cc9e84106390bdb2657a28e67c1442e8a8`

**يشترط تطبيق `0001` قبله.** ينقل التغيير نفسه إلى Android Native:

- جمهور شامل مرن لبث المطور، بما فيه «كل أعضاء السناتر» و«كل حسابات المشروع»، وخيارات سنتر محدد للمالك/الموظفين/الطلاب بأي مزيج مطلوب.
- وضع الظهور: إشعار عادي، رسالة، أو تنبيه طارئ بنافذة منبثقة؛ البث الشامل يصل للموظفين أيضاً مرة واحدة فقط لكل حساب.
- `CommunicationHeader` أعلى كل منطقة الإدارة/الطالب/المطور: جرس ورسائل بعدادات، تبديل الوضع، وتسجيل الخروج؛ لا تبقى رسائل المطور أو الدعم في قائمة «المزيد».
- كل قراءة أو فتح محادثة يبث حدثاً محلياً لتختفي الشارة فوراً، مع refresh احتياطي كل 45 ثانية.
- سجل حضور حساب Android عبر UUID تثبيت محلي في `SecureStore`، **لا IP ولا بصمة عتاد**، وشاشة مطور لآخر ظهور صاحبي السناتر.
- اختبار RPC Android أصبح يقرأ المخطط وكل migrations، ويقبل overload الصحيح للدالة بدلاً من فحص schema الأساسي وحده.

### نشر قاعدة البيانات المشتركة — خطوة إلزامية قبل تجربة العميل

وجود ملفات SQL في Git **لا ينفذها في Supabase**. خذ نسخة احتياطية واستخدم مشروع Staging مطابقاً أولاً، ثم شغّل migrations مرة واحدة بالترتيب الاسمي عبر مسار النشر المعتمد لديكم (`supabase db push` بعد ربط المشروع أو SQL Editor/CI). لا تنفذ ملفات migration يدوياً بترتيب عشوائي، ولا تحذف جداول للتراجع.

اضبط Android على مشروع Supabase نفسه المستخدم في الويب، وبالمفاتيح العامة فقط:

```text
EXPO_PUBLIC_SUPABASE_URL=<same-project-url>
EXPO_PUBLIC_SUPABASE_ANON_KEY=<same-anon-key>
```

لا يوضع `service_role` في تطبيق Android أو في `app.json`. المصادقة وRLS وRPC هي حد الأمان، وليست إخفاء أزرار الواجهة.

> تحذير تشغيل: اختبار قنوات الجمهور العالمي — مثل `all_owners` و`all_owners_students` (تضم الموظفين) و`all_students` و`all_project` — يرسل رسائل حقيقية. اختبر قناة السنتر المحدد فقط في مشروع Staging أو بسنتر اختبار.

---

## 2. Port Native المطلوب للوصول إلى تطابق كامل

هذه ليست تحسينات اختيارية. الصفحات التالية تغيّرت في الويب بعد المرجع المشترك، ولا يمكن نسخ JSX الويب إليها؛ يجب إعادة تنفيذ نفس التدفق والعقد باستخدام React Native و`expo-print`/`expo-sharing` حيث يلزم. لا تغيّر أسماء الجداول أو RPC أو قواعد المحاسبة أثناء الـ port.

| المجال المرجعي في الويب | هدف Android | ما يلزم أن يتطابق وظيفياً |
|---|---|---|
| `app/admin/accounting/page.tsx`, `src/components/accounting/custody-workspace.tsx` | `app/(admin)/accounting.tsx`, `app/(admin)/custody.tsx` | دفتر عام أحدث فالأقدم، عكس ترتيب صغير بجانب التاريخ فقط، إيراد/مصروف يدوي، راتب، سلفة، خصم، عمولة، صرف عمولة، عهدة، تسوية عجز، منع فتح المحاسبة عند انتهاء الاشتراك مع بقاء التحصيل والعهدة والبيانات. لا تبنِ تبويب «إيراد ومصروف» مكرراً. |
| `app/admin/payments/page.tsx`, `app/admin/scan/page.tsx`, `app/admin/students/[id]/page.tsx` | `app/(admin)/payments.tsx`, `app/(admin)/scan.tsx`, `app/(admin)/student/[id].tsx` | إعادة الاسم إلى «التحصيل»، فردي وجماعي بمراجعة ثم حفظ فقط، رصيد مقدم، استحقاق بالحضور، كشف حساب، تسوية، ومسح باركود. لا يسجل التحديد أو «تحصيل من الكل» مالياً قبل تأكيد الحفظ. |
| `app/admin/reports/page.tsx` | `app/(admin)/reports.tsx` | كشف احترافي لكل موظف/طالب، وتقارير الشهر لا تعرض إلا تسويات الشهر؛ PDF باسم وصفي تلقائي. |
| `app/admin/staff/page.tsx` | `app/(admin)/teachers.tsx` | كروت/قائمة، معاينة موظف، كشف حساب مطبوع، وصلاحيات checkbox منظمة. نافذة صرف الراتب تعرض فقط الرصيد المرحل المتبقي وتسمح بتسوية جزئية. |
| `app/admin/students/page.tsx`, `groups/page.tsx`, `schedule/page.tsx` | `(tabs)/students.tsx`, `(tabs)/groups.tsx`, `schedule.tsx`, `grades-list.tsx` | تدفق وتصميم مستلهم من Center Publish، مع الإبقاء على صلاحيات Mr Center. المجموعة دائماً من صف الطالب؛ تغيير الصف يمسح مجموعة الصف السابق؛ يعرض مدرس المجموعة. |
| `app/admin/inquiries/page.tsx`, `app/student/inquiries/page.tsx` | `app/(admin)/inquiries.tsx`, `app/(student)/my-inquiries.tsx` | طلب نقل محكوم بصف الطالب، مجموعات الصف فقط، واستبعاد المجموعة الحالية وحل/رفض الطلب عبر RPC. |
| `app/admin/exams/page.tsx`, `app/student/exams/page.tsx`, `src/components/exam/*` | `app/(admin)/exams.tsx`, `app/(student)/my-exams.tsx` ومكوّنات RN جديدة | محرر متتابع لا split pane؛ السؤال الجديد درجته 1؛ الفرعي يظهر مباشرة ومفتوح للتحرير؛ قوالب الورقة، وضع ورقي/إلكتروني، نطاق مجموعات، جدولة، محاولات، نتيجة؛ سؤال التصويب يعتمد نطاق كلمات؛ المعاينتان دائماً. |
| `src/components/exam/paper.tsx`, `ornaments.tsx`, `review.tsx` | منشئ HTML موحد لـ `expo-print` | لا ينتج PDF طبقات الهوية فقط: يطبع الأسئلة والجداول. الشعار يحجز مساحة ولا يغطي الكلام. العلامة المائية فوق المحتوى حسب الإعدادات، والزخارف اليدوية والعشوائية لا تغطي النص ولا تعطل العلامة المائية. ضغط محتوى مقروء إلى صفحة ثم صفحتين بتدفق صفحات، لا scale مشوّه/قص. |
| `app/admin/settings/page.tsx`, `src/lib/printing.ts`, `src/components/printing/*` | `app/(admin)/admin-settings.tsx` + `src/lib/printing.ts` Native | إدارة ومعاينة هوية الطباعة الموحدة: اسم/عنوان/شعار وموضعه، وتذييل، ونص/صورة علامة مائية ونمطها وتكرارها وعددها وخطها وحجمها وشفافيتها واتجاهها وطبقتها. تطبق على كل PDF. |
| `app/admin/surveys/page.tsx`, `src/components/survey/results-dashboard.tsx` | `app/(admin)/surveys.tsx` | نتائج احترافية: عدد الردود، نسب الاختيارات، المتوسط والتوزيع، نصوص الإجابات، مع عزل السنتر. |
| `src/lib/student-access.ts`, session/auth changes | `src/lib/session.ts`, تسجيل الطالب، `app/blocked.tsx` | حجب جهاز الطالب وعزله الصارم حسب `center_id`. لا تشترك أجهزة/قرارات حجب بين سنترين. |
| `app/admin/page.tsx`, `app/admin/settings/page.tsx`, `app/admin/reports/page.tsx` | dashboard/settings/reports Native | بوابة الاشتراك: المحاسبة مغلقة فعلياً عند الانتهاء، ويظهر وصف القسم ومسار التجديد؛ التحصيل مستمر؛ العودة للبيانات عند تجديد الاشتراك. |
| `app/developer/centers/[id]/page.tsx` | `app/developer/center-detail.tsx` | حالة/صلاحية المحاسبة وبيانات السنتر تقرأ نفس العقد وقواعد الاشتراك، لا جدول fiscal قديم مباشر. |

### عقد API التي يجب إضافتها في Android أثناء المرحلة 2

استنسخ **السلوك والعقد** من `mr-center-web/src/lib/api.ts` و`src/lib/types.ts`، ولا تستبدلها باستعلامات عميل تتجاوز RPC. الفجوات الحالية التي كشفها فحص المقارنة هي:

- التحصيل: `recordStudentCredit`, `recordBulkDuePayments`, `fetchStudentAccount`, `settleStudentAccount` وأنواع `StudentAccount*`، مع `due_mode`, `attendance_due_amount`, `due_source`, `payment_kind`.
- الصفوف والتحويلات: `moveGrade`, `resolveStudentTransfer` وحقول الاستفسار الخاصة بالتحويل.
- الاستبيانات: `fetchSurveyResponseCounts` وأنواع الأسئلة/الإجابات الحديثة.
- الطباعة: `fetchCenterPrintBranding`, `CenterPrintSettings` وأنواع watermark/logo/template.
- الاختبارات: `ExamResult` وأنواع delivery/online/availability/template/ornaments والـ fields الحديثة في `AppExam` و`ExamQuestion`.
- فريق العمل: `StaffInviteRow` والعقود المحدثة، مع إبقاء أي `FiscalYear`/`StaffInvite` Android قديم فقط إن كان مستخدماً انتقالياً؛ لا تجعل هذه الأنواع سبباً للرجوع إلى جدول `center_fiscal_years` القديم.
- البث: دواله وأنواعه موجودة بالفعل في الباتش؛ احذف تدريجياً `fetchOwnerNotices` و`markOwnerNoticeRead` من شاشة إشعارات المطور بعد التأكد من عدم وجود مستهلك آخر.

---

## 3. قواعد محاسبية لا تقبل التغيير في Android

هذه القيود خادمية في migrations، لكن يجب أن تعكسها الواجهة ولا تعرض أرقاماً مضللة:

1. السلفة **ليست مصروف تشغيل** عند صرفها ولا تعامل كخصم ثانٍ عند صرف الراتب.
2. الخصم وعجز العهدة **ليسا مصروفاً مستقلاً ولا خروجاً نقدياً**؛ لا ينعكسان إلا ضمن صرف راتب الموظف.
3. لا تُرحّل حركات الأشهر السابقة بصرياً لمسير الشهر الجديد. نافذة **صرف راتب** وحدها تعرض الرصيد المرحل المتبقي، مع اختيار البنود أو جزء منها.
4. كل تسوية تحفظ مصدرها ومبلغها وتاريخها وشهر مسير الراتب. كشف شهر معين لا يعرض إلا تسويات ذلك الشهر.
5. خصم عجز العهدة يجب أن يظهر فور إنشائه في نافذة صرف راتب الموظف.
6. الرصيد المقدم للطالب يطبق تلقائياً على الاستحقاق من دون إيراد مكرر، والتسوية لا تنشئ دفعة جديدة.
7. إجراء تحصيل جماعي واحد ذري عبر RPC؛ لا loop من الهاتف على دفعات منفصلة ولا تعديل optimistic قبل نجاحه.

---

## 4. اختبارات القبول بعد كل مرحلة

### قاعدة البيانات والأمان

1. نفذ migrations في Staging، ثم شغّل `get_my_fiscal_years` كمالك محاسبة منتهية: يجب أن يعيد `[]` بلا 400 وبلا كشف حركة مالية.
2. تحقق من RLS بثلاثة حسابات: مالك مركز A، موظف مركز A، موظف/مالك مركز B. لا يرى أي منهم إشعار/كشف/حظر جهاز/تحويل خارج مركزه.
3. جرّب RPC بث مطور بحساب غير `super_admin`: يجب الرفض. جرّب `center` بلا مركز أو delivery خاطئ: يجب الرفض. جرّب قراءة/تعليم إشعار ليس للحساب: يجب الرفض.
4. لا تختبر القنوات العامة على الإنتاج.

### Android

```bash
npm ci --ignore-scripts
npm run typecheck
npm test
git diff --check
```

ثم اختبر جهازاً فعلياً/محاكياً لحالات: مالك، مدير، سكرتير، مدرس، طالب، طالب محجوب، ومطور. أضف اختباراً مباشراً لعقود RPC الجديدة في `scripts/` Android؛ لا تعتمد على نجاح render وحده.

### سيناريوات عمل لا يجوز تخطيها

- سلفة + خصم + عجز عهدة موزعة على شهرين، ثم صرف راتب جزئي وشامل ومراجعة كشف كل شهر.
- رصيد مقدم للطالب ثم حضور يولّد استحقاقاً؛ يجب تطبيق الرصيد مرة واحدة فقط.
- تحصيل جماعي: تحديد/إلغاء/مراجعة لا تغيّر القاعدة، والحفظ يغيرها مرة واحدة.
- تغيير صف طالب له مجموعة، ثم محاولة اختيار مجموعة من الصف القديم.
- طباعة اختبار طويل وتقرير جدول طويل: الشعار لا يغطي الكلام، والأسئلة موجودة، ولا قص أو scale مشوّه، واسم PDF وصفي (الاختبار: صف + مادة + مدرس إن توفرت).
- بث القناة الخاصة لمركز اختبار: `owners` ثم `owners_students` (المالك والموظفون والطلاب)؛ وتحقق من صندوق كل دور مرة واحدة فقط.

---

## 5. ترتيب دمج آمن مقترح

1. طبّق الباتش الحالي في فرع Android منفصل واختبره محلياً.
2. انشر SQL على Staging، ثم اجتز اختبارات RLS/RPC أعلاه.
3. Port التحصيل والحسابات أولاً، ثم العهدة/الرواتب والاشتراك؛ هذه المجموعة أعلى خطورة لأنها مالية.
4. Port الطباعة والاختبارات بوحدة HTML/Print مشتركة، لا بنسخة لكل شاشة.
5. Port الطلاب/المجموعات/التحويلات، ثم الاستبيانات وفريق العمل والإعدادات.
6. نفذ مقارنة API/schema آلية في CI لكل repo قبل الدمج. يعتبر أي RPC أو type أو migration مفقوداً فشلاً وليس فرقاً مقبولاً.
7. بعد اختبار Staging، انشر migrations للإنتاج في نافذة صيانة مع backup ومراقبة أخطاء Supabase. لا تفعّل إرسالاً عاماً تجريبياً.

الويب الحالي اجتاز الاختبارات المحلية والبناء وsmoke production، لكن اختبار E2E الحي للويب لم يُنفذ لغياب مفاتيح Supabase الاختبارية؛ لذلك لا يُستبدل اختبار Staging Android بهذه النتيجة.
