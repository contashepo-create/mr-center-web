import { brandForCenter, documentFooterText, watermarkDisplayText, watermarkGridColumns, watermarkRepeatCount, type CenterPrintBranding } from './printing';
import { fetchCenterPrintBranding } from './api';

export interface ReportSection {
  title: string;
  rows: string[][];
  headers?: string[];
}

type ReportOperator = { name?: string; printedAt?: string; center?: string; branding?: CenterPrintBranding };
export type ExamPdfDetails = { title?: string; grade?: string; subject?: string; teacher?: string | string[]; author?: string };

/**
 * لا يستطيع المتصفح كتابة ملف PDF مباشرةً من نافذة الطباعة، لكنه يعتمد عنوان
 * المستند كاسم مقترح في "حفظ بصيغة PDF". نوحّد الاسم ونزيل محارف الملفات
 * المحجوزة حتى يصلح الاسم على Windows وmacOS وLinux.
 */
export function pdfDocumentTitle(...parts: Array<string | null | undefined>): string {
  const title = parts
    .map((part) => String(part ?? '').replace(/[\\/:*?"<>|؟]+/g, ' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join(' - ')
    .slice(0, 170)
    .trim();
  return title || 'مستند MR Center';
}

function examPdfDocumentTitle(details: ExamPdfDetails = {}, paper?: Element): string {
  const paperTitle = paper?.querySelector('.exam-paper-title')?.textContent?.trim();
  const paperSubject = paper?.querySelector('.exam-paper-sub')?.textContent?.match(/المادة\s*:\s*([^·\n]+)/)?.[1]?.trim();
  const teachers = (Array.isArray(details.teacher) ? details.teacher : [details.teacher]).filter((teacher): teacher is string => Boolean(teacher?.trim()));
  const educator = teachers.length ? `المدرس ${teachers.join(' و ')}` : details.author?.trim() ? `إعداد ${details.author.trim()}` : '';
  return pdfDocumentTitle('اختبار', details.grade, details.subject || paperSubject, educator, details.title || paperTitle);
}

function esc(value: unknown): string {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** ضغط طباعي متزن للتقارير القصيرة: يقلص المسافات لا المحتوى أو مقياسه. */
function reportFitClass(sections: ReportSection[]): 'report-fit-compact' | 'report-fit-standard' {
  const rows = sections.reduce((total, section) => total + Math.max(1, section.rows.length), 0);
  const cells = sections.reduce((total, section) => total + section.rows.reduce((sum, row) => sum + row.length, 0), 0);
  return rows <= 18 && cells <= 90 ? 'report-fit-compact' : 'report-fit-standard';
}

function reportLogoClass(branding: CenterPrintBranding): string {
  return branding.logo_url ? `has-print-logo ${branding.logo_position}` : '';
}

function reportLogoSpace(branding: CenterPrintBranding): number {
  // مساحة آمنة إلى جانب النص، أكبر قليلاً من مقاس الشعار المختار.
  return branding.logo_url ? Math.max(56, Math.min(132, branding.logo_size + 22)) : 0;
}

function printBottomMarginMm(branding: CenterPrintBranding, minimum: number): number {
  if (!branding.logo_url || !['bottom_right', 'bottom_left'].includes(branding.logo_position)) return minimum;
  // أقصى ارتفاع الشعار في CSS هو 24mm. الحجز يتبع المقاس المختار ويترك فاصلًا للتذييل.
  const estimatedLogoHeight = Math.min(24, Math.max(6, branding.logo_size / 3.78));
  return Math.max(minimum, Math.ceil(5 + estimatedLogoHeight + 5));
}

/** حجز رأس الورقة حتى لو تغيرت هوية الطباعة بعد فتح المعاينة. */
function examPaperLogoReservationCss(branding: CenterPrintBranding): string {
  if (!branding.logo_url) return '';
  const space = Math.max(76, Math.min(156, branding.logo_size + 24));
  if (branding.logo_position === 'top_right') return `.print-exam-wrap .exam-paper-head{padding-right:${space}px}`;
  if (branding.logo_position === 'top_left') return `.print-exam-wrap .exam-paper-head{padding-left:${space}px}`;
  if (branding.logo_position === 'top_center') return `.print-exam-wrap .exam-paper-head{padding-top:${Math.round(space * .62)}px}`;
  return '';
}

/** طبقات الهوية الثابتة تتكرر على كل صفحة PDF/طباعة: شعار، علامة مائية وتذييل. */
export function documentBrandingMarkup(branding: CenterPrintBranding): string {
  const watermarkCount = watermarkRepeatCount(branding);
  const watermarkMarks = Array.from({ length: watermarkCount }, () => `<div class="print-watermark-mark">${branding.watermark_image ? `<img src="${esc(branding.watermark_image)}" alt="" />` : ''}<span>${esc(watermarkDisplayText(branding))}</span></div>`).join('');
  const watermark = branding.watermark_enabled ? `
    <div class="center-print-watermark ${esc(branding.watermark_direction)} ${esc(branding.watermark_pattern)} ${esc(branding.watermark_layer)}"
      style="opacity:${branding.watermark_opacity};--watermark-font-size:${branding.watermark_font_size}px;--watermark-image-size:${branding.watermark_image_size}px;--watermark-color:${esc(branding.watermark_color)};--watermark-columns:${watermarkGridColumns(branding)}">
      <div class="print-watermark-grid">${watermarkMarks}</div>
    </div>` : '';
  const logo = branding.logo_url ? `<img class="center-print-logo ${esc(branding.logo_position)}" style="width:${branding.logo_size}px" src="${esc(branding.logo_url)}" alt="شعار ${esc(branding.center_name)}" />` : '';
  const footer = esc(documentFooterText(branding));
  // العلامة عنصر ثابت مستقل عن الشعار والتذييل: بذلك يمكن أن تكون فوق محتوى
  // المستند فعلاً (أو خلفه عند اختيار ذلك) من دون أن يحبسها سياق تراكب الأب.
  const logoSpace = reportLogoSpace(branding);
  return `${watermark}<aside class="center-print-overlay logo-${esc(branding.logo_position)}" style="--print-logo-space:${logoSpace}px" aria-hidden="true">${logo}${footer ? `<div class="center-print-footer" style="font-size:${branding.footer_font_size}px">${footer}</div>` : ''}</aside>`;
}

/** CSS مشترك لكل مستند يولد في نافذة الطباعة. */
export function documentBrandingCss(): string {
  return `
    .center-print-overlay{pointer-events:none;color:#173c31;font-family:"Tahoma","Arial",sans-serif}
    .center-print-watermark{position:fixed;inset:8mm;overflow:hidden;pointer-events:none}.center-print-watermark.front{z-index:3}.center-print-watermark.behind{z-index:0}
    .print-watermark-grid{display:grid;width:100%;height:100%;grid-template-columns:repeat(var(--watermark-columns,1),minmax(0,1fr));grid-auto-rows:1fr;align-items:center;justify-items:center;gap:2mm}.single .print-watermark-grid{grid-template-columns:1fr;grid-template-rows:1fr}.print-watermark-mark{display:flex;align-items:center;justify-content:center;gap:8px;max-width:100%;color:var(--watermark-color,#14513e);font-weight:900;text-align:center;line-height:1.05;white-space:nowrap;transform:rotate(0deg)}.print-watermark-mark span{display:block;max-width:100%;overflow:hidden;font-size:var(--watermark-font-size,76px);text-overflow:ellipsis}.print-watermark-mark img{width:var(--watermark-image-size,150px);max-width:38vw;max-height:26vh;object-fit:contain}.diagonal .print-watermark-mark{transform:rotate(-35deg)}.vertical .print-watermark-mark{transform:rotate(-90deg)}.staggered .print-watermark-mark:nth-child(even){transform:translateY(25%) rotate(var(--watermark-rotation,0deg))}.staggered.diagonal .print-watermark-mark:nth-child(even){--watermark-rotation:-35deg}.staggered.vertical .print-watermark-mark:nth-child(even){--watermark-rotation:-90deg}
    .center-print-logo{position:fixed;z-index:5;height:auto;max-height:24mm;object-fit:contain}.center-print-logo.top_right{top:5mm;right:11mm}.center-print-logo.top_left{top:5mm;left:11mm}.center-print-logo.top_center{top:5mm;left:50%;transform:translateX(-50%)}.center-print-logo.bottom_right{bottom:5mm;right:11mm}.center-print-logo.bottom_left{bottom:5mm;left:11mm}
    .center-print-footer{position:fixed;z-index:5;right:11mm;left:11mm;bottom:4.5mm;overflow:hidden;color:#52695e;line-height:1.2;text-align:center;white-space:nowrap;text-overflow:ellipsis}.center-print-overlay.logo-bottom_right .center-print-footer{right:calc(11mm + var(--print-logo-space,56px))}.center-print-overlay.logo-bottom_left .center-print-footer{left:calc(11mm + var(--print-logo-space,56px))}
    @media print{.center-print-logo,.center-print-footer,.center-print-watermark{position:fixed!important}.center-print-watermark{display:block!important}}
  `;
}

/** قالب A4 موحد، مناسب للمالي والرواتب وكشوف الموظفين وتقارير الطلاب والإدارة. */
export function buildReportHtml(title: string, subtitle: string, sections: ReportSection[], operator?: ReportOperator): string {
  const branding = operator?.branding ?? brandForCenter(operator?.center);
  const printedAt = operator?.printedAt || new Date().toLocaleString('ar-EG', { dateStyle: 'medium', timeStyle: 'short' });
  const fitClass = reportFitClass(sections);
  const logoClass = reportLogoClass(branding);
  const logoSpace = reportLogoSpace(branding);
  const bottomMargin = printBottomMarginMm(branding, 19);
  const body = sections.map((section, index) => {
    const headers = section.headers ?? [];
    const tableHead = headers.length ? `<thead><tr>${headers.map((header) => `<th>${esc(header)}</th>`).join('')}</tr></thead>` : '';
    const tableRows = section.rows.length ? section.rows.map((row) => `<tr>${row.map((cell) => `<td>${esc(cell)}</td>`).join('')}</tr>`).join('') : `<tr><td colspan="${Math.max(headers.length, 1)}" class="empty">لا توجد بيانات ضمن هذه الفترة</td></tr>`;
    return `<section class="report-section"><div class="section-title"><span class="section-number">${String(index + 1).padStart(2, '0')}</span><h2>${esc(section.title)}</h2></div><div class="table-wrap"><table>${tableHead}<tbody>${tableRows}</tbody></table></div></section>`;
  }).join('');
  return `<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${esc(pdfDocumentTitle(title))}</title><style>
    @page{size:A4;margin:13mm 11mm ${bottomMargin}mm}*{box-sizing:border-box}html{background:#eef4f1}body{margin:0;background:#fff;color:#16231f;font-family:"Tahoma","Arial",sans-serif;direction:rtl;font-size:12px;line-height:1.65;-webkit-print-color-adjust:exact;print-color-adjust:exact}
    ${documentBrandingCss()}
    .report-shell{position:relative;z-index:1;max-width:210mm;margin:0 auto;padding:0 0 14px;--report-logo-space:0px}.report-head{position:relative;overflow:hidden;padding:19px 24px 16px;background:linear-gradient(135deg,#064e3b 0%,#08765a 58%,#0b9c73 100%);color:#fff;border-bottom:5px solid #d7a931}.report-head:after{content:"";position:absolute;width:155px;height:155px;border:1px solid rgba(255,255,255,.25);border-radius:50%;left:-45px;top:-75px;box-shadow:0 0 0 24px rgba(255,255,255,.07),0 0 0 49px rgba(255,255,255,.05)}.report-shell.has-print-logo.top_right .report-head{padding-right:calc(24px + var(--report-logo-space))}.report-shell.has-print-logo.top_left .report-head{padding-left:calc(24px + var(--report-logo-space))}.report-shell.has-print-logo.top_center .report-head{padding-top:calc(16px + var(--report-logo-space))}body:has(.report-shell.has-print-logo) .center-print-logo.top_right,body:has(.report-shell.has-print-logo) .center-print-logo.top_left,body:has(.report-shell.has-print-logo) .center-print-logo.top_center{top:15mm}
    .brand{position:relative;z-index:1;display:flex;align-items:flex-start;justify-content:space-between;gap:16px}.brand-mark{display:flex;align-items:center;gap:10px;font-weight:700;font-size:13px;letter-spacing:.1px}.mark{display:inline-grid;place-items:center;width:31px;height:31px;border:1px solid rgba(255,255,255,.65);border-radius:10px;color:#f9d66a;font-size:17px}.report-type{margin:14px 0 2px;font-size:22px;line-height:1.3;font-weight:800}.report-subtitle{opacity:.88;font-size:12px}.report-code{position:relative;z-index:1;text-align:left;font-size:10px;opacity:.9;white-space:nowrap}
    .metadata{display:flex;flex-wrap:wrap;gap:7px;padding:10px 16px;background:#f4faf7;border-bottom:1px solid #dbe9e1;color:#426157;font-size:10px}.metadata span{border:1px solid #d6e7dd;border-radius:999px;background:#fff;padding:3px 8px}.metadata b{color:#17634c}
    main{padding:2px 16px}.report-section{margin-top:12px;break-inside:avoid}.section-title{display:flex;align-items:center;gap:7px;margin:0 0 6px;border-bottom:1px solid #d6e6dd;padding-bottom:5px}.section-title h2{margin:0;font-size:13px;color:#07563f}.section-number{display:inline-grid;place-items:center;width:23px;height:23px;border-radius:7px;background:#e0f0e8;color:#087254;font-size:9px;font-weight:bold;direction:ltr}
    .table-wrap{overflow:hidden;border:1px solid #d5e2db;border-radius:8px}table{width:100%;border-collapse:collapse;font-size:10.2px}thead{background:#e8f5ee;color:#07563f}th{font-size:9.8px;font-weight:800;white-space:nowrap}th,td{padding:6px 7px;text-align:right;vertical-align:top;border-left:1px solid #e0ebe5;border-bottom:1px solid #e0ebe5}th:last-child,td:last-child{border-left:0}tbody tr:last-child td{border-bottom:0}tbody tr:nth-child(even){background:#f9fcfa}td{color:#2e443a}.empty{text-align:center;color:#6c8276;padding:16px}.report-foot{display:flex;justify-content:space-between;gap:18px;margin:18px 16px 0;padding-top:9px;border-top:1px dashed #b6cfc2;color:#5d7368;font-size:9.5px}.signature{min-width:135px;border-top:1px solid #8ca89a;padding-top:5px;text-align:center;margin-top:20px}.page-note{text-align:left;align-self:flex-end}
    /* التقرير القصير يستفيد من ضغط الهوامش والخلايا فقط؛ لا يوجد transform أو تصغير للنص يسبب تشويهاً. */.report-shell.report-fit-compact{font-size:10.5px;line-height:1.42}.report-fit-compact .report-head{padding:15px 21px 13px}.report-fit-compact .report-type{margin:10px 0 1px;font-size:20px}.report-fit-compact .metadata{gap:5px;padding:7px 13px;font-size:9.5px}.report-fit-compact .metadata span{padding:3px 7px}.report-fit-compact main{padding:0 13px}.report-fit-compact .report-section{margin-top:9px}.report-fit-compact .section-title{margin-bottom:5px;padding-bottom:4px}.report-fit-compact .section-title h2{font-size:12px}.report-fit-compact .section-number{width:21px;height:21px}.report-fit-compact table{font-size:9.5px}.report-fit-compact th{font-size:9px}.report-fit-compact th,.report-fit-compact td{padding:4px 6px}.report-fit-compact .report-foot{margin:12px 13px 0;padding-top:7px;font-size:8.5px}.report-fit-compact .signature{min-width:110px;margin-top:14px}
    @media print{html{background:#fff}.report-shell{max-width:none}.report-head{border-bottom-width:4px}main{padding:2px 0}.metadata{padding-right:0;padding-left:0}.report-foot{margin-right:0;margin-left:0}.report-section{break-inside:avoid}.table-wrap{overflow:visible}thead{display:table-header-group}}
  </style></head><body>${documentBrandingMarkup(branding)}<div class="report-shell ${fitClass} ${logoClass}" style="--report-logo-space:${logoSpace}px">
    <header class="report-head"><div class="brand"><div class="brand-mark"><span class="mark">✦</span>${branding.header_show_center_name ? `<span>${esc(branding.center_name)}</span>` : ''}</div><div class="report-code">وثيقة مالية / تعليمية معتمدة</div></div><h1 class="report-type">${esc(title)}</h1><div class="report-subtitle">${esc(subtitle)}</div></header>
    <div class="metadata"><span><b>أعده:</b> ${esc(operator?.name || 'غير محدد')}</span><span><b>تاريخ الطباعة:</b> ${esc(printedAt)}</span><span><b>حالة الوثيقة:</b> للمتابعة والمراجعة</span></div>
    <main>${body}</main><footer class="report-foot"><div class="signature">توقيع المسؤول</div><div class="signature">اعتماد الإدارة</div><div class="page-note">${branding.header_show_center_name ? `${esc(branding.center_name)} · ` : ''}صادر من نظام MR Center</div></footer>
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
  return buildReportHtml(title, period, [{ title: 'التحصيل والتسليم والمطابقة', headers: ['التاريخ', 'الموظف', 'التحصيل المتوقع', 'المسلّم للخزينة', 'النتيجة', 'تسوية العجز', 'ملاحظات'], rows }], operator);
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
export function printExamPaper(branding: CenterPrintBranding = brandForCenter('MR Center'), details: ExamPdfDetails = {}): void {
  const paper = document.querySelector('.exam-paper');
  if (!paper) throw new Error('افتح معاينة الورقة أولاً ثم اختر الطباعة.');
  // عند وضع الأختام اليدوية تكون الأختام التفاعلية أشقاء للورقة داخل stamp-canvas؛
  // نأخذ الحاوية كاملة كي تظهر الأختام نفسها في PDF.
  const printable = paper.closest('.stamp-canvas') ?? paper;
  const styles = Array.from(document.querySelectorAll('style, link[rel="stylesheet"]')).map((node) => node.outerHTML).join('\n');
  const bottomMargin = printBottomMarginMm(branding, 17);
  const logoReservation = examPaperLogoReservationCss(branding);
  printReport(`<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8" /><title>${esc(examPdfDocumentTitle(details, paper))}</title>${styles}<style>
    @page{size:A4;margin:10mm 10mm ${bottomMargin}mm}html,body{background:#fff!important}body{padding:0!important}${documentBrandingCss()}.print-exam-wrap{position:relative;z-index:1;width:100%;margin:0 auto}.exam-paper{width:100%;max-width:none!important;box-shadow:none!important}${logoReservation}@media print{.exam-paper{break-inside:auto}.exam-paper-section,.exam-paper-item{break-inside:avoid}.exam-paper .paper-preview-branding,.exam-paper .exam-paper-bottom-note{display:none!important}/* نثبت الورقة داخل إطار PDF في تدفق الصفحات الطبيعي حتى يظهر كامل محتوى الأسئلة. */body:has(.exam-paper) .print-exam-wrap{display:block!important;position:static!important;visibility:visible!important}body:has(.exam-paper) .print-exam-wrap .stamp-canvas{display:block!important;position:relative!important;height:auto!important;visibility:visible!important}body:has(.exam-paper) .print-exam-wrap .exam-paper{display:block!important;position:relative!important;inset:auto!important;height:auto!important;min-height:0!important;width:100%!important;max-width:none!important;margin:0!important;visibility:visible!important}/* يتغلب صراحةً على قاعدة المعاينة العامة التي تخفي أبناء body عند طباعة الاختبار. */body:has(.exam-paper) .print-exam-wrap *,body:has(.exam-paper) .exam-paper *,body:has(.exam-paper) .center-print-overlay,body:has(.exam-paper) .center-print-overlay *,body:has(.exam-paper) .center-print-watermark,body:has(.exam-paper) .center-print-watermark *{visibility:visible!important}}
  </style></head><body>${documentBrandingMarkup(branding)}<main class="print-exam-wrap">${printable.outerHTML}</main></body></html>`);
}

export async function printCenterExamPaper(centerId: string | null | undefined, details: ExamPdfDetails = {}): Promise<void> {
  let branding = brandForCenter('MR Center');
  if (centerId) {
    try { branding = await fetchCenterPrintBranding(centerId); } catch { /* الطباعة تظل متاحة بالقالب الافتراضي */ }
  }
  printExamPaper(branding, details);
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
