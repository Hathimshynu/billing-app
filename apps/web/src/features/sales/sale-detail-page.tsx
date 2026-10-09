import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useLiveQuery } from 'dexie-react-hooks';
import { toast } from 'sonner';
import { BanIcon, ChevronDownIcon, EyeIcon, FileTextIcon, FlagIcon, HandCoinsIcon, PencilIcon, PrinterIcon, RefreshCcwIcon, Undo2Icon } from 'lucide-react';
import { INDIAN_STATES, PAYMENT_METHOD_LABELS, type PrinterSettings } from '@shopdesk/shared';
import { db } from '@/lib/db/business';
import { useFormat } from '@/lib/format';
import { previewSale, printCreditNote, printSale } from '@/lib/print';
import { cancelSale } from '@/lib/repos/sales';
import { receiveCustomerPayment } from '@/lib/repos/parties';
import { currentRegister } from '@/lib/repos/finance';
import { useCan } from '@/hooks/use-app';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { confirm } from '@/components/common/confirm';
import { EmptyState, LoadingRows, Page, PageHeader, Section } from '@/components/common/page';
import { PaymentEntryDialog } from '@/components/common/payment-entry-dialog';
import { usePos } from '@/features/pos/pos-store';
import { ReturnDialog } from './return-dialog';
import { DOC_LABELS, REVIEW_FLAG_LABELS, SaleBadges, saleToCart } from './sale-utils';

export default function SaleDetailPage() {
  const { id = '' } = useParams();
  const { t } = useTranslation();
  const fmt = useFormat();
  const can = useCan();
  const navigate = useNavigate();
  const [returnOpen, setReturnOpen] = useState(false);
  const [payOpen, setPayOpen] = useState(false);

  const sale = useLiveQuery(() => db().sales.get(id), [id]);
  const returns = useLiveQuery(() => db().sale_returns.where('sale_id').equals(id).toArray(), [id]);
  const payments = useLiveQuery(() => db().customer_payments.filter((p) => p.sale_id === id).toArray(), [id]);

  if (sale === undefined) {
    return (
      <Page>
        <LoadingRows />
      </Page>
    );
  }
  if (!sale) {
    return (
      <Page>
        <EmptyState icon={FileTextIcon} title={t('sale.not_found', 'Invoice not found on this device')} description={t('sale.not_found_hint', 'It may belong to another store or has not synced to this device yet.')} />
      </Page>
    );
  }

  const isInvoice = sale.doc_type === 'invoice';
  const active = sale.status === 'completed';
  const canReturn = isInvoice && active && can('sales.refund') && sale.items.some((i) => i.quantity - i.returned_qty > 0);
  const canCancel = active && can('sales.delete') && (sale.returned_total ?? 0) === 0;
  const canCollect = isInvoice && active && sale.balance_due > 0 && !!sale.customer_id && can('customers.payments');

  const print = (paper?: PrinterSettings['paper']) => printSale(sale, fmt, paper).catch((e: unknown) => toast.error(e instanceof Error ? e.message : String(e)));

  const doCancel = async () => {
    const { confirmed, reason } = await confirm({
      title: t('sale.cancel_title', 'Cancel {{number}}?', { number: sale.invoice_number }),
      description: t('sale.cancel_hint', 'Stock is returned and the customer balance reversed. The invoice number stays used (cancelled invoices are kept for audit).'),
      destructive: true,
      confirmLabel: t('sale.cancel_confirm', 'Cancel invoice'),
      reason: { label: t('sale.cancel_reason', 'Reason for cancellation'), required: true },
    });
    if (!confirmed) return;
    try {
      await cancelSale(sale.id, reason);
      toast.success(t('sale.cancel_done', 'Invoice cancelled'));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };

  const openInPos = async (mode: 'edit' | 'convert') => {
    const cart = await saleToCart(sale, mode);
    usePos.getState().load(cart, { editingQuotationId: mode === 'edit' ? sale.id : null });
    navigate('/pos');
  };

  const state = INDIAN_STATES.find((s) => s.code === sale.place_of_supply)?.name ?? sale.place_of_supply;

  return (
    <Page>
      <PageHeader
        back={isInvoice ? '/sales' : '/quotations'}
        title={
          <span className="flex flex-wrap items-center gap-2">
            {sale.invoice_number}
            <SaleBadges sale={sale} />
          </span>
        }
        description={`${DOC_LABELS[sale.doc_type]} · ${fmt.dateTime(sale.occurred_at)}${sale.created_by_name ? ` · ${sale.created_by_name}` : ''}`}
        actions={
          <>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline">
                  <PrinterIcon /> {t('receipt.print', 'Print')} <ChevronDownIcon />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => void print()}>{t('sale.print_default', 'Default printer format')}</DropdownMenuItem>
                <DropdownMenuItem onClick={() => void print('80mm')}>80 mm</DropdownMenuItem>
                <DropdownMenuItem onClick={() => void print('58mm')}>58 mm</DropdownMenuItem>
                <DropdownMenuItem onClick={() => void print('a4')}>A4</DropdownMenuItem>
                <DropdownMenuItem onClick={() => void previewSale(sale, fmt, 'a4')}>
                  <EyeIcon /> {t('sale.preview_a4', 'Preview A4 / save as PDF')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            {canCollect ? (
              <Button variant="outline" onClick={() => setPayOpen(true)}>
                <HandCoinsIcon /> {t('sale.collect', 'Collect payment')}
              </Button>
            ) : null}
            {canReturn ? (
              <Button variant="outline" onClick={() => setReturnOpen(true)} data-testid="return-button">
                <Undo2Icon /> {t('sale.return', 'Return')}
              </Button>
            ) : null}
            {!isInvoice && sale.status === 'draft' && can('sales.create') ? (
              <>
                <Button variant="outline" onClick={() => void openInPos('edit')}>
                  <PencilIcon /> {t('common.edit', 'Edit')}
                </Button>
                <Button onClick={() => void openInPos('convert')}>
                  <RefreshCcwIcon /> {t('quote.convert', 'Convert to invoice')}
                </Button>
              </>
            ) : null}
            {canCancel ? (
              <Button variant="destructive" onClick={() => void doCancel()}>
                <BanIcon /> {isInvoice ? t('sale.cancel', 'Cancel invoice') : t('sale.cancel_doc', 'Cancel')}
              </Button>
            ) : null}
          </>
        }
      />

      <div className="space-y-5">
        {sale.number_status === 'provisional' ? (
          <p className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm">{t('receipt.provisional', 'Saved offline with a temporary number. The final invoice number is assigned when this device syncs.')}</p>
        ) : sale.provisional_number ? (
          <p className="text-xs text-muted-foreground">{t('sale.was_provisional', 'Issued offline as {{number}}.', { number: sale.provisional_number })}</p>
        ) : null}
        {sale.status === 'cancelled' ? (
          <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm">
            {t('sale.cancelled_on', 'Cancelled {{when}}', { when: fmt.dateTime(sale.cancelled_at) })}
            {sale.cancel_reason ? ` — ${sale.cancel_reason}` : ''}
          </p>
        ) : null}
        {sale.review_flags?.length ? (
          <div className="rounded-lg border border-warning/50 bg-warning/10 px-3 py-2 text-sm">
            <p className="flex items-center gap-2 font-medium">
              <FlagIcon className="size-4" /> {t('sale.flags', 'Flagged by the server for review')}
            </p>
            <ul className="mt-1 list-inside list-disc text-muted-foreground">
              {sale.review_flags.map((f) => (
                <li key={f}>{REVIEW_FLAG_LABELS[f] ?? f}</li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="grid gap-5 md:grid-cols-3">
          <Section title={t('sale.customer', 'Customer')}>
            <p className="font-medium">{sale.customer_name ?? t('pos.walk_in', 'Walk-in customer')}</p>
            {sale.customer_phone ? <p className="text-sm text-muted-foreground">{sale.customer_phone}</p> : null}
            {sale.customer_gstin ? <p className="text-sm text-muted-foreground">GSTIN {sale.customer_gstin}</p> : null}
            {sale.customer_id ? (
              <Button variant="link" className="h-auto px-0" onClick={() => navigate(`/customers/${sale.customer_id}`)}>
                {t('sale.view_customer', 'View customer')}
              </Button>
            ) : null}
          </Section>
          <Section title={t('sale.details', 'Details')}>
            <dl className="grid grid-cols-2 gap-y-1 text-sm">
              <dt className="text-muted-foreground">{t('sale.date', 'Date')}</dt>
              <dd>{fmt.date(sale.invoice_date)}</dd>
              {state ? (
                <>
                  <dt className="text-muted-foreground">{t('sale.place_of_supply', 'Place of supply')}</dt>
                  <dd>{state}</dd>
                </>
              ) : null}
              {sale.order_type !== 'retail' ? (
                <>
                  <dt className="text-muted-foreground">{t('pos.order_type', 'Order type')}</dt>
                  <dd className="capitalize">{sale.order_type.replace('_', ' ')}</dd>
                </>
              ) : null}
              {sale.valid_until ? (
                <>
                  <dt className="text-muted-foreground">{t('quote.valid_until', 'Valid until')}</dt>
                  <dd>{fmt.date(sale.valid_until)}</dd>
                </>
              ) : null}
              {sale.coupon_code ? (
                <>
                  <dt className="text-muted-foreground">{t('pos.coupon', 'Coupon code')}</dt>
                  <dd>{sale.coupon_code}</dd>
                </>
              ) : null}
            </dl>
            {sale.notes ? <p className="mt-2 text-sm text-muted-foreground">{sale.notes}</p> : null}
          </Section>
          <Section title={t('sale.amounts', 'Amounts')}>
            <dl className="grid grid-cols-2 gap-y-1 text-sm">
              <dt className="text-muted-foreground">{t('sales.total', 'Total')}</dt>
              <dd className="money text-right font-semibold">{fmt.money(sale.grand_total)}</dd>
              {isInvoice ? (
                <>
                  <dt className="text-muted-foreground">{t('receipt.paid', 'Paid')}</dt>
                  <dd className="money text-right">{fmt.money(sale.paid_total)}</dd>
                  <dt className="text-muted-foreground">{t('receipt.balance', 'Balance due')}</dt>
                  <dd className={`money text-right ${sale.balance_due > 0 ? 'text-destructive' : ''}`}>{fmt.money(sale.balance_due)}</dd>
                  {sale.returned_total ? (
                    <>
                      <dt className="text-muted-foreground">{t('sale.returned', 'Returned')}</dt>
                      <dd className="money text-right">{fmt.money(sale.returned_total)}</dd>
                    </>
                  ) : null}
                  {sale.loyalty_points_earned || sale.loyalty_points_redeemed ? (
                    <>
                      <dt className="text-muted-foreground">{t('sale.points', 'Loyalty points')}</dt>
                      <dd className="text-right">
                        +{sale.loyalty_points_earned} / −{sale.loyalty_points_redeemed}
                      </dd>
                    </>
                  ) : null}
                </>
              ) : null}
            </dl>
          </Section>
        </div>

        <Section title={t('sale.items', 'Items')}>
          <div className="-mx-4 -my-4 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('sale.item', 'Item')}</TableHead>
                  <TableHead className="text-right">{t('sale.qty', 'Qty')}</TableHead>
                  <TableHead className="text-right">{t('sale.rate', 'Rate')}</TableHead>
                  <TableHead className="hidden text-right md:table-cell">{t('sale.discount', 'Discount')}</TableHead>
                  <TableHead className="hidden text-right md:table-cell">{t('sale.taxable', 'Taxable')}</TableHead>
                  <TableHead className="hidden text-right md:table-cell">{t('sale.tax', 'Tax')}</TableHead>
                  <TableHead className="text-right">{t('sale.amount', 'Amount')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sale.items.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="max-w-72 whitespace-normal">
                      <span className="font-medium">{item.name}</span>
                      <span className="block text-xs text-muted-foreground">
                        {[item.hsn_code ? `HSN ${item.hsn_code}` : null, item.serial_numbers.length ? item.serial_numbers.join(', ') : null, item.modifiers.length ? `+ ${item.modifiers.map((m) => m.option).join(', ')}` : null, item.notes]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                      {item.returned_qty > 0 ? <span className="block text-xs text-destructive">{t('sale.returned_qty', 'Returned {{qty}}', { qty: fmt.qty(item.returned_qty) })}</span> : null}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {fmt.qty(item.quantity)} {item.unit_code ?? ''}
                    </TableCell>
                    <TableCell className="money text-right">{fmt.money(item.unit_price)}</TableCell>
                    <TableCell className="money hidden text-right md:table-cell">{item.line_discount + item.bill_discount ? fmt.money(item.line_discount + item.bill_discount) : '—'}</TableCell>
                    <TableCell className="money hidden text-right md:table-cell">{fmt.money(item.taxable)}</TableCell>
                    <TableCell className="money hidden text-right md:table-cell" title={item.taxes.map((tx) => `${tx.name} ${tx.rate}%: ${fmt.money(tx.amount)}`).join('\n')}>
                      {fmt.money(item.tax_total)}
                    </TableCell>
                    <TableCell className="money text-right font-medium">{fmt.money(item.total)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <dl className="mt-6 ml-auto grid max-w-xs grid-cols-2 gap-y-1 text-sm">
            <dt className="text-muted-foreground">{t('pos.subtotal', 'Subtotal')}</dt>
            <dd className="money text-right">{fmt.money(sale.gross_total)}</dd>
            {sale.discount_total ? (
              <>
                <dt className="text-muted-foreground">{t('pos.discount', 'Discount')}</dt>
                <dd className="money text-right">−{fmt.money(sale.discount_total)}</dd>
              </>
            ) : null}
            {sale.tax_breakup.map((row) => (
              <div key={`${row.code}-${row.rate}`} className="contents">
                <dt className="text-muted-foreground">
                  {row.name} {row.rate}%
                </dt>
                <dd className="money text-right">{fmt.money(row.amount)}</dd>
              </div>
            ))}
            {sale.charges.map((c) => (
              <div key={c.key} className="contents">
                <dt className="text-muted-foreground">{c.name}</dt>
                <dd className="money text-right">{fmt.money(c.total)}</dd>
              </div>
            ))}
            {sale.round_off ? (
              <>
                <dt className="text-muted-foreground">{t('pos.round_off', 'Round off')}</dt>
                <dd className="money text-right">{fmt.money(sale.round_off)}</dd>
              </>
            ) : null}
            <dt className="border-t pt-1 font-semibold">{t('pos.total', 'TOTAL')}</dt>
            <dd className="money border-t pt-1 text-right text-base font-bold">{fmt.money(sale.grand_total)}</dd>
          </dl>
        </Section>

        {isInvoice ? (
          <div className="grid gap-5 md:grid-cols-2">
            <Section title={t('sale.payments', 'Payments')}>
              <ul className="space-y-1.5 text-sm">
                {sale.payments.map((p) => (
                  <li key={p.id} className="flex justify-between gap-2">
                    <span>
                      {PAYMENT_METHOD_LABELS[p.method]}
                      {p.reference ? <span className="text-muted-foreground"> · {p.reference}</span> : null}
                      {p.old_gold ? <span className="text-muted-foreground"> · {p.old_gold.description} {p.old_gold.gross_weight}g</span> : null}
                      {p.tendered ? (
                        <span className="text-muted-foreground">
                          {' '}
                          · {t('sale.tendered', 'tendered')} {fmt.money(p.tendered)}, {t('receipt.change', 'Change').toLowerCase()} {fmt.money(p.change)}
                        </span>
                      ) : null}
                    </span>
                    <span className="money">{fmt.money(p.amount)}</span>
                  </li>
                ))}
                {(payments ?? []).map((p) => (
                  <li key={p.id} className="flex justify-between gap-2">
                    <span>
                      {PAYMENT_METHOD_LABELS[p.method]} · {p.receipt_number} · {fmt.date(p.payment_date)}
                    </span>
                    <span className="money">{fmt.money(p.amount)}</span>
                  </li>
                ))}
                {sale.payments.length === 0 && !payments?.length ? <li className="text-muted-foreground">{t('sale.no_payments', 'No payments recorded.')}</li> : null}
              </ul>
            </Section>
            <Section title={t('sale.returns', 'Returns / credit notes')}>
              {returns?.length ? (
                <ul className="space-y-1.5 text-sm">
                  {returns.map((r) => (
                    <li key={r.id} className="flex items-center justify-between gap-2">
                      <span>
                        {r.return_number} · {fmt.date(r.return_date)} · {r.refund_method.replace('_', ' ')}
                      </span>
                      <span className="flex items-center gap-2">
                        <span className="money">{fmt.money(r.total)}</span>
                        <Button size="icon-sm" variant="ghost" onClick={() => void printCreditNote(r, fmt)} aria-label={t('receipt.print', 'Print')}>
                          <PrinterIcon />
                        </Button>
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">{t('sale.no_returns', 'No returns.')}</p>
              )}
            </Section>
          </div>
        ) : null}
      </div>

      {canReturn ? <ReturnDialog sale={sale} open={returnOpen} onOpenChange={setReturnOpen} /> : null}
      {canCollect ? (
        <PaymentEntryDialog
          open={payOpen}
          onOpenChange={setPayOpen}
          title={t('sale.collect', 'Collect payment')}
          description={`${sale.invoice_number} · ${t('receipt.balance', 'Balance due')} ${fmt.money(sale.balance_due)}`}
          suggested={sale.balance_due}
          onSubmit={async (input) => {
            if (input.amount > sale.balance_due + 0.001) throw new Error(t('sale.overpay', 'Amount is more than the balance due.'));
            const register = await currentRegister();
            await receiveCustomerPayment(sale.customer_id!, { ...input, sale_id: sale.id, register_id: register?.id ?? null });
            toast.success(t('sale.payment_recorded', 'Payment recorded'));
          }}
        />
      ) : null}
    </Page>
  );
}
