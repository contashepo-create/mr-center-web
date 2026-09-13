-- ============================================================================
-- Mr Center — تسويات السلف والخصومات المرحّلة مع أثر تدقيقي لكل دفعة
-- التاريخ: 2026-09-13
-- شغّل بعد 20260913_accounting_operations.sql و20260913_monthly_payroll_periods.sql.
--
-- المسير شهري: ما دُفع أو سُوّي في الشهر فقط هو الذي يظهر في تقريره. لكن
-- الرصيد المتبقي للسلفة/الخصم يظل قابلاً للتسوية في مسير لاحق، مع حفظ المصدر
-- ومسير الراتب وتاريخ كل جزء مسوّى، بدلاً من خلط حركات الأشهر السابقة.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.staff_advance_settlements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  center_id UUID NOT NULL REFERENCES public.centers(id) ON DELETE CASCADE,
  staff_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  advance_ledger_id UUID NOT NULL REFERENCES public.center_ledger(id) ON DELETE RESTRICT,
  salary_ledger_id UUID NOT NULL REFERENCES public.center_ledger(id) ON DELETE CASCADE,
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  settled_on DATE NOT NULL DEFAULT CURRENT_DATE,
  period_month INT NOT NULL CHECK (period_month BETWEEN 1 AND 12),
  period_year INT NOT NULL CHECK (period_year BETWEEN 2000 AND 2200),
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(salary_ledger_id, advance_ledger_id)
);
CREATE INDEX IF NOT EXISTS idx_staff_advance_settlements_period
  ON public.staff_advance_settlements(center_id, staff_id, period_year, period_month, settled_on DESC);
CREATE INDEX IF NOT EXISTS idx_staff_advance_settlements_source
  ON public.staff_advance_settlements(advance_ledger_id, settled_on DESC);
ALTER TABLE public.staff_advance_settlements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS staff_advance_settlements_owner_read ON public.staff_advance_settlements;
CREATE POLICY staff_advance_settlements_owner_read ON public.staff_advance_settlements FOR SELECT TO authenticated
  USING (public.admin_owns_center(center_id) AND public.center_accounting_enabled(center_id));
GRANT SELECT ON TABLE public.staff_advance_settlements TO authenticated;

CREATE TABLE IF NOT EXISTS public.staff_deduction_settlements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  center_id UUID NOT NULL REFERENCES public.centers(id) ON DELETE CASCADE,
  staff_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  deduction_id UUID NOT NULL REFERENCES public.staff_deductions(id) ON DELETE RESTRICT,
  salary_ledger_id UUID NOT NULL REFERENCES public.center_ledger(id) ON DELETE CASCADE,
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  settled_on DATE NOT NULL DEFAULT CURRENT_DATE,
  period_month INT NOT NULL CHECK (period_month BETWEEN 1 AND 12),
  period_year INT NOT NULL CHECK (period_year BETWEEN 2000 AND 2200),
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(salary_ledger_id, deduction_id)
);
CREATE INDEX IF NOT EXISTS idx_staff_deduction_settlements_period
  ON public.staff_deduction_settlements(center_id, staff_id, period_year, period_month, settled_on DESC);
CREATE INDEX IF NOT EXISTS idx_staff_deduction_settlements_source
  ON public.staff_deduction_settlements(deduction_id, settled_on DESC);
ALTER TABLE public.staff_deduction_settlements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS staff_deduction_settlements_owner_read ON public.staff_deduction_settlements;
CREATE POLICY staff_deduction_settlements_owner_read ON public.staff_deduction_settlements FOR SELECT TO authenticated
  USING (public.admin_owns_center(center_id) AND public.center_accounting_enabled(center_id));
GRANT SELECT ON TABLE public.staff_deduction_settlements TO authenticated;

-- لا يَجمع هذا الإجراء المسيرات. تاريخ الصرف يحدد شهر المسير فقط، بينما
-- يستخدم أرصدة الذمم المفتوحة كلها. وتوزع السلفة تلقائياً من الأقدم إلى الأحدث
-- كي يرتبط كل جزء مسوّى بسلفته الأصلية بصورة قابلة للمراجعة.
CREATE OR REPLACE FUNCTION public.record_salary_payment(
  p_center UUID, p_employee UUID, p_base_salary NUMERIC,
  p_bonus NUMERIC DEFAULT 0, p_commission NUMERIC DEFAULT 0,
  p_advance_applied NUMERIC DEFAULT 0, p_deduction_applied NUMERIC DEFAULT 0,
  p_deduction_ids UUID[] DEFAULT '{}', p_date DATE DEFAULT CURRENT_DATE,
  p_description TEXT DEFAULT ''
)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id UUID; v_name TEXT; v_employee_name TEXT; v_advance_balance NUMERIC := 0;
  v_selected_deductions NUMERIC := 0; v_remaining NUMERIC := 0; v_apply NUMERIC := 0;
  v_base NUMERIC := COALESCE(p_base_salary, 0); v_bonus NUMERIC := COALESCE(p_bonus, 0);
  v_commission NUMERIC := COALESCE(p_commission, 0); v_advance_used NUMERIC := COALESCE(p_advance_applied, 0);
  v_deduction_used NUMERIC := COALESCE(p_deduction_applied, 0); v_total NUMERIC := 0; v_cash_paid NUMERIC := 0;
  v_deduction public.staff_deductions%ROWTYPE;
  v_advance public.center_ledger%ROWTYPE;
  v_known_source_settled NUMERIC := 0; v_legacy_advance_used NUMERIC := 0;
  v_source_available NUMERIC := 0; v_legacy_from_source NUMERIC := 0;
BEGIN
  PERFORM public.assert_accounting_owner(p_center);
  v_employee_name := public.assert_accounting_employee(p_center, p_employee);
  v_total := v_base + v_bonus + v_commission;
  IF v_base <= 0 OR v_bonus < 0 OR v_commission < 0 OR v_advance_used < 0 OR v_deduction_used < 0 THEN
    RAISE EXCEPTION 'invalid_salary_amount';
  END IF;

  -- يقفل كل سجل الموظف؛ يمنع تطبيق الرصيد المتبقي مرتين من طلبين متزامنين.
  PERFORM 1 FROM public.center_ledger
   WHERE center_id = p_center AND employee_id = p_employee AND entry_type IN ('advance','salary') FOR UPDATE;
  SELECT COALESCE(SUM(CASE WHEN entry_type = 'advance' THEN amount ELSE -advance_applied END), 0)
    INTO v_advance_balance FROM public.center_ledger
   WHERE center_id = p_center AND employee_id = p_employee AND entry_type IN ('advance','salary');
  IF v_advance_used > v_advance_balance THEN RAISE EXCEPTION 'advance_exceeds_balance'; END IF;

  PERFORM 1 FROM public.staff_deductions
   WHERE center_id = p_center AND staff_id = p_employee AND id = ANY(COALESCE(p_deduction_ids, '{}')) FOR UPDATE;
  SELECT COALESCE(SUM(amount - applied_amount), 0) INTO v_selected_deductions
  FROM public.staff_deductions
  WHERE center_id = p_center AND staff_id = p_employee AND id = ANY(COALESCE(p_deduction_ids, '{}'))
    AND status IN ('open','partial');
  IF v_deduction_used > v_selected_deductions THEN RAISE EXCEPTION 'deduction_exceeds_selected_balance'; END IF;
  IF v_advance_used + v_deduction_used > v_total THEN RAISE EXCEPTION 'payroll_deductions_exceed_total'; END IF;
  v_cash_paid := v_total - v_advance_used - v_deduction_used;

  SELECT full_name INTO v_name FROM public.profiles WHERE id = auth.uid();
  INSERT INTO public.center_ledger(
    center_id, kind, entry_type, category, description, amount, occurred_on, employee_id,
    created_by, created_by_name, period_month, period_year, deduction, gross_amount,
    bonus_amount, commission_amount, advance_applied, affects_profit
  ) VALUES (
    p_center, 'expense', 'salary', 'صرف راتب',
    COALESCE(NULLIF(trim(p_description), ''), 'صرف راتب ' || v_employee_name), v_cash_paid,
    COALESCE(p_date, CURRENT_DATE), p_employee, auth.uid(), COALESCE(v_name, ''),
    EXTRACT(month FROM COALESCE(p_date, CURRENT_DATE))::INT, EXTRACT(year FROM COALESCE(p_date, CURRENT_DATE))::INT,
    v_deduction_used, v_base, v_bonus, v_commission, v_advance_used, true
  ) RETURNING id INTO v_id;

  -- السجلات القديمة كانت تحمل إجمالي advance_applied فقط. نخصصها FIFO داخلياً
  -- قبل إضافة الأثر الجديد، فلا يُعاد استعمال الجزء الذي سُوّي قبل هذه الترقية.
  SELECT COALESCE(SUM(advance_applied), 0) INTO v_legacy_advance_used
  FROM public.center_ledger
  WHERE center_id = p_center AND employee_id = p_employee AND entry_type = 'salary';
  SELECT COALESCE(SUM(amount), 0) INTO v_known_source_settled
  FROM public.staff_advance_settlements
  WHERE center_id = p_center AND staff_id = p_employee;
  v_legacy_advance_used := GREATEST(0, v_legacy_advance_used - v_known_source_settled - v_advance_used);

  v_remaining := v_advance_used;
  FOR v_advance IN
    SELECT * FROM public.center_ledger
    WHERE center_id = p_center AND employee_id = p_employee AND entry_type = 'advance'
    ORDER BY occurred_on, created_at, id FOR UPDATE
  LOOP
    SELECT COALESCE(SUM(amount), 0) INTO v_known_source_settled
    FROM public.staff_advance_settlements WHERE advance_ledger_id = v_advance.id;
    v_source_available := GREATEST(0, v_advance.amount - v_known_source_settled);
    IF v_legacy_advance_used > 0 AND v_source_available > 0 THEN
      v_legacy_from_source := LEAST(v_source_available, v_legacy_advance_used);
      v_source_available := v_source_available - v_legacy_from_source;
      v_legacy_advance_used := v_legacy_advance_used - v_legacy_from_source;
    END IF;
    EXIT WHEN v_remaining <= 0;
    IF v_source_available > 0 THEN
      v_apply := LEAST(v_remaining, v_source_available);
      INSERT INTO public.staff_advance_settlements(
        center_id, staff_id, advance_ledger_id, salary_ledger_id, amount, settled_on,
        period_month, period_year, created_by
      ) VALUES (
        p_center, p_employee, v_advance.id, v_id, v_apply, COALESCE(p_date, CURRENT_DATE),
        EXTRACT(month FROM COALESCE(p_date, CURRENT_DATE))::INT,
        EXTRACT(year FROM COALESCE(p_date, CURRENT_DATE))::INT, auth.uid()
      );
      v_remaining := v_remaining - v_apply;
    END IF;
  END LOOP;
  IF v_remaining > 0 THEN RAISE EXCEPTION 'advance_source_allocation_failed'; END IF;

  v_remaining := v_deduction_used;
  FOR v_deduction IN
    SELECT * FROM public.staff_deductions
    WHERE center_id = p_center AND staff_id = p_employee AND id = ANY(COALESCE(p_deduction_ids, '{}'))
      AND status IN ('open','partial')
    ORDER BY occurred_on, created_at FOR UPDATE
  LOOP
    EXIT WHEN v_remaining <= 0;
    v_apply := LEAST(v_remaining, v_deduction.amount - v_deduction.applied_amount);
    UPDATE public.staff_deductions
      SET applied_amount = applied_amount + v_apply,
          status = CASE WHEN applied_amount + v_apply >= amount THEN 'settled' ELSE 'partial' END,
          updated_at = now()
    WHERE id = v_deduction.id;
    INSERT INTO public.staff_deduction_settlements(
      center_id, staff_id, deduction_id, salary_ledger_id, amount, settled_on,
      period_month, period_year, created_by
    ) VALUES (
      p_center, p_employee, v_deduction.id, v_id, v_apply, COALESCE(p_date, CURRENT_DATE),
      EXTRACT(month FROM COALESCE(p_date, CURRENT_DATE))::INT,
      EXTRACT(year FROM COALESCE(p_date, CURRENT_DATE))::INT, auth.uid()
    );
    v_remaining := v_remaining - v_apply;
  END LOOP;
  IF v_remaining > 0 THEN RAISE EXCEPTION 'deduction_source_allocation_failed'; END IF;
  RETURN v_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.record_salary_payment(UUID, UUID, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, UUID[], DATE, TEXT) TO authenticated;

-- اسم RPC السابق لا يلتف على سجل التخصيص: إن أرسل خصماً بلا مصدر، ينشئ
-- مصدر توافق واضحاً ثم يمرره للإجراء الجديد حتى تبقى كل تسوية قابلة للتتبع.
CREATE OR REPLACE FUNCTION public.record_payroll_settlement(
  p_center UUID, p_employee UUID, p_base_salary NUMERIC,
  p_bonus NUMERIC DEFAULT 0, p_commission NUMERIC DEFAULT 0,
  p_advance_applied NUMERIC DEFAULT 0, p_deduction NUMERIC DEFAULT 0,
  p_date DATE DEFAULT CURRENT_DATE, p_description TEXT DEFAULT ''
)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_deduction_id UUID;
BEGIN
  IF COALESCE(p_deduction, 0) > 0 THEN
    PERFORM public.assert_accounting_owner(p_center);
    PERFORM public.assert_accounting_employee(p_center, p_employee);
    INSERT INTO public.staff_deductions(center_id, staff_id, amount, reason, occurred_on, created_by)
    VALUES (p_center, p_employee, p_deduction, 'خصم راتب مسجل عبر مسار متوافق', COALESCE(p_date, CURRENT_DATE), auth.uid())
    RETURNING id INTO v_deduction_id;
  END IF;
  RETURN public.record_salary_payment(
    p_center, p_employee, p_base_salary, p_bonus, p_commission, p_advance_applied,
    COALESCE(p_deduction, 0), CASE WHEN v_deduction_id IS NULL THEN '{}'::UUID[] ELSE ARRAY[v_deduction_id] END,
    p_date, p_description
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.record_payroll_settlement(UUID, UUID, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, DATE, TEXT) TO authenticated;

COMMIT;
