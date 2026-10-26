/** Browser print pages need real content spacing: @page padding is not widely supported. */
export const PRINT_PAGE_CSS = `
@page { size: A4; margin: 0; }
.print-page { width: 100%; max-width: 210mm; margin: 0 auto; border: 0; border-collapse: collapse; table-layout: fixed; }
.print-page > thead { display: table-header-group; }
.print-page > tfoot { display: table-footer-group; }
.print-page > thead, .print-page > tfoot { break-inside: avoid; }
.print-page > thead > tr > td, .print-page > tfoot > tr > td { height: 15mm; padding: 0; border: 0; font-size: 0; line-height: 0; }
.print-page > tbody > tr > td { padding: 0 20mm; border: 0; vertical-align: top; }
`;

/** Repeating table groups reserve top/bottom space on continuation pages as well. */
export function wrapPrintPage(content: string): string {
  return `<table class="print-page" role="presentation"><thead aria-hidden="true"><tr><td></td></tr></thead><tbody><tr><td>${content}</td></tr></tbody><tfoot aria-hidden="true"><tr><td></td></tr></tfoot></table>`;
}
