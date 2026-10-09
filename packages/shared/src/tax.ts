/**
 * Configurable tax & bill pricing engine.
 *
 * Nothing about tax percentages is hard-coded: a tax rate is data (kind + rate + optional cess or
 * custom components). GST rates are split into CGST/SGST (intra-state), IGST (inter-state) or
 * CGST/UTGST (union territory) based on the supply type. VAT, simple and fully custom multi-component
 * taxes are supported as well, and both tax-inclusive and tax-exclusive prices work.
 *
 * Algorithm (identical in PHP: App\Domain\Pricing\PricingEngine):
 *  1. gross       = round(qty × unit_price)
 *  2. line disc   = percent of gross or fixed amount (capped at gross)
 *  3. bill disc   = percent/amount of Σ net, allocated to lines by largest remainder
 *  4. inclusive   → taxable = round(net × 100 / (100 + Σrate)); each tax = round(taxable × rate);
 *                   taxable = net − Σtax  (so taxable + tax == net exactly)
 *     exclusive   → taxable = net; each tax = round(taxable × rate)
 *  5. charges     → exclusive amounts taxed with their own rate, never discounted
 *  6. round off   → optional rounding of the grand total to 0.05/0.10/0.50/1.00
 */
import {
  DEFAULT_CURRENCY_DECIMALS,
  QTY_SCALE,
  RATE_SCALE,
  allocate,
  fromScaled,
  mulDivRound,
  divRound,
  toScaled,
} from './money';

export type TaxKind = 'gst' | 'vat' | 'simple' | 'custom' | 'exempt';
export type SupplyType = 'intra' | 'inter' | 'union_territory' | 'none';
export type DiscountType = 'percent' | 'amount';
export type RoundOffMode = 'none' | '0.05' | '0.10' | '0.50' | '1.00';

export interface TaxComponentDef {
  code: string;
  name: string;
  rate: number;
}

export interface TaxRateDef {
  id?: string | null;
  name: string;
  kind: TaxKind;
  /** Headline rate in percent (e.g. 18 for GST 18%). Ignored for `custom` (sum of components). */
  rate: number;
  /** Additional compensation cess percent (GST only). */
  cess_rate?: number | null;
  /** Components for `custom` taxes. */
  components?: TaxComponentDef[] | null;
}

export interface PricingLineInput {
  key: string;
  quantity: number;
  unit_price: number;
  price_includes_tax: boolean;
  discount_type?: DiscountType | null;
  discount_value?: number | null;
  tax?: TaxRateDef | null;
}

export interface PricingChargeInput {
  key: string;
  name: string;
  /** Amount exclusive of tax. */
  amount: number;
  tax?: TaxRateDef | null;
}

export interface PricingInput {
  lines: PricingLineInput[];
  bill_discount_type?: DiscountType | null;
  bill_discount_value?: number | null;
  charges?: PricingChargeInput[];
  supply_type?: SupplyType;
  round_off?: RoundOffMode;
  decimals?: number;
}

export interface TaxAmount {
  code: string;
  name: string;
  rate: number;
  amount: number;
}

export interface PricingLineResult {
  key: string;
  quantity: number;
  unit_price: number;
  price_includes_tax: boolean;
  gross: number;
  line_discount: number;
  bill_discount: number;
  net: number;
  taxable: number;
  taxes: TaxAmount[];
  tax_total: number;
  total: number;
}

export interface PricingChargeResult {
  key: string;
  name: string;
  taxable: number;
  taxes: TaxAmount[];
  tax_total: number;
  total: number;
}

export interface TaxBreakupRow {
  code: string;
  name: string;
  rate: number;
  taxable: number;
  amount: number;
}

export interface PricingResult {
  lines: PricingLineResult[];
  charges: PricingChargeResult[];
  gross_total: number;
  line_discount_total: number;
  bill_discount_total: number;
  discount_total: number;
  taxable_total: number;
  tax_total: number;
  /** Tax added on top of tax-exclusive prices and charges. */
  tax_exclusive_total: number;
  /** Tax already contained in tax-inclusive prices. */
  tax_inclusive_total: number;
  charges_total: number;
  total_before_round: number;
  round_off: number;
  grand_total: number;
  total_quantity: number;
  item_count: number;
  tax_breakup: TaxBreakupRow[];
}

/** Resolve the concrete tax components that apply for a rate and supply type. */
export function resolveTaxComponents(
  tax: TaxRateDef | null | undefined,
  supplyType: SupplyType = 'intra',
): TaxComponentDef[] {
  if (!tax || tax.kind === 'exempt') return [];
  const components: TaxComponentDef[] = [];
  const rate = Number(tax.rate) || 0;
  switch (tax.kind) {
    case 'gst': {
      if (rate > 0) {
        if (supplyType === 'inter') {
          components.push({ code: 'IGST', name: 'IGST', rate });
        } else {
          const half = fromScaled(divRound(toScaled(rate, RATE_SCALE), 2), RATE_SCALE);
          components.push({ code: 'CGST', name: 'CGST', rate: half });
          if (supplyType === 'union_territory') components.push({ code: 'UTGST', name: 'UTGST', rate: half });
          else components.push({ code: 'SGST', name: 'SGST', rate: half });
        }
      }
      const cess = Number(tax.cess_rate) || 0;
      if (cess > 0) components.push({ code: 'CESS', name: 'Cess', rate: cess });
      break;
    }
    case 'vat':
      if (rate > 0) components.push({ code: 'VAT', name: 'VAT', rate });
      break;
    case 'simple':
      if (rate > 0) components.push({ code: 'TAX', name: tax.name || 'Tax', rate });
      break;
    case 'custom':
      for (const c of tax.components ?? []) {
        if (Number(c.rate) > 0) components.push({ code: c.code, name: c.name, rate: Number(c.rate) });
      }
      break;
  }
  return components;
}

/** Total effective rate (percent) of a tax definition for the given supply type. */
export function effectiveTaxRate(tax: TaxRateDef | null | undefined, supplyType: SupplyType = 'intra'): number {
  const bps = resolveTaxComponents(tax, supplyType).reduce((s, c) => s + toScaled(c.rate, RATE_SCALE), 0);
  return fromScaled(bps, RATE_SCALE);
}

interface TaxSplit {
  taxable: number;
  amounts: number[];
  components: TaxComponentDef[];
}

function splitTax(net: number, components: TaxComponentDef[], inclusive: boolean): TaxSplit {
  if (components.length === 0) return { taxable: net, amounts: [], components };
  const bps = components.map((c) => toScaled(c.rate, RATE_SCALE));
  const totalBps = bps.reduce((s, b) => s + b, 0);
  const hundred = 100 * 10 ** RATE_SCALE;
  if (inclusive) {
    const baseTaxable = mulDivRound(net, hundred, hundred + totalBps);
    const amounts = bps.map((b) => mulDivRound(baseTaxable, b, hundred));
    const taxTotal = amounts.reduce((s, a) => s + a, 0);
    return { taxable: net - taxTotal, amounts, components };
  }
  return { taxable: net, amounts: bps.map((b) => mulDivRound(net, b, hundred)), components };
}

const ROUND_STEPS: Record<RoundOffMode, number> = {
  none: 0,
  '0.05': 5,
  '0.10': 10,
  '0.50': 50,
  '1.00': 100,
};

function clampDiscount(discount: number, base: number): number {
  if (base <= 0) return 0;
  if (discount < 0) return 0;
  return Math.min(discount, base);
}

/** Price a cart / invoice. Returns all money values as numbers rounded to the currency decimals. */
export function calculatePricing(input: PricingInput): PricingResult {
  const decimals = input.decimals ?? DEFAULT_CURRENCY_DECIMALS;
  const supply = input.supply_type ?? 'intra';
  const hundred = 100 * 10 ** RATE_SCALE;
  const m = (v: number) => fromScaled(v, decimals);

  const prepared = input.lines.map((line) => {
    const qty = toScaled(line.quantity, QTY_SCALE);
    const price = toScaled(line.unit_price, decimals);
    const gross = mulDivRound(qty, price, 10 ** QTY_SCALE);
    let lineDiscount = 0;
    const discountValue = Number(line.discount_value) || 0;
    if (line.discount_type === 'percent' && discountValue) {
      lineDiscount = mulDivRound(gross, toScaled(discountValue, RATE_SCALE), hundred);
    } else if (line.discount_type === 'amount' && discountValue) {
      lineDiscount = toScaled(discountValue, decimals);
    }
    lineDiscount = clampDiscount(lineDiscount, gross);
    return { line, qty, gross, lineDiscount, net: gross - lineDiscount };
  });

  const netSum = prepared.reduce((s, p) => s + Math.max(p.net, 0), 0);
  let billDiscount = 0;
  const billValue = Number(input.bill_discount_value) || 0;
  if (input.bill_discount_type === 'percent' && billValue) {
    billDiscount = mulDivRound(netSum, toScaled(billValue, RATE_SCALE), hundred);
  } else if (input.bill_discount_type === 'amount' && billValue) {
    billDiscount = toScaled(billValue, decimals);
  }
  billDiscount = clampDiscount(billDiscount, netSum);
  const shares = allocate(
    billDiscount,
    prepared.map((p) => Math.max(p.net, 0)),
  );

  const breakup = new Map<string, { code: string; name: string; rateBps: number; taxable: number; amount: number }>();
  const addBreakup = (components: TaxComponentDef[], amounts: number[], taxable: number) => {
    components.forEach((c, i) => {
      const rateBps = toScaled(c.rate, RATE_SCALE);
      const key = `${c.code}|${rateBps}`;
      const row = breakup.get(key) ?? { code: c.code, name: c.name, rateBps, taxable: 0, amount: 0 };
      row.taxable += taxable;
      row.amount += amounts[i] ?? 0;
      breakup.set(key, row);
    });
  };

  let grossTotal = 0;
  let lineDiscountTotal = 0;
  let taxableTotal = 0;
  let taxTotal = 0;
  let taxExclusive = 0;
  let taxInclusive = 0;
  let linesTotal = 0;
  let qtyTotal = 0;

  const lines: PricingLineResult[] = prepared.map((p, index) => {
    const billShare = shares[index] ?? 0;
    const net = p.net - billShare;
    const components = resolveTaxComponents(p.line.tax, supply);
    const split = splitTax(net, components, p.line.price_includes_tax);
    const lineTax = split.amounts.reduce((s, a) => s + a, 0);
    const total = split.taxable + lineTax;
    addBreakup(components, split.amounts, split.taxable);
    grossTotal += p.gross;
    lineDiscountTotal += p.lineDiscount;
    taxableTotal += split.taxable;
    taxTotal += lineTax;
    if (p.line.price_includes_tax) taxInclusive += lineTax;
    else taxExclusive += lineTax;
    linesTotal += total;
    qtyTotal += p.qty;
    return {
      key: p.line.key,
      quantity: fromScaled(p.qty, QTY_SCALE),
      unit_price: m(toScaled(p.line.unit_price, decimals)),
      price_includes_tax: p.line.price_includes_tax,
      gross: m(p.gross),
      line_discount: m(p.lineDiscount),
      bill_discount: m(billShare),
      net: m(net),
      taxable: m(split.taxable),
      taxes: components.map((c, i) => ({ code: c.code, name: c.name, rate: c.rate, amount: m(split.amounts[i] ?? 0) })),
      tax_total: m(lineTax),
      total: m(total),
    };
  });

  let chargesTotal = 0;
  const charges: PricingChargeResult[] = (input.charges ?? []).map((charge) => {
    const amount = toScaled(charge.amount, decimals);
    const components = resolveTaxComponents(charge.tax, supply);
    const split = splitTax(amount, components, false);
    const chargeTax = split.amounts.reduce((s, a) => s + a, 0);
    addBreakup(components, split.amounts, split.taxable);
    taxableTotal += split.taxable;
    taxTotal += chargeTax;
    taxExclusive += chargeTax;
    chargesTotal += split.taxable;
    const total = split.taxable + chargeTax;
    linesTotal += total;
    return {
      key: charge.key,
      name: charge.name,
      taxable: m(split.taxable),
      taxes: components.map((c, i) => ({ code: c.code, name: c.name, rate: c.rate, amount: m(split.amounts[i] ?? 0) })),
      tax_total: m(chargeTax),
      total: m(total),
    };
  });

  const step = ROUND_STEPS[input.round_off ?? 'none'] ?? 0;
  const rounded = step > 0 ? divRound(linesTotal, step) * step : linesTotal;
  const roundOff = rounded - linesTotal;

  return {
    lines,
    charges,
    gross_total: m(grossTotal),
    line_discount_total: m(lineDiscountTotal),
    bill_discount_total: m(billDiscount),
    discount_total: m(lineDiscountTotal + billDiscount),
    taxable_total: m(taxableTotal),
    tax_total: m(taxTotal),
    tax_exclusive_total: m(taxExclusive),
    tax_inclusive_total: m(taxInclusive),
    charges_total: m(chargesTotal),
    total_before_round: m(linesTotal),
    round_off: m(roundOff),
    grand_total: m(rounded),
    total_quantity: fromScaled(qtyTotal, QTY_SCALE),
    item_count: input.lines.length,
    tax_breakup: [...breakup.values()]
      .sort((a, b) => a.code.localeCompare(b.code) || a.rateBps - b.rateBps)
      .map((r) => ({
        code: r.code,
        name: r.name,
        rate: fromScaled(r.rateBps, RATE_SCALE),
        taxable: m(r.taxable),
        amount: m(r.amount),
      })),
  };
}

/** Decide GST supply type from seller/buyer state codes (first two digits of GSTIN or state code). */
export function gstSupplyType(sellerState?: string | null, buyerState?: string | null, unionTerritory = false): SupplyType {
  if (!sellerState || !buyerState) return unionTerritory ? 'union_territory' : 'intra';
  if (sellerState.trim().toUpperCase() !== buyerState.trim().toUpperCase()) return 'inter';
  return unionTerritory ? 'union_territory' : 'intra';
}

/** Indian state code from a GSTIN (first two characters). */
export function stateCodeFromGstin(gstin?: string | null): string | null {
  if (!gstin || gstin.length < 2) return null;
  return gstin.slice(0, 2);
}

const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const GSTIN_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** Validates GSTIN format and its checksum character. */
export function isValidGstin(value?: string | null): boolean {
  if (!value) return false;
  const gstin = value.trim().toUpperCase();
  if (!GSTIN_RE.test(gstin)) return false;
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const code = GSTIN_CHARS.indexOf(gstin.charAt(i));
    const product = code * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(product / 36) + (product % 36);
  }
  const check = GSTIN_CHARS.charAt((36 - (sum % 36)) % 36);
  return check === gstin.charAt(14);
}
