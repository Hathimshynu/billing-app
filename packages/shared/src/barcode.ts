/**
 * Barcode helpers: EAN-13/UPC validation, check digits, internal barcode generation and parsing of
 * weighing-scale (price/weight embedded) barcodes used by supermarkets.
 */

/** Strip whitespace and control characters a scanner may append (CR/LF/TAB). */
export function normalizeBarcode(input: string): string {
  // Scanners may emit control characters (GS1 group separator, CR/LF); strip them.
  // eslint-disable-next-line no-control-regex
  return input.replace(/[\s\u0000-\u001f]+/g, '').trim();
}

/** GS1 mod-10 check digit for a numeric string (without the check digit). */
export function gs1CheckDigit(digits: string): number {
  if (!/^\d+$/.test(digits)) throw new RangeError('Barcode must be numeric');
  let sum = 0;
  // Weights alternate 3,1 starting from the rightmost digit.
  for (let i = 0; i < digits.length; i++) {
    const digit = Number(digits.charAt(digits.length - 1 - i));
    sum += digit * (i % 2 === 0 ? 3 : 1);
  }
  return (10 - (sum % 10)) % 10;
}

export function isValidGtin(code: string): boolean {
  if (!/^\d{8}$|^\d{12,14}$/.test(code)) return false;
  return gs1CheckDigit(code.slice(0, -1)) === Number(code.slice(-1));
}

/** Generate an EAN-13 for internal use. Prefix "2" is reserved for in-store numbering by GS1. */
export function generateInternalEan13(sequence: number, prefix = '20'): string {
  const body = `${prefix}${String(sequence).padStart(12 - prefix.length, '0')}`.slice(0, 12);
  return `${body}${gs1CheckDigit(body)}`;
}

export interface ScaleBarcodeConfig {
  enabled: boolean;
  /** Barcode prefixes that identify scale labels, e.g. ["21","22"] or ["2"]. */
  prefixes: string[];
  /** Number of digits of the item (PLU) code that follows the prefix. */
  item_code_length: number;
  /** Whether the embedded value is a weight or a price. */
  value_type: 'weight' | 'price';
  /** Number of digits of the embedded value. */
  value_length: number;
  /** Decimal places of the embedded value (3 → grams to kg, 2 → paise to rupees). */
  value_decimals: number;
  /** Whether the total length includes an EAN check digit that should be validated. */
  validate_check_digit: boolean;
}

export const DEFAULT_SCALE_BARCODE_CONFIG: ScaleBarcodeConfig = {
  enabled: false,
  prefixes: ['2'],
  item_code_length: 5,
  value_type: 'weight',
  value_length: 5,
  value_decimals: 3,
  validate_check_digit: true,
};

export interface ScaleBarcodeResult {
  item_code: string;
  value_type: 'weight' | 'price';
  value: number;
}

/**
 * Parse a scale label such as 2 01234 01250 C → item 01234, weight 1.250 kg.
 * Returns null when the code is not a scale barcode for the configuration.
 */
export function parseScaleBarcode(raw: string, config: ScaleBarcodeConfig): ScaleBarcodeResult | null {
  if (!config.enabled) return null;
  const code = normalizeBarcode(raw);
  if (!/^\d+$/.test(code)) return null;
  const prefix = config.prefixes.find((p) => code.startsWith(p));
  if (prefix === undefined) return null;
  const expectedLength = prefix.length + config.item_code_length + config.value_length + (config.validate_check_digit ? 1 : 0);
  if (code.length !== expectedLength) return null;
  if (config.validate_check_digit && !isValidGtin(code)) return null;
  const itemStart = prefix.length;
  const itemCode = code.slice(itemStart, itemStart + config.item_code_length);
  const valueDigits = code.slice(itemStart + config.item_code_length, itemStart + config.item_code_length + config.value_length);
  const value = Number(valueDigits) / 10 ** config.value_decimals;
  return { item_code: itemCode, value_type: config.value_type, value };
}

/**
 * Detects whether a burst of key events came from a barcode scanner (very fast typing) rather than
 * a human. Scanners typically emit a character every < 30ms.
 */
export function looksLikeScannerInput(timestamps: number[], minLength = 4, maxAvgIntervalMs = 35): boolean {
  if (timestamps.length < minLength) return false;
  let total = 0;
  for (let i = 1; i < timestamps.length; i++) total += (timestamps[i] ?? 0) - (timestamps[i - 1] ?? 0);
  return total / (timestamps.length - 1) <= maxAvgIntervalMs;
}
