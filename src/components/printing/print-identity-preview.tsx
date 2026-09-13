'use client';

import type { CenterPrintBranding } from '@/lib/printing';
import { WatermarkPreview } from './watermark-preview';

/** معاينة ورقية حية لهوية السنتر قبل حفظها، بلا إرسال أي ملف أو إعداد. */
export function PrintIdentityPreview({ branding, compact = false }: { branding: CenterPrintBranding; compact?: boolean }) {
  const footer = branding.footer_enabled ? [
    branding.footer_show_center_name ? branding.center_name : '',
    branding.footer_show_address ? branding.footer_address : '',
  ].filter(Boolean) : [];
  return (
    <div className={`print-identity-preview ${compact ? 'compact' : ''}`} dir="rtl">
      <div className="print-preview-sheet">
        <WatermarkPreview branding={branding} className="print-preview-watermark" />
        {branding.logo_url ? <img className={`print-preview-logo ${branding.logo_position}`} style={{ width: branding.logo_size }} src={branding.logo_url} alt="شعار السنتر" /> : null}
        <div className="print-preview-content">
          <header>{branding.header_show_center_name ? <small>{branding.center_name}</small> : null}<h3>نموذج مستند رسمي</h3><p>معاينة مباشرة للشعار والعلامة المائية والتذييل.</p></header>
          <div className="print-preview-lines"><i /><i /><i /><i /></div>
          <table><thead><tr><th>البند</th><th>البيان</th><th>القيمة</th></tr></thead><tbody><tr><td>١</td><td>نموذج بيانات للطباعة</td><td>—</td></tr><tr><td>٢</td><td>يظهر الشعار في الموضع المحدد</td><td>—</td></tr></tbody></table>
        </div>
        {footer.length ? <footer style={{ fontSize: branding.footer_font_size }}><span>{footer[0]}</span>{footer[1] ? <span>{footer[1]}</span> : null}</footer> : null}
      </div>
    </div>
  );
}
