-- ============================================================================
-- Mr Center — طلب انتقال الطالب بين مجموعات صفه
-- التاريخ: 2026-09-13
-- شغّله بعد android_multitenant_schema.sql والترحيلات الموجودة في README.
-- الطلب يحفظ المجموعة المصدر والوجهة صراحة، والموافقة تنقل الطالب ذرياً.
-- ============================================================================

BEGIN;

ALTER TABLE public.app_inquiries
  ADD COLUMN IF NOT EXISTS from_group_id TEXT,
  ADD COLUMN IF NOT EXISTS to_group_id TEXT,
  ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_app_inquiries_transfer_target
  ON public.app_inquiries(center_id, to_group_id) WHERE kind = 'transfer';

-- لا يستطيع الطالب اصطناع طلب انتقال إلى مجموعة في صف آخر، حتى لو حاول تجاوز الواجهة.
CREATE OR REPLACE FUNCTION public.guard_transfer_request()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_student public.students%ROWTYPE;
  v_target public.groups%ROWTYPE;
  v_is_member BOOLEAN;
BEGIN
  IF NEW.kind <> 'transfer' THEN RETURN NEW; END IF;
  IF NEW.student_id IS NULL OR NEW.from_group_id IS NULL OR NEW.to_group_id IS NULL THEN
    RAISE EXCEPTION 'transfer_groups_required';
  END IF;
  IF NEW.from_group_id = NEW.to_group_id THEN RAISE EXCEPTION 'transfer_target_is_current'; END IF;
  SELECT * INTO v_student FROM public.students WHERE id = NEW.student_id AND center_id = NEW.center_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'transfer_student_not_found'; END IF;
  SELECT * INTO v_target FROM public.groups WHERE id = NEW.to_group_id AND center_id = NEW.center_id;
  IF NOT FOUND OR v_target.grade_id IS DISTINCT FROM v_student.grade_id THEN
    RAISE EXCEPTION 'transfer_target_outside_grade';
  END IF;
  v_is_member := v_student.group_id = NEW.from_group_id OR EXISTS (
    SELECT 1 FROM public.student_groups sg WHERE sg.student_id = NEW.student_id AND sg.group_id = NEW.from_group_id AND sg.center_id = NEW.center_id
  );
  IF NOT v_is_member THEN RAISE EXCEPTION 'transfer_source_not_assigned'; END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS guard_transfer_request ON public.app_inquiries;
CREATE TRIGGER guard_transfer_request
  BEFORE INSERT OR UPDATE OF kind, student_id, from_group_id, to_group_id ON public.app_inquiries
  FOR EACH ROW EXECUTE FUNCTION public.guard_transfer_request();

-- القبول يحدّث حالة الطلب وينقل المجموعة الأساسية في نفس المعاملة.
-- العضوية القديمة المصدر تزال فقط إن كانت رابطاً إضافياً، وتبقى باقي العضويات الإضافية سليمة.
CREATE OR REPLACE FUNCTION public.resolve_student_transfer(
  p_inquiry_id TEXT,
  p_status TEXT,
  p_reply TEXT DEFAULT NULL
)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_request public.app_inquiries%ROWTYPE;
  v_student public.students%ROWTYPE;
  v_target public.groups%ROWTYPE;
BEGIN
  SELECT * INTO v_request FROM public.app_inquiries WHERE id = p_inquiry_id FOR UPDATE;
  IF NOT FOUND OR v_request.kind <> 'transfer' THEN RAISE EXCEPTION 'transfer_request_not_found'; END IF;
  IF NOT public.admin_owns_center(v_request.center_id) THEN RAISE EXCEPTION 'not_authorized'; END IF;
  IF p_status NOT IN ('approved', 'rejected') THEN RAISE EXCEPTION 'invalid_transfer_resolution'; END IF;
  IF v_request.status <> 'pending' THEN RAISE EXCEPTION 'transfer_already_resolved'; END IF;

  IF p_status = 'approved' THEN
    SELECT * INTO v_student FROM public.students WHERE id = v_request.student_id AND center_id = v_request.center_id FOR UPDATE;
    SELECT * INTO v_target FROM public.groups WHERE id = v_request.to_group_id AND center_id = v_request.center_id;
    IF NOT FOUND OR v_target.grade_id IS DISTINCT FROM v_student.grade_id THEN RAISE EXCEPTION 'transfer_target_outside_grade'; END IF;
    UPDATE public.students SET group_id = v_request.to_group_id, updated_at = now() WHERE id = v_request.student_id;
    DELETE FROM public.student_groups WHERE student_id = v_request.student_id AND group_id = v_request.from_group_id AND center_id = v_request.center_id;
  END IF;

  UPDATE public.app_inquiries
  SET status = p_status, reply = NULLIF(trim(COALESCE(p_reply, '')), ''), resolved_at = now(), updated_at = now()
  WHERE id = p_inquiry_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.resolve_student_transfer(TEXT, TEXT, TEXT) TO authenticated;

COMMIT;
