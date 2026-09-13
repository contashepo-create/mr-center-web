-- ============================================================================
-- Mr Center — مسيرات الرواتب حسب الشهر
-- التاريخ: 2026-09-13
-- شغّل بعد 20260913_accounting_operations.sql على قواعد البيانات القائمة.
--
-- تاريخ الصرف يحدد شهر المسير والتقارير. الرصيد المتبقي المرحّل لا يُجمع
-- مع حركات الشهر السابقة، لكنه قابل للتسوية الجزئية في مسير تالٍ. يضيف
-- 20260913_settlement_traceability.sql الأثر التفصيلي لكل تخصيص.
-- ============================================================================

BEGIN;

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
BEGIN
  PERFORM public.assert_accounting_owner(p_center);
  v_employee_name := public.assert_accounting_employee(p_center, p_employee);
  v_total := v_base + v_bonus + v_commission;
  IF v_base <= 0 OR v_bonus < 0 OR v_commission < 0 OR v_advance_used < 0 OR v_deduction_used < 0 THEN
    RAISE EXCEPTION 'invalid_salary_amount';
  END IF;

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
    v_remaining := v_remaining - v_apply;
  END LOOP;
  RETURN v_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.record_salary_payment(UUID, UUID, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, UUID[], DATE, TEXT) TO authenticated;


-- تحفظ التطبيقات الأقدم هذا الاسم؛ يبقى تاريخ الصرف هو شهر مسيرها.
CREATE OR REPLACE FUNCTION public.record_payroll_settlement(
  p_center uuid, p_employee uuid, p_base_salary numeric,
  p_bonus numeric DEFAULT 0, p_commission numeric DEFAULT 0,
  p_advance_applied numeric DEFAULT 0, p_deduction numeric DEFAULT 0,
  p_date date DEFAULT CURRENT_DATE, p_description text DEFAULT ''
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id uuid; v_name text; v_employee_name text; v_advance_balance numeric := 0;
  v_base numeric := coalesce(p_base_salary, 0);
  v_bonus numeric := coalesce(p_bonus, 0);
  v_commission numeric := coalesce(p_commission, 0);
  v_advance_used numeric := coalesce(p_advance_applied, 0);
  v_deduction numeric := coalesce(p_deduction, 0);
  v_total numeric := 0; v_cash_paid numeric := 0;
BEGIN
  PERFORM public.assert_accounting_owner(p_center);
  v_employee_name := public.assert_accounting_employee(p_center, p_employee);
  v_total := v_base + v_bonus + v_commission;
  IF v_base <= 0 OR v_bonus < 0 OR v_commission < 0 OR v_advance_used < 0 OR v_deduction < 0 THEN
    RAISE EXCEPTION 'invalid_salary_amount';
  END IF;

  -- قفل سجل سلف/تسويات الموظف قبل الحساب، حتى لا تُسوّى السلفة نفسها مرتين من طلبين متزامنين.
  PERFORM 1 FROM public.center_ledger
   WHERE center_id = p_center AND employee_id = p_employee AND entry_type IN ('advance','salary')
   FOR UPDATE;
  SELECT coalesce(sum(CASE WHEN entry_type = 'advance' THEN amount ELSE -advance_applied END), 0)
    INTO v_advance_balance
  FROM public.center_ledger
  WHERE center_id = p_center AND employee_id = p_employee
    AND entry_type IN ('advance','salary');

  IF v_advance_used > v_advance_balance THEN RAISE EXCEPTION 'advance_exceeds_balance'; END IF;
  IF v_advance_used + v_deduction > v_total THEN RAISE EXCEPTION 'payroll_deductions_exceed_total'; END IF;
  v_cash_paid := v_total - v_advance_used - v_deduction;

  SELECT full_name INTO v_name FROM public.profiles WHERE id = auth.uid();
  INSERT INTO public.center_ledger(
    center_id, kind, entry_type, category, description, amount, occurred_on, employee_id,
    created_by, created_by_name, period_month, period_year, deduction, gross_amount,
    bonus_amount, commission_amount, advance_applied, affects_profit
  ) VALUES (
    p_center, 'expense', 'salary', 'صرف راتب',
    coalesce(nullif(trim(p_description), ''), 'صرف راتب ' || v_employee_name), v_cash_paid,
    coalesce(p_date, CURRENT_DATE), p_employee, auth.uid(), coalesce(v_name, ''),
    extract(month from coalesce(p_date, CURRENT_DATE))::int,
    extract(year from coalesce(p_date, CURRENT_DATE))::int,
    v_deduction, v_base, v_bonus, v_commission, v_advance_used, true
  ) RETURNING id INTO v_id;
  RETURN v_id;
END; $$;
GRANT EXECUTE ON FUNCTION public.record_payroll_settlement(uuid,uuid,numeric,numeric,numeric,numeric,numeric,date,text) TO authenticated;

COMMIT;
