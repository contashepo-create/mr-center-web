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
ALTER TABLE public.center_fiscal_years ADD COLUMN IF NOT EXISTS fiscal_year INT;
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

-- يبقى fiscal_year للتوافق مع تطبيق Android والإصدارات الأقدم، بينما تعتمد
-- واجهة الويب على نطاق starts_on/ends_on. القيمة الافتراضية تمنع فشل الدوال
-- القديمة التي كانت تدرج سنة جديدة بالحقول القديمة فقط.
UPDATE public.center_fiscal_years
SET fiscal_year = COALESCE(fiscal_year, EXTRACT(YEAR FROM starts_on)::INT)
WHERE fiscal_year IS NULL;
ALTER TABLE public.center_fiscal_years
  ALTER COLUMN fiscal_year SET DEFAULT EXTRACT(YEAR FROM CURRENT_DATE)::INT;

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

-- تصحيح الدالة الموجودة في قواعد حية طُبّق فيها الإصدار السابق من الترحيل:
-- عمود dues.year أُعيدت تسميته إلى due_year، وكان المرجع القديم يفشل فقط عند
-- إغلاق السنة. لا يعيد هذا إنشاء أي قيد أو يحذف تاريخاً؛ يستبدل جسم RPC فقط.
CREATE OR REPLACE FUNCTION public.close_fiscal_year(p_center UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_year public.center_fiscal_years%ROWTYPE;
  v_income NUMERIC(12,2) := 0; v_expense NUMERIC(12,2) := 0;
  v_cash_income NUMERIC(12,2) := 0; v_cash_expense NUMERIC(12,2) := 0;
  v_balance NUMERIC(12,2) := 0; v_pending NUMERIC(12,2) := 0;
  v_label TEXT; v_next_start DATE; v_next_end DATE;
BEGIN
  PERFORM public.assert_accounting_owner(p_center);
  SELECT * INTO v_year FROM public.center_fiscal_years WHERE center_id = p_center AND status = 'open' LIMIT 1;
  IF v_year.id IS NULL THEN
    PERFORM public.ensure_open_fiscal_year(p_center);
    SELECT * INTO v_year FROM public.center_fiscal_years WHERE center_id = p_center AND status = 'open' LIMIT 1;
  END IF;
  v_year.ends_on := COALESCE(v_year.ends_on, CURRENT_DATE);

  SELECT COALESCE(SUM(amount), 0) INTO v_income FROM public.center_ledger
   WHERE center_id = p_center AND kind = 'income' AND affects_profit IS NOT FALSE
     AND occurred_on BETWEEN v_year.starts_on AND v_year.ends_on;
  SELECT COALESCE(SUM(CASE WHEN entry_type = 'salary'
    THEN GREATEST(0, COALESCE(gross_amount, amount) + COALESCE(bonus_amount, 0)
      + COALESCE(commission_amount, 0) - COALESCE(deduction, 0))
    ELSE amount END), 0) INTO v_expense
  FROM public.center_ledger
  WHERE center_id = p_center AND kind = 'expense' AND affects_profit IS NOT FALSE
    AND occurred_on BETWEEN v_year.starts_on AND v_year.ends_on;

  SELECT COALESCE(SUM(amount), 0) INTO v_cash_income FROM public.center_ledger
   WHERE center_id = p_center AND kind = 'income'
     AND occurred_on BETWEEN v_year.starts_on AND v_year.ends_on;
  SELECT COALESCE(SUM(amount), 0) INTO v_cash_expense FROM public.center_ledger
   WHERE center_id = p_center AND kind = 'expense'
     AND occurred_on BETWEEN v_year.starts_on AND v_year.ends_on;
  v_balance := v_year.opening_balance + v_cash_income - v_cash_expense;
  SELECT COALESCE(SUM(amount), 0) INTO v_pending FROM public.dues
   WHERE center_id = p_center AND status IN ('pending','partial')
     AND make_date(due_year, month, 1) BETWEEN v_year.starts_on AND v_year.ends_on;

  UPDATE public.center_fiscal_years SET status = 'closed', ends_on = v_year.ends_on,
    closing_income = v_income, closing_expense = v_expense, closing_balance = v_balance,
    closing_pending_dues = v_pending, closed_at = now() WHERE id = v_year.id;
  v_next_start := v_year.ends_on + 1;
  v_next_end := v_next_start + INTERVAL '1 year' - INTERVAL '1 day';
  v_label := EXTRACT(YEAR FROM v_next_start)::INT::TEXT || '/' || EXTRACT(YEAR FROM v_next_end)::INT::TEXT;
  INSERT INTO public.center_fiscal_years(center_id, fiscal_year, year_label, starts_on, ends_on, status, opening_balance, opening_pending_dues)
  VALUES(p_center, EXTRACT(YEAR FROM v_next_start)::INT, v_label, v_next_start, v_next_end, 'open', v_balance, v_pending)
  ON CONFLICT (center_id, year_label) DO NOTHING;
  RETURN jsonb_build_object('closed', v_year.year_label, 'opened', v_label,
    'carry_balance', v_balance, 'carry_pending', v_pending);
END;
$$;
GRANT EXECUTE ON FUNCTION public.close_fiscal_year(UUID) TO authenticated;

COMMIT;
