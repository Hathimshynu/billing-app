import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLiveQuery } from 'dexie-react-hooks';
import { toast } from 'sonner';
import { DeleteIcon, PauseIcon, PlayIcon, SearchIcon, Trash2Icon } from 'lucide-react';
import {
  businessDate,
  calculateJewelleryPrice,
  normalizeBarcode,
  percentOf,
  roundQty,
  roundTo,
  type Coupon,
  type DiscountType,
  type ProductSerial,
  type ProductVariant,
  type SelectedModifier,
} from '@shopdesk/shared';
import { cn } from '@/lib/utils';
import { db, type LocalProduct } from '@/lib/db/business';
import { useFormat } from '@/lib/format';
import { runtime } from '@/lib/runtime';
import { effectiveUnitPrice, type CartLine, type CartState } from '@/lib/pos/cart';
import { deleteHeldSale, takeHeldSale } from '@/lib/repos/sales';
import { useCan } from '@/hooks/use-app';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { NumberInput } from '@/components/common/number-input';
import { ResponsiveDialog } from '@/components/common/responsive-dialog';
import { confirm } from '@/components/common/confirm';
import { productStock, type PosData } from './use-pos-data';
import { usePos } from './pos-store';

/* ------------------------------------------------------------------ Variant */

export function VariantPicker({ product, data, onPick, onClose }: { product: LocalProduct | null; data: PosData; onPick: (variant: ProductVariant) => void; onClose: () => void }) {
  const { t } = useTranslation();
  const fmt = useFormat();
  const variants = (product?.variants ?? []).filter((v) => v.active);
  const tracked = product ? product.track_inventory && product.product_type !== 'service' : false;
  // Group by first attribute (e.g. colour) to keep large size/colour matrices scannable.
  const groupBy = product?.variant_attributes[0]?.name;
  const groups = useMemo(() => {
    const map = new Map<string, ProductVariant[]>();
    for (const v of variants) {
      const key = groupBy ? (v.attributes[groupBy] ?? '') : '';
      map.set(key, [...(map.get(key) ?? []), v]);
    }
    return [...map.entries()];
  }, [variants, groupBy]);

  return (
    <ResponsiveDialog open={!!product} onOpenChange={(o) => !o && onClose()} title={product?.name ?? ''} description={t('pos.choose_variant', 'Choose a variant')} size="lg">
      <div className="space-y-4">
        {groups.map(([group, list]) => (
          <div key={group} className="space-y-2">
            {group ? <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{group}</p> : null}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {list.map((v) => {
                const stock = tracked && product ? productStock(data, product.id, v.id) : null;
                return (
                  <button
                    key={v.id}
                    type="button"
                    onClick={() => onPick(v)}
                    className="flex flex-col items-start rounded-lg border p-2.5 text-left hover:border-primary hover:bg-primary/5"
                    data-testid="variant-option"
                  >
                    <span className="text-sm font-medium">{groupBy ? Object.entries(v.attributes).filter(([k]) => k !== groupBy).map(([, val]) => val).join(' / ') || v.name : v.name}</span>
                    <span className="money text-xs">{fmt.money(v.selling_price ?? product?.selling_price ?? 0)}</span>
                    {stock !== null ? <span className={cn('text-[11px]', stock <= 0 ? 'text-destructive' : 'text-muted-foreground')}>{t('pos.in_stock', 'Stock')}: {fmt.qty(stock)}</span> : null}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </ResponsiveDialog>
  );
}

/* --------------------------------------------------------------- Serial/IMEI */

export function SerialPicker({
  request,
  onPick,
  onClose,
  exclude,
}: {
  request: { product: LocalProduct; variant: ProductVariant | null } | null;
  onPick: (serial: ProductSerial) => void;
  onClose: () => void;
  exclude: string[];
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  useEffect(() => setQuery(''), [request]);
  const serials = useLiveQuery(async () => {
    if (!request) return [];
    const storeId = runtime().storeId;
    return db()
      .product_serials.where('product_id')
      .equals(request.product.id)
      .filter((s) => s.status === 'in_stock' && s.store_id === storeId && !s.deleted_at && (!request.variant || s.variant_id === request.variant.id) && !exclude.includes(s.id))
      .toArray();
  }, [request, exclude]);
  const q = normalizeBarcode(query).toLowerCase();
  const list = (serials ?? []).filter((s) => !q || [s.serial_no, s.imei1, s.imei2].some((v) => v?.toLowerCase().includes(q)));

  return (
    <ResponsiveDialog open={!!request} onOpenChange={(o) => !o && onClose()} title={request?.product.name ?? ''} description={t('pos.scan_serial', 'Scan or pick the IMEI / serial number being sold')}>
      <div className="space-y-3">
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            autoFocus
            className="pl-8"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('pos.serial_search', 'IMEI / serial number')}
            data-testid="serial-search"
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return;
              const exact = list.find((s) => [s.serial_no, s.imei1, s.imei2].some((v) => v?.toLowerCase() === q));
              if (exact) onPick(exact);
              else if (list.length === 1) onPick(list[0]!);
            }}
          />
        </div>
        <ul className="max-h-[50dvh] divide-y overflow-y-auto rounded-lg border">
          {list.map((s) => (
            <li key={s.id}>
              <button type="button" className="w-full px-3 py-2.5 text-left hover:bg-muted" onClick={() => onPick(s)} data-testid="serial-option">
                <span className="block font-mono text-sm">{s.serial_no}</span>
                {s.imei1 || s.imei2 ? <span className="block font-mono text-xs text-muted-foreground">IMEI: {[s.imei1, s.imei2].filter(Boolean).join(' / ')}</span> : null}
              </button>
            </li>
          ))}
          {serials && list.length === 0 ? <li className="p-6 text-center text-sm text-muted-foreground">{t('pos.no_serials', 'No matching serial numbers in stock at this store.')}</li> : null}
        </ul>
      </div>
    </ResponsiveDialog>
  );
}

/* ---------------------------------------------------------------- Quantity */

const KEYS = ['7', '8', '9', '4', '5', '6', '1', '2', '3', '.', '0', 'back'] as const;

export function QuantityDialog({
  request,
  onSubmit,
  onClose,
}: {
  request: { title: string; unit: string | null; decimals: boolean; initial?: number | null } | null;
  onSubmit: (quantity: number) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  useEffect(() => setText(request?.initial ? String(request.initial) : ''), [request]);
  const value = Number(text);
  const valid = text !== '' && Number.isFinite(value) && value > 0 && (request?.decimals || Number.isInteger(value));
  const press = (key: (typeof KEYS)[number]) => {
    if (key === 'back') return setText((s) => s.slice(0, -1));
    if (key === '.' && (!request?.decimals || text.includes('.'))) return;
    const next = text + key;
    if (/^\d{0,7}(\.\d{0,3})?$/.test(next)) setText(next);
  };
  const submit = () => {
    if (valid) onSubmit(roundQty(value));
  };

  return (
    <ResponsiveDialog
      open={!!request}
      onOpenChange={(o) => !o && onClose()}
      size="sm"
      title={request?.title ?? ''}
      description={request?.unit ? t('pos.enter_qty_unit', 'Enter quantity in {{unit}}', { unit: request.unit }) : t('pos.enter_qty', 'Enter quantity')}
      footer={
        <Button className="w-full" size="lg" disabled={!valid} onClick={submit} data-testid="qty-submit">
          {t('common.ok', 'OK')}
        </Button>
      }
    >
      <div className="space-y-3">
        <Input
          autoFocus
          inputMode="decimal"
          value={text}
          onChange={(e) => {
            const next = e.target.value.replace(',', '.');
            if (/^\d{0,7}(\.\d{0,3})?$/.test(next) && (request?.decimals || !next.includes('.'))) setText(next);
          }}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          className="money h-14 text-right text-3xl"
          data-testid="qty-input"
        />
        <div className="grid grid-cols-3 gap-2">
          {KEYS.map((k) => (
            <Button key={k} type="button" variant="outline" className="h-12 text-lg" onClick={() => press(k)} disabled={k === '.' && !request?.decimals} aria-label={k === 'back' ? t('common.backspace', 'Backspace') : k}>
              {k === 'back' ? <DeleteIcon /> : k}
            </Button>
          ))}
        </div>
      </div>
    </ResponsiveDialog>
  );
}

/* --------------------------------------------------------------- Line editor */

export function LineEditor({ line, product, maxDiscountPercent, onClose }: { line: CartLine | null; product: LocalProduct | null; maxDiscountPercent: number; onClose: () => void }) {
  const { t } = useTranslation();
  const fmt = useFormat();
  const can = useCan();
  const { updateLine, setQuantity, removeLine } = usePos();
  const [quantity, setQty] = useState<number | null>(null);
  const [price, setPrice] = useState<number | null>(null);
  const [discountType, setDiscountType] = useState<DiscountType>('percent');
  const [discount, setDiscount] = useState<number | null>(null);
  const [notes, setNotes] = useState('');
  const [modifiers, setModifiers] = useState<SelectedModifier[]>([]);
  const [gross, setGross] = useState<number | null>(null);
  const [stone, setStone] = useState<number | null>(null);
  const [net, setNet] = useState<number | null>(null);
  const [rate, setRate] = useState<number | null>(null);
  const [making, setMaking] = useState<number | null>(null);
  const [wastage, setWastage] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!line) return;
    setQty(line.quantity);
    setPrice(line.unit_price);
    setDiscountType(line.discount_type ?? 'percent');
    setDiscount(line.discount_value);
    setNotes(line.notes ?? '');
    setModifiers(line.modifiers);
    setGross(line.jewellery?.gross_weight ?? null);
    setStone(line.jewellery?.stone_weight ?? null);
    setNet(line.jewellery?.net_weight ?? null);
    setRate(line.jewellery?.rate_per_gram ?? null);
    setMaking(line.jewellery?.making_charge_value ?? null);
    setWastage(line.jewellery?.wastage_value ?? null);
    setError(null);
  }, [line]);

  if (!line) return null;
  const fixedQty = line.serial_ids.length > 0 || !!line.jewellery || !!line.kitchen_order_id;
  const canPrice = can('sales.price_override');
  const canDiscount = can('sales.discount');

  const jewellery = line.jewellery
    ? (() => {
        const details = { ...line.jewellery, gross_weight: gross ?? 0, stone_weight: stone ?? 0, net_weight: net ?? 0, rate_per_gram: rate ?? 0, making_charge_value: making ?? 0, wastage_value: wastage ?? 0 };
        const priced = calculateJewelleryPrice(details);
        return { ...details, metal_value: priced.metal_value, making_charges: priced.making_charges, wastage_charges: priced.wastage_charges, price: priced.taxable_value };
      })()
    : null;

  const save = () => {
    const qty = quantity ?? 0;
    if (qty <= 0) return setError(t('pos.qty_positive', 'Quantity must be more than zero.'));
    if (!line.allow_decimal && !Number.isInteger(qty)) return setError(t('pos.qty_whole', 'This item is sold in whole units.'));
    const unitPrice = jewellery ? jewellery.price : (price ?? 0);
    if (unitPrice < 0) return setError(t('pos.price_negative', 'Price cannot be negative.'));
    if (product?.min_selling_price && unitPrice < product.min_selling_price && !jewellery) {
      return setError(t('pos.below_min', 'Minimum selling price is {{price}}.', { price: fmt.money(product.min_selling_price) }));
    }
    const lineGross = roundTo(unitPrice * qty);
    const discountAmount = discount ? (discountType === 'percent' ? percentOf(lineGross, discount) : discount) : 0;
    if (discountAmount > lineGross) return setError(t('pos.discount_too_high', 'Discount cannot exceed the line amount.'));
    if (discount && lineGross > 0 && (discountAmount / lineGross) * 100 > maxDiscountPercent + 0.001) {
      return setError(t('pos.discount_max', 'Maximum discount allowed is {{percent}}%.', { percent: maxDiscountPercent }));
    }
    for (const group of product?.modifiers ?? []) {
      const chosen = modifiers.filter((m) => m.group === group.name).length;
      if (chosen < group.min) return setError(t('pos.modifier_min', 'Choose at least {{count}} in {{group}}.', { count: group.min, group: group.name }));
    }
    updateLine(line.key, {
      unit_price: unitPrice,
      // A jewellery re-price is the new list price (no override flag); other edits count as overrides.
      list_price: jewellery ? unitPrice : line.list_price,
      discount_type: discount ? discountType : null,
      discount_value: discount || null,
      notes: notes.trim() || null,
      modifiers,
      jewellery: jewellery ? { ...line.jewellery!, ...jewellery } : null,
    });
    if (!fixedQty && qty !== line.quantity) setQuantity(line.key, qty);
    onClose();
  };

  return (
    <ResponsiveDialog
      open={!!line}
      onOpenChange={(o) => !o && onClose()}
      title={line.name}
      description={`${fmt.money(effectiveUnitPrice(line))}${line.unit_code ? ` / ${line.unit_code}` : ''}`}
      size={line.jewellery ? 'lg' : 'md'}
      footer={
        <div className="flex w-full justify-between gap-2">
          <Button
            variant="ghost"
            className="text-destructive"
            disabled={!!line.kitchen_order_id}
            onClick={() => {
              removeLine(line.key);
              onClose();
            }}
          >
            <Trash2Icon /> {t('pos.remove_item', 'Remove item')}
          </Button>
          <Button onClick={save} data-testid="line-save">
            {t('common.apply', 'Apply')}
          </Button>
        </div>
      }
    >
      <div
        className="space-y-4"
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT') {
            e.preventDefault();
            save();
          }
        }}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1 text-sm">
            <span className="font-medium">{t('pos.quantity', 'Quantity')}</span>
            <NumberInput value={quantity} onValueChange={setQty} decimals={line.allow_decimal ? 3 : 0} disabled={fixedQty} autoFocus={!fixedQty} data-testid="line-qty-input" />
          </label>
          {!jewellery ? (
            <label className="space-y-1 text-sm">
              <span className="font-medium">
                {t('pos.unit_price', 'Unit price')} {line.price_includes_tax ? t('pos.incl_tax', '(incl. tax)') : ''}
              </span>
              <NumberInput value={price} onValueChange={setPrice} disabled={!canPrice} data-testid="line-price" />
              {!canPrice ? <span className="text-xs text-muted-foreground">{t('pos.price_locked', 'Your role cannot change prices.')}</span> : null}
            </label>
          ) : null}
        </div>

        {jewellery ? (
          <div className="grid gap-3 rounded-lg border p-3 sm:grid-cols-3">
            <label className="space-y-1 text-sm">
              <span className="font-medium">{t('jewellery.gross_weight', 'Gross weight (g)')}</span>
              <NumberInput value={gross} onValueChange={setGross} decimals={3} />
            </label>
            <label className="space-y-1 text-sm">
              <span className="font-medium">{t('jewellery.stone_weight', 'Stone weight (g)')}</span>
              <NumberInput value={stone} onValueChange={setStone} decimals={3} />
            </label>
            <label className="space-y-1 text-sm">
              <span className="font-medium">{t('jewellery.net_weight', 'Net weight (g)')}</span>
              <NumberInput value={net} onValueChange={setNet} decimals={3} />
            </label>
            <label className="space-y-1 text-sm">
              <span className="font-medium">
                {t('jewellery.rate', 'Rate per gram')} ({line.jewellery?.purity})
              </span>
              <NumberInput value={rate} onValueChange={setRate} disabled={!canPrice} />
            </label>
            <label className="space-y-1 text-sm">
              <span className="font-medium">
                {t('jewellery.making', 'Making')} ({line.jewellery?.making_charge_type === 'per_gram' ? '/g' : line.jewellery?.making_charge_type === 'percent' ? '%' : fmt.currency})
              </span>
              <NumberInput value={making} onValueChange={setMaking} disabled={!canDiscount && !canPrice} />
            </label>
            <label className="space-y-1 text-sm">
              <span className="font-medium">
                {t('jewellery.wastage', 'Wastage')} ({line.jewellery?.wastage_type === 'percent' ? '%' : 'g'})
              </span>
              <NumberInput value={wastage} onValueChange={setWastage} decimals={3} disabled={!canDiscount && !canPrice} />
            </label>
            <dl className="col-span-full grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
              <dt className="text-muted-foreground">{t('jewellery.metal_value', 'Metal value')}</dt>
              <dd className="money">{fmt.money(jewellery.metal_value)}</dd>
              <dt className="text-muted-foreground">{t('jewellery.making', 'Making')}</dt>
              <dd className="money">{fmt.money(jewellery.making_charges)}</dd>
              <dt className="text-muted-foreground">{t('jewellery.wastage', 'Wastage')}</dt>
              <dd className="money">{fmt.money(jewellery.wastage_charges)}</dd>
              <dt className="font-medium">{t('jewellery.price', 'Price before tax')}</dt>
              <dd className="money font-semibold">{fmt.money(jewellery.price)}</dd>
            </dl>
          </div>
        ) : null}

        <div className="space-y-1 text-sm">
          <span className="font-medium">{t('pos.line_discount', 'Line discount')}</span>
          <div className="flex gap-2">
            <div className="flex rounded-lg border p-0.5">
              {(['percent', 'amount'] as const).map((type) => (
                <button key={type} type="button" className={cn('rounded-md px-3 text-sm', discountType === type ? 'bg-primary text-primary-foreground' : '')} onClick={() => setDiscountType(type)} disabled={!canDiscount}>
                  {type === 'percent' ? '%' : fmt.currency}
                </button>
              ))}
            </div>
            <NumberInput value={discount} onValueChange={setDiscount} disabled={!canDiscount} className="flex-1" data-testid="line-discount" />
          </div>
          {!canDiscount ? <span className="text-xs text-muted-foreground">{t('pos.discount_locked', 'Your role cannot give discounts.')}</span> : null}
        </div>

        {product?.modifiers.length ? (
          <div className="space-y-3">
            {product.modifiers.map((group) => (
              <div key={group.id} className="space-y-1.5">
                <p className="text-sm font-medium">
                  {group.name}{' '}
                  <span className="text-xs font-normal text-muted-foreground">
                    {group.min > 0 ? t('pos.required', 'required') : t('pos.optional', 'optional')}
                    {group.max > 1 ? ` · ${t('pos.up_to', 'up to {{count}}', { count: group.max })}` : ''}
                  </span>
                </p>
                <div className="flex flex-wrap gap-2">
                  {group.options.map((option) => {
                    const selected = modifiers.some((m) => m.group === group.name && m.option === option.name);
                    return (
                      <button
                        key={option.id}
                        type="button"
                        className={cn('rounded-full border px-3 py-1 text-sm', selected ? 'border-primary bg-primary/10 text-primary' : 'hover:bg-muted')}
                        onClick={() =>
                          setModifiers((current) => {
                            if (selected) return current.filter((m) => !(m.group === group.name && m.option === option.name));
                            const picked = { group: group.name, option: option.name, price: option.price };
                            if (group.max <= 1) return [...current.filter((m) => m.group !== group.name), picked];
                            if (current.filter((m) => m.group === group.name).length >= group.max) return current;
                            return [...current, picked];
                          })
                        }
                      >
                        {option.name}
                        {option.price ? ` +${fmt.money(option.price)}` : ''}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        ) : null}

        <label className="block space-y-1 text-sm">
          <span className="font-medium">{t('pos.line_notes', 'Notes')}</span>
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} maxLength={250} placeholder={t('pos.line_notes_hint', 'e.g. less spicy, gift wrap')} />
        </label>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </div>
    </ResponsiveDialog>
  );
}

/* ------------------------------------------------------------ Bill discount */

export function BillDiscountDialog({ open, onOpenChange, subtotal, maxDiscountPercent }: { open: boolean; onOpenChange: (o: boolean) => void; subtotal: number; maxDiscountPercent: number }) {
  const { t } = useTranslation();
  const fmt = useFormat();
  const can = useCan();
  const { bill_discount_type, bill_discount_value, coupon_code, setBillDiscount } = usePos();
  const [type, setType] = useState<DiscountType>('percent');
  const [value, setValue] = useState<number | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setType(bill_discount_type ?? 'percent');
    setValue(bill_discount_value);
    setCode(coupon_code ?? '');
    setError(null);
  }, [open, bill_discount_type, bill_discount_value, coupon_code]);

  const apply = () => {
    const amount = value ? (type === 'percent' ? percentOf(subtotal, value) : value) : 0;
    if (amount > subtotal) return setError(t('pos.discount_too_high', 'Discount cannot exceed the line amount.'));
    if (subtotal > 0 && (amount / subtotal) * 100 > maxDiscountPercent + 0.001) return setError(t('pos.discount_max', 'Maximum discount allowed is {{percent}}%.', { percent: maxDiscountPercent }));
    setBillDiscount(type, value, null);
    onOpenChange(false);
  };

  const applyCoupon = async () => {
    const normalized = code.trim().toUpperCase();
    if (!normalized) return;
    const coupon: Coupon | undefined = await db().coupons.where('code').equals(normalized).filter((c) => !c.deleted_at).first();
    const today = businessDate(new Date(), runtime().timezone);
    const problem = !coupon
      ? t('pos.coupon_invalid', 'Coupon not found.')
      : !coupon.active
        ? t('pos.coupon_inactive', 'This coupon is not active.')
        : (coupon.valid_from && today < coupon.valid_from) || (coupon.valid_to && today > coupon.valid_to)
          ? t('pos.coupon_expired', 'This coupon is not valid today.')
          : coupon.usage_limit !== null && coupon.used_count >= coupon.usage_limit
            ? t('pos.coupon_used', 'This coupon has reached its usage limit.')
            : subtotal < coupon.min_amount
              ? t('pos.coupon_min', 'Minimum bill amount for this coupon is {{amount}}.', { amount: fmt.money(coupon.min_amount) })
              : null;
    if (problem || !coupon) return setError(problem);
    // Percent coupons with a cap become a fixed amount so the cap holds.
    if (coupon.discount_type === 'percent' && coupon.max_discount !== null) {
      setBillDiscount('amount', Math.min(percentOf(subtotal, coupon.discount_value), coupon.max_discount), coupon.code);
    } else {
      setBillDiscount(coupon.discount_type, coupon.discount_value, coupon.code);
    }
    toast.success(t('pos.coupon_applied', 'Coupon {{code}} applied', { code: coupon.code }));
    onOpenChange(false);
  };

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      size="sm"
      title={t('pos.bill_discount', 'Bill discount')}
      footer={
        <div className="flex w-full justify-between gap-2">
          <Button
            variant="ghost"
            onClick={() => {
              setBillDiscount(null, null, null);
              onOpenChange(false);
            }}
          >
            {t('pos.remove_discount', 'Remove')}
          </Button>
          <Button onClick={apply} disabled={!can('sales.discount')}>
            {t('common.apply', 'Apply')}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {can('sales.discount') ? (
          <div className="flex gap-2">
            <div className="flex rounded-lg border p-0.5">
              {(['percent', 'amount'] as const).map((tp) => (
                <button key={tp} type="button" className={cn('rounded-md px-3 text-sm', type === tp ? 'bg-primary text-primary-foreground' : '')} onClick={() => setType(tp)}>
                  {tp === 'percent' ? '%' : fmt.currency}
                </button>
              ))}
            </div>
            <NumberInput autoFocus value={value} onValueChange={setValue} className="flex-1" onKeyDown={(e) => e.key === 'Enter' && apply()} data-testid="bill-discount" />
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{t('pos.discount_locked', 'Your role cannot give discounts.')}</p>
        )}
        <div className="space-y-1">
          <span className="text-sm font-medium">{t('pos.coupon', 'Coupon code')}</span>
          <div className="flex gap-2">
            <Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} onKeyDown={(e) => e.key === 'Enter' && void applyCoupon()} />
            <Button variant="outline" onClick={() => void applyCoupon()} disabled={!code.trim()}>
              {t('pos.apply_coupon', 'Apply')}
            </Button>
          </div>
        </div>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </div>
    </ResponsiveDialog>
  );
}

/* --------------------------------------------------------------- Held bills */

export function HeldSalesDialog({ open, onOpenChange, onResume }: { open: boolean; onOpenChange: (o: boolean) => void; onResume: (cart: CartState) => void }) {
  const { t } = useTranslation();
  const fmt = useFormat();
  const held = useLiveQuery(() => db().held_sales.orderBy('created_at').reverse().toArray(), []);

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange} title={t('pos.held_bills', 'Held bills')} description={t('pos.held_hint', 'Held bills are saved on this device only.')}>
      <ul className="divide-y rounded-lg border">
        {(held ?? []).map((h) => (
          <li key={h.id} className="flex items-center gap-3 px-3 py-2.5">
            <PauseIcon className="size-4 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{h.label}</p>
              <p className="text-xs text-muted-foreground">
                {h.item_count} {t('pos.items', 'items')} · {fmt.relative(h.created_at)}
              </p>
            </div>
            <span className="money text-sm font-semibold">{fmt.money(h.total)}</span>
            <Button
              size="sm"
              onClick={async () => {
                const cart = await takeHeldSale(h.id);
                if (cart) onResume(cart);
                onOpenChange(false);
              }}
            >
              <PlayIcon /> {t('pos.resume', 'Resume')}
            </Button>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label={t('common.delete', 'Delete')}
              onClick={async () => {
                const { confirmed } = await confirm({ title: t('pos.delete_held', 'Delete held bill?'), description: h.label, destructive: true, confirmLabel: t('common.delete', 'Delete') });
                if (confirmed) await deleteHeldSale(h.id);
              }}
            >
              <Trash2Icon />
            </Button>
          </li>
        ))}
        {held && held.length === 0 ? <li className="p-6 text-center text-sm text-muted-foreground">{t('pos.no_held', 'No held bills.')}</li> : null}
      </ul>
    </ResponsiveDialog>
  );
}
