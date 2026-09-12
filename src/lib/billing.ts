// ============================================================
// الباقات الاحترافية: المنتجات والأسعار والمدد وحدود الفريق والطلاب
// trial: تجريبية ٧ أيام بمزايا كاملة — بعدها الترقية عبر المطور
// ============================================================

import type { PlanType } from './types';

export interface PlanDuration {
  months: number;
  label: string;
  price: number;
}

export interface PlanProduct {
  plan: PlanType;
  name: string;
  tagline: string;
  durations: PlanDuration[];
  managers: number;
  secretaries: number;
  teachers: number;
  maxStudents: number | null; // null = غير محدود
  features: string[];
}

export const TRIAL_DAYS = 14;

export const PRODUCTS: PlanProduct[] = [
  {
    plan: 'center_full',
    name: 'سنتر شامل',
    tagline: 'كل الصلاحيات لفريقك كاملاً',
    durations: [
      { months: 1, label: 'شهري', price: 600 },
      { months: 12, label: 'سنوي', price: 6500 },
      { months: 24, label: 'سنتان', price: 12000 },
    ],
    // المدير هو صاحب السنتر دائماً — بلا مدير مضاف في أي باقة
    managers: 0, secretaries: 2, teachers: 4, maxStudents: null,
    features: ['كل الصلاحيات', 'حتى 4 مدرسين + 2 سكرتارية', 'طلاب غير محدود', 'المحاسبة والعهدة والرواتب', 'تقارير PDF متقدمة', 'إشعارات وواتساب'],
  },
  {
    plan: 'center_medium',
    name: 'سنتر متوسط',
    tagline: 'مثالي للسناتر الناشئة',
    durations: [
      { months: 1, label: 'شهري', price: 400 },
      { months: 12, label: 'سنوي', price: 4500 },
      { months: 24, label: 'سنتان', price: 8500 },
    ],
    managers: 0, secretaries: 1, teachers: 2, maxStudents: 300,
    features: ['كل صلاحيات الإدارة الأساسية', 'حتى 2 مدرسين + سكرتير', 'حتى 300 طالب', 'تقارير PDF', 'إشعارات وواتساب'],
  },
  {
    plan: 'solo_teacher',
    name: 'مدرس خصوصي',
    tagline: 'إدارة موادك وطلابك بنفسك',
    durations: [
      { months: 1, label: 'شهري', price: 300 },
      { months: 12, label: 'سنوي', price: 3000 },
      { months: 24, label: 'سنتان', price: 5000 },
    ],
    managers: 0, secretaries: 0, teachers: 0, maxStudents: 200,
    features: ['كل وظائف الإدارة', 'حتى 200 طالب', 'تقارير PDF', 'إشعارات وواتساب'],
  },
];

export function planById(plan: string | null | undefined): PlanProduct | null {
  return PRODUCTS.find((p) => p.plan === plan) ?? null;
}

/** اسم الباقة للعرض (يشمل القديمة trial/monthly/yearly/custom) */
export function planLabel(plan: string | null | undefined): string {
  if (!plan) return '—';
  const found = planById(plan);
  if (found) return found.name;
  if (plan === 'trial') return 'تجريبية';
  if (plan === 'monthly') return 'شهرية';
  if (plan === 'yearly') return 'سنوية';
  return 'مخصصة';
}

export interface PlanLimits {
  managers: number;
  secretaries: number;
  teachers: number;
  maxStudents: number | null;
}

/** حدود الفريق والطلاب حسب نوع الحساب وخطته */
export function limitsFor(centerKind: string | null | undefined, plan: string | null | undefined): PlanLimits {
  if (centerKind === 'solo') {
    return { managers: 0, secretaries: 0, teachers: 0, maxStudents: 200 };
  }
  const product = planById(plan);
  if (product) {
    return {
      managers: product.managers, secretaries: product.secretaries,
      teachers: product.teachers, maxStudents: product.maxStudents,
    };
  }
  // التجريبية والقديمة والمخصصة: حدود الشاملة (المدير هو صاحب السنتر دائماً)
  return { managers: 0, secretaries: 2, teachers: 4, maxStudents: null };
}

/** سعر مدة معينة من منتج */
export function priceFor(plan: PlanType, months: number): number | null {
  const d = planById(plan)?.durations.find((x) => x.months === months);
  return d ? d.price : null;
}
