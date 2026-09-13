-- ============================================================================
-- Mr Center — صلاحية المحاسبة حسب فترة الاشتراك الفعلية
-- التاريخ: 2026-09-13
-- شغّل بعد 20260912_fiscal_accounting.sql في القواعد التي شغّلت النسخة الأقدم.
-- آمن لإعادة التشغيل.
-- ============================================================================

BEGIN;

-- حالة "active" وحدها ليست ترخيصاً سارياً: لا تظهر المحاسبة ولا تقبل RPCs
-- إلا داخل فترة الاشتراك. الترخيص الخاص (entitlement) يتبع فترته أيضاً.
CREATE OR REPLACE FUNCTION public.center_accounting_enabled(p_center UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    COALESCE((
      SELECT (enabled_features ->> 'accounting')::boolean
      FROM public.center_subscriptions
      WHERE center_id = p_center
        AND status = 'active'
        AND starts_on <= CURRENT_DATE
        AND ends_on >= CURRENT_DATE
      ORDER BY ends_on DESC NULLS LAST
      LIMIT 1
    ), false)
    OR EXISTS (
      SELECT 1
      FROM public.center_entitlements
      WHERE center_id = p_center
        AND feature_key = 'accounting'
        AND starts_on <= CURRENT_DATE
        AND (is_open_ended OR ends_on >= CURRENT_DATE)
    );
$$;

REVOKE ALL ON FUNCTION public.center_accounting_enabled(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.center_accounting_enabled(UUID) TO authenticated;

-- كانت هذه الدالة SECURITY DEFINER؛ لذلك يجب أن تطبق البوابة بنفسها ولا تعتمد
-- فقط على RLS للجدول عند انتهاء الاشتراك.
CREATE OR REPLACE FUNCTION public.get_my_fiscal_years()
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_role TEXT; v_center UUID; v_result JSONB;
BEGIN
  SELECT role, center_id INTO v_role, v_center FROM public.profiles WHERE id = auth.uid();
  IF v_role NOT IN ('center_admin','super_admin') OR v_center IS NULL THEN RETURN '[]'::jsonb; END IF;
  -- صلاحية المحاسبة تُحجب خادمياً عند انتهاء الفترة. إعادة قائمة فارغة هنا
  -- تمنع 400 متوقعاً إذا فتحت صفحة الإعدادات قبل تحديث واجهة الاشتراك؛ لا
  -- تكشف أي حركة مالية، وصفحة المحاسبة نفسها تبقى محجوبة عبر get_my_features.
  IF v_role = 'center_admin' AND NOT public.center_accounting_enabled(v_center) THEN
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
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_my_fiscal_years() TO authenticated;

COMMIT;
