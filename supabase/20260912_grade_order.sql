-- ============================================================================
--  Mr Center — ترتيب المراحل الدراسية (2026-09-12)
--  يضيف ترتيباً يدوياً للمراحل (الصفوف) حتى تظهر بالترتيب الدراسي المنطقي
--  (الأول ثم الثاني ...) بدل ترتيب الإنشاء أو الأبجدية.
--  الملف idempotent.
-- ============================================================================

BEGIN;

ALTER TABLE public.grades ADD COLUMN IF NOT EXISTS sort_order INT NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_grades_center_order ON public.grades(center_id, sort_order);

-- تسوية قديمة: أعطِ كل صف ترتيباً متسلسلاً حسب تاريخ إنشائه حتى لا تختلط
-- الصفوف القديمة بعد إضافة العمود.
WITH ordered AS (
  SELECT id, row_number() OVER (PARTITION BY center_id ORDER BY created_at, name) AS rn
  FROM public.grades
)
UPDATE public.grades g SET sort_order = ordered.rn
FROM ordered WHERE ordered.id = g.id AND g.sort_order = 0;

COMMIT;
