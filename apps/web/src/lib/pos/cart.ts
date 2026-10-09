import {
  calculateJewelleryPrice,
  calculatePricing,
  gstSupplyType,
  INDIAN_STATES,
  roundTo,
  uuidv7,
  type DiscountType,
  type JewelleryLineDetails,
  type MetalRate,
  type OrderType,
  type PricingResult,
  type Product,
  type ProductBatch,
  type ProductVariant,
  type RoundOffMode,
  type SaleDocType,
  type SelectedModifier,
  type SupplyType,
  type TaxRate,
  type TaxSnapshot,
} from '@shopdesk/shared';

export interface CartLine {
  key: string;
  product_id: string | null;
  variant_id: string | null;
  batch_id: string | null;
  batch_no: string | null;
  expiry_date: string | null;
  serial_ids: string[];
  serial_numbers: string[];
  name: string;
  sku: string | null;
  hsn_code: string | null;
  unit_code: string | null;
  allow_decimal: boolean;
  quantity: number;
  unit_price: number;
  /** Price the product would sell for (used to detect manual overrides). */
  list_price: number;
  mrp: number | null;
  cost_price: number;
  price_includes_tax: boolean;
  discount_type: DiscountType | null;
  discount_value: number | null;
  tax_rate_id: string | null;
  tax: TaxSnapshot | null;
  modifiers: SelectedModifier[];
  jewellery: JewelleryLineDetails | null;
  warranty_months: number | null;
  kitchen_order_id: string | null;
  notes: string | null;
  track_inventory: boolean;
  prescription_required: boolean;
}

export interface CartCharge {
  key: string;
  name: string;
  amount: number;
  tax_rate_id: string | null;
  tax: TaxSnapshot | null;
}

export interface CartState {
  lines: CartLine[];
  customer_id: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  customer_gstin: string | null;
  customer_state: string | null;
  bill_discount_type: DiscountType | null;
  bill_discount_value: number | null;
  coupon_code: string | null;
  charges: CartCharge[];
  doc_type: SaleDocType;
  order_type: OrderType;
  table_id: string | null;
  kitchen_order_ids: string[];
  notes: string | null;
  converted_from_id: string | null;
  loyalty_redeem_points: number;
}

export const emptyCart = (): CartState => ({
  lines: [],
  customer_id: null,
  customer_name: null,
  customer_phone: null,
  customer_gstin: null,
  customer_state: null,
  bill_discount_type: null,
  bill_discount_value: null,
  coupon_code: null,
  charges: [],
  doc_type: 'invoice',
  order_type: 'retail',
  table_id: null,
  kitchen_order_ids: [],
  notes: null,
  converted_from_id: null,
  loyalty_redeem_points: 0,
});

export function taxSnapshot(tax: TaxRate | null | undefined): TaxSnapshot | null {
  if (!tax) return null;
  return { id: tax.id, name: tax.name, kind: tax.kind, rate: tax.rate, cess_rate: tax.cess_rate ?? 0, components: tax.components ?? null };
}

/** Quantity-based price tiers (wholesale pricing). */
export function tierPrice(product: Pick<Product, 'price_tiers'>, base: number, quantity: number): number {
  const tiers = [...(product.price_tiers ?? [])].sort((a, b) => b.min_qty - a.min_qty);
  return tiers.find((t) => quantity >= t.min_qty)?.price ?? base;
}

/** Latest metal rate for metal + purity. */
export function currentMetalRate(rates: MetalRate[], metal: string, purity: string): number {
  const match = rates
    .filter((r) => r.metal === metal && r.purity === purity)
    .sort((a, b) => b.effective_from.localeCompare(a.effective_from))[0];
  return match?.rate_per_gram ?? 0;
}

/** Price a jewellery item from its attributes and today's metal rate. */
export function jewelleryDetails(product: Product, rates: MetalRate[], overrides: Partial<JewelleryLineDetails> = {}): JewelleryLineDetails {
  const a = product.attributes;
  const metal = overrides.metal ?? a.metal ?? 'gold';
  const purity = overrides.purity ?? a.purity ?? '22K';
  const base = {
    metal,
    purity,
    gross_weight: overrides.gross_weight ?? Number(a.gross_weight ?? 0),
    net_weight: overrides.net_weight ?? Number(a.net_weight ?? 0),
    stone_weight: overrides.stone_weight ?? Number(a.stone_weight ?? 0),
    rate_per_gram: overrides.rate_per_gram ?? currentMetalRate(rates, metal, purity),
    making_charge_type: overrides.making_charge_type ?? a.making_charge_type ?? 'fixed',
    making_charge_value: overrides.making_charge_value ?? Number(a.making_charge_value ?? 0),
    wastage_type: overrides.wastage_type ?? a.wastage_type ?? 'percent',
    wastage_value: overrides.wastage_value ?? Number(a.wastage_value ?? 0),
    stone_charges: overrides.stone_charges ?? Number(a.stone_charges ?? 0),
    other_charges: overrides.other_charges ?? Number(a.other_charges ?? 0),
    huid: overrides.huid ?? (a.huid as string | undefined) ?? null,
  };
  const priced = calculateJewelleryPrice(base);
  return { ...base, metal_value: priced.metal_value, making_charges: priced.making_charges, wastage_charges: priced.wastage_charges };
}

export function jewelleryUnitPrice(details: JewelleryLineDetails): number {
  return calculateJewelleryPrice(details).taxable_value;
}

export interface LineSource {
  product: Product;
  variant?: ProductVariant | null;
  batch?: ProductBatch | null;
  tax?: TaxRate | null;
  unitCode?: string | null;
  allowDecimal?: boolean;
  quantity?: number;
  metalRates?: MetalRate[];
  serial?: { id: string; serial_no: string } | null;
}

export function lineFromProduct(src: LineSource): CartLine {
  const { product, variant, batch } = src;
  const quantity = src.quantity ?? 1;
  let price = batch?.selling_price ?? variant?.selling_price ?? product.selling_price;
  let jewellery: JewelleryLineDetails | null = null;
  if (product.product_type === 'jewellery') {
    jewellery = jewelleryDetails(product, src.metalRates ?? []);
    price = jewelleryUnitPrice(jewellery);
  }
  const listPrice = tierPrice(product, price, quantity);
  return {
    key: uuidv7(),
    product_id: product.id,
    variant_id: variant?.id ?? null,
    batch_id: batch?.id ?? null,
    batch_no: batch?.batch_no ?? null,
    expiry_date: batch?.expiry_date ?? null,
    serial_ids: src.serial ? [src.serial.id] : [],
    serial_numbers: src.serial ? [src.serial.serial_no] : [],
    name: variant ? `${product.name} (${variant.name})` : product.name,
    sku: variant?.sku ?? product.sku,
    hsn_code: product.hsn_code,
    unit_code: src.unitCode ?? null,
    allow_decimal: src.allowDecimal ?? product.product_type === 'weighed',
    quantity,
    unit_price: listPrice,
    list_price: listPrice,
    mrp: batch?.mrp ?? variant?.mrp ?? product.mrp,
    cost_price: batch?.purchase_price ?? variant?.purchase_price ?? product.purchase_price,
    price_includes_tax: product.product_type === 'jewellery' ? false : product.price_includes_tax,
    discount_type: null,
    discount_value: null,
    tax_rate_id: src.tax?.id ?? product.tax_rate_id,
    tax: taxSnapshot(src.tax),
    modifiers: [],
    jewellery,
    warranty_months: product.warranty_months,
    kitchen_order_id: null,
    notes: null,
    track_inventory: product.track_inventory && product.product_type !== 'service',
    prescription_required: Boolean(product.attributes?.prescription_required),
  };
}

/** Unit price including selected modifiers. */
export function effectiveUnitPrice(line: CartLine): number {
  return roundTo(line.unit_price + line.modifiers.reduce((s, m) => s + m.price, 0));
}

export function supplyTypeFor(businessState: string | null, customerState: string | null, taxSystem: string): SupplyType {
  if (taxSystem !== 'gst') return 'none';
  const ut = INDIAN_STATES.find((s) => s.code === businessState)?.ut ?? false;
  return gstSupplyType(businessState, customerState, ut);
}

export function priceCart(cart: CartState, options: { supplyType: SupplyType; roundOff: RoundOffMode; decimals?: number }): PricingResult {
  return calculatePricing({
    lines: cart.lines.map((l) => ({
      key: l.key,
      quantity: l.quantity,
      unit_price: effectiveUnitPrice(l),
      price_includes_tax: l.price_includes_tax,
      discount_type: l.discount_type,
      discount_value: l.discount_value,
      tax: l.tax,
    })),
    bill_discount_type: cart.bill_discount_type,
    bill_discount_value: cart.bill_discount_value,
    charges: cart.charges.map((c) => ({ key: c.key, name: c.name, amount: c.amount, tax: c.tax })),
    supply_type: options.supplyType,
    round_off: cart.doc_type === 'invoice' ? options.roundOff : 'none',
    decimals: options.decimals,
  });
}
