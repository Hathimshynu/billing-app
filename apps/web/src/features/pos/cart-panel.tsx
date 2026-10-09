import { useTranslation } from 'react-i18next';
import { MinusIcon, PauseIcon, PercentIcon, PlusIcon, ShoppingBagIcon, Trash2Icon, UserIcon, XIcon } from 'lucide-react';
import type { PricingResult } from '@shopdesk/shared';
import { cn } from '@/lib/utils';
import { useFormat } from '@/lib/format';
import { effectiveUnitPrice, type CartLine } from '@/lib/pos/cart';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Kbd } from '@/components/ui/kbd';
import { usePos } from './pos-store';

export function CartPanel({
  pricing,
  onPay,
  onHold,
  onCustomer,
  onDiscount,
  onEditLine,
  payLabel,
  className,
}: {
  pricing: PricingResult;
  onPay: () => void;
  onHold: () => void;
  onCustomer: () => void;
  onDiscount: () => void;
  onEditLine: (line: CartLine) => void;
  payLabel: string;
  className?: string;
}) {
  const { t } = useTranslation();
  const fmt = useFormat();
  const { lines, selectedKey, select, increment, removeLine, customer_name, customer_phone, setCustomer, clear, doc_type } = usePos();
  const allInclusive = lines.length > 0 && lines.every((l) => l.price_includes_tax);

  return (
    <aside className={cn('flex min-h-0 flex-col bg-card', className)} aria-label={t('pos.cart', 'Cart')}>
      <div className="flex items-center gap-2 border-b p-3">
        <Button variant="outline" className="h-9 flex-1 justify-start gap-2" onClick={onCustomer} data-testid="customer-button">
          <UserIcon />
          <span className="truncate">{customer_name ? `${customer_name}${customer_phone ? ` · ${customer_phone}` : ''}` : t('pos.walk_in', 'Walk-in customer')}</span>
          <Kbd className="ml-auto hidden lg:inline-flex">F4</Kbd>
        </Button>
        {customer_name ? (
          <Button variant="ghost" size="icon" onClick={() => setCustomer(null)} aria-label={t('pos.remove_customer', 'Remove customer')}>
            <XIcon />
          </Button>
        ) : null}
        {lines.length ? (
          <Button variant="ghost" size="icon" onClick={clear} aria-label={t('pos.clear_cart', 'Clear cart')}>
            <Trash2Icon />
          </Button>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto" data-testid="cart-lines">
        {lines.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center text-muted-foreground">
            <ShoppingBagIcon className="size-10 opacity-40" />
            <p className="text-sm font-medium">{t('pos.cart_empty', 'Cart is empty')}</p>
            <p className="text-xs">{t('pos.cart_empty_hint', 'Scan a barcode or tap a product to start billing.')}</p>
          </div>
        ) : (
          <ul className="divide-y">
            {lines.map((line, index) => {
              const calc = pricing.lines[index];
              return (
                <li
                  key={line.key}
                  className={cn('group cursor-pointer px-3 py-2.5', selectedKey === line.key && 'bg-accent/60')}
                  onClick={() => select(line.key)}
                  onDoubleClick={() => onEditLine(line)}
                  data-testid="cart-line"
                >
                  <div className="flex items-start justify-between gap-2">
                    <button type="button" className="min-w-0 text-left" onClick={() => onEditLine(line)}>
                      <span className="block truncate text-sm font-medium">{line.name}</span>
                      <span className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                        <span className="money">
                          {fmt.money(effectiveUnitPrice(line))}
                          {line.unit_code ? ` / ${line.unit_code}` : ''}
                        </span>
                        {line.mrp && line.mrp > effectiveUnitPrice(line) ? <span className="line-through">{fmt.money(line.mrp)}</span> : null}
                        {line.batch_no ? <Badge variant="outline" className="h-4 px-1 text-[10px]">B: {line.batch_no}{line.expiry_date ? ` · ${line.expiry_date.slice(0, 7)}` : ''}</Badge> : null}
                        {line.serial_numbers.length ? <Badge variant="outline" className="h-4 px-1 text-[10px]">{line.serial_numbers.join(', ')}</Badge> : null}
                        {line.prescription_required ? <Badge variant="destructive" className="h-4 px-1 text-[10px]">Rx</Badge> : null}
                        {line.discount_value ? <Badge variant="secondary" className="h-4 px-1 text-[10px]">-{line.discount_type === 'percent' ? `${line.discount_value}%` : fmt.money(line.discount_value)}</Badge> : null}
                        {line.kitchen_order_id ? <Badge variant="secondary" className="h-4 px-1 text-[10px]">KOT</Badge> : null}
                      </span>
                      {line.modifiers.length ? <span className="block truncate text-xs text-muted-foreground">+ {line.modifiers.map((m) => m.option).join(', ')}</span> : null}
                    </button>
                    <span className="money shrink-0 text-sm font-semibold">{fmt.money(calc?.total ?? 0)}</span>
                  </div>
                  <div className="mt-1.5 flex items-center justify-between">
                    <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                      <Button
                        variant="outline"
                        size="icon-sm"
                        onClick={() => increment(line.key, -1)}
                        disabled={line.serial_ids.length > 0 || !!line.jewellery || !!line.kitchen_order_id}
                        aria-label={t('pos.decrease', 'Decrease quantity')}
                      >
                        <MinusIcon />
                      </Button>
                      <span className="min-w-12 text-center text-sm font-medium tabular-nums" data-testid="line-qty">
                        {fmt.qty(line.quantity)}
                      </span>
                      <Button
                        variant="outline"
                        size="icon-sm"
                        onClick={() => increment(line.key, 1)}
                        disabled={line.serial_ids.length > 0 || !!line.jewellery || !!line.kitchen_order_id}
                        aria-label={t('pos.increase', 'Increase quantity')}
                      >
                        <PlusIcon />
                      </Button>
                    </div>
                    <Button variant="ghost" size="icon-sm" className="opacity-60 group-hover:opacity-100" onClick={(e) => { e.stopPropagation(); removeLine(line.key); }} aria-label={t('pos.remove_item', 'Remove item')} disabled={!!line.kitchen_order_id}>
                      <Trash2Icon />
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="border-t p-3">
        <dl className="space-y-1 text-sm" data-testid="cart-totals">
          <div className="flex justify-between text-muted-foreground">
            <dt>
              {t('pos.subtotal', 'Subtotal')} ({pricing.item_count} {t('pos.items', 'items')})
            </dt>
            <dd className="money">{fmt.money(pricing.gross_total)}</dd>
          </div>
          <div className="flex justify-between text-muted-foreground">
            <dt>
              <button type="button" className="inline-flex items-center gap-1 hover:text-foreground" onClick={onDiscount}>
                <PercentIcon className="size-3.5" /> {t('pos.discount', 'Discount')}
              </button>
            </dt>
            <dd className="money">{pricing.discount_total ? `-${fmt.money(pricing.discount_total)}` : fmt.money(0)}</dd>
          </div>
          <div className="flex justify-between text-muted-foreground">
            <dt>
              {t('pos.tax', 'Tax')} {allInclusive ? t('pos.tax_included', '(incl.)') : ''}
            </dt>
            <dd className="money">{fmt.money(pricing.tax_total)}</dd>
          </div>
          {pricing.charges_total ? (
            <div className="flex justify-between text-muted-foreground">
              <dt>{t('pos.charges', 'Charges')}</dt>
              <dd className="money">{fmt.money(pricing.charges_total)}</dd>
            </div>
          ) : null}
          {pricing.round_off ? (
            <div className="flex justify-between text-muted-foreground">
              <dt>{t('pos.round_off', 'Round off')}</dt>
              <dd className="money">{fmt.money(pricing.round_off)}</dd>
            </div>
          ) : null}
          <div className="flex items-baseline justify-between pt-1">
            <dt className="text-base font-semibold">{t('pos.total', 'TOTAL')}</dt>
            <dd className="money text-2xl font-bold tracking-tight" data-testid="cart-total">
              {fmt.money(pricing.grand_total)}
            </dd>
          </div>
        </dl>
        <div className="mt-3 grid grid-cols-[auto_1fr] gap-2">
          <Button variant="outline" size="lg" className="h-12" onClick={onHold} disabled={lines.length === 0} aria-label={t('pos.hold', 'Hold')}>
            <PauseIcon /> <span className="hidden sm:inline">{t('pos.hold', 'Hold')}</span> <Kbd className="hidden lg:inline-flex">F9</Kbd>
          </Button>
          <Button size="lg" className="h-12 bg-success text-base font-semibold text-success-foreground hover:bg-success/90" onClick={onPay} disabled={lines.length === 0} data-testid="pay-button">
            {payLabel} · {fmt.money(pricing.grand_total)} <Kbd className="hidden bg-black/15 text-inherit lg:inline-flex">F8</Kbd>
          </Button>
        </div>
        {doc_type !== 'invoice' ? <p className="mt-2 text-center text-xs text-muted-foreground">{t('pos.non_invoice_hint', 'This document does not change stock or accounts.')}</p> : null}
      </div>
    </aside>
  );
}
