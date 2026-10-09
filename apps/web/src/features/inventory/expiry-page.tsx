import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLiveQuery } from 'dexie-react-hooks';
import { toast } from 'sonner';
import { CalendarClockIcon } from 'lucide-react';
import { businessDate, daysBetween, expiryStatus, roundQty, roundTo, sumDecimals } from '@shopdesk/shared';
import { db } from '@/lib/db/business';
import { useFormat } from '@/lib/format';
import { runtime } from '@/lib/runtime';
import { useSetting } from '@/lib/settings';
import { adjustStock } from '@/lib/repos/inventory';
import { useCan } from '@/hooks/use-app';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { confirm } from '@/components/common/confirm';
import { DataTable, type Column } from '@/components/common/data-table';
import { Page, PageHeader, StatCard } from '@/components/common/page';

interface Row {
  key: string;
  product_id: string;
  variant_id: string | null;
  batch_id: string;
  name: string;
  batch_no: string;
  expiry: string;
  days: number;
  status: 'expired' | 'near_expiry' | 'ok' | 'none';
  qty: number;
  cost: number;
  value: number;
}

export default function ExpiryPage() {
  const { t } = useTranslation();
  const fmt = useFormat();
  const can = useCan();
  const pos = useSetting('pos');
  const [filter, setFilter] = useState('attention');
  const today = businessDate(new Date(), runtime().timezone);

  const rows = useLiveQuery(async () => {
    const [levels, batches, products] = await Promise.all([db().stock_levels.where('store_id').equals(runtime().storeId).toArray(), db().product_batches.toArray(), db().products.toArray()]);
    const batchMap = new Map(batches.map((b) => [b.id, b]));
    const productMap = new Map(products.map((p) => [p.id, p]));
    const out: Row[] = [];
    for (const l of levels) {
      if (!l.batch_id || l.qty <= 0) continue;
      const batch = batchMap.get(l.batch_id);
      const product = productMap.get(l.product_id);
      if (!batch?.expiry_date || !product || product.deleted_at) continue;
      const cost = batch.purchase_price ?? l.avg_cost ?? product.purchase_price;
      out.push({
        key: l.stock_key,
        product_id: l.product_id,
        variant_id: l.variant_id,
        batch_id: batch.id,
        name: product.name,
        batch_no: batch.batch_no,
        expiry: batch.expiry_date,
        days: daysBetween(today, batch.expiry_date),
        status: expiryStatus(batch.expiry_date, today, pos.near_expiry_days) as Row['status'],
        qty: roundQty(l.qty),
        cost,
        value: roundTo(l.qty * cost),
      });
    }
    return out.sort((a, b) => a.expiry.localeCompare(b.expiry));
  }, [today, pos.near_expiry_days]);

  const filtered = (rows ?? []).filter((r) => (filter === 'expired' ? r.status === 'expired' : filter === 'attention' ? r.status !== 'ok' : true));
  const expired = (rows ?? []).filter((r) => r.status === 'expired');
  const near = (rows ?? []).filter((r) => r.status === 'near_expiry');

  const writeOff = async (items: Row[]) => {
    const { confirmed } = await confirm({
      title: t('expiry.writeoff_title', 'Write off {{count}} expired batches?', { count: items.length }),
      description: t('expiry.writeoff_hint', 'Their full remaining quantity is removed from stock as “Expired”.'),
      destructive: true,
      confirmLabel: t('expiry.writeoff', 'Write off'),
    });
    if (!confirmed) return;
    try {
      await adjustStock('expired', items.map((r) => ({ product_id: r.product_id, variant_id: r.variant_id, batch_id: r.batch_id, quantity: -r.qty, unit_cost: r.cost })), 'Expired stock write-off');
      toast.success(t('expiry.written_off', 'Expired stock written off'));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };

  const columns: Column<Row>[] = [
    { id: 'name', header: t('product.name', 'Name'), cell: (r) => <span className="font-medium">{r.name}</span>, value: (r) => r.name },
    { id: 'batch', header: t('product.batch_no', 'Batch no.'), cell: (r) => <span className="font-mono">{r.batch_no}</span>, value: (r) => r.batch_no },
    { id: 'expiry', header: t('product.expiry', 'Expiry date'), cell: (r) => fmt.date(r.expiry), value: (r) => r.expiry },
    {
      id: 'status',
      header: t('sales.status', 'Status'),
      cell: (r) =>
        r.status === 'expired' ? (
          <Badge variant="destructive">{t('expiry.expired_ago', 'Expired {{days}}d ago', { days: Math.abs(r.days) })}</Badge>
        ) : r.status === 'near_expiry' ? (
          <Badge className="bg-warning/25 text-foreground">{t('expiry.in_days', 'In {{days}} days', { days: r.days })}</Badge>
        ) : (
          <Badge variant="secondary">{t('expiry.in_days', 'In {{days}} days', { days: r.days })}</Badge>
        ),
      value: (r) => r.days,
    },
    { id: 'qty', header: t('product.stock', 'Stock'), cell: (r) => fmt.qty(r.qty), value: (r) => r.qty, align: 'right', numeric: true },
    ...(can('products.view_cost') ? [{ id: 'value', header: t('inventory.value', 'Value'), cell: (r: Row) => <span className="money">{fmt.money(r.value)}</span>, value: (r: Row) => r.value, align: 'right' as const, numeric: true }] : []),
    ...(can('inventory.adjust')
      ? [
          {
            id: 'action',
            header: '',
            sortable: false,
            cell: (r: Row) =>
              r.status === 'expired' ? (
                <Button size="xs" variant="outline" onClick={() => void writeOff([r])}>
                  {t('expiry.writeoff', 'Write off')}
                </Button>
              ) : null,
          },
        ]
      : []),
  ];

  return (
    <Page>
      <PageHeader
        back="/inventory"
        title={t('expiry.title', 'Expiry tracking')}
        description={t('expiry.description', 'Batches expiring within {{days}} days are flagged. Expired stock is blocked at the POS.', { days: pos.near_expiry_days })}
        actions={
          can('inventory.adjust') && expired.length ? (
            <Button variant="destructive" onClick={() => void writeOff(expired)}>
              {t('expiry.writeoff_all', 'Write off all expired')}
            </Button>
          ) : null
        }
      />
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatCard label={t('expiry.expired_count', 'Expired batches')} value={expired.length} hint={fmt.money(sumDecimals(expired.map((r) => r.value)))} icon={CalendarClockIcon} />
        <StatCard label={t('expiry.near_count', 'Expiring soon')} value={near.length} hint={fmt.money(sumDecimals(near.map((r) => r.value)))} icon={CalendarClockIcon} />
      </div>
      <DataTable
        data={rows ? filtered : undefined}
        columns={columns}
        rowKey={(r) => r.key}
        searchText={(r) => `${r.name} ${r.batch_no}`}
        exportName="expiry"
        initialSort={{ id: 'expiry', desc: false }}
        toolbar={
          <Select value={filter} onValueChange={setFilter}>
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="attention">{t('expiry.attention', 'Expired & expiring')}</SelectItem>
              <SelectItem value="expired">{t('expiry.only_expired', 'Expired only')}</SelectItem>
              <SelectItem value="all">{t('expiry.all', 'All batches')}</SelectItem>
            </SelectContent>
          </Select>
        }
        empty={{ icon: CalendarClockIcon, title: t('expiry.empty', 'Nothing expiring'), description: t('expiry.empty_hint', 'Batches with stock and an expiry date appear here.') }}
      />
    </Page>
  );
}
