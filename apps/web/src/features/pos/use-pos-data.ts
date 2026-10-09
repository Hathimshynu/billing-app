import { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import type { Category, MetalRate, ProductBatch, TaxRate, Unit } from '@shopdesk/shared';
import { db, type LocalProduct } from '@/lib/db/business';
import { runtime } from '@/lib/runtime';

export interface PosData {
  products: LocalProduct[];
  categories: Category[];
  taxes: Map<string, TaxRate>;
  units: Map<string, Unit>;
  /** product_id → variant_id|'' → qty in the current store */
  stock: Map<string, Map<string, number>>;
  batches: Map<string, ProductBatch[]>;
  /** batch_id → qty in the current store */
  batchStock: Map<string, number>;
  metalRates: MetalRate[];
  loading: boolean;
}

export function usePosData(): PosData {
  const products = useLiveQuery(() => db().products.filter((p) => p.active && !p.deleted_at).toArray(), []);
  const categories = useLiveQuery(() => db().categories.filter((c) => c.active && !c.deleted_at).sortBy('sort_order'), []);
  const taxList = useLiveQuery(() => db().tax_rates.toArray(), []);
  const unitList = useLiveQuery(() => db().units.toArray(), []);
  const levels = useLiveQuery(() => db().stock_levels.where('store_id').equals(runtime().storeId).toArray(), []);
  const batchList = useLiveQuery(() => db().product_batches.filter((b) => !b.deleted_at).toArray(), []);
  const metalRates = useLiveQuery(() => db().metal_rates.toArray(), []);

  return useMemo(() => {
    const stock = new Map<string, Map<string, number>>();
    const batchStock = new Map<string, number>();
    for (const l of levels ?? []) {
      const byVariant = stock.get(l.product_id) ?? new Map<string, number>();
      byVariant.set(l.variant_id ?? '', (byVariant.get(l.variant_id ?? '') ?? 0) + l.qty);
      stock.set(l.product_id, byVariant);
      if (l.batch_id) batchStock.set(l.batch_id, (batchStock.get(l.batch_id) ?? 0) + l.qty);
    }
    const batches = new Map<string, ProductBatch[]>();
    for (const b of batchList ?? []) batches.set(b.product_id, [...(batches.get(b.product_id) ?? []), b]);
    return {
      products: products ?? [],
      categories: categories ?? [],
      taxes: new Map((taxList ?? []).map((t) => [t.id, t])),
      units: new Map((unitList ?? []).map((u) => [u.id, u])),
      stock,
      batches,
      batchStock,
      metalRates: metalRates ?? [],
      loading: !products || !levels,
    };
  }, [products, categories, taxList, unitList, levels, batchList, metalRates]);
}

export function productStock(data: PosData, productId: string, variantId?: string | null): number {
  const byVariant = data.stock.get(productId);
  if (!byVariant) return 0;
  if (variantId !== undefined && variantId !== null) return byVariant.get(variantId) ?? 0;
  let total = 0;
  for (const qty of byVariant.values()) total += qty;
  return total;
}
