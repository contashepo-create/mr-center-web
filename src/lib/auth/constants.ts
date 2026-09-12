// ============================================================
// ثوابت مشتركة بين العميل والخادم لطبقة الجلسة الهجينة:
// - رمز الوصول (access token): قصير العمر، يُحفظ مقروءاً في التخزين المحلي
//   (يقرؤه المتصفح ليُرسله مع كل استعلام — قيد تقني معروف في Supabase).
// - رمز التجديد (refresh token): طويل العمر، يُحفظ في كوكيز HttpOnly
//   خادمي فقط — لا يستطيع أي سكربت في المتصفح سرقته (حماية من XSS).
// ============================================================

/** رابط خادم الإعدادات المركزي (عام، لا يحمل أسراراً). */
export const DEFAULT_CONFIG_URL = 'https://mr-center-config.mobileshop2026.workers.dev/config';

/** اسم مفتاح تخزين جلسة المصادقة في المتصفح. */
export const AUTH_STORAGE_KEY = 'mrcenter-web-auth';

/** اسم كوكيز رمز التجديد (HttpOnly, يُقرأ ويُكتب خادمياً فقط). */
export const REFRESH_COOKIE = 'mr-refresh-token';

/** مدة صلاحية كوكيز رمز التجديد (بالثواني — 7 أيام). */
export const REFRESH_COOKIE_MAX_AGE = 60 * 60 * 24 * 7;

/** قبل انتهاء رمز الوصول بهذا الهامش (بالمللي ثانية) نجدده استباقياً. */
export const ACCESS_REFRESH_MARGIN_MS = 5 * 60 * 1000;

/** مسارات واجهات المصادقة الخادمية. */
export const AUTH_API = {
  storeRefresh: '/api/auth/store-refresh',
  refresh: '/api/auth/refresh',
  clearRefresh: '/api/auth/clear-refresh',
} as const;
