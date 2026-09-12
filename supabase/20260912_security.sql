-- ============================================================================
--  Mr Center — ترقية الأمان (2026-09-12)
--  شغّل هذا الملف بعد android_multitenant_schema.sql و 20260912_fiscal_accounting.sql
--  الملف idempotent: يمكن إعادة تشغيله بأمان.
--  لا يحتوي على service_role أو أي مفتاح سري.
--
--  ماذا يضيف:
--   ١) تسجيل الدفعات ذرياً (منع السباق/التحصيل المزدوج): record_payment RPC
--      يقفل صف المستحق ويمنع تجاوز المبلغ من جهازين في نفس اللحظة.
--   ٢) جلسة واحدة لكل حساب: user_active_sessions + claim_session/check_session
--      (تسجيل الدخول من جهاز ثانٍ يُخرج الجهاز الأول تلقائياً).
--   ٣) تحسين submit_exam_attempt لمنع تكرار المحاولة حتى تحت التزامن.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- ١) تحصيل آمن من السباق (Race-Condition Safe)
--    يقفل صف المستحق FOR UPDATE ثم يتحقق من المتبقي قبل الإدراج.
-- ----------------------------------------------------------------------------
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
    -- قفل صف المستحق: أي عملية تحصيل أخرى لنفس المستحق تنتظر حتى تنتهي هذه
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

-- ----------------------------------------------------------------------------
-- ٢) جلسة واحدة لكل حساب (منع الدخول من جهازين في نفس الوقت)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_active_sessions (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  session_key text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  last_seen timestamptz NOT NULL DEFAULT now()
);
-- لا سياسات قراءة/كتابة مباشرة: الوصول عبر الدوال فقط (SECURITY DEFINER)
ALTER TABLE public.user_active_sessions ENABLE ROW LEVEL SECURITY;

-- يطالب بالجلسة عند تسجيل الدخول: آخر جهاز يسجل دخولاً يستحوذ على الجلسة
CREATE OR REPLACE FUNCTION public.claim_session(p_key text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF p_key IS NULL OR length(p_key) < 8 OR length(p_key) > 128 THEN RAISE EXCEPTION 'invalid_session_key'; END IF;
  INSERT INTO public.user_active_sessions(user_id, session_key, started_at, last_seen)
  VALUES(auth.uid(), p_key, now(), now())
  ON CONFLICT (user_id) DO UPDATE
    SET session_key = EXCLUDED.session_key, started_at = now(), last_seen = now();
END; $$;
GRANT EXECUTE ON FUNCTION public.claim_session(text) TO authenticated;

-- يتحقق الجهاز دورياً أنه لا يزال صاحب الجلسة الحالية
CREATE OR REPLACE FUNCTION public.check_session(p_key text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN false; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.user_active_sessions WHERE user_id = auth.uid() AND session_key = p_key) THEN
    RETURN false;
  END IF;
  UPDATE public.user_active_sessions SET last_seen = now()
  WHERE user_id = auth.uid() AND session_key = p_key;
  RETURN true;
END; $$;
GRANT EXECUTE ON FUNCTION public.check_session(text) TO authenticated;

-- ----------------------------------------------------------------------------
-- ٣) منع تكرار محاولة الامتحان حتى تحت التزامن (ON CONFLICT بدل الفحص ثم الإدراج)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.submit_exam_attempt(p_exam_id TEXT, p_answers JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_center UUID := public.my_center_id();
  v_sid TEXT := public.my_student_id();
  v_exam public.app_exams%ROWTYPE;
  v_n INT := 0;
  v_total_marks NUMERIC := 0;
  v_earned NUMERIC := 0;
  v_correct INT := 0;
  v_has_essay BOOLEAN := false;
  v_status TEXT;
  i INT;
  v_q JSONB;
  v_type TEXT;
  v_marks NUMERIC;
BEGIN
  IF v_center IS NULL OR v_sid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  SELECT * INTO v_exam FROM public.app_exams
   WHERE id = p_exam_id AND center_id = v_center AND is_published;
  IF NOT FOUND THEN RAISE EXCEPTION 'exam_not_found'; END IF;
  IF EXISTS (SELECT 1 FROM public.app_exam_attempts WHERE exam_id = p_exam_id AND student_id = v_sid) THEN
    RAISE EXCEPTION 'already_attempted';
  END IF;
  v_n := COALESCE(jsonb_array_length(v_exam.questions), 0);
  FOR i IN 0..v_n - 1 LOOP
    v_q := v_exam.questions -> i;
    v_type := COALESCE(v_q ->> 'type', 'mcq');
    v_marks := COALESCE(NULLIF(v_q ->> 'marks', '')::NUMERIC, 1);
    v_total_marks := v_total_marks + v_marks;
    IF v_type = 'correct' AND (v_exam.answers -> i) IS NOT NULL
      AND (v_exam.answers -> i) = (COALESCE(p_answers, '[]'::jsonb) -> i) THEN
      v_correct := v_correct + 1;
      v_earned := v_earned + v_marks;
    ELSIF v_type IN ('essay', 'correct', 'short') THEN
      v_has_essay := true;
    ELSIF (v_exam.answers -> i) IS NOT NULL
      AND (v_exam.answers -> i) = (COALESCE(p_answers, '[]'::jsonb) -> i) THEN
      v_correct := v_correct + 1;
      v_earned := v_earned + v_marks;
    END IF;
  END LOOP;
  IF v_total_marks <= 0 THEN v_total_marks := COALESCE(v_exam.total_score, 0); END IF;
  v_status := CASE WHEN v_has_essay THEN 'pending_review' ELSE 'graded' END;
  INSERT INTO public.app_exam_attempts (id, center_id, exam_id, student_id, answers, score, max_score, status)
  VALUES (gen_random_uuid()::text, v_center, p_exam_id, v_sid, COALESCE(p_answers, '[]'::jsonb),
          ROUND(v_earned, 2), v_total_marks, v_status)
  ON CONFLICT (exam_id, student_id) DO NOTHING;
  IF NOT FOUND THEN RAISE EXCEPTION 'already_attempted'; END IF;
  RETURN jsonb_build_object('score', ROUND(v_earned, 2), 'max_score', v_total_marks,
                            'correct', v_correct, 'total', v_n, 'status', v_status);
END; $$;
GRANT EXECUTE ON FUNCTION public.submit_exam_attempt(TEXT, JSONB) TO authenticated;

-- ----------------------------------------------------------------------------
-- ٤) حماية من هجمات تخمين كلمات المرور والروبوتات (Rate Limiting خادمي)
--    لا يعتمد على أي تقرير من المتصفح وحده: الفحص يُجرى قبل كل محاولة دخول.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.login_attempts (
  id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  email text NOT NULL,
  device_id text NOT NULL DEFAULT '',
  success boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_login_attempts_email_time ON public.login_attempts (email, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_login_attempts_device_time ON public.login_attempts (device_id, created_at DESC);
ALTER TABLE public.login_attempts ENABLE ROW LEVEL SECURITY;

-- يُستدعى قبل محاولة الدخول: يمنع تجاوز الحد الأقصى من المحاولات الفاشلة
CREATE OR REPLACE FUNCTION public.check_login_allowed(p_email text, p_device text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_failures int;
BEGIN
  -- تنظيف دوري للسجلات القديمة حتى لا يتضخم الجدول
  DELETE FROM public.login_attempts WHERE created_at < now() - interval '24 hours';
  SELECT count(*) INTO v_failures FROM public.login_attempts
   WHERE email = lower(trim(p_email)) AND success = false AND created_at > now() - interval '15 minutes';
  IF v_failures >= 10 THEN RAISE EXCEPTION 'login_rate_limited'; END IF;
  IF p_device IS NOT NULL AND p_device <> '' THEN
    SELECT count(*) INTO v_failures FROM public.login_attempts
     WHERE device_id = p_device AND success = false AND created_at > now() - interval '15 minutes';
    IF v_failures >= 30 THEN RAISE EXCEPTION 'login_rate_limited'; END IF;
  END IF;
END; $$;
GRANT EXECUTE ON FUNCTION public.check_login_allowed(text, text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.record_login_attempt(p_email text, p_device text, p_success boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.login_attempts(email, device_id, success, created_at)
  VALUES (lower(trim(p_email)), COALESCE(p_device, ''), p_success, now());
END; $$;
GRANT EXECUTE ON FUNCTION public.record_login_attempt(text, text, boolean) TO anon, authenticated;

COMMIT;

-- بعد التشغيل تحقق من:
--   SELECT * FROM public.user_active_sessions;  (صف واحد لكل مستخدم نشط)
--   وجرّب الدخول من جهازين لنفس الحساب — يجب أن يخرج الأول فوراً.
