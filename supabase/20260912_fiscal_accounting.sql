-- ============================================================================
--  Mr Center — السنة المالية + بوابة المحاسبة المدفوعة
--  التاريخ: 2026-09-12
--  شغّل هذا الملف بعد android_multitenant_schema.sql و 20260911_safe_production_migration.sql
--  الملف idempotent: يمكن إعادة تشغيله بأمان (IF NOT EXISTS / OR REPLACE).
--  لا يحتوي على service_role أو أي مفتاح سري.
--
--  ماذا يضيف:
--   ١) center_fiscal_years: فتح/إغلاق السنة المالية لكل سنتر + ترحيل الرصيد الافتتاحي.
--   ٢) بوابة المحاسبة كخدمة مدفوعة يفعّلها المطور لكل سنتر على حدة:
--      - الإيرادات تُسجل تلقائياً في الخلفية دائماً (trigger قائم في مخطط سابق).
--      - العهدة تُعتمد تلقائياً كأنها سليمة عندما تكون الخدمة غير مفعلة.
--      - قسم المصروفات/المحاسبة لا يظهر لصاحب السنتر غير المشترك إلا بعد التفعيل،
--        وعند التفعيل لاحقاً يجد كل الحسابات جاهزة من بداية اشتراكه.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- ١) جدول السنوات المالية
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.center_fiscal_years (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  center_id uuid NOT NULL REFERENCES public.centers(id) ON DELETE CASCADE,
  year_label text NOT NULL,
  starts_on date NOT NULL,
  ends_on date,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  opening_balance numeric(12,2) NOT NULL DEFAULT 0,
  opening_pending_dues numeric(12,2) NOT NULL DEFAULT 0,
  closing_income numeric(12,2),
  closing_expense numeric(12,2),
  closing_balance numeric(12,2),
  closing_pending_dues numeric(12,2),
  opened_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  UNIQUE(center_id, year_label)
);
CREATE INDEX IF NOT EXISTS idx_fiscal_years_center ON public.center_fiscal_years(center_id, starts_on DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_fiscal_year_open ON public.center_fiscal_years(center_id) WHERE status = 'open';

ALTER TABLE public.center_fiscal_years ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS fiscal_owner_all ON public.center_fiscal_years;
CREATE POLICY fiscal_owner_all ON public.center_fiscal_years FOR ALL TO authenticated
  USING (public.admin_owns_center(center_id)) WITH CHECK (public.admin_owns_center(center_id));
DROP POLICY IF EXISTS fiscal_developer_all ON public.center_fiscal_years;
CREATE POLICY fiscal_developer_all ON public.center_fiscal_years FOR ALL TO authenticated
  USING (public.my_role() = 'super_admin') WITH CHECK (public.my_role() = 'super_admin');

-- ----------------------------------------------------------------------------
-- ٢) توابع السنة الدراسية (سبتمبر → أغسطس)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.academic_year_start(p_date timestamptz DEFAULT now())
RETURNS DATE LANGUAGE sql STABLE AS $$
  SELECT make_date(
    (EXTRACT(YEAR FROM p_date)::int) - CASE WHEN EXTRACT(MONTH FROM p_date)::int < 9 THEN 1 ELSE 0 END,
    9, 1);
$$;

CREATE OR REPLACE FUNCTION public.academic_year_label(p_date timestamptz DEFAULT now())
RETURNS TEXT LANGUAGE sql STABLE AS $$
  SELECT
    ((EXTRACT(YEAR FROM p_date)::int) - CASE WHEN EXTRACT(MONTH FROM p_date)::int < 9 THEN 1 ELSE 0 END)::text
    || '/' ||
    ((EXTRACT(YEAR FROM p_date)::int) - CASE WHEN EXTRACT(MONTH FROM p_date)::int < 9 THEN 1 ELSE 0 END + 1)::text;
$$;

-- فتح سنة مالية تلقائياً إن لم توجد سنة مفتوحة (دالة داخلية — لا تُمنح للعموم)
CREATE OR REPLACE FUNCTION public.ensure_open_fiscal_year(p_center UUID)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id UUID; v_start DATE := public.academic_year_start(now());
BEGIN
  SELECT id INTO v_id FROM public.center_fiscal_years WHERE center_id = p_center AND status = 'open' LIMIT 1;
  IF v_id IS NULL THEN
    INSERT INTO public.center_fiscal_years(center_id, year_label, starts_on, ends_on, status)
    VALUES(p_center, public.academic_year_label(now()), v_start, v_start + interval '1 year' - interval '1 day', 'open')
    ON CONFLICT (center_id, year_label) DO NOTHING
    RETURNING id INTO v_id;
    IF v_id IS NULL THEN
      SELECT id INTO v_id FROM public.center_fiscal_years WHERE center_id = p_center AND status = 'open' LIMIT 1;
    END IF;
  END IF;
  RETURN v_id;
END; $$;
REVOKE ALL ON FUNCTION public.ensure_open_fiscal_year(UUID) FROM PUBLIC;

-- كل سنتر جديد يبدأ بسنة مالية مفتوحة تلقائياً
CREATE OR REPLACE FUNCTION public.trg_center_fiscal_year()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.ensure_open_fiscal_year(NEW.id);
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_center_fiscal_year ON public.centers;
CREATE TRIGGER trg_center_fiscal_year AFTER INSERT ON public.centers FOR EACH ROW EXECUTE FUNCTION public.trg_center_fiscal_year();

-- ترحيل خلفي: السناتر القائمة بلا سنة مالية تحصل على سنة مفتوحة حالياً
INSERT INTO public.center_fiscal_years(center_id, year_label, starts_on, ends_on, status)
SELECT c.id, public.academic_year_label(now()), public.academic_year_start(now()),
       public.academic_year_start(now()) + interval '1 year' - interval '1 day', 'open'
FROM public.centers c
WHERE NOT EXISTS (SELECT 1 FROM public.center_fiscal_years y WHERE y.center_id = c.id)
ON CONFLICT (center_id, year_label) DO NOTHING;

-- ----------------------------------------------------------------------------
-- ٣) بوابة المحاسبة كخدمة مدفوعة (تُدار من لوحة المطور لكل سنتر)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.center_accounting_enabled(p_center UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    COALESCE((
      SELECT (enabled_features ->> 'accounting')::boolean
      FROM public.center_subscriptions
      WHERE center_id = p_center AND status = 'active'
        AND starts_on <= CURRENT_DATE
        AND ends_on >= CURRENT_DATE
      ORDER BY ends_on DESC NULLS LAST LIMIT 1
    ), false)
    OR EXISTS (
      SELECT 1 FROM public.center_entitlements
      WHERE center_id = p_center AND feature_key = 'accounting'
        AND starts_on <= CURRENT_DATE AND (is_open_ended OR ends_on >= CURRENT_DATE)
    );
$$;
REVOKE ALL ON FUNCTION public.center_accounting_enabled(UUID) FROM PUBLIC;

-- مزايا المستخدم الحالي (تقول للويب هل المحاسبة ظاهرة أم تعمل في الخلفية فقط)
CREATE OR REPLACE FUNCTION public.get_my_features()
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_role TEXT; v_center UUID;
BEGIN
  SELECT role, center_id INTO v_role, v_center FROM public.profiles WHERE id = auth.uid();
  IF v_role = 'super_admin' THEN RETURN jsonb_build_object('accounting', true); END IF;
  IF v_center IS NULL THEN RETURN jsonb_build_object('accounting', false); END IF;
  RETURN jsonb_build_object('accounting', public.center_accounting_enabled(v_center));
END; $$;
GRANT EXECUTE ON FUNCTION public.get_my_features() TO authenticated;

-- تفعيل/إيقاف المحاسبة لسنتر محدد (المطور فقط)
CREATE OR REPLACE FUNCTION public.dev_set_accounting(p_center UUID, p_enabled BOOLEAN)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF (SELECT role FROM public.profiles WHERE id = auth.uid()) IS DISTINCT FROM 'super_admin' THEN
    RAISE EXCEPTION 'not_allowed';
  END IF;
  IF p_enabled THEN
    INSERT INTO public.center_entitlements(center_id, extra_teachers, extra_secretaries, extra_managers, feature_key, starts_on, ends_on, is_open_ended, created_by)
    VALUES(p_center, 0, 0, 0, 'accounting', CURRENT_DATE, NULL, true, auth.uid())
    ON CONFLICT (center_id, feature_key) DO UPDATE
      SET starts_on = EXCLUDED.starts_on, ends_on = NULL, is_open_ended = true, created_by = auth.uid();
    UPDATE public.center_subscriptions SET enabled_features = enabled_features || '{"accounting": true}'::jsonb
    WHERE center_id = p_center AND status = 'active';
  ELSE
    DELETE FROM public.center_entitlements WHERE center_id = p_center AND feature_key = 'accounting';
    UPDATE public.center_subscriptions SET enabled_features = enabled_features - 'accounting'
    WHERE center_id = p_center AND status = 'active';
  END IF;
END; $$;
GRANT EXECUTE ON FUNCTION public.dev_set_accounting(UUID, BOOLEAN) TO authenticated;

-- ----------------------------------------------------------------------------
-- ٤) سنوات المستخدم الحالي + إغلاق سنة وفتح سنة جديدة مع الترحيل
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_my_fiscal_years()
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_role TEXT; v_center UUID; v_result JSONB;
BEGIN
  SELECT role, center_id INTO v_role, v_center FROM public.profiles WHERE id = auth.uid();
  IF v_role NOT IN ('center_admin','super_admin') OR v_center IS NULL THEN RETURN '[]'::jsonb; END IF;
  IF v_role = 'center_admin' AND NOT public.center_accounting_enabled(v_center) THEN
    -- لا تُعرض أي بيانات مالية بعد الانتهاء، لكن لا نرفع HTTP 400 متوقعاً
    -- من صفحات الإعدادات/التعريف التي قد تستدعي القائمة قبل بوابة الواجهة.
    RETURN '[]'::jsonb;
  END IF;
  SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.starts_on DESC), '[]'::jsonb) INTO v_result
  FROM (
    SELECT id, center_id, year_label, starts_on, ends_on, status,
           opening_balance, opening_pending_dues, closing_income, closing_expense,
           closing_balance, closing_pending_dues, opened_at, closed_at
    FROM public.center_fiscal_years WHERE center_id = v_center
  ) t;
  RETURN v_result;
END; $$;
GRANT EXECUTE ON FUNCTION public.get_my_fiscal_years() TO authenticated;

-- سنوات سنتر محدد (المطور فقط — للمراجعة من لوحة المطور)
CREATE OR REPLACE FUNCTION public.get_center_fiscal_years(p_center UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_result JSONB;
BEGIN
  IF (SELECT role FROM public.profiles WHERE id = auth.uid()) IS DISTINCT FROM 'super_admin' THEN
    RAISE EXCEPTION 'not_allowed';
  END IF;
  SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.starts_on DESC), '[]'::jsonb) INTO v_result
  FROM (
    SELECT id, center_id, year_label, starts_on, ends_on, status,
           opening_balance, opening_pending_dues, closing_income, closing_expense,
           closing_balance, closing_pending_dues, opened_at, closed_at
    FROM public.center_fiscal_years WHERE center_id = p_center
  ) t;
  RETURN v_result;
END; $$;
GRANT EXECUTE ON FUNCTION public.get_center_fiscal_years(UUID) TO authenticated;

-- إغلاق السنة المالية الحالية وفتح السنة التالية مع ترحيل الرصيد الافتتاحي
-- والمستحقات المعلقة. تُحسب الإيرادات/المصروفات من دفتر الحسابات داخل نطاق السنة.
CREATE OR REPLACE FUNCTION public.close_fiscal_year(p_center UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_year public.center_fiscal_years%ROWTYPE;
  v_income numeric(12,2) := 0;
  v_expense numeric(12,2) := 0;
  v_balance numeric(12,2) := 0;
  v_pending numeric(12,2) := 0;
  v_label TEXT;
  v_next_start DATE;
  v_next_end DATE;
BEGIN
  IF (SELECT role FROM public.profiles WHERE id = auth.uid()) IS DISTINCT FROM 'super_admin'
     AND (SELECT role FROM public.profiles WHERE id = auth.uid()) IS DISTINCT FROM 'center_admin' THEN
    RAISE EXCEPTION 'not_allowed';
  END IF;
  IF (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'center_admin'
     AND (SELECT center_id FROM public.profiles WHERE id = auth.uid()) IS DISTINCT FROM p_center THEN
    RAISE EXCEPTION 'not_allowed';
  END IF;

  SELECT * INTO v_year FROM public.center_fiscal_years
   WHERE center_id = p_center AND status = 'open' LIMIT 1;
  IF v_year.id IS NULL THEN
    PERFORM public.ensure_open_fiscal_year(p_center);
    SELECT * INTO v_year FROM public.center_fiscal_years
     WHERE center_id = p_center AND status = 'open' LIMIT 1;
  END IF;

  v_year.ends_on := COALESCE(v_year.ends_on, CURRENT_DATE);

  SELECT COALESCE(SUM(amount), 0) INTO v_income FROM public.center_ledger
   WHERE center_id = p_center AND kind = 'income' AND occurred_on BETWEEN v_year.starts_on AND v_year.ends_on;
  SELECT COALESCE(SUM(amount), 0) INTO v_expense FROM public.center_ledger
   WHERE center_id = p_center AND kind = 'expense' AND occurred_on BETWEEN v_year.starts_on AND v_year.ends_on;
  v_balance := v_year.opening_balance + v_income - v_expense;
  SELECT COALESCE(SUM(amount), 0) INTO v_pending FROM public.dues
   WHERE center_id = p_center AND status IN ('pending','partial')
     AND make_date(due_year, month, 1) BETWEEN v_year.starts_on AND v_year.ends_on;

  UPDATE public.center_fiscal_years
   SET status = 'closed', ends_on = v_year.ends_on,
       closing_income = v_income, closing_expense = v_expense,
       closing_balance = v_balance, closing_pending_dues = v_pending,
       closed_at = now()
   WHERE id = v_year.id;

  v_next_start := v_year.ends_on + 1;
  v_next_end := v_next_start + interval '1 year' - interval '1 day';
  v_label := (EXTRACT(YEAR FROM v_next_start)::int)::text || '/' || (EXTRACT(YEAR FROM v_next_end)::int)::text;

  INSERT INTO public.center_fiscal_years(center_id, year_label, starts_on, ends_on, status, opening_balance, opening_pending_dues)
  VALUES(p_center, v_label, v_next_start, v_next_end, 'open', v_balance, v_pending)
  ON CONFLICT (center_id, year_label) DO NOTHING;

  RETURN jsonb_build_object(
    'closed', v_year.year_label,
    'opened', v_label,
    'carry_balance', v_balance,
    'carry_pending', v_pending
  );
END; $$;
GRANT EXECUTE ON FUNCTION public.close_fiscal_year(UUID) TO authenticated;

-- ----------------------------------------------------------------------------
-- ٥) العهدة: التحصيل والتسليم عمليتان تشغيليتان تستمران حتى عند انتهاء
-- الاشتراك، لكن لا يجوز وصف عجز حقيقي بأنه «مطابق». تسوية العجز المالية نفسها
-- تبقى داخل بوابة المحاسبة وتتاح فور التجديد مع الاحتفاظ بكل الفروق المسجلة.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.submit_staff_custody(p_staff UUID, p_date DATE, p_delivered NUMERIC, p_notes TEXT DEFAULT '')
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE cid UUID; expected NUMERIC; result UUID; v_status TEXT;
  v_date DATE := COALESCE(p_date, CURRENT_DATE); v_delivered NUMERIC := COALESCE(p_delivered, -1);
BEGIN
  SELECT center_id INTO cid FROM public.profiles WHERE id = auth.uid() AND role IN ('manager','secretary') AND is_active;
  IF cid IS NULL OR p_staff <> auth.uid() THEN RAISE EXCEPTION 'not_allowed'; END IF;
  IF v_delivered < 0 THEN RAISE EXCEPTION 'invalid_custody_amount'; END IF;
  SELECT COALESCE(SUM(amount), 0) INTO expected FROM public.center_ledger
   WHERE center_id = cid AND created_by = p_staff AND entry_type = 'payment_collection' AND occurred_on = v_date;
  v_status := CASE WHEN v_delivered = expected THEN 'matched' WHEN v_delivered < expected THEN 'shortage' ELSE 'surplus' END;
  INSERT INTO public.staff_custody(center_id, staff_id, custody_date, expected_amount, delivered_amount, status, notes, submitted_at, submitted_by)
  VALUES(cid, p_staff, v_date, expected, v_delivered, v_status, COALESCE(p_notes, ''), now(), auth.uid())
  ON CONFLICT(center_id, staff_id, custody_date) DO UPDATE
   SET expected_amount = EXCLUDED.expected_amount, delivered_amount = EXCLUDED.delivered_amount,
       status = EXCLUDED.status, notes = EXCLUDED.notes, submitted_at = now(), submitted_by = auth.uid()
  RETURNING id INTO result;
  RETURN result;
END; $$;
GRANT EXECUTE ON FUNCTION public.submit_staff_custody(UUID, DATE, NUMERIC, TEXT) TO authenticated;

COMMIT;

-- بعد التشغيل:
--   تحقق من وجود سنة مفتوحة لكل سنتر: SELECT * FROM public.center_fiscal_years;
--   وجرّب إغلاق سنة من لوحة السنتر أو من المطور، ثم تأكد من ترحيل الرصيد للسنة الجديدة.

-- ============================================================================
--  ترقية إضافية (2026-09-12): منع تجاوز مدة الاشتراك + عداد الزوار
-- ============================================================================

BEGIN;

-- هل اشتراك السنتر ساري حالياً؟ (التاريخ خادمي — لا يتأثر بساعة جهاز العميل)
CREATE OR REPLACE FUNCTION public.center_subscription_active(cid UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.center_subscriptions
    WHERE center_id = cid AND status = 'active'
      AND (starts_on IS NULL OR starts_on <= CURRENT_DATE)
      AND ends_on >= CURRENT_DATE
  );
$$;

-- ترقية center_is_active: الكتابة تتطلب اشتراكاً سارياً (الإيقاف أو انتهاء المدة = حجب الكتابة خادمياً)
CREATE OR REPLACE FUNCTION public.center_is_active(cid UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.centers WHERE id = cid AND status = 'active')
     AND public.center_subscription_active(cid);
$$;

-- فريق العمل: نفس شرط سريان الاشتراك
CREATE OR REPLACE FUNCTION public.teacher_center_ok(cid UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.teacher_is_active() AND cid IS NOT NULL AND cid = public.my_center_id()
     AND public.center_subscription_active(cid);
$$;

-- استثناء: صاحب السنتر يمكنه التواصل مع الدعم وطلب التجديد حتى بعد انتهاء الاشتراك
DROP POLICY IF EXISTS "support_owner_insert" ON public.support_messages;
CREATE POLICY "support_owner_insert" ON public.support_messages FOR INSERT TO authenticated
  WITH CHECK (public.admin_owns_center(center_id) AND sender_role = 'owner');

DROP POLICY IF EXISTS "subreq_owner_all" ON public.subscription_requests;
CREATE POLICY "subreq_owner_all" ON public.subscription_requests FOR ALL TO authenticated
  USING (public.my_role() = 'center_admin' AND center_id = public.my_center_id())
  WITH CHECK (public.my_role() = 'center_admin' AND center_id = public.my_center_id()
              AND status = 'pending');

-- ----------------------------------------------------------------------------
-- عداد الزوار: كل جهاز رقم فريد يُسجل مرة واحدة فقط (لا يُعدّ تصفح الصفحات زيارات)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.site_visitors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id text NOT NULL UNIQUE,
  first_seen timestamptz NOT NULL DEFAULT now(),
  last_seen timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.site_visitors ENABLE ROW LEVEL SECURITY;

-- تسجيل زيارة: يُنشئ الصف مرة واحدة لكل جهاز، ويحدّث last_seen مرة كل ساعة على الأكثر
CREATE OR REPLACE FUNCTION public.track_site_visit(p_device_id text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_device_id IS NULL OR length(p_device_id) < 8 OR length(p_device_id) > 128 THEN RETURN; END IF;
  INSERT INTO public.site_visitors(device_id, first_seen, last_seen)
  VALUES(p_device_id, now(), now())
  ON CONFLICT (device_id) DO UPDATE
    SET last_seen = now()
    WHERE public.site_visitors.last_seen < now() - interval '1 hour';
END; $$;
GRANT EXECUTE ON FUNCTION public.track_site_visit(text) TO anon, authenticated;

-- إحصاءات الزوار (المطور فقط)
CREATE OR REPLACE FUNCTION public.get_site_visitor_stats()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE total bigint; today bigint; week bigint;
BEGIN
  IF (SELECT role FROM public.profiles WHERE id = auth.uid()) IS DISTINCT FROM 'super_admin' THEN
    RAISE EXCEPTION 'not_allowed';
  END IF;
  SELECT count(*) INTO total FROM public.site_visitors;
  SELECT count(*) INTO today FROM public.site_visitors WHERE last_seen >= date_trunc('day', now());
  SELECT count(*) INTO week FROM public.site_visitors WHERE last_seen >= now() - interval '7 days';
  RETURN jsonb_build_object('total', total, 'today', today, 'week', week);
END; $$;
GRANT EXECUTE ON FUNCTION public.get_site_visitor_stats() TO authenticated;

COMMIT;

-- ============================================================================
--  ترقية (2026-09-12): حجب الأجهزة من لوحة المطور
--  معرّف الجهاز يُسجَّل دائماً (بغض النظر عن التفضيلات) لأغراض أمنية،
--  ويمكن للمطور حجب/إلغاء حجب أي جهاز من لوحة المطور.
-- ============================================================================

BEGIN;

ALTER TABLE public.site_visitors ADD COLUMN IF NOT EXISTS blocked boolean NOT NULL DEFAULT false;

-- المطور يفعّل/يلغي حجب جهاز
CREATE OR REPLACE FUNCTION public.dev_set_device_blocked(p_device_id text, p_blocked boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF (SELECT role FROM public.profiles WHERE id = auth.uid()) IS DISTINCT FROM 'super_admin' THEN
    RAISE EXCEPTION 'not_allowed';
  END IF;
  UPDATE public.site_visitors SET blocked = p_blocked WHERE device_id = p_device_id;
END; $$;
GRANT EXECUTE ON FUNCTION public.dev_set_device_blocked(text, boolean) TO authenticated;

-- قائمة أحدث الأجهزة (المطور فقط)
CREATE OR REPLACE FUNCTION public.dev_list_visitors()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_result jsonb;
BEGIN
  IF (SELECT role FROM public.profiles WHERE id = auth.uid()) IS DISTINCT FROM 'super_admin' THEN
    RAISE EXCEPTION 'not_allowed';
  END IF;
  SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.last_seen DESC), '[]'::jsonb) INTO v_result
  FROM (
    SELECT id, device_id, first_seen, last_seen, blocked
    FROM public.site_visitors
    ORDER BY last_seen DESC LIMIT 200
  ) t;
  RETURN v_result;
END; $$;
GRANT EXECUTE ON FUNCTION public.dev_list_visitors() TO authenticated;

COMMIT;

-- فحص حجب الجهاز (متاح للجميع — لتطبيق المنع عند فتح الموقع)
CREATE OR REPLACE FUNCTION public.is_device_blocked(p_device_id text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.site_visitors WHERE device_id = p_device_id AND blocked);
$$;
GRANT EXECUTE ON FUNCTION public.is_device_blocked(text) TO anon, authenticated;
