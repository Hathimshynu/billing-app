import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLiveQuery } from 'dexie-react-hooks';
import { toast } from 'sonner';
import { ArrowDownIcon, ArrowUpIcon, LockIcon, LockOpenIcon, WalletIcon } from 'lucide-react';
import { roundTo, type CashRegister } from '@shopdesk/shared';
import { db } from '@/lib/db/business';
import { useFormat } from '@/lib/format';
import { runtime } from '@/lib/runtime';
import { cashMovement, closeRegister, openRegister, registerTotals } from '@/lib/repos/finance';
import { useCan } from '@/hooks/use-app';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { DataTable, type Column } from '@/components/common/data-table';
import { FormRow } from '@/components/common/form';
import { NumberInput } from '@/components/common/number-input';
import { Page, PageHeader, Section, StatCard } from '@/components/common/page';
import { ResponsiveDialog } from '@/components/common/responsive-dialog';

const DENOMINATIONS = [2000, 500, 200, 100, 50, 20, 10, 5, 2, 1];

export default function CashRegisterPage() {
  const { t } = useTranslation();
  const fmt = useFormat();
  const can = useCan();
  const [opening, setOpening] = useState<number | null>(null);
  const [notes, setNotes] = useState('');
  const [moveType, setMoveType] = useState<'cash_in' | 'cash_out' | null>(null);
  const [closeOpen, setCloseOpen] = useState(false);

  const data = useLiveQuery(async () => {
    const deviceId = runtime().deviceId;
    const registers = await db().cash_registers.where('device_id').equals(deviceId).toArray();
    const open = registers.find((r) => r.status === 'open') ?? null;
    return {
      open,
      totals: open ? await registerTotals(open) : null,
      txns: open ? await db().cash_transactions.where('register_id').equals(open.id).toArray() : [],
      history: registers.filter((r) => r.status === 'closed').sort((a, b) => (b.closed_at ?? '').localeCompare(a.closed_at ?? '')),
    };
  }, []);

  const historyColumns: Column<CashRegister>[] = [
    { id: 'opened', header: t('register.opened', 'Opened'), cell: (r) => fmt.dateTime(r.opened_at), value: (r) => r.opened_at },
    { id: 'closed', header: t('register.closed', 'Closed'), cell: (r) => fmt.dateTime(r.closed_at), value: (r) => r.closed_at ?? '' },
    { id: 'expected', header: t('register.expected', 'Expected'), cell: (r) => <span className="money">{fmt.money(r.expected_cash)}</span>, value: (r) => r.expected_cash, align: 'right', numeric: true },
    { id: 'counted', header: t('register.counted', 'Counted'), cell: (r) => <span className="money">{fmt.money(r.closing_cash)}</span>, value: (r) => r.closing_cash, align: 'right', numeric: true },
    { id: 'diff', header: t('register.difference', 'Difference'), cell: (r) => <span className={`money font-medium ${(r.difference ?? 0) < 0 ? 'text-destructive' : (r.difference ?? 0) > 0 ? 'text-warning-foreground' : 'text-success'}`}>{fmt.money(r.difference)}</span>, value: (r) => r.difference, align: 'right', numeric: true },
  ];

  if (!data) return null;
  const { open, totals, txns, history } = data;

  return (
    <Page className="max-w-5xl">
      <PageHeader
        title={t('register.title', 'Cash register')}
        description={t('register.description', 'Track the cash drawer of this device for each shift.')}
        actions={
          open ? (
            <>
              <Button variant="outline" onClick={() => setMoveType('cash_in')}>
                <ArrowDownIcon /> {t('register.cash_in', 'Cash in')}
              </Button>
              <Button variant="outline" onClick={() => setMoveType('cash_out')}>
                <ArrowUpIcon /> {t('register.cash_out', 'Cash out')}
              </Button>
              {can('cash_register.close') ? (
                <Button onClick={() => setCloseOpen(true)} data-testid="close-register">
                  <LockIcon /> {t('register.close', 'Close register')}
                </Button>
              ) : null}
            </>
          ) : null
        }
      />
      {open && totals ? (
        <div className="space-y-5">
          <p className="text-sm text-muted-foreground">
            <Badge className="bg-success/15 text-success">{t('register.open_badge', 'Open')}</Badge> {t('register.since', 'since {{when}}', { when: fmt.dateTime(open.opened_at) })}
          </p>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label={t('register.opening', 'Opening cash')} value={fmt.money(totals.opening_cash)} />
            <StatCard label={t('register.cash_sales', 'Cash sales')} value={fmt.money(totals.cash_sales)} hint={`${t('register.refunds', 'Refunds')} ${fmt.money(totals.cash_refunds)}`} />
            <StatCard label={t('register.in_out', 'Cash in / out')} value={`${fmt.money(totals.cash_in)} / ${fmt.money(totals.cash_out)}`} hint={`${t('register.expenses', 'Expenses')} ${fmt.money(totals.cash_expenses)}`} />
            <StatCard label={t('register.expected', 'Expected')} value={fmt.money(totals.expected_cash)} icon={WalletIcon} />
          </div>
          <Section title={t('register.movements', 'Cash in / out')}>
            {txns.length ? (
              <ul className="divide-y text-sm">
                {txns.map((x) => (
                  <li key={x.id} className="flex justify-between py-1.5">
                    <span>
                      {fmt.time(x.occurred_at)} · {x.type === 'cash_in' ? t('register.cash_in', 'Cash in') : t('register.cash_out', 'Cash out')} {x.reason ? `— ${x.reason}` : ''}
                    </span>
                    <span className="money">{fmt.money(x.amount)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">{t('register.no_moves', 'No cash movements this shift.')}</p>
            )}
          </Section>
        </div>
      ) : can('cash_register.open') ? (
        <Section title={t('register.open', 'Open register')}>
          <div className="max-w-sm space-y-3">
            <FormRow label={t('register.opening', 'Opening cash')} htmlFor="r-open">
              <NumberInput id="r-open" autoFocus value={opening} onValueChange={setOpening} data-testid="opening-cash" />
            </FormRow>
            <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t('common.notes', 'Notes')} />
            <Button
              onClick={async () => {
                await openRegister(opening ?? 0, notes.trim() || null);
                toast.success(t('register.opened_ok', 'Register opened'));
              }}
              data-testid="open-register"
            >
              <LockOpenIcon /> {t('register.open', 'Open register')}
            </Button>
          </div>
        </Section>
      ) : (
        <p className="text-sm text-muted-foreground">{t('register.no_permission', 'No register is open on this device.')}</p>
      )}

      <h2 className="mt-8 mb-3 text-sm font-semibold">{t('register.history', 'Closed shifts on this device')}</h2>
      <DataTable data={history} columns={historyColumns} rowKey={(r) => r.id} exportName="register-history" empty={{ icon: WalletIcon, title: t('register.no_history', 'No closed shifts yet') }} />

      {open ? <MoveDialog type={moveType} registerId={open.id} onClose={() => setMoveType(null)} /> : null}
      {open && totals ? <CloseDialog open={closeOpen} onOpenChange={setCloseOpen} registerId={open.id} expected={totals.expected_cash} /> : null}
    </Page>
  );
}

function MoveDialog({ type, registerId, onClose }: { type: 'cash_in' | 'cash_out' | null; registerId: string; onClose: () => void }) {
  const { t } = useTranslation();
  const [amount, setAmount] = useState<number | null>(null);
  const [reason, setReason] = useState('');
  const save = async () => {
    if (!type || !amount || amount <= 0) return toast.error(t('payment.amount_positive', 'Enter an amount.'));
    await cashMovement(registerId, type, amount, reason.trim() || null);
    toast.success(t('register.recorded', 'Recorded'));
    setAmount(null);
    setReason('');
    onClose();
  };
  return (
    <ResponsiveDialog open={!!type} onOpenChange={(o) => !o && onClose()} size="sm" title={type === 'cash_in' ? t('register.cash_in', 'Cash in') : t('register.cash_out', 'Cash out')} footer={<Button onClick={() => void save()}>{t('common.save', 'Save')}</Button>}>
      <div className="space-y-3">
        <NumberInput autoFocus value={amount} onValueChange={setAmount} placeholder="0" />
        <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t('return.reason', 'Reason')} />
      </div>
    </ResponsiveDialog>
  );
}

function CloseDialog({ open, onOpenChange, registerId, expected }: { open: boolean; onOpenChange: (o: boolean) => void; registerId: string; expected: number }) {
  const { t } = useTranslation();
  const fmt = useFormat();
  const [counts, setCounts] = useState<Record<string, number | null>>({});
  const [manual, setManual] = useState<number | null>(null);
  const [notes, setNotes] = useState('');
  const fromDenoms = roundTo(DENOMINATIONS.reduce((s, d) => s + d * (counts[d] ?? 0), 0));
  const counted = manual ?? fromDenoms;
  const diff = roundTo(counted - expected);
  const save = async () => {
    try {
      const denominations = Object.fromEntries(Object.entries(counts).filter(([, v]) => v)) as Record<string, number>;
      await closeRegister(registerId, counted, Object.keys(denominations).length ? denominations : null, notes.trim() || null);
      toast.success(t('register.closed_ok', 'Register closed'));
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };
  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('register.close', 'Close register')}
      description={`${t('register.expected', 'Expected')}: ${fmt.money(expected)}`}
      footer={
        <div className="flex w-full items-center justify-between">
          <span className={`text-sm font-medium ${diff < 0 ? 'text-destructive' : diff > 0 ? 'text-warning-foreground' : 'text-success'}`}>
            {t('register.difference', 'Difference')}: {fmt.money(diff)}
          </span>
          <Button onClick={() => void save()} data-testid="confirm-close">
            {t('register.close', 'Close register')}
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          {DENOMINATIONS.map((d) => (
            <label key={d} className="space-y-1 text-xs">
              <span className="text-muted-foreground">× {d}</span>
              <NumberInput decimals={0} value={counts[d] ?? null} onValueChange={(v) => setCounts((c) => ({ ...c, [d]: v }))} />
            </label>
          ))}
        </div>
        <p className="text-sm">
          {t('register.denom_total', 'Counted from notes & coins')}: <span className="money font-semibold">{fmt.money(fromDenoms)}</span>
        </p>
        <FormRow label={t('register.manual', 'Or enter the counted total')} htmlFor="cl-total">
          <NumberInput id="cl-total" value={manual} onValueChange={setManual} />
        </FormRow>
        <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t('common.notes', 'Notes')} />
      </div>
    </ResponsiveDialog>
  );
}
