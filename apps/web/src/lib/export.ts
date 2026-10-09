import Papa from 'papaparse';
import { strToU8, zipSync } from 'fflate';

export interface ExportColumn {
  key: string;
  header: string;
  /** Numbers are written as numbers in XLSX and right-aligned in PDF. */
  numeric?: boolean;
}

export type ExportRow = Record<string, string | number | boolean | null | undefined>;

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function toCsv(columns: ExportColumn[], rows: ExportRow[]): string {
  return Papa.unparse({
    fields: columns.map((c) => c.header),
    data: rows.map((r) => columns.map((c) => r[c.key] ?? '')),
  });
}

export function exportCsv(filename: string, columns: ExportColumn[], rows: ExportRow[]): void {
  // BOM so Excel opens UTF-8 (₹, Indic scripts) correctly.
  downloadBlob(new Blob(['﻿' + toCsv(columns, rows)], { type: 'text/csv;charset=utf-8' }), `${filename}.csv`);
}

export function exportJson(filename: string, data: unknown): void {
  downloadBlob(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), `${filename}.json`);
}

const xmlEscape = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');

function columnName(index: number): string {
  let name = '';
  let n = index + 1;
  while (n > 0) {
    const rem = (n - 1) % 26;
    name = String.fromCharCode(65 + rem) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
}

/** Minimal Office Open XML workbook (one sheet, bold header row, numeric cells). */
export function toXlsx(sheetName: string, columns: ExportColumn[], rows: ExportRow[]): Uint8Array {
  const cell = (ref: string, value: unknown, numeric: boolean, style = 0) => {
    if (value === null || value === undefined || value === '') return `<c r="${ref}"${style ? ` s="${style}"` : ''}/>`;
    if (numeric && typeof value === 'number' && Number.isFinite(value)) return `<c r="${ref}"${style ? ` s="${style}"` : ''}><v>${value}</v></c>`;
    return `<c r="${ref}" t="inlineStr"${style ? ` s="${style}"` : ''}><is><t xml:space="preserve">${xmlEscape(String(value))}</t></is></c>`;
  };
  const header = `<row r="1">${columns.map((c, i) => cell(`${columnName(i)}1`, c.header, false, 1)).join('')}</row>`;
  const body = rows
    .map((row, r) => `<row r="${r + 2}">${columns.map((c, i) => cell(`${columnName(i)}${r + 2}`, row[c.key], !!c.numeric)).join('')}</row>`)
    .join('');
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetData>${header}${body}</sheetData></worksheet>`;
  const safeName = xmlEscape(sheetName.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || 'Sheet1');
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>',
    ),
    '_rels/.rels': strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    ),
    'xl/workbook.xml': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${safeName}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    ),
    'xl/_rels/workbook.xml.rels': strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
    ),
    'xl/styles.xml': strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs></styleSheet>',
    ),
    'xl/worksheets/sheet1.xml': strToU8(sheet),
  };
  return zipSync(files);
}

export function exportXlsx(filename: string, sheetName: string, columns: ExportColumn[], rows: ExportRow[]): void {
  const data = toXlsx(sheetName, columns, rows);
  downloadBlob(new Blob([data as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `${filename}.xlsx`);
}

/** PDF table export (jsPDF is loaded only when needed). */
export async function exportPdf(filename: string, title: string, columns: ExportColumn[], rows: ExportRow[], subtitle?: string): Promise<void> {
  const [{ jsPDF }, { autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
  const doc = new jsPDF({ orientation: columns.length > 6 ? 'landscape' : 'portrait', unit: 'pt' });
  doc.setFontSize(14);
  doc.text(title, 40, 40);
  if (subtitle) {
    doc.setFontSize(9);
    doc.setTextColor(110);
    doc.text(subtitle, 40, 56);
  }
  autoTable(doc, {
    startY: subtitle ? 68 : 56,
    head: [columns.map((c) => c.header)],
    body: rows.map((r) => columns.map((c) => {
      const v = r[c.key];
      // jsPDF core fonts cannot render ₹; use "Rs." in PDFs.
      return v === null || v === undefined ? '' : String(v).replace(/₹/g, 'Rs.');
    })),
    styles: { fontSize: 8, cellPadding: 4 },
    headStyles: { fillColor: [79, 70, 229] },
    columnStyles: Object.fromEntries(columns.map((c, i) => [i, { halign: c.numeric ? 'right' : 'left' }])),
  });
  doc.save(`${filename}.pdf`);
}
