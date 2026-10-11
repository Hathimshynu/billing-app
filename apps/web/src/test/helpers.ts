import { uuidv7, type Business, type TaxRate, type Unit } from '@shopdesk/shared';
import { openBusinessDb, setCurrentDb, type BusinessDb } from '@/lib/db/business';
import { setRuntime } from '@/lib/runtime';
import { createProduct } from '@/lib/repos/catalog';

export interface TestBusiness {
  database: BusinessDb;
  businessId: string;
  storeId: string;
  deviceId: string;
  userId: string;
  gst18: TaxRate;
  pcs: Unit;
}

/** A fresh, isolated business database (fake-indexeddb) with runtime, store, GST 18% and PCS unit. */
export async function setupBusiness(): Promise<TestBusiness> {
  const businessId = uuidv7();
  const storeId = uuidv7();
  const deviceId = uuidv7();
  const userId = uuidv7();
  const database = openBusinessDb(businessId);
  setCurrentDb(database);
  setRuntime({
    businessId,
    userId,
    userName: 'Test Cashier',
    deviceId,
    deviceCode: 'C1',
    storeId,
    storeCode: 'MAIN',
    timezone: 'Asia/Kolkata',
    fyStartMonth: 4,
    currency: 'INR',
    currencyDecimals: 2,
    locale: 'en-IN',
    stateCode: '32',
  });
  const now = new Date().toISOString();
  const base = { business_id: businessId, version: 1, created_at: now, updated_at: now, deleted_at: null };
  await database.business.put({ id: businessId, name: 'Test Mart', legal_name: null, business_type: 'supermarket', modules: [], country: 'IN', currency: 'INR', currency_decimals: 2, locale: 'en-IN', timezone: 'Asia/Kolkata', date_format: 'DD/MM/YYYY', tax_system: 'gst', gstin: null, state_code: '32', fy_start_month: 4, phone: null, email: null, address: null, city: null, pincode: null, logo_url: null, version: 1, created_at: now, updated_at: now } as Business);
  await database.stores.put({ id: storeId, ...base, name: 'Main', code: 'MAIN', address: null, phone: null, gstin: null, state_code: '32', is_default: true, active: true });
  const gst18: TaxRate = { id: uuidv7(), ...base, name: 'GST 18%', kind: 'gst', rate: 18, cess_rate: 0, components: null, is_default: true, active: true };
  const pcs: Unit = { id: uuidv7(), ...base, code: 'PCS', name: 'Pieces', allow_decimal: false } as Unit;
  await database.tax_rates.put(gst18);
  await database.units.put(pcs);
  return { database, businessId, storeId, deviceId, userId, gst18, pcs };
}

export async function makeProduct(env: TestBusiness, overrides: Record<string, unknown> = {}) {
  return createProduct({
    name: 'Test Soap',
    product_type: 'standard',
    sku: `SKU-${Math.random().toString(36).slice(2, 8)}`,
    barcode: null,
    barcodes: [],
    plu_code: null,
    category_id: null,
    brand_id: null,
    unit_id: env.pcs.id,
    description: null,
    hsn_code: '3401',
    purchase_price: 30,
    selling_price: 59,
    mrp: 60,
    min_selling_price: null,
    tax_rate_id: env.gst18.id,
    price_includes_tax: true,
    reorder_level: 2,
    track_inventory: true,
    track_batch: false,
    track_serial: false,
    track_expiry: false,
    has_variants: false,
    variant_attributes: [],
    variants: [],
    attributes: {},
    custom_fields: {},
    modifiers: [],
    price_tiers: [],
    warranty_months: null,
    image_url: null,
    active: true,
    ...overrides,
  });
}
