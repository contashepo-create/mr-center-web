-- Mr Center — ترحيل آمن للتحديثات الجديدة
-- التاريخ: 2026-09-11
-- شغّل هذا الملف بعد android_multitenant_schema.sql وعلى نسخة اختبار أولاً.
-- الملف idempotent: يمكن إعادة تشغيله دون إنشاء جداول أو سياسات مكررة.
-- لا يحتوي على service_role أو أي مفتاح سري.

BEGIN;

-- 1) أعمدة الحسابات والتحصيل
ALTER TABLE public.center_subscriptions ADD COLUMN IF NOT EXISTS extra_teachers integer NOT NULL DEFAULT 0;
ALTER TABLE public.center_subscriptions ADD COLUMN IF NOT EXISTS extra_secretaries integer NOT NULL DEFAULT 0;
ALTER TABLE public.center_subscriptions ADD COLUMN IF NOT EXISTS extra_managers integer NOT NULL DEFAULT 0;
ALTER TABLE public.center_subscriptions ADD COLUMN IF NOT EXISTS enabled_features jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS collected_by uuid REFERENCES auth.users(id);
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS collected_by_name text NOT NULL DEFAULT '';

-- 2) دفتر الحسابات
CREATE TABLE IF NOT EXISTS public.center_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  center_id uuid NOT NULL REFERENCES public.centers(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('income','expense')),
  category text NOT NULL,
  description text NOT NULL DEFAULT '',
  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  occurred_on date NOT NULL DEFAULT CURRENT_DATE,
  created_by uuid REFERENCES auth.users(id),
  created_by_name text NOT NULL DEFAULT '',
  source_payment_id text,
  employee_id uuid REFERENCES public.profiles(id),
  entry_type text NOT NULL DEFAULT 'general',
  period_month integer,
  period_year integer,
  deduction numeric(12,2) NOT NULL DEFAULT 0 CHECK (deduction >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.center_ledger ADD COLUMN IF NOT EXISTS source_payment_id text;
ALTER TABLE public.center_ledger ADD COLUMN IF NOT EXISTS employee_id uuid REFERENCES public.profiles(id);
ALTER TABLE public.center_ledger ADD COLUMN IF NOT EXISTS entry_type text NOT NULL DEFAULT 'general';
ALTER TABLE public.center_ledger ADD COLUMN IF NOT EXISTS period_month integer;
ALTER TABLE public.center_ledger ADD COLUMN IF NOT EXISTS period_year integer;
ALTER TABLE public.center_ledger ADD COLUMN IF NOT EXISTS deduction numeric(12,2) NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_center_ledger_center_date ON public.center_ledger(center_id, occurred_on DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_center_ledger_payment ON public.center_ledger(source_payment_id) WHERE source_payment_id IS NOT NULL;
ALTER TABLE public.center_ledger ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ledger_owner_all ON public.center_ledger;
CREATE POLICY ledger_owner_all ON public.center_ledger FOR ALL TO authenticated USING (public.admin_owns_center(center_id)) WITH CHECK (public.admin_owns_center(center_id));
DROP POLICY IF EXISTS ledger_developer_all ON public.center_ledger;
CREATE POLICY ledger_developer_all ON public.center_ledger FOR ALL TO authenticated USING (public.my_role() = 'super_admin') WITH CHECK (public.my_role() = 'super_admin');

-- 3) الزيادة المؤقتة لفريق العمل
CREATE TABLE IF NOT EXISTS public.center_entitlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  center_id uuid NOT NULL REFERENCES public.centers(id) ON DELETE CASCADE,
  extra_teachers integer NOT NULL DEFAULT 0 CHECK (extra_teachers >= 0),
  extra_secretaries integer NOT NULL DEFAULT 0 CHECK (extra_secretaries >= 0),
  extra_managers integer NOT NULL DEFAULT 0 CHECK (extra_managers >= 0),
  feature_key text NOT NULL DEFAULT 'staff_expansion',
  starts_on date NOT NULL DEFAULT CURRENT_DATE,
  ends_on date,
  is_open_ended boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (is_open_ended OR ends_on IS NOT NULL),
  UNIQUE(center_id, feature_key)
);
ALTER TABLE public.center_entitlements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS entitlements_owner_read ON public.center_entitlements;
CREATE POLICY entitlements_owner_read ON public.center_entitlements FOR SELECT TO authenticated USING (public.admin_owns_center(center_id));
DROP POLICY IF EXISTS entitlements_dev_all ON public.center_entitlements;
CREATE POLICY entitlements_dev_all ON public.center_entitlements FOR ALL TO authenticated USING (public.my_role() = 'super_admin') WITH CHECK (public.my_role() = 'super_admin');

CREATE OR REPLACE FUNCTION public.dev_upsert_entitlement(p_center uuid,p_teachers int,p_secretaries int,p_managers int,p_starts date,p_ends date,p_open boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF public.my_role() <> 'super_admin' THEN RAISE EXCEPTION 'not_allowed'; END IF;
  IF NOT p_open AND p_ends IS NULL THEN RAISE EXCEPTION 'end_date_required'; END IF;
  INSERT INTO public.center_entitlements(center_id,extra_teachers,extra_secretaries,extra_managers,starts_on,ends_on,is_open_ended,created_by)
  VALUES(p_center,greatest(p_teachers,0),greatest(p_secretaries,0),greatest(p_managers,0),coalesce(p_starts,current_date),p_ends,p_open,auth.uid())
  ON CONFLICT(center_id,feature_key) DO UPDATE SET extra_teachers=excluded.extra_teachers,extra_secretaries=excluded.extra_secretaries,extra_managers=excluded.extra_managers,starts_on=excluded.starts_on,ends_on=excluded.ends_on,is_open_ended=excluded.is_open_ended,created_by=auth.uid();
END; $$;
GRANT EXECUTE ON FUNCTION public.dev_upsert_entitlement(uuid,int,int,int,date,date,boolean) TO authenticated;

-- 4) الإيراد التلقائي من الدفعات
CREATE OR REPLACE FUNCTION public.record_payment_income()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE cid uuid; collector_name text;
BEGIN
  SELECT center_id INTO cid FROM public.students WHERE id=NEW.student_id;
  SELECT full_name INTO collector_name FROM public.profiles WHERE id=coalesce(NEW.collected_by,auth.uid());
  IF cid IS NOT NULL THEN
    INSERT INTO public.center_ledger(center_id,kind,category,description,amount,occurred_on,created_by,created_by_name,source_payment_id,entry_type,period_month,period_year)
    VALUES(cid,'income','تحصيل طلاب','تحصيل من طالب',NEW.amount,NEW.payment_date,coalesce(NEW.collected_by,auth.uid()),coalesce(NEW.collected_by_name,collector_name,''),NEW.id,'payment_collection',extract(month from NEW.payment_date),extract(year from NEW.payment_date))
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_payment_income ON public.payments;
CREATE TRIGGER trg_payment_income AFTER INSERT ON public.payments FOR EACH ROW EXECUTE FUNCTION public.record_payment_income();

-- 5) العهدة اليومية والشهرية
CREATE TABLE IF NOT EXISTS public.staff_custody (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  center_id uuid NOT NULL REFERENCES public.centers(id) ON DELETE CASCADE,
  staff_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  custody_date date NOT NULL DEFAULT CURRENT_DATE,
  expected_amount numeric(12,2) NOT NULL DEFAULT 0 CHECK (expected_amount >= 0),
  delivered_amount numeric(12,2) NOT NULL DEFAULT 0 CHECK (delivered_amount >= 0),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','submitted','matched','shortage','surplus')),
  notes text NOT NULL DEFAULT '',
  submitted_at timestamptz,
  submitted_by uuid REFERENCES auth.users(id),
  reviewed_at timestamptz,
  reviewed_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(center_id,staff_id,custody_date)
);
ALTER TABLE public.staff_custody ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS custody_owner_all ON public.staff_custody;
CREATE POLICY custody_owner_all ON public.staff_custody FOR ALL TO authenticated USING (public.admin_owns_center(center_id)) WITH CHECK (public.admin_owns_center(center_id));
DROP POLICY IF EXISTS custody_staff_read ON public.staff_custody;
CREATE POLICY custody_staff_read ON public.staff_custody FOR SELECT TO authenticated USING (staff_id=auth.uid());

CREATE OR REPLACE FUNCTION public.submit_staff_custody(p_staff uuid,p_date date,p_delivered numeric,p_notes text DEFAULT '')
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE cid uuid; expected numeric; result uuid;
BEGIN
  SELECT center_id INTO cid FROM public.profiles WHERE id=auth.uid() AND role IN ('manager','secretary') AND is_active;
  IF cid IS NULL OR p_staff <> auth.uid() THEN RAISE EXCEPTION 'not_allowed'; END IF;
  SELECT coalesce(sum(amount),0) INTO expected FROM public.center_ledger WHERE center_id=cid AND created_by=p_staff AND entry_type='payment_collection' AND occurred_on=p_date;
  INSERT INTO public.staff_custody(center_id,staff_id,custody_date,expected_amount,delivered_amount,status,notes,submitted_at,submitted_by)
  VALUES(cid,p_staff,p_date,expected,greatest(p_delivered,0),CASE WHEN p_delivered=expected THEN 'matched' WHEN p_delivered<expected THEN 'shortage' ELSE 'surplus' END,coalesce(p_notes,''),now(),auth.uid())
  ON CONFLICT(center_id,staff_id,custody_date) DO UPDATE SET expected_amount=excluded.expected_amount,delivered_amount=excluded.delivered_amount,status=excluded.status,notes=excluded.notes,submitted_at=now(),submitted_by=auth.uid()
  RETURNING id INTO result;
  RETURN result;
END; $$;
GRANT EXECUTE ON FUNCTION public.submit_staff_custody(uuid,date,numeric,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.review_staff_custody(p_id uuid,p_status text,p_notes text DEFAULT '')
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF p_status NOT IN ('matched','shortage','surplus','open') THEN RAISE EXCEPTION 'invalid_status'; END IF;
  UPDATE public.staff_custody SET status=p_status,notes=CASE WHEN p_notes='' THEN notes ELSE p_notes END,reviewed_at=now(),reviewed_by=auth.uid()
  WHERE id=p_id AND public.admin_owns_center(center_id);
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
END; $$;
GRANT EXECUTE ON FUNCTION public.review_staff_custody(uuid,text,text) TO authenticated;

-- 6) قواعد العمولات
CREATE TABLE IF NOT EXISTS public.staff_commission_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), center_id uuid NOT NULL REFERENCES public.centers(id) ON DELETE CASCADE,
  staff_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  rate numeric(5,2) NOT NULL DEFAULT 3 CHECK(rate >= 0 AND rate <= 100),
  starts_on date NOT NULL DEFAULT CURRENT_DATE, ends_on date, is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(center_id,staff_id)
);
ALTER TABLE public.staff_commission_rules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS commission_owner_all ON public.staff_commission_rules;
CREATE POLICY commission_owner_all ON public.staff_commission_rules FOR ALL TO authenticated USING (public.admin_owns_center(center_id)) WITH CHECK (public.admin_owns_center(center_id));

CREATE OR REPLACE FUNCTION public.calculate_staff_commission(p_staff uuid,p_from date,p_to date)
RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE cid uuid; rate numeric; total numeric;
BEGIN
  SELECT center_id INTO cid FROM public.profiles WHERE id=auth.uid() AND (role='super_admin' OR (role='center_admin' AND center_id=(SELECT center_id FROM public.profiles WHERE id=p_staff)));
  IF cid IS NULL THEN RAISE EXCEPTION 'not_allowed'; END IF;
  SELECT coalesce((SELECT rate FROM public.staff_commission_rules WHERE staff_id=p_staff AND center_id=cid AND is_active AND starts_on<=p_to AND (ends_on IS NULL OR ends_on>=p_from) LIMIT 1),0) INTO rate;
  SELECT coalesce(sum(amount),0) INTO total FROM public.center_ledger WHERE center_id=cid AND created_by=p_staff AND entry_type='payment_collection' AND occurred_on BETWEEN p_from AND p_to;
  RETURN round(total*rate/100,2);
END; $$;
GRANT EXECUTE ON FUNCTION public.calculate_staff_commission(uuid,date,date) TO authenticated;

COMMIT;

-- بعد التشغيل تحقق من الجداول والدوال، ثم اختبر مستخدمين من سنترين مختلفين.
-- لا تشغّل هذا الملف قبل أخذ نسخة احتياطية من قاعدة الإنتاج.
