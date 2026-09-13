-- ============================================================================
-- Mr Center — محاسبة عملية: رواتب + سلف + خصومات + عمولات + إيراد يدوي
-- التاريخ: 2026-09-13
-- شغّل هذا الملف بعد:
--   android_multitenant_schema.sql
--   20260911_safe_production_migration.sql
--   20260912_fiscal_accounting.sql
--   20260912_fiscal_accounting_gate.sql
--
-- الفكرة المحاسبية:
-- * السلفة نقد خرج من الخزينة، لكنها ليست مصروف تشغيل ولا تُحسب مرتين.
-- * تسوية الراتب تحفظ الإجمالي والخصم والسلفة المخصومة وصافي ما دُفع نقداً.
-- * الخصم يقلل تكلفة الراتب؛ أما السلفة المسوّاة فهي استرداد ذمة ولا تقللها.
-- * قائمة الدخل تعرض تكلفة الراتب الحقيقية، والتدفق النقدي يعرض كل ما دخل وخرج.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- ١) حقول تفصل التدفق النقدي عن تكلفة التشغيل
-- ----------------------------------------------------------------------------
ALTER TABLE public.center_ledger
  ADD COLUMN IF NOT EXISTS affects_profit boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS gross_amount numeric(12,2),
  ADD COLUMN IF NOT EXISTS bonus_amount numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS commission_amount numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS advance_applied numeric(12,2) NOT NULL DEFAULT 0;

-- أي سلفة قديمة لم تكن تكلفة تشغيل؛ توقف عن تضخيم قائمة الدخل من الآن.
UPDATE public.center_ledger
SET affects_profit = false
WHERE entry_type = 'advance';

-- إضافة نوع حركة مستقل للعمولات المصروفة.
ALTER TABLE public.center_ledger DROP CONSTRAINT IF EXISTS center_ledger_entry_type_check;
ALTER TABLE public.center_ledger
  ADD CONSTRAINT center_ledger_entry_type_check
  CHECK (entry_type IN ('general','salary','advance','bonus','commission','rent','utility','purchase','payment_collection'));

CREATE INDEX IF NOT EXISTS idx_ledger_center_employee_date
  ON public.center_ledger(center_id, employee_id, occurred_on DESC)
  WHERE employee_id IS NOT NULL;

-- لا يكتب صاحب السنتر في الدفتر مباشرة بعد الآن؛ جميع القيود الجديدة تمر عبر RPC
-- الذرية أدناه. Trigger تحصيل الطالب ودوال SECURITY DEFINER يستمران في العمل.
DROP POLICY IF EXISTS ledger_owner_all ON public.center_ledger;
DROP POLICY IF EXISTS ledger_owner_read ON public.center_ledger;
CREATE POLICY ledger_owner_read ON public.center_ledger FOR SELECT TO authenticated
  USING (public.admin_owns_center(center_id) AND public.center_accounting_enabled(center_id));

-- العهدة تُقرأ داخل المحاسبة وتُغيّر حصراً عبر submit/review RPCs.
DROP POLICY IF EXISTS custody_owner_all ON public.staff_custody;
DROP POLICY IF EXISTS custody_owner_read ON public.staff_custody;
CREATE POLICY custody_owner_read ON public.staff_custody FOR SELECT TO authenticated
  USING (public.admin_owns_center(center_id) AND public.center_accounting_enabled(center_id));

-- ----------------------------------------------------------------------------
-- ٢) حاجز موحّد لجميع إدخالات المحاسبة اليدوية
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.assert_accounting_owner(p_center uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_role text; v_center uuid;
BEGIN
  SELECT role, center_id INTO v_role, v_center FROM public.profiles WHERE id = auth.uid();
  IF v_role IS DISTINCT FROM 'super_admin' AND (v_role IS DISTINCT FROM 'center_admin' OR v_center IS DISTINCT FROM p_center) THEN
    RAISE EXCEPTION 'not_allowed';
  END IF;
  IF NOT public.center_accounting_enabled(p_center) THEN
    RAISE EXCEPTION 'accounting_not_enabled';
  END IF;
END; $$;
REVOKE ALL ON FUNCTION public.assert_accounting_owner(uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.assert_accounting_employee(p_center uuid, p_employee uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_name text;
BEGIN
  SELECT full_name INTO v_name
  FROM public.profiles
  WHERE id = p_employee AND center_id = p_center AND role IN ('center_admin','teacher','manager','secretary') AND is_active;
  IF v_name IS NULL THEN RAISE EXCEPTION 'invalid_employee'; END IF;
  RETURN v_name;
END; $$;
REVOKE ALL ON FUNCTION public.assert_accounting_employee(uuid, uuid) FROM PUBLIC;

-- ----------------------------------------------------------------------------
-- ٣) تسجيل إيراد أو مصروف يدوي. تحصيل الطالب يستمر حصرياً من شاشة التحصيل.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_manual_ledger_entry(
  p_center uuid, p_kind text, p_category text, p_description text,
  p_amount numeric, p_date date DEFAULT CURRENT_DATE
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid; v_name text;
BEGIN
  PERFORM public.assert_accounting_owner(p_center);
  IF p_kind NOT IN ('income','expense') THEN RAISE EXCEPTION 'invalid_ledger_kind'; END IF;
  IF coalesce(trim(p_category), '') = '' OR coalesce(p_amount, 0) <= 0 THEN
    RAISE EXCEPTION 'invalid_ledger_entry';
  END IF;
  SELECT full_name INTO v_name FROM public.profiles WHERE id = auth.uid();
  INSERT INTO public.center_ledger(
    center_id, kind, entry_type, category, description, amount, occurred_on,
    created_by, created_by_name, period_month, period_year, affects_profit
  ) VALUES (
    p_center, p_kind, 'general', trim(p_category), coalesce(trim(p_description), ''), p_amount,
    coalesce(p_date, CURRENT_DATE), auth.uid(), coalesce(v_name, ''),
    extract(month from coalesce(p_date, CURRENT_DATE))::int,
    extract(year from coalesce(p_date, CURRENT_DATE))::int, true
  ) RETURNING id INTO v_id;
  RETURN v_id;
END; $$;
GRANT EXECUTE ON FUNCTION public.record_manual_ledger_entry(uuid,text,text,text,numeric,date) TO authenticated;

-- ----------------------------------------------------------------------------
-- ٤) سلفة موظف: حركة نقدية فقط، ورصيدها يظل ظاهراً حتى تسويتها مع راتب.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_staff_advance(
  p_center uuid, p_employee uuid, p_amount numeric, p_date date DEFAULT CURRENT_DATE,
  p_description text DEFAULT ''
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid; v_name text; v_employee_name text;
BEGIN
  PERFORM public.assert_accounting_owner(p_center);
  IF coalesce(p_amount, 0) <= 0 THEN RAISE EXCEPTION 'invalid_advance_amount'; END IF;
  v_employee_name := public.assert_accounting_employee(p_center, p_employee);
  SELECT full_name INTO v_name FROM public.profiles WHERE id = auth.uid();
  INSERT INTO public.center_ledger(
    center_id, kind, entry_type, category, description, amount, occurred_on, employee_id,
    created_by, created_by_name, period_month, period_year, affects_profit
  ) VALUES (
    p_center, 'expense', 'advance', 'سلفة موظف',
    coalesce(nullif(trim(p_description), ''), 'سلفة إلى ' || v_employee_name), p_amount,
    coalesce(p_date, CURRENT_DATE), p_employee, auth.uid(), coalesce(v_name, ''),
    extract(month from coalesce(p_date, CURRENT_DATE))::int,
    extract(year from coalesce(p_date, CURRENT_DATE))::int, false
  ) RETURNING id INTO v_id;
  RETURN v_id;
END; $$;
GRANT EXECUTE ON FUNCTION public.record_staff_advance(uuid,uuid,numeric,date,text) TO authenticated;

-- ----------------------------------------------------------------------------
-- ٥) صرف راتب واحد للموظف.
-- amount = صافي النقد المدفوع، أما gross/bonus/commission فهي تكلفة التشغيل.
-- ----------------------------------------------------------------------------
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

-- ----------------------------------------------------------------------------
-- ٦) صرف عمولة منفصل. تبقى العمولة المستحقة من التحصيل ظاهرة في لوحة العمولات.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_staff_commission_payment(
  p_center uuid, p_employee uuid, p_amount numeric, p_date date DEFAULT CURRENT_DATE,
  p_description text DEFAULT ''
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid; v_name text; v_employee_name text;
BEGIN
  PERFORM public.assert_accounting_owner(p_center);
  IF coalesce(p_amount, 0) <= 0 THEN RAISE EXCEPTION 'invalid_commission_amount'; END IF;
  v_employee_name := public.assert_accounting_employee(p_center, p_employee);
  SELECT full_name INTO v_name FROM public.profiles WHERE id = auth.uid();
  INSERT INTO public.center_ledger(
    center_id, kind, entry_type, category, description, amount, occurred_on, employee_id,
    created_by, created_by_name, period_month, period_year, commission_amount, affects_profit
  ) VALUES (
    p_center, 'expense', 'commission', 'عمولة تحصيل',
    coalesce(nullif(trim(p_description), ''), 'عمولة مصروفة إلى ' || v_employee_name), p_amount,
    coalesce(p_date, CURRENT_DATE), p_employee, auth.uid(), coalesce(v_name, ''),
    extract(month from coalesce(p_date, CURRENT_DATE))::int,
    extract(year from coalesce(p_date, CURRENT_DATE))::int, p_amount, true
  ) RETURNING id INTO v_id;
  RETURN v_id;
END; $$;
GRANT EXECUTE ON FUNCTION public.record_staff_commission_payment(uuid,uuid,numeric,date,text) TO authenticated;

-- ----------------------------------------------------------------------------
-- ٧) إغلاق السنة: المصروف التشغيلي لا يشمل السلف، والراتب بعد خصم الموظف.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.close_fiscal_year(p_center UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_year public.center_fiscal_years%ROWTYPE;
  v_income numeric(12,2) := 0; v_expense numeric(12,2) := 0;
  v_cash_income numeric(12,2) := 0; v_cash_expense numeric(12,2) := 0;
  v_balance numeric(12,2) := 0; v_pending numeric(12,2) := 0;
  v_label text; v_next_start date; v_next_end date;
BEGIN
  PERFORM public.assert_accounting_owner(p_center);
  SELECT * INTO v_year FROM public.center_fiscal_years WHERE center_id = p_center AND status = 'open' LIMIT 1;
  IF v_year.id IS NULL THEN
    PERFORM public.ensure_open_fiscal_year(p_center);
    SELECT * INTO v_year FROM public.center_fiscal_years WHERE center_id = p_center AND status = 'open' LIMIT 1;
  END IF;
  v_year.ends_on := coalesce(v_year.ends_on, CURRENT_DATE);

  SELECT coalesce(sum(amount), 0) INTO v_income FROM public.center_ledger
   WHERE center_id = p_center AND kind = 'income' AND affects_profit IS NOT FALSE
     AND occurred_on BETWEEN v_year.starts_on AND v_year.ends_on;
  SELECT coalesce(sum(CASE WHEN entry_type = 'salary'
    THEN greatest(0, coalesce(gross_amount, amount) + coalesce(bonus_amount, 0)
      + coalesce(commission_amount, 0) - coalesce(deduction, 0))
    ELSE amount END), 0) INTO v_expense
  FROM public.center_ledger
  WHERE center_id = p_center AND kind = 'expense' AND affects_profit IS NOT FALSE
    AND occurred_on BETWEEN v_year.starts_on AND v_year.ends_on;

  -- الرصيد الختامي رصيد نقدي فعلي: السلفة تخفضه عند صرفها حتى لو لم تكن تكلفة.
  SELECT coalesce(sum(amount), 0) INTO v_cash_income FROM public.center_ledger
  WHERE center_id = p_center AND kind = 'income'
    AND occurred_on BETWEEN v_year.starts_on AND v_year.ends_on;
  SELECT coalesce(sum(amount), 0) INTO v_cash_expense FROM public.center_ledger
  WHERE center_id = p_center AND kind = 'expense'
    AND occurred_on BETWEEN v_year.starts_on AND v_year.ends_on;
  v_balance := v_year.opening_balance + v_cash_income - v_cash_expense;
  SELECT coalesce(sum(amount), 0) INTO v_pending FROM public.dues
   WHERE center_id = p_center AND status IN ('pending','partial')
     AND make_date(due_year, month, 1) BETWEEN v_year.starts_on AND v_year.ends_on;

  UPDATE public.center_fiscal_years SET status = 'closed', ends_on = v_year.ends_on,
    closing_income = v_income, closing_expense = v_expense, closing_balance = v_balance,
    closing_pending_dues = v_pending, closed_at = now() WHERE id = v_year.id;
  v_next_start := v_year.ends_on + 1;
  v_next_end := v_next_start + interval '1 year' - interval '1 day';
  v_label := extract(year from v_next_start)::int::text || '/' || extract(year from v_next_end)::int::text;
  INSERT INTO public.center_fiscal_years(center_id, year_label, starts_on, ends_on, status, opening_balance, opening_pending_dues)
  VALUES(p_center, v_label, v_next_start, v_next_end, 'open', v_balance, v_pending)
  ON CONFLICT (center_id, year_label) DO NOTHING;
  RETURN jsonb_build_object('closed', v_year.year_label, 'opened', v_label,
    'carry_balance', v_balance, 'carry_pending', v_pending);
END; $$;
GRANT EXECUTE ON FUNCTION public.close_fiscal_year(UUID) TO authenticated;

COMMIT;
