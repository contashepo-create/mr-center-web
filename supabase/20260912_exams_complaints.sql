-- ============================================================================
--  Mr Center — الاختبارات (محاولات متعددة + طرق عرض النتيجة) + قسم الشكاوي
--  التاريخ: 2026-09-12
--  شغّل هذا الملف بعد android_multitenant_schema.sql و 20260912_security.sql
--  الملف idempotent: يمكن إعادة تشغيله بأمان.
--  لا يحتوي على service_role أو أي مفتاح سري.
--
--  ماذا يضيف:
--   ١) app_exams: attempts_allowed (عدد المحاولات لكل طالب) + show_result
--      (after_each | end | never) للتحكم في إظهار النتيجة للطالب.
--   ٢) السماح بأكثر من محاولة واحدة عبر إزالة القيد الفريد (exam_id, student_id)
--      والتحقق من العدد داخل submit_exam_attempt خادمياً.
--   ٣) قسم الشكاوي العام (حتى للزوار): جدول complaints + دوال إرسال/تتبع
--      محمية بحد محاولات خادمي، آمنة من الحقن (كل الإدخال عبر معاملات)،
--      وتتبع برقم الهاتف ورقم الشكوى مع تذكير المستخدم بالاحتفاظ بالرقم.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- ١) أعمدة الاختبارات الجديدة
-- ----------------------------------------------------------------------------
ALTER TABLE public.app_exams ADD COLUMN IF NOT EXISTS attempts_allowed INT NOT NULL DEFAULT 1;
ALTER TABLE public.app_exams ADD COLUMN IF NOT EXISTS show_result TEXT NOT NULL DEFAULT 'end'
  CHECK (show_result IN ('after_each', 'end', 'never'));

-- السماح بعدة محاولات: إزالة القيد الفريد القديم (يبقى الفهرس للسرعة)
ALTER TABLE public.app_exam_attempts DROP CONSTRAINT IF EXISTS app_exam_attempts_exam_id_student_id_key;
CREATE INDEX IF NOT EXISTS idx_app_attempts_exam_student ON public.app_exam_attempts(exam_id, student_id);

-- ----------------------------------------------------------------------------
-- ٢) الامتحانات المنشورة: تعرض عدد المحاولات المسموح والمستخدم وطريقة النتيجة
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_published_exams()
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_center UUID := public.my_center_id();
  v_sid TEXT := public.my_student_id();
BEGIN
  IF v_center IS NULL OR v_sid IS NULL THEN RETURN '[]'::jsonb; END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', e.id, 'title', e.title, 'subject', e.subject, 'grade_id', e.grade_id,
      'duration_minutes', e.duration_minutes, 'total_score', e.total_score,
      'questions', e.questions, 'created_at', e.created_at,
      'attempts_allowed', COALESCE(NULLIF(e.attempts_allowed, 0), 1),
      'attempts_used', (
        SELECT count(*) FROM public.app_exam_attempts a
        WHERE a.exam_id = e.id AND a.student_id = v_sid
      ),
      'show_result', COALESCE(e.show_result, 'end')
    ) ORDER BY e.created_at DESC)
    FROM public.app_exams e
    WHERE e.center_id = v_center AND e.is_published
  ), '[]'::jsonb);
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_published_exams() TO authenticated;

-- ----------------------------------------------------------------------------
-- ٣) تسليم الامتحان مع عدد المحاولات ونتائج كل سؤال (لطريقة after_each)
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
  v_allowed INT;
  v_used INT;
  i INT;
  v_q JSONB;
  v_type TEXT;
  v_marks NUMERIC;
  v_results JSONB := '[]'::jsonb;
  v_ok BOOLEAN;
  v_earn NUMERIC;
BEGIN
  IF v_center IS NULL OR v_sid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  SELECT * INTO v_exam FROM public.app_exams
   WHERE id = p_exam_id AND center_id = v_center AND is_published;
  IF NOT FOUND THEN RAISE EXCEPTION 'exam_not_found'; END IF;

  v_allowed := COALESCE(NULLIF(v_exam.attempts_allowed, 0), 1);
  SELECT count(*) INTO v_used FROM public.app_exam_attempts
   WHERE exam_id = p_exam_id AND student_id = v_sid;
  IF v_used >= v_allowed THEN RAISE EXCEPTION 'attempts_exhausted'; END IF;

  v_n := COALESCE(jsonb_array_length(v_exam.questions), 0);
  FOR i IN 0..v_n - 1 LOOP
    v_q := v_exam.questions -> i;
    v_type := COALESCE(v_q ->> 'type', 'mcq');
    v_marks := COALESCE(NULLIF(v_q ->> 'marks', '')::NUMERIC, 1);
    v_total_marks := v_total_marks + v_marks;
    v_ok := false;
    v_earn := 0;
    IF v_type = 'correct' AND (v_exam.answers -> i) IS NOT NULL
      AND (v_exam.answers -> i) = (COALESCE(p_answers, '[]'::jsonb) -> i) THEN
      v_ok := true; v_earn := v_marks;
      v_correct := v_correct + 1; v_earned := v_earned + v_marks;
    ELSIF v_type IN ('essay', 'correct', 'short') THEN
      v_has_essay := true;
      v_results := v_results || jsonb_build_object('q', i, 'correct', NULL, 'earned', 0, 'marks', v_marks, 'model', (v_exam.answers -> i));
      CONTINUE;
    ELSIF (v_exam.answers -> i) IS NOT NULL
      AND (v_exam.answers -> i) = (COALESCE(p_answers, '[]'::jsonb) -> i) THEN
      v_ok := true; v_earn := v_marks;
      v_correct := v_correct + 1; v_earned := v_earned + v_marks;
    END IF;
    v_results := v_results || jsonb_build_object('q', i, 'correct', v_ok, 'earned', v_earn, 'marks', v_marks, 'model', (v_exam.answers -> i));
  END LOOP;

  IF v_total_marks <= 0 THEN v_total_marks := COALESCE(v_exam.total_score, 0); END IF;
  v_status := CASE WHEN v_has_essay THEN 'pending_review' ELSE 'graded' END;

  INSERT INTO public.app_exam_attempts (id, center_id, exam_id, student_id, answers, score, max_score, status)
  VALUES (gen_random_uuid()::text, v_center, p_exam_id, v_sid, COALESCE(p_answers, '[]'::jsonb),
          ROUND(v_earned, 2), v_total_marks, v_status);

  RETURN jsonb_build_object(
    'score', ROUND(v_earned, 2), 'max_score', v_total_marks,
    'correct', v_correct, 'total', v_n, 'status', v_status,
    'attempts_used', v_used + 1, 'attempts_allowed', v_allowed,
    'per_question', v_results
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.submit_exam_attempt(TEXT, JSONB) TO authenticated;

-- ----------------------------------------------------------------------------
-- ٤) قسم الشكاوي العام (متاح للزوار بلا تسجيل) — محمي بحد محاولات ومن الحقن
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.complaints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_no text NOT NULL UNIQUE,
  phone text NOT NULL,
  name text NOT NULL DEFAULT '',
  subject text NOT NULL DEFAULT '',
  body text NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','closed')),
  device_id text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_complaints_phone_time ON public.complaints(phone, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_complaints_device_time ON public.complaints(device_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_complaints_ticket ON public.complaints(ticket_no);
ALTER TABLE public.complaints ENABLE ROW LEVEL SECURITY;
-- لا سياسات قراءة/كتابة مباشرة: كل الوصول عبر الدوال الآمنة أدناه.

-- إرسال شكوى جديدة: يتحقق من صحة المدخلات ويطبّق حد المحاولات ويولّد رقم تتبع
CREATE OR REPLACE FUNCTION public.submit_complaint(
  p_phone TEXT, p_name TEXT, p_subject TEXT, p_body TEXT, p_device TEXT DEFAULT ''
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_phone TEXT := regexp_replace(COALESCE(p_phone, ''), '[^0-9]', '', 'g');
  v_name TEXT := left(trim(COALESCE(p_name, '')), 80);
  v_subject TEXT := left(trim(COALESCE(p_subject, '')), 200);
  v_body TEXT := left(trim(COALESCE(p_body, '')), 2000);
  v_device TEXT := left(COALESCE(p_device, ''), 128);
  v_ticket TEXT;
  v_recent INT;
BEGIN
  IF length(v_phone) < 8 OR length(v_phone) > 15 THEN
    RAISE EXCEPTION 'invalid_phone';
  END IF;
  IF v_body = '' THEN RAISE EXCEPTION 'empty_complaint'; END IF;

  -- حد المحاولات: 3 شكاوي لكل هاتف في الساعة، و5 لكل جهاز في الساعة
  SELECT count(*) INTO v_recent FROM public.complaints
   WHERE phone = v_phone AND created_at > now() - interval '1 hour';
  IF v_recent >= 3 THEN RAISE EXCEPTION 'complaint_rate_limited'; END IF;
  IF v_device <> '' THEN
    SELECT count(*) INTO v_recent FROM public.complaints
     WHERE device_id = v_device AND created_at > now() - interval '1 hour';
    IF v_recent >= 5 THEN RAISE EXCEPTION 'complaint_rate_limited'; END IF;
  END IF;

  -- رقم تتبع فريد: MR-سنة-ست خانات
  LOOP
    v_ticket := 'MR-' || to_char(now(), 'YY') || '-' || lpad(floor(random() * 1000000)::int::text, 6, '0');
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.complaints WHERE ticket_no = v_ticket);
  END LOOP;

  INSERT INTO public.complaints(ticket_no, phone, name, subject, body, device_id)
  VALUES(v_ticket, v_phone, v_name, v_subject, v_body, v_device);

  RETURN jsonb_build_object('ticket_no', v_ticket);
END;
$$;
GRANT EXECUTE ON FUNCTION public.submit_complaint(TEXT, TEXT, TEXT, TEXT, TEXT) TO anon, authenticated;

-- تتبع الشكوى برقم الهاتف ورقم الشكوى
CREATE OR REPLACE FUNCTION public.lookup_complaint(p_phone TEXT, p_ticket TEXT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_phone TEXT := regexp_replace(COALESCE(p_phone, ''), '[^0-9]', '', 'g');
  v_ticket TEXT := upper(trim(COALESCE(p_ticket, '')));
  v RECORD;
BEGIN
  IF v_phone = '' OR v_ticket = '' THEN RETURN jsonb_build_object('found', false); END IF;
  SELECT ticket_no, subject, status, created_at INTO v FROM public.complaints
   WHERE ticket_no = v_ticket AND phone = v_phone LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('found', false); END IF;
  RETURN jsonb_build_object('found', true, 'ticket_no', v.ticket_no,
    'subject', v.subject, 'status', v.status, 'created_at', v.created_at);
END;
$$;
GRANT EXECUTE ON FUNCTION public.lookup_complaint(TEXT, TEXT) TO anon, authenticated;

-- قائمة الشكاوي للمطور
CREATE OR REPLACE FUNCTION public.dev_list_complaints()
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_result JSONB;
BEGIN
  IF (SELECT role FROM public.profiles WHERE id = auth.uid()) IS DISTINCT FROM 'super_admin' THEN
    RAISE EXCEPTION 'not_allowed';
  END IF;
  SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.created_at DESC), '[]'::jsonb) INTO v_result
  FROM (
    SELECT id, ticket_no, phone, name, subject, body, status, device_id, created_at
    FROM public.complaints ORDER BY created_at DESC LIMIT 500
  ) t;
  RETURN v_result;
END;
$$;
GRANT EXECUTE ON FUNCTION public.dev_list_complaints() TO authenticated;

-- تحديث حالة الشكوى (المطور)
CREATE OR REPLACE FUNCTION public.dev_update_complaint(p_id UUID, p_status TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF (SELECT role FROM public.profiles WHERE id = auth.uid()) IS DISTINCT FROM 'super_admin' THEN
    RAISE EXCEPTION 'not_allowed';
  END IF;
  IF p_status NOT IN ('open','in_progress','closed') THEN RAISE EXCEPTION 'invalid_status'; END IF;
  UPDATE public.complaints SET status = p_status WHERE id = p_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.dev_update_complaint(UUID, TEXT) TO authenticated;

COMMIT;

-- بعد التشغيل:
--   تحقق: SELECT * FROM public.app_exams LIMIT 1;  (تظهر الأعمدة الجديدة)
--   وجرّب: SELECT public.submit_complaint('01000000000','زائر','موضوع','نص','dev-test');
