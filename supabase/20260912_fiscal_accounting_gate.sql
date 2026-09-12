-- ============================================================================
--  Mr Center — بوابة المحاسبة المدفوعة على مستوى قاعدة البيانات (2026-09-12)
--  تُشغَّل بعد 20260912_fiscal_accounting.sql (تعتمد على center_accounting_enabled).
--  Idempotent — آمن لإعادة التشغيل.
--
--  المشكلة: سياسات الدفتر/العهدة/العمولات كانت تسمح لصاحب السنتر بالكتابة
--  والقراءة المباشرة حتى لو لم تكن خدمة المحاسبة (المدفوعة) مفعّلة له.
--  هنا تُربط السياسات بدالة center_accounting_enabled فلا يمكن تجاوز الاشتراك
--  من خلال استدعاء API مباشر — الحماية على الخادم لا على الواجهة فقط.
-- ============================================================================

BEGIN;

-- RLS تشغّل التعبير بصلاحيات المستخدم، لذا يجب السماح للمصادقين باستدعاء الدالة
GRANT EXECUTE ON FUNCTION public.center_accounting_enabled(UUID) TO authenticated;

-- ----------------------------------------------------------------------------
-- ١) الدفتر العام (center_ledger): قراءة وكتابة فقط للمالك والخدمة مفعّلة
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS ledger_owner_all ON public.center_ledger;
CREATE POLICY ledger_owner_all ON public.center_ledger FOR ALL TO authenticated
  USING (public.admin_owns_center(center_id) AND public.center_accounting_enabled(center_id))
  WITH CHECK (public.admin_owns_center(center_id) AND public.center_accounting_enabled(center_id));

-- ----------------------------------------------------------------------------
-- ٢) عهدة الموظفين (staff_custody): مراجعة المالك مشروطة بالخدمة
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS custody_owner_all ON public.staff_custody;
CREATE POLICY custody_owner_all ON public.staff_custody FOR ALL TO authenticated
  USING (public.admin_owns_center(center_id) AND public.center_accounting_enabled(center_id))
  WITH CHECK (public.admin_owns_center(center_id) AND public.center_accounting_enabled(center_id));

-- ----------------------------------------------------------------------------
-- ٣) قواعد العمولات (staff_commission_rules)
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS commission_owner_all ON public.staff_commission_rules;
CREATE POLICY commission_owner_all ON public.staff_commission_rules FOR ALL TO authenticated
  USING (public.admin_owns_center(center_id) AND public.center_accounting_enabled(center_id))
  WITH CHECK (public.admin_owns_center(center_id) AND public.center_accounting_enabled(center_id));

-- ----------------------------------------------------------------------------
-- ٤) السنوات المالية (center_fiscal_years)
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS fiscal_owner_all ON public.center_fiscal_years;
CREATE POLICY fiscal_owner_all ON public.center_fiscal_years FOR ALL TO authenticated
  USING (public.admin_owns_center(center_id) AND public.center_accounting_enabled(center_id))
  WITH CHECK (public.admin_owns_center(center_id) AND public.center_accounting_enabled(center_id));

-- ----------------------------------------------------------------------------
-- ٥) دوال RPC المعرّضة للمالك: إعادة تعريفها بشرط الخدمة المفعّلة
-- ----------------------------------------------------------------------------
-- مراجعة عهدة الموظف (المالك) — كان الشرط admin_owns_center فقط
CREATE OR REPLACE FUNCTION public.review_staff_custody(p_id uuid, p_status text, p_notes text DEFAULT '')
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_center uuid;
BEGIN
  IF p_status NOT IN ('matched','shortage','surplus','open') THEN RAISE EXCEPTION 'invalid_status'; END IF;
  SELECT center_id INTO v_center FROM public.staff_custody WHERE id = p_id;
  IF v_center IS NULL OR NOT public.admin_owns_center(v_center)
     OR NOT public.center_accounting_enabled(v_center) THEN
    RAISE EXCEPTION 'not_allowed';
  END IF;
  UPDATE public.staff_custody
     SET status = p_status,
         notes = CASE WHEN p_notes = '' THEN notes ELSE p_notes END,
         reviewed_at = now(),
         reviewed_by = auth.uid()
   WHERE id = p_id;
END; $$;
GRANT EXECUTE ON FUNCTION public.review_staff_custody(uuid,text,text) TO authenticated;

-- حساب عمولة موظف (المالك) — يُشترط أن تكون المحاسبة مفعّلة لسنتره
CREATE OR REPLACE FUNCTION public.calculate_staff_commission(p_staff uuid, p_from date, p_to date)
RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  cid uuid; rate numeric; total numeric;
BEGIN
  SELECT center_id INTO cid FROM public.profiles WHERE id=auth.uid()
    AND (role='super_admin' OR (role='center_admin' AND center_id=(SELECT center_id FROM public.profiles WHERE id=p_staff)));
  IF cid IS NULL OR (public.my_role() = 'center_admin' AND NOT public.center_accounting_enabled(cid)) THEN
    RAISE EXCEPTION 'not_allowed';
  END IF;
  SELECT coalesce((SELECT rate FROM public.staff_commission_rules
                    WHERE staff_id=p_staff AND center_id=cid AND is_active
                      AND starts_on<=p_to AND (ends_on IS NULL OR ends_on>=p_from) LIMIT 1), 0)
    INTO rate;
  SELECT coalesce(sum(amount),0) INTO total FROM public.center_ledger
   WHERE center_id=cid AND created_by=p_staff AND entry_type='payment_collection'
     AND occurred_on BETWEEN p_from AND p_to;
  RETURN round(total*rate/100,2);
END; $$;
GRANT EXECUTE ON FUNCTION public.calculate_staff_commission(uuid,date,date) TO authenticated;

COMMIT;
