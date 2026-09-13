'use client';

import type { CenterPrintBranding } from '@/lib/printing';

/** معاينة ورقية حية لهوية السنتر قبل حفظها، بلا إرسال أي ملف أو إعداد. */
export function PrintIdentityPreview({ branding, compact = false }: { branding: CenterPrintBranding; compact?: boolean }) {
  const watermarkText = branding.watermark_text.trim() || branding.center_name;
  return (
    <div className={`print-identity-preview ${compact ? 'compact' : ''}`} dir="rtl">
      <div className="print-preview-sheet">
        {branding.watermark_enabled ? <div className={`print-preview-watermark ${branding.watermark_direction}`} style={{ opacity: branding.watermark_opacity }}>
          {branding.watermark_image ? <img src={branding.watermark_image} alt="صورة العلامة المائية" /> : null}
          {watermarkText ? <span>{watermarkText}</span> : null}
        </div> : null}
        {branding.logo_url ? <img className={`print-preview-logo ${branding.logo_position}`} style={{ width: branding.logo_size }} src={branding.logo_url} alt="شعار السنتر" /> : null}
        <div className="print-preview-content">
          <header><small>{branding.center_name}</small><h3>نموذج مستند رسمي</h3><p>معاينة مباشرة للشعار والعلامة المائية والتذييل.</p></header>
          <div className="print-preview-lines"><i /><i /><i /><i /></div>
          <table><thead><tr><th>البند</th><th>البيان</th><th>القيمة</th></tr></thead><tbody><tr><td>١</td><td>نموذج بيانات للطباعة</td><td>—</td></tr><tr><td>٢</td><td>يظهر الشعار في الموضع المحدد</td><td>—</td></tr></tbody></table>
        </div>
        <footer><span>{branding.center_name}</span>{branding.footer_address ? <span>{branding.footer_address}</span> : <span>عنوان السنتر يظهر هنا عند إدخاله</span>}</footer>
      </div>
    </div>
  );
}
