-- ============================================================================
-- Mr Center — مركز التواصل الموحد، بث بلا تكرار، وحضور أصحاب السناتر
-- التاريخ: 2026-09-13
--
-- ينفذ بعد 20260913_developer_broadcast_channels.sql.
-- - لا يرى المالك سجل قراءات بث المطور ولا رسائله ضمن سجل إشعارات السنتر.
-- - كل عضو يتلقى صفاً واحداً فقط من كل بث (owner / staff / student).
-- - تتيح أوضاع العرض: إشعار، رسالة، وتنبيه طارئ.
-- - لا نخزن IP ولا نبني بصمة عتاد؛ معرّف الجهاز محلي اختياري فقط.
-- ============================================================================

BEGIN;

-- فصل إشعارات السنتر التشغيلية عن بث المطور، وإضافة أسلوب العرض المشترك.
ALTER TABLE public.app_notifications
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'center',
  ADD COLUMN IF NOT EXISTS presentation TEXT NOT NULL DEFAULT 'notification',
  ADD COLUMN IF NOT EXISTS developer_broadcast_id UUID;

ALTER TABLE public.app_notifications DROP CONSTRAINT IF EXISTS app_notifications_source_check;
ALTER TABLE public.app_notifications ADD CONSTRAINT app_notifications_source_check
  CHECK (source IN ('center', 'developer'));
ALTER TABLE public.app_notifications DROP CONSTRAINT IF EXISTS app_notifications_presentation_check;
ALTER TABLE public.app_notifications ADD CONSTRAINT app_notifications_presentation_check
  CHECK (presentation IN ('notification', 'message', 'urgent'));
CREATE INDEX IF NOT EXISTS idx_app_notifications_developer_delivery
  ON public.app_notifications(center_id, source, audience, presentation, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_app_notifications_developer_broadcast
  ON public.app_notifications(developer_broadcast_id) WHERE developer_broadcast_id IS NOT NULL;

-- البث القديم الذي يحمل بادئة المطور لا يبقى في سجل الإشعارات الإداري أو عداد قراءاته.
UPDATE public.app_notifications
SET source = 'developer'
WHERE title LIKE 'المطور:%' AND source = 'center';

-- مدير السنتر يدير إشعارات سنتره فقط، ولا يمكنه الوصول لبث المطور أو رصد من قرأه.
DROP POLICY IF EXISTS "app_notif_admin_all" ON public.app_notifications;
CREATE POLICY "app_notif_admin_center_only" ON public.app_notifications FOR ALL TO authenticated
  USING (public.admin_owns_center(center_id) AND source = 'center')
  WITH CHECK (public.admin_owns_center(center_id) AND source = 'center' AND public.center_is_active(center_id));

DROP POLICY IF EXISTS "app_reads_admin_all" ON public.app_notification_reads;
CREATE POLICY "app_reads_admin_center_notifications" ON public.app_notification_reads FOR ALL TO authenticated
  USING (
    public.admin_owns_center(center_id)
    AND EXISTS (SELECT 1 FROM public.app_notifications n WHERE n.id = notification_id AND n.source = 'center')
  )
  WITH CHECK (
    public.admin_owns_center(center_id)
    AND EXISTS (SELECT 1 FROM public.app_notifications n WHERE n.id = notification_id AND n.source = 'center')
    AND public.center_is_active(center_id)
  );

-- تعيد كتابة دالة البث: صف مخصص واحد لكل role داخل السنتر، فلا يرى المالك
-- صف الطلاب ولا موظف صف المالك. النسخة ذات 5 معاملات تبقى متوافقة مع Android القديم.
CREATE OR REPLACE FUNCTION public.developer_broadcast_notification(
  p_channel TEXT,
  p_title TEXT,
  p_body TEXT,
  p_center UUID,
  p_center_delivery TEXT,
  p_presentation TEXT
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_channel TEXT := lower(trim(COALESCE(p_channel, '')));
  v_delivery TEXT := lower(trim(COALESCE(p_center_delivery, '')));
  v_presentation TEXT := lower(trim(COALESCE(p_presentation, 'notification')));
  v_title TEXT := trim(COALESCE(p_title, ''));
  v_body TEXT := trim(COALESCE(p_body, ''));
  v_centers INT := 0;
  v_rows INT := 0;
  v_recipients INT := 0;
  v_inserted INT := 0;
  v_broadcast UUID := gen_random_uuid();
  v_owners BOOLEAN := false;
  v_staff BOOLEAN := false;
  v_students BOOLEAN := false;
BEGIN
  IF (SELECT role FROM public.profiles WHERE id = auth.uid()) IS DISTINCT FROM 'super_admin' THEN
    RAISE EXCEPTION 'not_allowed';
  END IF;
  IF v_title = '' OR v_body = '' THEN RAISE EXCEPTION 'notification_content_required'; END IF;
  IF length(v_title) > 180 OR length(v_body) > 5000 THEN RAISE EXCEPTION 'notification_content_too_long'; END IF;
  IF v_channel NOT IN ('center', 'all_owners', 'all_owners_staff', 'all_owners_students', 'all_students', 'staff', 'all_project') THEN
    RAISE EXCEPTION 'invalid_broadcast_channel';
  END IF;
  IF v_presentation NOT IN ('notification', 'message', 'urgent') THEN RAISE EXCEPTION 'invalid_broadcast_presentation'; END IF;

  IF v_channel = 'center' THEN
    IF p_center IS NULL OR NOT EXISTS (SELECT 1 FROM public.centers WHERE id = p_center) THEN
      RAISE EXCEPTION 'broadcast_center_not_found';
    END IF;
    IF v_delivery NOT IN ('owners', 'owners_staff', 'owners_students', 'owners_students_staff', 'students', 'staff', 'everyone') THEN
      RAISE EXCEPTION 'invalid_center_delivery';
    END IF;
    v_centers := 1;
    v_owners := v_delivery IN ('owners', 'owners_staff', 'owners_students', 'owners_students_staff', 'everyone');
    -- owners_students هو الاسم القديم المتوافق، لكن يضم الموظفين الآن حتى لا يفوتهم البث.
    v_staff := v_delivery IN ('owners_staff', 'owners_students', 'owners_students_staff', 'staff', 'everyone');
    v_students := v_delivery IN ('owners_students', 'owners_students_staff', 'students', 'everyone');
  ELSE
    IF p_center IS NOT NULL OR v_delivery <> '' THEN RAISE EXCEPTION 'unexpected_broadcast_scope'; END IF;
    SELECT COUNT(*) INTO v_centers FROM public.centers;
    v_owners := v_channel IN ('all_owners', 'all_owners_staff', 'all_owners_students', 'all_project');
    v_staff := v_channel IN ('all_owners_staff', 'all_owners_students', 'staff', 'all_project');
    -- all_owners_students يحتفظ بالاسم المتوافق، لكن معناه الآن مالك + موظفون + طلاب.
    v_students := v_channel IN ('all_owners_students', 'all_students', 'all_project');
  END IF;

  IF v_owners THEN
    INSERT INTO public.app_notifications(id, center_id, audience, audience_id, title, body, source, presentation, developer_broadcast_id)
    SELECT gen_random_uuid()::TEXT, c.id, 'owners', NULL, v_title, v_body, 'developer', v_presentation, v_broadcast
    FROM public.centers c WHERE (v_channel <> 'center' OR c.id = p_center);
    GET DIAGNOSTICS v_inserted = ROW_COUNT; v_rows := v_rows + v_inserted;
  END IF;
  IF v_staff THEN
    INSERT INTO public.app_notifications(id, center_id, audience, audience_id, title, body, source, presentation, developer_broadcast_id)
    SELECT gen_random_uuid()::TEXT, c.id, 'staff', NULL, v_title, v_body, 'developer', v_presentation, v_broadcast
    FROM public.centers c WHERE (v_channel <> 'center' OR c.id = p_center);
    GET DIAGNOSTICS v_inserted = ROW_COUNT; v_rows := v_rows + v_inserted;
  END IF;
  IF v_students THEN
    INSERT INTO public.app_notifications(id, center_id, audience, audience_id, title, body, source, presentation, developer_broadcast_id)
    SELECT gen_random_uuid()::TEXT, c.id, 'all', NULL, v_title, v_body, 'developer', v_presentation, v_broadcast
    FROM public.centers c WHERE (v_channel <> 'center' OR c.id = p_center);
    GET DIAGNOSTICS v_inserted = ROW_COUNT; v_rows := v_rows + v_inserted;
  END IF;

  SELECT COUNT(*) INTO v_recipients
  FROM public.profiles p
  WHERE (v_channel <> 'center' OR p.center_id = p_center)
    AND ((v_owners AND p.role = 'center_admin')
      OR (v_staff AND p.role IN ('teacher', 'manager', 'secretary') AND p.is_active)
      OR (v_students AND p.role = 'student'));

  RETURN jsonb_build_object(
    'channel', v_channel, 'presentation', v_presentation, 'broadcast_id', v_broadcast,
    'centers', v_centers, 'notification_rows', v_rows, 'recipient_accounts', v_recipients
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.developer_broadcast_notification(TEXT, TEXT, TEXT, UUID, TEXT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.developer_broadcast_notification(
  p_channel TEXT,
  p_title TEXT,
  p_body TEXT,
  p_center UUID DEFAULT NULL,
  p_center_delivery TEXT DEFAULT NULL
)
RETURNS JSONB LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT public.developer_broadcast_notification($1, $2, $3, $4, $5, 'notification');
$$;
GRANT EXECUTE ON FUNCTION public.developer_broadcast_notification(TEXT, TEXT, TEXT, UUID, TEXT) TO authenticated;

-- صندوق المطور يقرأ الصف المخصص للدور فقط، ويشمل طريقة العرض كي تفصل شارة الرسائل
-- عن شارة الإشعارات وتظهر الطارئة كنافذة.
CREATE OR REPLACE FUNCTION public.get_my_developer_notifications()
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_role TEXT;
  v_center UUID;
  v_active BOOLEAN;
  v_audience TEXT;
BEGIN
  SELECT role, center_id, is_active INTO v_role, v_center, v_active FROM public.profiles WHERE id = auth.uid();
  IF v_center IS NULL THEN RETURN '[]'::JSONB; END IF;
  IF v_role = 'center_admin' THEN v_audience := 'owners';
  ELSIF v_role IN ('teacher', 'manager', 'secretary') AND v_active THEN v_audience := 'staff';
  ELSE RETURN '[]'::JSONB;
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', n.id, 'title', n.title, 'body', n.body, 'created_at', n.created_at,
      'presentation', n.presentation,
      'is_read', EXISTS(SELECT 1 FROM public.app_notification_reads r WHERE r.notification_id = n.id AND r.student_id = auth.uid()::TEXT)
    ) ORDER BY n.created_at DESC)
    FROM (
      SELECT id, title, body, created_at, presentation FROM public.app_notifications
      WHERE center_id = v_center AND audience = v_audience AND source = 'developer'
      ORDER BY created_at DESC LIMIT 100
    ) n
  ), '[]'::JSONB);
END;
$$;

-- قراءة موحدة للنافذة الطارئة ولصفحات الإشعار، مع فحص الجمهور على الخادم.
CREATE OR REPLACE FUNCTION public.mark_my_communication_notification_read(p_notification TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_role TEXT;
  v_center UUID;
  v_student TEXT;
  v_active BOOLEAN;
  v_grade TEXT;
  v_group TEXT;
  v_ok BOOLEAN := false;
BEGIN
  SELECT role, center_id, student_id, is_active INTO v_role, v_center, v_student, v_active
  FROM public.profiles WHERE id = auth.uid();
  IF v_center IS NULL THEN RAISE EXCEPTION 'not_allowed'; END IF;
  IF v_role = 'student' THEN
    SELECT grade_id, group_id INTO v_grade, v_group FROM public.students WHERE id = v_student AND center_id = v_center;
    SELECT EXISTS(SELECT 1 FROM public.app_notifications n WHERE n.id = p_notification AND n.center_id = v_center AND (
      n.audience = 'all' OR (n.audience = 'grade' AND n.audience_id = v_grade) OR
      (n.audience = 'group' AND n.audience_id = v_group) OR (n.audience = 'student' AND n.audience_id = v_student)
    )) INTO v_ok;
  ELSIF v_role = 'center_admin' THEN
    SELECT EXISTS(SELECT 1 FROM public.app_notifications n WHERE n.id = p_notification AND n.center_id = v_center AND n.source = 'developer' AND n.audience = 'owners') INTO v_ok;
  ELSIF v_role IN ('teacher', 'manager', 'secretary') AND v_active THEN
    SELECT EXISTS(SELECT 1 FROM public.app_notifications n WHERE n.id = p_notification AND n.center_id = v_center AND n.source = 'developer' AND n.audience = 'staff') INTO v_ok;
  END IF;
  IF NOT v_ok THEN RAISE EXCEPTION 'notification_not_found'; END IF;
  INSERT INTO public.app_notification_reads(id, center_id, notification_id, student_id)
  VALUES (gen_random_uuid()::TEXT, v_center, p_notification, auth.uid()::TEXT)
  ON CONFLICT (notification_id, student_id) DO NOTHING;
END;
$$;
GRANT EXECUTE ON FUNCTION public.mark_my_communication_notification_read(TEXT) TO authenticated;

-- قراءات محادثة الدعم منفصلة لكل حساب؛ لا يستطيع المالك رؤية من قرأ بث المطور.
CREATE TABLE IF NOT EXISTS public.support_message_reads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  center_id UUID NOT NULL REFERENCES public.centers(id) ON DELETE CASCADE,
  message_id UUID NOT NULL REFERENCES public.support_messages(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  read_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(message_id, account_id)
);
ALTER TABLE public.support_message_reads ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_support_message_reads_account ON public.support_message_reads(account_id, message_id);

CREATE OR REPLACE FUNCTION public.mark_my_support_messages_read(p_center UUID DEFAULT NULL)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_role TEXT;
  v_center UUID;
BEGIN
  SELECT role, center_id INTO v_role, v_center FROM public.profiles WHERE id = auth.uid();
  IF v_role = 'center_admin' THEN
    IF p_center IS NOT NULL AND p_center IS DISTINCT FROM v_center THEN RAISE EXCEPTION 'not_allowed'; END IF;
    INSERT INTO public.support_message_reads(center_id, message_id, account_id)
    SELECT m.center_id, m.id, auth.uid() FROM public.support_messages m
    WHERE m.center_id = v_center AND m.sender_role = 'developer'
    ON CONFLICT(message_id, account_id) DO NOTHING;
  ELSIF v_role = 'super_admin' THEN
    IF p_center IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.centers WHERE id = p_center) THEN RAISE EXCEPTION 'not_allowed'; END IF;
    INSERT INTO public.support_message_reads(center_id, message_id, account_id)
    SELECT m.center_id, m.id, auth.uid() FROM public.support_messages m
    WHERE m.sender_role = 'owner' AND (p_center IS NULL OR m.center_id = p_center)
    ON CONFLICT(message_id, account_id) DO NOTHING;
  ELSE
    RAISE EXCEPTION 'not_allowed';
  END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION public.mark_my_support_messages_read(UUID) TO authenticated;

-- صفحة الطالب تستخدم هذه الدالة أيضاً؛ نعيد presentation حتى تعرف هل العنصر رسالة أو طارئ.
CREATE OR REPLACE FUNCTION public.get_my_notifications()
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_center UUID := public.my_center_id();
  v_sid TEXT := public.my_student_id();
  v_grade TEXT;
  v_group TEXT;
BEGIN
  IF v_center IS NULL OR v_sid IS NULL THEN RETURN '[]'::JSONB; END IF;
  SELECT grade_id, group_id INTO v_grade, v_group FROM public.students WHERE id = v_sid AND center_id = v_center;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', n.id, 'title', n.title, 'body', n.body, 'created_at', n.created_at, 'presentation', n.presentation,
      'is_read', EXISTS(SELECT 1 FROM public.app_notification_reads r WHERE r.notification_id = n.id AND r.student_id = v_sid)
    ) ORDER BY n.created_at DESC)
    FROM public.app_notifications n
    WHERE n.center_id = v_center
      AND (n.audience = 'all' OR (n.audience = 'grade' AND n.audience_id = v_grade)
        OR (n.audience = 'group' AND n.audience_id = v_group) OR (n.audience = 'student' AND n.audience_id = v_sid))
    LIMIT 100
  ), '[]'::JSONB);
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_my_notifications() TO authenticated;

-- ملخص واحد للشريط العلوي: عداد + أحدث العناصر غير المقروءة مع وجهتها الصحيحة.
CREATE OR REPLACE FUNCTION public.get_my_communication_summary()
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_role TEXT;
  v_center UUID;
  v_student TEXT;
  v_active BOOLEAN;
  v_grade TEXT;
  v_group TEXT;
  v_audience TEXT;
  v_notif_count INT := 0;
  v_message_count INT := 0;
  v_notif_items JSONB := '[]'::JSONB;
  v_message_items JSONB := '[]'::JSONB;
BEGIN
  SELECT role, center_id, student_id, is_active INTO v_role, v_center, v_student, v_active FROM public.profiles WHERE id = auth.uid();
  IF v_role = 'student' THEN
    SELECT grade_id, group_id INTO v_grade, v_group FROM public.students WHERE id = v_student AND center_id = v_center;
    WITH eligible AS (
      SELECT n.* FROM public.app_notifications n WHERE n.center_id = v_center AND (
        n.audience = 'all' OR (n.audience = 'grade' AND n.audience_id = v_grade) OR
        (n.audience = 'group' AND n.audience_id = v_group) OR (n.audience = 'student' AND n.audience_id = v_student)
      ) AND n.presentation IN ('notification', 'urgent')
        AND NOT EXISTS (SELECT 1 FROM public.app_notification_reads r WHERE r.notification_id = n.id AND r.student_id = auth.uid()::TEXT)
    )
    SELECT count(*) FILTER (WHERE presentation IN ('notification', 'urgent')),
      COALESCE(jsonb_agg(jsonb_build_object('id', id, 'title', title, 'body', body, 'created_at', created_at, 'presentation', presentation, 'route', '/student/notifications', 'kind', 'notification') ORDER BY created_at DESC) FILTER (WHERE presentation IN ('notification', 'urgent')), '[]'::JSONB)
    INTO v_notif_count, v_notif_items FROM (SELECT * FROM eligible ORDER BY created_at DESC LIMIT 6) q;
    WITH eligible AS (
      SELECT n.* FROM public.app_notifications n WHERE n.center_id = v_center AND (
        n.audience = 'all' OR (n.audience = 'grade' AND n.audience_id = v_grade) OR
        (n.audience = 'group' AND n.audience_id = v_group) OR (n.audience = 'student' AND n.audience_id = v_student)
      ) AND n.presentation = 'message' AND NOT EXISTS (SELECT 1 FROM public.app_notification_reads r WHERE r.notification_id = n.id AND r.student_id = auth.uid()::TEXT)
    )
    SELECT count(*), COALESCE(jsonb_agg(jsonb_build_object('id', id, 'title', title, 'body', body, 'created_at', created_at, 'presentation', presentation, 'route', '/student/notifications', 'kind', 'developer_message') ORDER BY created_at DESC), '[]'::JSONB)
    INTO v_message_count, v_message_items FROM (SELECT * FROM eligible ORDER BY created_at DESC LIMIT 6) q;
  ELSIF v_role = 'center_admin' OR (v_role IN ('teacher', 'manager', 'secretary') AND v_active) THEN
    v_audience := CASE WHEN v_role = 'center_admin' THEN 'owners' ELSE 'staff' END;
    WITH eligible AS (
      SELECT n.* FROM public.app_notifications n WHERE n.center_id = v_center AND n.source = 'developer' AND n.audience = v_audience
      AND n.presentation IN ('notification', 'urgent')
      AND NOT EXISTS (SELECT 1 FROM public.app_notification_reads r WHERE r.notification_id = n.id AND r.student_id = auth.uid()::TEXT)
    )
    SELECT count(*) FILTER (WHERE presentation IN ('notification', 'urgent')),
      COALESCE(jsonb_agg(jsonb_build_object('id', id, 'title', title, 'body', body, 'created_at', created_at, 'presentation', presentation, 'route', '/admin/dev-notices', 'kind', 'notification') ORDER BY created_at DESC) FILTER (WHERE presentation IN ('notification', 'urgent')), '[]'::JSONB)
    INTO v_notif_count, v_notif_items FROM (SELECT * FROM eligible ORDER BY created_at DESC LIMIT 6) q;
    WITH eligible AS (
      SELECT n.* FROM public.app_notifications n WHERE n.center_id = v_center AND n.source = 'developer' AND n.audience = v_audience AND n.presentation = 'message'
      AND NOT EXISTS (SELECT 1 FROM public.app_notification_reads r WHERE r.notification_id = n.id AND r.student_id = auth.uid()::TEXT)
    )
    SELECT count(*), COALESCE(jsonb_agg(jsonb_build_object('id', id, 'title', title, 'body', body, 'created_at', created_at, 'presentation', presentation, 'route', '/admin/dev-notices?view=message', 'kind', 'developer_message') ORDER BY created_at DESC), '[]'::JSONB)
    INTO v_message_count, v_message_items FROM (SELECT * FROM eligible ORDER BY created_at DESC LIMIT 6) q;

    IF v_role = 'center_admin' THEN
      WITH unread_support AS (
        SELECT m.* FROM public.support_messages m WHERE m.center_id = v_center AND m.sender_role = 'developer'
        AND NOT EXISTS (SELECT 1 FROM public.support_message_reads r WHERE r.message_id = m.id AND r.account_id = auth.uid())
      )
      SELECT v_message_count + count(*),
        COALESCE((SELECT jsonb_agg(item ORDER BY created_at DESC) FROM (
          SELECT item, (item ->> 'created_at')::timestamptz AS created_at FROM jsonb_array_elements(v_message_items) item
          UNION ALL
          SELECT jsonb_build_object('id', id, 'title', 'رد من المطور', 'body', body, 'created_at', created_at, 'route', '/admin/support', 'kind', 'support_message'), created_at FROM unread_support
          ORDER BY created_at DESC LIMIT 6
        ) merged), '[]'::JSONB)
      INTO v_message_count, v_message_items FROM unread_support;
    END IF;
  ELSIF v_role = 'super_admin' THEN
    WITH unread_support AS (
      SELECT m.* FROM public.support_messages m WHERE m.sender_role = 'owner'
      AND NOT EXISTS (SELECT 1 FROM public.support_message_reads r WHERE r.message_id = m.id AND r.account_id = auth.uid())
    )
    SELECT count(*), COALESCE(jsonb_agg(jsonb_build_object('id', id, 'title', 'رسالة دعم جديدة', 'body', body, 'created_at', created_at, 'route', '/developer/support', 'kind', 'support_message') ORDER BY created_at DESC), '[]'::JSONB)
    INTO v_message_count, v_message_items FROM (SELECT * FROM unread_support ORDER BY created_at DESC LIMIT 6) q;
  END IF;
  RETURN jsonb_build_object('notifications', jsonb_build_object('unread', v_notif_count, 'items', v_notif_items), 'messages', jsonb_build_object('unread', v_message_count, 'items', v_message_items));
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_my_communication_summary() TO authenticated;

-- آخر حضور للحساب، لا يعتمد على IP ولا يمنح العميل صلاحية قراءة حضور غيره.
CREATE TABLE IF NOT EXISTS public.account_presence (
  account_id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  device_id TEXT NOT NULL DEFAULT '',
  platform TEXT NOT NULL DEFAULT 'unknown',
  first_seen TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.account_presence ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_account_presence_last_seen ON public.account_presence(last_seen DESC);

CREATE OR REPLACE FUNCTION public.touch_my_account_presence(p_device_id TEXT DEFAULT '', p_platform TEXT DEFAULT 'unknown')
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_device TEXT := left(trim(COALESCE(p_device_id, '')), 128); v_platform TEXT := left(trim(COALESCE(p_platform, 'unknown')), 32);
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid()) THEN RETURN; END IF;
  INSERT INTO public.account_presence(account_id, device_id, platform, first_seen, last_seen)
  VALUES(auth.uid(), v_device, v_platform, now(), now())
  ON CONFLICT(account_id) DO UPDATE SET device_id = EXCLUDED.device_id, platform = EXCLUDED.platform, last_seen = now()
  WHERE public.account_presence.last_seen < now() - interval '1 minute';
END;
$$;
GRANT EXECUTE ON FUNCTION public.touch_my_account_presence(TEXT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.dev_list_center_owner_presence()
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF (SELECT role FROM public.profiles WHERE id = auth.uid()) IS DISTINCT FROM 'super_admin' THEN RAISE EXCEPTION 'not_allowed'; END IF;
  RETURN COALESCE((SELECT jsonb_agg(jsonb_build_object(
    'account_id', p.id, 'center_id', c.id, 'center_name', c.name, 'center_code', c.code,
    'owner_name', p.full_name, 'owner_email', p.email, 'last_seen', ap.last_seen, 'platform', ap.platform
  ) ORDER BY ap.last_seen DESC NULLS LAST, p.created_at DESC)
  FROM public.profiles p JOIN public.centers c ON c.id = p.center_id
  LEFT JOIN public.account_presence ap ON ap.account_id = p.id
  WHERE p.role = 'center_admin'), '[]'::JSONB);
END;
$$;
GRANT EXECUTE ON FUNCTION public.dev_list_center_owner_presence() TO authenticated;

COMMIT;
