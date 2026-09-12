-- ============================================================================
--  نظام Mr Center — مخطط تعدد السناتر (Multi-Tenant) للتطبيق + الموقع
-- ----------------------------------------------------------------------------
--  ✦ هذا الملف يضيف للمشروع الحالي (موقع centerpuplish) نظام:
--      • السناتر (centers) بكود فريد ثابت لكل سنتر
--      • الملفات الشخصية (profiles) بثلاث صلاحيات: مطور / مسئول سنتر / طالب
--      • الاشتراكات (شهري/سنوي/مخصص) يتحكم بها المطور
--      • إعدادات عامة يتحكم بها المطور وتُقرأ من كل العملاء
--      • عزل كامل للبيانات بـ center_id عبر Row Level Security
--
--  ✦ آمن لإعادة التشغيل: كل شيء IF NOT EXISTS / OR REPLACE / TRANSACTION واحدة
--  ✦ يعمل أيضاً على قاعدة جديدة فارغة: ينشئ جداول الموقع المشتركة بنفسه (قسم ١-ب)
--  ✦ لا يحذف أي بيانات ولا يكسر الموقع الحالي:
--      حساب الموقع القديم (بلا ملف في profiles) يحتفظ بصلاحية كاملة تلقائياً
-- ============================================================================

BEGIN;

-- ============================================================================
-- ١) الجداول الجديدة
-- ============================================================================

-- السناتر: الكود فريد وثابت، ٣-٨ حروف/أرقام يحددها صاحب السنتر عند التسجيل
CREATE TABLE IF NOT EXISTS public.centers (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  code        TEXT NOT NULL,
  owner_name  TEXT NOT NULL DEFAULT '',
  owner_email TEXT,
  owner_phone TEXT,
  status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS centers_code_unique ON public.centers (upper(code));
CREATE INDEX IF NOT EXISTS idx_centers_status ON public.centers(status);

-- الملفات الشخصية: تربط حساب Supabase Auth بصلاحيته وسنتره
CREATE TABLE IF NOT EXISTS public.profiles (
  id          UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role        TEXT NOT NULL CHECK (role IN ('super_admin','center_admin','student')),
  center_id   UUID REFERENCES public.centers(id) ON DELETE CASCADE,
  student_id  TEXT,
  full_name   TEXT NOT NULL DEFAULT '',
  email       TEXT,
  phone       TEXT,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- أدوار الفريق الكاملة: مدير وسكرتير بجانب المدرس (ترقية للقواعد المنشأة سابقاً)
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('super_admin','center_admin','student','teacher','manager','secretary'));
-- البريد ورقم الهاتف فريدان على مستوى النظام كله (حتى لو اختلف السنتر)
CREATE UNIQUE INDEX IF NOT EXISTS profiles_email_unique
  ON public.profiles (lower(email)) WHERE email IS NOT NULL AND email <> '';
CREATE UNIQUE INDEX IF NOT EXISTS profiles_phone_unique
  ON public.profiles (phone) WHERE phone IS NOT NULL AND phone <> '';
CREATE INDEX IF NOT EXISTS idx_profiles_center ON public.profiles(center_id);
CREATE INDEX IF NOT EXISTS idx_profiles_student ON public.profiles(student_id);

-- منتجات الباقات الاحترافية (ترقية للقواعد المنشأة سابقاً)
ALTER TABLE public.center_subscriptions DROP CONSTRAINT IF EXISTS center_subscriptions_plan_type_check;
ALTER TABLE public.center_subscriptions ADD CONSTRAINT center_subscriptions_plan_type_check
  CHECK (plan_type IN ('monthly','yearly','custom','trial','center_full','center_medium','solo_teacher'));

-- اشتراكات السناتر (يتحكم بها المطور فقط)
CREATE TABLE IF NOT EXISTS public.center_subscriptions (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  center_id  UUID NOT NULL REFERENCES public.centers(id) ON DELETE CASCADE,
  plan_type  TEXT NOT NULL DEFAULT 'monthly' CHECK (plan_type IN ('monthly','yearly','custom')),
  starts_on  DATE NOT NULL DEFAULT CURRENT_DATE,
  ends_on    DATE NOT NULL,
  status     TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','expired','suspended')),
  notes      TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_subs_center ON public.center_subscriptions(center_id);

-- إعدادات التطبيق العامة (صفحة «حول التطبيق» + توجيه مفاتيح الربط + رسالة المطور)
CREATE TABLE IF NOT EXISTS public.app_config (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- الصف العام الذي يقرأه كل العملاء (محتوى «حول التطبيق» ورسالة المطور).
-- ملاحظة: مفاتيح قاعدة البيانات والتحديثات لا تمرّ من هنا — بل من عامل
-- كلاود فلير الوسيط (انظر مجلد cloudflare في المشروع).
INSERT INTO public.app_config (key, value) VALUES ('public_config', '{
  "about_title": "Mr Center",
  "about_body": "تطبيق إدارة السناتر التعليمية: طلاب، مجموعات، حضور، مدفوعات ودرجات — بنظام عزل كامل لكل سنتر.",
  "contact_whatsapp": "",
  "contact_email": "",
  "global_message": "",
  "min_app_version": "1.0.0"
}'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- ============================================================================
-- ١-ب) جداول الموقع المشتركة (تثبيت على قاعدة جديدة فارغة)
--     على قاعدة فيها جداول موقع قائمة يتخطى IF NOT EXISTS كل ما هو موجود
--     ولا يُمس أي شيء؛ وعلى قاعدة جديدة تُنشأ الجداول هنا كاملة ثم يضيف
--     القسم التالي عمود center_id لها. المعرفات نصية (TEXT) لأن التطبيق
--     يولّدها نصياً — مطابقة لاستخدامات src/lib/api.ts و types.ts.
-- ============================================================================

-- الصفوف الدراسية (grades)
CREATE TABLE IF NOT EXISTS public.grades (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  academic_year TEXT NOT NULL DEFAULT '',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- المجموعات (groups)
CREATE TABLE IF NOT EXISTS public.groups (
  id             TEXT PRIMARY KEY,
  grade_id       TEXT,
  name           TEXT NOT NULL,
  days           TEXT[] NOT NULL DEFAULT '{}',
  start_time     TEXT NOT NULL DEFAULT '',
  end_time       TEXT NOT NULL DEFAULT '',
  monthly_fee    NUMERIC NOT NULL DEFAULT 0,
  students_count INT NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- الطلاب (students)
CREATE TABLE IF NOT EXISTS public.students (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  phone          TEXT,
  guardian_phone TEXT,
  email          TEXT,
  grade_id       TEXT,
  group_id       TEXT,
  status         TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','archived')),
  notes          TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- المستحقات الشهرية (dues)
CREATE TABLE IF NOT EXISTS public.dues (
  id         TEXT PRIMARY KEY,
  student_id TEXT NOT NULL,
  group_id   TEXT,
  month      INT NOT NULL,
  year       INT NOT NULL,
  amount     NUMERIC NOT NULL DEFAULT 0,
  status     TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','partial')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- المدفوعات (payments)
CREATE TABLE IF NOT EXISTS public.payments (
  id           TEXT PRIMARY KEY,
  student_id   TEXT NOT NULL,
  due_id       TEXT,
  amount       NUMERIC NOT NULL DEFAULT 0,
  payment_date DATE NOT NULL DEFAULT CURRENT_DATE,
  month        INT NOT NULL,
  year         INT NOT NULL,
  notes        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- الحصص (sessions)
CREATE TABLE IF NOT EXISTS public.sessions (
  id           TEXT PRIMARY KEY,
  group_id     TEXT NOT NULL,
  session_date DATE NOT NULL DEFAULT CURRENT_DATE,
  start_time   TEXT NOT NULL DEFAULT '',
  end_time     TEXT NOT NULL DEFAULT '',
  notes        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- الحضور (attendance) — سجل واحد لكل طالب في الحصة
CREATE TABLE IF NOT EXISTS public.attendance (
  id           TEXT PRIMARY KEY,
  session_id   TEXT NOT NULL,
  student_id   TEXT NOT NULL,
  status       TEXT NOT NULL CHECK (status IN ('present','absent','late')),
  late_minutes INT,
  notes        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (session_id, student_id)
);

-- الدرجات اليدوية / التقييمات (manual_grades)
CREATE TABLE IF NOT EXISTS public.manual_grades (
  id         TEXT PRIMARY KEY,
  student_id TEXT NOT NULL,
  grade_id   TEXT,
  group_id   TEXT,
  title      TEXT NOT NULL,
  score      NUMERIC NOT NULL DEFAULT 0,
  max_score  NUMERIC NOT NULL DEFAULT 0,
  month      INT NOT NULL,
  year       INT NOT NULL,
  notes      TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- الإعلانات (announcements)
CREATE TABLE IF NOT EXISTS public.announcements (
  id         TEXT PRIMARY KEY,
  title      TEXT NOT NULL,
  body       TEXT NOT NULL,
  pinned     BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- موارد الموقع العامة القديمة (لا يستخدمها التطبيق — تبقى لترقية الموقع لاحقاً)
CREATE TABLE IF NOT EXISTS public.exams (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL DEFAULT '',
  details    TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.honorees (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL DEFAULT '',
  details    TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.shared_files (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL DEFAULT '',
  file_url   TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.important_links (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL DEFAULT '',
  url        TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================================
-- ٢) توسيع جداول الموقع الحالية بعمود center_id (لا يمس البيانات الحالية)
--    الصفوف القديمة تبقى center_id = NULL وتخص حساب الموقع القديم فقط
-- ============================================================================

ALTER TABLE public.grades        ADD COLUMN IF NOT EXISTS center_id UUID REFERENCES public.centers(id) ON DELETE CASCADE;
ALTER TABLE public.groups        ADD COLUMN IF NOT EXISTS center_id UUID REFERENCES public.centers(id) ON DELETE CASCADE;
ALTER TABLE public.students      ADD COLUMN IF NOT EXISTS center_id UUID REFERENCES public.centers(id) ON DELETE CASCADE;
ALTER TABLE public.students      ADD COLUMN IF NOT EXISTS guardian_phone TEXT;
ALTER TABLE public.dues          ADD COLUMN IF NOT EXISTS center_id UUID REFERENCES public.centers(id) ON DELETE CASCADE;
ALTER TABLE public.payments      ADD COLUMN IF NOT EXISTS center_id UUID REFERENCES public.centers(id) ON DELETE CASCADE;
ALTER TABLE public.sessions      ADD COLUMN IF NOT EXISTS center_id UUID REFERENCES public.centers(id) ON DELETE CASCADE;
ALTER TABLE public.attendance    ADD COLUMN IF NOT EXISTS center_id UUID REFERENCES public.centers(id) ON DELETE CASCADE;
ALTER TABLE public.announcements ADD COLUMN IF NOT EXISTS center_id UUID REFERENCES public.centers(id) ON DELETE CASCADE;
ALTER TABLE public.manual_grades ADD COLUMN IF NOT EXISTS center_id UUID REFERENCES public.centers(id) ON DELETE CASCADE;
ALTER TABLE public.exams         ADD COLUMN IF NOT EXISTS center_id UUID REFERENCES public.centers(id) ON DELETE CASCADE;
ALTER TABLE public.honorees      ADD COLUMN IF NOT EXISTS center_id UUID REFERENCES public.centers(id) ON DELETE CASCADE;
ALTER TABLE public.shared_files  ADD COLUMN IF NOT EXISTS center_id UUID REFERENCES public.centers(id) ON DELETE CASCADE;
ALTER TABLE public.important_links ADD COLUMN IF NOT EXISTS center_id UUID REFERENCES public.centers(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_grades_center        ON public.grades(center_id);
CREATE INDEX IF NOT EXISTS idx_groups_center        ON public.groups(center_id);
CREATE INDEX IF NOT EXISTS idx_students_center      ON public.students(center_id);
CREATE INDEX IF NOT EXISTS idx_dues_center          ON public.dues(center_id);
CREATE INDEX IF NOT EXISTS idx_payments_center      ON public.payments(center_id);
CREATE INDEX IF NOT EXISTS idx_sessions_center      ON public.sessions(center_id);
CREATE INDEX IF NOT EXISTS idx_attendance_center    ON public.attendance(center_id);
CREATE INDEX IF NOT EXISTS idx_announcements_center ON public.announcements(center_id);
CREATE INDEX IF NOT EXISTS idx_manual_grades_center ON public.manual_grades(center_id);

-- ============================================================================
-- ٣) دوال مساعدة للسياسات (أمنية: SECURITY DEFINER)
-- ============================================================================

-- صلاحية المستخدم الحالي من ملفه الشخصي
CREATE OR REPLACE FUNCTION public.my_role()
RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid();
$$;

-- سنتر المستخدم الحالي
CREATE OR REPLACE FUNCTION public.my_center_id()
RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT center_id FROM public.profiles WHERE id = auth.uid();
$$;

-- سجل الطالب المرتبط بالمستخدم الحالي (إن كان طالباً)
CREATE OR REPLACE FUNCTION public.my_student_id()
RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT student_id FROM public.profiles WHERE id = auth.uid();
$$;

-- «حساب الموقع القديم»: فقط حسابات المصادقة الموجودة لحظة تشغيل هذا الترحيل
-- تُدرج تلقائياً في قائمة allowed الحسابات القديمة (app_config ← legacy_admins).
-- أي حساب يُنشأ بعد الترحيل يمرّ إجبارياً عبر نظام profiles والصلاحيات —
-- فلا يستطيع مهاجم التسجيل بنفسه والادعاء أنه «مالك النظام القديم».
INSERT INTO public.app_config (key, value)
SELECT 'legacy_admins', COALESCE(jsonb_agg(u.id::text), '[]'::jsonb)
FROM auth.users u
ON CONFLICT (key) DO NOTHING;

-- هل المستخدم الحالي ضمن القائمة البيضاء لحسابات النظام القديم؟
CREATE OR REPLACE FUNCTION public.is_legacy_admin()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT auth.role() = 'authenticated'
     AND EXISTS (
       SELECT 1 FROM public.app_config
       WHERE key = 'legacy_admins' AND value ? (auth.uid())::text
     );
$$;

-- هل سنتر معين فعّال (غير موقوف)؟ تُستخدم لمنع الكتابة عند الإيقاف
CREATE OR REPLACE FUNCTION public.center_is_active(cid UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.centers WHERE id = cid AND status = 'active');
$$;

-- صلاحية كاملة للأدوار الإدارية على صف معين: مطور أو موقع قديم أو مسئول نفس السنتر
CREATE OR REPLACE FUNCTION public.admin_owns_center(cid UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_legacy_admin()
      OR public.my_role() = 'super_admin'
      OR (public.my_role() = 'center_admin' AND cid IS NOT NULL AND cid = public.my_center_id());
$$;

-- ============================================================================
-- ٤) دوال RPC الخاصة بالتسجيل والدخول (تُستدعى من التطبيق)
-- ============================================================================

-- البحث عن سنتر بالكود — متاح للزائر قبل التسجيل (الاسم + المسئول + الحالة فقط)
DROP FUNCTION IF EXISTS public.lookup_center_by_code(TEXT);
CREATE OR REPLACE FUNCTION public.lookup_center_by_code(p_code TEXT)
RETURNS TABLE(id UUID, name TEXT, owner_name TEXT, status TEXT)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN QUERY
  SELECT c.id, c.name, c.owner_name, c.status
  FROM public.centers c
  WHERE upper(trim(c.code)) = upper(trim(p_code))
  LIMIT 1;
END;
$$;

-- فحص توفر البريد/الهاتف قبل التسجيل — لتظهر رسالة واضحة «مستخدم من قبل»
CREATE OR REPLACE FUNCTION public.check_registration_availability(p_email TEXT, p_phone TEXT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_email_taken BOOLEAN := false;
  v_phone_taken BOOLEAN := false;
BEGIN
  IF p_email IS NOT NULL AND trim(p_email) <> '' THEN
    SELECT EXISTS (
      SELECT 1 FROM auth.users u WHERE lower(u.email) = lower(trim(p_email))
      UNION ALL
      SELECT 1 FROM public.profiles p WHERE lower(p.email) = lower(trim(p_email))
    ) INTO v_email_taken;
  END IF;
  IF p_phone IS NOT NULL AND trim(p_phone) <> '' THEN
    SELECT EXISTS (SELECT 1 FROM public.profiles WHERE phone = trim(p_phone)) INTO v_phone_taken;
  END IF;
  RETURN jsonb_build_object('email_taken', v_email_taken, 'phone_taken', v_phone_taken);
END;
$$;

-- إتمام تسجيل صاحب سنتر جديد: ينشئ السنتر + الملف + اشتراكاً تجريبياً ٧ أيام
-- p_kind: 'center' (سنتر متكامل) أو 'solo' (مدرس خصوصي مستقل بلا مدرسين تابعين)
DROP FUNCTION IF EXISTS public.complete_center_registration(TEXT, TEXT, TEXT, TEXT);
CREATE OR REPLACE FUNCTION public.complete_center_registration(
  p_center_name TEXT, p_code TEXT, p_owner_name TEXT, p_phone TEXT, p_kind TEXT DEFAULT 'center'
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_email TEXT;
  v_center_id UUID;
  v_code TEXT := upper(regexp_replace(trim(p_code), '\s+', '', 'g'));
  v_kind TEXT := lower(trim(p_kind));
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF EXISTS (SELECT 1 FROM public.profiles WHERE id = v_uid) THEN
    RAISE EXCEPTION 'already_registered';
  END IF;
  IF char_length(v_code) < 3 OR char_length(v_code) > 8 THEN
    RAISE EXCEPTION 'invalid_code_format';
  END IF;
  IF v_kind NOT IN ('center', 'solo') THEN v_kind := 'center'; END IF;
  SELECT email INTO v_email FROM auth.users WHERE id = v_uid;

  -- الكود فريد: أي تشابه يرفض العملية برسالة «الكود غير متاح»
  BEGIN
    INSERT INTO public.centers (name, code, owner_name, owner_email, owner_phone, kind)
    VALUES (trim(p_center_name), v_code, trim(p_owner_name), v_email, nullif(trim(p_phone), ''), v_kind)
    RETURNING id INTO v_center_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'center_code_taken';
  END;

  BEGIN
    INSERT INTO public.profiles (id, role, center_id, full_name, email, phone)
    VALUES (v_uid, 'center_admin', v_center_id, trim(p_owner_name), v_email, nullif(trim(p_phone), ''));
  EXCEPTION WHEN unique_violation THEN
    DELETE FROM public.centers WHERE id = v_center_id;
    RAISE EXCEPTION 'phone_taken';
  END;

  -- اشتراك تجريبي ٧ أيام بمزايا كاملة — بعده يطلب السنتر الترقية من المطور
  INSERT INTO public.center_subscriptions (center_id, plan_type, starts_on, ends_on, status, notes)
  VALUES (v_center_id, 'trial', CURRENT_DATE, CURRENT_DATE + 14, 'active', 'اشتراك تجريبي عند التسجيل');

  RETURN v_center_id;
END;
$$;

-- إتمام تسجيل طالب جديد: يتحقق من السنتر ويربط الحساب بسجل الطالب تلقائياً
-- ملاحظة: التعريف الفعلي لـ complete_student_registration (بوابة التسجيل + ربط بسجل موجود)
-- موجود لاحقاً في قسم ٦/ج ويحل محل أي تعريف سابق — لا تكرره هنا.

-- حالة اشتراك سنتر المستخدم الحالي (تُستدعى عند كل تشغيل)
CREATE OR REPLACE FUNCTION public.get_my_subscription()
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_role TEXT; v_center UUID; v_center_status TEXT;
  v_sub public.center_subscriptions%ROWTYPE;
  v_effective TEXT;
BEGIN
  SELECT role, center_id INTO v_role, v_center FROM public.profiles WHERE id = auth.uid();
  IF v_role IS NULL THEN RETURN jsonb_build_object('status', 'none'); END IF;
  IF v_role = 'super_admin' THEN
    RETURN jsonb_build_object('status', 'active', 'plan_type', 'custom', 'ends_on', null, 'days_left', null, 'center_status', 'active');
  END IF;
  IF v_center IS NULL THEN RETURN jsonb_build_object('status', 'none'); END IF;

  SELECT status INTO v_center_status FROM public.centers WHERE id = v_center;
  SELECT * INTO v_sub FROM public.center_subscriptions
   WHERE center_id = v_center ORDER BY ends_on DESC LIMIT 1;

  IF v_center_status = 'suspended' OR (v_sub.id IS NOT NULL AND v_sub.status = 'suspended') THEN
    v_effective := 'suspended';
  ELSIF v_sub.id IS NULL THEN
    v_effective := 'none';
  ELSIF v_sub.ends_on < CURRENT_DATE OR v_sub.status = 'expired' THEN
    v_effective := 'expired';
  ELSE
    v_effective := 'active';
  END IF;

  RETURN jsonb_build_object(
    'status', v_effective,
    'plan_type', v_sub.plan_type,
    'ends_on', v_sub.ends_on,
    'days_left', CASE WHEN v_sub.id IS NULL THEN null ELSE (v_sub.ends_on - CURRENT_DATE) END,
    'center_status', coalesce(v_center_status, 'active')
  );
END;
$$;

-- ============================================================================
-- ٥) مشغلات الحماية والمزامنة
-- ============================================================================

-- حماية ثوابت السنتر: الكود ثابت، والإيقاف/التفعيل (status) بيد المطور فقط —
-- فلا يستطيع مسئول السنتر تغيير كوده ولا إعادة تفعيل سنتره بعد إيقافه
CREATE OR REPLACE FUNCTION public.guard_center_code()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF public.my_role() IS DISTINCT FROM 'super_admin' AND NOT public.is_legacy_admin() THEN
    IF NEW.code IS DISTINCT FROM OLD.code THEN
      RAISE EXCEPTION 'code_is_fixed';
    END IF;
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      RAISE EXCEPTION 'status_managed_by_developer';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_guard_center_code ON public.centers;
CREATE TRIGGER trg_guard_center_code BEFORE UPDATE ON public.centers
  FOR EACH ROW EXECUTE FUNCTION public.guard_center_code();

-- حماية الهوية: الصلاحية والسنتر وربط الطالب لا يغيّرها إلا المطور
-- (يُستبدل لاحقاً في قسم ٦/هـ بنسخة تستثني إدارة المسئول لفريقه)
CREATE OR REPLACE FUNCTION public.guard_profile_identity()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_legacy_admin() AND public.my_role() IS DISTINCT FROM 'super_admin' THEN
    IF NEW.role IS DISTINCT FROM OLD.role
       OR NEW.center_id IS DISTINCT FROM OLD.center_id
       OR NEW.student_id IS DISTINCT FROM OLD.student_id
       OR NEW.is_active IS DISTINCT FROM OLD.is_active THEN
      RAISE EXCEPTION 'identity_protected';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_guard_profile_identity ON public.profiles;
CREATE TRIGGER trg_guard_profile_identity BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_profile_identity();

-- مزامنة عدد طلاب المجموعة تلقائياً
-- (يُستبدل لاحقاً في قسم ٦/هـ بنسخة تشمل العضويات الإضافية)
CREATE OR REPLACE FUNCTION public.sync_group_student_count()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP IN ('INSERT', 'UPDATE') AND NEW.group_id IS NOT NULL THEN
    UPDATE public.groups
       SET students_count = (SELECT count(*) FROM public.students s WHERE s.group_id = NEW.group_id AND s.status = 'active')
      WHERE id = NEW.group_id;
  END IF;
  IF TG_OP IN ('DELETE', 'UPDATE') AND OLD.group_id IS NOT NULL THEN
    UPDATE public.groups
       SET students_count = (SELECT count(*) FROM public.students s WHERE s.group_id = OLD.group_id AND s.status = 'active')
      WHERE id = OLD.group_id;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;
DROP TRIGGER IF EXISTS trg_sync_group_count ON public.students;
CREATE TRIGGER trg_sync_group_count
  AFTER INSERT OR DELETE OR UPDATE OF group_id, status ON public.students
  FOR EACH ROW EXECUTE FUNCTION public.sync_group_student_count();

-- ============================================================================
-- ٦) سياسات العزل (RLS) — قلب الأمان في النظام
-- ============================================================================

ALTER TABLE public.centers               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.center_subscriptions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_config            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.grades                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.groups                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.students              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dues                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sessions              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.announcements         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.manual_grades         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exams                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.honorees              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shared_files          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.important_links       ENABLE ROW LEVEL SECURITY;

-- ---------- centers ----------
DROP POLICY IF EXISTS "centers_super_admin" ON public.centers;
CREATE POLICY "centers_super_admin" ON public.centers FOR ALL TO authenticated
  USING (public.my_role() = 'super_admin') WITH CHECK (public.my_role() = 'super_admin');
DROP POLICY IF EXISTS "centers_legacy" ON public.centers;
CREATE POLICY "centers_legacy" ON public.centers FOR ALL TO authenticated
  USING (public.is_legacy_admin()) WITH CHECK (public.is_legacy_admin());
DROP POLICY IF EXISTS "centers_member_read" ON public.centers;
CREATE POLICY "centers_member_read" ON public.centers FOR SELECT TO authenticated
  USING (id = public.my_center_id());
DROP POLICY IF EXISTS "centers_admin_update" ON public.centers;
CREATE POLICY "centers_admin_update" ON public.centers FOR UPDATE TO authenticated
  USING (public.my_role() = 'center_admin' AND id = public.my_center_id())
  WITH CHECK (public.my_role() = 'center_admin' AND id = public.my_center_id());

-- ---------- profiles ----------
DROP POLICY IF EXISTS "profiles_super_admin" ON public.profiles;
CREATE POLICY "profiles_super_admin" ON public.profiles FOR ALL TO authenticated
  USING (public.my_role() = 'super_admin') WITH CHECK (public.my_role() = 'super_admin');
DROP POLICY IF EXISTS "profiles_legacy" ON public.profiles;
CREATE POLICY "profiles_legacy" ON public.profiles FOR ALL TO authenticated
  USING (public.is_legacy_admin()) WITH CHECK (public.is_legacy_admin());
DROP POLICY IF EXISTS "profiles_self_read" ON public.profiles;
CREATE POLICY "profiles_self_read" ON public.profiles FOR SELECT TO authenticated
  USING (id = auth.uid());
DROP POLICY IF EXISTS "profiles_self_update" ON public.profiles;
CREATE POLICY "profiles_self_update" ON public.profiles FOR UPDATE TO authenticated
  USING (id = auth.uid()) WITH CHECK (id = auth.uid());
DROP POLICY IF EXISTS "profiles_center_admin_read" ON public.profiles;
CREATE POLICY "profiles_center_admin_read" ON public.profiles FOR SELECT TO authenticated
  USING (public.my_role() = 'center_admin' AND center_id = public.my_center_id());

-- ---------- center_subscriptions ----------
DROP POLICY IF EXISTS "subs_super_admin" ON public.center_subscriptions;
CREATE POLICY "subs_super_admin" ON public.center_subscriptions FOR ALL TO authenticated
  USING (public.my_role() = 'super_admin') WITH CHECK (public.my_role() = 'super_admin');
DROP POLICY IF EXISTS "subs_legacy" ON public.center_subscriptions;
CREATE POLICY "subs_legacy" ON public.center_subscriptions FOR ALL TO authenticated
  USING (public.is_legacy_admin()) WITH CHECK (public.is_legacy_admin());
DROP POLICY IF EXISTS "subs_member_read" ON public.center_subscriptions;
CREATE POLICY "subs_member_read" ON public.center_subscriptions FOR SELECT TO authenticated
  USING (center_id = public.my_center_id());

-- ---------- app_config ----------
-- القراءة العامة متاحة للجميع (حتى قبل تسجيل الدخول) لصف public_config فقط —
-- ليعرض محتوى «حول التطبيق» ورسالة المطور لأي عميل
DROP POLICY IF EXISTS "app_config_public_read" ON public.app_config;
CREATE POLICY "app_config_public_read" ON public.app_config FOR SELECT TO anon, authenticated
  USING (key = 'public_config');
DROP POLICY IF EXISTS "app_config_super_admin" ON public.app_config;
CREATE POLICY "app_config_super_admin" ON public.app_config FOR ALL TO authenticated
  USING (public.my_role() = 'super_admin') WITH CHECK (public.my_role() = 'super_admin');
DROP POLICY IF EXISTS "app_config_legacy" ON public.app_config;
CREATE POLICY "app_config_legacy" ON public.app_config FOR ALL TO authenticated
  USING (public.is_legacy_admin()) WITH CHECK (public.is_legacy_admin());
GRANT SELECT ON public.app_config TO anon, authenticated;

-- ============================================================================
--  سياسات الجداول المشتركة مع الموقع
--  نستبدل السياسة الواسعة القديمة بسياسات معزولة بـ center_id، مع:
--   • سياسة «الموقع القديم» تمنح حساب الموقع الأول صلاحية كاملة (لا ينكسر شيء)
--   • القراءة العامة (anon) تبقى فقط للصفوف القديمة center_id IS NULL
--     (الصفحة العامة للموقع تعمل كما هي، وبيانات السناتر الجديدة محمية)
-- ============================================================================

-- ---------- grades ----------
DROP POLICY IF EXISTS "authenticated full access" ON public.grades;
DROP POLICY IF EXISTS "public read grades" ON public.grades;
DROP POLICY IF EXISTS "grades_admin_all" ON public.grades;
CREATE POLICY "grades_admin_all" ON public.grades FOR ALL TO authenticated
  USING (public.admin_owns_center(center_id)) WITH CHECK (public.admin_owns_center(center_id));
DROP POLICY IF EXISTS "grades_member_read" ON public.grades;
CREATE POLICY "grades_member_read" ON public.grades FOR SELECT TO authenticated
  USING (center_id IS NOT NULL AND center_id = public.my_center_id());
DROP POLICY IF EXISTS "grades_public_legacy_read" ON public.grades;
CREATE POLICY "grades_public_legacy_read" ON public.grades FOR SELECT TO anon
  USING (center_id IS NULL);

-- ---------- groups ----------
DROP POLICY IF EXISTS "authenticated full access" ON public.groups;
DROP POLICY IF EXISTS "public read groups" ON public.groups;
DROP POLICY IF EXISTS "groups_admin_all" ON public.groups;
CREATE POLICY "groups_admin_all" ON public.groups FOR ALL TO authenticated
  USING (public.admin_owns_center(center_id)) WITH CHECK (public.admin_owns_center(center_id));
DROP POLICY IF EXISTS "groups_member_read" ON public.groups;
CREATE POLICY "groups_member_read" ON public.groups FOR SELECT TO authenticated
  USING (center_id IS NOT NULL AND center_id = public.my_center_id());
DROP POLICY IF EXISTS "groups_public_legacy_read" ON public.groups;
CREATE POLICY "groups_public_legacy_read" ON public.groups FOR SELECT TO anon
  USING (center_id IS NULL);

-- ---------- students ----------
DROP POLICY IF EXISTS "authenticated full access" ON public.students;
DROP POLICY IF EXISTS "public read" ON public.students;
DROP POLICY IF EXISTS "students_admin_all" ON public.students;
CREATE POLICY "students_admin_all" ON public.students FOR ALL TO authenticated
  USING (public.admin_owns_center(center_id))
  WITH CHECK (public.admin_owns_center(center_id)
              AND (center_id IS NULL OR public.center_is_active(center_id)));
DROP POLICY IF EXISTS "students_self_read" ON public.students;
CREATE POLICY "students_self_read" ON public.students FOR SELECT TO authenticated
  USING (id = public.my_student_id());

-- ---------- dues ----------
DROP POLICY IF EXISTS "authenticated full access" ON public.dues;
DROP POLICY IF EXISTS "dues_admin_all" ON public.dues;
CREATE POLICY "dues_admin_all" ON public.dues FOR ALL TO authenticated
  USING (public.admin_owns_center(center_id))
  WITH CHECK (public.admin_owns_center(center_id)
              AND (center_id IS NULL OR public.center_is_active(center_id)));
DROP POLICY IF EXISTS "dues_self_read" ON public.dues;
CREATE POLICY "dues_self_read" ON public.dues FOR SELECT TO authenticated
  USING (student_id = public.my_student_id());

-- ---------- payments ----------
DROP POLICY IF EXISTS "authenticated full access" ON public.payments;
DROP POLICY IF EXISTS "payments_admin_all" ON public.payments;
CREATE POLICY "payments_admin_all" ON public.payments FOR ALL TO authenticated
  USING (public.admin_owns_center(center_id))
  WITH CHECK (public.admin_owns_center(center_id)
              AND (center_id IS NULL OR public.center_is_active(center_id)));
DROP POLICY IF EXISTS "payments_self_read" ON public.payments;
CREATE POLICY "payments_self_read" ON public.payments FOR SELECT TO authenticated
  USING (student_id = public.my_student_id());

-- ---------- sessions ----------
DROP POLICY IF EXISTS "authenticated full access" ON public.sessions;
DROP POLICY IF EXISTS "sessions_admin_all" ON public.sessions;
CREATE POLICY "sessions_admin_all" ON public.sessions FOR ALL TO authenticated
  USING (public.admin_owns_center(center_id))
  WITH CHECK (public.admin_owns_center(center_id)
              AND (center_id IS NULL OR public.center_is_active(center_id)));
DROP POLICY IF EXISTS "sessions_member_read" ON public.sessions;
CREATE POLICY "sessions_member_read" ON public.sessions FOR SELECT TO authenticated
  USING (center_id IS NOT NULL AND center_id = public.my_center_id());

-- ---------- attendance ----------
DROP POLICY IF EXISTS "authenticated full access" ON public.attendance;
DROP POLICY IF EXISTS "attendance_admin_all" ON public.attendance;
CREATE POLICY "attendance_admin_all" ON public.attendance FOR ALL TO authenticated
  USING (public.admin_owns_center(center_id))
  WITH CHECK (public.admin_owns_center(center_id)
              AND (center_id IS NULL OR public.center_is_active(center_id)));
DROP POLICY IF EXISTS "attendance_self_read" ON public.attendance;
CREATE POLICY "attendance_self_read" ON public.attendance FOR SELECT TO authenticated
  USING (student_id = public.my_student_id());

-- ---------- announcements ----------
DROP POLICY IF EXISTS "authenticated full access" ON public.announcements;
DROP POLICY IF EXISTS "public read announcements" ON public.announcements;
DROP POLICY IF EXISTS "announcements_admin_all" ON public.announcements;
CREATE POLICY "announcements_admin_all" ON public.announcements FOR ALL TO authenticated
  USING (public.admin_owns_center(center_id))
  WITH CHECK (public.admin_owns_center(center_id)
              AND (center_id IS NULL OR public.center_is_active(center_id)));
DROP POLICY IF EXISTS "announcements_member_read" ON public.announcements;
CREATE POLICY "announcements_member_read" ON public.announcements FOR SELECT TO authenticated
  USING (center_id IS NOT NULL AND center_id = public.my_center_id());
DROP POLICY IF EXISTS "announcements_public_legacy_read" ON public.announcements;
CREATE POLICY "announcements_public_legacy_read" ON public.announcements FOR SELECT TO anon
  USING (center_id IS NULL);

-- ---------- manual_grades ----------
DROP POLICY IF EXISTS "authenticated full access" ON public.manual_grades;
DROP POLICY IF EXISTS "public read" ON public.manual_grades;
DROP POLICY IF EXISTS "manual_grades_admin_all" ON public.manual_grades;
CREATE POLICY "manual_grades_admin_all" ON public.manual_grades FOR ALL TO authenticated
  USING (public.admin_owns_center(center_id))
  WITH CHECK (public.admin_owns_center(center_id)
              AND (center_id IS NULL OR public.center_is_active(center_id)));
DROP POLICY IF EXISTS "manual_grades_self_read" ON public.manual_grades;
CREATE POLICY "manual_grades_self_read" ON public.manual_grades FOR SELECT TO authenticated
  USING (student_id = public.my_student_id());

-- ---------- exams (لا يستخدمها التطبيق حالياً — تبقى للموقع وترقيته لاحقاً) ----------
DROP POLICY IF EXISTS "authenticated full access" ON public.exams;
DROP POLICY IF EXISTS "exams_admin_all" ON public.exams;
CREATE POLICY "exams_admin_all" ON public.exams FOR ALL TO authenticated
  USING (public.admin_owns_center(center_id)) WITH CHECK (public.admin_owns_center(center_id));

-- ---------- honorees / shared_files / important_links (موارد الموقع العامة القديمة) ----------
DROP POLICY IF EXISTS "authenticated full access" ON public.honorees;
DROP POLICY IF EXISTS "public read honorees" ON public.honorees;
DROP POLICY IF EXISTS "honorees_admin_all" ON public.honorees;
CREATE POLICY "honorees_admin_all" ON public.honorees FOR ALL TO authenticated
  USING (public.admin_owns_center(center_id)) WITH CHECK (public.admin_owns_center(center_id));
DROP POLICY IF EXISTS "honorees_public_legacy_read" ON public.honorees;
CREATE POLICY "honorees_public_legacy_read" ON public.honorees FOR SELECT TO anon
  USING (center_id IS NULL);

DROP POLICY IF EXISTS "authenticated full access" ON public.shared_files;
DROP POLICY IF EXISTS "public read shared_files" ON public.shared_files;
DROP POLICY IF EXISTS "shared_files_admin_all" ON public.shared_files;
CREATE POLICY "shared_files_admin_all" ON public.shared_files FOR ALL TO authenticated
  USING (public.admin_owns_center(center_id)) WITH CHECK (public.admin_owns_center(center_id));
DROP POLICY IF EXISTS "shared_files_public_legacy_read" ON public.shared_files;
CREATE POLICY "shared_files_public_legacy_read" ON public.shared_files FOR SELECT TO anon
  USING (center_id IS NULL);

DROP POLICY IF EXISTS "authenticated full access" ON public.important_links;
DROP POLICY IF EXISTS "public read important_links" ON public.important_links;
DROP POLICY IF EXISTS "important_links_admin_all" ON public.important_links;
CREATE POLICY "important_links_admin_all" ON public.important_links FOR ALL TO authenticated
  USING (public.admin_owns_center(center_id)) WITH CHECK (public.admin_owns_center(center_id));
DROP POLICY IF EXISTS "important_links_public_legacy_read" ON public.important_links;
CREATE POLICY "important_links_public_legacy_read" ON public.important_links FOR SELECT TO anon
  USING (center_id IS NULL);

-- ---------- قراءة الطالب لمحتوى سنتره (شرف/ملفات/روابط) ----------
DROP POLICY IF EXISTS "honorees_member_read" ON public.honorees;
CREATE POLICY "honorees_member_read" ON public.honorees FOR SELECT TO authenticated
  USING (center_id IS NOT NULL AND center_id = public.my_center_id());
DROP POLICY IF EXISTS "shared_files_member_read" ON public.shared_files;
CREATE POLICY "shared_files_member_read" ON public.shared_files FOR SELECT TO authenticated
  USING (center_id IS NOT NULL AND center_id = public.my_center_id());
DROP POLICY IF EXISTS "important_links_member_read" ON public.important_links;
CREATE POLICY "important_links_member_read" ON public.important_links FOR SELECT TO authenticated
  USING (center_id IS NOT NULL AND center_id = public.my_center_id());

-- ============================================================================
-- ٦/ب) توسعة الأقسام الجديدة: اختبارات/طلبات/استبيانات/إعدادات سنتر/تسعير
--  كلها متعددة السناتر بـ center_id + نفس نموذج العزل المعتمد أعلاه.
--  ملاحظة أمنية: أسئلة الامتحان تُقرأ عبر RPC فقط (get_published_exams) حتى
--  لا يرى الطالب مصفوفة الإجابات الصحيحة المخزنة في نفس الصف.
-- ============================================================================

-- الاختبارات الإلكترونية (اختيار من متعدد بتصحيح تلقائي)
CREATE TABLE IF NOT EXISTS public.app_exams (
  id               TEXT PRIMARY KEY,
  center_id        UUID NOT NULL REFERENCES public.centers(id) ON DELETE CASCADE,
  title            TEXT NOT NULL DEFAULT '',
  subject          TEXT NOT NULL DEFAULT '',
  grade_id         TEXT,
  duration_minutes INT NOT NULL DEFAULT 30,
  questions        JSONB NOT NULL DEFAULT '[]',
  answers          JSONB NOT NULL DEFAULT '[]',
  total_score      NUMERIC NOT NULL DEFAULT 0,
  is_published     BOOLEAN NOT NULL DEFAULT false,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.app_exam_attempts (
  id         TEXT PRIMARY KEY,
  center_id  UUID NOT NULL REFERENCES public.centers(id) ON DELETE CASCADE,
  exam_id    TEXT NOT NULL,
  student_id TEXT NOT NULL,
  answers    JSONB NOT NULL DEFAULT '[]',
  score      NUMERIC NOT NULL DEFAULT 0,
  max_score  NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (exam_id, student_id)
);

-- الطلبات والاستفسارات (سؤال/نقل مجموعة/تسجيل + رد الإدارة)
CREATE TABLE IF NOT EXISTS public.app_inquiries (
  id         TEXT PRIMARY KEY,
  center_id  UUID NOT NULL REFERENCES public.centers(id) ON DELETE CASCADE,
  student_id TEXT,
  kind       TEXT NOT NULL DEFAULT 'question' CHECK (kind IN ('question','transfer','registration','other')),
  subject    TEXT NOT NULL DEFAULT '',
  body       TEXT NOT NULL DEFAULT '',
  status     TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','answered','approved','rejected','closed')),
  reply      TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- الاستبيانات وردود الطلاب (رد واحد لكل طالب)
CREATE TABLE IF NOT EXISTS public.app_surveys (
  id         TEXT PRIMARY KEY,
  center_id  UUID NOT NULL REFERENCES public.centers(id) ON DELETE CASCADE,
  title      TEXT NOT NULL DEFAULT '',
  questions  JSONB NOT NULL DEFAULT '[]',
  is_active  BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.app_survey_responses (
  id         TEXT PRIMARY KEY,
  center_id  UUID NOT NULL REFERENCES public.centers(id) ON DELETE CASCADE,
  survey_id  TEXT NOT NULL,
  student_id TEXT NOT NULL,
  answers    JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (survey_id, student_id)
);

-- إعدادات السنتر التشغيلية (واتساب/فتح التسجيل/سنة الأرشيف...)
CREATE TABLE IF NOT EXISTS public.center_settings (
  center_id  UUID PRIMARY KEY REFERENCES public.centers(id) ON DELETE CASCADE,
  settings   JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- التسعير المتقدم للمجموعات (شهري/أسبوعي/بالحصة)
ALTER TABLE public.groups ADD COLUMN IF NOT EXISTS billing_type TEXT NOT NULL DEFAULT 'monthly'
  CHECK (billing_type IN ('monthly','weekly','per_session'));
ALTER TABLE public.groups ADD COLUMN IF NOT EXISTS weekly_price NUMERIC NOT NULL DEFAULT 0;
ALTER TABLE public.groups ADD COLUMN IF NOT EXISTS session_price NUMERIC NOT NULL DEFAULT 0;

-- رمز الدفع للإشعارات الفورية (Expo Push) — يُسجل من التطبيق عند الدخول
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS push_token TEXT;

-- مدرس المجموعة (مرحلة أولى: اسم ورقم للعرض والفلترة — حسابات المدرسين بصلاحيات لاحقاً)
ALTER TABLE public.groups ADD COLUMN IF NOT EXISTS teacher_name TEXT NOT NULL DEFAULT '';
ALTER TABLE public.groups ADD COLUMN IF NOT EXISTS teacher_phone TEXT;

-- ربط التكريم بسجل طالب ومجموعة (مع بقاء الاسم الحر للصفوف القديمة)
ALTER TABLE public.honorees ADD COLUMN IF NOT EXISTS student_id TEXT;
ALTER TABLE public.honorees ADD COLUMN IF NOT EXISTS group_id TEXT;
-- حالة مراجعة المحاولة (المقالي يحتاج تصحيح المعلم يدوياً)
ALTER TABLE public.app_exam_attempts ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'graded'
  CHECK (status IN ('graded','pending_review'));

CREATE INDEX IF NOT EXISTS idx_app_exams_center      ON public.app_exams(center_id);
CREATE INDEX IF NOT EXISTS idx_app_attempts_exam     ON public.app_exam_attempts(exam_id);
CREATE INDEX IF NOT EXISTS idx_app_attempts_student  ON public.app_exam_attempts(student_id);
CREATE INDEX IF NOT EXISTS idx_app_inquiries_center  ON public.app_inquiries(center_id);
CREATE INDEX IF NOT EXISTS idx_app_inquiries_status  ON public.app_inquiries(center_id, status);
CREATE INDEX IF NOT EXISTS idx_app_surveys_center    ON public.app_surveys(center_id);
CREATE INDEX IF NOT EXISTS idx_app_responses_survey  ON public.app_survey_responses(survey_id);

ALTER TABLE public.app_exams           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_exam_attempts   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_inquiries       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_surveys         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_survey_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.center_settings     ENABLE ROW LEVEL SECURITY;

-- ---------- app_exams (الطالب يقرأ عبر RPC فقط — بلا سياسة قراءة له) ----------
DROP POLICY IF EXISTS "app_exams_admin_all" ON public.app_exams;
CREATE POLICY "app_exams_admin_all" ON public.app_exams FOR ALL TO authenticated
  USING (public.admin_owns_center(center_id))
  WITH CHECK (public.admin_owns_center(center_id) AND public.center_is_active(center_id));

-- ---------- app_exam_attempts ----------
DROP POLICY IF EXISTS "app_attempts_admin_all" ON public.app_exam_attempts;
CREATE POLICY "app_attempts_admin_all" ON public.app_exam_attempts FOR ALL TO authenticated
  USING (public.admin_owns_center(center_id))
  WITH CHECK (public.admin_owns_center(center_id) AND public.center_is_active(center_id));
DROP POLICY IF EXISTS "app_attempts_self_read" ON public.app_exam_attempts;
CREATE POLICY "app_attempts_self_read" ON public.app_exam_attempts FOR SELECT TO authenticated
  USING (student_id = public.my_student_id());
-- ملاحظة أمنية: بلا سياسة إدخال مباشر للطالب في المحاولات عمداً —
-- كل التسليمات تمر عبر submit_exam_attempt (تصحيح خادمي + منع تكرار)،
-- وهي SECURITY DEFINER فلا تحتاج سياسة. نحذفها إن وُجدت من نشر سابق:
DROP POLICY IF EXISTS "app_attempts_self_insert" ON public.app_exam_attempts;

-- ---------- app_inquiries ----------
DROP POLICY IF EXISTS "app_inquiries_admin_all" ON public.app_inquiries;
CREATE POLICY "app_inquiries_admin_all" ON public.app_inquiries FOR ALL TO authenticated
  USING (public.admin_owns_center(center_id))
  WITH CHECK (public.admin_owns_center(center_id) AND public.center_is_active(center_id));
DROP POLICY IF EXISTS "app_inquiries_self_read" ON public.app_inquiries;
CREATE POLICY "app_inquiries_self_read" ON public.app_inquiries FOR SELECT TO authenticated
  USING (student_id = public.my_student_id());
DROP POLICY IF EXISTS "app_inquiries_self_insert" ON public.app_inquiries;
CREATE POLICY "app_inquiries_self_insert" ON public.app_inquiries FOR INSERT TO authenticated
  WITH CHECK (student_id = public.my_student_id()
              AND center_id = public.my_center_id()
              AND status = 'pending'
              AND public.center_is_active(center_id));

-- ---------- app_surveys ----------
DROP POLICY IF EXISTS "app_surveys_admin_all" ON public.app_surveys;
CREATE POLICY "app_surveys_admin_all" ON public.app_surveys FOR ALL TO authenticated
  USING (public.admin_owns_center(center_id))
  WITH CHECK (public.admin_owns_center(center_id) AND public.center_is_active(center_id));
DROP POLICY IF EXISTS "app_surveys_member_read" ON public.app_surveys;
CREATE POLICY "app_surveys_member_read" ON public.app_surveys FOR SELECT TO authenticated
  USING (center_id IS NOT NULL AND center_id = public.my_center_id() AND is_active = true);

-- ---------- app_survey_responses ----------
DROP POLICY IF EXISTS "app_responses_admin_all" ON public.app_survey_responses;
CREATE POLICY "app_responses_admin_all" ON public.app_survey_responses FOR ALL TO authenticated
  USING (public.admin_owns_center(center_id))
  WITH CHECK (public.admin_owns_center(center_id) AND public.center_is_active(center_id));
DROP POLICY IF EXISTS "app_responses_self_read" ON public.app_survey_responses;
CREATE POLICY "app_responses_self_read" ON public.app_survey_responses FOR SELECT TO authenticated
  USING (student_id = public.my_student_id());
DROP POLICY IF EXISTS "app_responses_self_insert" ON public.app_survey_responses;
CREATE POLICY "app_responses_self_insert" ON public.app_survey_responses FOR INSERT TO authenticated
  WITH CHECK (student_id = public.my_student_id()
              AND center_id = public.my_center_id()
              AND public.center_is_active(center_id));

-- ---------- center_settings (المسئول يدير سنتره، والطالب يقرأ سنتره) ----------
DROP POLICY IF EXISTS "center_settings_admin_all" ON public.center_settings;
CREATE POLICY "center_settings_admin_all" ON public.center_settings FOR ALL TO authenticated
  USING (public.admin_owns_center(center_id))
  WITH CHECK (public.admin_owns_center(center_id) AND public.center_is_active(center_id));
DROP POLICY IF EXISTS "center_settings_member_read" ON public.center_settings;
CREATE POLICY "center_settings_member_read" ON public.center_settings FOR SELECT TO authenticated
  USING (center_id = public.my_center_id());

-- ============================================================================
-- ٦/ج) دوال الامتحانات + بوابة التسجيل + ربط حساب الطالب بسجله الموجود
-- ============================================================================

-- الامتحانات المنشورة لسنتر الطالب (بلا الإجابات الصحيحة) + هل حاولها؟
CREATE OR REPLACE FUNCTION public.get_published_exams()
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_center UUID := public.my_center_id();
  v_sid TEXT := public.my_student_id();
BEGIN
  IF v_center IS NULL OR v_sid IS NULL THEN RETURN '[]'::jsonb; END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', e.id, 'title', e.title, 'subject', e.subject, 'grade_id', e.grade_id,
      'duration_minutes', e.duration_minutes, 'total_score', e.total_score,
      'questions', e.questions, 'created_at', e.created_at,
      'attempted', EXISTS(SELECT 1 FROM public.app_exam_attempts a WHERE a.exam_id = e.id AND a.student_id = v_sid)
    ) ORDER BY e.created_at DESC)
    FROM public.app_exams e
    WHERE e.center_id = v_center AND e.is_published
  ), '[]'::jsonb);
END;
$$;

-- تسليم إجابة امتحان: تصحيح تلقائي بمساواة JSON عامة + اليدوي للمراجعة
-- الأنواع الثمانية: mcq (فهرس) · multi (مصفوفة فهارس مرتبة) · tf (0/1)
--                   complete (نص مطبَّع) · match (مصفوفة فهارس اليمنى بترتيب اليسار)
--                   correct/essay/short (يدوي — قيد مراجعة المعلم؛
--                   و«صحّح» إن طابق نموذجه حرفياً تُحسب آلياً)
CREATE OR REPLACE FUNCTION public.submit_exam_attempt(p_exam_id TEXT, p_answers JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_center UUID := public.my_center_id();
  v_sid TEXT := public.my_student_id();
  v_exam public.app_exams%ROWTYPE;
  v_n INT := 0;
  v_total_marks NUMERIC := 0;
  v_earned NUMERIC := 0;
  v_correct INT := 0;
  v_has_essay BOOLEAN := false;
  v_status TEXT;
  i INT;
  v_q JSONB;
  v_type TEXT;
  v_marks NUMERIC;
BEGIN
  IF v_center IS NULL OR v_sid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  SELECT * INTO v_exam FROM public.app_exams
   WHERE id = p_exam_id AND center_id = v_center AND is_published;
  IF NOT FOUND THEN RAISE EXCEPTION 'exam_not_found'; END IF;
  IF EXISTS (SELECT 1 FROM public.app_exam_attempts WHERE exam_id = p_exam_id AND student_id = v_sid) THEN
    RAISE EXCEPTION 'already_attempted';
  END IF;
  v_n := COALESCE(jsonb_array_length(v_exam.questions), 0);
  FOR i IN 0..v_n - 1 LOOP
    v_q := v_exam.questions -> i;
    v_type := COALESCE(v_q ->> 'type', 'mcq');
    v_marks := COALESCE(NULLIF(v_q ->> 'marks', '')::NUMERIC, 1);
    v_total_marks := v_total_marks + v_marks;
    IF v_type = 'correct' AND (v_exam.answers -> i) IS NOT NULL
      AND (v_exam.answers -> i) = (COALESCE(p_answers, '[]'::jsonb) -> i) THEN
      -- «صحّح الخطأ»: مطابقة تامة للنموذج = درجة آلية بلا مراجعة
      v_correct := v_correct + 1;
      v_earned := v_earned + v_marks;
    ELSIF v_type IN ('essay', 'correct', 'short') THEN
      -- مقالي / صحّح غير مطابق / قصير — قيد مراجعة المعلم
      v_has_essay := true;
    ELSIF (v_exam.answers -> i) IS NOT NULL
      AND (v_exam.answers -> i) = (COALESCE(p_answers, '[]'::jsonb) -> i) THEN
      v_correct := v_correct + 1;
      v_earned := v_earned + v_marks;
    END IF;
  END LOOP;
  IF v_total_marks <= 0 THEN v_total_marks := COALESCE(v_exam.total_score, 0); END IF;
  v_status := CASE WHEN v_has_essay THEN 'pending_review' ELSE 'graded' END;
  INSERT INTO public.app_exam_attempts (id, center_id, exam_id, student_id, answers, score, max_score, status)
  VALUES (gen_random_uuid()::text, v_center, p_exam_id, v_sid, COALESCE(p_answers, '[]'::jsonb),
          ROUND(v_earned, 2), v_total_marks, v_status);
  RETURN jsonb_build_object('score', ROUND(v_earned, 2), 'max_score', v_total_marks,
                            'correct', v_correct, 'total', v_n, 'status', v_status);
END;
$$;

-- إتمام تسجيل طالب: بوابة التسجيل + ربط الحساب بسجل طالب موجود بنفس الهاتف
-- (الصف والمجموعة اختياريان من قوائم السنتر ويُتحقق أنهما يخصانه)
DROP FUNCTION IF EXISTS public.complete_student_registration(UUID, TEXT, TEXT, TEXT);
CREATE OR REPLACE FUNCTION public.complete_student_registration(
  p_center_id UUID, p_full_name TEXT, p_phone TEXT, p_guardian_phone TEXT DEFAULT '',
  p_grade_id TEXT DEFAULT NULL, p_group_id TEXT DEFAULT NULL
) RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_email TEXT;
  v_student_id TEXT := gen_random_uuid()::text;
  v_created BOOLEAN := true;
  v_existing_id TEXT;
  v_phone TEXT := nullif(trim(p_phone), '');
  v_status TEXT;
  v_now TIMESTAMPTZ := now();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF EXISTS (SELECT 1 FROM public.profiles WHERE id = v_uid) THEN
    RAISE EXCEPTION 'already_registered';
  END IF;
  SELECT status INTO v_status FROM public.centers WHERE id = p_center_id;
  IF v_status IS NULL THEN RAISE EXCEPTION 'center_not_found'; END IF;
  IF v_status <> 'active' THEN RAISE EXCEPTION 'center_suspended'; END IF;
  IF EXISTS (SELECT 1 FROM public.center_settings
             WHERE center_id = p_center_id AND (settings ->> 'registration_open') = 'false') THEN
    RAISE EXCEPTION 'registration_closed';
  END IF;
  IF p_grade_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.grades WHERE id = p_grade_id AND center_id = p_center_id) THEN
    RAISE EXCEPTION 'invalid_grade';
  END IF;
  IF p_group_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.groups WHERE id = p_group_id AND center_id = p_center_id) THEN
    RAISE EXCEPTION 'invalid_group';
  END IF;
  IF v_phone IS NOT NULL AND v_phone = nullif(trim(p_guardian_phone), '') THEN
    RAISE EXCEPTION 'same_guardian_phone';
  END IF;
  SELECT email INTO v_email FROM auth.users WHERE id = v_uid;

  -- طالب أُضيف يدوياً بنفس الهاتف وبلا حساب مرتبط؟ نربط حسابه بسجله بدل التكرار
  IF v_phone IS NOT NULL THEN
    SELECT s.id INTO v_existing_id FROM public.students s
     WHERE s.center_id = p_center_id AND s.phone = v_phone
       AND NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.student_id = s.id)
     LIMIT 1;
  END IF;
  IF v_existing_id IS NOT NULL THEN
    UPDATE public.students SET name = trim(p_full_name),
      guardian_phone = nullif(trim(p_guardian_phone), ''), email = v_email,
      grade_id = COALESCE(p_grade_id, grade_id), group_id = COALESCE(p_group_id, group_id),
      updated_at = v_now
     WHERE id = v_existing_id;
    v_student_id := v_existing_id;
    v_created := false;
  ELSE
    -- سقف الحساب المنفرد: 200 طالب نشط كحد أقصى
    IF (SELECT kind FROM public.centers WHERE id = p_center_id) = 'solo'
       AND (SELECT count(*) FROM public.students WHERE center_id = p_center_id AND status = 'active') >= 200 THEN
      RAISE EXCEPTION 'students_limit_reached';
    END IF;
    INSERT INTO public.students (id, name, phone, guardian_phone, email, status, center_id, grade_id, group_id, created_at, updated_at)
    VALUES (v_student_id, trim(p_full_name), v_phone, nullif(trim(p_guardian_phone), ''), v_email, 'active', p_center_id, p_grade_id, p_group_id, v_now, v_now);
  END IF;

  BEGIN
    INSERT INTO public.profiles (id, role, center_id, student_id, full_name, email, phone)
    VALUES (v_uid, 'student', p_center_id, v_student_id, trim(p_full_name), v_email, v_phone);
  EXCEPTION WHEN unique_violation THEN
    IF v_created THEN
      DELETE FROM public.students WHERE id = v_student_id;
    END IF;
    RAISE EXCEPTION 'phone_taken';
  END;

  RETURN v_student_id;
END;
$$;

-- ============================================================================
-- ٧) صلاحيات تنفيذ الدوال
-- ============================================================================
GRANT EXECUTE ON FUNCTION public.lookup_center_by_code(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_registration_availability(TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_center_registration(TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_student_registration(UUID, TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_subscription() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_published_exams() TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_exam_attempt(TEXT, JSONB) TO authenticated;

-- قوائم سنتر العامة للتسجيل (أسماء الصفوف والمجموعات فقط — للزائر قبل إنشاء الحساب)
CREATE OR REPLACE FUNCTION public.get_center_signup_lists(p_center_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.centers WHERE id = p_center_id AND status = 'active') THEN
    RETURN jsonb_build_object('grades', '[]'::jsonb, 'groups', '[]'::jsonb);
  END IF;
  RETURN jsonb_build_object(
    'grades', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', id, 'name', name)) FROM public.grades WHERE center_id = p_center_id), '[]'::jsonb),
    'groups', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', id, 'name', name, 'grade_id', grade_id)) FROM public.groups WHERE center_id = p_center_id), '[]'::jsonb)
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_center_signup_lists(UUID) TO anon, authenticated;

-- ============================================================================
-- ٦/د) الإشعارات الداخلية: صف واحد لكل رسالة مهما كان عدد المستلمين (موفرة)،
-- والطالب يقرأ عبر RPC مفلتر فقط — بلا قراءة مباشرة للجدول.
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.app_notifications (
  id          TEXT PRIMARY KEY,
  center_id   UUID NOT NULL REFERENCES public.centers(id) ON DELETE CASCADE,
  audience    TEXT NOT NULL DEFAULT 'all' CHECK (audience IN ('all','grade','group','student','owners')),
  audience_id TEXT,
  title       TEXT NOT NULL DEFAULT '',
  body        TEXT NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.app_notification_reads (
  id              TEXT PRIMARY KEY,
  center_id       UUID NOT NULL REFERENCES public.centers(id) ON DELETE CASCADE,
  notification_id TEXT NOT NULL,
  student_id      TEXT NOT NULL,
  read_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (notification_id, student_id)
);

CREATE INDEX IF NOT EXISTS idx_app_notif_center  ON public.app_notifications(center_id);
CREATE INDEX IF NOT EXISTS idx_app_reads_notif   ON public.app_notification_reads(notification_id);

-- ترقية قيد الجمهور للقواعد المنشأة سابقاً (قناة owners الجديدة)
ALTER TABLE public.app_notifications DROP CONSTRAINT IF EXISTS app_notifications_audience_check;
ALTER TABLE public.app_notifications ADD CONSTRAINT app_notifications_audience_check
  CHECK (audience IN ('all','grade','group','student','owners'));

ALTER TABLE public.app_notifications      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_notification_reads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "app_notif_admin_all" ON public.app_notifications;
CREATE POLICY "app_notif_admin_all" ON public.app_notifications FOR ALL TO authenticated
  USING (public.admin_owns_center(center_id))
  WITH CHECK (public.admin_owns_center(center_id) AND public.center_is_active(center_id));

DROP POLICY IF EXISTS "app_reads_admin_all" ON public.app_notification_reads;
CREATE POLICY "app_reads_admin_all" ON public.app_notification_reads FOR ALL TO authenticated
  USING (public.admin_owns_center(center_id))
  WITH CHECK (public.admin_owns_center(center_id) AND public.center_is_active(center_id));
DROP POLICY IF EXISTS "app_reads_self_read" ON public.app_notification_reads;
CREATE POLICY "app_reads_self_read" ON public.app_notification_reads FOR SELECT TO authenticated
  USING (student_id = public.my_student_id());
DROP POLICY IF EXISTS "app_reads_self_insert" ON public.app_notification_reads;
CREATE POLICY "app_reads_self_insert" ON public.app_notification_reads FOR INSERT TO authenticated
  WITH CHECK (student_id = public.my_student_id()
              AND center_id = public.my_center_id()
              AND public.center_is_active(center_id));
-- قناة المطور↔أصحاب السناتر: المسئول يقرأ إشعارات owners لسنتره ويعلّمها بمعرفه (uid)
DROP POLICY IF EXISTS "app_reads_owner_read" ON public.app_notification_reads;
CREATE POLICY "app_reads_owner_read" ON public.app_notification_reads FOR SELECT TO authenticated
  USING (center_id = public.my_center_id() AND student_id = (auth.uid())::text);
DROP POLICY IF EXISTS "app_reads_owner_insert" ON public.app_notification_reads;
CREATE POLICY "app_reads_owner_insert" ON public.app_notification_reads FOR INSERT TO authenticated
  WITH CHECK (public.my_role() = 'center_admin'
              AND center_id = public.my_center_id()
              AND student_id = (auth.uid())::text
              AND public.center_is_active(center_id));

-- إشعارات الطالب مفلترة خادمياً (حسب سجله: الكل/صفه/مجموعته/هو) + هل قرأها؟
CREATE OR REPLACE FUNCTION public.get_my_notifications()
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_center UUID := public.my_center_id();
  v_sid TEXT := public.my_student_id();
  v_grade TEXT;
  v_group TEXT;
BEGIN
  IF v_center IS NULL OR v_sid IS NULL THEN RETURN '[]'::jsonb; END IF;
  SELECT grade_id, group_id INTO v_grade, v_group FROM public.students WHERE id = v_sid;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', n.id, 'title', n.title, 'body', n.body, 'created_at', n.created_at,
      'is_read', EXISTS(SELECT 1 FROM public.app_notification_reads r
                        WHERE r.notification_id = n.id AND r.student_id = v_sid)
    ) ORDER BY n.created_at DESC)
    FROM public.app_notifications n
    WHERE n.center_id = v_center
      AND (n.audience = 'all'
        OR (n.audience = 'grade' AND n.audience_id IS NOT NULL AND n.audience_id = v_grade)
        OR (n.audience = 'group' AND n.audience_id IS NOT NULL AND n.audience_id = v_group)
        OR (n.audience = 'student' AND n.audience_id = v_sid))
    LIMIT 100
  ), '[]'::jsonb);
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_my_notifications() TO authenticated;

-- ============================================================================
-- دعوات فريق العمل: المالك ينشئ الدعوة (مدرس/سكرتير فقط — بلا مدير)،
-- وصاحب الدعوة يقبلها بكودها فينشأ حسابه خاملاً حتى التفعيل.
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.staff_invites (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  center_id   UUID NOT NULL REFERENCES public.centers(id) ON DELETE CASCADE,
  code        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL DEFAULT '',
  phone       TEXT,
  role        TEXT NOT NULL DEFAULT 'teacher' CHECK (role IN ('teacher','secretary')),
  perms       JSONB NOT NULL DEFAULT '{}',
  group_ids   JSONB NOT NULL DEFAULT '[]',
  status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','revoked')),
  accepted_by UUID,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_staff_invites_center ON public.staff_invites(center_id);
CREATE INDEX IF NOT EXISTS idx_staff_invites_code ON public.staff_invites(code);

ALTER TABLE public.staff_invites ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "staff_invites_owner_all" ON public.staff_invites;
CREATE POLICY "staff_invites_owner_all" ON public.staff_invites FOR ALL TO authenticated
  USING (public.my_role() = 'center_admin' AND center_id = public.my_center_id())
  WITH CHECK (public.my_role() = 'center_admin' AND center_id = public.my_center_id()
              AND public.center_is_active(center_id));
DROP POLICY IF EXISTS "staff_invites_super_admin" ON public.staff_invites;
CREATE POLICY "staff_invites_super_admin" ON public.staff_invites FOR ALL TO authenticated
  USING (public.my_role() = 'super_admin') WITH CHECK (public.my_role() = 'super_admin');
DROP POLICY IF EXISTS "staff_invites_legacy" ON public.staff_invites;
CREATE POLICY "staff_invites_legacy" ON public.staff_invites FOR ALL TO authenticated
  USING (public.is_legacy_admin()) WITH CHECK (public.is_legacy_admin());

-- بيانات دعوة للعرض قبل التسجيل (اسم السنتر والصفة فقط — بلا بيانات حساسة)
CREATE OR REPLACE FUNCTION public.get_invite_info(p_code TEXT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_inv public.staff_invites%ROWTYPE;
  v_center TEXT;
  v_status TEXT;
BEGIN
  SELECT * INTO v_inv FROM public.staff_invites
   WHERE upper(code) = upper(trim(p_code)) LIMIT 1;
  IF v_inv.id IS NULL THEN RETURN jsonb_build_object('found', false); END IF;
  SELECT name, status INTO v_center, v_status FROM public.centers WHERE id = v_inv.center_id;
  IF v_status IS DISTINCT FROM 'active' THEN
    RETURN jsonb_build_object('found', true, 'suspended', true);
  END IF;
  RETURN jsonb_build_object(
    'found', true, 'center_id', v_inv.center_id, 'center_name', v_center,
    'role', v_inv.role, 'name', v_inv.name,
    'usable', (v_inv.status = 'pending')
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_invite_info(TEXT) TO anon, authenticated;

-- قبول الدعوة: ينشئ حساب الفريق خاملاً ويربط مجموعاته ويغلق الدعوة
CREATE OR REPLACE FUNCTION public.accept_staff_invite(p_code TEXT)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_email TEXT;
  v_inv public.staff_invites%ROWTYPE;
  v_status TEXT;
  g TEXT;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF EXISTS (SELECT 1 FROM public.profiles WHERE id = v_uid) THEN
    RAISE EXCEPTION 'already_registered';
  END IF;
  SELECT * INTO v_inv FROM public.staff_invites
   WHERE upper(code) = upper(trim(p_code)) LIMIT 1;
  IF v_inv.id IS NULL THEN RAISE EXCEPTION 'invalid_invite'; END IF;
  IF v_inv.status <> 'pending' THEN RAISE EXCEPTION 'invite_used'; END IF;
  SELECT status INTO v_status FROM public.centers WHERE id = v_inv.center_id;
  IF v_status IS NULL THEN RAISE EXCEPTION 'center_not_found'; END IF;
  IF v_status <> 'active' THEN RAISE EXCEPTION 'center_suspended'; END IF;
  SELECT email INTO v_email FROM auth.users WHERE id = v_uid;
  BEGIN
    INSERT INTO public.profiles (id, role, center_id, full_name, email, phone, is_active, perms)
    VALUES (v_uid, v_inv.role, v_inv.center_id, nullif(trim(v_inv.name), ''), v_email,
            nullif(trim(COALESCE(v_inv.phone, '')), ''), false, COALESCE(v_inv.perms, '{}'));
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'phone_taken';
  END;
  FOR g IN SELECT jsonb_array_elements_text(COALESCE(v_inv.group_ids, '[]'::jsonb)) LOOP
    INSERT INTO public.teacher_groups (teacher_id, group_id, center_id)
    SELECT v_uid::text, g, v_inv.center_id
    WHERE EXISTS (SELECT 1 FROM public.groups WHERE id = g AND center_id = v_inv.center_id)
    ON CONFLICT DO NOTHING;
  END LOOP;
  UPDATE public.staff_invites SET status = 'accepted', accepted_by = v_uid WHERE id = v_inv.id;
  RETURN v_uid;
END;
$$;
GRANT EXECUTE ON FUNCTION public.accept_staff_invite(TEXT) TO authenticated;

-- ============================================================================
-- ٦/هـ) قناة الدعم: رسائل ثنائية بين مالك السنتر والمطور
-- (المالك يقرأ ويرسل لسنتره فقط — المطور يرى الكل ويرد)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.support_messages (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  center_id   UUID NOT NULL REFERENCES public.centers(id) ON DELETE CASCADE,
  sender_role TEXT NOT NULL CHECK (sender_role IN ('owner','developer')),
  sender_name TEXT NOT NULL DEFAULT '',
  body        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_support_center ON public.support_messages(center_id, created_at);
ALTER TABLE public.support_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "support_owner_read" ON public.support_messages;
CREATE POLICY "support_owner_read" ON public.support_messages FOR SELECT TO authenticated
  USING (public.admin_owns_center(center_id));
DROP POLICY IF EXISTS "support_owner_insert" ON public.support_messages;
CREATE POLICY "support_owner_insert" ON public.support_messages FOR INSERT TO authenticated
  WITH CHECK (public.admin_owns_center(center_id)
              AND sender_role = 'owner'
              AND public.center_is_active(center_id));
DROP POLICY IF EXISTS "support_super_admin" ON public.support_messages;
CREATE POLICY "support_super_admin" ON public.support_messages FOR ALL TO authenticated
  USING (public.my_role() = 'super_admin')
  WITH CHECK (public.my_role() = 'super_admin');

-- ============================================================================
-- ٦/و) الباقات: طلبات الترقية + سجل المعاملات + سجل العمليات
-- ----------------------------------------------------------------------------
-- • subscription_requests: طلب ترقية من المالك (خطة + مدة + مبلغ + تحويل)
--   يعتمدها المطور فينشأ الاشتراك، وكلاهما مسجل في activity_log
-- • activity_log: سجل عمليات لا يُحذف (من فعل ماذا ومتى) — للسنتر والمطور
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.subscription_requests (
  id          TEXT PRIMARY KEY,
  center_id   UUID NOT NULL REFERENCES public.centers(id) ON DELETE CASCADE,
  plan        TEXT NOT NULL,
  months      INT NOT NULL DEFAULT 1,
  amount      NUMERIC NOT NULL DEFAULT 0,
  transfer_at TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  notes       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sub_requests_center ON public.subscription_requests(center_id);
CREATE INDEX IF NOT EXISTS idx_sub_requests_status ON public.subscription_requests(status);

CREATE TABLE IF NOT EXISTS public.activity_log (
  id         TEXT PRIMARY KEY,
  center_id  UUID NOT NULL REFERENCES public.centers(id) ON DELETE CASCADE,
  actor_id   TEXT NOT NULL DEFAULT '',
  actor_name TEXT NOT NULL DEFAULT '',
  action     TEXT NOT NULL DEFAULT '',
  details    TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_activity_center ON public.activity_log(center_id);
CREATE INDEX IF NOT EXISTS idx_activity_created ON public.activity_log(center_id, created_at);

ALTER TABLE public.subscription_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activity_log          ENABLE ROW LEVEL SECURITY;

-- طلبات الترقية: المالك يدير طلبات سنتره، والمطور يدير الكل
DROP POLICY IF EXISTS "subreq_owner_all" ON public.subscription_requests;
CREATE POLICY "subreq_owner_all" ON public.subscription_requests FOR ALL TO authenticated
  USING (public.my_role() = 'center_admin' AND center_id = public.my_center_id())
  WITH CHECK (public.my_role() = 'center_admin' AND center_id = public.my_center_id()
              AND public.center_is_active(center_id) AND status = 'pending');
DROP POLICY IF EXISTS "subreq_super_admin" ON public.subscription_requests;
CREATE POLICY "subreq_super_admin" ON public.subscription_requests FOR ALL TO authenticated
  USING (public.my_role() = 'super_admin') WITH CHECK (public.my_role() = 'super_admin');
DROP POLICY IF EXISTS "subreq_legacy" ON public.subscription_requests;
CREATE POLICY "subreq_legacy" ON public.subscription_requests FOR ALL TO authenticated
  USING (public.is_legacy_admin()) WITH CHECK (public.is_legacy_admin());

-- سجل العمليات: قراءة للمالك والمطور، وكتابة للفريق المفعّل (يُمنع التعديل والحذف)
DROP POLICY IF EXISTS "activity_owner_read" ON public.activity_log;
CREATE POLICY "activity_owner_read" ON public.activity_log FOR SELECT TO authenticated
  USING (public.my_role() = 'center_admin' AND center_id = public.my_center_id());
DROP POLICY IF EXISTS "activity_staff_insert" ON public.activity_log;
CREATE POLICY "activity_staff_insert" ON public.activity_log FOR INSERT TO authenticated
  WITH CHECK ((public.my_role() = 'center_admin' OR public.teacher_center_ok(center_id))
              AND center_id = public.my_center_id()
              AND public.center_is_active(center_id));
DROP POLICY IF EXISTS "activity_super_admin" ON public.activity_log;
CREATE POLICY "activity_super_admin" ON public.activity_log FOR ALL TO authenticated
  USING (public.my_role() = 'super_admin') WITH CHECK (public.my_role() = 'super_admin');
DROP POLICY IF EXISTS "activity_legacy" ON public.activity_log;
CREATE POLICY "activity_legacy" ON public.activity_log FOR ALL TO authenticated
  USING (public.is_legacy_admin()) WITH CHECK (public.is_legacy_admin());

-- ---------- تعميم «المدرس» على كل الفريق (مدرس/مدير/سكرتير) ----------
CREATE OR REPLACE FUNCTION public.teacher_is_active()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role IN ('teacher','manager','secretary')
      AND is_active AND center_id IS NOT NULL
  );
$$;

-- ---------- حدود الباقات تُفرض خادمياً عند التفعيل ----------
CREATE OR REPLACE FUNCTION public.staff_limit_check()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_kind TEXT;
  v_plan TEXT;
  v_max INT;
  v_count INT;
BEGIN
  IF NEW.role NOT IN ('teacher','manager','secretary') OR NOT NEW.is_active THEN
    RETURN NEW;
  END IF;
  SELECT kind INTO v_kind FROM public.centers WHERE id = NEW.center_id;
  SELECT plan_type INTO v_plan FROM public.center_subscriptions
   WHERE center_id = NEW.center_id ORDER BY ends_on DESC LIMIT 1;
  IF NEW.role = 'manager' THEN
    -- لا مدير إضافي أبداً: المالك هو المدير الوحيد
    v_max := 0;
  ELSIF NEW.role = 'secretary' THEN
    IF v_kind = 'solo' THEN v_max := 0;
    ELSIF v_plan = 'center_medium' THEN v_max := 1;
    ELSE v_max := 2; END IF;
  ELSE
    IF v_kind = 'solo' THEN v_max := 0;
    ELSIF v_plan = 'center_medium' THEN v_max := 2;
    ELSE v_max := 4; END IF;
  END IF;
  SELECT count(*) INTO v_count FROM public.profiles
   WHERE center_id = NEW.center_id AND role = NEW.role AND is_active AND id IS DISTINCT FROM NEW.id;
  IF v_count >= v_max THEN
    RAISE EXCEPTION 'staff_limit_reached';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_staff_limit_check ON public.profiles;
CREATE TRIGGER trg_staff_limit_check
  BEFORE INSERT OR UPDATE OF role, is_active ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.staff_limit_check();

-- ---------- سقف طلاب الحساب المنفرد: 200 طالب نشط ----------
-- (يُفحص في دالة التسجيل أدناه عند إنشاء سجل جديد فقط، لا عند الدمج)

-- ============================================================================
-- ٦/هـ) نظام المدرس التابع + أنواع الحسابات + الطالب متعدد المجموعات
-- ----------------------------------------------------------------------------
-- • الدور teacher: يسجَّل بكود السنتر ثم يفعّله المسئول (لا صلاحية قبل التفعيل)
-- • centers.kind: 'center' (سنتر متكامل) أو 'solo' (مدرس خصوصي مستقل)
-- • student_groups: انضمام الطالب لأكثر من مجموعة (مواد/مدرسون مختلفون)
-- • teacher_groups: إسناد المجموعات للمدرس (نطاق عمله في الواجهة)
-- ============================================================================

-- نوع الحساب: سنتر متكامل أم مدرس خصوصي مستقل
ALTER TABLE public.centers ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'center'
  CHECK (kind IN ('center','solo'));

-- صلاحيات المدرس التفصيلية (مفاتيح true/false يتحكم بها المسئول)
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS perms JSONB NOT NULL DEFAULT '{}';

-- ---------- دوال مساعدة للمدرس (قبل السياسات التي تستخدمها) ----------
-- (التعريف الفعلي لـ teacher_is_active بالأدوار الثلاثة موجود أعلاه — لا تكرره هنا)

CREATE OR REPLACE FUNCTION public.teacher_center_ok(cid UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.teacher_is_active() AND cid IS NOT NULL AND cid = public.my_center_id();
$$;

-- انضمام الطالب لمجموعات إضافية (بجانب مجموعته الأساسية group_id)
CREATE TABLE IF NOT EXISTS public.student_groups (
  student_id TEXT NOT NULL,
  group_id   TEXT NOT NULL,
  center_id  UUID NOT NULL REFERENCES public.centers(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (student_id, group_id)
);
CREATE INDEX IF NOT EXISTS idx_student_groups_group  ON public.student_groups(group_id);
CREATE INDEX IF NOT EXISTS idx_student_groups_center ON public.student_groups(center_id);

-- إسناد المجموعات للمدرس (نطاق عمله)
CREATE TABLE IF NOT EXISTS public.teacher_groups (
  teacher_id TEXT NOT NULL,
  group_id   TEXT NOT NULL,
  center_id  UUID NOT NULL REFERENCES public.centers(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (teacher_id, group_id)
);
CREATE INDEX IF NOT EXISTS idx_teacher_groups_group ON public.teacher_groups(group_id);

ALTER TABLE public.student_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teacher_groups  ENABLE ROW LEVEL SECURITY;

-- عدّاد طلاب المجموعة يشمل الأساسية + الإضافية (النشطين فقط)
CREATE OR REPLACE FUNCTION public.sync_group_student_count()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  gids TEXT[];
BEGIN
  gids := ARRAY[]::TEXT[];
  IF TG_TABLE_NAME = 'student_groups' THEN
    IF TG_OP IN ('INSERT', 'UPDATE') THEN gids := gids || NEW.group_id; END IF;
    IF TG_OP IN ('DELETE', 'UPDATE') THEN gids := gids || OLD.group_id; END IF;
  ELSE
    IF TG_OP IN ('INSERT', 'UPDATE') AND NEW.group_id IS NOT NULL THEN gids := gids || NEW.group_id; END IF;
    IF TG_OP IN ('DELETE', 'UPDATE') AND OLD.group_id IS NOT NULL THEN gids := gids || OLD.group_id; END IF;
  END IF;
  UPDATE public.groups g SET students_count = (
    SELECT count(DISTINCT s.id) FROM public.students s
    WHERE s.status = 'active' AND (
      s.group_id = g.id OR EXISTS (
        SELECT 1 FROM public.student_groups sg WHERE sg.student_id = s.id AND sg.group_id = g.id
      )
    )
  ) WHERE g.id = ANY (gids);
  RETURN COALESCE(NEW, OLD);
END;
$$;
DROP TRIGGER IF EXISTS trg_sync_group_count ON public.students;
CREATE TRIGGER trg_sync_group_count
  AFTER INSERT OR DELETE OR UPDATE OF group_id, status ON public.students
  FOR EACH ROW EXECUTE FUNCTION public.sync_group_student_count();
DROP TRIGGER IF EXISTS trg_sync_group_count_junction ON public.student_groups;
CREATE TRIGGER trg_sync_group_count_junction
  AFTER INSERT OR DELETE OR UPDATE ON public.student_groups
  FOR EACH ROW EXECUTE FUNCTION public.sync_group_student_count();

-- ---------- student_groups / teacher_groups: إدارة المسئول + قراءة المدرس لسنتره ----------
DROP POLICY IF EXISTS "student_groups_admin_all" ON public.student_groups;
CREATE POLICY "student_groups_admin_all" ON public.student_groups FOR ALL TO authenticated
  USING (public.admin_owns_center(center_id))
  WITH CHECK (public.admin_owns_center(center_id) AND public.center_is_active(center_id));
DROP POLICY IF EXISTS "student_groups_teacher_rw" ON public.student_groups;
CREATE POLICY "student_groups_teacher_rw" ON public.student_groups FOR ALL TO authenticated
  USING (public.teacher_center_ok(center_id))
  WITH CHECK (public.teacher_center_ok(center_id));
DROP POLICY IF EXISTS "teacher_groups_admin_all" ON public.teacher_groups;
CREATE POLICY "teacher_groups_admin_all" ON public.teacher_groups FOR ALL TO authenticated
  USING (public.admin_owns_center(center_id))
  WITH CHECK (public.admin_owns_center(center_id) AND public.center_is_active(center_id));
DROP POLICY IF EXISTS "teacher_groups_self_read" ON public.teacher_groups;
CREATE POLICY "teacher_groups_self_read" ON public.teacher_groups FOR SELECT TO authenticated
  USING (teacher_id = auth.uid()::text);
-- الطالب يقرأ عضوياته الإضافية (جدوله وقوائمه تعتمد عليها)
DROP POLICY IF EXISTS "student_groups_self_read" ON public.student_groups;
CREATE POLICY "student_groups_self_read" ON public.student_groups FOR SELECT TO authenticated
  USING (student_id = public.my_student_id());

-- ---------- سياسات المدرس (قراءة سنتره + كتابة حسب صلاحياته في الواجهة) ----------
-- students/dues/payments: قراءة (التحصيل والتقارير عبر سياسات الكتابة أدناه)
DROP POLICY IF EXISTS "students_teacher_read" ON public.students;
CREATE POLICY "students_teacher_read" ON public.students FOR SELECT TO authenticated
  USING (public.teacher_center_ok(center_id));
DROP POLICY IF EXISTS "dues_teacher_read" ON public.dues;
CREATE POLICY "dues_teacher_read" ON public.dues FOR SELECT TO authenticated
  USING (public.teacher_center_ok(center_id));
DROP POLICY IF EXISTS "dues_teacher_collect" ON public.dues;
CREATE POLICY "dues_teacher_collect" ON public.dues FOR UPDATE TO authenticated
  USING (public.teacher_center_ok(center_id))
  WITH CHECK (public.teacher_center_ok(center_id));
DROP POLICY IF EXISTS "payments_teacher_read" ON public.payments;
CREATE POLICY "payments_teacher_read" ON public.payments FOR SELECT TO authenticated
  USING (public.teacher_center_ok(center_id));
DROP POLICY IF EXISTS "payments_teacher_insert" ON public.payments;
CREATE POLICY "payments_teacher_insert" ON public.payments FOR INSERT TO authenticated
  WITH CHECK (public.teacher_center_ok(center_id));
-- الحضور والدرجات: كامل داخل سنتره (الإنشاء/التعديل/الحذف)
DROP POLICY IF EXISTS "attendance_teacher_all" ON public.attendance;
CREATE POLICY "attendance_teacher_all" ON public.attendance FOR ALL TO authenticated
  USING (public.teacher_center_ok(center_id))
  WITH CHECK (public.teacher_center_ok(center_id));
DROP POLICY IF EXISTS "sessions_teacher_insert" ON public.sessions;
CREATE POLICY "sessions_teacher_insert" ON public.sessions FOR INSERT TO authenticated
  WITH CHECK (public.teacher_center_ok(center_id));
DROP POLICY IF EXISTS "manual_grades_teacher_all" ON public.manual_grades;
CREATE POLICY "manual_grades_teacher_all" ON public.manual_grades FOR ALL TO authenticated
  USING (public.teacher_center_ok(center_id))
  WITH CHECK (public.teacher_center_ok(center_id));
-- المحتوى: إعلانات/اختبارات/محاولات/استبيانات/شرف/طلبات (رد فقط للطلبات)
DROP POLICY IF EXISTS "announcements_teacher_all" ON public.announcements;
CREATE POLICY "announcements_teacher_all" ON public.announcements FOR ALL TO authenticated
  USING (public.teacher_center_ok(center_id))
  WITH CHECK (public.teacher_center_ok(center_id));
DROP POLICY IF EXISTS "app_exams_teacher_all" ON public.app_exams;
CREATE POLICY "app_exams_teacher_all" ON public.app_exams FOR ALL TO authenticated
  USING (public.teacher_center_ok(center_id))
  WITH CHECK (public.teacher_center_ok(center_id));
DROP POLICY IF EXISTS "app_attempts_teacher_all" ON public.app_exam_attempts;
CREATE POLICY "app_attempts_teacher_all" ON public.app_exam_attempts FOR ALL TO authenticated
  USING (public.teacher_center_ok(center_id))
  WITH CHECK (public.teacher_center_ok(center_id));
DROP POLICY IF EXISTS "app_surveys_teacher_all" ON public.app_surveys;
CREATE POLICY "app_surveys_teacher_all" ON public.app_surveys FOR ALL TO authenticated
  USING (public.teacher_center_ok(center_id))
  WITH CHECK (public.teacher_center_ok(center_id));
DROP POLICY IF EXISTS "app_responses_teacher_read" ON public.app_survey_responses;
CREATE POLICY "app_responses_teacher_read" ON public.app_survey_responses FOR SELECT TO authenticated
  USING (public.teacher_center_ok(center_id));
DROP POLICY IF EXISTS "honorees_teacher_all" ON public.honorees;
CREATE POLICY "honorees_teacher_all" ON public.honorees FOR ALL TO authenticated
  USING (public.teacher_center_ok(center_id))
  WITH CHECK (public.teacher_center_ok(center_id));
DROP POLICY IF EXISTS "app_inquiries_teacher_reply" ON public.app_inquiries;
CREATE POLICY "app_inquiries_teacher_reply" ON public.app_inquiries FOR UPDATE TO authenticated
  USING (public.teacher_center_ok(center_id))
  WITH CHECK (public.teacher_center_ok(center_id));
DROP POLICY IF EXISTS "app_notif_teacher_all" ON public.app_notifications;
CREATE POLICY "app_notif_teacher_all" ON public.app_notifications FOR ALL TO authenticated
  USING (public.teacher_center_ok(center_id))
  WITH CHECK (public.teacher_center_ok(center_id));

-- ---------- المسئول يدير حسابات مدرسي سنتره (تفعيل/إيقاف/صلاحيات فقط) ----------
DROP POLICY IF EXISTS "profiles_teacher_manage" ON public.profiles;
CREATE POLICY "profiles_teacher_manage" ON public.profiles FOR UPDATE TO authenticated
  USING (public.my_role() = 'center_admin'
         AND role IN ('teacher','manager','secretary')
         AND center_id = public.my_center_id())
  WITH CHECK (public.my_role() = 'center_admin'
         AND role IN ('teacher','manager','secretary')
         AND center_id = public.my_center_id());
-- حذف حسابات الفريق (مدرس/مدير/سكرتير) بيد المسئول فقط — لا حذف للمالك أو الطلاب
DROP POLICY IF EXISTS "profiles_staff_delete" ON public.profiles;
CREATE POLICY "profiles_staff_delete" ON public.profiles FOR DELETE TO authenticated
  USING (public.my_role() = 'center_admin'
         AND role IN ('teacher','manager','secretary')
         AND center_id = public.my_center_id());

-- حماية الهوية: يُستثنى منها المسئول وهو يفعّل/يوقف مدرسي سنتره أو يعدل صلاحياتهم
CREATE OR REPLACE FUNCTION public.guard_profile_identity()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_legacy_admin() AND public.my_role() IS DISTINCT FROM 'super_admin' THEN
    IF public.my_role() = 'center_admin'
       AND OLD.role IN ('teacher','manager','secretary')
       AND NEW.role IN ('teacher','manager','secretary')
       AND OLD.center_id IS NOT DISTINCT FROM NEW.center_id
       AND OLD.center_id = public.my_center_id()
       AND OLD.student_id IS NOT DISTINCT FROM NEW.student_id THEN
      RETURN NEW;
    END IF;
    IF NEW.role IS DISTINCT FROM OLD.role
       OR NEW.center_id IS DISTINCT FROM OLD.center_id
       OR NEW.student_id IS DISTINCT FROM OLD.student_id
       OR NEW.is_active IS DISTINCT FROM OLD.is_active THEN
      RAISE EXCEPTION 'identity_protected';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- ---------- تسجيل فرد فريق تابع (مدرس/مدير/سكرتير): حساب خامل حتى يفعّله المسئول ----------
DROP FUNCTION IF EXISTS public.register_teacher_account(UUID, TEXT, TEXT);
CREATE OR REPLACE FUNCTION public.register_staff_account(
  p_center_id UUID, p_full_name TEXT, p_phone TEXT, p_role TEXT DEFAULT 'teacher'
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_email TEXT;
  v_status TEXT;
  v_kind TEXT;
  v_role TEXT := lower(trim(p_role));
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF EXISTS (SELECT 1 FROM public.profiles WHERE id = v_uid) THEN
    RAISE EXCEPTION 'already_registered';
  END IF;
  IF v_role NOT IN ('teacher','manager','secretary') THEN
    RAISE EXCEPTION 'invalid_role';
  END IF;
  SELECT status, kind INTO v_status, v_kind FROM public.centers WHERE id = p_center_id;
  IF v_status IS NULL THEN RAISE EXCEPTION 'center_not_found'; END IF;
  IF v_status <> 'active' THEN RAISE EXCEPTION 'center_suspended'; END IF;
  IF v_kind = 'solo' THEN RAISE EXCEPTION 'staff_not_allowed'; END IF;
  IF EXISTS (SELECT 1 FROM public.center_settings
             WHERE center_id = p_center_id AND (settings ->> 'registration_open') = 'false') THEN
    RAISE EXCEPTION 'registration_closed';
  END IF;
  SELECT email INTO v_email FROM auth.users WHERE id = v_uid;
  BEGIN
    INSERT INTO public.profiles (id, role, center_id, full_name, email, phone, is_active, perms)
    VALUES (v_uid, v_role, p_center_id, trim(p_full_name), v_email, nullif(trim(p_phone), ''), false, '{}');
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'phone_taken';
  END;
  RETURN v_uid;
END;
$$;
GRANT EXECUTE ON FUNCTION public.register_staff_account(UUID, TEXT, TEXT, TEXT) TO authenticated;

-- ---------- رقم ولي الأمر يجب أن يختلف عن رقم الطالب ----------
-- (يُفحص في دالة التسجيل؛ رسالة عربية في التطبيق: same_guardian_phone)

-- ============================================================================
-- ٨) صلاحيات الجداول (anon / authenticated)
--    مشاريع Supabase الجديدة لا تمنح صلاحيات الجداول تلقائياً — وهذه المنح
--    هي النموذج القياسي في Supabase: الدور قادر على «المحاولة»، وRLS فوقها
--    يحدد فعلياً ما يمكن قراءته أو كتابته لكل مستخدم.
-- ============================================================================
-- service_role لعمليات الخادم الموثوقة فقط (عامل كلاود فلير + سكريبتات الإدارة):
-- لا يتجاوز RLS لغيره، ولا يظهر في التطبيق إطلاقاً (التطبيق anon فقط).
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;

-- لتغطية أي جداول تُنشأ مستقبلاً (ترقية الموقع لاحقاً) دون تكرار المشكلة
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO anon, authenticated, service_role;

COMMIT;

-- ============================================================================
-- ✅ تم. الخطوات التالية في README.md:
--   ١) إنشاء حساب المطور (سوبر أدمن) وترقيته بأمر SQL واحد
--   ٢) ضبط المصادقة (تفعيل التسجيل + تفعيل تأكيد البريد لمنع الوهمي)
--   ٣) تشغيل التطبيق وربطه
-- ============================================================================
-- Mr Center: entitlements + accounting module (run after android_multitenant_schema.sql)
ALTER TABLE public.center_subscriptions ADD COLUMN IF NOT EXISTS extra_teachers INTEGER NOT NULL DEFAULT 0 CHECK (extra_teachers >= 0);
ALTER TABLE public.center_subscriptions ADD COLUMN IF NOT EXISTS extra_secretaries INTEGER NOT NULL DEFAULT 0 CHECK (extra_secretaries >= 0);
ALTER TABLE public.center_subscriptions ADD COLUMN IF NOT EXISTS extra_managers INTEGER NOT NULL DEFAULT 0 CHECK (extra_managers >= 0);
ALTER TABLE public.center_subscriptions ADD COLUMN IF NOT EXISTS enabled_features JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS public.center_ledger (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), center_id UUID NOT NULL REFERENCES public.centers(id) ON DELETE CASCADE,
 kind TEXT NOT NULL CHECK (kind IN ('income','expense')), category TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
 occurred_on DATE NOT NULL DEFAULT CURRENT_DATE, created_by UUID REFERENCES auth.users(id), created_by_name TEXT NOT NULL DEFAULT '', created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_center_ledger_center_date ON public.center_ledger(center_id, occurred_on DESC);
ALTER TABLE public.center_ledger ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ledger_owner_all ON public.center_ledger;
CREATE POLICY ledger_owner_all ON public.center_ledger FOR ALL TO authenticated USING (public.admin_owns_center(center_id)) WITH CHECK (public.admin_owns_center(center_id));
DROP POLICY IF EXISTS ledger_developer_all ON public.center_ledger;
CREATE POLICY ledger_developer_all ON public.center_ledger FOR ALL TO authenticated USING ((SELECT role = 'super_admin' FROM public.profiles WHERE id = auth.uid())) WITH CHECK ((SELECT role = 'super_admin' FROM public.profiles WHERE id = auth.uid()));

-- Developer can grant extra staff slots and time-bound paid features.
CREATE OR REPLACE FUNCTION public.dev_set_entitlements(p_center UUID, p_teachers INT, p_secretaries INT, p_managers INT, p_features JSONB)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NOT (SELECT role = 'super_admin' FROM public.profiles WHERE id = auth.uid()) THEN RAISE EXCEPTION 'not_allowed'; END IF;
 UPDATE public.center_subscriptions SET extra_teachers=GREATEST(p_teachers,0), extra_secretaries=GREATEST(p_secretaries,0), extra_managers=GREATEST(p_managers,0), enabled_features=COALESCE(p_features,'{}') WHERE center_id=p_center AND status='active';
END; $$;
GRANT EXECUTE ON FUNCTION public.dev_set_entitlements(UUID,INT,INT,INT,JSONB) TO authenticated;

CREATE OR REPLACE FUNCTION public.staff_limit_check() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE k TEXT; p TEXT; lim INT; used INT; ext INT:=0;
BEGIN
 IF NEW.role NOT IN ('teacher','manager','secretary') OR NOT NEW.is_active THEN RETURN NEW; END IF;
 SELECT kind INTO k FROM public.centers WHERE id=NEW.center_id;
 SELECT plan_type, CASE WHEN NEW.role='teacher' THEN extra_teachers WHEN NEW.role='secretary' THEN extra_secretaries ELSE extra_managers END INTO p, ext FROM public.center_subscriptions WHERE center_id=NEW.center_id AND status='active' AND (starts_on IS NULL OR starts_on <= CURRENT_DATE) AND (ends_on IS NULL OR ends_on >= CURRENT_DATE) ORDER BY ends_on DESC NULLS LAST LIMIT 1;
 -- Temporary paid entitlements are additive and only count while active.
 SELECT COALESCE(ext,0) + COALESCE(SUM(CASE WHEN NEW.role='teacher' THEN extra_teachers WHEN NEW.role='secretary' THEN extra_secretaries ELSE extra_managers END),0)
 INTO ext FROM public.center_entitlements
 WHERE center_id=NEW.center_id AND feature_key='staff_expansion'
   AND starts_on <= CURRENT_DATE AND (is_open_ended OR ends_on >= CURRENT_DATE);
 IF NEW.role='manager' THEN lim=0; -- صاحب السنتر هو المدير الوحيد — زيادة المديرين من المطور فقط
 ELSIF NEW.role='secretary' THEN lim=CASE WHEN k='solo' THEN 0 WHEN p='center_medium' THEN 1 ELSE 2 END;
 ELSE lim=CASE WHEN k='solo' THEN 0 WHEN p='center_medium' THEN 2 ELSE 4 END; END IF;
 SELECT count(*) INTO used FROM public.profiles WHERE center_id=NEW.center_id AND role=NEW.role AND is_active AND id IS DISTINCT FROM NEW.id;
 IF used >= lim + ext THEN RAISE EXCEPTION 'staff_limit_reached'; END IF; RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_staff_limit_check ON public.profiles;
CREATE TRIGGER trg_staff_limit_check BEFORE INSERT OR UPDATE OF role,is_active ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.staff_limit_check();

-- تحصيل مرتبط بالمحاسبة: كل دفعة طالب تصبح إيراداً آلياً مع هوية المحصل
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS collected_by UUID REFERENCES auth.users(id);
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS collected_by_name TEXT NOT NULL DEFAULT '';
ALTER TABLE public.center_ledger ADD COLUMN IF NOT EXISTS source_payment_id TEXT;
ALTER TABLE public.center_ledger ADD COLUMN IF NOT EXISTS employee_id UUID;
ALTER TABLE public.center_ledger ADD COLUMN IF NOT EXISTS entry_type TEXT NOT NULL DEFAULT 'general' CHECK (entry_type IN ('general','salary','advance','bonus','rent','utility','purchase','payment_collection'));
CREATE UNIQUE INDEX IF NOT EXISTS uq_ledger_payment ON public.center_ledger(source_payment_id) WHERE source_payment_id IS NOT NULL;
CREATE OR REPLACE FUNCTION public.record_payment_income() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE cid UUID; nm TEXT;
BEGIN
 SELECT center_id INTO cid FROM public.students WHERE id=NEW.student_id;
 SELECT full_name INTO nm FROM public.profiles WHERE id=COALESCE(NEW.collected_by,auth.uid());
 IF cid IS NOT NULL THEN INSERT INTO public.center_ledger(center_id,kind,category,description,amount,occurred_on,created_by,created_by_name,source_payment_id,entry_type)
 VALUES(cid,'income','تحصيل طلاب','تحصيل من طالب رقم '||NEW.student_id,NEW.amount,NEW.payment_date,COALESCE(NEW.collected_by,auth.uid()),COALESCE(NEW.collected_by_name,nm,''),NEW.id,'payment_collection') ON CONFLICT DO NOTHING; END IF;
 RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_payment_income ON public.payments;
CREATE TRIGGER trg_payment_income AFTER INSERT ON public.payments FOR EACH ROW EXECUTE FUNCTION public.record_payment_income();

-- صلاحيات إضافية مؤقتة لكل سنتر (تدار من لوحة المطور)
CREATE TABLE IF NOT EXISTS public.center_entitlements (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), center_id UUID NOT NULL REFERENCES public.centers(id) ON DELETE CASCADE,
 extra_teachers INT NOT NULL DEFAULT 0 CHECK(extra_teachers>=0), extra_secretaries INT NOT NULL DEFAULT 0 CHECK(extra_secretaries>=0), extra_managers INT NOT NULL DEFAULT 0 CHECK(extra_managers>=0),
 feature_key TEXT NOT NULL DEFAULT 'staff_expansion', starts_on DATE NOT NULL DEFAULT CURRENT_DATE, ends_on DATE, is_open_ended BOOLEAN NOT NULL DEFAULT false,
 created_by UUID REFERENCES auth.users(id), created_at TIMESTAMPTZ NOT NULL DEFAULT now(), CHECK(is_open_ended OR ends_on IS NOT NULL), UNIQUE(center_id,feature_key)
);
ALTER TABLE public.center_entitlements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS entitlements_owner_read ON public.center_entitlements;
CREATE POLICY entitlements_owner_read ON public.center_entitlements FOR SELECT TO authenticated USING (public.admin_owns_center(center_id));
DROP POLICY IF EXISTS entitlements_dev_all ON public.center_entitlements;
CREATE POLICY entitlements_dev_all ON public.center_entitlements FOR ALL TO authenticated USING ((SELECT role='super_admin' FROM public.profiles WHERE id=auth.uid())) WITH CHECK ((SELECT role='super_admin' FROM public.profiles WHERE id=auth.uid()));
ALTER TABLE public.center_ledger ADD COLUMN IF NOT EXISTS period_month INT;
ALTER TABLE public.center_ledger ADD COLUMN IF NOT EXISTS period_year INT;
ALTER TABLE public.center_ledger ADD COLUMN IF NOT EXISTS deduction NUMERIC(12,2) NOT NULL DEFAULT 0;
CREATE OR REPLACE FUNCTION public.dev_upsert_entitlement(p_center UUID,p_teachers INT,p_secretaries INT,p_managers INT,p_starts DATE,p_ends DATE,p_open BOOLEAN)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ BEGIN
 IF NOT ((SELECT role='super_admin' FROM public.profiles WHERE id=auth.uid())) THEN RAISE EXCEPTION 'not_allowed'; END IF;
 INSERT INTO public.center_entitlements(center_id,extra_teachers,extra_secretaries,extra_managers,starts_on,ends_on,is_open_ended,created_by) VALUES(p_center,GREATEST(p_teachers,0),GREATEST(p_secretaries,0),GREATEST(p_managers,0),COALESCE(p_starts,CURRENT_DATE),p_ends,p_open,auth.uid()) ON CONFLICT(center_id,feature_key) DO UPDATE SET extra_teachers=EXCLUDED.extra_teachers,extra_secretaries=EXCLUDED.extra_secretaries,extra_managers=EXCLUDED.extra_managers,starts_on=EXCLUDED.starts_on,ends_on=EXCLUDED.ends_on,is_open_ended=EXCLUDED.is_open_ended,created_by=auth.uid(); END; $$;
GRANT EXECUTE ON FUNCTION public.dev_upsert_entitlement(UUID,INT,INT,INT,DATE,DATE,BOOLEAN) TO authenticated;

-- ============================================================================
-- تطوير المحاسبة: العهدة وكشوف الرواتب والتقارير الزمنية
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.staff_custody (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), center_id UUID NOT NULL REFERENCES public.centers(id) ON DELETE CASCADE,
 staff_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE, custody_date DATE NOT NULL DEFAULT CURRENT_DATE,
 expected_amount NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK(expected_amount >= 0), delivered_amount NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK(delivered_amount >= 0),
 status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','submitted','matched','shortage','surplus')), notes TEXT NOT NULL DEFAULT '',
 submitted_at TIMESTAMPTZ, submitted_by UUID REFERENCES auth.users(id), created_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE(center_id,staff_id,custody_date)
);
ALTER TABLE public.staff_custody ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS custody_owner_all ON public.staff_custody;
CREATE POLICY custody_owner_all ON public.staff_custody FOR ALL TO authenticated USING (public.admin_owns_center(center_id)) WITH CHECK (public.admin_owns_center(center_id));
DROP POLICY IF EXISTS custody_staff_read ON public.staff_custody;
CREATE POLICY custody_staff_read ON public.staff_custody FOR SELECT TO authenticated USING (staff_id=auth.uid());

CREATE OR REPLACE FUNCTION public.submit_staff_custody(p_staff UUID,p_date DATE,p_delivered NUMERIC,p_notes TEXT DEFAULT '')
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE cid UUID; expected NUMERIC; result UUID;
BEGIN
 SELECT center_id INTO cid FROM public.profiles WHERE id=auth.uid() AND role IN ('manager','secretary') AND is_active;
 IF cid IS NULL THEN RAISE EXCEPTION 'not_allowed'; END IF;
 IF p_staff <> auth.uid() THEN RAISE EXCEPTION 'not_allowed'; END IF;
 SELECT COALESCE(SUM(amount),0) INTO expected FROM public.center_ledger WHERE center_id=cid AND created_by=p_staff AND entry_type='payment_collection' AND occurred_on=p_date;
 INSERT INTO public.staff_custody(center_id,staff_id,custody_date,expected_amount,delivered_amount,status,notes,submitted_at,submitted_by)
 VALUES(cid,p_staff,p_date,expected,GREATEST(p_delivered,0),CASE WHEN p_delivered=expected THEN 'matched' WHEN p_delivered<expected THEN 'shortage' ELSE 'surplus' END,COALESCE(p_notes,''),now(),auth.uid())
 ON CONFLICT(center_id,staff_id,custody_date) DO UPDATE SET expected_amount=EXCLUDED.expected_amount,delivered_amount=EXCLUDED.delivered_amount,status=EXCLUDED.status,notes=EXCLUDED.notes,submitted_at=now(),submitted_by=auth.uid()
 RETURNING id INTO result; RETURN result;
END; $$;
GRANT EXECUTE ON FUNCTION public.submit_staff_custody(UUID,DATE,NUMERIC,TEXT) TO authenticated;

-- اعتماد العهدة وتصحيح حالتها من صاحب السنتر فقط
CREATE OR REPLACE FUNCTION public.review_staff_custody(p_id UUID, p_status TEXT, p_notes TEXT DEFAULT '')
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF p_status NOT IN ('matched','shortage','surplus','open') THEN RAISE EXCEPTION 'invalid_status'; END IF;
 UPDATE public.staff_custody SET status=p_status, notes=CASE WHEN p_notes='' THEN notes ELSE p_notes END
 WHERE id=p_id AND public.admin_owns_center(center_id);
 IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
END; $$;
GRANT EXECUTE ON FUNCTION public.review_staff_custody(UUID,TEXT,TEXT) TO authenticated;

-- عمولات التحصيل: نسبة قابلة للضبط لكل موظف، ولا تغير إجمالي الإيراد
CREATE TABLE IF NOT EXISTS public.staff_commission_rules (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), center_id UUID NOT NULL REFERENCES public.centers(id) ON DELETE CASCADE,
 staff_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE, rate NUMERIC(5,2) NOT NULL DEFAULT 3 CHECK(rate >= 0 AND rate <= 100),
 starts_on DATE NOT NULL DEFAULT CURRENT_DATE, ends_on DATE, is_active BOOLEAN NOT NULL DEFAULT true, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(center_id, staff_id)
);
ALTER TABLE public.staff_commission_rules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS commission_owner_all ON public.staff_commission_rules;
CREATE POLICY commission_owner_all ON public.staff_commission_rules FOR ALL TO authenticated USING (public.admin_owns_center(center_id)) WITH CHECK (public.admin_owns_center(center_id));
CREATE OR REPLACE FUNCTION public.calculate_staff_commission(p_staff UUID,p_from DATE,p_to DATE)
RETURNS NUMERIC LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE cid UUID; rate NUMERIC; total NUMERIC;
BEGIN
 SELECT center_id INTO cid FROM public.profiles WHERE id=auth.uid() AND role IN ('center_admin','super_admin') AND (role='super_admin' OR center_id=(SELECT center_id FROM public.profiles WHERE id=p_staff));
 IF cid IS NULL THEN RAISE EXCEPTION 'not_allowed'; END IF;
 SELECT COALESCE((SELECT rate FROM public.staff_commission_rules WHERE staff_id=p_staff AND center_id=cid AND is_active AND starts_on<=p_to AND (ends_on IS NULL OR ends_on>=p_from) LIMIT 1),0) INTO rate;
 SELECT COALESCE(SUM(amount),0) INTO total FROM public.center_ledger WHERE center_id=cid AND created_by=p_staff AND entry_type='payment_collection' AND occurred_on BETWEEN p_from AND p_to;
 RETURN ROUND(total*rate/100,2);
END; $$;
GRANT EXECUTE ON FUNCTION public.calculate_staff_commission(UUID,DATE,DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION public.calculate_staff_commission(UUID,DATE,DATE) TO authenticated;

-- ============================================================================
-- ١٠) المحاسبة كخدمة مدفوعة: تفعيل لكل سنتر من لوحة المطور + السنوات المالية
--     - دون التفعيل: الإيرادات تُسجل بالخلفية آلياً (trigger بأمان تعريف)
--       ويراها المطور فقط؛ المالك لا يرى دفتر الحسابات ولا يدخل فيه.
--     - عند التفعيل لاحقاً: يجد المالك سجل التحصيل كاملاً منذ بداية اشتراكه.
-- ============================================================================

-- هل المحاسبة مفعّلة لهذا السنتر؟ (المطور دائماً · اشتراك فعّال بميزة accounting · صلاحية مؤقتة)
CREATE OR REPLACE FUNCTION public.accounting_enabled(p_center UUID)
RETURNS BOOLEAN LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_role TEXT;
  v_feat BOOLEAN := false;
BEGIN
  IF v_uid IS NULL THEN RETURN false; END IF;
  SELECT role INTO v_role FROM public.profiles WHERE id = v_uid;
  IF v_role = 'super_admin' THEN RETURN true; END IF;
  SELECT COALESCE((s.enabled_features ->> 'accounting')::boolean, false) INTO v_feat
    FROM public.center_subscriptions s
   WHERE s.center_id = p_center AND s.status = 'active'
     AND (s.starts_on IS NULL OR s.starts_on <= CURRENT_DATE)
     AND (s.ends_on IS NULL OR s.ends_on >= CURRENT_DATE)
   ORDER BY s.ends_on DESC NULLS LAST LIMIT 1;
  IF v_feat THEN RETURN true; END IF;
  RETURN EXISTS (
    SELECT 1 FROM public.center_entitlements e
     WHERE e.center_id = p_center AND e.feature_key = 'accounting'
       AND e.starts_on <= CURRENT_DATE
       AND (e.is_open_ended OR e.ends_on >= CURRENT_DATE));
END; $$;
GRANT EXECUTE ON FUNCTION public.accounting_enabled(UUID) TO authenticated;

-- مالك السنتر لا يلمس الدفتر إلا إذا كانت الخدمة مفعّلة له (خادمياً)
DROP POLICY IF EXISTS ledger_owner_all ON public.center_ledger;
CREATE POLICY ledger_owner_all ON public.center_ledger FOR ALL TO authenticated
  USING (public.admin_owns_center(center_id) AND public.accounting_enabled(center_id))
  WITH CHECK (public.admin_owns_center(center_id) AND public.accounting_enabled(center_id));

-- السنوات المالية: فتح/إغلاق مع ترحيل الرصيد
CREATE TABLE IF NOT EXISTS public.center_fiscal_years (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  center_id UUID NOT NULL REFERENCES public.centers(id) ON DELETE CASCADE,
  fiscal_year INT NOT NULL CHECK (fiscal_year BETWEEN 2000 AND 2100),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  opening_balance NUMERIC(12,2) NOT NULL DEFAULT 0,
  closing_balance NUMERIC(12,2),
  opened_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at TIMESTAMPTZ,
  closed_by UUID REFERENCES auth.users(id),
  UNIQUE (center_id, fiscal_year)
);
CREATE INDEX IF NOT EXISTS idx_fiscal_center_year ON public.center_fiscal_years(center_id, fiscal_year DESC);
ALTER TABLE public.center_fiscal_years ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS fiscal_owner_all ON public.center_fiscal_years;
CREATE POLICY fiscal_owner_all ON public.center_fiscal_years FOR ALL TO authenticated
  USING (public.admin_owns_center(center_id) AND public.accounting_enabled(center_id))
  WITH CHECK (public.admin_owns_center(center_id) AND public.accounting_enabled(center_id));
DROP POLICY IF EXISTS fiscal_dev_all ON public.center_fiscal_years;
CREATE POLICY fiscal_dev_all ON public.center_fiscal_years FOR ALL TO authenticated
  USING ((SELECT role = 'super_admin' FROM public.profiles WHERE id = auth.uid()))
  WITH CHECK ((SELECT role = 'super_admin' FROM public.profiles WHERE id = auth.uid()));

-- فتح سنة مالية: رصيد أول المدة = رصيد إغلاق آخر سنة مغلقة قبله
CREATE OR REPLACE FUNCTION public.open_fiscal_year(p_year INT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  cid UUID;
BEGIN
  SELECT center_id INTO cid FROM public.profiles
   WHERE id = auth.uid()
     AND (role = 'super_admin'
          OR (role = 'center_admin' AND public.accounting_enabled(center_id)));
  IF cid IS NULL THEN RAISE EXCEPTION 'not_allowed'; END IF;
  IF EXISTS (SELECT 1 FROM public.center_fiscal_years WHERE center_id = cid AND fiscal_year = p_year) THEN
    RAISE EXCEPTION 'year_exists';
  END IF;
  INSERT INTO public.center_fiscal_years(center_id, fiscal_year, status, opening_balance)
  VALUES (cid, p_year, 'open',
    COALESCE((SELECT closing_balance FROM public.center_fiscal_years
               WHERE center_id = cid AND status = 'closed' AND fiscal_year < p_year
               ORDER BY fiscal_year DESC LIMIT 1), 0));
END; $$;
GRANT EXECUTE ON FUNCTION public.open_fiscal_year(INT) TO authenticated;

-- إغلاق سنة: حساب الصافي + فتح السنة التالية بترحيل الرصيد تلقائياً
CREATE OR REPLACE FUNCTION public.close_fiscal_year(p_year INT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  cid UUID;
  v_net NUMERIC;
  v_row public.center_fiscal_years%ROWTYPE;
BEGIN
  SELECT center_id INTO cid FROM public.profiles
   WHERE id = auth.uid()
     AND (role = 'super_admin'
          OR (role = 'center_admin' AND public.accounting_enabled(center_id)));
  IF cid IS NULL THEN RAISE EXCEPTION 'not_allowed'; END IF;
  SELECT * INTO v_row FROM public.center_fiscal_years WHERE center_id = cid AND fiscal_year = p_year;
  IF NOT FOUND THEN RAISE EXCEPTION 'year_not_found'; END IF;
  IF v_row.status <> 'open' THEN RAISE EXCEPTION 'year_closed'; END IF;
  SELECT COALESCE(SUM(CASE kind WHEN 'income' THEN amount ELSE -amount END), 0) INTO v_net
    FROM public.center_ledger
   WHERE center_id = cid
     AND COALESCE(period_year, EXTRACT(YEAR FROM occurred_on)::int) = p_year;
  UPDATE public.center_fiscal_years
     SET status = 'closed', closing_balance = v_net, closed_at = now(), closed_by = auth.uid()
   WHERE id = v_row.id;
  -- السنة التالية تُفتح تلقائياً برصيد مرحّل (وإن كانت موجودة يُحدَّث رصيد أول المدة)
  INSERT INTO public.center_fiscal_years(center_id, fiscal_year, status, opening_balance)
  VALUES (cid, p_year + 1, 'open', v_net)
  ON CONFLICT (center_id, fiscal_year) DO UPDATE SET opening_balance = EXCLUDED.opening_balance;
END; $$;
GRANT EXECUTE ON FUNCTION public.close_fiscal_year(INT) TO authenticated;

-- ============================================================================
-- ١١) دعوات فريق العمل: صاحب السنتر يولّد كود دعوة (سكرتير/مدرس فقط —
--     المدير لا يُدعى إطلاقاً؛ صاحب السنتر هو المدير) والموظف يسجل بالكود.
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.staff_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  center_id UUID NOT NULL REFERENCES public.centers(id) ON DELETE CASCADE,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  phone TEXT,
  role TEXT NOT NULL CHECK (role IN ('teacher','secretary')),
  perms JSONB NOT NULL DEFAULT '{}'::jsonb,
  group_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','revoked')),
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_staff_invites_center ON public.staff_invites(center_id, created_at DESC);
ALTER TABLE public.staff_invites ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS invites_owner_all ON public.staff_invites;
CREATE POLICY invites_owner_all ON public.staff_invites FOR ALL TO authenticated
  USING (public.admin_owns_center(center_id))
  WITH CHECK (public.admin_owns_center(center_id) AND public.center_is_active(center_id));
DROP POLICY IF EXISTS invites_dev_all ON public.staff_invites;
CREATE POLICY invites_dev_all ON public.staff_invites FOR ALL TO authenticated
  USING ((SELECT role = 'super_admin' FROM public.profiles WHERE id = auth.uid()))
  WITH CHECK ((SELECT role = 'super_admin' FROM public.profiles WHERE id = auth.uid()));

-- معاينة كود الدعوة (قبل التسجيل — للموظف والزائر)
CREATE OR REPLACE FUNCTION public.get_invite_info(p_code TEXT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v RECORD;
BEGIN
  SELECT i.role AS invite_role, i.name AS invite_name, c.id AS center_id,
         c.name AS center_name, c.status AS center_status, i.status AS invite_status
    INTO v FROM public.staff_invites i JOIN public.centers c ON c.id = i.center_id
   WHERE i.code = upper(trim(p_code));
  IF NOT FOUND THEN RETURN jsonb_build_object('found', false); END IF;
  RETURN jsonb_build_object(
    'found', true,
    'suspended', v.center_status <> 'active',
    'usable', v.center_status = 'active' AND v.invite_status = 'pending',
    'center_id', v.center_id, 'center_name', v.center_name,
    'role', v.invite_role, 'name', v.invite_name);
END; $$;
GRANT EXECUTE ON FUNCTION public.get_invite_info(TEXT) TO anon, authenticated;

-- قبول الدعوة: حساب جديد بلا ملف → ملف فريق خامل (بانتظار تفعيل صاحب السنتر)
CREATE OR REPLACE FUNCTION public.accept_staff_invite(p_code TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_email TEXT;
  v RECORD;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF EXISTS (SELECT 1 FROM public.profiles WHERE id = v_uid) THEN
    RAISE EXCEPTION 'already_registered';
  END IF;
  SELECT * INTO v FROM public.staff_invites WHERE code = upper(trim(p_code)) FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'invite_not_found'; END IF;
  IF v.status <> 'pending' THEN RAISE EXCEPTION 'invite_unusable'; END IF;
  SELECT email INTO v_email FROM auth.users WHERE id = v_uid;
  IF v_email IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF (SELECT status FROM public.centers WHERE id = v.center_id) <> 'active' THEN
    RAISE EXCEPTION 'center_suspended';
  END IF;
  INSERT INTO public.profiles (id, role, center_id, full_name, email, phone, is_active, perms)
  VALUES (v_uid, v.role, v.center_id, v.name, v_email, v.phone, false, v.perms);
  UPDATE public.staff_invites SET status = 'accepted' WHERE id = v.id;
END; $$;
GRANT EXECUTE ON FUNCTION public.accept_staff_invite(TEXT) TO authenticated;