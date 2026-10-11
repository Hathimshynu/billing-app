import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useLiveQuery } from 'dexie-react-hooks';
import { PlusIcon, ReceiptIcon } from 'lucide-react';
import { sumDecimals, type Purchase } from '@shopdesk/shared';
import { db } from '@/lib/db/business';
import { useFormat } from '@/lib/format';
import { useCan } from '@/hooks/use-app';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DataTable, type Column } from '@/components/common/data-table';
import { DateRangePicker, presetRange } from '@/components/common/date-range';
import { Page, PageHeader } from '@/components/common/page';

export function PurchaseStatus({ purchase }: { purchase: Purchase & { _pending?: 0 | 1 } }) {
  const { t } = useTranslation();
  return (
    <span className="inline-flex flex-wrap gap-1">
      {purchase.status === 'cancelled' ? (
        <Badge variant="destructive">{t('sale.cancelled', 'Cancelled')}</Badge>
      ) : purchase.doc_type === 'order' ? (
        <Badge variant="secondary">{purchase.status === 'ordered' ? t('purchase.ordered', 'Ordered') : purchase.status === 'partially_received' ? t('purchase.partial_recv', 'Partly received') : t('purchase.received', 'Received')}</Badge>
      ) : null}
      {purchase.status !== 'cancelled' && purchase.status !== 'ordered' ? (
        purchase.payment_status === 'paid' ? (
          <Badge className="bg-success/15 text-success">{t('sale.paid', 'Paid')}</Badge>
        ) : (
          <Badge variant="outline" className="border-destructive/40 text-destructive">
            {purchase.payment_status === 'partial' ? t('sale.partial', 'Partial') : t('sale.unpaid', 'Unpaid')}
          </Badge>
        )
      ) : null}
      {purchase._pending ? <Badge variant="outline">{t('sync.pending_short', 'pending')}</Badge> : null}
    </span>
  );
}

export default function PurchasesPage() {
  const { t } = useTranslation();
  const fmt = useFormat();
  const can = useCan();
  const navigate = useNavigate();
  const [range, setRange] = useState(() => presetRange('30d'));
  const [type, setType] = useState('all');

  const data = useLiveQuery(
    () =>
      db()
        .purchases.where('purchase_date')
        .between(range.from, range.to, true, true)
        .filter((p) => !p.deleted_at)
        .reverse()
        .sortBy('purchase_date'),
    [range.from, range.to],
  );
  const rows = (data ?? []).filter((p) => (type === 'all' ? true : type === 'due' ? p.balance_due > 0 && p.status !== 'cancelled' : type === 'open' ? p.doc_type === 'order' && p.status !== 'received' && p.status !== 'cancelled' : p.doc_type === type));
  const bills = rows.filter((p) => p.doc_type === 'invoice' && p.status !== 'cancelled');

  const columns: Column<Purchase>[] = [
    { id: 'number', header: t('purchase.number', 'Purchase'), cell: (p) => <span className="font-medium">{p.purchase_number}</span>, value: (p) => p.purchase_number },
    { id: 'date', header: t('sales.date', 'Date'), cell: (p) => fmt.date(p.purchase_date), value: (p) => p.purchase_date },
    { id: 'supplier', header: t('purchase.supplier', 'Supplier'), cell: (p) => p.supplier_name ?? '—', value: (p) => p.supplier_name ?? '' },
    { id: 'bill', header: t('purchase.supplier_bill', 'Supplier bill'), cell: (p) => p.supplier_invoice_no ?? '—', value: (p) => p.supplier_invoice_no ?? '', hideOnMobile: true },
    { id: 'status', header: t('sales.status', 'Status'), cell: (p) => <PurchaseStatus purchase={p} />, sortable: false },
    { id: 'due', header: t('sales.due', 'Due'), cell: (p) => (p.balance_due > 0 && p.status !== 'cancelled' ? <span className="money text-destructive">{fmt.money(p.balance_due)}</span> : '—'), value: (p) => p.balance_due, align: 'right', numeric: true, hideOnMobile: true },
    { id: 'total', header: t('sales.total', 'Total'), cell: (p) => <span className="money font-medium">{fmt.money(p.grand_total)}</span>, value: (p) => p.grand_total, align: 'right', numeric: true },
  ];

  return (
    <Page>
      <PageHeader
        title={t('purchase.title', 'Purchases')}
        description={`${bills.length} ${t('supplier.bills', 'bills')} · ${fmt.money(sumDecimals(bills.map((p) => p.grand_total)))}`}
        actions={
          can('purchases.create') ? (
            <>
              <Button variant="outline" asChild>
                <Link to="/purchases/new?type=order">{t('purchase.new_order', 'New purchase order')}</Link>
              </Button>
              <Button asChild data-testid="new-purchase">
                <Link to="/purchases/new">
                  <PlusIcon /> {t('purchase.new', 'New purchase')}
                </Link>
              </Button>
            </>
          ) : null
        }
      />
      <DataTable
        data={data ? rows : undefined}
        columns={columns}
        rowKey={(p) => p.id}
        onRowClick={(p) => navigate(`/purchases/${p.id}`)}
        searchText={(p) => `${p.purchase_number} ${p.supplier_name ?? ''} ${p.supplier_invoice_no ?? ''}`}
        exportName={`purchases-${range.from}-to-${range.to}`}
        toolbar={
          <>
            <DateRangePicker value={range} onChange={setRange} />
            <Select value={type} onValueChange={setType}>
              <SelectTrigger className="w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('purchase.f_all', 'All')}</SelectItem>
                <SelectItem value="invoice">{t('purchase.f_bills', 'Purchase bills')}</SelectItem>
                <SelectItem value="order">{t('purchase.f_orders', 'Purchase orders')}</SelectItem>
                <SelectItem value="open">{t('purchase.f_open', 'Orders to receive')}</SelectItem>
                <SelectItem value="due">{t('purchase.f_due', 'With balance due')}</SelectItem>
              </SelectContent>
            </Select>
          </>
        }
        empty={{ icon: ReceiptIcon, title: t('purchase.empty', 'No purchases yet'), description: t('purchase.empty_hint', 'Record supplier bills here — stock and supplier balances update automatically.') }}
      />
    </Page>
  );
}
