import JsBarcode from 'jsbarcode';
import type { Formatter } from '../format';
import { printer } from './printer';

export interface LabelItem {
  name: string;
  code: string;
  price: number | null;
  mrp: number | null;
  copies: number;
}

export const LABEL_SIZES = {
  '38x25': { width: 38, height: 25, label: '38 × 25 mm (roll)' },
  '50x25': { width: 50, height: 25, label: '50 × 25 mm (roll)' },
  a4_65: { width: 38.1, height: 21.2, label: 'A4 sheet — 65 labels' },
} as const;
export type LabelSize = keyof typeof LABEL_SIZES;

const esc = (v: unknown) =>
  String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

function barcodeSvg(code: string): string {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  const format = /^\d{13}$/.test(code) ? 'EAN13' : /^\d{8}$/.test(code) ? 'EAN8' : 'CODE128';
  try {
    JsBarcode(svg, code, { format, height: 34, width: 1.4, fontSize: 11, margin: 0, displayValue: true });
  } catch {
    // Invalid EAN check digit etc. — fall back to CODE128 which accepts any text.
    JsBarcode(svg, code, { format: 'CODE128', height: 34, width: 1.4, fontSize: 11, margin: 0, displayValue: true });
  }
  return svg.outerHTML;
}

/** Barcode/price labels for thermal label rolls or A4 label sheets. */
export function renderLabels(items: LabelItem[], size: LabelSize, fmt: Formatter, shopName: string): string {
  const dims = LABEL_SIZES[size];
  const sheet = size === 'a4_65';
  const labels = items.flatMap((item) => Array.from({ length: Math.max(1, item.copies) }, () => item));
  const cells = labels
    .map(
      (item) => `<div class="label">
        <div class="shop">${esc(shopName)}</div>
        <div class="name">${esc(item.name)}</div>
        <div class="code">${barcodeSvg(item.code)}</div>
        <div class="price">${item.price !== null ? `<b>${esc(fmt.money(item.price))}</b>` : ''}${item.mrp && item.price !== null && item.mrp > item.price ? ` <s>MRP ${esc(fmt.money(item.mrp))}</s>` : ''}</div>
      </div>`,
    )
    .join('');
  const page = sheet
    ? `@page { size: A4; margin: 10.7mm 4.65mm; } .grid { display: grid; grid-template-columns: repeat(5, ${dims.width}mm); grid-auto-rows: ${dims.height}mm; column-gap: 2.5mm; }`
    : `@page { size: ${dims.width}mm ${dims.height}mm; margin: 0; } .label { page-break-after: always; }`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>Labels</title><style>
    * { box-sizing: border-box; } body { margin: 0; font-family: Arial, sans-serif; color: #000; }
    ${page}
    .label { width: ${dims.width}mm; height: ${dims.height}mm; padding: 1mm 1.5mm; overflow: hidden; display: flex; flex-direction: column; align-items: center; justify-content: space-between; text-align: center; }
    .shop { font-size: 6pt; text-transform: uppercase; } .name { font-size: 7pt; font-weight: 600; line-height: 1.1; max-height: 2.2em; overflow: hidden; }
    .code svg { max-width: 100%; height: 11mm; } .price { font-size: 8pt; } s { font-size: 6pt; color: #333; }
  </style></head><body><div class="grid">${cells}</div></body></html>`;
}

export async function printLabels(items: LabelItem[], size: LabelSize, fmt: Formatter, shopName: string): Promise<void> {
  await printer.print(renderLabels(items, size, fmt, shopName));
}
