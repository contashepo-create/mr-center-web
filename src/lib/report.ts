import { brandForCenter, type CenterPrintBranding } from './printing';
import { fetchCenterPrintBranding } from './api';

export interface ReportSection {
  title: string;
  rows: string[][];
  headers?: string[];
}

type ReportOperator = { name?: string; printedAt?: string; center?: string; branding?: CenterPrintBranding };

function esc(value: unknown): string {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** طبقات الهوية الثابتة تتكرر على كل صفحة PDF/طباعة: شعار، علامة مائية وتذييل. */
export function documentBrandingMarkup(branding: CenterPrintBranding): string {
  const watermark = branding.watermark_enabled ? `
    <div class="center-print-watermark ${esc(branding.watermark_direction)}" style="opacity:${branding.watermark_opacity}">
      ${branding.watermark_image ? `<img src="${esc(branding.watermark_image)}" alt="" />` : ''}
      <span>${esc(branding.watermark_text.trim() || branding.center_name)}</span>
    </div>` : '';
  const logo = branding.logo_url ? `<img class="center-print-logo ${esc(branding.logo_position)}" style="width:${branding.logo_size}px" src="${esc(branding.logo_url)}" alt="شعار ${esc(branding.center_name)}" />` : '';
  const footer = [branding.center_name, branding.footer_address.trim()].filter(Boolean).map(esc).join('  —  ');
  return `<aside class="center-print-overlay" aria-hidden="true">${watermark}${logo}<div class="center-print-footer">${footer}</div></aside>`;
}

/** CSS مشترك لكل مستند يولد في نافذة الطباعة. */
export function documentBrandingCss(): string {
  return `
    .center-print-overlay{position:fixed;inset:0;z-index:0;pointer-events:none;color:#173c31;font-family:"Tahoma","Arial",sans-serif}
    .center-print-watermark{position:absolute;inset:12mm;display:flex;align-items:center;justify-content:center;gap:18px;overflow:hidden;font-weight:900;color:#134e3b;text-align:center}
    .center-print-watermark span{font-size:clamp(34px,8vw,82px);line-height:1.1;white-space:nowrap;max-width:95%;overflow:hidden;text-overflow:ellipsis}
    .center-print-watermark img{width:min(45vw,360px);max-height:55vh;object-fit:contain}.center-print-watermark.diagonal{transform:rotate(-35deg)}.center-print-watermark.vertical{transform:rotate(-90deg)}.center-print-watermark.horizontal{transform:none}
    .center-print-logo{position:fixed;z-index:4;height:auto;max-height:24mm;object-fit:contain}.center-print-logo.top_right{top:5mm;right:11mm}.center-print-logo.top_left{top:5mm;left:11mm}.center-print-logo.top_center{top:5mm;left:50%;transform:translateX(-50%)}.center-print-logo.bottom_right{bottom:5mm;right:11mm}.center-print-logo.bottom_left{bottom:5mm;left:11mm}
    .center-print-footer{position:fixed;z-index:4;right:11mm;left:11mm;bottom:4.5mm;overflow:hidden;color:#52695e;font-size:8.5px;line-height:1.2;text-align:center;white-space:nowrap;text-overflow:ellipsis}
    @media print{.center-print-overlay,.center-print-logo,.center-print-footer{position:fixed!important}.center-print-watermark{display:flex!important}}
  `;
}

/** قالب A4 موحد، مناسب للمالي والرواتب وكشوف الموظفين وتقارير الطلاب والإدارة. */
export function buildReportHtml(title: string, subtitle: string, sections: ReportSection[], operator?: ReportOperator): string {
  const branding = operator?.branding ?? brandForCenter(operator?.center);
  const printedAt = operator?.printedAt || new Date().toLocaleString('ar-EG', { dateStyle: 'medium', timeStyle: 'short' });
  const body = sections.map((section, index) => {
    const headers = section.headers ?? [];
    const tableHead = headers.length ? `<thead><tr>${headers.map((header) => `<th>${esc(header)}</th>`).join('')}</tr></thead>` : '';
    const tableRows = section.rows.length ? section.rows.map((row) => `<tr>${row.map((cell) => `<td>${esc(cell)}</td>`).join('')}</tr>`).join('') : `<tr><td colspan="${Math.max(headers.length, 1)}" class="empty">لا توجد بيانات ضمن هذه الفترة</td></tr>`;
    return `<section class="report-section"><div class="section-title"><span class="section-number">${String(index + 1).padStart(2, '0')}</span><h2>${esc(section.title)}</h2></div><div class="table-wrap"><table>${tableHead}<tbody>${tableRows}</tbody></table></div></section>`;
  }).join('');
  return `<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${esc(title)}</title><style>
    @page{size:A4;margin:13mm 11mm 19mm}*{box-sizing:border-box}html{background:#eef4f1}body{margin:0;background:#fff;color:#16231f;font-family:"Tahoma","Arial",sans-serif;direction:rtl;font-size:12px;line-height:1.65;-webkit-print-color-adjust:exact;print-color-adjust:exact}
    ${documentBrandingCss()}
    .report-shell{position:relative;z-index:1;max-width:210mm;margin:0 auto;padding:0 0 14px}.report-head{position:relative;overflow:hidden;padding:24px 28px 21px;background:linear-gradient(135deg,#064e3b 0%,#08765a 58%,#0b9c73 100%);color:#fff;border-bottom:5px solid #d7a931}.report-head:after{content:"";position:absolute;width:155px;height:155px;border:1px solid rgba(255,255,255,.25);border-radius:50%;left:-45px;top:-75px;box-shadow:0 0 0 24px rgba(255,255,255,.07),0 0 0 49px rgba(255,255,255,.05)}
    .brand{position:relative;z-index:1;display:flex;align-items:flex-start;justify-content:space-between;gap:16px}.brand-mark{display:flex;align-items:center;gap:10px;font-weight:700;font-size:13px;letter-spacing:.1px}.mark{display:inline-grid;place-items:center;width:31px;height:31px;border:1px solid rgba(255,255,255,.65);border-radius:10px;color:#f9d66a;font-size:17px}.report-type{margin:20px 0 2px;font-size:25px;line-height:1.3;font-weight:800}.report-subtitle{opacity:.88;font-size:12px}.report-code{position:relative;z-index:1;text-align:left;font-size:10px;opacity:.9;white-space:nowrap}
    .metadata{display:flex;flex-wrap:wrap;gap:8px;padding:13px 20px;background:#f4faf7;border-bottom:1px solid #dbe9e1;color:#426157;font-size:10.5px}.metadata span{border:1px solid #d6e7dd;border-radius:999px;background:#fff;padding:4px 10px}.metadata b{color:#17634c}
    main{padding:4px 20px}.report-section{margin-top:18px;break-inside:avoid}.section-title{display:flex;align-items:center;gap:8px;margin:0 0 8px;border-bottom:1px solid #d6e6dd;padding-bottom:6px}.section-title h2{margin:0;font-size:14px;color:#07563f}.section-number{display:inline-grid;place-items:center;width:25px;height:25px;border-radius:7px;background:#e0f0e8;color:#087254;font-size:9px;font-weight:bold;direction:ltr}
    .table-wrap{overflow:hidden;border:1px solid #d5e2db;border-radius:8px}table{width:100%;border-collapse:collapse;font-size:11px}thead{background:#e8f5ee;color:#07563f}th{font-size:10.5px;font-weight:800;white-space:nowrap}th,td{padding:8px 9px;text-align:right;vertical-align:top;border-left:1px solid #e0ebe5;border-bottom:1px solid #e0ebe5}th:last-child,td:last-child{border-left:0}tbody tr:last-child td{border-bottom:0}tbody tr:nth-child(even){background:#f9fcfa}td{color:#2e443a}.empty{text-align:center;color:#6c8276;padding:16px}.report-foot{display:flex;justify-content:space-between;gap:22px;margin:24px 20px 0;padding-top:12px;border-top:1px dashed #b6cfc2;color:#5d7368;font-size:10px}.signature{min-width:155px;border-top:1px solid #8ca89a;padding-top:5px;text-align:center;margin-top:26px}.page-note{text-align:left;align-self:flex-end}
    @media print{html{background:#fff}.report-shell{max-width:none}.report-head{border-bottom-width:4px}main{padding:2px 0}.metadata{padding-right:0;padding-left:0}.report-foot{margin-right:0;margin-left:0}.report-section{break-inside:avoid}.table-wrap{overflow:visible}thead{display:table-header-group}}
  </style></head><body>${documentBrandingMarkup(branding)}<div class="report-shell">
    <header class="report-head"><div class="brand"><div class="brand-mark"><span class="mark">✦</span><span>${esc(branding.center_name)}</span></div><div class="report-code">وثيقة مالية / تعليمية معتمدة</div></div><h1 class="report-type">${esc(title)}</h1><div class="report-subtitle">${esc(subtitle)}</div></header>
    <div class="metadata"><span><b>أعده:</b> ${esc(operator?.name || 'غير محدد')}</span><span><b>تاريخ الطباعة:</b> ${esc(printedAt)}</span><span><b>حالة الوثيقة:</b> للمتابعة والمراجعة</span></div>
    <main>${body}</main><footer class="report-foot"><div class="signature">توقيع المسؤول</div><div class="signature">اعتماد الإدارة</div><div class="page-note">${esc(branding.center_name)} · صادر من نظام MR Center</div></footer>
  </div></body></html>`;
}

export function buildPayrollReportHtml(employee: { name: string; role?: string }, period: string, values: { base: number; bonus: number; advances: number; deductions: number; net: number }, operator?: ReportOperator): string {
  return buildReportHtml(`كشف صرف راتب — ${employee.name}`, period, [{
    title: 'تفاصيل الاستحقاق والصرف',
    headers: ['البند', 'القيمة'],
    rows: [
      ['الدور', employee.role ?? '—'], ['الراتب الأساسي', `${values.base.toFixed(2)} جنيه`], ['المكافآت والعمولات', `${values.bonus.toFixed(2)} جنيه`],
      ['سلف معتمدة للخصم', `${values.advances.toFixed(2)} جنيه`], ['خصومات معالجة', `${values.deductions.toFixed(2)} جنيه`], ['صافي النقد المصروف', `${values.net.toFixed(2)} جنيه`],
    ],
  }], operator);
}

export function buildCustodyReportHtml(title: string, period: string, rows: string[][], operator?: ReportOperator): string {
  return buildReportHtml(title, period, [{ title: 'التحصيل والتسليم والمطابقة', headers: ['التاريخ', 'الموظف', 'التحصيل المتوقع', 'المسلّم للخزينة', 'النتيجة', 'ملاحظات'], rows }], operator);
}

/** يجلب الهوية الحالية قبل الطباعة، فلا تحتاج كل صفحة لإعادة تنفيذ الاستعلام نفسه. */
export async function printCenterReport(centerId: string | null | undefined, createHtml: (branding: CenterPrintBranding) => string): Promise<void> {
  let branding = brandForCenter('MR Center');
  if (centerId) {
    try { branding = await fetchCenterPrintBranding(centerId); } catch { /* مستند صالح حتى مع فشل اتصال الإعدادات */ }
  }
  printReport(createHtml(branding));
}

/** يطبع ورقة الاختبار فقط، مع طبقات الهوية المتكررة على صفحاتها. */
export function printExamPaper(branding: CenterPrintBranding = brandForCenter('MR Center')): void {
  const paper = document.querySelector('.exam-paper');
  if (!paper) throw new Error('افتح معاينة الورقة أولاً ثم اختر الطباعة.');
  const styles = Array.from(document.querySelectorAll('style, link[rel="stylesheet"]')).map((node) => node.outerHTML).join('\n');
  printReport(`<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8" /><title>ورقة اختبار</title>${styles}<style>
    @page{size:A4;margin:10mm 10mm 17mm}html,body{background:#fff!important}body{padding:0!important}${documentBrandingCss()}.print-exam-wrap{position:relative;z-index:1;width:100%;margin:0 auto}.exam-paper{width:100%;max-width:none!important;box-shadow:none!important}@media print{.exam-paper{break-inside:auto}.exam-paper-section,.exam-paper-item{break-inside:avoid}.exam-paper .paper-preview-branding{display:none!important}body:has(.exam-paper) .center-print-overlay,body:has(.exam-paper) .center-print-overlay *{visibility:visible!important}}
  </style></head><body>${documentBrandingMarkup(branding)}<main class="print-exam-wrap">${paper.outerHTML}</main></body></html>`);
}

export async function printCenterExamPaper(centerId: string | null | undefined): Promise<void> {
  let branding = brandForCenter('MR Center');
  if (centerId) {
    try { branding = await fetchCenterPrintBranding(centerId); } catch { /* الطباعة تظل متاحة بالقالب الافتراضي */ }
  }
  printExamPaper(branding);
}

export function printReport(html: string): void {
  document.getElementById('print-frame')?.remove();
  const frame = document.createElement('iframe');
  frame.id = 'print-frame';
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = 'position:fixed;left:-10000px;bottom:0;width:1px;height:1px;border:0;opacity:0;pointer-events:none;';
  document.body.appendChild(frame);
  const doc = frame.contentDocument ?? frame.contentWindow?.document;
  if (!doc) {
    const popup = window.open('', '_blank');
    if (!popup) throw new Error('تعذر فتح نافذة الطباعة. اسمح بالنوافذ المنبثقة لهذا الموقع.');
    popup.document.open(); popup.document.write(html); popup.document.close();
    return;
  }
  doc.open(); doc.write(html); doc.close();
  const cleanup = () => window.setTimeout(() => frame.remove(), 1500);
  try { frame.contentWindow?.addEventListener('afterprint', cleanup, { once: true }); } catch { /* لا حاجة لإجراء إضافي */ }
  window.setTimeout(() => { try { frame.contentWindow?.focus(); frame.contentWindow?.print(); } catch { cleanup(); } }, 400);
}
