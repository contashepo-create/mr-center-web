-- ============================================================================
-- Mr Center — مساحة الاختبارات: مسار ورقي/إلكتروني، تحكم الوصول والمجموعات
-- التاريخ: 2026-09-13
-- شغّل هذا الملف بعد 20260912_exams_complaints.sql و20260912_exam_ornaments_images.sql.
-- يحافظ على الاختبارات القائمة: كلها تظل إلكترونية، عامة داخل صفها، ومفتوحة دائماً.
-- ============================================================================

BEGIN;

ALTER TABLE public.app_exams
  ADD COLUMN IF NOT EXISTS delivery_mode text NOT NULL DEFAULT 'online',
  ADD COLUMN IF NOT EXISTS online_mode text NOT NULL DEFAULT 'mixed',
  ADD COLUMN IF NOT EXISTS target_group_ids text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS availability_mode text NOT NULL DEFAULT 'always',
  ADD COLUMN IF NOT EXISTS available_from timestamptz,
  ADD COLUMN IF NOT EXISTS available_until timestamptz,
  ADD COLUMN IF NOT EXISTS paper_template text NOT NULL DEFAULT 'classic';

ALTER TABLE public.app_exams DROP CONSTRAINT IF EXISTS app_exams_delivery_mode_check;
ALTER TABLE public.app_exams ADD CONSTRAINT app_exams_delivery_mode_check CHECK (delivery_mode IN ('paper', 'online'));
ALTER TABLE public.app_exams DROP CONSTRAINT IF EXISTS app_exams_online_mode_check;
ALTER TABLE public.app_exams ADD CONSTRAINT app_exams_online_mode_check CHECK (online_mode IN ('objective', 'essay', 'mixed'));
ALTER TABLE public.app_exams DROP CONSTRAINT IF EXISTS app_exams_availability_mode_check;
ALTER TABLE public.app_exams ADD CONSTRAINT app_exams_availability_mode_check CHECK (availability_mode IN ('always', 'scheduled'));
ALTER TABLE public.app_exams DROP CONSTRAINT IF EXISTS app_exams_paper_template_check;
ALTER TABLE public.app_exams ADD CONSTRAINT app_exams_paper_template_check CHECK (paper_template IN ('classic', 'lab', 'life', 'cosmos', 'explorer', 'royal', 'parchment', 'wedding', 'modern', 'formal'));
ALTER TABLE public.app_exams DROP CONSTRAINT IF EXISTS app_exams_availability_range_check;
ALTER TABLE public.app_exams ADD CONSTRAINT app_exams_availability_range_check
  CHECK (availability_mode = 'always' OR (available_from IS NOT NULL AND available_until IS NOT NULL AND available_from < available_until));
CREATE INDEX IF NOT EXISTS idx_app_exams_visible_window
  ON public.app_exams(center_id, grade_id, is_published, available_from, available_until);

-- الطالب يرى فقط اختباراً إلكترونياً منشوراً، في نافذته الزمنية، يخص صفه ومجموعاته.
-- مفتاح التصحيح لا يعود أبداً: نحذف answer من JSON الخاص بكل سؤال قبل إرساله.
CREATE OR REPLACE FUNCTION public.get_published_exams()
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_center UUID := public.my_center_id();
  v_sid TEXT := public.my_student_id();
  v_grade TEXT; v_primary_group TEXT;
BEGIN
  IF v_center IS NULL OR v_sid IS NULL THEN RETURN '[]'::jsonb; END IF;
  SELECT grade_id, group_id INTO v_grade, v_primary_group
  FROM public.students WHERE id = v_sid AND center_id = v_center;
  IF NOT FOUND THEN RETURN '[]'::jsonb; END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', e.id, 'title', e.title, 'subject', e.subject, 'grade_id', e.grade_id,
      'duration_minutes', e.duration_minutes, 'total_score', e.total_score,
      'questions', (
        SELECT COALESCE(jsonb_agg(t.q - 'answer' ORDER BY t.ord), '[]'::jsonb)
        FROM jsonb_array_elements(e.questions) WITH ORDINALITY AS t(q, ord)
      ),
      'created_at', e.created_at,
      'attempts_allowed', COALESCE(NULLIF(e.attempts_allowed, 0), 1),
      'attempts_used', (SELECT count(*) FROM public.app_exam_attempts a WHERE a.exam_id = e.id AND a.student_id = v_sid),
      'show_result', COALESCE(e.show_result, 'end')
    ) ORDER BY e.created_at DESC)
    FROM public.app_exams e
    WHERE e.center_id = v_center
      AND e.is_published
      AND e.delivery_mode = 'online'
      AND (e.grade_id IS NULL OR e.grade_id = '' OR e.grade_id = v_grade)
      AND (
        coalesce(cardinality(e.target_group_ids), 0) = 0
        OR v_primary_group = ANY(e.target_group_ids)
        OR EXISTS (SELECT 1 FROM public.student_groups sg WHERE sg.center_id = v_center AND sg.student_id = v_sid AND sg.group_id = ANY(e.target_group_ids))
      )
      AND (e.availability_mode = 'always' OR (e.available_from <= now() AND e.available_until >= now()))
  ), '[]'::jsonb);
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_published_exams() TO authenticated;

-- نفس شروط العرض تطبق لحظة التسليم أيضاً؛ لا يكفي إخفاء الاختبار في الواجهة.
CREATE OR REPLACE FUNCTION public.submit_exam_attempt(p_exam_id TEXT, p_answers JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_center UUID := public.my_center_id();
  v_sid TEXT := public.my_student_id();
  v_grade TEXT; v_primary_group TEXT;
  v_exam public.app_exams%ROWTYPE;
  v_n INT := 0; v_total_marks NUMERIC := 0; v_earned NUMERIC := 0; v_correct INT := 0;
  v_has_essay BOOLEAN := false; v_status TEXT; v_allowed INT; v_used INT; i INT;
  v_q JSONB; v_type TEXT; v_marks NUMERIC; v_results JSONB := '[]'::jsonb; v_ok BOOLEAN; v_earn NUMERIC;
BEGIN
  IF v_center IS NULL OR v_sid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  SELECT grade_id, group_id INTO v_grade, v_primary_group FROM public.students WHERE id = v_sid AND center_id = v_center;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  SELECT * INTO v_exam FROM public.app_exams e
   WHERE e.id = p_exam_id AND e.center_id = v_center AND e.is_published AND e.delivery_mode = 'online'
     AND (e.grade_id IS NULL OR e.grade_id = '' OR e.grade_id = v_grade)
     AND (coalesce(cardinality(e.target_group_ids), 0) = 0 OR v_primary_group = ANY(e.target_group_ids)
       OR EXISTS (SELECT 1 FROM public.student_groups sg WHERE sg.center_id = v_center AND sg.student_id = v_sid AND sg.group_id = ANY(e.target_group_ids)))
     AND (e.availability_mode = 'always' OR (e.available_from <= now() AND e.available_until >= now()));
  IF NOT FOUND THEN RAISE EXCEPTION 'exam_not_found'; END IF;

  v_allowed := COALESCE(NULLIF(v_exam.attempts_allowed, 0), 1);
  SELECT count(*) INTO v_used FROM public.app_exam_attempts WHERE exam_id = p_exam_id AND student_id = v_sid;
  IF v_used >= v_allowed THEN RAISE EXCEPTION 'attempts_exhausted'; END IF;

  v_n := COALESCE(jsonb_array_length(v_exam.questions), 0);
  FOR i IN 0..v_n - 1 LOOP
    v_q := v_exam.questions -> i;
    v_type := COALESCE(v_q ->> 'type', 'mcq');
    v_marks := COALESCE(NULLIF(v_q ->> 'marks', '')::NUMERIC, 1);
    v_total_marks := v_total_marks + v_marks; v_ok := false; v_earn := 0;
    IF v_type IN ('essay', 'correct', 'short') THEN
      v_has_essay := true;
      v_results := v_results || jsonb_build_object('q', i, 'correct', NULL, 'earned', 0, 'marks', v_marks, 'model', (v_exam.answers -> i));
      CONTINUE;
    ELSIF (v_exam.answers -> i) IS NOT NULL AND (v_exam.answers -> i) = (COALESCE(p_answers, '[]'::jsonb) -> i) THEN
      v_ok := true; v_earn := v_marks; v_correct := v_correct + 1; v_earned := v_earned + v_marks;
    END IF;
    v_results := v_results || jsonb_build_object('q', i, 'correct', v_ok, 'earned', v_earn, 'marks', v_marks, 'model', (v_exam.answers -> i));
  END LOOP;
  IF v_total_marks <= 0 THEN v_total_marks := COALESCE(v_exam.total_score, 0); END IF;
  v_status := CASE WHEN v_has_essay THEN 'pending_review' ELSE 'graded' END;
  INSERT INTO public.app_exam_attempts(id, center_id, exam_id, student_id, answers, score, max_score, status)
  VALUES(gen_random_uuid()::text, v_center, p_exam_id, v_sid, COALESCE(p_answers, '[]'::jsonb), ROUND(v_earned, 2), v_total_marks, v_status);
  RETURN jsonb_build_object('score', ROUND(v_earned, 2), 'max_score', v_total_marks, 'correct', v_correct, 'total', v_n, 'status', v_status,
    'attempts_used', v_used + 1, 'attempts_allowed', v_allowed,
    'per_question', CASE WHEN COALESCE(v_exam.show_result, 'end') = 'after_each' THEN v_results ELSE '[]'::jsonb END);
END;
$$;
GRANT EXECUTE ON FUNCTION public.submit_exam_attempt(TEXT, JSONB) TO authenticated;

COMMIT;
