import { useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useTranslation } from 'react-i18next';
import { PackageSearchIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { LocalProduct } from '@/lib/db/business';
import { useFormat } from '@/lib/format';
import { EmptyState } from '@/components/common/page';
import { productStock, type PosData } from './use-pos-data';

function useColumns(ref: React.RefObject<HTMLElement | null>) {
  const [width, setWidth] = useState(800);
  useEffect(() => {
    if (!ref.current) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry!.contentRect.width));
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [ref]);
  return Math.max(2, Math.floor(width / 150));
}

/** Fast client-side search over name, codes, generic names, HSN. */
export function searchProducts(products: LocalProduct[], query: string, categoryId: string | null): LocalProduct[] {
  const q = query.trim().toLowerCase();
  let list = categoryId ? products.filter((p) => p.category_id === categoryId) : products;
  if (!q) return list;
  const terms = q.split(/\s+/);
  list = list.filter((p) => (p.codes ?? []).includes(q) || terms.every((term) => (p.search ?? '').includes(term)));
  // Exact code matches first, then name prefix matches.
  return list.sort((a, b) => {
    const score = (p: LocalProduct) => ((p.codes ?? []).includes(q) ? 0 : p.name.toLowerCase().startsWith(q) ? 1 : 2);
    return score(a) - score(b) || a.name.localeCompare(b.name);
  });
}

export function ProductGrid({
  data,
  products,
  categoryId,
  onCategory,
  onPick,
}: {
  data: PosData;
  products: LocalProduct[];
  categoryId: string | null;
  onCategory: (id: string | null) => void;
  onPick: (product: LocalProduct) => void;
}) {
  const { t } = useTranslation();
  const fmt = useFormat();
  const scrollRef = useRef<HTMLDivElement>(null);
  const columns = useColumns(scrollRef);
  const rows = useMemo(() => {
    const out: LocalProduct[][] = [];
    for (let i = 0; i < products.length; i += columns) out.push(products.slice(i, i + columns));
    return out;
  }, [products, columns]);
  const virtualizer = useVirtualizer({ count: rows.length, getScrollElement: () => scrollRef.current, estimateSize: () => 118, overscan: 4 });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="scrollbar-none flex gap-2 overflow-x-auto px-3 py-2" role="tablist" aria-label={t('pos.categories', 'Categories')}>
        <button
          type="button"
          role="tab"
          aria-selected={categoryId === null}
          onClick={() => onCategory(null)}
          className={cn('shrink-0 rounded-full border px-3 py-1.5 text-sm', categoryId === null ? 'border-primary bg-primary text-primary-foreground' : 'bg-card hover:bg-muted')}
        >
          {t('pos.all', 'All')}
        </button>
        {data.categories.map((c) => (
          <button
            key={c.id}
            type="button"
            role="tab"
            aria-selected={categoryId === c.id}
            onClick={() => onCategory(c.id)}
            className={cn('shrink-0 rounded-full border px-3 py-1.5 text-sm', categoryId === c.id ? 'border-primary bg-primary text-primary-foreground' : 'bg-card hover:bg-muted')}
          >
            {c.name}
          </button>
        ))}
      </div>
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-3 pb-3" data-testid="product-grid">
        {products.length === 0 ? (
          <EmptyState icon={PackageSearchIcon} title={t('pos.no_products', 'No products found')} description={t('pos.no_products_hint', 'Try another search or scan a barcode.')} className="mt-6" />
        ) : (
          <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
            {virtualizer.getVirtualItems().map((row) => (
              <div
                key={row.key}
                className="absolute inset-x-0 grid gap-2 pb-2"
                style={{ transform: `translateY(${row.start}px)`, gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
              >
                {rows[row.index]!.map((p) => {
                  const tracked = p.track_inventory && p.product_type !== 'service';
                  const stock = tracked ? productStock(data, p.id) : null;
                  const price = p.product_type === 'jewellery' ? null : p.selling_price;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => onPick(p)}
                      data-testid="product-card"
                      className="group flex h-[110px] flex-col justify-between rounded-xl border bg-card p-3 text-left transition hover:border-primary/50 hover:shadow-sm focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none active:scale-[0.98]"
                    >
                      <span className="line-clamp-2 text-sm leading-snug font-medium">{p.name}</span>
                      <span className="flex items-end justify-between gap-1">
                        <span className="money text-sm font-semibold">{price === null ? t('pos.by_weight', 'By weight') : fmt.money(price)}</span>
                        {stock !== null ? (
                          <span className={cn('rounded px-1.5 py-0.5 text-[11px] tabular-nums', stock <= 0 ? 'bg-destructive/10 text-destructive' : stock <= p.reorder_level ? 'bg-warning/20' : 'bg-muted text-muted-foreground')}>
                            {fmt.qty(stock)}
                          </span>
                        ) : null}
                      </span>
                      {p.has_variants ? <span className="text-[11px] text-muted-foreground">{p.variants.length} {t('pos.variants', 'variants')}</span> : null}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
