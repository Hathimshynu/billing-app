import { allocateFefo, businessDate, roundQty, type ProductSerial, type ProductVariant } from '@shopdesk/shared';
import type { LocalProduct } from '@/lib/db/business';
import { lineFromProduct, type CartLine } from '@/lib/pos/cart';
import { runtime } from '@/lib/runtime';
import { productStock, type PosData } from './use-pos-data';

export type AddResult =
  | { kind: 'lines'; lines: CartLine[]; warning?: string }
  | { kind: 'needs_variant'; product: LocalProduct }
  | { kind: 'needs_serial'; product: LocalProduct; variant: ProductVariant | null }
  | { kind: 'needs_quantity'; product: LocalProduct; variant: ProductVariant | null }
  | { kind: 'error'; message: string };

export interface AddRequest {
  product: LocalProduct;
  variant?: ProductVariant | null;
  serial?: ProductSerial | null;
  quantity?: number | null;
  /** Quantity already in the cart for this product/variant (for stock checks). */
  inCart: number;
  allowNegative: boolean;
  canSellExpired: boolean;
}

/**
 * Turn "add this product" into concrete cart lines:
 *  - variants and serial/IMEI products ask the cashier to pick
 *  - weighed / decimal products ask for the quantity (unless it came from a scale label)
 *  - batch-tracked products are split across batches First-Expiry-First-Out
 *  - expired stock is never sold unless the user holds sales.sell_expired
 */
export function resolveAdd(data: PosData, request: AddRequest): AddResult {
  const { product } = request;
  const variant = request.variant ?? null;
  if (product.has_variants && product.variants.length > 0 && !variant) return { kind: 'needs_variant', product };
  if (product.track_serial && !request.serial) return { kind: 'needs_serial', product, variant };

  const unit = product.unit_id ? data.units.get(product.unit_id) : undefined;
  const allowDecimal = unit?.allow_decimal ?? product.product_type === 'weighed';
  if ((product.product_type === 'weighed' || allowDecimal) && request.quantity == null && product.product_type !== 'jewellery') {
    return { kind: 'needs_quantity', product, variant };
  }
  const quantity = request.quantity ?? 1;
  const tax = product.tax_rate_id ? data.taxes.get(product.tax_rate_id) : undefined;
  const common = { product, variant, tax: tax ?? null, unitCode: unit?.code ?? null, allowDecimal, metalRates: data.metalRates };

  if (request.serial) {
    if (request.serial.status !== 'in_stock') return { kind: 'error', message: `${request.serial.serial_no} is ${request.serial.status.replace('_', ' ')}.` };
    return { kind: 'lines', lines: [lineFromProduct({ ...common, quantity: 1, serial: request.serial })] };
  }

  const tracked = product.track_inventory && product.product_type !== 'service';
  if (tracked && product.track_batch) {
    const today = businessDate(new Date(), runtime().timezone);
    const batches = (data.batches.get(product.id) ?? []).filter((b) => (variant ? b.variant_id === variant.id || !b.variant_id : true));
    const allocation = allocateFefo(
      batches.map((b) => ({ batch_id: b.id, batch_no: b.batch_no, expiry_date: b.expiry_date, available: data.batchStock.get(b.id) ?? 0 })),
      quantity + request.inCart,
      today,
    );
    // Skip what is already in the cart: allocate the new quantity after existing lines.
    let skip = request.inCart;
    const lines: CartLine[] = [];
    for (const part of allocation.allocations) {
      const take = roundQty(Math.max(0, part.quantity - skip));
      skip = roundQty(Math.max(0, skip - part.quantity));
      if (take <= 0) continue;
      lines.push(lineFromProduct({ ...common, quantity: take, batch: batches.find((b) => b.id === part.batch_id) ?? null }));
    }
    if (allocation.shortfall > 0) {
      const expiredAvailable = batches.some((b) => b.expiry_date && b.expiry_date < today && (data.batchStock.get(b.id) ?? 0) > 0);
      if (!request.allowNegative) {
        return { kind: 'error', message: expiredAvailable && !request.canSellExpired ? `Only expired stock is left for ${product.name}. Expired medicines cannot be sold.` : `Only ${roundQty(quantity - allocation.shortfall)} of ${product.name} in stock.` };
      }
      const fallback = batches.filter((b) => !b.expiry_date || b.expiry_date >= today).sort((a, b) => (b.expiry_date ?? '').localeCompare(a.expiry_date ?? ''))[0] ?? null;
      const last = lines.find((l) => l.batch_id === fallback?.id);
      if (last) last.quantity = roundQty(last.quantity + allocation.shortfall);
      else lines.push(lineFromProduct({ ...common, quantity: allocation.shortfall, batch: fallback }));
      return { kind: 'lines', lines, warning: `${product.name}: selling beyond recorded stock.` };
    }
    return { kind: 'lines', lines };
  }

  if (tracked && !request.allowNegative) {
    const available = productStock(data, product.id, variant?.id ?? (product.has_variants ? undefined : null));
    if (available < quantity + request.inCart) return { kind: 'error', message: `Only ${Math.max(0, roundQty(available - request.inCart))} of ${product.name} in stock.` };
  }
  return { kind: 'lines', lines: [lineFromProduct({ ...common, quantity })] };
}
