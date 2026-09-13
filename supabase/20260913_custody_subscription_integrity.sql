-- ============================================================================
-- Mr Center — دقة العهدة عند توقف اشتراك المحاسبة
-- التاريخ: 2026-09-13
-- شغّل بعد 20260912_fiscal_accounting.sql في القواعد القائمة.
-- آمن لإعادة التشغيل.
-- ============================================================================

BEGIN;

-- تبقى عملية تسليم العهدة التشغيلية متاحة للسكرتير/المدير حتى لا يتوقف التحصيل،
-- لكن يتم حفظ الفرق الحقيقي كما هو. لا يحول انتهاء الاشتراك مبلغاً ناقصاً إلى
-- حالة «مطابقة»؛ المالك يراها ويعالجها محاسبياً فور تفعيل الخدمة مجدداً.
CREATE OR REPLACE FUNCTION public.submit_staff_custody(
  p_staff UUID, p_date DATE, p_delivered NUMERIC, p_notes TEXT DEFAULT ''
)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  cid UUID;
  expected NUMERIC;
  result UUID;
  v_status TEXT;
  v_date DATE := COALESCE(p_date, CURRENT_DATE);
  v_delivered NUMERIC := COALESCE(p_delivered, -1);
BEGIN
  SELECT center_id INTO cid
  FROM public.profiles
  WHERE id = auth.uid() AND role IN ('manager', 'secretary') AND is_active;
  IF cid IS NULL OR p_staff <> auth.uid() THEN RAISE EXCEPTION 'not_allowed'; END IF;
  IF v_delivered < 0 THEN RAISE EXCEPTION 'invalid_custody_amount'; END IF;

  SELECT COALESCE(SUM(amount), 0) INTO expected
  FROM public.center_ledger
  WHERE center_id = cid AND created_by = p_staff
    AND entry_type = 'payment_collection' AND occurred_on = v_date;

  v_status := CASE
    WHEN v_delivered = expected THEN 'matched'
    WHEN v_delivered < expected THEN 'shortage'
    ELSE 'surplus'
  END;

  INSERT INTO public.staff_custody(
    center_id, staff_id, custody_date, expected_amount, delivered_amount,
    status, notes, submitted_at, submitted_by
  ) VALUES (
    cid, p_staff, v_date, expected, v_delivered,
    v_status, COALESCE(p_notes, ''), now(), auth.uid()
  )
  ON CONFLICT(center_id, staff_id, custody_date) DO UPDATE
    SET expected_amount = EXCLUDED.expected_amount,
        delivered_amount = EXCLUDED.delivered_amount,
        status = EXCLUDED.status,
        notes = EXCLUDED.notes,
        submitted_at = now(),
        submitted_by = auth.uid()
  RETURNING id INTO result;

  RETURN result;
END;
$$;
GRANT EXECUTE ON FUNCTION public.submit_staff_custody(UUID, DATE, NUMERIC, TEXT) TO authenticated;

COMMIT;
