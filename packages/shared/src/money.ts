/**
 * Exact decimal helpers for money and quantities.
 *
 * All monetary arithmetic happens on integers in minor units (paise for INR) and all quantities on
 * integers in thousandths. Rounding is always "half away from zero". The PHP backend mirrors these
 * functions in App\Domain\Pricing\Money and both implementations are verified against the shared
 * fixtures in packages/shared/fixtures, so a bill computed offline on a device produces exactly
 * the same numbers when the server re-validates it.
 */

/** Quantities support three decimals (e.g. 2.125 kg, 0.250 g). */
export const QTY_SCALE = 3;
/**
 * Percentages (tax rates, discounts) support three decimals. Needed for slabs such as GST 0.25%,
 * which splits into CGST 0.125% + SGST 0.125%.
 */
export const RATE_SCALE = 3;
/** Default currency minor-unit decimals (INR has 2). */
export const DEFAULT_CURRENCY_DECIMALS = 2;

const DECIMAL_RE = /^([+-])?(\d*)(?:\.(\d*))?$/;

/**
 * Convert a decimal value to a scaled integer (e.g. 12.345 at scale 2 → 1235).
 * Uses the decimal representation of the value, so 1.005 → 101 (not 100 as naive float math gives).
 */
export function toScaled(value: number | string | null | undefined, scale: number): number {
  if (value === null || value === undefined || value === '') return 0;
  let str: string;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new RangeError(`Invalid numeric value: ${value}`);
    str = value.toFixed(Math.min(scale + 6, 20));
  } else {
    str = value.trim();
    if (!DECIMAL_RE.test(str) || str === '' || str === '.' || str === '-' || str === '+') {
      const parsed = Number(str);
      if (!Number.isFinite(parsed)) throw new RangeError(`Invalid numeric value: ${value}`);
      str = parsed.toFixed(Math.min(scale + 6, 20));
    }
  }
  const match = DECIMAL_RE.exec(str);
  if (!match) throw new RangeError(`Invalid numeric value: ${value}`);
  const negative = match[1] === '-';
  const intPart = match[2] || '0';
  const fracPart = match[3] ?? '';
  const kept = (fracPart + '0'.repeat(scale)).slice(0, scale);
  let result = Number(intPart + kept);
  const firstDropped = fracPart.charAt(scale);
  if (firstDropped !== '' && firstDropped >= '5') result += 1;
  if (!Number.isSafeInteger(result)) throw new RangeError(`Value out of range: ${value}`);
  return negative && result !== 0 ? -result : result;
}

/** Convert a scaled integer back to a JS number (e.g. 1235 at scale 2 → 12.35). */
export function fromScaled(value: number, scale: number): number {
  if (value === 0) return 0;
  return value / 10 ** scale;
}

/** Money helpers bound to a currency's minor unit decimals. */
export const toMinor = (value: number | string | null | undefined, decimals = DEFAULT_CURRENCY_DECIMALS) =>
  toScaled(value, decimals);
export const fromMinor = (value: number, decimals = DEFAULT_CURRENCY_DECIMALS) => fromScaled(value, decimals);

/** Round a decimal number to `decimals` places using half-away-from-zero. */
export function roundTo(value: number, decimals = DEFAULT_CURRENCY_DECIMALS): number {
  return fromScaled(toScaled(value, decimals), decimals);
}

/** Integer division rounding half away from zero. Both arguments must be integers. */
export function divRound(numerator: number, denominator: number): number {
  if (denominator === 0) throw new RangeError('Division by zero');
  if (numerator === 0) return 0;
  const negative = numerator < 0 !== denominator < 0;
  const a = Math.abs(numerator);
  const b = Math.abs(denominator);
  let q = Math.floor(a / b);
  let r = a - q * b;
  // Correct any floating point error in the floor division.
  while (r < 0) {
    q -= 1;
    r += b;
  }
  while (r >= b) {
    q += 1;
    r -= b;
  }
  if (2 * r >= b) q += 1;
  return negative && q !== 0 ? -q : q;
}

/** Computes round(a × b ÷ c) exactly, switching to BigInt if the product is not a safe integer. */
export function mulDivRound(a: number, b: number, c: number): number {
  const product = a * b;
  if (Number.isSafeInteger(product)) return divRound(product, c);
  const big = BigInt(a) * BigInt(b);
  const bc = BigInt(c);
  const negative = big < 0n !== bc < 0n;
  const abig = big < 0n ? -big : big;
  const bbig = bc < 0n ? -bc : bc;
  let q = abig / bbig;
  const r = abig % bbig;
  if (2n * r >= bbig) q += 1n;
  const result = Number(q);
  return negative && result !== 0 ? -result : result;
}

/** floor(a × b ÷ c) for non-negative integers, BigInt-safe. */
function mulDivFloor(a: number, b: number, c: number): { quotient: number; remainder: number } {
  const product = a * b;
  if (Number.isSafeInteger(product)) {
    let q = Math.floor(product / c);
    let r = product - q * c;
    while (r < 0) {
      q -= 1;
      r += c;
    }
    while (r >= c) {
      q += 1;
      r -= c;
    }
    return { quotient: q, remainder: r };
  }
  const big = BigInt(a) * BigInt(b);
  const bc = BigInt(c);
  return { quotient: Number(big / bc), remainder: Number(big % bc) };
}

/**
 * Split an integer `total` across `weights` proportionally using the largest remainder method so
 * that the parts always add up exactly to `total`. Ties are broken by lower index first.
 */
export function allocate(total: number, weights: number[]): number[] {
  const n = weights.length;
  if (n === 0) return [];
  if (total === 0) return weights.map(() => 0);
  const sign = total < 0 ? -1 : 1;
  const abs = Math.abs(total);
  const cleanWeights = weights.map((w) => (w > 0 ? w : 0));
  const sumW = cleanWeights.reduce((s, w) => s + w, 0);
  if (sumW === 0) {
    // No basis for proportional split: spread evenly, extra units to the first entries.
    const base = Math.floor(abs / n);
    const extra = abs - base * n;
    return cleanWeights.map((_, i) => sign * (base + (i < extra ? 1 : 0)) || 0);
  }
  const parts = cleanWeights.map((w, index) => ({ index, ...mulDivFloor(abs, w, sumW) }));
  let remaining = abs - parts.reduce((s, p) => s + p.quotient, 0);
  const order = [...parts].sort((x, y) => y.remainder - x.remainder || x.index - y.index);
  for (const part of order) {
    if (remaining <= 0) break;
    part.quotient += 1;
    remaining -= 1;
  }
  return parts.map((p) => sign * p.quotient || 0);
}

/** Sum a list of numbers exactly at the given scale. */
export function sumDecimals(values: Array<number | string | null | undefined>, scale = DEFAULT_CURRENCY_DECIMALS): number {
  return fromScaled(
    values.reduce<number>((s, v) => s + toScaled(v ?? 0, scale), 0),
    scale,
  );
}

/** Multiply quantity × rate and round to currency decimals. */
export function lineAmount(quantity: number | string, rate: number | string, decimals = DEFAULT_CURRENCY_DECIMALS): number {
  return fromScaled(mulDivRound(toScaled(quantity, QTY_SCALE), toScaled(rate, decimals), 10 ** QTY_SCALE), decimals);
}

/** Percentage of an amount, rounded to currency decimals. */
export function percentOf(amount: number | string, percent: number | string, decimals = DEFAULT_CURRENCY_DECIMALS): number {
  return fromScaled(
    mulDivRound(toScaled(amount, decimals), toScaled(percent, RATE_SCALE), 100 * 10 ** RATE_SCALE),
    decimals,
  );
}

/** Round a quantity to 3 decimals. */
export function roundQty(value: number | string): number {
  return fromScaled(toScaled(value, QTY_SCALE), QTY_SCALE);
}

/** Add quantities exactly (avoids 0.1 + 0.2 style drift). */
export function addQty(...values: Array<number | string>): number {
  return fromScaled(
    values.reduce<number>((s, v) => s + toScaled(v, QTY_SCALE), 0),
    QTY_SCALE,
  );
}

const formatterCache = new Map<string, Intl.NumberFormat>();

export interface MoneyFormatOptions {
  currency?: string;
  locale?: string;
  decimals?: number;
  showSymbol?: boolean;
}

/** Locale-aware money formatting. Defaults to INR with Indian digit grouping (₹1,24,850.00). */
export function formatMoney(value: number | string | null | undefined, options: MoneyFormatOptions = {}): string {
  const { currency = 'INR', locale = 'en-IN', decimals = DEFAULT_CURRENCY_DECIMALS, showSymbol = true } = options;
  const key = `${locale}|${currency}|${decimals}|${showSymbol}`;
  let formatter = formatterCache.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat(locale, {
      style: showSymbol ? 'currency' : 'decimal',
      currency: showSymbol ? currency : undefined,
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
    formatterCache.set(key, formatter);
  }
  const num = typeof value === 'string' ? Number(value) : (value ?? 0);
  return formatter.format(Number.isFinite(num) ? roundTo(num, decimals) : 0);
}

/** Format a quantity, trimming trailing zeros (2.500 → "2.5"). */
export function formatQty(value: number | string | null | undefined, maxDecimals = QTY_SCALE): string {
  const num = typeof value === 'string' ? Number(value) : (value ?? 0);
  if (!Number.isFinite(num)) return '0';
  return roundTo(num, maxDecimals).toLocaleString('en-IN', { maximumFractionDigits: maxDecimals });
}

const ONES = [
  '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve',
  'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen',
];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function twoDigits(n: number): string {
  if (n < 20) return ONES[n] ?? '';
  const t = TENS[Math.floor(n / 10)] ?? '';
  const o = ONES[n % 10] ?? '';
  return o ? `${t} ${o}` : t;
}

function threeDigits(n: number): string {
  const h = Math.floor(n / 100);
  const rest = n % 100;
  const parts: string[] = [];
  if (h) parts.push(`${ONES[h]} Hundred`);
  if (rest) parts.push(twoDigits(rest));
  return parts.join(' ');
}

/** Integer to words using the Indian system (lakh/crore) or the international system (million/billion). */
export function integerToWords(value: number, system: 'indian' | 'international' = 'indian'): string {
  let n = Math.floor(Math.abs(value));
  if (n === 0) return 'Zero';
  const parts: string[] = [];
  if (system === 'indian') {
    const crore = Math.floor(n / 10_000_000);
    n %= 10_000_000;
    const lakh = Math.floor(n / 100_000);
    n %= 100_000;
    const thousand = Math.floor(n / 1000);
    n %= 1000;
    if (crore) parts.push(`${integerToWords(crore, 'indian')} Crore`);
    if (lakh) parts.push(`${twoDigits(lakh)} Lakh`);
    if (thousand) parts.push(`${twoDigits(thousand)} Thousand`);
    if (n) parts.push(threeDigits(n));
  } else {
    const scales: Array<[number, string]> = [
      [1_000_000_000, 'Billion'],
      [1_000_000, 'Million'],
      [1000, 'Thousand'],
    ];
    for (const [size, label] of scales) {
      const chunk = Math.floor(n / size);
      if (chunk) parts.push(`${threeDigits(chunk)} ${label}`);
      n %= size;
    }
    if (n) parts.push(threeDigits(n));
  }
  return parts.join(' ');
}

/** "Rupees One Thousand Five Hundred and Fifty Paise Only" style amount in words. */
export function amountInWords(
  amount: number,
  options: { major?: string; minor?: string; system?: 'indian' | 'international'; decimals?: number } = {},
): string {
  const { major = 'Rupees', minor = 'Paise', system = 'indian', decimals = DEFAULT_CURRENCY_DECIMALS } = options;
  const scaled = Math.abs(toScaled(amount, decimals));
  const factor = 10 ** decimals;
  const whole = Math.floor(scaled / factor);
  const fraction = scaled % factor;
  let words = `${major} ${integerToWords(whole, system)}`;
  if (fraction > 0) words += ` and ${integerToWords(fraction, system)} ${minor}`;
  return `${amount < 0 ? 'Minus ' : ''}${words} Only`;
}
