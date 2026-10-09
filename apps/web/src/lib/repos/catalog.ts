import {
  normalizeBarcode,
  parseScaleBarcode,
  uuidv7,
  type Brand,
  type Category,
  type Coupon,
  type CouponInput,
  type Product,
  type ProductBatch,
  type ProductInput,
  type ProductSerial,
  type ProductVariant,
  type ScaleBarcodeConfig,
  type TaxRate,
  type Unit,
} from '@shopdesk/shared';
import { apiData, getApiContext } from '../api';
import { db, type LocalProduct } from '../db/business';
import { deriveProduct } from '../db/derive';
import { createEntity, deleteEntity, newEntityBase, toPayload, updateEntity } from './base';
import { useSyncStore } from '../sync/store';
import { diffEntity, enqueue, mutate } from '../sync/outbox';

export const PRODUCT_FIELDS = [
  'name', 'product_type', 'sku', 'barcode', 'plu_code', 'category_id', 'brand_id', 'unit_id', 'description', 'hsn_code',
  'purchase_price', 'selling_price', 'mrp', 'min_selling_price', 'tax_rate_id', 'price_includes_tax', 'reorder_level',
  'track_inventory', 'track_batch', 'track_serial', 'track_expiry', 'has_variants', 'variant_attributes', 'attributes',
  'custom_fields', 'modifiers', 'warranty_months', 'active', 'variants', 'barcodes', 'price_tiers',
] as const;

export async function createProduct(input: ProductInput, id: string = uuidv7()): Promise<LocalProduct> {
  const product = deriveProduct({
    ...newEntityBase(id),
    ...input,
    image_url: input.image_url ?? null,
    variants: input.variants.map((v) => ({ ...v, product_id: id })),
  } as Product);
  const payload = toPayload({ ...input, variants: product.variants } as Record<string, unknown>, ['image_url']);
  return createEntity(db().products, 'CREATE_PRODUCT', { ...product, _pending: 1 }, payload);
}

export async function updateProduct(id: string, input: Partial<ProductInput>): Promise<void> {
  const patch = { ...input } as Partial<Product>;
  if (input.variants) patch.variants = input.variants.map((v) => ({ ...v, product_id: id })) as ProductVariant[];
  await mutate([db().products], async () => {
    const current = await db().products.get(id);
    if (!current) throw new Error('Product not found');
    const { changes, base } = diffEntity(current as unknown as Record<string, unknown>, patch as Record<string, unknown>, PRODUCT_FIELDS);
    if (Object.keys(changes).length === 0) return;
    const next = deriveProduct({ ...current, ...changes, updated_at: new Date().toISOString() } as Product);
    await db().products.put({ ...next, _pending: 1 });
    await enqueue({ operation: 'UPDATE_PRODUCT', entity_id: id, payload: { changes, base }, base_version: current.version });
  });
}

export const deleteProduct = (id: string) => deleteEntity(db().products, 'DELETE_PRODUCT', id);

export async function createCategory(input: Pick<Category, 'name' | 'parent_id' | 'color' | 'sort_order' | 'active'>): Promise<Category> {
  return createEntity(db().categories, 'CREATE_CATEGORY', { ...newEntityBase(), ...input } as Category);
}
export const updateCategory = (id: string, patch: Partial<Category>) =>
  updateEntity<Category>(db().categories, 'UPDATE_CATEGORY', id, patch, ['name', 'parent_id', 'color', 'sort_order', 'active']);
export const deleteCategory = (id: string) => deleteEntity(db().categories, 'DELETE_CATEGORY', id);

export const createBrand = (input: Pick<Brand, 'name' | 'active'>) =>
  createEntity(db().brands, 'CREATE_BRAND', { ...newEntityBase(), ...input } as Brand);
export const updateBrand = (id: string, patch: Partial<Brand>) => updateEntity<Brand>(db().brands, 'UPDATE_BRAND', id, patch, ['name', 'active']);
export const deleteBrand = (id: string) => deleteEntity(db().brands, 'DELETE_BRAND', id);

export const createUnit = (input: Pick<Unit, 'code' | 'name' | 'allow_decimal'>) =>
  createEntity(db().units, 'CREATE_UNIT', { ...newEntityBase(), ...input } as Unit);
export const updateUnit = (id: string, patch: Partial<Unit>) => updateEntity<Unit>(db().units, 'UPDATE_UNIT', id, patch, ['code', 'name', 'allow_decimal']);
export const deleteUnit = (id: string) => deleteEntity(db().units, 'DELETE_UNIT', id);

export type TaxRateInput = Pick<TaxRate, 'name' | 'kind' | 'rate' | 'cess_rate' | 'components' | 'is_default' | 'active'>;
export async function createTaxRate(input: TaxRateInput): Promise<TaxRate> {
  const rate = await createEntity(db().tax_rates, 'CREATE_TAX_RATE', { ...newEntityBase(), ...input } as TaxRate);
  if (input.is_default) await unsetOtherDefaults(rate.id);
  return rate;
}
export async function updateTaxRate(id: string, patch: Partial<TaxRate>) {
  await updateEntity<TaxRate>(db().tax_rates, 'UPDATE_TAX_RATE', id, patch, ['name', 'kind', 'rate', 'cess_rate', 'components', 'is_default', 'active']);
  if (patch.is_default) await unsetOtherDefaults(id);
}
async function unsetOtherDefaults(id: string) {
  // The server clears other defaults itself; mirror it locally for immediate UI feedback.
  await db().tax_rates.where('id').notEqual(id).modify((t) => {
    if (t.is_default) t.is_default = false;
  });
}
export const deleteTaxRate = (id: string) => deleteEntity(db().tax_rates, 'DELETE_TAX_RATE', id);

export async function createBatch(input: Pick<ProductBatch, 'product_id' | 'variant_id' | 'batch_no' | 'expiry_date' | 'mfg_date' | 'mrp' | 'purchase_price' | 'selling_price'>): Promise<ProductBatch> {
  return createEntity(db().product_batches, 'CREATE_PRODUCT_BATCH', { ...newEntityBase(), ...input } as ProductBatch);
}

export interface CodeMatch {
  product: LocalProduct;
  variant: ProductVariant | null;
  serial: ProductSerial | null;
  /** Quantity embedded in a weighing-scale label (weight, or derived from price). */
  quantity: number | null;
}

/**
 * Resolve a scanned/typed code: scale label → product/variant barcode, SKU, PLU → serial / IMEI.
 * Always IndexedDB first; the server is only asked (when online) if nothing matches locally.
 */
export async function findByCode(raw: string, scale?: ScaleBarcodeConfig): Promise<CodeMatch | null> {
  const code = normalizeBarcode(raw);
  if (!code) return null;
  const database = db();

  if (scale?.enabled) {
    const parsed = parseScaleBarcode(code, scale);
    if (parsed) {
      const product = await database.products.where('codes').equals(parsed.item_code.toLowerCase()).first()
        ?? (await database.products.where('codes').equals(String(Number(parsed.item_code))).first());
      if (product && !product.deleted_at) {
        const quantity = parsed.value_type === 'weight'
          ? parsed.value
          : product.selling_price > 0 ? Math.round((parsed.value / product.selling_price) * 1000) / 1000 : 1;
        return { product, variant: null, serial: null, quantity };
      }
    }
  }

  const lower = code.toLowerCase();
  const product = await database.products.where('codes').equals(lower).filter((p) => !p.deleted_at).first();
  if (product) {
    const variant = product.variants.find((v) => v.barcode?.toLowerCase() === lower || v.sku?.toLowerCase() === lower) ?? null;
    return { product, variant, serial: null, quantity: null };
  }

  const serial =
    (await database.product_serials.where('serial_no').equals(code).first()) ??
    (await database.product_serials.where('imei1').equals(code).first()) ??
    (await database.product_serials.where('imei2').equals(code).first());
  if (serial) {
    const owner = await database.products.get(serial.product_id);
    if (owner) {
      return { product: owner, variant: owner.variants.find((v) => v.id === serial.variant_id) ?? null, serial, quantity: 1 };
    }
  }

  // Server fallback (never blocks: short timeout, only when online and signed in).
  if (useSyncStore.getState().online && getApiContext().token) {
    try {
      const result = await apiData<Product[]>('/products', { query: { search: code, per_page: 1 }, timeoutMs: 3000 });
      const remote = result[0];
      if (remote) {
        const local = deriveProduct(remote);
        await database.products.put(local);
        return { product: local, variant: local.variants.find((v) => v.barcode === code) ?? null, serial: null, quantity: null };
      }
    } catch {
      // offline or slow: local miss stands
    }
  }
  return null;
}

/** Add an extra barcode to a product (e.g. scanned unknown code assigned at POS). */
export async function addBarcode(productId: string, code: string): Promise<void> {
  const product = await db().products.get(productId);
  if (!product) return;
  await updateProduct(productId, { barcodes: [...new Set([...(product.barcodes ?? []), code])] });
}

export const COUPON_FIELDS = ['code', 'description', 'discount_type', 'discount_value', 'min_amount', 'max_discount', 'valid_from', 'valid_to', 'usage_limit', 'active'] as const;

export async function createCoupon(input: CouponInput): Promise<Coupon> {
  const existing = await db().coupons.where('code').equals(input.code).filter((c) => !c.deleted_at).count();
  if (existing) throw new Error(`Coupon ${input.code} already exists.`);
  return createEntity(db().coupons, 'CREATE_COUPON', { ...newEntityBase(), ...input, used_count: 0 } as Coupon);
}

export const updateCoupon = (id: string, patch: Partial<Coupon>) => updateEntity<Coupon>(db().coupons, 'UPDATE_COUPON', id, patch, COUPON_FIELDS);
