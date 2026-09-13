// ============================================================
// هوية الطباعة الخاصة بالسنتر
// - تحفظ داخل center_settings.settings كي لا تحتاج جدولاً جديداً.
// - تستخدمها جميع قوالب الطباعة الموحدة (تقارير / عهدة / رواتب / اختبار).
// ============================================================

import type { CenterPrintSettings } from './types';

export const DEFAULT_CENTER_PRINT_SETTINGS: CenterPrintSettings = {
  footer_address: '',
  logo_url: '',
  logo_position: 'top_right',
  logo_size: 42,
  watermark_enabled: true,
  watermark_text: '',
  watermark_image: '',
  watermark_opacity: 0.07,
  watermark_direction: 'diagonal',
};

export interface CenterPrintBranding extends CenterPrintSettings {
  center_name: string;
}

const positions = new Set<CenterPrintSettings['logo_position']>(['top_right', 'top_left', 'top_center', 'bottom_right', 'bottom_left']);
const directions = new Set<CenterPrintSettings['watermark_direction']>(['diagonal', 'vertical', 'horizontal']);

/** يطبع الإعدادات القديمة والناقصة بصورة آمنة، ويحصر القيم ذات المدى المحدد. */
function safePrintImageUrl(value: unknown): string {
  if (typeof value !== 'string') return '';
  const source = value.trim().slice(0, 1_100_000);
  if (/^data:image\/(png|jpeg|webp);base64,/i.test(source)) return source;
  if (/^https?:\/\//i.test(source)) return source;
  return '';
}

export function normalizeCenterPrintSettings(value?: Partial<CenterPrintSettings> | null): CenterPrintSettings {
  const raw = value ?? {};
  const opacity = Number(raw.watermark_opacity);
  const size = Number(raw.logo_size);
  return {
    footer_address: typeof raw.footer_address === 'string' ? raw.footer_address.slice(0, 220) : '',
    logo_url: safePrintImageUrl(raw.logo_url),
    logo_position: positions.has(raw.logo_position as CenterPrintSettings['logo_position']) ? raw.logo_position as CenterPrintSettings['logo_position'] : DEFAULT_CENTER_PRINT_SETTINGS.logo_position,
    logo_size: Number.isFinite(size) ? Math.max(24, Math.min(110, Math.round(size))) : DEFAULT_CENTER_PRINT_SETTINGS.logo_size,
    watermark_enabled: raw.watermark_enabled !== false,
    watermark_text: typeof raw.watermark_text === 'string' ? raw.watermark_text.slice(0, 180) : '',
    watermark_image: safePrintImageUrl(raw.watermark_image),
    watermark_opacity: Number.isFinite(opacity) ? Math.max(0.02, Math.min(0.32, opacity)) : DEFAULT_CENTER_PRINT_SETTINGS.watermark_opacity,
    watermark_direction: directions.has(raw.watermark_direction as CenterPrintSettings['watermark_direction']) ? raw.watermark_direction as CenterPrintSettings['watermark_direction'] : DEFAULT_CENTER_PRINT_SETTINGS.watermark_direction,
  };
}

export function brandForCenter(centerName: string | null | undefined, settings?: Partial<CenterPrintSettings> | null): CenterPrintBranding {
  return { center_name: centerName?.trim() || 'MR Center', ...normalizeCenterPrintSettings(settings) };
}

/** يحضّر الصورة المرفقة للطباعة؛ لا يتجاوز 1 MB داخل JSON إعدادات السنتر. */
export async function imageFileToPrintDataUrl(file: File): Promise<string> {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error('اختر صورة PNG أو JPG أو WEBP للشعار أو العلامة المائية.');
  if (file.size > 8 * 1024 * 1024) throw new Error('حجم الصورة كبير. اختر صورة أقل من 8 ميجابايت.');

  const original = await readFileAsDataUrl(file);
  const image = await loadImage(original);
  const maxSide = 900;
  const scale = Math.min(1, maxSide / Math.max(image.naturalWidth || image.width, image.naturalHeight || image.height));
  const width = Math.max(1, Math.round((image.naturalWidth || image.width) * scale));
  const height = Math.max(1, Math.round((image.naturalHeight || image.height) * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) return original;
  context.drawImage(image, 0, 0, width, height);

  // PNG يحافظ على شفافية الشعار؛ وإن أصبح كبيراً نعيده JPEG مضغوطاً.
  let result = canvas.toDataURL(file.type === 'image/png' ? 'image/png' : 'image/jpeg', 0.84);
  if (result.length > 950_000) result = canvas.toDataURL('image/jpeg', 0.76);
  if (result.length > 1_080_000) throw new Error('تعذر ضغط الصورة بالحجم المناسب. استخدم شعاراً أبسط أو أصغر.');
  return result;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('تعذر قراءة ملف الصورة.'));
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('تعذر تجهيز الصورة المختارة.'));
    image.src = src;
  });
}
