import { stockKey, type Customer, type InventoryMovement, type Product, type Sale } from '@shopdesk/shared';
import type { LocalCustomer, LocalMovement, LocalProduct, LocalSale } from './business';

const clean = (values: Array<string | null | undefined>) =>
  [...new Set(values.filter((v): v is string => !!v && v.trim() !== '').map((v) => v.trim().toLowerCase()))];

/** Adds local lookup fields: all scannable codes and a search string. */
export function deriveProduct(product: Product): LocalProduct {
  const attrs = (product.attributes ?? {}) as Record<string, unknown>;
  const codes = clean([
    product.barcode,
    product.sku,
    product.plu_code,
    ...(product.barcodes ?? []),
    ...(product.variants ?? []).flatMap((v) => [v.barcode, v.sku]),
  ]);
  const search = [
    product.name,
    product.sku,
    product.barcode,
    product.hsn_code,
    attrs.generic_name,
    attrs.manufacturer,
    attrs.brand,
    attrs.model,
    attrs.design_no,
    attrs.huid,
    ...(product.variants ?? []).map((v) => v.name),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return { ...product, codes, search };
}

export function deriveCustomer(customer: Customer): LocalCustomer {
  return {
    ...customer,
    search: [customer.name, customer.phone, customer.email, customer.gstin, customer.city].filter(Boolean).join(' ').toLowerCase(),
  };
}

export function deriveSale(sale: Sale): LocalSale {
  return { ...sale, product_ids: [...new Set(sale.items.map((i) => i.product_id).filter((id): id is string => !!id))] };
}

export function deriveMovement(movement: InventoryMovement): LocalMovement {
  return { ...movement, stock_key: stockKey(movement.store_id, movement.product_id, movement.variant_id, movement.batch_id) };
}
