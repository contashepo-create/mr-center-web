// ============================================================
// هوية الطباعة الخاصة بالسنتر
// - تحفظ داخل center_settings.settings كي لا تحتاج جدولاً جديداً.
// - تستخدمها جميع قوالب الطباعة الموحدة (تقارير / عهدة / رواتب / اختبار).
// ============================================================

import type { CenterPrintSettings } from './types';

export const DEFAULT_CENTER_PRINT_SETTINGS: CenterPrintSettings = {
  footer_address: '',
  footer_enabled: true,
  footer_show_center_name: true,
  footer_show_address: true,
  footer_font_size: 9,
  header_show_center_name: true,
  logo_url: '',
  logo_position: 'top_right',
  logo_size: 42,
  watermark_enabled: true,
  watermark_text: '',
  watermark_image: '',
  watermark_opacity: 0.09,
  watermark_direction: 'diagonal',
  watermark_pattern: 'single',
  watermark_repeat_count: 9,
  watermark_font_size: 76,
  watermark_image_size: 150,
  watermark_color: '#14513e',
  // الطبقة الأمامية تجعل العلامة ظاهرة حتى فوق خلايا الجداول والأسئلة.
  watermark_layer: 'front',
};

export interface CenterPrintBranding extends CenterPrintSettings {
  center_name: string;
}

const positions = new Set<CenterPrintSettings['logo_position']>(['top_right', 'top_left', 'top_center', 'bottom_right', 'bottom_left']);
const directions = new Set<CenterPrintSettings['watermark_direction']>(['diagonal', 'vertical', 'horizontal']);
const patterns = new Set<CenterPrintSettings['watermark_pattern']>(['single', 'grid', 'staggered']);
const layers = new Set<CenterPrintSettings['watermark_layer']>(['front', 'behind']);

function inRange(value: unknown, min: number, max: number, fallback: number): number {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, Math.round(number))) : fallback;
}

function safePrintColor(value: unknown): string {
  const color = typeof value === 'string' ? value.trim() : '';
  return /^#[0-9a-f]{6}$/i.test(color) ? color : DEFAULT_CENTER_PRINT_SETTINGS.watermark_color;
}

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
  return {
    footer_address: typeof raw.footer_address === 'string' ? raw.footer_address.slice(0, 220) : '',
    footer_enabled: raw.footer_enabled !== false,
    footer_show_center_name: raw.footer_show_center_name !== false,
    footer_show_address: raw.footer_show_address !== false,
    footer_font_size: inRange(raw.footer_font_size, 7, 18, DEFAULT_CENTER_PRINT_SETTINGS.footer_font_size),
    header_show_center_name: raw.header_show_center_name !== false,
    logo_url: safePrintImageUrl(raw.logo_url),
    logo_position: positions.has(raw.logo_position as CenterPrintSettings['logo_position']) ? raw.logo_position as CenterPrintSettings['logo_position'] : DEFAULT_CENTER_PRINT_SETTINGS.logo_position,
    logo_size: inRange(raw.logo_size, 24, 110, DEFAULT_CENTER_PRINT_SETTINGS.logo_size),
    watermark_enabled: raw.watermark_enabled !== false,
    watermark_text: typeof raw.watermark_text === 'string' ? raw.watermark_text.slice(0, 180) : '',
    watermark_image: safePrintImageUrl(raw.watermark_image),
    watermark_opacity: Number.isFinite(opacity) ? Math.max(0.01, Math.min(0.55, opacity)) : DEFAULT_CENTER_PRINT_SETTINGS.watermark_opacity,
    watermark_direction: directions.has(raw.watermark_direction as CenterPrintSettings['watermark_direction']) ? raw.watermark_direction as CenterPrintSettings['watermark_direction'] : DEFAULT_CENTER_PRINT_SETTINGS.watermark_direction,
    watermark_pattern: patterns.has(raw.watermark_pattern as CenterPrintSettings['watermark_pattern']) ? raw.watermark_pattern as CenterPrintSettings['watermark_pattern'] : DEFAULT_CENTER_PRINT_SETTINGS.watermark_pattern,
    watermark_repeat_count: inRange(raw.watermark_repeat_count, 1, 36, DEFAULT_CENTER_PRINT_SETTINGS.watermark_repeat_count),
    watermark_font_size: inRange(raw.watermark_font_size, 16, 180, DEFAULT_CENTER_PRINT_SETTINGS.watermark_font_size),
    watermark_image_size: inRange(raw.watermark_image_size, 32, 340, DEFAULT_CENTER_PRINT_SETTINGS.watermark_image_size),
    watermark_color: safePrintColor(raw.watermark_color),
    watermark_layer: layers.has(raw.watermark_layer as CenterPrintSettings['watermark_layer']) ? raw.watermark_layer as CenterPrintSettings['watermark_layer'] : DEFAULT_CENTER_PRINT_SETTINGS.watermark_layer,
  };
}

export function brandForCenter(centerName: string | null | undefined, settings?: Partial<CenterPrintSettings> | null): CenterPrintBranding {
  return { center_name: centerName?.trim() || 'MR Center', ...normalizeCenterPrintSettings(settings) };
}

/** النص الذي تعرضه العلامة؛ يبقى مستقلاً عن إخفاء الاسم في ترويسة/تذييل الوثيقة. */
export function watermarkDisplayText(branding: CenterPrintBranding): string {
  return branding.watermark_text.trim() || branding.center_name;
}

/** عدد وشبكة العلامات في الورقة. النمط المفرد لا ينتج إلا علامة واحدة دائماً. */
export function watermarkRepeatCount(branding: CenterPrintBranding): number {
  return branding.watermark_pattern === 'single' ? 1 : Math.max(1, branding.watermark_repeat_count);
}

export function watermarkGridColumns(branding: CenterPrintBranding): number {
  const count = watermarkRepeatCount(branding);
  if (count <= 1) return 1;
  return Math.max(2, Math.ceil(Math.sqrt(count * 1.35)));
}

/** نص التذييل النهائي بعد احترام اختيارات الإظهار المستقلة. */
export function documentFooterText(branding: CenterPrintBranding): string {
  if (!branding.footer_enabled) return '';
  return [
    branding.footer_show_center_name ? branding.center_name : '',
    branding.footer_show_address ? branding.footer_address.trim() : '',
  ].filter(Boolean).join('  —  ');
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
