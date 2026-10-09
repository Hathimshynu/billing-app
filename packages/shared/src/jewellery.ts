/**
 * Jewellery pricing.
 *
 *   Net Weight × Metal Rate
 * + Making Charges (per gram / % of metal value / fixed)
 * + Wastage (% of metal value / fixed)
 * + Stone Charges + Other Charges
 * − Discount
 * = Taxable value  → GST is then applied by the standard pricing engine (tax-exclusive).
 *
 * Mirrored in PHP by App\Domain\Pricing\JewelleryPricing.
 */
import { DEFAULT_CURRENCY_DECIMALS, QTY_SCALE, RATE_SCALE, fromScaled, mulDivRound, toScaled } from './money';

export type MetalType = 'gold' | 'silver' | 'platinum' | 'diamond' | 'other';

export interface PurityDef {
  code: string;
  label: string;
  metal: MetalType;
  /** Fineness in parts per thousand (916 for 22K). */
  fineness: number;
}

export const PURITIES: PurityDef[] = [
  { code: '24K', label: '24K (999)', metal: 'gold', fineness: 999 },
  { code: '22K', label: '22K (916)', metal: 'gold', fineness: 916 },
  { code: '18K', label: '18K (750)', metal: 'gold', fineness: 750 },
  { code: '14K', label: '14K (585)', metal: 'gold', fineness: 585 },
  { code: 'S999', label: 'Silver 999', metal: 'silver', fineness: 999 },
  { code: 'S925', label: 'Sterling 925', metal: 'silver', fineness: 925 },
  { code: 'PT950', label: 'Platinum 950', metal: 'platinum', fineness: 950 },
];

export type MakingChargeType = 'per_gram' | 'percent' | 'fixed';
export type WastageType = 'percent' | 'fixed';

export interface JewelleryPriceInput {
  net_weight: number;
  rate_per_gram: number;
  making_charge_type: MakingChargeType;
  making_charge_value: number;
  wastage_type?: WastageType;
  wastage_value?: number;
  stone_charges?: number;
  other_charges?: number;
  discount?: number;
  decimals?: number;
}

export interface JewelleryPriceResult {
  metal_value: number;
  making_charges: number;
  wastage_charges: number;
  stone_charges: number;
  other_charges: number;
  discount: number;
  taxable_value: number;
}

export function calculateJewelleryPrice(input: JewelleryPriceInput): JewelleryPriceResult {
  const d = input.decimals ?? DEFAULT_CURRENCY_DECIMALS;
  const hundred = 100 * 10 ** RATE_SCALE;
  const weight = toScaled(input.net_weight, QTY_SCALE);
  const rate = toScaled(input.rate_per_gram, d);
  const metalValue = mulDivRound(weight, rate, 10 ** QTY_SCALE);

  let making = 0;
  switch (input.making_charge_type) {
    case 'per_gram':
      making = mulDivRound(weight, toScaled(input.making_charge_value, d), 10 ** QTY_SCALE);
      break;
    case 'percent':
      making = mulDivRound(metalValue, toScaled(input.making_charge_value, RATE_SCALE), hundred);
      break;
    case 'fixed':
      making = toScaled(input.making_charge_value, d);
      break;
  }

  let wastage = 0;
  if (input.wastage_value) {
    wastage =
      input.wastage_type === 'fixed'
        ? toScaled(input.wastage_value, d)
        : mulDivRound(metalValue, toScaled(input.wastage_value, RATE_SCALE), hundred);
  }
  const stones = toScaled(input.stone_charges ?? 0, d);
  const other = toScaled(input.other_charges ?? 0, d);
  const gross = metalValue + making + wastage + stones + other;
  const discount = Math.min(Math.max(toScaled(input.discount ?? 0, d), 0), gross);
  const m = (v: number) => fromScaled(v, d);
  return {
    metal_value: m(metalValue),
    making_charges: m(making),
    wastage_charges: m(wastage),
    stone_charges: m(stones),
    other_charges: m(other),
    discount: m(discount),
    taxable_value: m(gross - discount),
  };
}

export interface OldGoldInput {
  gross_weight: number;
  stone_weight?: number;
  /** Rate per gram applicable to the declared purity. */
  rate_per_gram: number;
  /** Melting / purity loss deduction in percent of net weight. */
  deduction_percent?: number;
  decimals?: number;
}

export interface OldGoldResult {
  net_weight: number;
  deduction_weight: number;
  effective_weight: number;
  value: number;
}

/** Value of old gold taken in exchange or purchased from a customer. */
export function calculateOldGoldValue(input: OldGoldInput): OldGoldResult {
  const d = input.decimals ?? DEFAULT_CURRENCY_DECIMALS;
  const gross = toScaled(input.gross_weight, QTY_SCALE);
  const stone = toScaled(input.stone_weight ?? 0, QTY_SCALE);
  const net = Math.max(gross - stone, 0);
  const deduction = mulDivRound(net, toScaled(input.deduction_percent ?? 0, RATE_SCALE), 100 * 10 ** RATE_SCALE);
  const effective = net - deduction;
  const value = mulDivRound(effective, toScaled(input.rate_per_gram, d), 10 ** QTY_SCALE);
  return {
    net_weight: fromScaled(net, QTY_SCALE),
    deduction_weight: fromScaled(deduction, QTY_SCALE),
    effective_weight: fromScaled(effective, QTY_SCALE),
    value: fromScaled(value, d),
  };
}
