import { useTranslation } from 'react-i18next';
import { BookOpenIcon } from 'lucide-react';
import { roundTo } from '@shopdesk/shared';
import { useFormat, type Formatter } from '@/lib/format';
import { DataTable, type Column } from '@/components/common/data-table';

export interface LedgerLine {
  id: string;
  type: string;
  reference_no: string | null;
  notes: string | null;
  debit: number;
  credit: number;
  points?: number;
  occurred_at: string;
  balance: number;
}

const TYPE_LABELS: Record<string, string> = {
  opening_balance: 'Opening balance',
  sale: 'Sale',
  sale_payment: 'Payment at sale',
  payment: 'Payment',
  sale_return: 'Return',
  refund: 'Refund',
  adjustment: 'Adjustment',
  loyalty_earn: 'Points earned',
  loyalty_redeem: 'Points redeemed',
  purchase: 'Purchase',
  purchase_payment: 'Payment at purchase',
  purchase_return: 'Purchase return',
};

/** Adds a running balance. sign=1: debit increases (receivable); sign=-1: credit increases (payable). */
export function withRunningBalance<T extends { debit: number; credit: number; occurred_at: string }>(entries: T[], sign: 1 | -1): Array<T & { balance: number }> {
  let balance = 0;
  return [...entries]
    .sort((a, b) => a.occurred_at.localeCompare(b.occurred_at))
    .map((e) => {
      balance = roundTo(balance + sign * (e.debit - e.credit));
      return { ...e, balance };
    });
}

export function LedgerTable({ entries, debitLabel, creditLabel, exportName }: { entries: LedgerLine[] | undefined; debitLabel: string; creditLabel: string; exportName: string }) {
  const { t } = useTranslation();
  const fmt = useFormat();
  const columns: Column<LedgerLine>[] = [
    { id: 'date', header: t('sales.date', 'Date'), cell: (e) => fmt.dateTime(e.occurred_at), value: (e) => e.occurred_at },
    { id: 'type', header: t('ledger.type', 'Entry'), cell: (e) => TYPE_LABELS[e.type] ?? e.type, value: (e) => TYPE_LABELS[e.type] ?? e.type },
    { id: 'ref', header: t('inventory.reference', 'Reference'), cell: (e) => e.reference_no ?? e.notes ?? '—', value: (e) => e.reference_no ?? e.notes ?? '', hideOnMobile: true },
    { id: 'debit', header: debitLabel, cell: (e) => (e.debit ? <span className="money">{fmt.money(e.debit)}</span> : ''), value: (e) => e.debit, align: 'right', numeric: true },
    { id: 'credit', header: creditLabel, cell: (e) => (e.credit ? <span className="money">{fmt.money(e.credit)}</span> : e.points ? `${e.points > 0 ? '+' : ''}${e.points} pts` : ''), value: (e) => e.credit, align: 'right', numeric: true },
    { id: 'balance', header: t('customer.balance', 'Balance'), cell: (e) => <span className="money font-medium">{fmt.money(e.balance)}</span>, value: (e) => e.balance, align: 'right', numeric: true },
  ];
  return <DataTable data={entries ? [...entries].reverse() : undefined} columns={columns} rowKey={(e) => e.id} exportName={exportName} dense empty={{ icon: BookOpenIcon, title: t('ledger.empty', 'No entries yet') }} />;
}

const esc = (v: unknown) =>
  String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

/** Printable account statement (A4). */
export function renderStatement(opts: { business: string; party: string; partyMeta: string; entries: LedgerLine[]; fmt: Formatter; debitLabel: string; creditLabel: string; balanceLabel: string }): string {
  const rows = opts.entries
    .filter((e) => e.debit || e.credit)
    .map((e) => `<tr><td>${esc(opts.fmt.date(e.occurred_at))}</td><td>${esc(TYPE_LABELS[e.type] ?? e.type)}</td><td>${esc(e.reference_no ?? e.notes ?? '')}</td><td class="r">${e.debit ? esc(opts.fmt.money(e.debit)) : ''}</td><td class="r">${e.credit ? esc(opts.fmt.money(e.credit)) : ''}</td><td class="r">${esc(opts.fmt.money(e.balance))}</td></tr>`)
    .join('');
  const closing = opts.entries.at(-1)?.balance ?? 0;
  return `<!doctype html><html><head><meta charset="utf-8"><title>Statement — ${esc(opts.party)}</title><style>
    @page { size: A4; margin: 14mm; } body { font: 11px/1.45 Arial, sans-serif; color: #111; }
    h1 { font-size: 18px; margin: 0; } table { width: 100%; border-collapse: collapse; margin-top: 12px; }
    th, td { border-bottom: 1px solid #ddd; padding: 5px 4px; text-align: left; } th { background: #f3f4f6; } .r { text-align: right; }
    .closing { margin-top: 12px; text-align: right; font-size: 14px; font-weight: 700; }
  </style></head><body>
    <h1>${esc(opts.business)}</h1><p>Statement of account — <b>${esc(opts.party)}</b><br/>${esc(opts.partyMeta)}<br/>Generated ${esc(opts.fmt.dateTime(new Date().toISOString()))}</p>
    <table><thead><tr><th>Date</th><th>Entry</th><th>Reference</th><th class="r">${esc(opts.debitLabel)}</th><th class="r">${esc(opts.creditLabel)}</th><th class="r">Balance</th></tr></thead><tbody>${rows}</tbody></table>
    <div class="closing">${esc(opts.balanceLabel)}: ${esc(opts.fmt.money(closing))}</div>
  </body></html>`;
}
