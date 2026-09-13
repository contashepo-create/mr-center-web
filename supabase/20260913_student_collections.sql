-- ============================================================================
-- Mr Center — التحصيل وحساب الطالب: مقدم، استحقاق بالحضور، كشف وتسوية
-- التاريخ: 2026-09-13
-- شغّل هذا الملف بعد android_multitenant_schema.sql و20260912_security.sql.
--
-- مبادئ هذه الترقية:
--  * التحصيل النقدي يُسجل مرة واحدة فقط في payments، ومن ثم يسجله Trigger الدفتر
--    كإيراد مرة واحدة. توزيع الرصيد المقدم أو تسويته لا ينشئ payment جديداً.
--  * الرصيد المقدم قابل للتوزيع تلقائياً على المستحقات، ومنها مستحق الحضور.
--  * كل تعديل مالي حساس يمر من RPC مؤمّن؛ لا صلاحيات كتابة مباشرة لجداول التوزيع.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- ١) إعداد طريقة الاستحقاق في المجموعة وبيانات مصدر المستحق/نوع التحصيل
-- ----------------------------------------------------------------------------
ALTER TABLE public.groups
  ADD COLUMN IF NOT EXISTS due_mode text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS attendance_due_amount numeric(12,2) NOT NULL DEFAULT 0;
ALTER TABLE public.groups DROP CONSTRAINT IF EXISTS groups_due_mode_check;
ALTER TABLE public.groups ADD CONSTRAINT groups_due_mode_check
  CHECK (due_mode IN ('manual', 'attendance'));
ALTER TABLE public.groups DROP CONSTRAINT IF EXISTS groups_attendance_due_amount_check;
ALTER TABLE public.groups ADD CONSTRAINT groups_attendance_due_amount_check
  CHECK (attendance_due_amount >= 0);

ALTER TABLE public.dues
  ADD COLUMN IF NOT EXISTS due_source text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS session_id text;
ALTER TABLE public.dues DROP CONSTRAINT IF EXISTS dues_due_source_check;
ALTER TABLE public.dues ADD CONSTRAINT dues_due_source_check
  CHECK (due_source IN ('manual', 'attendance'));
CREATE INDEX IF NOT EXISTS idx_dues_center_student_created
  ON public.dues(center_id, student_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_dues_attendance_session
  ON public.dues(session_id, student_id) WHERE due_source = 'attendance';
-- لا يتكرر استحقاق الطالب للحصة نفسها، بينما تبقى المستحقات اليدوية القديمة مرنة.
CREATE UNIQUE INDEX IF NOT EXISTS uq_dues_attendance_session_student
  ON public.dues(session_id, student_id) WHERE due_source = 'attendance';

ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS payment_kind text NOT NULL DEFAULT 'due_payment';
-- أي دفعة تاريخية بلا مستحق تعتبر رصيداً مقدماً، لا تسقط من كشف الطالب.
UPDATE public.payments
SET payment_kind = CASE WHEN due_id IS NULL OR due_id = '' THEN 'credit' ELSE 'due_payment' END
WHERE (due_id IS NULL OR due_id = '') AND payment_kind IS DISTINCT FROM 'credit'
   OR (due_id IS NOT NULL AND due_id <> '' AND payment_kind IS DISTINCT FROM 'due_payment');
ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_payment_kind_check;
ALTER TABLE public.payments ADD CONSTRAINT payments_payment_kind_check
  CHECK (payment_kind IN ('due_payment', 'credit'));
CREATE INDEX IF NOT EXISTS idx_payments_student_credit
  ON public.payments(center_id, student_id, payment_date, created_at)
  WHERE payment_kind = 'credit';

-- توزيع الدفعة المقدمة: إما على مستحق أو تسوية رصيد. لا يشغّل Trigger إيراد.
CREATE TABLE IF NOT EXISTS public.student_credit_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  center_id uuid NOT NULL REFERENCES public.centers(id) ON DELETE CASCADE,
  student_id text NOT NULL,
  credit_payment_id text NOT NULL REFERENCES public.payments(id) ON DELETE RESTRICT,
  due_id text REFERENCES public.dues(id) ON DELETE CASCADE,
  application_kind text NOT NULL DEFAULT 'due',
  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  notes text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((application_kind = 'due' AND due_id IS NOT NULL) OR (application_kind = 'settlement' AND due_id IS NULL)),
  CHECK (application_kind IN ('due', 'settlement'))
);
CREATE INDEX IF NOT EXISTS idx_credit_applications_credit ON public.student_credit_applications(credit_payment_id);
CREATE INDEX IF NOT EXISTS idx_credit_applications_due ON public.student_credit_applications(due_id) WHERE due_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_credit_applications_student ON public.student_credit_applications(center_id, student_id, created_at DESC);
ALTER TABLE public.student_credit_applications ENABLE ROW LEVEL SECURITY;

-- تسوية مديونية (إعفاء/تصحيح) بلا تحصيل نقدي وبلا إيراد مكرر.
CREATE TABLE IF NOT EXISTS public.student_due_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  center_id uuid NOT NULL REFERENCES public.centers(id) ON DELETE CASCADE,
  student_id text NOT NULL,
  due_id text NOT NULL REFERENCES public.dues(id) ON DELETE CASCADE,
  adjustment_kind text NOT NULL DEFAULT 'settlement',
  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  notes text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (adjustment_kind = 'settlement')
);
CREATE INDEX IF NOT EXISTS idx_due_adjustments_due ON public.student_due_adjustments(due_id);
CREATE INDEX IF NOT EXISTS idx_due_adjustments_student ON public.student_due_adjustments(center_id, student_id, created_at DESC);
ALTER TABLE public.student_due_adjustments ENABLE ROW LEVEL SECURITY;

-- ----------------------------------------------------------------------------
-- ٢) حاجز الصلاحيات: التحصيل للمالك أو عضو فعّال يحمل collect فقط.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.can_collect_in_center(p_center uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT auth.uid() IS NOT NULL
    AND public.center_is_active(p_center)
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND (
        p.role = 'super_admin'
        OR (p.role = 'center_admin' AND p.center_id = p_center)
        OR (p.role IN ('teacher', 'manager', 'secretary') AND p.center_id = p_center
            AND p.is_active AND coalesce((p.perms ->> 'collect')::boolean, false))
      )
    );
$$;
REVOKE ALL ON FUNCTION public.can_collect_in_center(uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.assert_collection_actor(p_center uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF NOT public.can_collect_in_center(p_center) THEN RAISE EXCEPTION 'not_allowed'; END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.assert_collection_actor(uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.assert_collection_owner(p_center uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF NOT public.center_is_active(p_center)
     OR NOT (public.admin_owns_center(p_center) OR public.my_role() = 'super_admin') THEN
    RAISE EXCEPTION 'not_allowed';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.assert_collection_owner(uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.can_record_attendance_in_center(p_center uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT auth.uid() IS NOT NULL
    AND public.center_is_active(p_center)
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND (
        p.role = 'super_admin'
        OR (p.role = 'center_admin' AND p.center_id = p_center)
        OR (p.role IN ('teacher', 'manager', 'secretary') AND p.center_id = p_center
            AND p.is_active AND coalesce((p.perms ->> 'attendance')::boolean, false))
      )
    );
$$;
REVOKE ALL ON FUNCTION public.can_record_attendance_in_center(uuid) FROM PUBLIC;

-- قفل موحد للحساب الواحد يمنع سباقات الرصيد المقدم مع التحصيل أو الحضور.
CREATE OR REPLACE FUNCTION public.lock_student_account(p_center uuid, p_student text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(p_center::text || ':' || p_student));
END;
$$;
REVOKE ALL ON FUNCTION public.lock_student_account(uuid, text) FROM PUBLIC;

-- ----------------------------------------------------------------------------
-- ٣) حساب المتبقي وتطبيق الرصيد المقدم (دوال داخلية، لا تُمنح للعميل)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.refresh_student_due_status(p_due text)
RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_amount numeric := 0; v_covered numeric := 0; v_remaining numeric := 0;
BEGIN
  SELECT amount INTO v_amount FROM public.dues WHERE id = p_due FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'due_not_found'; END IF;
  SELECT coalesce(sum(amount), 0) INTO v_covered FROM public.payments
   WHERE due_id = p_due AND payment_kind = 'due_payment';
  v_covered := v_covered + coalesce((SELECT sum(amount) FROM public.student_credit_applications
    WHERE due_id = p_due AND application_kind = 'due'), 0);
  v_covered := v_covered + coalesce((SELECT sum(amount) FROM public.student_due_adjustments
    WHERE due_id = p_due AND adjustment_kind = 'settlement'), 0);
  v_remaining := greatest(v_amount - v_covered, 0);
  UPDATE public.dues
  SET status = CASE WHEN v_remaining <= 0 THEN 'paid'
                    WHEN v_covered > 0 THEN 'partial' ELSE 'pending' END
  WHERE id = p_due;
  RETURN v_remaining;
END;
$$;
REVOKE ALL ON FUNCTION public.refresh_student_due_status(text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.apply_student_credit_to_due(p_center uuid, p_student text, p_due text)
RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_credit record; v_available numeric; v_remaining numeric; v_use numeric; v_used numeric := 0;
BEGIN
  PERFORM public.lock_student_account(p_center, p_student);
  SELECT id INTO v_credit FROM public.dues
   WHERE id = p_due AND center_id = p_center AND student_id = p_student FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'due_not_found'; END IF;
  v_remaining := public.refresh_student_due_status(p_due);
  IF v_remaining <= 0 THEN RETURN 0; END IF;

  FOR v_credit IN
    SELECT id, amount FROM public.payments
    WHERE center_id = p_center AND student_id = p_student AND payment_kind = 'credit'
    ORDER BY payment_date, created_at, id FOR UPDATE
  LOOP
    SELECT v_credit.amount - coalesce(sum(amount), 0) INTO v_available
    FROM public.student_credit_applications WHERE credit_payment_id = v_credit.id;
    v_available := greatest(coalesce(v_available, 0), 0);
    IF v_available <= 0 THEN CONTINUE; END IF;
    v_use := least(v_available, v_remaining);
    INSERT INTO public.student_credit_applications(
      center_id, student_id, credit_payment_id, due_id, application_kind, amount, created_by
    ) VALUES (p_center, p_student, v_credit.id, p_due, 'due', v_use, auth.uid());
    v_used := v_used + v_use;
    v_remaining := v_remaining - v_use;
    EXIT WHEN v_remaining <= 0;
  END LOOP;
  PERFORM public.refresh_student_due_status(p_due);
  RETURN v_used;
END;
$$;
REVOKE ALL ON FUNCTION public.apply_student_credit_to_due(uuid, text, text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.apply_student_credit_to_open_dues(p_center uuid, p_student text)
RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_due record; v_used numeric := 0;
BEGIN
  FOR v_due IN
    SELECT id FROM public.dues
    WHERE center_id = p_center AND student_id = p_student AND status <> 'paid'
    ORDER BY created_at, id FOR UPDATE
  LOOP
    v_used := v_used + public.apply_student_credit_to_due(p_center, p_student, v_due.id);
  END LOOP;
  RETURN v_used;
END;
$$;
REVOKE ALL ON FUNCTION public.apply_student_credit_to_open_dues(uuid, text) FROM PUBLIC;

-- ----------------------------------------------------------------------------
-- ٤) تسجيل دفعة مفردة آمن. p_due الفارغ = تحصيل مقدم ورصيد للطالب.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_payment(
  p_center uuid, p_student text, p_due text, p_amount numeric,
  p_month int, p_year int, p_notes text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_due numeric; v_paid numeric; v_remaining numeric; v_status text; v_name text;
  v_actor uuid := auth.uid(); v_pid text := gen_random_uuid()::text;
  v_has_due boolean := (p_due IS NOT NULL AND p_due <> ''); v_applied numeric := 0;
BEGIN
  PERFORM public.assert_collection_actor(p_center);
  IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'invalid_payment_amount'; END IF;
  IF p_month NOT BETWEEN 1 AND 12 OR p_year < 2000 THEN RAISE EXCEPTION 'invalid_payment_period'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.students WHERE id = p_student AND center_id = p_center) THEN
    RAISE EXCEPTION 'student_not_in_center';
  END IF;
  PERFORM public.lock_student_account(p_center, p_student);

  IF v_has_due THEN
    SELECT amount INTO v_due FROM public.dues
     WHERE id = p_due AND center_id = p_center AND student_id = p_student FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'due_not_found'; END IF;
    v_remaining := public.refresh_student_due_status(p_due);
    IF p_amount > v_remaining THEN RAISE EXCEPTION 'payment_exceeds_remaining'; END IF;
  END IF;

  SELECT full_name INTO v_name FROM public.profiles WHERE id = v_actor;
  INSERT INTO public.payments(
    id, center_id, student_id, due_id, amount, payment_date, month, payment_year,
    notes, collected_by, collected_by_name, payment_kind, created_at
  ) VALUES (
    v_pid, p_center, p_student, nullif(p_due, ''), p_amount, current_date, p_month, p_year,
    nullif(trim(coalesce(p_notes, '')), ''), v_actor, coalesce(v_name, ''),
    CASE WHEN v_has_due THEN 'due_payment' ELSE 'credit' END, now()
  );

  IF v_has_due THEN
    v_remaining := public.refresh_student_due_status(p_due);
    SELECT status INTO v_status FROM public.dues WHERE id = p_due;
  ELSE
    -- يحاول الرصيد الجديد تغطية أي مستحق قائم أولاً؛ والباقي يظل مقدماً للحضور التالي.
    v_applied := public.apply_student_credit_to_open_dues(p_center, p_student);
    v_status := 'credit';
  END IF;
  RETURN jsonb_build_object('id', v_pid, 'due_status', v_status, 'credit_applied', v_applied);
END;
$$;
GRANT EXECUTE ON FUNCTION public.record_payment(uuid, text, text, numeric, int, int, text) TO authenticated;

-- التحصيل الجماعي: الدفعات المختارة فقط داخل معاملة واحدة، ولا يوجد حفظ عند تحديد الكل.
CREATE OR REPLACE FUNCTION public.record_bulk_due_payments(
  p_center uuid, p_month int, p_year int, p_items jsonb, p_notes text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_item record; v_due record; v_count int := 0; v_total numeric := 0; v_amount numeric;
BEGIN
  PERFORM public.assert_collection_actor(p_center);
  IF p_month NOT BETWEEN 1 AND 12 OR p_year < 2000 OR jsonb_typeof(p_items) <> 'array' THEN
    RAISE EXCEPTION 'invalid_bulk_payment';
  END IF;
  IF jsonb_array_length(p_items) = 0 OR jsonb_array_length(p_items) > 500 THEN
    RAISE EXCEPTION 'invalid_bulk_payment';
  END IF;
  -- ترتيب ثابت يقلل فرص التعارض عند وجود محصلين في نفس اللحظة.
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) ORDER BY value ->> 'due_id' LOOP
    IF coalesce(v_item.value ->> 'due_id', '') = '' THEN RAISE EXCEPTION 'invalid_bulk_payment'; END IF;
    v_amount := nullif(v_item.value ->> 'amount', '')::numeric;
    IF v_amount IS NULL OR v_amount <= 0 THEN RAISE EXCEPTION 'invalid_bulk_payment'; END IF;
    SELECT student_id INTO v_due FROM public.dues
     WHERE id = v_item.value ->> 'due_id' AND center_id = p_center FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'due_not_found'; END IF;
    PERFORM public.record_payment(p_center, v_due.student_id, v_item.value ->> 'due_id', v_amount, p_month, p_year, p_notes);
    v_count := v_count + 1; v_total := v_total + v_amount;
  END LOOP;
  RETURN jsonb_build_object('count', v_count, 'total', v_total);
END;
$$;
GRANT EXECUTE ON FUNCTION public.record_bulk_due_payments(uuid, int, int, jsonb, text) TO authenticated;

-- ----------------------------------------------------------------------------
-- ٥) المستحق اليدوي للمجموعة عبر RPC؛ لا يختلط بمجموعة الاستحقاق بالحضور.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.generate_manual_dues_for_group(
  p_center uuid, p_group text, p_month int, p_year int
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_group public.groups%ROWTYPE; v_amount numeric := 0; v_sessions int := 0; v_created int := 0;
BEGIN
  PERFORM public.assert_collection_actor(p_center);
  IF p_month NOT BETWEEN 1 AND 12 OR p_year < 2000 THEN RAISE EXCEPTION 'invalid_due_period'; END IF;
  SELECT * INTO v_group FROM public.groups WHERE id = p_group AND center_id = p_center FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'group_not_found'; END IF;
  IF v_group.due_mode = 'attendance' THEN RAISE EXCEPTION 'group_uses_attendance_dues'; END IF;

  IF v_group.billing_type = 'weekly' THEN
    v_amount := coalesce(v_group.weekly_price, 0) * 4;
  ELSIF v_group.billing_type = 'per_session' THEN
    SELECT count(*) INTO v_sessions FROM public.sessions
      WHERE center_id = p_center AND group_id = p_group
        AND extract(month FROM session_date) = p_month AND extract(year FROM session_date) = p_year;
    IF v_sessions = 0 THEN RETURN jsonb_build_object('created', 0, 'amount', 0, 'skipped_no_sessions', true); END IF;
    v_amount := coalesce(v_group.session_price, 0) * v_sessions;
  ELSE
    v_amount := coalesce(v_group.monthly_fee, 0);
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(p_center::text || ':' || p_group || ':' || p_year::text || ':' || p_month::text));
  INSERT INTO public.dues(id, center_id, student_id, group_id, month, due_year, amount, status, due_source, created_at)
  SELECT gen_random_uuid()::text, p_center, s.id, p_group, p_month, p_year, v_amount, 'pending', 'manual', now()
  FROM public.students s
  WHERE s.center_id = p_center AND s.status = 'active'
    AND (s.group_id = p_group OR EXISTS (
      SELECT 1 FROM public.student_groups sg WHERE sg.center_id = p_center AND sg.group_id = p_group AND sg.student_id = s.id
    ))
    AND NOT EXISTS (
      SELECT 1 FROM public.dues d WHERE d.center_id = p_center AND d.student_id = s.id AND d.group_id = p_group
        AND d.month = p_month AND d.due_year = p_year AND d.due_source = 'manual'
    );
  GET DIAGNOSTICS v_created = ROW_COUNT;
  RETURN jsonb_build_object('created', v_created, 'amount', v_amount, 'skipped_no_sessions', false);
END;
$$;
GRANT EXECUTE ON FUNCTION public.generate_manual_dues_for_group(uuid, text, int, int) TO authenticated;

-- ----------------------------------------------------------------------------
-- ٦) إنشاء/مزامنة مستحق الحضور: مرة لكل حاضر أو متأخر، ويخصم الرصيد تلقائياً.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_attendance_dues_for_session(p_center uuid, p_session text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_session public.sessions%ROWTYPE; v_group public.groups%ROWTYPE; v_due_id text; v_student_id text;
  v_created int := 0; v_removed int := 0; v_applied numeric := 0;
BEGIN
  IF NOT public.can_record_attendance_in_center(p_center) THEN RAISE EXCEPTION 'not_allowed'; END IF;
  SELECT * INTO v_session FROM public.sessions WHERE id = p_session AND center_id = p_center FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'session_not_found'; END IF;
  SELECT * INTO v_group FROM public.groups WHERE id = v_session.group_id AND center_id = p_center FOR UPDATE;
  IF NOT FOUND OR v_group.due_mode <> 'attendance' OR coalesce(v_group.attendance_due_amount, 0) <= 0 THEN
    RETURN jsonb_build_object('created', 0, 'removed', 0, 'credit_applied', 0);
  END IF;

  -- عند تصحيح الحضور إلى غياب، نحذف المستحق الآلي فقط إن لم يدخل له تحصيل نقدي.
  WITH removed AS (
    DELETE FROM public.dues d
    WHERE d.center_id = p_center AND d.session_id = p_session AND d.due_source = 'attendance'
      AND NOT EXISTS (SELECT 1 FROM public.attendance a WHERE a.session_id = p_session
                      AND a.student_id = d.student_id AND a.status IN ('present', 'late'))
      AND NOT EXISTS (SELECT 1 FROM public.payments p WHERE p.due_id = d.id AND p.payment_kind = 'due_payment')
    RETURNING id
  ) SELECT count(*) INTO v_removed FROM removed;

  FOR v_due_id IN
    INSERT INTO public.dues(id, center_id, student_id, group_id, month, due_year, amount, status, due_source, session_id, created_at)
    SELECT gen_random_uuid()::text, p_center, a.student_id, v_session.group_id,
      extract(month FROM v_session.session_date)::int, extract(year FROM v_session.session_date)::int,
      v_group.attendance_due_amount, 'pending', 'attendance', p_session, now()
    FROM public.attendance a
    JOIN public.students s ON s.id = a.student_id AND s.center_id = p_center
    WHERE a.center_id = p_center AND a.session_id = p_session AND a.status IN ('present', 'late')
    ON CONFLICT (session_id, student_id) WHERE due_source = 'attendance' DO NOTHING
    RETURNING id
  LOOP
    v_created := v_created + 1;
    SELECT student_id INTO v_student_id FROM public.dues WHERE id = v_due_id;
    v_applied := v_applied + public.apply_student_credit_to_due(p_center, v_student_id, v_due_id);
  END LOOP;
  RETURN jsonb_build_object('created', v_created, 'removed', v_removed, 'credit_applied', v_applied);
END;
$$;
GRANT EXECUTE ON FUNCTION public.sync_attendance_dues_for_session(uuid, text) TO authenticated;

-- ----------------------------------------------------------------------------
-- ٧) كشف حساب موحد وتسوية رصيد إلى صفر بلا دفعة/إيراد مكرر.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_student_account(p_center uuid, p_student text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_student public.students%ROWTYPE; v_credit numeric := 0; v_debt numeric := 0;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF NOT (public.can_collect_in_center(p_center)
    OR (public.my_center_id() = p_center AND public.my_student_id() = p_student)) THEN
    RAISE EXCEPTION 'not_allowed';
  END IF;
  SELECT * INTO v_student FROM public.students WHERE id = p_student AND center_id = p_center;
  IF NOT FOUND THEN RAISE EXCEPTION 'student_not_in_center'; END IF;

  WITH credit_lines AS (
    SELECT p.id, p.amount, p.payment_date, p.notes, p.created_at,
      p.amount - coalesce((SELECT sum(a.amount) FROM public.student_credit_applications a WHERE a.credit_payment_id = p.id), 0) AS remaining,
      coalesce((SELECT sum(a.amount) FROM public.student_credit_applications a WHERE a.credit_payment_id = p.id AND a.application_kind = 'due'), 0) AS applied_to_dues,
      coalesce((SELECT sum(a.amount) FROM public.student_credit_applications a WHERE a.credit_payment_id = p.id AND a.application_kind = 'settlement'), 0) AS settled_amount
    FROM public.payments p WHERE p.center_id = p_center AND p.student_id = p_student AND p.payment_kind = 'credit'
  ), due_lines AS (
    SELECT d.id, d.group_id, d.month, d.due_year, d.amount, d.status, d.due_source, d.session_id, d.created_at,
      coalesce((SELECT sum(p.amount) FROM public.payments p WHERE p.due_id = d.id AND p.payment_kind = 'due_payment'), 0) AS cash_paid,
      coalesce((SELECT sum(a.amount) FROM public.student_credit_applications a WHERE a.due_id = d.id AND a.application_kind = 'due'), 0) AS credit_applied,
      coalesce((SELECT sum(a.amount) FROM public.student_due_adjustments a WHERE a.due_id = d.id AND a.adjustment_kind = 'settlement'), 0) AS settled_amount
    FROM public.dues d WHERE d.center_id = p_center AND d.student_id = p_student
  )
  SELECT coalesce((SELECT sum(greatest(remaining, 0)) FROM credit_lines), 0),
         coalesce((SELECT sum(greatest(amount - cash_paid - credit_applied - settled_amount, 0)) FROM due_lines), 0)
    INTO v_credit, v_debt;

  RETURN (
    WITH credit_lines AS (
      SELECT p.id, p.amount, p.payment_date, p.notes, p.created_at,
        p.amount - coalesce((SELECT sum(a.amount) FROM public.student_credit_applications a WHERE a.credit_payment_id = p.id), 0) AS remaining,
        coalesce((SELECT sum(a.amount) FROM public.student_credit_applications a WHERE a.credit_payment_id = p.id AND a.application_kind = 'due'), 0) AS applied_to_dues,
        coalesce((SELECT sum(a.amount) FROM public.student_credit_applications a WHERE a.credit_payment_id = p.id AND a.application_kind = 'settlement'), 0) AS settled_amount
      FROM public.payments p WHERE p.center_id = p_center AND p.student_id = p_student AND p.payment_kind = 'credit'
    ), due_lines AS (
      SELECT d.id, d.group_id, d.month, d.due_year, d.amount, d.status, d.due_source, d.session_id, d.created_at,
        coalesce((SELECT sum(p.amount) FROM public.payments p WHERE p.due_id = d.id AND p.payment_kind = 'due_payment'), 0) AS cash_paid,
        coalesce((SELECT sum(a.amount) FROM public.student_credit_applications a WHERE a.due_id = d.id AND a.application_kind = 'due'), 0) AS credit_applied,
        coalesce((SELECT sum(a.amount) FROM public.student_due_adjustments a WHERE a.due_id = d.id AND a.adjustment_kind = 'settlement'), 0) AS settled_amount
      FROM public.dues d WHERE d.center_id = p_center AND d.student_id = p_student
    )
    SELECT jsonb_build_object(
      'student', jsonb_build_object('id', v_student.id, 'name', v_student.name, 'phone', v_student.phone, 'guardian_phone', v_student.guardian_phone),
      'summary', jsonb_build_object('credit_balance', v_credit, 'amount_due', v_debt, 'net_balance', v_credit - v_debt),
      'dues', coalesce((SELECT jsonb_agg(jsonb_build_object(
        'id', dl.id, 'group_id', dl.group_id, 'month', dl.month, 'due_year', dl.due_year, 'amount', dl.amount,
        'cash_paid', dl.cash_paid, 'credit_applied', dl.credit_applied, 'settled_amount', dl.settled_amount,
        'remaining', greatest(dl.amount - dl.cash_paid - dl.credit_applied - dl.settled_amount, 0),
        'status', dl.status, 'due_source', dl.due_source, 'session_id', dl.session_id, 'created_at', dl.created_at
      ) ORDER BY dl.created_at DESC) FROM due_lines dl), '[]'::jsonb),
      'credits', coalesce((SELECT jsonb_agg(jsonb_build_object(
        'id', cl.id, 'amount', cl.amount, 'remaining', greatest(cl.remaining, 0), 'applied_to_dues', cl.applied_to_dues,
        'settled_amount', cl.settled_amount, 'payment_date', cl.payment_date, 'notes', cl.notes, 'created_at', cl.created_at
      ) ORDER BY cl.created_at DESC) FROM credit_lines cl), '[]'::jsonb),
      'settlements', coalesce((SELECT jsonb_agg(jsonb_build_object(
        'amount', a.amount, 'notes', a.notes, 'created_at', a.created_at, 'kind', 'debt_settlement'
      ) ORDER BY a.created_at DESC) FROM public.student_due_adjustments a WHERE a.center_id = p_center AND a.student_id = p_student), '[]'::jsonb)
    )
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_student_account(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.settle_student_account(p_center uuid, p_student text, p_notes text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_credit record; v_due record; v_available numeric; v_remaining numeric; v_use numeric;
  v_credit_settled numeric := 0; v_debt_settled numeric := 0;
BEGIN
  PERFORM public.assert_collection_owner(p_center);
  IF NOT EXISTS (SELECT 1 FROM public.students WHERE id = p_student AND center_id = p_center) THEN
    RAISE EXCEPTION 'student_not_in_center';
  END IF;
  PERFORM public.lock_student_account(p_center, p_student);
  -- أي رصيد ومديونية قابلة للمقاصة تُطبّق أولاً حتى لا نلغي مبلغاً كان يمكن تغطية مستحق به.
  PERFORM public.apply_student_credit_to_open_dues(p_center, p_student);

  FOR v_credit IN
    SELECT id, amount FROM public.payments
    WHERE center_id = p_center AND student_id = p_student AND payment_kind = 'credit'
    ORDER BY payment_date, created_at, id FOR UPDATE
  LOOP
    SELECT v_credit.amount - coalesce(sum(amount), 0) INTO v_available
      FROM public.student_credit_applications WHERE credit_payment_id = v_credit.id;
    v_available := greatest(coalesce(v_available, 0), 0);
    IF v_available > 0 THEN
      INSERT INTO public.student_credit_applications(center_id, student_id, credit_payment_id, application_kind, amount, notes, created_by)
      VALUES (p_center, p_student, v_credit.id, 'settlement', v_available, nullif(trim(coalesce(p_notes, '')), ''), auth.uid());
      v_credit_settled := v_credit_settled + v_available;
    END IF;
  END LOOP;

  FOR v_due IN
    SELECT id, amount FROM public.dues WHERE center_id = p_center AND student_id = p_student AND status <> 'paid'
    ORDER BY created_at, id FOR UPDATE
  LOOP
    v_remaining := public.refresh_student_due_status(v_due.id);
    IF v_remaining > 0 THEN
      INSERT INTO public.student_due_adjustments(center_id, student_id, due_id, adjustment_kind, amount, notes, created_by)
      VALUES (p_center, p_student, v_due.id, 'settlement', v_remaining, nullif(trim(coalesce(p_notes, '')), ''), auth.uid());
      v_debt_settled := v_debt_settled + v_remaining;
      PERFORM public.refresh_student_due_status(v_due.id);
    END IF;
  END LOOP;
  RETURN jsonb_build_object('credit_settled', v_credit_settled, 'debt_settled', v_debt_settled);
END;
$$;
GRANT EXECUTE ON FUNCTION public.settle_student_account(uuid, text, text) TO authenticated;

COMMIT;
