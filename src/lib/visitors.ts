// ============================================================
// عداد الزوار: كل جهاز رقم فريد يُسجل مرة واحدة فقط.
// لا تُعدّ تصفحات الصفحات المتعددة زيارات — الصف واحد لكل جهاز.
//
// التسجيل إلزامي (ضروري لأغراض أمنية ومنع إساءة الاستخدام):
// معرّف الجهاز المجهول يُسجَّل دائماً حتى لو رفض المستخدم رسالة
// التفضيلات الاختيارية — حتى يتمكن المطور من حجب الأجهزة المسيئة.
// ============================================================

import { getSupabase, initSupabase } from './supabase';

const DEVICE_KEY = 'mrcenter.web.device.id';

function deviceId(): string {
  if (typeof window === 'undefined') return '';
  try {
    let id = window.localStorage.getItem(DEVICE_KEY);
    if (!id) {
      id = typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
      window.localStorage.setItem(DEVICE_KEY, id);
    }
    return id;
  } catch {
    return '';
  }
}

/** معرّف الجهاز المجهول (يُنشأ مرة واحدة ويُحفظ محلياً) — يستخدم أيضاً لحماية الدخول. */
export function getDeviceId(): string {
  return deviceId();
}

/** تسجيل الزيارة (مرة واحدة لكل جهاز) — يُستدعى دائماً بغض النظر عن التفضيلات. */
export async function trackVisit(): Promise<void> {
  try {
    const id = deviceId();
    if (!id) return;
    await initSupabase();
    await getSupabase().rpc('track_site_visit', { p_device_id: id });
  } catch {
    // تجاهل أي فشل — لا يعطّل الموقع أبداً
  }
}

/** هل هذا الجهاز محجوب من المطور؟ (يُستخدم لمنع الأجهزة المسيئة من استخدام الموقع) */
export async function isDeviceBlocked(): Promise<boolean> {
  try {
    const id = deviceId();
    if (!id) return false;
    await initSupabase();
    const { data, error } = await getSupabase().rpc('is_device_blocked', { p_device_id: id });
    if (error) return false;
    return data === true;
  } catch {
    return false;
  }
}
