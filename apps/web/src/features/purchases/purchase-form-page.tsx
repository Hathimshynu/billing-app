import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useLiveQuery } from 'dexie-react-hooks';
import { toast } from 'sonner';
import { PlusIcon, SaveIcon, Trash2Icon } from 'lucide-react';
import { PAYMENT_METHOD_LABELS, roundQty, uuidv7, type DiscountType, type PaymentMethod, type Supplier } from '@shopdesk/shared';
import { db, type LocalProduct } from '@/lib/db/business';
import { useFormat } from '@/lib/format';
import { supplyTypeFor, taxSnapshot } from '@/lib/pos/cart';
import { createPurchase, pricePurchase, type PurchaseLineInput } from '@/lib/repos/purchases';
import { useBusiness } from '@/hooks/use-app';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { todayString } from '@/components/common/date-range';
import { FormGrid, FormRow } from '@/components/common/form';
import { NumberInput } from '@/components/common/number-input';
import { Page, PageHeader, Section } from '@/components/common/page';
import { ProductSearch, type ProductPick } from '@/components/common/product-search';
import { SupplierFormDialog } from '@/features/parties/party-form';

interface Line extends PurchaseLineInput {
  key: string;
  track_batch: boolean;
  track_expiry: boolean;
  track_serial: boolean;
  serial_text: string;
}

const PAY_METHODS: PaymentMethod[] = ['cash', 'upi', 'card', 'bank_transfer', 'other'];

export default function PurchaseFormPage() {
  const { t } = useTranslation();
  const fmt = useFormat();
  const navigate = useNavigate();
  const business = useBusiness();
  const [params] = useSearchParams();
  const [supplierId, setSupplierId] = useState<string>(params.get('supplier') ?? '');
  const [supplierOpen, setSupplierOpen] = useState(false);
  const [docType, setDocType] = useState<'invoice' | 'order'>(params.get('type') === 'order' ? 'order' : 'invoice');
  const [date, setDate] = useState(todayString());
  const [expected, setExpected] = useState('');
  const [billNo, setBillNo] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [charges, setCharges] = useState<Array<{ key: string; name: string; amount: number }>>([]);
  const [discountType, setDiscountType] = useState<DiscountType>('amount');
  const [discount, setDiscount] = useState<number | null>(null);
  const [paidNow, setPaidNow] = useState<number | null>(null);
  const [payMethod, setPayMethod] = useState<PaymentMethod>('cash');
  const [payRef, setPayRef] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const suppliers = useLiveQuery(() => db().suppliers.filter((s) => s.active && !s.deleted_at).sortBy('name'), []);
  const taxes = useLiveQuery(() => db().tax_rates.filter((x) => !x.deleted_at && x.active).toArray(), []);
  const supplier = suppliers?.find((s) => s.id === supplierId);
  const supplyType = supplyTypeFor(business?.state_code ?? null, supplier?.state_code ?? null, business?.tax_system ?? 'gst');

  const pricing = useMemo(() => pricePurchase({ lines, charges, bill_discount_type: discount ? discountType : null, bill_discount_value: discount, supply_type: supplyType }), [lines, charges, discount, discountType, supplyType]);
  useEffect(() => {
    if (docType === 'order') setPaidNow(null);
  }, [docType]);

  const addLine = async ({ product, variant }: ProductPick) => {
    const existing = lines.find((l) => l.product_id === product.id && l.variant_id === (variant?.id ?? null) && !l.track_batch && !l.track_serial);
    if (existing) {
      setLines((ls) => ls.map((l) => (l.key === existing.key ? { ...l, quantity: roundQty(l.quantity + 1) } : l)));
      return;
    }
    const tax = product.tax_rate_id ? await db().tax_rates.get(product.tax_rate_id) : undefined;
    setLines((ls) => [...ls, newLine(product, variant, tax)]);
  };

  const update = (key: string, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const save = async () => {
    if (!supplierId) return toast.error(t('purchase.need_supplier', 'Choose a supplier.'));
    if (!lines.length) return toast.error(t('purchase.need_items', 'Add at least one item.'));
    for (const l of lines) {
      if (l.quantity <= 0) return toast.error(t('purchase.qty_positive', '{{name}}: quantity must be more than zero.', { name: l.name }));
      if (docType === 'invoice' && l.track_batch && !l.batch_no) return toast.error(t('purchase.need_batch', '{{name}}: enter the batch number.', { name: l.name }));
      if (docType === 'invoice' && l.track_expiry && !l.expiry_date) return toast.error(t('purchase.need_expiry', '{{name}}: enter the expiry date.', { name: l.name }));
      if (docType === 'invoice' && l.track_serial) {
        const serials = parseSerials(l.serial_text);
        if (serials.length !== l.quantity) return toast.error(t('purchase.need_serials', '{{name}}: enter {{qty}} IMEI / serial numbers (one per line).', { name: l.name, qty: l.quantity }));
        if (new Set(serials).size !== serials.length) return toast.error(t('purchase.dup_serials', '{{name}}: duplicate serial numbers.', { name: l.name }));
        const known = await db().product_serials.where('serial_no').anyOf(serials).filter((s) => !s.deleted_at).first();
        if (known) return toast.error(t('purchase.serial_exists', 'Serial {{serial}} already exists.', { serial: known.serial_no }));
      }
    }
    if ((paidNow ?? 0) > pricing.grand_total + 0.001) return toast.error(t('purchase.overpaid', 'Paid amount is more than the bill total.'));
    setSaving(true);
    try {
      const purchase = await createPurchase({
        supplier_id: supplierId,
        doc_type: docType,
        purchase_date: date,
        expected_date: docType === 'order' ? expected || null : null,
        supplier_invoice_no: billNo.trim() || null,
        supply_type: supplyType,
        lines: lines.map(({ key: _k, track_batch: _b, track_expiry: _e, track_serial: _s, serial_text, ...l }) => ({ ...l, serial_numbers: l.serial_numbers.length ? l.serial_numbers : parseSerials(serial_text) })),
        charges: charges.filter((c) => c.amount > 0 && c.name.trim()),
        bill_discount_type: discount ? discountType : null,
        bill_discount_value: discount,
        payment: docType === 'invoice' && paidNow ? { method: payMethod, amount: paidNow, reference: payRef.trim() || null } : null,
        notes: notes.trim() || null,
      });
      toast.success(docType === 'invoice' ? t('purchase.saved', 'Purchase saved. Stock updated.') : t('purchase.order_saved', 'Purchase order saved'));
      navigate(`/purchases/${purchase.id}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Page className="max-w-6xl">
      <PageHeader
        back="/purchases"
        title={docType === 'invoice' ? t('purchase.new', 'New purchase') : t('purchase.new_order', 'New purchase order')}
        actions={
          <Button onClick={() => void save()} disabled={saving} data-testid="purchase-save">
            <SaveIcon /> {t('common.save', 'Save')}
          </Button>
        }
      />
      <div className="space-y-5">
        <Section title={t('purchase.details', 'Details')}>
          <FormGrid cols={3}>
            <FormRow label={t('purchase.supplier', 'Supplier')} required>
              <div className="flex gap-1">
                <Select value={supplierId} onValueChange={setSupplierId}>
                  <SelectTrigger className="w-full" data-testid="purchase-supplier">
                    <SelectValue placeholder={t('purchase.choose_supplier', 'Choose supplier')} />
                  </SelectTrigger>
                  <SelectContent>
                    {(suppliers ?? []).map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button variant="outline" size="icon" onClick={() => setSupplierOpen(true)} aria-label={t('supplier.new', 'New supplier')}>
                  <PlusIcon />
                </Button>
              </div>
            </FormRow>
            <FormRow label={t('purchase.type', 'Type')}>
              <Select value={docType} onValueChange={(v) => setDocType(v as 'invoice' | 'order')}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="invoice">{t('purchase.type_invoice', 'Purchase bill (stock in now)')}</SelectItem>
                  <SelectItem value="order">{t('purchase.type_order', 'Purchase order (receive later)')}</SelectItem>
                </SelectContent>
              </Select>
            </FormRow>
            <FormRow label={t('purchase.date', 'Date')} htmlFor="p-date">
              <Input id="p-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </FormRow>
            <FormRow label={t('purchase.supplier_bill', 'Supplier bill no.')} htmlFor="p-bill">
              <Input id="p-bill" value={billNo} onChange={(e) => setBillNo(e.target.value)} />
            </FormRow>
            {docType === 'order' ? (
              <FormRow label={t('purchase.expected', 'Expected delivery')} htmlFor="p-exp">
                <Input id="p-exp" type="date" value={expected} onChange={(e) => setExpected(e.target.value)} />
              </FormRow>
            ) : null}
            <FormRow label={t('purchase.supply', 'Tax type')}>
              <p className="text-sm text-muted-foreground">{supplyType === 'inter' ? 'IGST (inter-state)' : supplyType === 'none' ? t('purchase.no_gst', 'No GST') : 'CGST + SGST (intra-state)'}</p>
            </FormRow>
          </FormGrid>
        </Section>

        <Section title={t('purchase.items', 'Items')} actions={<ProductSearch className="w-72" onPick={(p) => void addLine(p)} filter={(p) => p.product_type !== 'service'} />}>
          {lines.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">{t('purchase.add_hint', 'Search or scan products to add them to this purchase.')}</p>
          ) : (
            <div className="-mx-4 overflow-x-auto">
              <table className="w-full min-w-[900px] text-sm">
                <thead className="text-left text-xs text-muted-foreground">
                  <tr className="border-b">
                    <th className="px-2 py-2">{t('sale.item', 'Item')}</th>
                    <th className="px-2 py-2 text-right">{t('sale.qty', 'Qty')}</th>
                    <th className="px-2 py-2 text-right">{t('purchase.cost', 'Cost')}</th>
                    <th className="px-2 py-2 text-right">{t('purchase.disc', 'Disc %')}</th>
                    <th className="px-2 py-2">{t('product.tax', 'Tax rate')}</th>
                    <th className="px-2 py-2 text-right">MRP</th>
                    <th className="px-2 py-2 text-right">{t('purchase.sell', 'Sell price')}</th>
                    <th className="px-2 py-2 text-right">{t('sale.amount', 'Amount')}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l, i) => (
                    <tr key={l.key} className="border-b align-top">
                      <td className="px-2 py-2">
                        <p className="font-medium">{l.name}</p>
                        {(l.track_batch || l.track_serial) && docType === 'invoice' ? (
                          <div className="mt-1.5 flex flex-wrap gap-1.5">
                            {l.track_batch ? <Input className="h-7 w-28" placeholder={t('product.batch_no', 'Batch no.')} value={l.batch_no ?? ''} onChange={(e) => update(l.key, { batch_no: e.target.value || null })} /> : null}
                            {l.track_batch ? <Input className="h-7 w-36" type="date" title={t('product.expiry', 'Expiry date')} value={l.expiry_date ?? ''} onChange={(e) => update(l.key, { expiry_date: e.target.value || null })} /> : null}
                            {l.track_serial ? (
                              <Textarea
                                className="min-h-14 w-64 font-mono text-xs"
                                placeholder={t('purchase.serials', 'IMEI / serial numbers, one per line')}
                                value={l.serial_text}
                                onChange={(e) => {
                                  const serials = parseSerials(e.target.value);
                                  update(l.key, { serial_text: e.target.value, quantity: Math.max(serials.length, 1) });
                                }}
                              />
                            ) : null}
                          </div>
                        ) : null}
                      </td>
                      <td className="px-2 py-2">
                        <NumberInput className="ml-auto h-8 w-20" decimals={3} value={l.quantity} onValueChange={(v) => update(l.key, { quantity: v ?? 0 })} disabled={l.track_serial && docType === 'invoice'} />
                      </td>
                      <td className="px-2 py-2">
                        <NumberInput className="ml-auto h-8 w-24" value={l.unit_cost} onValueChange={(v) => update(l.key, { unit_cost: v ?? 0 })} />
                      </td>
                      <td className="px-2 py-2">
                        <NumberInput className="ml-auto h-8 w-16" value={l.discount_value} onValueChange={(v) => update(l.key, { discount_type: v ? 'percent' : null, discount_value: v })} />
                      </td>
                      <td className="px-2 py-2">
                        <select
                          className="h-8 w-28 rounded-lg border bg-background px-1 text-sm"
                          value={l.tax_rate_id ?? ''}
                          onChange={(e) => {
                            const tax = (taxes ?? []).find((x) => x.id === e.target.value);
                            update(l.key, { tax_rate_id: tax?.id ?? null, tax: taxSnapshot(tax) });
                          }}
                        >
                          <option value="">{t('product.no_tax', 'No tax')}</option>
                          {(taxes ?? []).map((x) => (
                            <option key={x.id} value={x.id}>
                              {x.name}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-2 py-2">
                        <NumberInput className="ml-auto h-8 w-20" value={l.mrp} onValueChange={(v) => update(l.key, { mrp: v })} />
                      </td>
                      <td className="px-2 py-2">
                        <NumberInput className="ml-auto h-8 w-20" value={l.selling_price} onValueChange={(v) => update(l.key, { selling_price: v })} />
                      </td>
                      <td className="money px-2 py-2 text-right font-medium">{fmt.money(pricing.lines[i]?.total ?? 0)}</td>
                      <td className="px-1 py-2">
                        <Button variant="ghost" size="icon-sm" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} aria-label={t('common.remove', 'Remove')}>
                          <Trash2Icon />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>

        <div className="grid gap-5 lg:grid-cols-2">
          <Section title={t('purchase.extras', 'Charges, discount & notes')}>
            <div className="space-y-3">
              {charges.map((c) => (
                <div key={c.key} className="flex gap-2">
                  <Input value={c.name} onChange={(e) => setCharges((cs) => cs.map((x) => (x.key === c.key ? { ...x, name: e.target.value } : x)))} placeholder={t('purchase.charge_name', 'Freight, packing…')} />
                  <NumberInput className="w-28" value={c.amount} onValueChange={(v) => setCharges((cs) => cs.map((x) => (x.key === c.key ? { ...x, amount: v ?? 0 } : x)))} />
                  <Button variant="ghost" size="icon" onClick={() => setCharges((cs) => cs.filter((x) => x.key !== c.key))} aria-label={t('common.remove', 'Remove')}>
                    <Trash2Icon />
                  </Button>
                </div>
              ))}
              <Button variant="outline" size="sm" onClick={() => setCharges((cs) => [...cs, { key: uuidv7(), name: 'Freight', amount: 0 }])}>
                <PlusIcon /> {t('purchase.add_charge', 'Add charge')}
              </Button>
              <div className="flex items-center gap-2">
                <span className="text-sm">{t('pos.bill_discount', 'Bill discount')}</span>
                <select className="h-8 rounded-lg border bg-background px-2 text-sm" value={discountType} onChange={(e) => setDiscountType(e.target.value as DiscountType)}>
                  <option value="amount">{fmt.currency}</option>
                  <option value="percent">%</option>
                </select>
                <NumberInput className="w-28" value={discount} onValueChange={setDiscount} />
              </div>
              <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t('common.notes', 'Notes')} />
            </div>
          </Section>
          <Section title={t('purchase.summary', 'Summary')}>
            <dl className="grid grid-cols-2 gap-y-1 text-sm">
              <dt className="text-muted-foreground">{t('pos.subtotal', 'Subtotal')}</dt>
              <dd className="money text-right">{fmt.money(pricing.gross_total)}</dd>
              <dt className="text-muted-foreground">{t('pos.discount', 'Discount')}</dt>
              <dd className="money text-right">−{fmt.money(pricing.discount_total)}</dd>
              {pricing.tax_breakup.map((r) => (
                <div key={`${r.code}${r.rate}`} className="contents">
                  <dt className="text-muted-foreground">
                    {r.name} {r.rate}%
                  </dt>
                  <dd className="money text-right">{fmt.money(r.amount)}</dd>
                </div>
              ))}
              {pricing.charges_total ? (
                <>
                  <dt className="text-muted-foreground">{t('pos.charges', 'Charges')}</dt>
                  <dd className="money text-right">{fmt.money(pricing.charges_total)}</dd>
                </>
              ) : null}
              <dt className="border-t pt-1 font-semibold">{t('pos.total', 'TOTAL')}</dt>
              <dd className="money border-t pt-1 text-right text-lg font-bold">{fmt.money(pricing.grand_total)}</dd>
            </dl>
            {docType === 'invoice' ? (
              <div className="mt-4 space-y-2 rounded-lg border p-3">
                <p className="text-sm font-medium">{t('purchase.paid_now', 'Paid now')}</p>
                <div className="flex flex-wrap gap-2">
                  <NumberInput className="w-32" value={paidNow} onValueChange={setPaidNow} placeholder="0" />
                  <Button variant="outline" size="sm" className="h-8" onClick={() => setPaidNow(pricing.grand_total)}>
                    {t('purchase.full', 'Full')}
                  </Button>
                  <select className="h-8 rounded-lg border bg-background px-2 text-sm" value={payMethod} onChange={(e) => setPayMethod(e.target.value as PaymentMethod)}>
                    {PAY_METHODS.map((m) => (
                      <option key={m} value={m}>
                        {PAYMENT_METHOD_LABELS[m]}
                      </option>
                    ))}
                  </select>
                  <Input className="h-8 w-40" placeholder={t('payment.reference', 'Reference / transaction ID')} value={payRef} onChange={(e) => setPayRef(e.target.value)} />
                </div>
                <p className="text-xs text-muted-foreground">
                  {t('purchase.balance_to_supplier', 'Balance added to supplier account')}: {fmt.money(Math.max(pricing.grand_total - (paidNow ?? 0), 0))}
                </p>
              </div>
            ) : null}
          </Section>
        </div>
      </div>
      <SupplierFormDialog open={supplierOpen} onOpenChange={setSupplierOpen} supplier={null} onSaved={(s: Supplier) => setSupplierId(s.id)} />
    </Page>
  );
}

function parseSerials(text: string): string[] {
  return text
    .split(/[\n,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function newLine(product: LocalProduct, variant: ProductPick['variant'], tax: Parameters<typeof taxSnapshot>[0]): Line {
  return {
    key: uuidv7(),
    product_id: product.id,
    variant_id: variant?.id ?? null,
    name: variant ? `${product.name} (${variant.name})` : product.name,
    quantity: 1,
    unit_cost: variant?.purchase_price ?? product.purchase_price,
    mrp: variant?.mrp ?? product.mrp,
    selling_price: variant?.selling_price ?? product.selling_price,
    discount_type: null,
    discount_value: null,
    tax_rate_id: tax?.id ?? null,
    tax: taxSnapshot(tax),
    batch_no: null,
    expiry_date: null,
    mfg_date: null,
    serial_numbers: [],
    track_batch: product.track_batch,
    track_expiry: product.track_batch && product.track_expiry,
    track_serial: product.track_serial,
    serial_text: '',
  };
}
