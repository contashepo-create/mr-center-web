-- ============================================================================
-- Mr Center — قنوات بث المطور المخصصة
-- التاريخ: 2026-09-13
--
-- كل بث يُخزَّن كسجل واحد لكل سنتر/جمهور (وليس صفاً لكل مستلم)، مع عزل كامل
-- عند القراءة. القنوات المتاحة للمطور:
--   1) سنتر مختار: صاحبه أو صاحبه وطلابه
--   2) كل السناتر: أصحاب السناتر
--   3) كل السناتر وطلابها: أصحاب السناتر والطلاب
--   4) كل الطلاب فقط
--   5) موظفو كل السناتر أو موظفو سنتر مختار
-- ============================================================================

BEGIN;

-- صفوف الموظفين تحتاج جمهوراً مستقلاً؛ لا يدخل أصحاب السناتر أو الطلاب فيه.
ALTER TABLE public.app_notifications DROP CONSTRAINT IF EXISTS app_notifications_audience_check;
ALTER TABLE public.app_notifications ADD CONSTRAINT app_notifications_audience_check
  CHECK (audience IN ('all', 'grade', 'group', 'student', 'owners', 'staff'));
CREATE INDEX IF NOT EXISTS idx_app_notif_center_audience_created
  ON public.app_notifications(center_id, audience, created_at DESC);

-- سياسة البث القديمة كانت تتيح للمدرس النشط قراءة كل رسائل سنتره، بما فيها
-- رسائل المطور لأصحاب السنتر. تبقى صلاحية الإشعار الممنوحة له، لكن فقط على
-- جماهير سنتره التعليمية، أما رسائل المطور فتُقرأ عبر RPC المفلتر أدناه.
DROP POLICY IF EXISTS "app_notif_teacher_all" ON public.app_notifications;
DROP POLICY IF EXISTS "app_notif_staff_manage_learning" ON public.app_notifications;
CREATE POLICY "app_notif_staff_manage_learning" ON public.app_notifications FOR ALL TO authenticated
  USING (
    center_id = public.my_center_id()
    AND audience IN ('all', 'grade', 'group', 'student')
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('teacher', 'manager', 'secretary')
        AND p.is_active
        AND COALESCE((p.perms ->> 'notify')::BOOLEAN, false)
    )
    AND public.center_is_active(center_id)
  )
  WITH CHECK (
    center_id = public.my_center_id()
    AND audience IN ('all', 'grade', 'group', 'student')
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('teacher', 'manager', 'secretary')
        AND p.is_active
        AND COALESCE((p.perms ->> 'notify')::BOOLEAN, false)
    )
    AND public.center_is_active(center_id)
  );

-- ينشئ المطور صفوف الرسائل المناسبة خادمياً. لا يثق في center_id أو audience
-- قادمين من المتصفح، ولا يسمح لأي دور آخر بإرسال بث عابر للسناتر.
CREATE OR REPLACE FUNCTION public.developer_broadcast_notification(
  p_channel TEXT,
  p_title TEXT,
  p_body TEXT,
  p_center UUID DEFAULT NULL,
  p_center_delivery TEXT DEFAULT NULL
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_channel TEXT := lower(trim(COALESCE(p_channel, '')));
  v_delivery TEXT := lower(trim(COALESCE(p_center_delivery, '')));
  v_title TEXT := trim(COALESCE(p_title, ''));
  v_body TEXT := trim(COALESCE(p_body, ''));
  v_centers INT := 0;
  v_rows INT := 0;
  v_recipients INT := 0;
  v_inserted INT := 0;
BEGIN
  IF (SELECT role FROM public.profiles WHERE id = auth.uid()) IS DISTINCT FROM 'super_admin' THEN
    RAISE EXCEPTION 'not_allowed';
  END IF;
  IF v_title = '' OR v_body = '' THEN RAISE EXCEPTION 'notification_content_required'; END IF;
  IF length(v_title) > 180 OR length(v_body) > 5000 THEN RAISE EXCEPTION 'notification_content_too_long'; END IF;
  IF v_channel NOT IN ('center', 'all_owners', 'all_owners_students', 'all_students', 'staff') THEN
    RAISE EXCEPTION 'invalid_broadcast_channel';
  END IF;

  IF v_channel = 'center' THEN
    IF p_center IS NULL OR NOT EXISTS (SELECT 1 FROM public.centers WHERE id = p_center) THEN
      RAISE EXCEPTION 'broadcast_center_not_found';
    END IF;
    IF v_delivery NOT IN ('owners', 'owners_students') THEN
      RAISE EXCEPTION 'invalid_center_delivery';
    END IF;
    v_centers := 1;
    INSERT INTO public.app_notifications(id, center_id, audience, audience_id, title, body)
    VALUES (gen_random_uuid()::TEXT, p_center, 'owners', NULL, v_title, v_body);
    GET DIAGNOSTICS v_inserted = ROW_COUNT; v_rows := v_rows + v_inserted;
    IF v_delivery = 'owners_students' THEN
      INSERT INTO public.app_notifications(id, center_id, audience, audience_id, title, body)
      VALUES (gen_random_uuid()::TEXT, p_center, 'all', NULL, v_title, v_body);
      GET DIAGNOSTICS v_inserted = ROW_COUNT; v_rows := v_rows + v_inserted;
    END IF;
    SELECT COUNT(*) INTO v_recipients FROM public.profiles
      WHERE center_id = p_center
        AND (role = 'center_admin' OR (v_delivery = 'owners_students' AND role = 'student'));

  ELSIF v_channel = 'all_owners' THEN
    SELECT COUNT(*) INTO v_centers FROM public.centers;
    INSERT INTO public.app_notifications(id, center_id, audience, audience_id, title, body)
    SELECT gen_random_uuid()::TEXT, c.id, 'owners', NULL, v_title, v_body FROM public.centers c;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    SELECT COUNT(*) INTO v_recipients FROM public.profiles WHERE role = 'center_admin';

  ELSIF v_channel = 'all_owners_students' THEN
    SELECT COUNT(*) INTO v_centers FROM public.centers;
    INSERT INTO public.app_notifications(id, center_id, audience, audience_id, title, body)
    SELECT gen_random_uuid()::TEXT, c.id, 'owners', NULL, v_title, v_body FROM public.centers c;
    GET DIAGNOSTICS v_inserted = ROW_COUNT; v_rows := v_rows + v_inserted;
    INSERT INTO public.app_notifications(id, center_id, audience, audience_id, title, body)
    SELECT gen_random_uuid()::TEXT, c.id, 'all', NULL, v_title, v_body FROM public.centers c;
    GET DIAGNOSTICS v_inserted = ROW_COUNT; v_rows := v_rows + v_inserted;
    SELECT COUNT(*) INTO v_recipients FROM public.profiles WHERE role IN ('center_admin', 'student');

  ELSIF v_channel = 'all_students' THEN
    SELECT COUNT(*) INTO v_centers FROM public.centers;
    INSERT INTO public.app_notifications(id, center_id, audience, audience_id, title, body)
    SELECT gen_random_uuid()::TEXT, c.id, 'all', NULL, v_title, v_body FROM public.centers c;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    SELECT COUNT(*) INTO v_recipients FROM public.profiles WHERE role = 'student';

  ELSE -- staff: p_center فارغ = كل السناتر، ومملوء = سنتر محدد
    IF p_center IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.centers WHERE id = p_center) THEN
      RAISE EXCEPTION 'broadcast_center_not_found';
    END IF;
    SELECT COUNT(*) INTO v_centers FROM public.centers WHERE p_center IS NULL OR id = p_center;
    INSERT INTO public.app_notifications(id, center_id, audience, audience_id, title, body)
    SELECT gen_random_uuid()::TEXT, c.id, 'staff', NULL, v_title, v_body
    FROM public.centers c WHERE p_center IS NULL OR c.id = p_center;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    SELECT COUNT(*) INTO v_recipients FROM public.profiles
      WHERE role IN ('teacher', 'manager', 'secretary') AND is_active
        AND (p_center IS NULL OR center_id = p_center);
  END IF;

  RETURN jsonb_build_object(
    'channel', v_channel,
    'centers', v_centers,
    'notification_rows', v_rows,
    'recipient_accounts', v_recipients
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.developer_broadcast_notification(TEXT, TEXT, TEXT, UUID, TEXT) TO authenticated;

-- صندوق موحّد لرسائل المطور: صاحب السنتر يرى owners، والموظف النشط يرى staff
-- فقط. الطلاب يواصلون استخدام get_my_notifications لمحتوى students المعتاد.
CREATE OR REPLACE FUNCTION public.get_my_developer_notifications()
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_role TEXT;
  v_center UUID;
  v_active BOOLEAN;
  v_audience TEXT;
BEGIN
  SELECT role, center_id, is_active INTO v_role, v_center, v_active
  FROM public.profiles WHERE id = auth.uid();
  IF v_center IS NULL THEN RETURN '[]'::JSONB; END IF;
  IF v_role = 'center_admin' THEN
    v_audience := 'owners';
  ELSIF v_role IN ('teacher', 'manager', 'secretary') AND v_active THEN
    v_audience := 'staff';
  ELSE
    RETURN '[]'::JSONB;
  END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', n.id, 'title', n.title, 'body', n.body, 'created_at', n.created_at,
      'is_read', EXISTS(
        SELECT 1 FROM public.app_notification_reads r
        WHERE r.notification_id = n.id AND r.student_id = auth.uid()::TEXT
      )
    ) ORDER BY n.created_at DESC)
    FROM (
      SELECT id, title, body, created_at
      FROM public.app_notifications
      WHERE center_id = v_center AND audience = v_audience
      ORDER BY created_at DESC
      LIMIT 100
    ) n
  ), '[]'::JSONB);
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_my_developer_notifications() TO authenticated;

CREATE OR REPLACE FUNCTION public.mark_developer_notification_read(p_notification TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_role TEXT;
  v_center UUID;
  v_active BOOLEAN;
  v_audience TEXT;
  v_notice_center UUID;
  v_notice_audience TEXT;
BEGIN
  SELECT role, center_id, is_active INTO v_role, v_center, v_active
  FROM public.profiles WHERE id = auth.uid();
  IF v_role = 'center_admin' THEN
    v_audience := 'owners';
  ELSIF v_role IN ('teacher', 'manager', 'secretary') AND v_active THEN
    v_audience := 'staff';
  ELSE
    RAISE EXCEPTION 'not_allowed';
  END IF;

  SELECT center_id, audience INTO v_notice_center, v_notice_audience
  FROM public.app_notifications WHERE id = p_notification;
  IF v_notice_center IS NULL OR v_notice_center IS DISTINCT FROM v_center OR v_notice_audience <> v_audience THEN
    RAISE EXCEPTION 'notification_not_found';
  END IF;

  INSERT INTO public.app_notification_reads(id, center_id, notification_id, student_id)
  VALUES (gen_random_uuid()::TEXT, v_center, p_notification, auth.uid()::TEXT)
  ON CONFLICT (notification_id, student_id) DO NOTHING;
END;
$$;
GRANT EXECUTE ON FUNCTION public.mark_developer_notification_read(TEXT) TO authenticated;

COMMIT;
