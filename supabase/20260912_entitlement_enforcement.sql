-- ============================================================================
--  Mr Center — فرض الاشتراكات والصلاحيات خادمياً + تنبيهات التجاوز (2026-09-12)
--  شغّل هذا الملف بعد android_multitenant_schema.sql و 20260912_security.sql
--  و 20260912_fiscal_accounting.sql و 20260911_safe_production_migration.sql
--  الملف idempotent: يمكن إعادة تشغيله بأمان. لا يحتوي على أي مفتاح سري.
--
--  ماذا يضيف:
--   ١) حدود الباقات تراعي «زيادة حدود الفريق» (center_entitlements) عند فحص
--      إضافة الموظفين — كانت الزيادة تُحفظ لكن لا تُطبَّق فعلياً.
--   ٢) سقف عدد الطلاب يُفرض خادمياً (كان يُفحص في التسجيل فقط).
--   ٣) عزل المدرسين: قراءة الطلاب/المستحقات/الدفعات/الحضور/الدرجات تُحصر
--      في مجموعات المدرس المسندة فقط (لا قراءة لسنتر كامل عبر API مباشرة).
--   ٤) سجل تنبيهات التجاوز + فحص دوري + حجب/إلغاء حجب حساب المتجاوز.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- ١) حدود فعالة لكل سنتر: الباقة + زيادات الفريق النشطة
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.effective_limits(p_center UUID)
RETURNS TABLE (max_teachers INT, max_secretaries INT, max_managers INT, max_students INT)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_kind  TEXT;
  v_plan  TEXT;
  v_t INT; v_s INT; v_m INT; v_stud INT;
  v_et INT; v_es INT; v_em INT;
BEGIN
  SELECT kind INTO v_kind FROM public.centers WHERE id = p_center;
  SELECT plan_type INTO v_plan FROM public.center_subscriptions
   WHERE center_id = p_center AND status = 'active'
   ORDER BY ends_on DESC NULLS LAST LIMIT 1;

  IF v_kind = 'solo' THEN
    v_t := 0; v_s := 0; v_m := 0; v_stud := 200;
  ELSIF v_plan = 'center_medium' THEN
    v_t := 2; v_s := 1; v_m := 0; v_stud := 300;
  ELSE
    -- center_full والتجريبية والمخصصة والقديمة: حدود الشاملة (طلاب غير محدود)
    v_t := 4; v_s := 2; v_m := 0; v_stud := 2147483647;
  END IF;

  SELECT
    COALESCE(SUM(CASE WHEN starts_on <= CURRENT_DATE AND (is_open_ended OR ends_on >= CURRENT_DATE)
                      THEN extra_teachers ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN starts_on <= CURRENT_DATE AND (is_open_ended OR ends_on >= CURRENT_DATE)
                      THEN extra_secretaries ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN starts_on <= CURRENT_DATE AND (is_open_ended OR ends_on >= CURRENT_DATE)
                      THEN extra_managers ELSE 0 END), 0)
  INTO v_et, v_es, v_em
  FROM public.center_entitlements
  WHERE center_id = p_center AND feature_key = 'staff_expansion';

  RETURN QUERY SELECT v_t + v_et, v_s + v_es, v_m + v_em, v_stud;
END; $$;
REVOKE ALL ON FUNCTION public.effective_limits(UUID) FROM PUBLIC;

-- ----------------------------------------------------------------------------
-- ٢) فحص حدود الفريق يراعي الزيادات (إعادة تعريف الدالة + المشغل)
-- ----------------------------------------------------------------------------
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
   WHERE center_id = NEW.center_id AND status = 'active'
   ORDER BY ends_on DESC NULLS LAST LIMIT 1;
  IF NEW.role = 'manager' THEN
    v_max := 0; -- لا مدير إضافي أبداً: المالك هو المدير الوحيد
  ELSIF NEW.role = 'secretary' THEN
    IF v_kind = 'solo' THEN v_max := 0;
    ELSIF v_plan = 'center_medium' THEN v_max := 1;
    ELSE v_max := 2; END IF;
  ELSE
    IF v_kind = 'solo' THEN v_max := 0;
    ELSIF v_plan = 'center_medium' THEN v_max := 2;
    ELSE v_max := 4; END IF;
  END IF;

  -- أضف زيادات الفريق النشطة (المدير يبقى صفراً دائماً)
  IF NEW.role = 'secretary' THEN
    v_max := v_max + (SELECT COALESCE(SUM(extra_secretaries),0) FROM public.center_entitlements
      WHERE center_id = NEW.center_id AND feature_key = 'staff_expansion'
        AND starts_on <= CURRENT_DATE AND (is_open_ended OR ends_on >= CURRENT_DATE));
  ELSIF NEW.role = 'teacher' THEN
    v_max := v_max + (SELECT COALESCE(SUM(extra_teachers),0) FROM public.center_entitlements
      WHERE center_id = NEW.center_id AND feature_key = 'staff_expansion'
        AND starts_on <= CURRENT_DATE AND (is_open_ended OR ends_on >= CURRENT_DATE));
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

-- ----------------------------------------------------------------------------
-- ٣) سقف عدد الطلاب خادمياً (center_medium: 300 — solo: 200 — full: غير محدود)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.student_limit_check()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_kind TEXT;
  v_plan TEXT;
  v_max INT;
  v_count INT;
BEGIN
  IF NEW.center_id IS NULL OR NEW.status IS DISTINCT FROM 'active' THEN RETURN NEW; END IF;
  SELECT kind INTO v_kind FROM public.centers WHERE id = NEW.center_id;
  SELECT plan_type INTO v_plan FROM public.center_subscriptions
   WHERE center_id = NEW.center_id AND status = 'active' ORDER BY ends_on DESC NULLS LAST LIMIT 1;
  IF v_kind = 'solo' THEN v_max := 200;
  ELSIF v_plan = 'center_medium' THEN v_max := 300;
  ELSE RETURN NEW; END IF; -- غير محدود

  SELECT count(*) INTO v_count FROM public.students
   WHERE center_id = NEW.center_id AND status = 'active' AND id IS DISTINCT FROM NEW.id;
  IF v_count >= v_max THEN
    RAISE EXCEPTION 'student_limit_reached';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_student_limit_check ON public.students;
CREATE TRIGGER trg_student_limit_check
  BEFORE INSERT OR UPDATE OF status ON public.students
  FOR EACH ROW EXECUTE FUNCTION public.student_limit_check();

-- ----------------------------------------------------------------------------
-- ٤) عزل المدرس: لا يقرأ إلا طلاب مجموعاته المسندة (المدير/السكرتير يقرآن السنتر)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.teacher_can_view_student(p_student TEXT, p_center UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    CASE WHEN public.my_role() = 'teacher' THEN
      public.teacher_is_active()
      AND p_center IS NOT NULL AND p_center = public.my_center_id()
      AND EXISTS (
        SELECT 1 FROM public.teacher_groups tg
        WHERE tg.teacher_id = auth.uid()::text AND tg.center_id = p_center
          AND EXISTS (
            SELECT 1 FROM public.students s
            WHERE s.id = p_student AND s.center_id = p_center
              AND (s.group_id = tg.group_id OR EXISTS (
                SELECT 1 FROM public.student_groups sg
                WHERE sg.student_id = s.id AND sg.group_id = tg.group_id
              ))
          )
      )
    ELSE
      public.teacher_center_ok(p_center)
    END;
$$;
GRANT EXECUTE ON FUNCTION public.teacher_can_view_student(TEXT, UUID) TO authenticated;

DROP POLICY IF EXISTS "students_teacher_read" ON public.students;
CREATE POLICY "students_teacher_read" ON public.students FOR SELECT TO authenticated
  USING (public.teacher_can_view_student(id, center_id));

DROP POLICY IF EXISTS "dues_teacher_read" ON public.dues;
CREATE POLICY "dues_teacher_read" ON public.dues FOR SELECT TO authenticated
  USING (public.teacher_can_view_student(student_id, center_id));

DROP POLICY IF EXISTS "payments_teacher_read" ON public.payments;
CREATE POLICY "payments_teacher_read" ON public.payments FOR SELECT TO authenticated
  USING (public.teacher_can_view_student(student_id, center_id));

DROP POLICY IF EXISTS "attendance_teacher_all" ON public.attendance;
CREATE POLICY "attendance_teacher_all" ON public.attendance FOR ALL TO authenticated
  USING (public.teacher_can_view_student(student_id, center_id))
  WITH CHECK (public.teacher_can_view_student(student_id, center_id));

DROP POLICY IF EXISTS "manual_grades_teacher_all" ON public.manual_grades;
CREATE POLICY "manual_grades_teacher_all" ON public.manual_grades FOR ALL TO authenticated
  USING (public.teacher_can_view_student(student_id, center_id))
  WITH CHECK (public.teacher_can_view_student(student_id, center_id));

-- ----------------------------------------------------------------------------
-- ٥) سجل تنبيهات تجاوز حدود الاشتراك (لوحة إدارة المشتركين)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.center_usage_alerts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  center_id   UUID NOT NULL REFERENCES public.centers(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('teachers_over_limit','secretaries_over_limit','managers_over_limit','students_over_limit')),
  title       TEXT NOT NULL,
  detail      JSONB NOT NULL DEFAULT '{}'::jsonb,
  status      TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved')),
  resolution  TEXT CHECK (resolution IN ('auto','blocked','manual')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  UNIQUE (center_id, kind)
);
CREATE INDEX IF NOT EXISTS idx_usage_alerts_status ON public.center_usage_alerts(status);
ALTER TABLE public.center_usage_alerts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS usage_alerts_dev_all ON public.center_usage_alerts;
CREATE POLICY usage_alerts_dev_all ON public.center_usage_alerts FOR ALL TO authenticated
  USING (public.my_role() = 'super_admin') WITH CHECK (public.my_role() = 'super_admin');

-- يرفع/يحل التنبيه حسب الحالة الفعلية (يُستدعى من الفحص الدوري فقط)
CREATE OR REPLACE FUNCTION public.upsert_usage_alert(
  p_center UUID, p_kind TEXT, p_title TEXT, p_detail JSONB, p_over BOOLEAN
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_over THEN
    INSERT INTO public.center_usage_alerts(center_id, kind, title, detail, status)
    VALUES (p_center, p_kind, p_title, p_detail, 'open')
    ON CONFLICT (center_id, kind) DO UPDATE
      SET title = EXCLUDED.title, detail = EXCLUDED.detail,
          status = 'open', resolution = NULL, resolved_at = NULL,
          created_at = now();
  ELSE
    UPDATE public.center_usage_alerts
      SET status = 'resolved', resolution = 'auto', resolved_at = now()
     WHERE center_id = p_center AND kind = p_kind AND status = 'open';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.upsert_usage_alert(UUID, TEXT, TEXT, JSONB, BOOLEAN) FROM PUBLIC;

-- الفحص الدوري: يقارن الاستخدام الفعلي بالحدود ويحدّث التنبيهات (المطور فقط)
CREATE OR REPLACE FUNCTION public.audit_center_usage()
RETURNS SETOF public.center_usage_alerts
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  c  RECORD;
  lim RECORD;
  cnt INT;
BEGIN
  IF public.my_role() <> 'super_admin' THEN RAISE EXCEPTION 'not_allowed'; END IF;
  FOR c IN SELECT id, name FROM public.centers LOOP
    SELECT * INTO lim FROM public.effective_limits(c.id);

    SELECT count(*) INTO cnt FROM public.profiles
     WHERE center_id = c.id AND role = 'teacher' AND is_active;
    PERFORM public.upsert_usage_alert(c.id, 'teachers_over_limit', 'تجاوز عدد المدرسين',
      jsonb_build_object('used', cnt, 'limit', lim.max_teachers), cnt > lim.max_teachers);

    SELECT count(*) INTO cnt FROM public.profiles
     WHERE center_id = c.id AND role = 'secretary' AND is_active;
    PERFORM public.upsert_usage_alert(c.id, 'secretaries_over_limit', 'تجاوز عدد السكرتارية',
      jsonb_build_object('used', cnt, 'limit', lim.max_secretaries), cnt > lim.max_secretaries);

    SELECT count(*) INTO cnt FROM public.profiles
     WHERE center_id = c.id AND role = 'manager' AND is_active;
    PERFORM public.upsert_usage_alert(c.id, 'managers_over_limit', 'تجاوز عدد المديرين',
      jsonb_build_object('used', cnt, 'limit', lim.max_managers), cnt > lim.max_managers);

    SELECT count(*) INTO cnt FROM public.students
     WHERE center_id = c.id AND status = 'active';
    PERFORM public.upsert_usage_alert(c.id, 'students_over_limit', 'تجاوز عدد الطلاب',
      jsonb_build_object('used', cnt, 'limit', lim.max_students),
      lim.max_students < 2147483647 AND cnt > lim.max_students);
  END LOOP;

  RETURN QUERY SELECT * FROM public.center_usage_alerts ORDER BY created_at DESC;
END;
$$;
GRANT EXECUTE ON FUNCTION public.audit_center_usage() TO authenticated;

-- قائمة التنبيهات (المفتوحة ثم الحديثة) مع اسم/كود السنتر (المطور فقط)
CREATE OR REPLACE FUNCTION public.list_center_alerts()
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_result JSONB;
BEGIN
  IF public.my_role() <> 'super_admin' THEN RAISE EXCEPTION 'not_allowed'; END IF;
  SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.open_first DESC, t.created_at DESC), '[]'::jsonb)
  INTO v_result
  FROM (
    SELECT a.id, a.center_id, c.name AS center_name, c.code AS center_code,
           a.kind, a.title, a.detail, a.status, a.resolution, a.created_at, a.resolved_at,
           (a.status = 'open') AS open_first
    FROM public.center_usage_alerts a
    JOIN public.centers c ON c.id = a.center_id
    ORDER BY (a.status = 'open') DESC, a.created_at DESC
    LIMIT 200
  ) t;
  RETURN v_result;
END; $$;
GRANT EXECUTE ON FUNCTION public.list_center_alerts() TO authenticated;

-- حجب حساب متجاوز: إيقاف السنتر والاشتراك وحل التنبيهات (المطور فقط)
CREATE OR REPLACE FUNCTION public.dev_block_center(p_center UUID)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF public.my_role() <> 'super_admin' THEN RAISE EXCEPTION 'not_allowed'; END IF;
  UPDATE public.centers SET status = 'suspended' WHERE id = p_center;
  UPDATE public.center_subscriptions SET status = 'suspended'
   WHERE center_id = p_center AND status = 'active';
  UPDATE public.center_usage_alerts
     SET status = 'resolved', resolution = 'blocked', resolved_at = now()
   WHERE center_id = p_center AND status = 'open';
END;
$$;
GRANT EXECUTE ON FUNCTION public.dev_block_center(UUID) TO authenticated;

-- إلغاء الحجب (المطور فقط)
CREATE OR REPLACE FUNCTION public.dev_unblock_center(p_center UUID)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF public.my_role() <> 'super_admin' THEN RAISE EXCEPTION 'not_allowed'; END IF;
  UPDATE public.centers SET status = 'active' WHERE id = p_center;
END;
$$;
GRANT EXECUTE ON FUNCTION public.dev_unblock_center(UUID) TO authenticated;

COMMIT;
