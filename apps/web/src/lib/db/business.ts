import Dexie, { type EntityTable } from 'dexie';
import type {
  Brand,
  Business,
  BusinessMember,
  CashRegister,
  CashTransaction,
  Category,
  Coupon,
  Customer,
  CustomerLedgerEntry,
  CustomerPayment,
  Device,
  Expense,
  ExpenseCategory,
  InventoryMovement,
  JewelleryOrder,
  KitchenOrder,
  MetalRate,
  NumberBlock,
  Product,
  ProductBatch,
  ProductSerial,
  Purchase,
  PurchaseReturn,
  RestaurantTable,
  Role,
  Sale,
  SaleReturn,
  ServerNotification,
  Setting,
  StockAdjustment,
  StockLevel,
  StockTransfer,
  Store,
  Supplier,
  SupplierLedgerEntry,
  SupplierPayment,
  SyncConflictRecord,
  SyncQueueItem,
  TaxRate,
  Unit,
} from '@shopdesk/shared';

/** Fields that only exist on the device. `_pending` = created/changed locally, not yet confirmed. */
export interface LocalFlags {
  _pending?: 0 | 1;
}

export type LocalProduct = Product & LocalFlags & {
  /** Lower-cased barcodes, SKUs, PLU codes of the product and its variants (multi-entry index). */
  codes?: string[];
  /** Lower-cased text used for instant search. */
  search?: string;
};
export type LocalCustomer = Customer & LocalFlags & { search?: string };
export type LocalSale = Sale & LocalFlags & { product_ids?: string[] };
export type LocalMovement = InventoryMovement & { stock_key: string };

export interface HeldSale {
  id: string;
  label: string;
  cart: unknown;
  total: number;
  item_count: number;
  created_at: string;
  created_by: string | null;
}

export interface MetaRow {
  key: string;
  value: unknown;
}

export interface LocalAttachment {
  id: string;
  entity_type: 'expense';
  entity_id: string;
  blob: Blob;
  filename: string;
  mime: string;
  uploaded: 0 | 1;
  created_at: string;
}

export class BusinessDb extends Dexie {
  meta!: EntityTable<MetaRow, 'key'>;
  business!: EntityTable<Business, 'id'>;
  stores!: EntityTable<Store, 'id'>;
  devices!: EntityTable<Device, 'id'>;
  users!: EntityTable<BusinessMember, 'id'>;
  roles!: EntityTable<Role, 'id'>;
  settings!: EntityTable<Setting, 'id'>;
  categories!: EntityTable<Category & LocalFlags, 'id'>;
  brands!: EntityTable<Brand & LocalFlags, 'id'>;
  units!: EntityTable<Unit & LocalFlags, 'id'>;
  tax_rates!: EntityTable<TaxRate & LocalFlags, 'id'>;
  products!: EntityTable<LocalProduct, 'id'>;
  product_batches!: EntityTable<ProductBatch & LocalFlags, 'id'>;
  product_serials!: EntityTable<ProductSerial & LocalFlags, 'id'>;
  stock_levels!: EntityTable<StockLevel, 'stock_key'>;
  inventory_movements!: EntityTable<LocalMovement, 'id'>;
  stock_adjustments!: EntityTable<StockAdjustment & LocalFlags, 'id'>;
  stock_transfers!: EntityTable<StockTransfer & LocalFlags, 'id'>;
  customers!: EntityTable<LocalCustomer, 'id'>;
  customer_ledger!: EntityTable<CustomerLedgerEntry, 'id'>;
  suppliers!: EntityTable<Supplier & LocalFlags, 'id'>;
  supplier_ledger!: EntityTable<SupplierLedgerEntry, 'id'>;
  sales!: EntityTable<LocalSale, 'id'>;
  sale_returns!: EntityTable<SaleReturn & LocalFlags, 'id'>;
  purchases!: EntityTable<Purchase & LocalFlags, 'id'>;
  purchase_returns!: EntityTable<PurchaseReturn & LocalFlags, 'id'>;
  customer_payments!: EntityTable<CustomerPayment & LocalFlags, 'id'>;
  supplier_payments!: EntityTable<SupplierPayment & LocalFlags, 'id'>;
  expense_categories!: EntityTable<ExpenseCategory & LocalFlags, 'id'>;
  expenses!: EntityTable<Expense & LocalFlags, 'id'>;
  cash_registers!: EntityTable<CashRegister & LocalFlags, 'id'>;
  cash_transactions!: EntityTable<CashTransaction & LocalFlags, 'id'>;
  restaurant_tables!: EntityTable<RestaurantTable & LocalFlags, 'id'>;
  kitchen_orders!: EntityTable<KitchenOrder & LocalFlags, 'id'>;
  metal_rates!: EntityTable<MetalRate & LocalFlags, 'id'>;
  jewellery_orders!: EntityTable<JewelleryOrder & LocalFlags, 'id'>;
  coupons!: EntityTable<Coupon & LocalFlags, 'id'>;
  notifications!: EntityTable<ServerNotification, 'id'>;
  sync_conflicts!: EntityTable<SyncConflictRecord, 'id'>;
  held_sales!: EntityTable<HeldSale, 'id'>;
  sync_queue!: EntityTable<SyncQueueItem, 'id'>;
  number_blocks!: EntityTable<NumberBlock, 'id'>;
  attachments!: EntityTable<LocalAttachment, 'id'>;

  constructor(businessId: string) {
    super(`shopdesk-biz-${businessId}`);
    // Schema migrations: add a new this.version(n) block; never edit a released version.
    this.version(1).stores({
      meta: '&key',
      business: '&id',
      stores: '&id',
      devices: '&id',
      users: '&id',
      roles: '&id',
      settings: '&id, &key',
      categories: '&id, name',
      brands: '&id, name',
      units: '&id, code',
      tax_rates: '&id',
      products: '&id, name, category_id, *codes, updated_at',
      product_batches: '&id, product_id, expiry_date',
      product_serials: '&id, product_id, serial_no, imei1, imei2, status, sale_id',
      stock_levels: '&stock_key, product_id, store_id, batch_id',
      inventory_movements: '&id, product_id, stock_key, reference_id, occurred_at, synced',
      stock_adjustments: '&id, occurred_at',
      stock_transfers: '&id, status',
      customers: '&id, name, phone',
      customer_ledger: '&id, customer_id, reference_id, occurred_at',
      suppliers: '&id, name, phone',
      supplier_ledger: '&id, supplier_id, reference_id, occurred_at',
      sales: '&id, invoice_number, invoice_date, occurred_at, customer_id, doc_type, status, register_id, created_by, *product_ids',
      sale_returns: '&id, sale_id, return_date, register_id',
      purchases: '&id, purchase_date, supplier_id, status, doc_type',
      purchase_returns: '&id, purchase_id, supplier_id, return_date',
      customer_payments: '&id, customer_id, payment_date, register_id',
      supplier_payments: '&id, supplier_id, payment_date, register_id',
      expense_categories: '&id, name',
      expenses: '&id, expense_date, register_id, status',
      cash_registers: '&id, status, device_id, opened_at',
      cash_transactions: '&id, register_id',
      restaurant_tables: '&id, store_id, sort_order',
      kitchen_orders: '&id, table_id, status, sale_id, occurred_at',
      metal_rates: '&id, [metal+purity], effective_from',
      jewellery_orders: '&id, status, customer_id',
      coupons: '&id, code',
      notifications: '&id, created_at',
      sync_conflicts: '&id, status, entity_id, operation_id',
      held_sales: '&id, created_at',
      sync_queue: '++id, &operation_id, status, entity_id, entity_type',
      number_blocks: '&id, document_type, period',
      attachments: '&id, entity_id, uploaded',
    });
  }
}

const cache = new Map<string, BusinessDb>();

export function openBusinessDb(businessId: string): BusinessDb {
  let db = cache.get(businessId);
  if (!db) {
    db = new BusinessDb(businessId);
    cache.set(businessId, db);
  }
  return db;
}

let current: BusinessDb | null = null;

export function setCurrentDb(db: BusinessDb | null): void {
  current = db;
}

/** The database of the business currently open in the app. */
export function db(): BusinessDb {
  if (!current) throw new Error('No business is open.');
  return current;
}

export function hasDb(): boolean {
  return current !== null;
}

export async function getMeta<T>(key: string, database: BusinessDb = db()): Promise<T | undefined> {
  return (await database.meta.get(key))?.value as T | undefined;
}

export async function setMeta(key: string, value: unknown, database: BusinessDb = db()): Promise<void> {
  await database.meta.put({ key, value });
}

/** Entity type (sync protocol) → table name. */
export const ENTITY_TABLES = {
  business: 'business',
  store: 'stores',
  device: 'devices',
  user: 'users',
  role: 'roles',
  setting: 'settings',
  category: 'categories',
  brand: 'brands',
  unit: 'units',
  tax_rate: 'tax_rates',
  product: 'products',
  product_batch: 'product_batches',
  product_serial: 'product_serials',
  stock_level: 'stock_levels',
  inventory_movement: 'inventory_movements',
  stock_adjustment: 'stock_adjustments',
  stock_transfer: 'stock_transfers',
  customer: 'customers',
  customer_ledger_entry: 'customer_ledger',
  supplier: 'suppliers',
  supplier_ledger_entry: 'supplier_ledger',
  sale: 'sales',
  sale_return: 'sale_returns',
  purchase: 'purchases',
  purchase_return: 'purchase_returns',
  customer_payment: 'customer_payments',
  supplier_payment: 'supplier_payments',
  expense_category: 'expense_categories',
  expense: 'expenses',
  cash_register: 'cash_registers',
  cash_transaction: 'cash_transactions',
  restaurant_table: 'restaurant_tables',
  kitchen_order: 'kitchen_orders',
  metal_rate: 'metal_rates',
  jewellery_order: 'jewellery_orders',
  coupon: 'coupons',
  notification: 'notifications',
  sync_conflict: 'sync_conflicts',
} as const;

export type EntityTableName = (typeof ENTITY_TABLES)[keyof typeof ENTITY_TABLES];

/** Every table holding synchronized data (used by transactions that apply server changes). */
export const SYNCED_TABLES: EntityTableName[] = Object.values(ENTITY_TABLES);
