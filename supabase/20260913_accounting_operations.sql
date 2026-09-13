-- ============================================================================
-- Mr Center — عمليات محاسبية عملية: خصومات ورواتب وعهدة الموظفين
-- التاريخ: 2026-09-13
-- شغّل بعد 20260913_practical_accounting.sql.
-- ============================================================================

BEGIN;

-- تسمية مهنية موحدة مع الحفاظ على كل قيود الرواتب التاريخية ومبالغها.
UPDATE public.center_ledger SET category = 'صرف راتب'
WHERE entry_type = 'salary' AND category = 'تسوية راتب';

-- إلحاق الدفعات السابقة لتفعيل الدفتر: يحل مشكلة التحصيل القديم الذي لم يكن له قيد،
-- ويعتمد المحصّل المخزن في الدفعة كما هو من دون اختراع نسبته لموظف آخر.
INSERT INTO public.center_ledger(
  center_id, kind, category, description, amount, occurred_on, created_by, created_by_name,
  source_payment_id, entry_type, period_month, period_year, affects_profit
)
SELECT s.center_id, 'income', 'تحصيل طلاب', 'تحصيل طالب (قيد مرحّل)', p.amount,
  COALESCE(p.payment_date, p.created_at::date), p.collected_by,
  COALESCE(NULLIF(p.collected_by_name, ''), collector.full_name, 'تحصيل غير منسوب'), p.id::text,
  'payment_collection', EXTRACT(MONTH FROM COALESCE(p.payment_date, p.created_at::date))::INT,
  EXTRACT(YEAR FROM COALESCE(p.payment_date, p.created_at::date))::INT, true
FROM public.payments p
JOIN public.students s ON s.id = p.student_id
LEFT JOIN public.profiles collector ON collector.id = p.collected_by
WHERE p.amount > 0
ON CONFLICT DO NOTHING;

-- إعادة تثبيت مشغل التحصيل: الفهرس الفريد لـ source_payment_id جزئي، لذلك
-- ON CONFLICT العام هو الصيغة الصحيحة ولا يفشل إدخال الدفعة أو يغفل قيد الموظف.
CREATE OR REPLACE FUNCTION public.record_payment_income()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_center UUID; v_collector_name TEXT;
BEGIN
  SELECT center_id INTO v_center FROM public.students WHERE id = NEW.student_id;
  SELECT full_name INTO v_collector_name FROM public.profiles WHERE id = COALESCE(NEW.collected_by, auth.uid());
  IF v_center IS NOT NULL THEN
    INSERT INTO public.center_ledger(
      center_id, kind, category, description, amount, occurred_on, created_by, created_by_name,
      source_payment_id, entry_type, period_month, period_year, affects_profit
    ) VALUES (
      v_center, 'income', 'تحصيل طلاب', 'تحصيل من طالب', NEW.amount, NEW.payment_date,
      COALESCE(NEW.collected_by, auth.uid()), COALESCE(NEW.collected_by_name, v_collector_name, ''),
      NEW.id::text, 'payment_collection', EXTRACT(MONTH FROM NEW.payment_date)::INT,
      EXTRACT(YEAR FROM NEW.payment_date)::INT, true
    ) ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_payment_income ON public.payments;
CREATE TRIGGER trg_payment_income AFTER INSERT ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.record_payment_income();

-- الخصم التزام على الموظف لا حركة نقدية ولا مصروف مستقل؛ يصفّى فقط عند صرف راتبه.
CREATE TABLE IF NOT EXISTS public.staff_deductions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  center_id UUID NOT NULL REFERENCES public.centers(id) ON DELETE CASCADE,
  staff_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  applied_amount NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (applied_amount >= 0 AND applied_amount <= amount),
  reason TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  occurred_on DATE NOT NULL DEFAULT CURRENT_DATE,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','partial','settled')),
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_staff_deductions_employee_open
  ON public.staff_deductions(center_id, staff_id, occurred_on, created_at)
  WHERE status IN ('open','partial');
ALTER TABLE public.staff_deductions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS staff_deductions_owner_read ON public.staff_deductions;
CREATE POLICY staff_deductions_owner_read ON public.staff_deductions FOR SELECT TO authenticated
  USING (public.admin_owns_center(center_id) AND public.center_accounting_enabled(center_id));
GRANT SELECT ON TABLE public.staff_deductions TO authenticated;

CREATE OR REPLACE FUNCTION public.record_staff_deduction(
  p_center UUID, p_employee UUID, p_amount NUMERIC, p_reason TEXT,
  p_date DATE DEFAULT CURRENT_DATE, p_notes TEXT DEFAULT ''
)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id UUID;
BEGIN
  PERFORM public.assert_accounting_owner(p_center);
  PERFORM public.assert_accounting_employee(p_center, p_employee);
  IF COALESCE(p_amount, 0) <= 0 OR COALESCE(trim(p_reason), '') = '' THEN
    RAISE EXCEPTION 'invalid_staff_deduction';
  END IF;
  INSERT INTO public.staff_deductions(center_id, staff_id, amount, reason, notes, occurred_on, created_by)
  VALUES(p_center, p_employee, p_amount, trim(p_reason), COALESCE(trim(p_notes), ''), COALESCE(p_date, CURRENT_DATE), auth.uid())
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.record_staff_deduction(UUID, UUID, NUMERIC, TEXT, DATE, TEXT) TO authenticated;

-- صرف الراتب: يملأ المستخدم السلف والخصومات المقترحة أو يعدّلها، ثم تُسوّى الذمم في المعاملة نفسها.
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

-- تعيد العهدة التحصيل المسجل حتى مع غياب سجل تسليم، فلا تختفي تحصيلات الموظف من الشاشة.
CREATE OR REPLACE FUNCTION public.get_custody_overview(p_from DATE DEFAULT NULL, p_to DATE DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_center UUID := public.my_center_id(); v_role TEXT := public.my_role();
BEGIN
  IF v_center IS NULL THEN RETURN '[]'::JSONB; END IF;
  IF NOT public.admin_owns_center(v_center) AND v_role NOT IN ('manager','secretary') THEN RAISE EXCEPTION 'not_allowed'; END IF;
  RETURN COALESCE((
    WITH collected AS (
      SELECT l.created_by AS staff_id, COALESCE(NULLIF(l.created_by_name, ''), p.full_name, 'موظف') AS staff_name,
        l.occurred_on AS custody_date, SUM(l.amount)::numeric AS expected_amount
      FROM public.center_ledger l LEFT JOIN public.profiles p ON p.id = l.created_by
      WHERE l.center_id = v_center AND l.entry_type = 'payment_collection'
        AND (p_from IS NULL OR l.occurred_on >= p_from) AND (p_to IS NULL OR l.occurred_on <= p_to)
        AND (public.admin_owns_center(v_center) OR l.created_by = auth.uid())
      GROUP BY l.created_by, COALESCE(NULLIF(l.created_by_name, ''), p.full_name, 'موظف'), l.occurred_on
    ), combined AS (
      SELECT c.staff_id, c.staff_name, c.custody_date, c.expected_amount, sc.id, COALESCE(sc.delivered_amount, 0) AS delivered_amount,
        COALESCE(sc.status, 'open') AS status, COALESCE(sc.notes, '') AS notes, sc.submitted_at, sc.created_at
      FROM collected c LEFT JOIN public.staff_custody sc ON sc.center_id = v_center AND sc.staff_id = c.staff_id AND sc.custody_date = c.custody_date
      UNION ALL
      SELECT sc.staff_id, COALESCE(p.full_name, 'موظف'), sc.custody_date, sc.expected_amount, sc.id, sc.delivered_amount, sc.status, sc.notes, sc.submitted_at, sc.created_at
      FROM public.staff_custody sc LEFT JOIN public.profiles p ON p.id = sc.staff_id
      WHERE sc.center_id = v_center AND (p_from IS NULL OR sc.custody_date >= p_from) AND (p_to IS NULL OR sc.custody_date <= p_to)
        AND (public.admin_owns_center(v_center) OR sc.staff_id = auth.uid())
        AND NOT EXISTS (SELECT 1 FROM collected c WHERE c.staff_id = sc.staff_id AND c.custody_date = sc.custody_date)
    )
    SELECT jsonb_agg(jsonb_build_object('id',id,'staff_id',staff_id,'staff_name',staff_name,'custody_date',custody_date,
      'expected_amount',expected_amount,'delivered_amount',delivered_amount,'status',status,'notes',notes,'submitted_at',submitted_at,'created_at',created_at)
      ORDER BY custody_date DESC, staff_name)
    FROM combined
  ), '[]'::JSONB);
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_custody_overview(DATE, DATE) TO authenticated;

-- صاحب السنتر يسجل ويعتمد تسليم الموظف من صف التحصيل نفسه؛ لا يحتاج لعمل سجلين منفصلين.
CREATE OR REPLACE FUNCTION public.settle_staff_custody(
  p_center UUID, p_staff UUID, p_date DATE, p_delivered NUMERIC, p_notes TEXT DEFAULT ''
)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_expected NUMERIC := 0; v_status TEXT; v_id UUID;
BEGIN
  PERFORM public.assert_accounting_owner(p_center);
  PERFORM public.assert_accounting_employee(p_center, p_staff);
  IF COALESCE(p_delivered, -1) < 0 THEN RAISE EXCEPTION 'invalid_custody_amount'; END IF;
  SELECT COALESCE(SUM(amount), 0) INTO v_expected FROM public.center_ledger
   WHERE center_id = p_center AND created_by = p_staff AND entry_type = 'payment_collection' AND occurred_on = COALESCE(p_date, CURRENT_DATE);
  v_status := CASE WHEN p_delivered = v_expected THEN 'matched' WHEN p_delivered < v_expected THEN 'shortage' ELSE 'surplus' END;
  INSERT INTO public.staff_custody(center_id, staff_id, custody_date, expected_amount, delivered_amount, status, notes, submitted_at, submitted_by)
  VALUES(p_center, p_staff, COALESCE(p_date,CURRENT_DATE), v_expected, p_delivered, v_status, COALESCE(trim(p_notes),''), now(), auth.uid())
  ON CONFLICT(center_id,staff_id,custody_date) DO UPDATE
    SET expected_amount=EXCLUDED.expected_amount, delivered_amount=EXCLUDED.delivered_amount, status=EXCLUDED.status,
        notes=EXCLUDED.notes, submitted_at=now(), submitted_by=auth.uid()
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.settle_staff_custody(UUID, UUID, DATE, NUMERIC, TEXT) TO authenticated;

COMMIT;
