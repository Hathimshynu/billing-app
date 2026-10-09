import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { CheckCircle2Icon, CloudOffIcon, MessageCircleIcon, PrinterIcon } from 'lucide-react';
import type { PrinterSettings, Sale } from '@shopdesk/shared';
import { useFormat } from '@/lib/format';
import { printSale, saleHtml } from '@/lib/print';
import { useSyncStore } from '@/lib/sync/store';
import { Button } from '@/components/ui/button';
import { Kbd } from '@/components/ui/kbd';
import { ResponsiveDialog } from '@/components/common/responsive-dialog';

const PAPERS: Array<{ value: PrinterSettings['paper']; label: string }> = [
  { value: '80mm', label: '80 mm' },
  { value: '58mm', label: '58 mm' },
  { value: 'a4', label: 'A4' },
];

/** Shown after a sale: totals, change, print in any paper size, share. */
export function ReceiptDialog({ sale, onClose, defaultPaper }: { sale: Sale | null; onClose: () => void; defaultPaper: PrinterSettings['paper'] }) {
  const { t } = useTranslation();
  const fmt = useFormat();
  const online = useSyncStore((s) => s.online);
  const [paper, setPaper] = useState<PrinterSettings['paper']>(defaultPaper);
  const [html, setHtml] = useState<string | null>(null);
  const [printing, setPrinting] = useState(false);

  useEffect(() => setPaper(defaultPaper), [defaultPaper, sale]);
  useEffect(() => {
    if (!sale) return setHtml(null);
    let cancelled = false;
    saleHtml(sale, fmt, paper)
      .then((value) => !cancelled && setHtml(value))
      .catch((error: unknown) => toast.error(error instanceof Error ? error.message : String(error)));
    return () => {
      cancelled = true;
    };
  }, [sale, fmt, paper]);

  const print = async () => {
    if (!sale) return;
    setPrinting(true);
    try {
      await printSale(sale, fmt, paper);
    } catch (error) {
      toast.error(t('print.failed', 'Printing failed: {{message}}', { message: error instanceof Error ? error.message : String(error) }));
    } finally {
      setPrinting(false);
    }
  };

  const whatsapp = () => {
    if (!sale) return;
    const text = [
      `${t('receipt.invoice', 'Invoice')} ${sale.invoice_number}`,
      `${t('receipt.date', 'Date')}: ${fmt.date(sale.invoice_date)}`,
      ...sale.items.map((i) => `${i.name} × ${fmt.qty(i.quantity)} = ${fmt.money(i.total)}`),
      `${t('receipt.total', 'Total')}: ${fmt.money(sale.grand_total)}`,
      sale.balance_due > 0 ? `${t('receipt.balance', 'Balance due')}: ${fmt.money(sale.balance_due)}` : '',
    ]
      .filter(Boolean)
      .join('\n');
    const phone = (sale.customer_phone ?? '').replace(/\D/g, '');
    const target = phone.length === 10 ? `91${phone}` : phone;
    window.open(`https://wa.me/${target}?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
  };

  const isInvoice = sale?.doc_type === 'invoice';
  const provisional = sale?.number_status === 'provisional';

  return (
    <ResponsiveDialog
      open={!!sale}
      onOpenChange={(o) => !o && onClose()}
      size="lg"
      title={
        <span className="flex items-center gap-2">
          <CheckCircle2Icon className="size-5 text-success" />
          {isInvoice ? t('receipt.sale_complete', 'Sale complete') : t('receipt.saved', 'Saved')}
        </span>
      }
      description={sale ? `${sale.invoice_number} · ${fmt.money(sale.grand_total)}` : ''}
      footer={
        <div className="flex w-full flex-wrap items-center justify-between gap-2">
          <div className="flex gap-1 rounded-lg border p-0.5">
            {PAPERS.map((p) => (
              <button key={p.value} type="button" onClick={() => setPaper(p.value)} className={`rounded-md px-2.5 py-1 text-xs ${paper === p.value ? 'bg-primary text-primary-foreground' : ''}`}>
                {p.label}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            {sale?.customer_phone ? (
              <Button variant="outline" onClick={whatsapp} disabled={!online} title={online ? undefined : t('receipt.share_offline', 'Sharing needs internet')}>
                <MessageCircleIcon /> WhatsApp
              </Button>
            ) : null}
            <Button variant="outline" onClick={() => void print()} disabled={printing || !html} data-testid="print-receipt">
              <PrinterIcon /> {t('receipt.print', 'Print')} <Kbd className="hidden sm:inline-flex">P</Kbd>
            </Button>
            <Button onClick={onClose} data-testid="new-sale" autoFocus>
              {t('receipt.new_sale', 'New sale')} <Kbd className="hidden bg-black/15 text-inherit sm:inline-flex">Enter</Kbd>
            </Button>
          </div>
        </div>
      }
    >
      <div
        className="space-y-3"
        onKeyDown={(e) => {
          if (e.key.toLowerCase() === 'p') {
            e.preventDefault();
            void print();
          }
        }}
      >
        {sale && isInvoice ? (
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-lg bg-muted p-2">
              <p className="text-xs text-muted-foreground">{t('receipt.total', 'Total')}</p>
              <p className="money text-lg font-semibold">{fmt.money(sale.grand_total)}</p>
            </div>
            <div className="rounded-lg bg-muted p-2">
              <p className="text-xs text-muted-foreground">{t('receipt.paid', 'Paid')}</p>
              <p className="money text-lg font-semibold">{fmt.money(sale.paid_total)}</p>
            </div>
            <div className="rounded-lg bg-success/10 p-2" data-testid="change-due">
              <p className="text-xs text-muted-foreground">{sale.balance_due > 0 ? t('receipt.balance', 'Balance due') : t('receipt.change', 'Change')}</p>
              <p className="money text-lg font-semibold">{fmt.money(sale.balance_due > 0 ? sale.balance_due : sale.change_due)}</p>
            </div>
          </div>
        ) : null}
        {provisional ? (
          <p className="flex items-center gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
            <CloudOffIcon className="size-4 shrink-0" />
            {t('receipt.provisional', 'Saved offline with a temporary number. The final invoice number is assigned when this device syncs.')}
          </p>
        ) : null}
        <div className="overflow-hidden rounded-lg border bg-white">
          {html ? <iframe title={t('receipt.preview', 'Receipt preview')} srcDoc={html} className="h-[50dvh] w-full" sandbox="" data-testid="receipt-preview" /> : <div className="h-[50dvh] animate-pulse bg-muted" />}
        </div>
      </div>
    </ResponsiveDialog>
  );
}
