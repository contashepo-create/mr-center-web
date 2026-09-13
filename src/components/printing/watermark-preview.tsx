'use client';

import type { CSSProperties } from 'react';
import { watermarkDisplayText, watermarkGridColumns, watermarkRepeatCount, type CenterPrintBranding } from '@/lib/printing';

/** طبقة معاينة مشتركة للعلامة المائية في هوية الطباعة وورقة الاختبار. */
export function WatermarkPreview({ branding, className }: { branding: CenterPrintBranding; className: string }) {
  if (!branding.watermark_enabled) return null;
  const count = watermarkRepeatCount(branding);
  const text = watermarkDisplayText(branding);
  const style = {
    opacity: branding.watermark_opacity,
    '--watermark-font-size': `${branding.watermark_font_size}px`,
    '--watermark-image-size': `${branding.watermark_image_size}px`,
    '--watermark-color': branding.watermark_color,
    '--watermark-columns': watermarkGridColumns(branding),
  } as CSSProperties;

  return (
    <div className={`${className} ${branding.watermark_direction} ${branding.watermark_pattern} ${branding.watermark_layer}`} style={style} aria-hidden="true">
      <div className="print-watermark-grid">
        {Array.from({ length: count }, (_, index) => (
          <div className="print-watermark-mark" key={index}>
            {branding.watermark_image ? <img src={branding.watermark_image} alt="" /> : null}
            {text ? <span>{text}</span> : null}
          </div>
        ))}
      </div>
    </div>
  );
}
