-- ============================================================================
-- Mr Center — إصلاح توافق السنة المالية في قواعد البيانات الحية
-- التاريخ: 2026-09-13
--
-- بعض النسخ القديمة من android_multitenant_schema.sql أنشأت
-- center_fiscal_years بأعمدة fiscal_year فقط. أما واجهة الويب الحديثة فتقرأ
-- year_label / starts_on / ends_on؛ لذا كان RPC get_my_fiscal_years يعيد 400
-- عند قراءة عمود مفقود. هذا الترحيل يضيف الأعمدة بلا حذف أو فقد بيانات ويعيد
-- تعريف بوابة القراءة لتعيد قائمة فارغة آمنة عند انتهاء خدمة المحاسبة.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.center_fiscal_years (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  center_id UUID NOT NULL REFERENCES public.centers(id) ON DELETE CASCADE,
  year_label TEXT NOT NULL,
  starts_on DATE NOT NULL,
  ends_on DATE,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  opening_balance NUMERIC(12,2) NOT NULL DEFAULT 0,
  opening_pending_dues NUMERIC(12,2) NOT NULL DEFAULT 0,
  closing_income NUMERIC(12,2),
  closing_expense NUMERIC(12,2),
  closing_balance NUMERIC(12,2),
  closing_pending_dues NUMERIC(12,2),
  opened_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at TIMESTAMPTZ,
  UNIQUE(center_id, year_label)
);

-- CREATE TABLE IF NOT EXISTS لا يضيف أعمدة لجدول قديم، لذلك تضاف كل حقول
-- واجهة الويب صراحةً وبصورة idempotent.
ALTER TABLE public.center_fiscal_years ADD COLUMN IF NOT EXISTS year_label TEXT;
ALTER TABLE public.center_fiscal_years ADD COLUMN IF NOT EXISTS starts_on DATE;
ALTER TABLE public.center_fiscal_years ADD COLUMN IF NOT EXISTS ends_on DATE;
ALTER TABLE public.center_fiscal_years ADD COLUMN IF NOT EXISTS opening_pending_dues NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE public.center_fiscal_years ADD COLUMN IF NOT EXISTS closing_income NUMERIC(12,2);
ALTER TABLE public.center_fiscal_years ADD COLUMN IF NOT EXISTS closing_expense NUMERIC(12,2);
ALTER TABLE public.center_fiscal_years ADD COLUMN IF NOT EXISTS closing_pending_dues NUMERIC(12,2);

-- ترحيل صفوف مخطط fiscal_year القديم إلى السنة الدراسية سبتمبر → أغسطس.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'center_fiscal_years' AND column_name = 'fiscal_year'
  ) THEN
    EXECUTE $sql$
      UPDATE public.center_fiscal_years
      SET starts_on = COALESCE(starts_on, make_date(fiscal_year, 9, 1)),
          year_label = COALESCE(NULLIF(trim(year_label), ''), fiscal_year::TEXT || '/' || (fiscal_year + 1)::TEXT)
      WHERE starts_on IS NULL OR year_label IS NULL OR trim(year_label) = ''
    $sql$;
  ELSE
    UPDATE public.center_fiscal_years
    SET starts_on = COALESCE(starts_on, make_date(EXTRACT(YEAR FROM CURRENT_DATE)::INT - CASE WHEN EXTRACT(MONTH FROM CURRENT_DATE)::INT < 9 THEN 1 ELSE 0 END, 9, 1)),
        year_label = COALESCE(NULLIF(trim(year_label), ''),
          (EXTRACT(YEAR FROM CURRENT_DATE)::INT - CASE WHEN EXTRACT(MONTH FROM CURRENT_DATE)::INT < 9 THEN 1 ELSE 0 END)::TEXT || '/' ||
          (EXTRACT(YEAR FROM CURRENT_DATE)::INT - CASE WHEN EXTRACT(MONTH FROM CURRENT_DATE)::INT < 9 THEN 0 ELSE 1 END)::TEXT)
    WHERE starts_on IS NULL OR year_label IS NULL OR trim(year_label) = '';
  END IF;
END;
$$;

UPDATE public.center_fiscal_years
SET ends_on = COALESCE(ends_on, (starts_on + INTERVAL '1 year - 1 day')::DATE)
WHERE ends_on IS NULL;

ALTER TABLE public.center_fiscal_years ALTER COLUMN year_label SET NOT NULL;
ALTER TABLE public.center_fiscal_years ALTER COLUMN starts_on SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_fiscal_years_center ON public.center_fiscal_years(center_id, starts_on DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_fiscal_year_label ON public.center_fiscal_years(center_id, year_label);
-- لا نفشل إصلاح البيانات إذا احتفظت قاعدة قديمة بأكثر من سنة «مفتوحة» بالخطأ.
-- ينشأ القيد فقط عندما تكون البيانات صالحة، من دون حذف أو تغيير سجل تاريخي.
DO $$
BEGIN
  IF to_regclass('public.uq_fiscal_year_open') IS NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.center_fiscal_years WHERE status = 'open'
       GROUP BY center_id HAVING COUNT(*) > 1
     ) THEN
    CREATE UNIQUE INDEX uq_fiscal_year_open ON public.center_fiscal_years(center_id) WHERE status = 'open';
  END IF;
END;
$$;

-- بوابة موحدة لا تعتمد على تعريف قديم أو اشتراك منتهٍ. لا ترفع استثناء عند
-- انتهاء الحساب؛ فالواجهة تعرض معلومات التفعيل من دون ضوضاء HTTP 400.
CREATE OR REPLACE FUNCTION public.center_accounting_enabled(p_center UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    COALESCE((
      SELECT (enabled_features ->> 'accounting')::BOOLEAN
      FROM public.center_subscriptions
      WHERE center_id = p_center AND status = 'active'
        AND starts_on <= CURRENT_DATE AND ends_on >= CURRENT_DATE
      ORDER BY ends_on DESC NULLS LAST LIMIT 1
    ), false)
    OR EXISTS (
      SELECT 1 FROM public.center_entitlements
      WHERE center_id = p_center AND feature_key = 'accounting'
        AND starts_on <= CURRENT_DATE AND (is_open_ended OR ends_on >= CURRENT_DATE)
    );
$$;
REVOKE ALL ON FUNCTION public.center_accounting_enabled(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.center_accounting_enabled(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_my_fiscal_years()
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_role TEXT; v_center UUID; v_result JSONB;
BEGIN
  SELECT role, center_id INTO v_role, v_center FROM public.profiles WHERE id = auth.uid();
  IF v_role NOT IN ('center_admin','super_admin') OR v_center IS NULL THEN RETURN '[]'::JSONB; END IF;
  -- لا يسرّب السجل المالي بعد انتهاء الاشتراك، ولا يجعل استدعاء واجهة قديم
  -- يفشل بـ 400؛ صفحة الاشتراك تتولى إظهار حالة الخدمة للمستخدم.
  IF v_role = 'center_admin' AND NOT public.center_accounting_enabled(v_center) THEN RETURN '[]'::JSONB; END IF;
  SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.starts_on DESC), '[]'::JSONB) INTO v_result
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
