// ============================================================
// المزايا المدفوعة + السنة المالية (لا تُضاف إلى api.ts حفاظاً على
// تطابق api.ts مع تطبيق Android — تعيش هنا في ملف مستقل).
// ============================================================

import { getSupabase } from './supabase';
import { getDeviceId } from './visitors';
import { sendSupportMessage } from './api';

export interface MyFeatures {
  accounting: boolean;
}

export interface FiscalYear {
  id: string;
  center_id: string;
  year_label: string;
  starts_on: string;
  ends_on: string | null;
  status: 'open' | 'closed';
  opening_balance: number;
  opening_pending_dues: number;
  closing_income: number | null;
  closing_expense: number | null;
  closing_balance: number | null;
  closing_pending_dues: number | null;
  opened_at: string;
  closed_at: string | null;
}

/** مزايا المستخدم الحالي (مثل: هل المحاسبة مفعلة لسنتره) */
export async function fetchMyFeatures(): Promise<MyFeatures> {
  const { data, error } = await getSupabase().rpc('get_my_features');
  if (error) throw error;
  return ((data ?? { accounting: false }) as MyFeatures);
}

/** سنوات السنتر المالية (المفتوحة والمغلقة) */
export async function fetchMyFiscalYears(): Promise<FiscalYear[]> {
  const { data, error } = await getSupabase().rpc('get_my_fiscal_years');
  if (error) throw error;
  return (Array.isArray(data) ? data : []) as FiscalYear[];
}

/** إغلاق السنة الحالية وفتح السنة التالية مع ترحيل الرصيد الافتتاحي */
export async function closeFiscalYear(centerId: string): Promise<{
  closed: string; opened: string; carry_balance: number; carry_pending: number;
}> {
  const { data, error } = await getSupabase().rpc('close_fiscal_year', { p_center: centerId });
  if (error) throw error;
  return data as { closed: string; opened: string; carry_balance: number; carry_pending: number };
}

/** صاحب سنتر غير مشترك يطلب تفعيل خدمة المحاسبة من المطور */
export async function requestAccounting(centerId: string): Promise<void> {
  await sendSupportMessage(centerId, 'أرغب في تفعيل خدمة المحاسبة (الخدمة المدفوعة) لسنترنا. برجاء التواصل لتوضيح طريقة الاشتراك.');
}

export interface VisitorStats {
  total: number;
  today: number;
  week: number;
}

export interface VisitorRow {
  id: string;
  device_id: string;
  first_seen: string;
  last_seen: string;
  blocked: boolean;
}

/** إحصاءات الزوار (المطور فقط — كل جهاز فريد يُعدّ مرة واحدة) */
export async function devFetchVisitorStats(): Promise<VisitorStats> {
  const { data, error } = await getSupabase().rpc('get_site_visitor_stats');
  if (error) throw error;
  return ((data ?? { total: 0, today: 0, week: 0 }) as VisitorStats);
}

/** قائمة أحدث الأجهزة المسجلة (المطور فقط) */
export async function devListVisitors(): Promise<VisitorRow[]> {
  const { data, error } = await getSupabase().rpc('dev_list_visitors');
  if (error) throw error;
  return (Array.isArray(data) ? data : []) as VisitorRow[];
}

/** حجب/إلغاء حجب جهاز (المطور فقط) */
export async function devSetDeviceBlocked(deviceId: string, blocked: boolean): Promise<void> {
  const { error } = await getSupabase().rpc('dev_set_device_blocked', { p_device_id: deviceId, p_blocked: blocked });
  if (error) throw error;
}

/** آخر نشاط للحساب الحالي. الجهاز معرف محلي عشوائي، وليس عنوان IP أو بصمة عتاد. */
export async function touchMyAccountPresence(): Promise<void> {
  const { error } = await getSupabase().rpc('touch_my_account_presence', {
    p_device_id: getDeviceId(), p_platform: 'web',
  });
  if (error) throw error;
}

export interface CenterOwnerPresence {
  account_id: string;
  center_id: string;
  center_name: string;
  center_code: string;
  owner_name: string;
  owner_email: string | null;
  last_seen: string | null;
  platform: string | null;
}

/** آخر ظهور لصاحب كل سنتر — المطور فقط، من سجل حضور الحساب لا من IP. */
export async function devListCenterOwnerPresence(): Promise<CenterOwnerPresence[]> {
  const { data, error } = await getSupabase().rpc('dev_list_center_owner_presence');
  if (error) throw error;
  return (Array.isArray(data) ? data : []) as CenterOwnerPresence[];
}

/** المطور يفعّل/يوقف المحاسبة لسنتر محدد */
export async function devSetAccounting(centerId: string, enabled: boolean): Promise<void> {
  const { error } = await getSupabase().rpc('dev_set_accounting', { p_center: centerId, p_enabled: enabled });
  if (error) throw error;
}

export interface AccountingState {
  enabled: boolean;
  viaEntitlement: boolean;
  openEnded: boolean | null;
  startsOn: string | null;
  endsOn: string | null;
}

/** حالة خدمة المحاسبة لسنتر (من لوحة المطور) */
export async function devGetAccountingState(centerId: string): Promise<AccountingState> {
  const sb = getSupabase();
  const { data: ent } = await sb
    .from('center_entitlements')
    .select('starts_on, ends_on, is_open_ended')
    .eq('center_id', centerId)
    .eq('feature_key', 'accounting')
    .maybeSingle();
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const { data: sub } = await sb
    .from('center_subscriptions')
    .select('enabled_features,starts_on,ends_on')
    .eq('center_id', centerId)
    .eq('status', 'active')
    .lte('starts_on', today)
    .gte('ends_on', today)
    .order('ends_on', { ascending: false })
    .limit(1)
    .maybeSingle();

  const e = (ent ?? null) as { starts_on: string | null; ends_on: string | null; is_open_ended: boolean | null } | null;
  const entActive = !!e
    && !!e.starts_on && new Date(e.starts_on) <= now
    && (!!e.is_open_ended || (e.ends_on ? new Date(e.ends_on) >= now : false));
  const subscription = sub as { enabled_features?: Record<string, unknown>; starts_on?: string | null; ends_on?: string | null } | null;
  // لا تعرض لوحة المطور خدمة منتهية كأنها مفعلة؛ نفس قاعدة الدالة الخادمية.
  const subFlag = subscription?.enabled_features?.accounting === true
    && (!subscription.starts_on || subscription.starts_on <= today)
    && (!subscription.ends_on || subscription.ends_on >= today);

  return {
    enabled: subFlag || entActive,
    viaEntitlement: !!e,
    openEnded: e?.is_open_ended ?? null,
    startsOn: e?.starts_on ?? null,
    endsOn: e?.ends_on ?? null,
  };
}

// ============================================================
// تنبيهات تجاوز حدود الاشتراك (لوحة إدارة المشتركين — المطور فقط)
// تعتمد على RPCs يضيفها supabase/20260912_entitlement_enforcement.sql
// ============================================================
export interface UsageAlert {
  id: string;
  center_id: string;
  center_name: string;
  center_code: string;
  kind: 'teachers_over_limit' | 'secretaries_over_limit' | 'managers_over_limit' | 'students_over_limit';
  title: string;
  detail: { used: number; limit: number } | Record<string, unknown>;
  status: 'open' | 'resolved';
  resolution: 'auto' | 'blocked' | 'manual' | null;
  created_at: string;
  resolved_at: string | null;
}

export const ALERT_LABEL: Record<UsageAlert['kind'], string> = {
  teachers_over_limit: 'مدرسين',
  secretaries_over_limit: 'سكرتارية',
  managers_over_limit: 'مديرين',
  students_over_limit: 'طلاب',
};

/** قائمة تنبيهات التجاوز (مفتوحة ثم حديثة) */
export async function devListUsageAlerts(): Promise<UsageAlert[]> {
  const { data, error } = await getSupabase().rpc('list_center_alerts');
  if (error) throw error;
  return (Array.isArray(data) ? data : []) as UsageAlert[];
}

/** إعادة فحص كل السناتر وتحديث التنبيهات تلقائياً */
export async function devAuditUsage(): Promise<void> {
  const { error } = await getSupabase().rpc('audit_center_usage');
  if (error) throw error;
}

/** حجب حساب متجاوز (إيقاف السنتر والاشتراك وحل التنبيهات) */
export async function devBlockCenter(centerId: string): Promise<void> {
  const { error } = await getSupabase().rpc('dev_block_center', { p_center: centerId });
  if (error) throw error;
}

/** إلغاء حجب حساب */
export async function devUnblockCenter(centerId: string): Promise<void> {
  const { error } = await getSupabase().rpc('dev_unblock_center', { p_center: centerId });
  if (error) throw error;
}
