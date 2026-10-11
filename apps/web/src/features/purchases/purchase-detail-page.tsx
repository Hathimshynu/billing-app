import { useEffect, useState } from 'react';
import { useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useLiveQuery } from 'dexie-react-hooks';
import { toast } from 'sonner';
import { BanIcon, BanknoteIcon, PackageCheckIcon, PrinterIcon, ReceiptIcon, Undo2Icon } from 'lucide-react';
import { PAYMENT_METHOD_LABELS, roundQty, type Purchase } from '@shopdesk/shared';
import { db } from '@/lib/db/business';
import { useFormat, type Formatter } from '@/lib/format';
import { printer } from '@/lib/print/printer';
import { currentRegister } from '@/lib/repos/finance';
import { paySupplier } from '@/lib/repos/parties';
import { cancelPurchase, createPurchaseReturn, receivePurchase } from '@/lib/repos/purchases';
import { useBusiness, useCan } from '@/hooks/use-app';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { confirm } from '@/components/common/confirm';
import { NumberInput } from '@/components/common/number-input';
import { EmptyState, LoadingRows, Page, PageHeader, Section } from '@/components/common/page';
import { PaymentEntryDialog } from '@/components/common/payment-entry-dialog';
import { ResponsiveDialog } from '@/components/common/responsive-dialog';
import { PurchaseStatus } from './purchases-page';

const esc = (v: unknown) =>
  String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

function renderPurchase(p: Purchase, business: string, fmt: Formatter): string {
  const title = p.doc_type === 'order' ? 'PURCHASE ORDER' : 'PURCHASE';
  const rows = p.items
    .map((i, n) => `<tr><td>${n + 1}</td><td>${esc(i.name)}${i.batch_no ? `<br/><small>Batch ${esc(i.batch_no)}${i.expiry_date ? ` · Exp ${esc(i.expiry_date)}` : ''}</small>` : ''}</td><td class="r">${esc(i.quantity)}</td><td class="r">${esc(fmt.money(i.unit_cost))}</td><td class="r">${esc(fmt.money(i.taxable))}</td><td class="r">${esc(fmt.money(i.tax_total))}</td><td class="r">${esc(fmt.money(i.total))}</td></tr>`)
    .join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title} ${esc(p.purchase_number)}</title><style>
    @page { size: A4; margin: 14mm; } body { font: 11px/1.45 Arial, sans-serif; color: #111; } h1 { font-size: 18px; margin: 0; }
    table { width: 100%; border-collapse: collapse; margin-top: 12px; } th, td { border: 1px solid #ddd; padding: 5px; text-align: left; } th { background: #f3f4f6; } .r { text-align: right; }
    .tot { margin-top: 10px; text-align: right; font-size: 14px; font-weight: 700; }
  </style></head><body>
    <h1>${esc(business)}</h1><p><b>${title}</b> ${esc(p.purchase_number)} · ${esc(fmt.date(p.purchase_date))}<br/>Supplier: <b>${esc(p.supplier_name)}</b>${p.supplier_invoice_no ? ` · Bill ${esc(p.supplier_invoice_no)}` : ''}${p.expected_date ? `<br/>Expected: ${esc(fmt.date(p.expected_date))}` : ''}</p>
    <table><thead><tr><th>#</th><th>Item</th><th class="r">Qty</th><th class="r">Rate</th><th class="r">Taxable</th><th class="r">Tax</th><th class="r">Amount</th></tr></thead><tbody>${rows}</tbody></table>
    <div class="tot">Total: ${esc(fmt.money(p.grand_total))}</div>${p.notes ? `<p>${esc(p.notes)}</p>` : ''}
  </body></html>`;
}

export default function PurchaseDetailPage() {
  const { id = '' } = useParams();
  const { t } = useTranslation();
  const fmt = useFormat();
  const can = useCan();
  const business = useBusiness();
  const [receiveOpen, setReceiveOpen] = useState(false);
  const [returnOpen, setReturnOpen] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const purchase = useLiveQuery(() => db().purchases.get(id), [id]);
  const returns = useLiveQuery(() => db().purchase_returns.where('purchase_id').equals(id).toArray(), [id]);
  const payments = useLiveQuery(() => db().supplier_payments.filter((p) => p.purchase_id === id).toArray(), [id]);

  if (purchase === undefined) {
    return (
      <Page>
        <LoadingRows />
      </Page>
    );
  }
  if (!purchase) {
    return (
      <Page>
        <EmptyState icon={ReceiptIcon} title={t('purchase.not_found', 'Purchase not found')} />
      </Page>
    );
  }
  const active = purchase.status !== 'cancelled';
  const canReceive = active && purchase.doc_type === 'order' && purchase.status !== 'received' && can('purchases.edit');
  const canReturn = active && purchase.status !== 'ordered' && can('purchases.return') && purchase.items.some((i) => i.received_qty - i.returned_qty > 0);
  const canPay = active && purchase.status !== 'ordered' && purchase.balance_due > 0 && can('suppliers.payments');
  const canCancel = active && can('purchases.delete') && purchase.returned_total === 0;

  return (
    <Page>
      <PageHeader
        back="/purchases"
        title={
          <span className="flex flex-wrap items-center gap-2">
            {purchase.purchase_number} <PurchaseStatus purchase={purchase} />
          </span>
        }
        description={`${purchase.supplier_name ?? ''} · ${fmt.date(purchase.purchase_date)}${purchase.supplier_invoice_no ? ` · ${t('purchase.supplier_bill', 'Supplier bill')} ${purchase.supplier_invoice_no}` : ''}`}
        actions={
          <>
            <Button variant="outline" onClick={() => void printer.print(renderPurchase(purchase, business?.name ?? '', fmt))}>
              <PrinterIcon /> {t('receipt.print', 'Print')}
            </Button>
            {canReceive ? (
              <Button onClick={() => setReceiveOpen(true)}>
                <PackageCheckIcon /> {t('purchase.receive', 'Receive stock')}
              </Button>
            ) : null}
            {canPay ? (
              <Button variant="outline" onClick={() => setPayOpen(true)}>
                <BanknoteIcon /> {t('supplier.pay', 'Pay supplier')}
              </Button>
            ) : null}
            {canReturn ? (
              <Button variant="outline" onClick={() => setReturnOpen(true)}>
                <Undo2Icon /> {t('purchase.return', 'Return to supplier')}
              </Button>
            ) : null}
            {canCancel ? (
              <Button
                variant="destructive"
                onClick={async () => {
                  const { confirmed } = await confirm({ title: t('purchase.cancel_title', 'Cancel {{number}}?', { number: purchase.purchase_number }), description: t('purchase.cancel_hint', 'Received stock is removed and the supplier balance reversed.'), destructive: true, confirmLabel: t('purchase.cancel', 'Cancel purchase') });
                  if (!confirmed) return;
                  try {
                    await cancelPurchase(purchase.id);
                    toast.success(t('purchase.cancelled', 'Purchase cancelled'));
                  } catch (error) {
                    toast.error(error instanceof Error ? error.message : String(error));
                  }
                }}
              >
                <BanIcon /> {t('purchase.cancel', 'Cancel purchase')}
              </Button>
            ) : null}
          </>
        }
      />
      <div className="space-y-5">
        <Section title={t('purchase.items', 'Items')}>
          <div className="-mx-4 -my-4 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('sale.item', 'Item')}</TableHead>
                  <TableHead className="text-right">{t('sale.qty', 'Qty')}</TableHead>
                  {purchase.doc_type === 'order' ? <TableHead className="text-right">{t('purchase.received_col', 'Received')}</TableHead> : null}
                  <TableHead className="text-right">{t('purchase.returned_col', 'Returned')}</TableHead>
                  <TableHead className="text-right">{t('purchase.cost', 'Cost')}</TableHead>
                  <TableHead className="hidden text-right md:table-cell">{t('sale.tax', 'Tax')}</TableHead>
                  <TableHead className="text-right">{t('sale.amount', 'Amount')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {purchase.items.map((i) => (
                  <TableRow key={i.id}>
                    <TableCell className="whitespace-normal">
                      <span className="font-medium">{i.name}</span>
                      <span className="block text-xs text-muted-foreground">{[i.batch_no ? `${t('product.batch_no', 'Batch no.')} ${i.batch_no}` : null, i.expiry_date ? `exp ${fmt.date(i.expiry_date)}` : null, i.serial_numbers.length ? i.serial_numbers.join(', ') : null].filter(Boolean).join(' · ')}</span>
                    </TableCell>
                    <TableCell className="text-right">{fmt.qty(i.quantity)}</TableCell>
                    {purchase.doc_type === 'order' ? <TableCell className="text-right">{fmt.qty(i.received_qty)}</TableCell> : null}
                    <TableCell className="text-right">{i.returned_qty ? fmt.qty(i.returned_qty) : '—'}</TableCell>
                    <TableCell className="money text-right">{fmt.money(i.unit_cost)}</TableCell>
                    <TableCell className="money hidden text-right md:table-cell">{fmt.money(i.tax_total)}</TableCell>
                    <TableCell className="money text-right font-medium">{fmt.money(i.total)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <dl className="mt-6 ml-auto grid max-w-xs grid-cols-2 gap-y-1 text-sm">
            <dt className="text-muted-foreground">{t('pos.subtotal', 'Subtotal')}</dt>
            <dd className="money text-right">{fmt.money(purchase.gross_total)}</dd>
            {purchase.discount_total ? (
              <>
                <dt className="text-muted-foreground">{t('pos.discount', 'Discount')}</dt>
                <dd className="money text-right">−{fmt.money(purchase.discount_total)}</dd>
              </>
            ) : null}
            <dt className="text-muted-foreground">{t('pos.tax', 'Tax')}</dt>
            <dd className="money text-right">{fmt.money(purchase.tax_total)}</dd>
            {purchase.charges_total ? (
              <>
                <dt className="text-muted-foreground">{t('pos.charges', 'Charges')}</dt>
                <dd className="money text-right">{fmt.money(purchase.charges_total)}</dd>
              </>
            ) : null}
            <dt className="border-t pt-1 font-semibold">{t('pos.total', 'TOTAL')}</dt>
            <dd className="money border-t pt-1 text-right font-bold">{fmt.money(purchase.grand_total)}</dd>
            <dt className="text-muted-foreground">{t('receipt.paid', 'Paid')}</dt>
            <dd className="money text-right">{fmt.money(purchase.paid_total)}</dd>
            <dt className="text-muted-foreground">{t('receipt.balance', 'Balance due')}</dt>
            <dd className="money text-right">{fmt.money(purchase.balance_due)}</dd>
          </dl>
        </Section>
        <div className="grid gap-5 md:grid-cols-2">
          <Section title={t('sale.payments', 'Payments')}>
            <ul className="space-y-1.5 text-sm">
              {purchase.payments.map((p) => (
                <li key={p.id} className="flex justify-between">
                  <span>{PAYMENT_METHOD_LABELS[p.method]}</span>
                  <span className="money">{fmt.money(p.amount)}</span>
                </li>
              ))}
              {(payments ?? []).map((p) => (
                <li key={p.id} className="flex justify-between">
                  <span>
                    {PAYMENT_METHOD_LABELS[p.method]} · {p.payment_number} · {fmt.date(p.payment_date)}
                  </span>
                  <span className="money">{fmt.money(p.amount)}</span>
                </li>
              ))}
              {!purchase.payments.length && !payments?.length ? <li className="text-muted-foreground">{t('sale.no_payments', 'No payments recorded.')}</li> : null}
            </ul>
          </Section>
          <Section title={t('purchase.returns', 'Returns to supplier')}>
            {returns?.length ? (
              <ul className="space-y-1.5 text-sm">
                {returns.map((r) => (
                  <li key={r.id} className="flex justify-between">
                    <span>
                      {r.return_number} · {fmt.date(r.return_date)}
                    </span>
                    <span className="money">{fmt.money(r.total)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">{t('sale.no_returns', 'No returns.')}</p>
            )}
          </Section>
        </div>
        {purchase.notes ? <p className="text-sm text-muted-foreground">{purchase.notes}</p> : null}
      </div>

      {canReceive ? <ReceiveDialog purchase={purchase} open={receiveOpen} onOpenChange={setReceiveOpen} /> : null}
      {canReturn ? <PurchaseReturnDialog purchase={purchase} open={returnOpen} onOpenChange={setReturnOpen} /> : null}
      {canPay ? (
        <PaymentEntryDialog
          open={payOpen}
          onOpenChange={setPayOpen}
          title={t('supplier.pay', 'Pay supplier')}
          description={`${purchase.purchase_number} · ${t('receipt.balance', 'Balance due')} ${fmt.money(purchase.balance_due)}`}
          suggested={purchase.balance_due}
          onSubmit={async (input) => {
            if (input.amount > purchase.balance_due + 0.001) throw new Error(t('sale.overpay', 'Amount is more than the balance due.'));
            const register = input.method === 'cash' ? await currentRegister() : undefined;
            await paySupplier(purchase.supplier_id, { ...input, purchase_id: purchase.id, register_id: register?.id ?? null });
            toast.success(t('supplier.paid', 'Payment recorded'));
          }}
        />
      ) : null}
    </Page>
  );
}

function ReceiveDialog({ purchase, open, onOpenChange }: { purchase: Purchase; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t } = useTranslation();
  const [state, setState] = useState<Record<string, { qty: number | null; batch: string; expiry: string; serials: string }>>({});
  const [saving, setSaving] = useState(false);
  const tracking = useLiveQuery(async () => new Map((await db().products.bulkGet(purchase.items.map((i) => i.product_id))).filter((p) => !!p).map((p) => [p!.id, p!])), [purchase.id]);

  useEffect(() => {
    if (open) setState(Object.fromEntries(purchase.items.map((i) => [i.id, { qty: roundQty(i.quantity - i.received_qty), batch: i.batch_no ?? '', expiry: i.expiry_date ?? '', serials: '' }])));
  }, [open, purchase]);

  const save = async () => {
    const lines = [];
    for (const item of purchase.items) {
      const s = state[item.id];
      const qty = s?.qty ?? 0;
      if (qty <= 0) continue;
      const product = tracking?.get(item.product_id);
      if (qty > roundQty(item.quantity - item.received_qty)) return toast.error(t('purchase.over_receive', '{{name}}: more than ordered.', { name: item.name }));
      if (product?.track_batch && !s!.batch) return toast.error(t('purchase.need_batch', '{{name}}: enter the batch number.', { name: item.name }));
      if (product?.track_batch && product.track_expiry && !s!.expiry) return toast.error(t('purchase.need_expiry', '{{name}}: enter the expiry date.', { name: item.name }));
      const serials = s!.serials.split(/[\n,]+/).map((x) => x.trim()).filter(Boolean);
      if (product?.track_serial && serials.length !== qty) return toast.error(t('purchase.need_serials', '{{name}}: enter {{qty}} IMEI / serial numbers (one per line).', { name: item.name, qty }));
      lines.push({ purchase_item_id: item.id, quantity: qty, batch_no: s!.batch || null, expiry_date: s!.expiry || null, serial_numbers: serials });
    }
    if (!lines.length) return toast.error(t('purchase.nothing', 'Enter quantities to receive.'));
    setSaving(true);
    try {
      await receivePurchase(purchase.id, lines);
      toast.success(t('purchase.received_ok', 'Stock received'));
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange} size="lg" dismissible={!saving} title={t('purchase.receive', 'Receive stock')} footer={<Button onClick={() => void save()} disabled={saving}>{t('purchase.receive', 'Receive stock')}</Button>}>
      <ul className="divide-y rounded-lg border">
        {purchase.items
          .filter((i) => i.quantity - i.received_qty > 0)
          .map((item) => {
            const s = state[item.id];
            const product = tracking?.get(item.product_id);
            const set = (patch: Partial<NonNullable<typeof s>>) => setState((st) => ({ ...st, [item.id]: { ...st[item.id]!, ...patch } }));
            return (
              <li key={item.id} className="space-y-2 p-3">
                <div className="flex items-center gap-2">
                  <span className="flex-1 text-sm font-medium">{item.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {t('purchase.pending_qty', 'Pending')} {roundQty(item.quantity - item.received_qty)}
                  </span>
                  <NumberInput className="w-24" decimals={3} value={s?.qty ?? null} onValueChange={(v) => set({ qty: v })} />
                </div>
                {product?.track_batch ? (
                  <div className="flex gap-2">
                    <Input className="h-8 w-36" placeholder={t('product.batch_no', 'Batch no.')} value={s?.batch ?? ''} onChange={(e) => set({ batch: e.target.value })} />
                    <Input className="h-8 w-40" type="date" value={s?.expiry ?? ''} onChange={(e) => set({ expiry: e.target.value })} />
                  </div>
                ) : null}
                {product?.track_serial ? <Textarea className="font-mono text-xs" rows={2} placeholder={t('purchase.serials', 'IMEI / serial numbers, one per line')} value={s?.serials ?? ''} onChange={(e) => set({ serials: e.target.value })} /> : null}
              </li>
            );
          })}
      </ul>
    </ResponsiveDialog>
  );
}

function PurchaseReturnDialog({ purchase, open, onOpenChange }: { purchase: Purchase; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t } = useTranslation();
  const [qty, setQty] = useState<Record<string, number | null>>({});
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (open) {
      setQty({});
      setReason('');
    }
  }, [open]);
  const save = async () => {
    const lines = purchase.items.map((i) => ({ purchase_item_id: i.id, quantity: qty[i.id] ?? 0, max: roundQty(i.received_qty - i.returned_qty), name: i.name })).filter((l) => l.quantity > 0);
    const over = lines.find((l) => l.quantity > l.max);
    if (over) return toast.error(t('return.too_many', 'You can return at most {{max}} of {{name}}.', { max: over.max, name: over.name }));
    if (!lines.length) return toast.error(t('return.none', 'Enter the quantity being returned.'));
    setSaving(true);
    try {
      const ret = await createPurchaseReturn(purchase.id, lines.map(({ purchase_item_id, quantity }) => ({ purchase_item_id, quantity })), reason.trim() || null);
      toast.success(t('purchase.return_done', 'Debit note {{number}} created', { number: ret.return_number }));
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };
  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange} dismissible={!saving} title={t('purchase.return', 'Return to supplier')} footer={<Button onClick={() => void save()} disabled={saving}>{t('purchase.create_return', 'Create debit note')}</Button>}>
      <div className="space-y-3">
        <ul className="divide-y rounded-lg border">
          {purchase.items
            .filter((i) => i.received_qty - i.returned_qty > 0)
            .map((i) => (
              <li key={i.id} className="flex items-center gap-2 p-3">
                <span className="flex-1 text-sm">{i.name}</span>
                <span className="text-xs text-muted-foreground">≤ {roundQty(i.received_qty - i.returned_qty)}</span>
                <NumberInput className="w-24" decimals={3} value={qty[i.id] ?? null} onValueChange={(v) => setQty((q) => ({ ...q, [i.id]: v }))} disabled={i.serial_numbers.length > 0} />
              </li>
            ))}
        </ul>
        <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t('return.reason', 'Reason')} />
      </div>
    </ResponsiveDialog>
  );
}
