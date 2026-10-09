import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLiveQuery } from 'dexie-react-hooks';
import { toast } from 'sonner';
import { SearchIcon } from 'lucide-react';
import type { ProductVariant } from '@shopdesk/shared';
import { cn } from '@/lib/utils';
import { db, type LocalProduct } from '@/lib/db/business';
import { findByCode } from '@/lib/repos/catalog';
import { Input } from '@/components/ui/input';

export interface ProductPick {
  product: LocalProduct;
  variant: ProductVariant | null;
}

/**
 * Search box for back-office forms (purchases, stock adjustments, transfers). Typing searches names;
 * Enter on a scanned barcode adds the exact product (or variant) directly.
 */
export function ProductSearch({ onPick, placeholder, filter, className, autoFocus }: { onPick: (pick: ProductPick) => void; placeholder?: string; filter?: (p: LocalProduct) => boolean; className?: string; autoFocus?: boolean }) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);

  const results = useLiveQuery(async () => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const terms = q.split(/\s+/);
    return db()
      .products.filter((p) => !p.deleted_at && (filter ? filter(p) : true) && ((p.codes ?? []).includes(q) || terms.every((term) => (p.search ?? p.name.toLowerCase()).includes(term))))
      .limit(30)
      .toArray();
  }, [query]);

  // Expand variants into separate options so the user picks exactly what they mean.
  const options: ProductPick[] = (results ?? []).flatMap((p): ProductPick[] => (p.has_variants && p.variants.length ? p.variants.filter((v) => v.active).map((v) => ({ product: p, variant: v })) : [{ product: p, variant: null }])).slice(0, 40);

  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const pick = (option: ProductPick) => {
    onPick(option);
    setQuery('');
    setOpen(false);
  };

  return (
    <div ref={boxRef} className={cn('relative', className)}>
      <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={query}
        autoFocus={autoFocus}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder={placeholder ?? t('product.search_scan', 'Search or scan a product')}
        className="pl-8"
        data-testid="product-search"
        role="combobox"
        aria-expanded={open && options.length > 0}
        onKeyDown={async (e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive((a) => Math.min(a + 1, options.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === 'Escape') {
            setOpen(false);
          } else if (e.key === 'Enter') {
            e.preventDefault();
            const text = query.trim();
            if (!text) return;
            const match = await findByCode(text);
            if (match && (!filter || filter(match.product))) return pick({ product: match.product, variant: match.variant });
            if (options[active]) return pick(options[active]!);
            toast.error(t('pos.not_found', 'No product matches “{{text}}”.', { text }));
          }
        }}
      />
      {open && options.length > 0 ? (
        <ul className="absolute z-50 mt-1 max-h-72 w-full overflow-y-auto rounded-lg border bg-popover p-1 shadow-lg" role="listbox">
          {options.map((o, i) => (
            <li key={`${o.product.id}-${o.variant?.id ?? ''}`} role="option" aria-selected={i === active}>
              <button
                type="button"
                className={cn('flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm', i === active ? 'bg-accent' : 'hover:bg-muted')}
                onMouseEnter={() => setActive(i)}
                onClick={() => pick(o)}
              >
                <span className="min-w-0">
                  <span className="block truncate">
                    {o.product.name}
                    {o.variant ? ` (${o.variant.name})` : ''}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">{[o.variant?.sku ?? o.product.sku, o.variant?.barcode ?? o.product.barcode].filter(Boolean).join(' · ')}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
