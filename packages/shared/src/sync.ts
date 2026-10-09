/**
 * Synchronization contract shared by the web client and the Laravel API.
 *
 * Every local mutation is written to IndexedDB together with an operation in the `sync_queue`
 * outbox (same IndexedDB transaction). The sync engine pushes operations in order to
 * POST /api/v1/sync/push; the server applies each one idempotently (operation_id is the
 * idempotency key) and records the resulting entity changes in a per-business change log, which
 * devices read incrementally through POST /api/v1/sync/pull using a cursor.
 */

export const SYNC_ENTITY_TYPES = [
  'business',
  'store',
  'device',
  'user',
  'role',
  'setting',
  'category',
  'brand',
  'unit',
  'tax_rate',
  'product',
  'product_batch',
  'product_serial',
  'stock_level',
  'inventory_movement',
  'stock_adjustment',
  'stock_transfer',
  'customer',
  'customer_ledger_entry',
  'supplier',
  'supplier_ledger_entry',
  'sale',
  'sale_return',
  'purchase',
  'purchase_return',
  'customer_payment',
  'supplier_payment',
  'expense_category',
  'expense',
  'cash_register',
  'cash_transaction',
  'restaurant_table',
  'kitchen_order',
  'metal_rate',
  'jewellery_order',
  'coupon',
  'notification',
  'sync_conflict',
] as const;
export type SyncEntityType = (typeof SYNC_ENTITY_TYPES)[number];

/** Operations a device may push. Server-managed entities (users, roles, stock levels...) are pull-only. */
export const SYNC_OPERATIONS = {
  CREATE_CATEGORY: 'category',
  UPDATE_CATEGORY: 'category',
  DELETE_CATEGORY: 'category',
  CREATE_BRAND: 'brand',
  UPDATE_BRAND: 'brand',
  DELETE_BRAND: 'brand',
  CREATE_UNIT: 'unit',
  UPDATE_UNIT: 'unit',
  DELETE_UNIT: 'unit',
  CREATE_TAX_RATE: 'tax_rate',
  UPDATE_TAX_RATE: 'tax_rate',
  DELETE_TAX_RATE: 'tax_rate',
  CREATE_PRODUCT: 'product',
  UPDATE_PRODUCT: 'product',
  DELETE_PRODUCT: 'product',
  CREATE_PRODUCT_BATCH: 'product_batch',
  UPDATE_PRODUCT_BATCH: 'product_batch',
  CREATE_CUSTOMER: 'customer',
  UPDATE_CUSTOMER: 'customer',
  DELETE_CUSTOMER: 'customer',
  CREATE_SUPPLIER: 'supplier',
  UPDATE_SUPPLIER: 'supplier',
  DELETE_SUPPLIER: 'supplier',
  CREATE_SALE: 'sale',
  UPDATE_QUOTATION: 'sale',
  CANCEL_SALE: 'sale',
  CREATE_SALE_RETURN: 'sale_return',
  CREATE_PURCHASE: 'purchase',
  RECEIVE_PURCHASE: 'purchase',
  CANCEL_PURCHASE: 'purchase',
  CREATE_PURCHASE_RETURN: 'purchase_return',
  CREATE_STOCK_ADJUSTMENT: 'stock_adjustment',
  CREATE_STOCK_TRANSFER: 'stock_transfer',
  RECEIVE_STOCK_TRANSFER: 'stock_transfer',
  CREATE_CUSTOMER_PAYMENT: 'customer_payment',
  CREATE_SUPPLIER_PAYMENT: 'supplier_payment',
  CREATE_EXPENSE_CATEGORY: 'expense_category',
  UPDATE_EXPENSE_CATEGORY: 'expense_category',
  DELETE_EXPENSE_CATEGORY: 'expense_category',
  CREATE_EXPENSE: 'expense',
  VOID_EXPENSE: 'expense',
  OPEN_CASH_REGISTER: 'cash_register',
  CLOSE_CASH_REGISTER: 'cash_register',
  CREATE_CASH_TRANSACTION: 'cash_transaction',
  CREATE_RESTAURANT_TABLE: 'restaurant_table',
  UPDATE_RESTAURANT_TABLE: 'restaurant_table',
  DELETE_RESTAURANT_TABLE: 'restaurant_table',
  CREATE_KITCHEN_ORDER: 'kitchen_order',
  UPDATE_KITCHEN_ORDER_STATUS: 'kitchen_order',
  CREATE_METAL_RATE: 'metal_rate',
  CREATE_JEWELLERY_ORDER: 'jewellery_order',
  UPDATE_JEWELLERY_ORDER: 'jewellery_order',
  CREATE_COUPON: 'coupon',
  UPDATE_COUPON: 'coupon',
  UPDATE_SETTING: 'setting',
  RESOLVE_CONFLICT: 'sync_conflict',
} as const satisfies Record<string, SyncEntityType>;

export type SyncOperationName = keyof typeof SYNC_OPERATIONS;

export type SyncStatus = 'pending' | 'syncing' | 'synced' | 'failed' | 'conflict';

export interface SyncQueueItem {
  /** Local auto-increment id; defines push order. */
  id?: number;
  operation_id: string;
  entity_type: SyncEntityType;
  entity_id: string;
  operation: SyncOperationName;
  payload: Record<string, unknown>;
  base_version: number | null;
  created_at: string;
  updated_at: string;
  retry_count: number;
  status: SyncStatus;
  device_id: string;
  user_id: string;
  last_error: string | null;
  /** Epoch ms before which the op should not be retried (exponential backoff). */
  next_attempt_at: number | null;
}

export interface PushOperation {
  operation_id: string;
  entity_type: SyncEntityType;
  entity_id: string;
  operation: SyncOperationName;
  payload: Record<string, unknown>;
  base_version: number | null;
  created_at: string;
  user_id: string;
}

export interface PushRequest {
  device_id: string;
  operations: PushOperation[];
}

export interface AcceptedOperation {
  operation_id: string;
  entity_type: SyncEntityType;
  entity_id: string;
  duplicate: boolean;
  result: Record<string, unknown> | null;
}

export interface RejectedOperation {
  operation_id: string;
  code: string;
  message: string;
  errors: Record<string, string[]> | null;
  /** Transient failures (e.g. a dependency not yet synced) are retried automatically. */
  retryable: boolean;
}

export interface ConflictField {
  field: string;
  base: unknown;
  local: unknown;
  server: unknown;
}

export interface ConflictOperation {
  operation_id: string;
  conflict_id: string;
  entity_type: SyncEntityType;
  entity_id: string;
  conflict_type: 'field' | 'serial_double_sale' | 'deleted' | 'other';
  fields: ConflictField[];
  server_version: number;
  server_data: Record<string, unknown> | null;
  message: string;
}

export interface SyncChange {
  seq: number;
  entity_type: SyncEntityType;
  entity_id: string;
  action: 'upsert' | 'delete';
  data: Record<string, unknown> | null;
}

export interface PushResponse {
  success: true;
  accepted: AcceptedOperation[];
  rejected: RejectedOperation[];
  conflicts: ConflictOperation[];
  server_changes: SyncChange[];
}

export interface PullRequest {
  device_id: string;
  cursor: number | null;
  limit?: number;
}

export interface PullResponse {
  success: true;
  changes: SyncChange[];
  cursor: number;
  has_more: boolean;
  server_time: string;
}

export interface NumberBlock {
  id: string;
  document_type: string;
  period: string;
  format: string;
  start_number: number;
  end_number: number;
  next_number: number;
  device_code: string | null;
}

/** Exponential backoff with full jitter: 2s, 4s, 8s ... capped at 5 minutes. */
export function backoffDelay(attempt: number, baseMs = 2000, maxMs = 300_000, random = Math.random): number {
  const exp = Math.min(maxMs, baseMs * 2 ** Math.max(0, attempt));
  return Math.round(exp / 2 + random() * (exp / 2));
}

/** Which push operations represent money/stock movements that must never be silently discarded. */
export const FINANCIAL_OPERATIONS: SyncOperationName[] = [
  'CREATE_SALE',
  'CANCEL_SALE',
  'CREATE_SALE_RETURN',
  'CREATE_PURCHASE',
  'RECEIVE_PURCHASE',
  'CREATE_PURCHASE_RETURN',
  'CREATE_CUSTOMER_PAYMENT',
  'CREATE_SUPPLIER_PAYMENT',
  'CREATE_EXPENSE',
  'OPEN_CASH_REGISTER',
  'CLOSE_CASH_REGISTER',
  'CREATE_CASH_TRANSACTION',
  'CREATE_STOCK_ADJUSTMENT',
  'CREATE_STOCK_TRANSFER',
];
