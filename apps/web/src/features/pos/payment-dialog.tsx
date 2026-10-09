import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import QRCode from 'qrcode';
import { BanknoteIcon, CoinsIcon, CreditCardIcon, GemIcon, LandmarkIcon, type LucideIcon, PlusIcon, QrCodeIcon, SplitIcon, Trash2Icon, WalletIcon, ReceiptIcon, StarIcon } from 'lucide-react';
import { calculateOldGoldValue, PAYMENT_METHOD_LABELS, PURITIES, roundTo, type OldGoldDetails, type PaymentMethod } from '@shopdesk/shared';
import { cn } from '@/lib/utils';
import { useFormat } from '@/lib/format';
import type { PaymentInput } from '@/lib/repos/sales';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Kbd } from '@/components/ui/kbd';
import { Spinner } from '@/components/ui/spinner';
import { NumberInput } from '@/components/common/number-input';
import { ResponsiveDialog } from '@/components/common/responsive-dialog';

const ICONS: Record<PaymentMethod, LucideIcon> = {
  cash: BanknoteIcon,
  upi: QrCodeIcon,
  card: CreditCardIcon,
  bank_transfer: LandmarkIcon,
  wallet: WalletIcon,
  credit: ReceiptIcon,
  credit_note: ReceiptIcon,
  old_gold: GemIcon,
  loyalty: StarIcon,
  other: CoinsIcon,
};

export interface PaymentContext {
  total: number;
  methods: PaymentMethod[];
  quickAmounts: number[];
  customerName: string | null;
  /** Available credit (credit limit − outstanding); null when there is no limit. */
  creditAvailable: number | null;
  canCredit: boolean;
  canOverrideCredit: boolean;
  loyaltyPoints: number;
  loyaltyPointValue: number;
  loyaltyEnabled: boolean;
  upiId: string | null;
  businessName: string;
  goldRates: Record<string, number>;
  jewellery: boolean;
}

interface Row {
  id: number;
  method: PaymentMethod;
  amount: number | null;
  reference: string;
  oldGold?: OldGoldDetails | null;
}

export function PaymentDialog({
  open,
  onOpenChange,
  context,
  onComplete,
  busy,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  context: PaymentContext;
  onComplete: (payments: PaymentInput[]) => void;
  busy: boolean;
}) {
  const { t } = useTranslation();
  const fmt = useFormat();
  const [mode, setMode] = useState<'single' | 'split'>('single');
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [tendered, setTendered] = useState<number | null>(null);
  const [reference, setReference] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [qr, setQr] = useState<string | null>(null);
  const [goldOpen, setGoldOpen] = useState(false);
  const total = context.total;

  useEffect(() => {
    if (open) {
      setMode('single');
      setMethod('cash');
      setTendered(null);
      setReference('');
      setRows([{ id: 1, method: 'cash', amount: total, reference: '' }]);
    }
  }, [open, total]);

  useEffect(() => {
    if (!open || method !== 'upi' || !context.upiId || mode !== 'single') {
      setQr(null);
      return;
    }
    const params = new URLSearchParams({ pa: context.upiId, pn: context.businessName, am: total.toFixed(2), cu: 'INR' });
    void QRCode.toDataURL(`upi://pay?${params.toString()}`, { margin: 1, width: 220 }).then(setQr);
  }, [open, method, context.upiId, context.businessName, total, mode]);

  const splitPaid = roundTo(rows.reduce((s, r) => s + (r.amount ?? 0), 0));
  const change = mode === 'single' && method === 'cash' && tendered !== null ? roundTo(Math.max(tendered - total, 0)) : 0;

  const creditUsed = mode === 'single' ? (method === 'credit' ? total : 0) : roundTo(rows.filter((r) => r.method === 'credit').reduce((s, r) => s + (r.amount ?? 0), 0));
  const creditProblem = useMemo(() => {
    if (creditUsed <= 0) return null;
    if (!context.customerName) return t('payment.credit_needs_customer', 'Select a customer to sell on credit.');
    if (!context.canCredit) return t('payment.credit_not_allowed', 'You are not allowed to sell on credit.');
    if (context.creditAvailable !== null && creditUsed > context.creditAvailable + 0.001) {
      return context.canOverrideCredit
        ? null
        : t('payment.credit_limit', 'Credit limit exceeded (available {{amount}}). A manager must approve.', { amount: fmt.money(Math.max(context.creditAvailable, 0)) });
    }
    return null;
  }, [creditUsed, context, t, fmt]);
  const creditWarning = context.creditAvailable !== null && creditUsed > context.creditAvailable + 0.001 && context.canOverrideCredit;

  const loyaltyMax = context.loyaltyEnabled ? roundTo(context.loyaltyPoints * context.loyaltyPointValue) : 0;

  const canComplete =
    !busy &&
    !creditProblem &&
    (mode === 'single'
      ? method !== 'cash' || tendered === null || tendered >= total - 0.001
      : Math.abs(splitPaid - total) < 0.005 && rows.every((r) => (r.amount ?? 0) > 0));

  const complete = () => {
    if (!canComplete) return;
    if (mode === 'single') {
      onComplete([
        {
          method,
          amount: total,
          reference: reference || null,
          tendered: method === 'cash' ? (tendered ?? total) : null,
          change: method === 'cash' ? change : null,
        },
      ]);
    } else {
      onComplete(rows.filter((r) => (r.amount ?? 0) > 0).map((r) => ({ method: r.method, amount: r.amount!, reference: r.reference || null, old_gold: r.oldGold ?? null })));
    }
  };

  const quick = [...new Set([total, ...context.quickAmounts.filter((a) => a > total)].map((a) => roundTo(a)))].slice(0, 5);

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      dismissible={!busy}
      size="lg"
      title={t('payment.title', 'Payment')}
      description={`${t('payment.amount_due', 'Amount due')}: ${fmt.money(total)}`}
      footer={
        <div className="flex w-full items-center justify-between gap-3">
          <div className="text-sm">
            {mode === 'single' && method === 'cash' && tendered !== null ? (
              <span>
                {t('payment.change', 'Change')}: <span className="money text-lg font-semibold">{fmt.money(change)}</span>
              </span>
            ) : mode === 'split' ? (
              <span className={cn(Math.abs(splitPaid - total) > 0.005 && 'text-destructive')}>
                {t('payment.remaining', 'Remaining')}: <span className="money font-semibold">{fmt.money(roundTo(total - splitPaid))}</span>
              </span>
            ) : null}
          </div>
          <Button size="lg" className="h-12 min-w-40 bg-success text-base text-success-foreground hover:bg-success/90" disabled={!canComplete} onClick={complete} data-testid="complete-sale">
            {busy ? <Spinner /> : null}
            {t('payment.complete', 'Complete sale')} <Kbd className="hidden bg-black/15 text-inherit sm:inline-flex">F10</Kbd>
          </Button>
        </div>
      }
    >
      <div
        className="space-y-4"
        onKeyDown={(e) => {
          if (e.key === 'F10' || (e.key === 'Enter' && (e.target as HTMLElement).tagName !== 'BUTTON')) {
            e.preventDefault();
            complete();
          }
        }}
      >
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
          {context.methods.map((m) => {
            const Icon = ICONS[m];
            return (
              <button
                key={m}
                type="button"
                onClick={() => {
                  setMode('single');
                  setMethod(m);
                  if (m === 'old_gold') setGoldOpen(true);
                }}
                data-testid={`pay-${m}`}
                className={cn(
                  'flex h-16 flex-col items-center justify-center gap-1 rounded-xl border-2 text-sm font-semibold uppercase transition',
                  mode === 'single' && method === m ? 'border-primary bg-primary/10 text-primary' : 'border-transparent bg-muted hover:bg-muted/70',
                )}
              >
                <Icon className="size-5" />
                {PAYMENT_METHOD_LABELS[m]}
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => setMode('split')}
            data-testid="pay-split"
            className={cn('flex h-16 flex-col items-center justify-center gap-1 rounded-xl border-2 text-sm font-semibold uppercase', mode === 'split' ? 'border-primary bg-primary/10 text-primary' : 'border-transparent bg-muted hover:bg-muted/70')}
          >
            <SplitIcon className="size-5" />
            {t('payment.split', 'Split')}
          </button>
        </div>

        {mode === 'single' ? (
          method === 'cash' ? (
            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="tendered">
                {t('payment.cash_received', 'Cash received')}
              </label>
              <NumberInput id="tendered" value={tendered} onValueChange={setTendered} placeholder={fmt.number(total)} className="h-14 text-2xl" autoFocus />
              <div className="flex flex-wrap gap-2">
                {quick.map((amount) => (
                  <Button key={amount} variant="outline" onClick={() => setTendered(amount)}>
                    {amount === total ? t('payment.exact', 'Exact') : fmt.money(amount)}
                  </Button>
                ))}
              </div>
            </div>
          ) : method === 'upi' ? (
            <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-start">
              {qr ? <img src={qr} alt="UPI QR code" className="size-44 rounded-lg border bg-white p-2" /> : null}
              <div className="w-full space-y-2">
                <p className="text-sm text-muted-foreground">{context.upiId ? t('payment.upi_scan', 'Ask the customer to scan and pay. Enter the UPI reference (optional).') : t('payment.upi_no_id', 'Add your UPI ID in Settings → Invoice to show a payment QR here.')}</p>
                <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder={t('payment.reference', 'Reference / transaction ID')} />
              </div>
            </div>
          ) : method === 'credit' ? (
            <p className="rounded-lg bg-muted p-3 text-sm">
              {context.customerName
                ? t('payment.credit_hint', 'The full amount is added to {{name}}\'s account.', { name: context.customerName })
                : t('payment.credit_needs_customer', 'Select a customer to sell on credit.')}
              {context.creditAvailable !== null ? ` ${t('payment.available', 'Available')}: ${fmt.money(context.creditAvailable)}` : ''}
            </p>
          ) : method === 'loyalty' ? (
            <p className="rounded-lg bg-muted p-3 text-sm">
              {t('payment.loyalty_balance', 'Points balance: {{points}} (worth {{amount}})', { points: context.loyaltyPoints, amount: fmt.money(loyaltyMax) })}
              {loyaltyMax < total ? ` — ${t('payment.loyalty_split', 'use Split to combine with another method.')}` : ''}
            </p>
          ) : (
            <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder={t('payment.reference', 'Reference / transaction ID')} />
          )
        ) : (
          <div className="space-y-2" data-testid="split-rows">
            {rows.map((row) => (
              <div key={row.id} className="grid grid-cols-[1fr_1fr_auto] gap-2">
                <select
                  className="h-9 rounded-lg border bg-background px-2 text-sm"
                  value={row.method}
                  onChange={(e) => setRows((r) => r.map((x) => (x.id === row.id ? { ...x, method: e.target.value as PaymentMethod } : x)))}
                  aria-label={t('payment.method', 'Method')}
                >
                  {context.methods.map((m) => (
                    <option key={m} value={m}>
                      {PAYMENT_METHOD_LABELS[m]}
                    </option>
                  ))}
                </select>
                <NumberInput value={row.amount} onValueChange={(v) => setRows((r) => r.map((x) => (x.id === row.id ? { ...x, amount: v } : x)))} aria-label={t('payment.amount', 'Amount')} />
                <Button variant="ghost" size="icon" onClick={() => setRows((r) => r.filter((x) => x.id !== row.id))} disabled={rows.length === 1} aria-label={t('common.remove', 'Remove')}>
                  <Trash2Icon />
                </Button>
              </div>
            ))}
            <Button
              variant="outline"
              size="sm"
              onClick={() => setRows((r) => [...r, { id: Date.now(), method: context.methods.find((m) => !r.some((x) => x.method === m)) ?? 'upi', amount: roundTo(Math.max(total - splitPaid, 0)), reference: '' }])}
            >
              <PlusIcon /> {t('payment.add_method', 'Add payment method')}
            </Button>
          </div>
        )}

        {creditProblem ? <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{creditProblem}</p> : null}
        {creditWarning ? <p className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm">{t('payment.credit_override', 'Credit limit will be exceeded — allowed by your role.')}</p> : null}
        {context.jewellery ? (
          <OldGoldForm
            open={goldOpen}
            onOpenChange={setGoldOpen}
            rates={context.goldRates}
            onAdd={(details, value) => {
              setMode('split');
              setRows((r) => [{ id: Date.now(), method: 'old_gold' as const, amount: Math.min(value, total), reference: details.description, oldGold: details }, ...r.filter((x) => x.method !== 'old_gold').map((x) => ({ ...x, amount: roundTo(Math.max(total - Math.min(value, total), 0)) }))].slice(0, 2));
            }}
          />
        ) : null}
      </div>
    </ResponsiveDialog>
  );
}

function OldGoldForm({ open, onOpenChange, rates, onAdd }: { open: boolean; onOpenChange: (o: boolean) => void; rates: Record<string, number>; onAdd: (details: OldGoldDetails, value: number) => void }) {
  const { t } = useTranslation();
  const fmt = useFormat();
  const [purity, setPurity] = useState('22K');
  const [gross, setGross] = useState<number | null>(null);
  const [stone, setStone] = useState<number | null>(0);
  const [deduction, setDeduction] = useState<number | null>(2);
  const [rate, setRate] = useState<number | null>(rates['22K'] ?? null);
  const [description, setDescription] = useState('Old gold');
  useEffect(() => setRate(rates[purity] ?? null), [purity, rates]);
  const result = calculateOldGoldValue({ gross_weight: gross ?? 0, stone_weight: stone ?? 0, rate_per_gram: rate ?? 0, deduction_percent: deduction ?? 0 });
  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('payment.old_gold', 'Old gold exchange')}
      footer={
        <Button
          disabled={!gross || !rate}
          onClick={() => {
            onAdd(
              { description, metal: 'gold', purity, gross_weight: gross ?? 0, stone_weight: stone ?? 0, deduction_percent: deduction ?? 0, rate_per_gram: rate ?? 0, net_weight: result.net_weight, effective_weight: result.effective_weight },
              result.value,
            );
            onOpenChange(false);
          }}
        >
          {t('payment.use_value', 'Use')} {fmt.money(result.value)}
        </Button>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1 text-sm">
          <span className="font-medium">{t('payment.description', 'Description')}</span>
          <Input value={description} onChange={(e) => setDescription(e.target.value)} />
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-medium">{t('jewellery.purity', 'Purity')}</span>
          <select className="h-9 w-full rounded-lg border bg-background px-2" value={purity} onChange={(e) => setPurity(e.target.value)}>
            {PURITIES.filter((p) => p.metal === 'gold').map((p) => (
              <option key={p.code} value={p.code}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-medium">{t('jewellery.gross_weight', 'Gross weight (g)')}</span>
          <NumberInput value={gross} onValueChange={setGross} decimals={3} autoFocus />
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-medium">{t('jewellery.stone_weight', 'Stone weight (g)')}</span>
          <NumberInput value={stone} onValueChange={setStone} decimals={3} />
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-medium">{t('jewellery.deduction', 'Melting deduction %')}</span>
          <NumberInput value={deduction} onValueChange={setDeduction} />
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-medium">{t('jewellery.rate', 'Rate per gram')}</span>
          <NumberInput value={rate} onValueChange={setRate} />
        </label>
      </div>
      <p className="mt-3 text-sm text-muted-foreground">
        {t('jewellery.effective', 'Effective weight')}: {result.effective_weight} g · {t('jewellery.value', 'Value')}: <span className="font-semibold text-foreground">{fmt.money(result.value)}</span>
      </p>
    </ResponsiveDialog>
  );
}
