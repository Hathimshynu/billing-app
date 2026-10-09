/**
 * Entity shapes exchanged between the API and devices (and stored as-is in IndexedDB).
 * Field names are snake_case to match the API exactly — no mapping layer is needed.
 */
import type { BusinessType, ModuleKey, PaymentMethod } from './business';
import type { DiscountType, RoundOffMode, SupplyType, TaxAmount, TaxBreakupRow, TaxComponentDef, TaxKind } from './tax';
import type { MakingChargeType, MetalType, WastageType } from './jewellery';
import type { ScaleBarcodeConfig } from './barcode';

export type ISODateTime = string;
export type ISODate = string;

export interface BaseEntity {
  id: string;
  business_id: string;
  version: number;
  created_at: ISODateTime;
  updated_at: ISODateTime;
  deleted_at?: ISODateTime | null;
}

export interface Business {
  id: string;
  name: string;
  legal_name: string | null;
  business_type: BusinessType;
  modules: ModuleKey[];
  country: string;
  currency: string;
  currency_decimals: number;
  locale: string;
  timezone: string;
  date_format: 'DD/MM/YYYY' | 'MM/DD/YYYY' | 'YYYY-MM-DD';
  tax_system: 'gst' | 'vat' | 'simple' | 'none';
  gstin: string | null;
  state_code: string | null;
  fy_start_month: number;
  phone: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  pincode: string | null;
  logo_url: string | null;
  version: number;
  created_at: ISODateTime;
  updated_at: ISODateTime;
}

export interface Store extends BaseEntity {
  name: string;
  code: string;
  address: string | null;
  phone: string | null;
  gstin: string | null;
  state_code: string | null;
  is_default: boolean;
  active: boolean;
}

export interface Device extends BaseEntity {
  store_id: string | null;
  name: string;
  code: string;
  platform: string | null;
  status: 'active' | 'revoked';
  last_seen_at: ISODateTime | null;
  last_sync_at: ISODateTime | null;
}

export interface BusinessMember {
  id: string;
  business_id: string;
  name: string;
  email: string;
  phone: string | null;
  role_id: string;
  role_key: string;
  role_name: string;
  permissions: string[];
  status: 'active' | 'invited' | 'disabled';
  store_ids: string[] | null;
  version: number;
  created_at: ISODateTime;
  updated_at: ISODateTime;
}

export interface Role extends BaseEntity {
  key: string;
  name: string;
  description: string | null;
  permissions: string[];
  is_system: boolean;
}

export interface Setting {
  id: string;
  business_id: string;
  key: string;
  value: Record<string, unknown>;
  version: number;
  updated_at: ISODateTime;
}

export interface Category extends BaseEntity {
  name: string;
  parent_id: string | null;
  color: string | null;
  sort_order: number;
  active: boolean;
}

export interface Brand extends BaseEntity {
  name: string;
  active: boolean;
}

export interface Unit extends BaseEntity {
  code: string;
  name: string;
  allow_decimal: boolean;
}

export interface TaxRate extends BaseEntity {
  name: string;
  kind: TaxKind;
  rate: number;
  cess_rate: number;
  components: TaxComponentDef[] | null;
  is_default: boolean;
  active: boolean;
}

export interface ModifierOption {
  id: string;
  name: string;
  price: number;
}

export interface ModifierGroup {
  id: string;
  name: string;
  min: number;
  max: number;
  options: ModifierOption[];
}

export interface PriceTier {
  min_qty: number;
  price: number;
}

export interface VariantAttribute {
  name: string;
  values: string[];
}

export interface ProductVariant {
  id: string;
  product_id: string;
  name: string;
  sku: string | null;
  barcode: string | null;
  attributes: Record<string, string>;
  purchase_price: number | null;
  selling_price: number | null;
  mrp: number | null;
  active: boolean;
  sort_order: number;
}

/** Industry-specific product attributes live here instead of dedicated columns. */
export interface ProductAttributes {
  // Pharmacy
  generic_name?: string;
  manufacturer?: string;
  composition?: string;
  schedule?: string;
  prescription_required?: boolean;
  pack_size?: string;
  // Jewellery
  metal?: MetalType;
  purity?: string;
  gross_weight?: number;
  net_weight?: number;
  stone_weight?: number;
  making_charge_type?: MakingChargeType;
  making_charge_value?: number;
  wastage_type?: WastageType;
  wastage_value?: number;
  stone_charges?: number;
  other_charges?: number;
  design_no?: string;
  huid?: string;
  // Mobile / electronics
  model?: string;
  ram?: string;
  storage?: string;
  color?: string;
  // Clothing
  size?: string;
  material?: string;
  style?: string;
  season?: string;
  gender?: string;
  [key: string]: unknown;
}

export type ProductType = 'standard' | 'service' | 'jewellery' | 'weighed';

export interface Product extends BaseEntity {
  name: string;
  product_type: ProductType;
  sku: string | null;
  barcode: string | null;
  barcodes: string[];
  plu_code: string | null;
  category_id: string | null;
  brand_id: string | null;
  unit_id: string | null;
  description: string | null;
  hsn_code: string | null;
  purchase_price: number;
  selling_price: number;
  mrp: number | null;
  min_selling_price: number | null;
  tax_rate_id: string | null;
  price_includes_tax: boolean;
  reorder_level: number;
  track_inventory: boolean;
  track_batch: boolean;
  track_serial: boolean;
  track_expiry: boolean;
  has_variants: boolean;
  variant_attributes: VariantAttribute[];
  variants: ProductVariant[];
  attributes: ProductAttributes;
  custom_fields: Record<string, unknown>;
  modifiers: ModifierGroup[];
  price_tiers: PriceTier[];
  warranty_months: number | null;
  image_url: string | null;
  active: boolean;
}

export interface ProductBatch extends BaseEntity {
  product_id: string;
  variant_id: string | null;
  batch_no: string;
  expiry_date: ISODate | null;
  mfg_date: ISODate | null;
  mrp: number | null;
  purchase_price: number | null;
  selling_price: number | null;
}

export type SerialStatus = 'in_stock' | 'sold' | 'returned' | 'damaged' | 'reserved';

export interface ProductSerial extends BaseEntity {
  product_id: string;
  variant_id: string | null;
  store_id: string;
  serial_no: string;
  imei1: string | null;
  imei2: string | null;
  status: SerialStatus;
  cost_price: number | null;
  purchase_id: string | null;
  sale_id: string | null;
  customer_id: string | null;
  warranty_months: number | null;
  sold_at: ISODateTime | null;
  warranty_expires_at: ISODate | null;
}

export interface StockLevel {
  stock_key: string;
  id?: string;
  business_id: string;
  store_id: string;
  product_id: string;
  variant_id: string | null;
  batch_id: string | null;
  /** Quantity shown to users: server quantity + local unsynced movements. */
  qty: number;
  /** Last quantity confirmed by the server. */
  server_qty: number;
  avg_cost: number;
  updated_at: ISODateTime;
}

export const MOVEMENT_TYPES = [
  'PURCHASE',
  'SALE',
  'SALE_RETURN',
  'PURCHASE_RETURN',
  'ADJUSTMENT',
  'TRANSFER_IN',
  'TRANSFER_OUT',
  'DAMAGE',
  'EXPIRED',
  'OPENING_STOCK',
] as const;
export type MovementType = (typeof MOVEMENT_TYPES)[number];

export interface InventoryMovement {
  id: string;
  business_id: string;
  store_id: string;
  product_id: string;
  variant_id: string | null;
  batch_id: string | null;
  type: MovementType;
  qty_in: number;
  qty_out: number;
  unit_cost: number;
  reference_type: string | null;
  reference_id: string | null;
  reference_no: string | null;
  notes: string | null;
  created_by: string | null;
  device_id: string | null;
  occurred_at: ISODateTime;
  /** Local only: 0 until the server confirmed the operation that created it. */
  synced?: 0 | 1;
}

export interface Customer extends BaseEntity {
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  state_code: string | null;
  pincode: string | null;
  gstin: string | null;
  credit_limit: number;
  opening_balance: number;
  tier: string | null;
  notes: string | null;
  date_of_birth: ISODate | null;
  active: boolean;
}

export type CustomerLedgerType =
  | 'opening_balance'
  | 'sale'
  | 'sale_payment'
  | 'payment'
  | 'sale_return'
  | 'refund'
  | 'adjustment'
  | 'loyalty_earn'
  | 'loyalty_redeem';

export interface CustomerLedgerEntry {
  id: string;
  business_id: string;
  customer_id: string;
  type: CustomerLedgerType;
  reference_type: string | null;
  reference_id: string | null;
  reference_no: string | null;
  debit: number;
  credit: number;
  points: number;
  notes: string | null;
  occurred_at: ISODateTime;
  created_by: string | null;
  synced?: 0 | 1;
}

export interface Supplier extends BaseEntity {
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  state_code: string | null;
  gstin: string | null;
  opening_balance: number;
  credit_days: number;
  notes: string | null;
  active: boolean;
}

export type SupplierLedgerType = 'opening_balance' | 'purchase' | 'purchase_payment' | 'payment' | 'purchase_return' | 'adjustment';

export interface SupplierLedgerEntry {
  id: string;
  business_id: string;
  supplier_id: string;
  type: SupplierLedgerType;
  reference_type: string | null;
  reference_id: string | null;
  reference_no: string | null;
  /** Payments / returns reduce what we owe. */
  debit: number;
  /** Purchases increase what we owe. */
  credit: number;
  notes: string | null;
  occurred_at: ISODateTime;
  created_by: string | null;
  synced?: 0 | 1;
}

export interface JewelleryLineDetails {
  metal: MetalType;
  purity: string;
  gross_weight: number;
  net_weight: number;
  stone_weight: number;
  rate_per_gram: number;
  making_charge_type: MakingChargeType;
  making_charge_value: number;
  wastage_type: WastageType;
  wastage_value: number;
  metal_value: number;
  making_charges: number;
  wastage_charges: number;
  stone_charges: number;
  other_charges: number;
  huid: string | null;
}

export interface SelectedModifier {
  group: string;
  option: string;
  price: number;
}

export interface TaxSnapshot {
  id: string | null;
  name: string;
  kind: TaxKind;
  rate: number;
  cess_rate: number;
  components: TaxComponentDef[] | null;
}

export interface SaleItem {
  id: string;
  product_id: string | null;
  variant_id: string | null;
  batch_id: string | null;
  serial_ids: string[];
  serial_numbers: string[];
  name: string;
  sku: string | null;
  hsn_code: string | null;
  unit_code: string | null;
  quantity: number;
  unit_price: number;
  mrp: number | null;
  cost_price: number;
  price_includes_tax: boolean;
  discount_type: DiscountType | null;
  discount_value: number | null;
  tax_rate_id: string | null;
  tax: TaxSnapshot | null;
  gross: number;
  line_discount: number;
  bill_discount: number;
  taxable: number;
  taxes: TaxAmount[];
  tax_total: number;
  total: number;
  returned_qty: number;
  modifiers: SelectedModifier[];
  jewellery: JewelleryLineDetails | null;
  warranty_months: number | null;
  kitchen_order_id: string | null;
  notes: string | null;
}

export interface OldGoldDetails {
  description: string;
  metal: MetalType;
  purity: string;
  gross_weight: number;
  stone_weight: number;
  deduction_percent: number;
  rate_per_gram: number;
  net_weight: number;
  effective_weight: number;
}

export interface SalePayment {
  id: string;
  method: PaymentMethod;
  amount: number;
  reference: string | null;
  tendered: number | null;
  change: number | null;
  old_gold: OldGoldDetails | null;
  occurred_at: ISODateTime;
}

export interface SaleCharge {
  key: string;
  name: string;
  amount: number;
  tax_rate_id: string | null;
  tax: TaxSnapshot | null;
  taxable: number;
  tax_total: number;
  total: number;
}

export type SaleDocType = 'invoice' | 'quotation' | 'estimate' | 'proforma' | 'delivery_challan';
export type SaleStatus = 'completed' | 'cancelled' | 'draft' | 'converted';
export type OrderType = 'retail' | 'dine_in' | 'takeaway' | 'delivery';

export interface Sale extends BaseEntity {
  store_id: string;
  device_id: string | null;
  register_id: string | null;
  customer_id: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  customer_gstin: string | null;
  doc_type: SaleDocType;
  status: SaleStatus;
  invoice_number: string;
  number_status: 'final' | 'provisional';
  number_block_id: string | null;
  provisional_number: string | null;
  invoice_date: ISODate;
  occurred_at: ISODateTime;
  due_date: ISODate | null;
  supply_type: SupplyType;
  place_of_supply: string | null;
  order_type: OrderType;
  table_id: string | null;
  kitchen_order_ids: string[];
  items: SaleItem[];
  payments: SalePayment[];
  charges: SaleCharge[];
  bill_discount_type: DiscountType | null;
  bill_discount_value: number | null;
  round_off_mode: RoundOffMode;
  gross_total: number;
  line_discount_total: number;
  bill_discount_total: number;
  discount_total: number;
  taxable_total: number;
  tax_total: number;
  charges_total: number;
  round_off: number;
  grand_total: number;
  paid_total: number;
  change_due: number;
  balance_due: number;
  returned_total: number;
  payment_status: 'paid' | 'partial' | 'unpaid';
  tax_breakup: TaxBreakupRow[];
  coupon_code: string | null;
  loyalty_points_earned: number;
  loyalty_points_redeemed: number;
  converted_from_id: string | null;
  converted_to_id: string | null;
  valid_until: ISODate | null;
  notes: string | null;
  created_by: string | null;
  created_by_name: string | null;
  cancelled_at: ISODateTime | null;
  cancelled_by: string | null;
  cancel_reason: string | null;
  review_flags: string[];
}

export interface SaleReturnItem {
  id: string;
  sale_item_id: string;
  product_id: string | null;
  variant_id: string | null;
  batch_id: string | null;
  serial_ids: string[];
  name: string;
  quantity: number;
  unit_price: number;
  taxable: number;
  tax_total: number;
  total: number;
  restock: boolean;
}

export type RefundMethod = 'cash' | 'upi' | 'card' | 'bank_transfer' | 'store_credit' | 'exchange';

export interface SaleReturn extends BaseEntity {
  store_id: string;
  device_id: string | null;
  register_id: string | null;
  sale_id: string;
  sale_number: string;
  customer_id: string | null;
  return_number: string;
  number_status: 'final' | 'provisional';
  return_date: ISODate;
  occurred_at: ISODateTime;
  items: SaleReturnItem[];
  taxable_total: number;
  tax_total: number;
  total: number;
  refund_method: RefundMethod;
  reason: string | null;
  created_by: string | null;
}

export interface PurchaseItem {
  id: string;
  product_id: string;
  variant_id: string | null;
  name: string;
  quantity: number;
  received_qty: number;
  returned_qty: number;
  unit_cost: number;
  mrp: number | null;
  selling_price: number | null;
  discount_type: DiscountType | null;
  discount_value: number | null;
  tax_rate_id: string | null;
  tax: TaxSnapshot | null;
  price_includes_tax: boolean;
  batch_id: string | null;
  batch_no: string | null;
  expiry_date: ISODate | null;
  mfg_date: ISODate | null;
  serial_numbers: string[];
  taxable: number;
  tax_total: number;
  total: number;
}

export interface PurchasePayment {
  id: string;
  method: PaymentMethod;
  amount: number;
  reference: string | null;
  occurred_at: ISODateTime;
}

export interface Purchase extends BaseEntity {
  store_id: string;
  device_id: string | null;
  supplier_id: string;
  supplier_name: string | null;
  doc_type: 'order' | 'invoice';
  status: 'ordered' | 'partially_received' | 'received' | 'cancelled';
  purchase_number: string;
  number_status: 'final' | 'provisional';
  supplier_invoice_no: string | null;
  purchase_date: ISODate;
  expected_date: ISODate | null;
  supply_type: SupplyType;
  items: PurchaseItem[];
  charges: SaleCharge[];
  bill_discount_type: DiscountType | null;
  bill_discount_value: number | null;
  gross_total: number;
  discount_total: number;
  taxable_total: number;
  tax_total: number;
  charges_total: number;
  round_off: number;
  grand_total: number;
  paid_total: number;
  balance_due: number;
  returned_total: number;
  payment_status: 'paid' | 'partial' | 'unpaid';
  payments: PurchasePayment[];
  notes: string | null;
  created_by: string | null;
  received_at: ISODateTime | null;
}

export interface PurchaseReturnItem {
  id: string;
  purchase_item_id: string;
  product_id: string;
  variant_id: string | null;
  batch_id: string | null;
  name: string;
  quantity: number;
  unit_cost: number;
  taxable: number;
  tax_total: number;
  total: number;
}

export interface PurchaseReturn extends BaseEntity {
  store_id: string;
  device_id: string | null;
  purchase_id: string;
  supplier_id: string;
  return_number: string;
  number_status: 'final' | 'provisional';
  return_date: ISODate;
  occurred_at: ISODateTime;
  items: PurchaseReturnItem[];
  taxable_total: number;
  tax_total: number;
  total: number;
  reason: string | null;
  created_by: string | null;
}

export type AdjustmentType = 'adjustment' | 'opening_stock' | 'damage' | 'expired';

export interface StockAdjustmentItem {
  id: string;
  product_id: string;
  variant_id: string | null;
  batch_id: string | null;
  /** Positive adds stock, negative removes stock. */
  quantity: number;
  unit_cost: number;
}

export interface StockAdjustment extends BaseEntity {
  store_id: string;
  device_id: string | null;
  type: AdjustmentType;
  reason: string | null;
  items: StockAdjustmentItem[];
  occurred_at: ISODateTime;
  created_by: string | null;
}

export interface StockTransferItem {
  id: string;
  product_id: string;
  variant_id: string | null;
  batch_id: string | null;
  quantity: number;
  unit_cost: number;
}

export interface StockTransfer extends BaseEntity {
  from_store_id: string;
  to_store_id: string;
  transfer_number: string;
  status: 'in_transit' | 'received' | 'cancelled';
  items: StockTransferItem[];
  notes: string | null;
  created_by: string | null;
  sent_at: ISODateTime;
  received_at: ISODateTime | null;
  received_by: string | null;
}

export interface CustomerPayment extends BaseEntity {
  store_id: string | null;
  device_id: string | null;
  register_id: string | null;
  customer_id: string;
  sale_id: string | null;
  receipt_number: string;
  amount: number;
  method: PaymentMethod;
  reference: string | null;
  payment_date: ISODate;
  notes: string | null;
  created_by: string | null;
}

export interface SupplierPayment extends BaseEntity {
  store_id: string | null;
  device_id: string | null;
  register_id: string | null;
  supplier_id: string;
  purchase_id: string | null;
  payment_number: string;
  amount: number;
  method: PaymentMethod;
  reference: string | null;
  payment_date: ISODate;
  notes: string | null;
  created_by: string | null;
}

export interface ExpenseCategory extends BaseEntity {
  name: string;
  active: boolean;
}

export interface Expense extends BaseEntity {
  store_id: string | null;
  device_id: string | null;
  register_id: string | null;
  category_id: string | null;
  category_name: string | null;
  expense_number: string;
  amount: number;
  payment_method: PaymentMethod;
  expense_date: ISODate;
  reference: string | null;
  notes: string | null;
  attachment_url: string | null;
  status: 'active' | 'void';
  created_by: string | null;
}

export interface CashRegister extends BaseEntity {
  store_id: string;
  device_id: string | null;
  status: 'open' | 'closed';
  opened_by: string | null;
  opened_at: ISODateTime;
  opening_cash: number;
  closed_by: string | null;
  closed_at: ISODateTime | null;
  cash_sales: number;
  cash_refunds: number;
  cash_in: number;
  cash_out: number;
  cash_expenses: number;
  expected_cash: number | null;
  closing_cash: number | null;
  difference: number | null;
  denominations: Record<string, number> | null;
  notes: string | null;
}

export interface CashTransaction extends BaseEntity {
  register_id: string;
  store_id: string;
  type: 'cash_in' | 'cash_out';
  amount: number;
  reason: string | null;
  occurred_at: ISODateTime;
  created_by: string | null;
}

export interface RestaurantTable extends BaseEntity {
  store_id: string;
  name: string;
  area: string | null;
  capacity: number;
  sort_order: number;
  active: boolean;
}

export interface KitchenOrderItem {
  id: string;
  product_id: string;
  variant_id: string | null;
  name: string;
  quantity: number;
  unit_price: number;
  modifiers: SelectedModifier[];
  notes: string | null;
}

export type KitchenStatus = 'pending' | 'preparing' | 'ready' | 'served' | 'cancelled';

export interface KitchenOrder extends BaseEntity {
  store_id: string;
  device_id: string | null;
  table_id: string | null;
  order_type: OrderType;
  kot_number: string;
  items: KitchenOrderItem[];
  status: KitchenStatus;
  is_void: boolean;
  guests: number | null;
  notes: string | null;
  sale_id: string | null;
  created_by: string | null;
  occurred_at: ISODateTime;
}

export interface MetalRate extends BaseEntity {
  metal: MetalType;
  purity: string;
  rate_per_gram: number;
  effective_from: ISODateTime;
  created_by: string | null;
}

export interface JewelleryOrder extends BaseEntity {
  store_id: string;
  order_number: string;
  type: 'repair' | 'custom';
  customer_id: string | null;
  customer_name: string;
  customer_phone: string | null;
  description: string;
  metal: MetalType | null;
  purity: string | null;
  weight: number | null;
  estimated_amount: number;
  advance_paid: number;
  advance_method: PaymentMethod | null;
  due_date: ISODate | null;
  status: 'received' | 'in_progress' | 'ready' | 'delivered' | 'cancelled';
  delivered_at: ISODateTime | null;
  sale_id: string | null;
  notes: string | null;
  created_by: string | null;
}

export interface Coupon extends BaseEntity {
  code: string;
  description: string | null;
  discount_type: DiscountType;
  discount_value: number;
  min_amount: number;
  max_discount: number | null;
  valid_from: ISODate | null;
  valid_to: ISODate | null;
  usage_limit: number | null;
  used_count: number;
  active: boolean;
}

export interface ServerNotification {
  id: string;
  business_id: string;
  type: string;
  title: string;
  body: string | null;
  severity: 'info' | 'warning' | 'critical';
  entity_type: string | null;
  entity_id: string | null;
  read_at: ISODateTime | null;
  created_at: ISODateTime;
  version: number;
  updated_at: ISODateTime;
}

export interface SyncConflictRecord {
  id: string;
  business_id: string;
  operation_id: string;
  entity_type: string;
  entity_id: string;
  conflict_type: 'field' | 'serial_double_sale' | 'deleted' | 'other';
  fields: Array<{ field: string; base: unknown; local: unknown; server: unknown }>;
  server_data: Record<string, unknown> | null;
  local_payload: Record<string, unknown> | null;
  message: string;
  status: 'open' | 'resolved';
  resolution: 'keep_local' | 'keep_server' | 'reviewed' | null;
  created_at: ISODateTime;
  resolved_at: ISODateTime | null;
  version: number;
  updated_at: ISODateTime;
}

/** Business settings stored under `settings` keys. */
export interface InvoiceSettings {
  formats: Partial<Record<string, string>>;
  terms: string;
  footer: string;
  show_hsn_summary: boolean;
  show_mrp_savings: boolean;
  round_off: RoundOffMode;
  default_doc_type: SaleDocType;
  number_block_size: number;
  quotation_validity_days: number;
  upi_id: string | null;
  bank_details: string | null;
}

export interface PosSettings {
  allow_negative_stock: boolean;
  default_customer_required: boolean;
  quick_amounts: number[];
  enabled_payment_methods: PaymentMethod[];
  print_after_sale: boolean;
  require_register: boolean;
  scale_barcode: ScaleBarcodeConfig;
  near_expiry_days: number;
  max_discount_percent: number;
  service_charge_percent: number;
  service_charge_tax_rate_id: string | null;
  shortcuts: Record<string, string>;
  product_grid: 'grid' | 'list';
}

export interface PrinterSettings {
  paper: 'a4' | '80mm' | '58mm';
  connection: 'browser';
  copies: number;
  show_logo: boolean;
  header_text: string;
  footer_text: string;
  kot_paper: '80mm' | '58mm';
}

export interface LoyaltySettings {
  enabled: boolean;
  /** Points earned per 100 currency units spent. */
  earn_per_100: number;
  /** Currency value of one point when redeemed. */
  point_value: number;
  min_redeem_points: number;
  tiers: Array<{ name: string; min_spend: number }>;
}

export interface NotificationSettings {
  low_stock: boolean;
  expiry: boolean;
  near_expiry_days: number;
  customer_dues: boolean;
  supplier_dues: boolean;
  register_mismatch: boolean;
  sync_failed: boolean;
}

export type SettingKey = 'invoice' | 'pos' | 'printer' | 'loyalty' | 'notifications' | 'appearance';
