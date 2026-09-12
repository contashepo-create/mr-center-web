-- ============================================================================
--  إصلاح أسماء أعمدة السنوات + علاقة الحضور بالحصص + دالة التحصيل
-- ----------------------------------------------------------------------------
--  المشكلة: الويب كان يستعلم عن dues.year / manual_grades.year / payments.year
--  بينما المخطط الموحد يستخدم due_year / grade_year / payment_year،
--  ودالة record_payment القديمة كانت تُدرج في عمود payments.year غير الموجود،
--  ولم تكن هناك علاقة foreign key بين attendance.session_id و sessions.id.
--
--  هذا الملف آمن لإعادة التشغيل (idempotent) ويُصلح قاعدة البيانات الحية:
--    ١) يعيد إنشاء record_payment(uuid,text,text,numeric,int,int,text) بأعمدة صحيحة
--    ٢) يضيف foreign key بين attendance و sessions (دون فحص الصفوف القديمة)
--    ٣) يضمن وجود أعمدة السنوات الصحيحة على الجداول الثلاثة
-- ============================================================================

BEGIN;

-- ١) ضمان وجود أعمدة السنوات الصحيحة (في حال غابت لسبب ما)
ALTER TABLE public.dues          ADD COLUMN IF NOT EXISTS due_year INT;
ALTER TABLE public.payments      ADD COLUMN IF NOT EXISTS payment_year INT;
ALTER TABLE public.manual_grades ADD COLUMN IF NOT EXISTS grade_year INT;

-- إن كانت نسخة قديمة ما تزال تستخدم عمود year، انسخ قيمه إلى العمود الصحيح ثم أسقطه
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='dues' AND column_name='year') THEN
    UPDATE public.dues SET due_year = COALESCE(due_year, year) WHERE due_year IS NULL;
    ALTER TABLE public.dues DROP COLUMN year;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='payments' AND column_name='year') THEN
    UPDATE public.payments SET payment_year = COALESCE(payment_year, year) WHERE payment_year IS NULL;
    ALTER TABLE public.payments DROP COLUMN year;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='manual_grades' AND column_name='year') THEN
    UPDATE public.manual_grades SET grade_year = COALESCE(grade_year, year) WHERE grade_year IS NULL;
    ALTER TABLE public.manual_grades DROP COLUMN year;
  END IF;
END $$;

-- ٢) علاقة الحضور بالحصص حتى تعمل الاستعلامات المدمجة والربط في PostgREST
ALTER TABLE public.attendance DROP CONSTRAINT IF EXISTS attendance_session_id_fkey;
ALTER TABLE public.attendance
  ADD CONSTRAINT attendance_session_id_fkey
  FOREIGN KEY (session_id) REFERENCES public.sessions(id) ON DELETE CASCADE
  NOT VALID;

-- ٣) إعادة إنشاء دالة التحصيل الآمن بأعمدة صحيحة (نفس توقيع نسخة security)
DROP FUNCTION IF EXISTS public.record_payment(uuid, text, text, numeric, int, int, text);
CREATE OR REPLACE FUNCTION public.record_payment(
  p_center uuid, p_student text, p_due text, p_amount numeric,
  p_month int, p_year int, p_notes text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_due numeric; v_paid numeric; v_status text; v_name text;
  v_actor uuid := auth.uid(); v_pid text := gen_random_uuid()::text;
  v_has_due boolean := (p_due IS NOT NULL AND p_due <> '');
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF NOT public.center_is_active(p_center) THEN RAISE EXCEPTION 'center_inactive'; END IF;
  IF NOT (public.admin_owns_center(p_center) OR public.teacher_center_ok(p_center)) THEN
    RAISE EXCEPTION 'not_allowed';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'invalid_payment_amount'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.students WHERE id = p_student AND center_id = p_center) THEN
    RAISE EXCEPTION 'student_not_in_center';
  END IF;

  IF v_has_due THEN
    SELECT amount INTO v_due FROM public.dues WHERE id = p_due AND center_id = p_center FOR UPDATE;
    IF v_due IS NULL THEN RAISE EXCEPTION 'due_not_found'; END IF;
    SELECT COALESCE(SUM(amount), 0) INTO v_paid FROM public.payments WHERE due_id = p_due;
    IF p_amount > (v_due - v_paid) THEN RAISE EXCEPTION 'payment_exceeds_remaining'; END IF;
    v_status := CASE WHEN v_paid + p_amount >= v_due THEN 'paid' ELSE 'partial' END;
  END IF;

  SELECT full_name INTO v_name FROM public.profiles WHERE id = v_actor;

  INSERT INTO public.payments(id, center_id, student_id, due_id, amount, payment_date, month, payment_year, notes, collected_by, collected_by_name, created_at)
  VALUES (v_pid, p_center, p_student, nullif(p_due, ''), p_amount, CURRENT_DATE, p_month, p_year, nullif(p_notes, ''), v_actor, COALESCE(v_name, ''), now());

  IF v_has_due THEN
    UPDATE public.dues SET status = v_status WHERE id = p_due;
  END IF;

  RETURN jsonb_build_object('id', v_pid, 'due_status', v_status);
END; $$;
GRANT EXECUTE ON FUNCTION public.record_payment(uuid, text, text, numeric, int, int, text) TO authenticated;

COMMIT;
