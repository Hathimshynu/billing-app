import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useLiveQuery } from 'dexie-react-hooks';
import { toast } from 'sonner';
import { ChefHatIcon, ListRestartIcon, PauseIcon, ScanBarcodeIcon, SearchIcon, ShoppingCartIcon, XIcon } from 'lucide-react';
import {
  looksLikeScannerInput,
  percentOf,
  roundTo,
  type Customer,
  type OrderType,
  type PaymentMethod,
  type ProductSerial,
  type ProductVariant,
  type Sale,
  type SaleDocType,
} from '@shopdesk/shared';
import { cn } from '@/lib/utils';
import { db, type LocalProduct } from '@/lib/db/business';
import { useFormat } from '@/lib/format';
import { runtime } from '@/lib/runtime';
import { useSetting } from '@/lib/settings';
import { lineFromProduct, priceCart, supplyTypeFor, taxSnapshot, type CartCharge, type CartLine, type CartState } from '@/lib/pos/cart';
import { findByCode } from '@/lib/repos/catalog';
import { ledgerBalance } from '@/lib/repos/parties';
import { completeSale, holdSale, updateQuotation, type PaymentInput } from '@/lib/repos/sales';
import { sendKot } from '@/lib/repos/industry';
import { printKot, printSale } from '@/lib/print';
import { useBusiness, useCan, useHotkeys, useModules, eventCombo } from '@/hooks/use-app';
import { useIsMobile } from '@/hooks/use-mobile';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Kbd } from '@/components/ui/kbd';
import { Drawer, DrawerContent, DrawerTitle } from '@/components/ui/drawer';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { LoadingRows } from '@/components/common/page';
import { confirm } from '@/components/common/confirm';
import { resolveAdd } from './add-logic';
import { CartPanel } from './cart-panel';
import { CustomerPicker } from './customer-picker';
import { PaymentDialog, type PaymentContext } from './payment-dialog';
import { BillDiscountDialog, HeldSalesDialog, LineEditor, QuantityDialog, SerialPicker, VariantPicker } from './pickers';
import { cartSnapshot, usePos } from './pos-store';
import { ProductGrid, searchProducts } from './product-grid';
import { ReceiptDialog } from './receipt-dialog';
import { shortcutFor, shortcutMap, type PosAction } from './shortcuts';
import { usePosData } from './use-pos-data';

const DOC_TYPES: Array<{ value: SaleDocType; label: string }> = [
  { value: 'invoice', label: 'Invoice' },
  { value: 'quotation', label: 'Quotation' },
  { value: 'estimate', label: 'Estimate' },
  { value: 'proforma', label: 'Proforma' },
  { value: 'delivery_challan', label: 'Delivery challan' },
];

const ORDER_TYPES: Array<{ value: OrderType; label: string }> = [
  { value: 'dine_in', label: 'Dine-in' },
  { value: 'takeaway', label: 'Takeaway' },
  { value: 'delivery', label: 'Delivery' },
];

const isTyping = (el: Element | null) => !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || (el as HTMLElement).isContentEditable);

export default function PosPage() {
  const { t } = useTranslation();
  const fmt = useFormat();
  const can = useCan();
  const hasModule = useModules();
  const navigate = useNavigate();
  const business = useBusiness();
  const mobile = useIsMobile();
  const data = usePosData();
  const posSettings = useSetting('pos');
  const invoiceSettings = useSetting('invoice');
  const loyalty = useSetting('loyalty');
  const printerSettings = useSetting('printer');
  const pos = usePos();

  const [query, setQuery] = useState('');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [variantFor, setVariantFor] = useState<LocalProduct | null>(null);
  const [serialFor, setSerialFor] = useState<{ product: LocalProduct; variant: ProductVariant | null } | null>(null);
  const [qtyFor, setQtyFor] = useState<{ product: LocalProduct; variant: ProductVariant | null } | null>(null);
  const [editKey, setEditKey] = useState<string | null>(null);
  const [customerOpen, setCustomerOpen] = useState(false);
  const [discountOpen, setDiscountOpen] = useState(false);
  const [heldOpen, setHeldOpen] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [cartOpen, setCartOpen] = useState(false);
  const [receipt, setReceipt] = useState<Sale | null>(null);
  const [busy, setBusy] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    pos.bind(runtime().businessId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const restaurant = hasModule('restaurant');
  const jewellery = hasModule('jewellery');
  const anyDialog = !!(variantFor || serialFor || qtyFor || editKey || customerOpen || discountOpen || heldOpen || payOpen || receipt || (mobile && cartOpen));

  /* --------------------------------------------------------------- pricing */

  const cart: CartState = useMemo(() => cartSnapshot(), [pos]); // eslint-disable-line react-hooks/exhaustive-deps
  const supplyType = supplyTypeFor(business?.state_code ?? null, pos.customer_state, business?.tax_system ?? 'gst');
  const priceOptions = { supplyType, roundOff: invoiceSettings.round_off, decimals: business?.currency_decimals ?? 2 };

  const effectiveCart: CartState = useMemo(() => {
    const percent = posSettings.service_charge_percent;
    const manual = cart.charges.filter((c) => c.key !== 'service');
    if (!restaurant || cart.order_type !== 'dine_in' || !percent || cart.lines.length === 0) return { ...cart, charges: manual };
    const base = priceCart({ ...cart, charges: [] }, priceOptions);
    const tax = posSettings.service_charge_tax_rate_id ? data.taxes.get(posSettings.service_charge_tax_rate_id) : undefined;
    const service: CartCharge = { key: 'service', name: `Service charge (${percent}%)`, amount: percentOf(base.taxable_total, percent), tax_rate_id: tax?.id ?? null, tax: taxSnapshot(tax) };
    return { ...cart, charges: [...manual, service] };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cart, restaurant, posSettings.service_charge_percent, posSettings.service_charge_tax_rate_id, data.taxes, supplyType, invoiceSettings.round_off]);

  const pricing = useMemo(() => priceCart(effectiveCart, priceOptions), [effectiveCart, supplyType, invoiceSettings.round_off, business?.currency_decimals]); // eslint-disable-line react-hooks/exhaustive-deps

  const results = useMemo(() => searchProducts(data.products, query, query ? null : categoryId), [data.products, query, categoryId]);

  /* -------------------------------------------------------------- customer */

  const customerInfo = useLiveQuery(async () => {
    if (!pos.customer_id) return null;
    const customer = await db().customers.get(pos.customer_id);
    const entries = await db().customer_ledger.where('customer_id').equals(pos.customer_id).toArray();
    return { customer, balance: ledgerBalance(entries), points: entries.reduce((s, e) => s + (e.points ?? 0), 0) };
  }, [pos.customer_id]);

  const register = useLiveQuery(() => db().cash_registers.where('device_id').equals(runtime().deviceId).filter((r) => r.status === 'open').first(), []);
  const heldCount = useLiveQuery(() => db().held_sales.count(), []) ?? 0;
  const tables = useLiveQuery(() => (restaurant ? db().restaurant_tables.filter((tb) => tb.active && !tb.deleted_at && tb.store_id === runtime().storeId).sortBy('sort_order') : []), [restaurant]);

  /* ------------------------------------------------------------- add items */

  const addProduct = useCallback(
    (product: LocalProduct, opts: { variant?: ProductVariant | null; serial?: ProductSerial | null; quantity?: number | null } = {}) => {
      const state = usePos.getState();
      if (opts.serial && state.lines.some((l) => l.serial_ids.includes(opts.serial!.id))) {
        toast.error(t('pos.serial_in_cart', '{{serial}} is already in the cart.', { serial: opts.serial.serial_no }));
        return;
      }
      const variantId = opts.variant?.id ?? null;
      const inCart = state.lines.filter((l) => l.product_id === product.id && l.variant_id === variantId).reduce((s, l) => s + l.quantity, 0);
      const result = resolveAdd(data, {
        product,
        variant: opts.variant,
        serial: opts.serial,
        quantity: opts.quantity,
        inCart: roundTo(inCart, 3),
        allowNegative: posSettings.allow_negative_stock,
        canSellExpired: can('sales.sell_expired'),
      });
      switch (result.kind) {
        case 'needs_variant':
          setVariantFor(result.product);
          return;
        case 'needs_serial':
          setSerialFor({ product: result.product, variant: result.variant });
          return;
        case 'needs_quantity':
          setQtyFor({ product: result.product, variant: result.variant });
          return;
        case 'error':
          toast.error(result.message);
          return;
        case 'lines':
          for (const line of result.lines) state.addLine(line, product.price_tiers?.length ? product.price_tiers : undefined);
          if (result.warning) toast.warning(result.warning);
          if (product.attributes?.prescription_required) toast.info(t('pos.rx_required', '{{name}} needs a prescription.', { name: product.name }));
      }
    },
    [data, posSettings.allow_negative_stock, can, t],
  );

  const handleCode = useCallback(
    async (raw: string): Promise<boolean> => {
      const match = await findByCode(raw, posSettings.scale_barcode);
      if (!match) return false;
      addProduct(match.product, { variant: match.variant, serial: match.serial, quantity: match.quantity });
      return true;
    },
    [addProduct, posSettings.scale_barcode],
  );

  const submitSearch = async () => {
    const text = query.trim();
    if (!text) return;
    if (await handleCode(text)) {
      setQuery('');
      return;
    }
    const matches = searchProducts(data.products, text, null);
    if (matches.length === 1) {
      setQuery('');
      addProduct(matches[0]!);
    } else if (matches.length === 0) {
      toast.error(t('pos.not_found', 'No product matches “{{text}}”.', { text }));
    }
  };

  // Hardware barcode scanners type fast and end with Enter. Capture them even when nothing is focused.
  const scanBuffer = useRef<{ chars: string; times: number[] }>({ chars: '', times: [] });
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (anyDialog || isTyping(document.activeElement)) return;
      const buffer = scanBuffer.current;
      const now = performance.now();
      if (buffer.times.length && now - buffer.times[buffer.times.length - 1]! > 100) {
        buffer.chars = '';
        buffer.times = [];
      }
      if (event.key === 'Enter') {
        const code = buffer.chars;
        const fromScanner = looksLikeScannerInput(buffer.times);
        buffer.chars = '';
        buffer.times = [];
        if (code && fromScanner) {
          event.preventDefault();
          void handleCode(code).then((found) => !found && toast.error(t('pos.unknown_code', 'Unknown barcode {{code}}', { code })));
        }
        return;
      }
      if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
        buffer.chars += event.key;
        buffer.times.push(now);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [anyDialog, handleCode, t]);

  /* ---------------------------------------------------------- restaurant */

  const loadTable = async (tableId: string | null) => {
    const state = usePos.getState();
    const fresh = state.lines.filter((l) => !l.kitchen_order_id);
    if (!tableId) {
      state.load({ ...cartSnapshot(), lines: fresh, table_id: null, kitchen_order_ids: [] });
      return;
    }
    const kots = await db()
      .kitchen_orders.where('table_id')
      .equals(tableId)
      .filter((k) => !k.sale_id && k.status !== 'cancelled' && !k.deleted_at)
      .toArray();
    // Net out voided items and merge identical items across KOTs.
    const merged = new Map<string, CartLine>();
    for (const kot of kots) {
      for (const item of kot.items) {
        const product = data.products.find((p) => p.id === item.product_id);
        if (!product) continue;
        const key = `${item.product_id}|${item.variant_id ?? ''}|${item.unit_price}|${JSON.stringify(item.modifiers)}|${item.notes ?? ''}`;
        const qty = kot.is_void ? -item.quantity : item.quantity;
        const existing = merged.get(key);
        if (existing) {
          existing.quantity = roundTo(existing.quantity + qty, 3);
          continue;
        }
        const variant = product.variants.find((v) => v.id === item.variant_id) ?? null;
        const tax = product.tax_rate_id ? data.taxes.get(product.tax_rate_id) : undefined;
        const unit = product.unit_id ? data.units.get(product.unit_id) : undefined;
        const line = lineFromProduct({ product, variant, tax: tax ?? null, unitCode: unit?.code ?? null, quantity: qty, metalRates: data.metalRates });
        merged.set(key, { ...line, unit_price: item.unit_price, list_price: item.unit_price, modifiers: item.modifiers, notes: item.notes, kitchen_order_id: kot.id });
      }
    }
    const kotLines = [...merged.values()].filter((l) => l.quantity > 0);
    state.load({ ...cartSnapshot(), order_type: 'dine_in', table_id: tableId, kitchen_order_ids: kots.map((k) => k.id), lines: [...kotLines, ...fresh] });
  };

  const sendToKitchen = async () => {
    const state = usePos.getState();
    const fresh = state.lines.filter((l) => !l.kitchen_order_id && l.product_id);
    if (!fresh.length) return;
    if (state.order_type === 'dine_in' && !state.table_id) {
      toast.error(t('pos.pick_table', 'Choose a table first.'));
      return;
    }
    try {
      const kot = await sendKot({
        table_id: state.table_id,
        order_type: state.order_type,
        items: fresh.map((l) => ({ product_id: l.product_id!, variant_id: l.variant_id, name: l.name, quantity: l.quantity, unit_price: l.unit_price, modifiers: l.modifiers, notes: l.notes })),
      });
      toast.success(t('pos.kot_sent', 'KOT {{number}} sent to kitchen', { number: kot.kot_number }));
      printKot(kot, fmt).catch((error: unknown) => toast.error(error instanceof Error ? error.message : String(error)));
      if (state.order_type === 'dine_in') {
        // The table's order now lives in its KOTs (synced to every device); free the screen for the next table.
        state.clear();
      } else {
        for (const line of fresh) state.updateLine(line.key, { kitchen_order_id: kot.id });
        usePos.setState({ kitchen_order_ids: [...state.kitchen_order_ids, kot.id] });
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };

  /* -------------------------------------------------------------- payment */

  const loyaltyPoints = customerInfo?.points ?? 0;
  const methods = useMemo(() => {
    const enabled = new Set<PaymentMethod>(posSettings.enabled_payment_methods);
    if (jewellery) enabled.add('old_gold');
    else enabled.delete('old_gold');
    if (loyalty.enabled && pos.customer_id && loyaltyPoints >= loyalty.min_redeem_points) enabled.add('loyalty');
    else enabled.delete('loyalty');
    return [...enabled];
  }, [posSettings.enabled_payment_methods, jewellery, loyalty.enabled, loyalty.min_redeem_points, pos.customer_id, loyaltyPoints]);

  const paymentContext: PaymentContext = {
    total: pricing.grand_total,
    methods,
    quickAmounts: posSettings.quick_amounts,
    customerName: pos.customer_name,
    creditAvailable: customerInfo?.customer && customerInfo.customer.credit_limit > 0 ? roundTo(customerInfo.customer.credit_limit - customerInfo.balance) : null,
    canCredit: can('sales.credit'),
    canOverrideCredit: can('sales.credit_override'),
    loyaltyPoints,
    loyaltyPointValue: loyalty.point_value,
    loyaltyEnabled: loyalty.enabled,
    upiId: invoiceSettings.upi_id,
    businessName: business?.name ?? '',
    goldRates: Object.fromEntries(data.metalRates.filter((r) => r.metal === 'gold').sort((a, b) => a.effective_from.localeCompare(b.effective_from)).map((r) => [r.purity, r.rate_per_gram])),
    jewellery,
  };

  const finish = async (sale: Sale) => {
    setPayOpen(false);
    setCartOpen(false);
    setReceipt(sale);
    if (posSettings.print_after_sale && sale.doc_type === 'invoice') {
      printSale(sale, fmt).catch((error: unknown) => toast.error(t('print.failed', 'Printing failed: {{message}}', { message: error instanceof Error ? error.message : String(error) })));
    }
  };

  const startPayment = async () => {
    const state = usePos.getState();
    if (!state.lines.length || busy) return;
    if (posSettings.require_register && state.doc_type === 'invoice' && !register) {
      toast.error(t('pos.register_required', 'Open the cash register before billing.'), { action: { label: t('pos.open_register', 'Open register'), onClick: () => navigate('/register') } });
      return;
    }
    if (posSettings.default_customer_required && !state.customer_id) {
      toast.error(t('pos.customer_required', 'Select a customer for this bill.'));
      setCustomerOpen(true);
      return;
    }
    if (state.lines.some((l) => l.quantity <= 0)) {
      toast.error(t('pos.zero_qty', 'Remove items with zero quantity first.'));
      return;
    }
    if (state.lines.some((l) => l.prescription_required) && state.doc_type === 'invoice') {
      const { confirmed } = await confirm({ title: t('pos.rx_title', 'Prescription check'), description: t('pos.rx_confirm', 'This bill has prescription-only medicines. Confirm a valid prescription was seen.'), confirmLabel: t('pos.rx_ok', 'Prescription verified') });
      if (!confirmed) return;
    }
    if (state.doc_type !== 'invoice') {
      await saveDocument();
      return;
    }
    setPayOpen(true);
  };

  const saveDocument = async () => {
    const state = usePos.getState();
    setBusy(true);
    try {
      if (state.editingQuotationId) {
        await updateQuotation(state.editingQuotationId, effectiveCart, pricing, supplyType);
        toast.success(t('pos.quotation_updated', 'Quotation updated'));
        const sale = await db().sales.get(state.editingQuotationId);
        state.clear();
        if (sale) await finish(sale);
      } else {
        const sale = await completeSale({ cart: effectiveCart, pricing, payments: [], supplyType, roundOff: invoiceSettings.round_off, registerId: null });
        state.clear();
        await finish(sale);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const complete = async (payments: PaymentInput[]) => {
    setBusy(true);
    try {
      const loyaltyAmount = roundTo(payments.filter((p) => p.method === 'loyalty').reduce((s, p) => s + p.amount, 0));
      let redeemPoints = 0;
      if (loyaltyAmount > 0) {
        redeemPoints = Math.ceil(loyaltyAmount / loyalty.point_value - 1e-9);
        if (redeemPoints > loyaltyPoints) throw new Error(t('pos.points_short', 'The customer has only {{points}} points.', { points: loyaltyPoints }));
      }
      const earned = loyalty.enabled && pos.customer_id ? Math.floor(((pricing.grand_total - loyaltyAmount) / 100) * loyalty.earn_per_100) : 0;
      const sale = await completeSale({
        cart: { ...effectiveCart, loyalty_redeem_points: redeemPoints },
        pricing,
        payments,
        supplyType,
        roundOff: invoiceSettings.round_off,
        registerId: register?.id ?? null,
        loyaltyEarned: Math.max(earned, 0),
      });
      usePos.getState().clear();
      await finish(sale);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const hold = async () => {
    const state = usePos.getState();
    if (!state.lines.length) return;
    await holdSale(cartSnapshot(), pricing.grand_total);
    state.clear();
    toast.success(t('pos.held', 'Bill held. Resume it from Held bills.'));
  };

  const pickCustomer = (customer: Customer) => {
    pos.setCustomer(customer);
    if (customer.credit_limit > 0) {
      void db()
        .customer_ledger.where('customer_id')
        .equals(customer.id)
        .toArray()
        .then((entries) => {
          const due = ledgerBalance(entries);
          if (due > 0) toast.info(t('pos.customer_due', '{{name}} has {{amount}} outstanding.', { name: customer.name, amount: fmt.money(due) }));
        });
    }
  };

  /* ------------------------------------------------------------ shortcuts */

  const actions: Record<PosAction, () => void> = {
    search: () => searchRef.current?.focus(),
    customer: () => setCustomerOpen(true),
    discount: () => pos.lines.length && setDiscountOpen(true),
    held: () => setHeldOpen(true),
    pay: () => void startPayment(),
    hold: () => void hold(),
    edit_line: () => pos.selectedKey && setEditKey(pos.selectedKey),
    delete_line: () => pos.selectedKey && !pos.lines.find((l) => l.key === pos.selectedKey)?.kitchen_order_id && pos.removeLine(pos.selectedKey),
    clear: async () => {
      if (!pos.lines.length) return;
      const { confirmed } = await confirm({ title: t('pos.clear_confirm', 'Clear the cart?'), destructive: true, confirmLabel: t('pos.clear_cart', 'Clear cart') });
      if (confirmed) pos.clear();
    },
  };
  const combos = shortcutMap(posSettings.shortcuts);
  useHotkeys(
    Object.fromEntries(
      Object.entries(combos).map(([combo, action]) => [
        combo,
        (event: KeyboardEvent) => {
          // Plain keys (Delete) must not fire while typing in a field; F-keys always work.
          if (!combo.startsWith('F') && isTyping(document.activeElement)) return;
          event.preventDefault();
          actions[action]();
        },
      ]),
    ),
    !anyDialog,
  );
  useHotkeys(
    {
      Escape: () => {
        if (document.activeElement === searchRef.current && query) setQuery('');
        else searchRef.current?.focus();
      },
    },
    !anyDialog,
  );

  /* ---------------------------------------------------------------- render */

  const editingLine = editKey ? (pos.lines.find((l) => l.key === editKey) ?? null) : null;
  const payLabel = pos.editingQuotationId
    ? t('pos.update_quotation', 'Update quotation')
    : pos.doc_type === 'invoice'
      ? t('pos.pay', 'Pay')
      : t('pos.save_doc', 'Save {{doc}}', { doc: DOC_TYPES.find((d) => d.value === pos.doc_type)?.label.toLowerCase() });
  const unsentKot = pos.lines.some((l) => !l.kitchen_order_id);

  const cartPanel = (
    <CartPanel
      pricing={pricing}
      onPay={() => void startPayment()}
      onHold={() => void hold()}
      onCustomer={() => setCustomerOpen(true)}
      onDiscount={() => setDiscountOpen(true)}
      onEditLine={(line) => setEditKey(line.key)}
      payLabel={payLabel}
      className="h-full"
    />
  );

  return (
    <div className="flex h-full min-h-0" data-testid="pos-page">
      <section className="flex min-w-0 flex-1 flex-col">
        <div className="flex flex-wrap items-center gap-2 border-b p-3">
          <div className="relative min-w-48 flex-1">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              ref={searchRef}
              autoFocus={!mobile}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void submitSearch();
                } else if (eventCombo(e.nativeEvent) === 'Escape' && query) {
                  e.stopPropagation();
                  setQuery('');
                }
              }}
              placeholder={t('pos.search_placeholder', 'Search or scan barcode, SKU, IMEI…')}
              className="h-10 pr-20 pl-9 text-base"
              data-testid="pos-search"
              aria-label={t('pos.search', 'Search products')}
            />
            <span className="absolute top-1/2 right-2 flex -translate-y-1/2 items-center gap-1">
              {query ? (
                <Button variant="ghost" size="icon-xs" onClick={() => setQuery('')} aria-label={t('common.clear', 'Clear')}>
                  <XIcon />
                </Button>
              ) : (
                <ScanBarcodeIcon className="size-4 text-muted-foreground" />
              )}
              <Kbd className="hidden lg:inline-flex">{shortcutFor(posSettings.shortcuts, 'search')}</Kbd>
            </span>
          </div>

          <Select value={pos.doc_type} onValueChange={(v) => pos.setDocType(v as SaleDocType)} disabled={!!pos.editingQuotationId}>
            <SelectTrigger className="h-10 w-40" aria-label={t('pos.doc_type', 'Document type')} data-testid="doc-type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DOC_TYPES.map((d) => (
                <SelectItem key={d.value} value={d.value}>
                  {t(`pos.doc.${d.value}`, d.label)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Button variant="outline" className="h-10" onClick={() => setHeldOpen(true)}>
            <ListRestartIcon /> <span className="hidden sm:inline">{t('pos.held_bills', 'Held bills')}</span>
            {heldCount ? <Badge className="h-5 px-1.5">{heldCount}</Badge> : null}
          </Button>

          {restaurant ? (
            <div className="flex w-full flex-wrap items-center gap-2 lg:w-auto">
              <div className="flex rounded-lg border p-0.5" role="radiogroup" aria-label={t('pos.order_type', 'Order type')}>
                {ORDER_TYPES.map((o) => (
                  <button
                    key={o.value}
                    type="button"
                    role="radio"
                    aria-checked={pos.order_type === o.value}
                    onClick={() => pos.setOrderType(o.value, o.value === 'dine_in' ? pos.table_id : null)}
                    className={cn('rounded-md px-3 py-1.5 text-sm', pos.order_type === o.value ? 'bg-primary text-primary-foreground' : 'hover:bg-muted')}
                  >
                    {t(`pos.order.${o.value}`, o.label)}
                  </button>
                ))}
              </div>
              {pos.order_type === 'dine_in' ? (
                <Select value={pos.table_id ?? 'none'} onValueChange={(v) => void loadTable(v === 'none' ? null : v)}>
                  <SelectTrigger className="h-10 w-36" aria-label={t('pos.table', 'Table')} data-testid="table-select">
                    <SelectValue placeholder={t('pos.table', 'Table')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">{t('pos.no_table', 'No table')}</SelectItem>
                    {(tables ?? []).map((tb) => (
                      <SelectItem key={tb.id} value={tb.id}>
                        {tb.name}
                        {tb.area ? ` · ${tb.area}` : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : null}
              <Button variant="secondary" className="h-10" onClick={() => void sendToKitchen()} disabled={!unsentKot || pos.lines.length === 0} data-testid="send-kot">
                <ChefHatIcon /> {t('pos.send_kot', 'Send KOT')}
              </Button>
            </div>
          ) : null}
        </div>

        {data.loading ? (
          <div className="p-3">
            <LoadingRows rows={8} />
          </div>
        ) : (
          <ProductGrid data={data} products={results} categoryId={categoryId} onCategory={setCategoryId} onPick={(p) => addProduct(p)} />
        )}

        {mobile ? (
          <div className="border-t bg-card p-2">
            <Button className="h-12 w-full justify-between text-base" onClick={() => setCartOpen(true)} data-testid="mobile-cart">
              <span className="flex items-center gap-2">
                <ShoppingCartIcon /> {pos.lines.length} {t('pos.items', 'items')}
                {heldCount ? (
                  <span className="flex items-center gap-1 text-xs opacity-80">
                    <PauseIcon className="size-3" />
                    {heldCount}
                  </span>
                ) : null}
              </span>
              <span className="money font-semibold">{fmt.money(pricing.grand_total)}</span>
            </Button>
          </div>
        ) : null}
      </section>

      {mobile ? (
        <Drawer open={cartOpen} onOpenChange={setCartOpen}>
          <DrawerContent className="h-[92dvh]">
            <DrawerTitle className="sr-only">{t('pos.cart', 'Cart')}</DrawerTitle>
            {cartPanel}
          </DrawerContent>
        </Drawer>
      ) : (
        <div className="w-[340px] shrink-0 border-l lg:w-[400px]">{cartPanel}</div>
      )}

      <VariantPicker
        product={variantFor}
        data={data}
        onClose={() => setVariantFor(null)}
        onPick={(variant) => {
          const product = variantFor!;
          setVariantFor(null);
          addProduct(product, { variant });
        }}
      />
      <SerialPicker
        request={serialFor}
        exclude={pos.lines.flatMap((l) => l.serial_ids)}
        onClose={() => setSerialFor(null)}
        onPick={(serial) => {
          const request = serialFor!;
          setSerialFor(null);
          addProduct(request.product, { variant: request.variant, serial });
        }}
      />
      <QuantityDialog
        request={qtyFor ? { title: qtyFor.variant ? `${qtyFor.product.name} (${qtyFor.variant.name})` : qtyFor.product.name, unit: qtyFor.product.unit_id ? (data.units.get(qtyFor.product.unit_id)?.code ?? null) : null, decimals: true } : null}
        onClose={() => setQtyFor(null)}
        onSubmit={(quantity) => {
          const request = qtyFor!;
          setQtyFor(null);
          addProduct(request.product, { variant: request.variant, quantity });
        }}
      />
      <LineEditor line={editingLine} product={editingLine?.product_id ? (data.products.find((p) => p.id === editingLine.product_id) ?? null) : null} maxDiscountPercent={posSettings.max_discount_percent} onClose={() => setEditKey(null)} />
      <CustomerPicker open={customerOpen} onOpenChange={setCustomerOpen} onPick={pickCustomer} />
      <BillDiscountDialog open={discountOpen} onOpenChange={setDiscountOpen} subtotal={roundTo(pricing.gross_total - pricing.line_discount_total)} maxDiscountPercent={posSettings.max_discount_percent} />
      <HeldSalesDialog
        open={heldOpen}
        onOpenChange={setHeldOpen}
        onResume={async (held) => {
          const current = usePos.getState();
          if (current.lines.length) await holdSale(cartSnapshot(), pricing.grand_total);
          current.load(held);
          toast.success(t('pos.resumed', 'Bill resumed'));
        }}
      />
      <PaymentDialog open={payOpen} onOpenChange={(o) => !busy && setPayOpen(o)} context={paymentContext} busy={busy} onComplete={(payments) => void complete(payments)} />
      <ReceiptDialog
        sale={receipt}
        defaultPaper={printerSettings.paper}
        onClose={() => {
          setReceipt(null);
          window.setTimeout(() => searchRef.current?.focus(), 50);
        }}
      />
    </div>
  );
}
