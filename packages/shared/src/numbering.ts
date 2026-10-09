/**
 * Document number formatting (invoices, returns, purchases, quotations...).
 *
 * Format tokens:
 *   {YYYY} 2026   {YY} 26   {MM} 10   {FY} 2026-27   {FYY} 2627
 *   {DEVICE} device code (C1)   {STORE} store code   {SEQ} / {SEQ:6} zero-padded sequence
 *
 * Offline safety: devices reserve blocks of numbers from the server while online and consume them
 * locally. A device that runs out while offline issues a provisional number and the server assigns
 * the final number during sync (see docs/OFFLINE_SYNC.md). Mirrored in PHP by
 * App\Domain\Numbering\DocumentNumberFormatter.
 */

export type DocumentType =
  | 'sale'
  | 'quotation'
  | 'estimate'
  | 'proforma'
  | 'delivery_challan'
  | 'sale_return'
  | 'purchase'
  | 'purchase_order'
  | 'purchase_return'
  | 'expense'
  | 'customer_payment'
  | 'supplier_payment'
  | 'stock_transfer'
  | 'kot'
  | 'jewellery_order';

export const DEFAULT_NUMBER_FORMATS: Record<DocumentType, string> = {
  sale: 'INV-{YYYY}-{SEQ:6}',
  quotation: 'QT-{YYYY}-{SEQ:5}',
  estimate: 'EST-{YYYY}-{SEQ:5}',
  proforma: 'PI-{YYYY}-{SEQ:5}',
  delivery_challan: 'DC-{YYYY}-{SEQ:5}',
  sale_return: 'CN-{YYYY}-{SEQ:5}',
  purchase: 'PUR-{YYYY}-{SEQ:5}',
  purchase_order: 'PO-{YYYY}-{SEQ:5}',
  purchase_return: 'DN-{YYYY}-{SEQ:5}',
  expense: 'EXP-{YYYY}-{SEQ:5}',
  customer_payment: 'RCPT-{YYYY}-{SEQ:5}',
  supplier_payment: 'PAY-{YYYY}-{SEQ:5}',
  stock_transfer: 'TRF-{YYYY}-{SEQ:5}',
  kot: 'KOT-{SEQ:4}',
  jewellery_order: 'JO-{YYYY}-{SEQ:5}',
};

export interface NumberContext {
  sequence: number;
  /** Business-local date YYYY-MM-DD. */
  date: string;
  deviceCode?: string | null;
  storeCode?: string | null;
  /** Month the financial year starts (India: 4 = April). */
  fyStartMonth?: number;
}

function parseDate(date: string): { year: number; month: number } {
  const [y, m] = date.slice(0, 10).split('-').map(Number);
  return { year: y ?? 1970, month: m ?? 1 };
}

export function financialYearStart(date: string, fyStartMonth = 4): number {
  const { year, month } = parseDate(date);
  return month >= fyStartMonth ? year : year - 1;
}

export function formatDocumentNumber(format: string, ctx: NumberContext): string {
  const { year, month } = parseDate(ctx.date);
  const fyStartMonth = ctx.fyStartMonth ?? 4;
  const fyStart = financialYearStart(ctx.date, fyStartMonth);
  const fyEndShort = String((fyStart + 1) % 100).padStart(2, '0');
  return format.replace(/\{([A-Z]+)(?::(\d+))?\}/g, (whole, token: string, pad?: string) => {
    switch (token) {
      case 'YYYY':
        return String(year);
      case 'YY':
        return String(year % 100).padStart(2, '0');
      case 'MM':
        return String(month).padStart(2, '0');
      case 'FY':
        return fyStartMonth === 1 ? String(year) : `${fyStart}-${fyEndShort}`;
      case 'FYY':
        return fyStartMonth === 1 ? String(year % 100).padStart(2, '0') : `${String(fyStart % 100).padStart(2, '0')}${fyEndShort}`;
      case 'DEVICE':
        return ctx.deviceCode ?? '';
      case 'STORE':
        return ctx.storeCode ?? '';
      case 'SEQ':
        return String(ctx.sequence).padStart(pad ? Number(pad) : 6, '0');
      default:
        return whole;
    }
  });
}

/**
 * The numbering period a date belongs to for a format. Sequences restart every period.
 * Monthly if {MM} is present, financial-year if {FY}/{FYY}, calendar-year if {YYYY}/{YY}, else "all".
 */
export function numberingPeriod(format: string, date: string, fyStartMonth = 4): string {
  const { year, month } = parseDate(date);
  if (/\{MM\}/.test(format)) return `${year}-${String(month).padStart(2, '0')}`;
  if (/\{FYY?\}/.test(format)) return `FY${financialYearStart(date, fyStartMonth)}`;
  if (/\{YYYY\}|\{YY\}/.test(format)) return String(year);
  return 'all';
}

/** Whether the format gives every device its own independent (gap-free) series. */
export function isPerDeviceSeries(format: string): boolean {
  return format.includes('{DEVICE}');
}

/** Provisional number used when a device has no reserved numbers left while offline. */
export function provisionalNumber(deviceCode: string, localSequence: number): string {
  return `TMP-${deviceCode}-${String(localSequence).padStart(5, '0')}`;
}
