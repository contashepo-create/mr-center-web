-- ============================================================================
--  Mr Center — نموذج الاستبيان الكامل (2026-09-12)
--  يرقّي الاستبيانات من «قائمة نصوص» إلى نموذج عملي مقارن بالنسخة الأصلية:
--  أنواع أسئلة (اختيار/متعدد/تقييم/نعم-لا/نصي)، جمهور مستهدف (الكل/صف/مجموعات)،
--  موعد نهائي، إجابات مجهولة، قفل الرد بعد الإرسال، وترقيم نسخ عند تعديل الأسئلة.
--  الملف idempotent — لا يحتوي على أي مفتاح سري.
-- ============================================================================

BEGIN;

-- حقول الجمهور والوقت والخصوصية (الأسئلة تُخزَّن ككائنات داخل عمود questions الحالي JSONB)
ALTER TABLE public.app_surveys ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT '';
ALTER TABLE public.app_surveys ADD COLUMN IF NOT EXISTS audience TEXT NOT NULL DEFAULT 'all'
  CHECK (audience IN ('all','grade','group'));
ALTER TABLE public.app_surveys ADD COLUMN IF NOT EXISTS grade_id TEXT;
ALTER TABLE public.app_surveys ADD COLUMN IF NOT EXISTS group_ids JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.app_surveys ADD COLUMN IF NOT EXISTS deadline TIMESTAMPTZ;
ALTER TABLE public.app_surveys ADD COLUMN IF NOT EXISTS anonymous BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.app_surveys ADD COLUMN IF NOT EXISTS lock_after_submit BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.app_surveys ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1;

CREATE INDEX IF NOT EXISTS idx_app_surveys_grade ON public.app_surveys(grade_id);

-- ردّ واحد لكل طالب في كل استبيان (يبقى موجوداً)، ونضيف قيداً مريحاً للترقية بلا صراع
-- (الاستبيانات القديمة كانت أسئلتها نصية — تبقى مقروءة كما هي).

COMMIT;
