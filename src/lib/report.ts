export interface ReportSection {
  title: string;
  rows: string[][];
  headers?: string[];
}

function esc(s: unknown): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function buildReportHtml(title: string, subtitle: string, sections: ReportSection[], operator?: { name?: string; printedAt?: string; center?: string }): string {
  const body = sections.map((sec) => `
    <section>
      <h2>${esc(sec.title)}</h2>
      <table>
        ${sec.headers ? `<thead><tr>${sec.headers.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead>` : ''}
        <tbody>${sec.rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('') || '<tr><td>لا توجد بيانات</td></tr>'}</tbody>
      </table>
    </section>`).join('');
  return `<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8" />
  <title>${esc(title)}</title>
  <style>
    body{font-family:Tahoma,Arial,sans-serif;direction:rtl;padding:24px;color:#111;background:#fff}
    h1{font-size:24px;margin:0 0 4px}.sub{color:#555;font-size:13px;margin-bottom:14px}.meta{font-size:11px;color:#666;border-bottom:1px solid #ddd;padding-bottom:10px;margin-bottom:18px}
    h2{font-size:17px;color:#047857;margin:22px 0 8px}table{width:100%;border-collapse:collapse;font-size:13px;margin-bottom:14px}th,td{border:1px solid #ccc;padding:7px 9px;text-align:right;vertical-align:top}th{background:#ecfdf5}
    @media print{button{display:none}}
  </style></head><body>
    <h1>${esc(title)}</h1><div class="sub">${esc(subtitle)}</div>
    <div class="meta">${operator?.center ? `السنتر: ${esc(operator.center)} · ` : ''}نفذ التقرير: ${esc(operator?.name || 'غير محدد')} · وقت الطباعة: ${esc(operator?.printedAt || new Date().toLocaleString('ar-EG'))}</div>
    ${body}<script>window.onload=()=>setTimeout(()=>window.print(),300)</script>
  </body></html>`;
}

export function buildPayrollReportHtml(employee: { name: string; role?: string }, period: string, values: { base: number; bonus: number; advances: number; deductions: number; net: number }, operator?: { name?: string; center?: string }): string {
  return buildReportHtml(`كشف راتب — ${employee.name}`, period, [{
    title: 'تفاصيل الاستحقاق',
    headers: ['البند', 'القيمة'],
    rows: [
      ['الدور', employee.role ?? '—'],
      ['الراتب الأساسي', `${values.base.toFixed(2)} جنيه`],
      ['المكافآت والعمولات', `${values.bonus.toFixed(2)} جنيه`],
      ['السلف', `${values.advances.toFixed(2)} جنيه`],
      ['الخصومات', `${values.deductions.toFixed(2)} جنيه`],
      ['صافي المستحق', `${values.net.toFixed(2)} جنيه`],
    ],
  }], operator);
}

export function buildCustodyReportHtml(title: string, period: string, rows: string[][], operator?: { name?: string; center?: string }): string {
  return buildReportHtml(title, period, [{
    title: 'تسوية العهدة',
    headers: ['التاريخ', 'المتوقع', 'المسلم', 'الحالة'],
    rows,
  }], operator);
}

export function printReport(html: string): void {
  const w = window.open('', '_blank', 'noopener,noreferrer,width=1000,height=800');
  if (!w) throw new Error('تعذر فتح نافذة الطباعة. اسمح بالنوافذ المنبثقة لهذا الموقع.');
  w.document.open();
  w.document.write(html);
  w.document.close();
}
