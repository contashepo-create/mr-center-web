-- ============================================================================
--  Mr Center — زخارف ورقة الاختبار + صور الأسئلة (2026-09-12)
--  تُشغَّل بعد 20260912_exams_complaints.sql.
--  Idempotent — آمن لإعادة التشغيل.
--
--  ١) عمود ornaments (JSONB) على app_exams لحفظ إعدادات الزخارف
--     (تلقائي/يدوي + الكثافة + الشفافية + الأنواع + الأختام اليدوية).
--  ٢) صور الأسئلة تُخزَّن داخل كل عنصر في مصفوفة questions (JSONB) فلا تحتاج
--     عموداً جديداً: image / imagePosition / imageSize تنتقل تلقائياً.
--  ٣) أمان: get_published_exams لم تعد تُرسل «الإجابة النموذجية» (answer) ضمن
--     كل سؤال للطالب — كانت تصل ضمن questions وتكشف المفتاح قبل الأوان.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- ١) عمود الزخارف
-- ----------------------------------------------------------------------------
ALTER TABLE public.app_exams ADD COLUMN IF NOT EXISTS ornaments JSONB;

-- ----------------------------------------------------------------------------
-- ٢) إعادة تعريف get_published_exams: أسئلة بلا مفاتيح تصحيح + كل الحقول
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
      -- تُنزع «الإجابة النموذجية» (answer) من كل سؤال حتى لا يصل المفتاح للطالب
      'questions', (
        SELECT COALESCE(jsonb_agg(t.q - 'answer' ORDER BY t.ord), '[]'::jsonb)
        FROM jsonb_array_elements(e.questions) WITH ORDINALITY AS t(q, ord)
      ),
      'created_at', e.created_at,
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

COMMIT;
