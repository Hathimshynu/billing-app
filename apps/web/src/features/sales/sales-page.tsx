import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useLiveQuery } from 'dexie-react-hooks';
import { ReceiptIcon, ShoppingCartIcon } from 'lucide-react';
import { sumDecimals } from '@shopdesk/shared';
import { db, type LocalSale } from '@/lib/db/business';
import { useFormat } from '@/lib/format';
import { runtime } from '@/lib/runtime';
import { useCan } from '@/hooks/use-app';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DataTable, type Column } from '@/components/common/data-table';
import { DateRangePicker, presetRange } from '@/components/common/date-range';
import { Page, PageHeader } from '@/components/common/page';
import { SaleBadges } from './sale-utils';

export default function SalesPage() {
  const { t } = useTranslation();
  const fmt = useFormat();
  const can = useCan();
  const navigate = useNavigate();
  const [range, setRange] = useState(() => presetRange('today'));
  const [status, setStatus] = useState('all');

  const sales = useLiveQuery(async () => {
    const userId = runtime().userId;
    const viewAll = can('sales.view_all');
    return db()
      .sales.where('invoice_date')
      .between(range.from, range.to, true, true)
      .filter((s) => s.doc_type === 'invoice' && !s.deleted_at && (viewAll || s.created_by === userId))
      .reverse()
      .sortBy('occurred_at');
  }, [range.from, range.to]);

  const rows = (sales ?? []).filter((s) => {
    switch (status) {
      case 'unpaid':
        return s.status === 'completed' && s.balance_due > 0;
      case 'cancelled':
        return s.status === 'cancelled';
      case 'pending':
        return !!s._pending || s.number_status === 'provisional';
      case 'flagged':
        return (s.review_flags?.length ?? 0) > 0;
      default:
        return true;
    }
  });
  const active = rows.filter((s) => s.status === 'completed');

  const columns: Column<LocalSale>[] = [
    {
      id: 'number',
      header: t('sales.number', 'Invoice'),
      cell: (s) => (
        <span className="flex flex-col">
          <span className="font-medium">{s.invoice_number}</span>
          <span className="text-xs text-muted-foreground md:hidden">{fmt.dateTime(s.occurred_at)}</span>
        </span>
      ),
      value: (s) => s.invoice_number,
    },
    { id: 'date', header: t('sales.date', 'Date'), cell: (s) => fmt.dateTime(s.occurred_at), value: (s) => s.occurred_at, hideOnMobile: true },
    { id: 'customer', header: t('sales.customer', 'Customer'), cell: (s) => s.customer_name ?? <span className="text-muted-foreground">{t('pos.walk_in', 'Walk-in customer')}</span>, value: (s) => s.customer_name ?? '', hideOnMobile: true },
    { id: 'items', header: t('sales.items', 'Items'), cell: (s) => s.items.length, value: (s) => s.items.length, align: 'right', hideOnMobile: true, defaultHidden: true },
    { id: 'cashier', header: t('sales.cashier', 'Cashier'), cell: (s) => s.created_by_name ?? '—', value: (s) => s.created_by_name ?? '', hideOnMobile: true, defaultHidden: true },
    { id: 'status', header: t('sales.status', 'Status'), cell: (s) => <SaleBadges sale={s} />, sortable: false },
    { id: 'due', header: t('sales.due', 'Due'), cell: (s) => (s.balance_due > 0 && s.status === 'completed' ? <span className="money text-destructive">{fmt.money(s.balance_due)}</span> : '—'), value: (s) => s.balance_due, align: 'right', numeric: true, hideOnMobile: true },
    { id: 'total', header: t('sales.total', 'Total'), cell: (s) => <span className={s.status === 'cancelled' ? 'money line-through opacity-60' : 'money font-medium'}>{fmt.money(s.grand_total)}</span>, value: (s) => s.grand_total, align: 'right', numeric: true },
  ];

  return (
    <Page>
      <PageHeader
        title={t('sales.title', 'Sales')}
        description={`${active.length} ${t('sales.invoices', 'invoices')} · ${fmt.money(sumDecimals(active.map((s) => s.grand_total)))}`}
        actions={
          <>
            <Button variant="outline" asChild>
              <Link to="/quotations">{t('nav.quotations', 'Quotations')}</Link>
            </Button>
            {can('sales.create') ? (
              <Button asChild>
                <Link to="/pos">
                  <ShoppingCartIcon /> {t('dash.new_sale', 'New sale')}
                </Link>
              </Button>
            ) : null}
          </>
        }
      />
      <DataTable
        data={sales ? rows : undefined}
        columns={columns}
        rowKey={(s) => s.id}
        onRowClick={(s) => navigate(`/sales/${s.id}`)}
        searchText={(s) => `${s.invoice_number} ${s.provisional_number ?? ''} ${s.customer_name ?? ''} ${s.customer_phone ?? ''}`}
        searchPlaceholder={t('sales.search', 'Invoice no., customer, phone')}
        exportName={`sales-${range.from}-to-${range.to}`}
        toolbar={
          <>
            <DateRangePicker value={range} onChange={setRange} />
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="w-40" aria-label={t('sales.status', 'Status')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('sales.all', 'All invoices')}</SelectItem>
                <SelectItem value="unpaid">{t('sales.unpaid_only', 'With balance due')}</SelectItem>
                <SelectItem value="pending">{t('sales.unsynced', 'Not yet synced')}</SelectItem>
                <SelectItem value="flagged">{t('sales.flagged', 'Flagged for review')}</SelectItem>
                <SelectItem value="cancelled">{t('sale.cancelled', 'Cancelled')}</SelectItem>
              </SelectContent>
            </Select>
          </>
        }
        empty={{ icon: ReceiptIcon, title: t('sales.empty', 'No sales in this period'), description: t('sales.empty_hint', 'Sales you make on the POS appear here instantly, even offline.') }}
      />
    </Page>
  );
}
