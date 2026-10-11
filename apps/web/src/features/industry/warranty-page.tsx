import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useLiveQuery } from 'dexie-react-hooks';
import { ShieldCheckIcon } from 'lucide-react';
import { businessDate, normalizeBarcode } from '@shopdesk/shared';
import { db } from '@/lib/db/business';
import { useFormat } from '@/lib/format';
import { runtime } from '@/lib/runtime';
import { Badge } from '@/components/ui/badge';
import { DataTable, type Column } from '@/components/common/data-table';
import { Page, PageHeader } from '@/components/common/page';
import { Input } from '@/components/ui/input';

interface Row {
  id: string;
  serial: string;
  imei: string;
  product: string;
  status: string;
  customer: string;
  sold_at: string | null;
  sale_id: string | null;
  expires: string | null;
}

/** IMEI / serial lookup: who bought it, when, and whether it is still under warranty. */
export default function WarrantyPage() {
  const { t } = useTranslation();
  const fmt = useFormat();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const today = businessDate(new Date(), runtime().timezone);

  const rows = useLiveQuery(async () => {
    const q = normalizeBarcode(query).toLowerCase();
    const [serials, products, customers] = await Promise.all([db().product_serials.filter((s) => !s.deleted_at && (!q || [s.serial_no, s.imei1, s.imei2].some((v) => v?.toLowerCase().includes(q)))).limit(500).toArray(), db().products.toArray(), db().customers.toArray()]);
    const pn = new Map(products.map((p) => [p.id, p.name]));
    const cn = new Map(customers.map((c) => [c.id, `${c.name}${c.phone ? ` · ${c.phone}` : ''}`]));
    return serials.map(
      (s): Row => ({
        id: s.id,
        serial: s.serial_no,
        imei: [s.imei1, s.imei2].filter(Boolean).join(' / '),
        product: pn.get(s.product_id) ?? '—',
        status: s.status,
        customer: s.customer_id ? (cn.get(s.customer_id) ?? '—') : '—',
        sold_at: s.sold_at,
        sale_id: s.sale_id,
        expires: s.warranty_expires_at,
      }),
    );
  }, [query]);

  const columns: Column<Row>[] = [
    { id: 'serial', header: t('warranty.serial', 'Serial / IMEI'), cell: (r) => <span className="font-mono text-xs">{r.serial}{r.imei && r.imei !== r.serial ? <span className="block text-muted-foreground">{r.imei}</span> : null}</span>, value: (r) => r.serial },
    { id: 'product', header: t('product.name', 'Name'), cell: (r) => r.product, value: (r) => r.product },
    { id: 'status', header: t('sales.status', 'Status'), cell: (r) => <Badge variant={r.status === 'in_stock' ? 'secondary' : 'outline'}>{r.status.replace('_', ' ')}</Badge>, value: (r) => r.status },
    { id: 'customer', header: t('sales.customer', 'Customer'), cell: (r) => r.customer, value: (r) => r.customer, hideOnMobile: true },
    { id: 'sold', header: t('warranty.sold', 'Sold'), cell: (r) => fmt.date(r.sold_at), value: (r) => r.sold_at ?? '', hideOnMobile: true },
    {
      id: 'warranty',
      header: t('warranty.title_col', 'Warranty'),
      cell: (r) => (r.expires ? r.expires >= today ? <Badge className="bg-success/15 text-success">{t('warranty.until', 'Until {{date}}', { date: fmt.date(r.expires) })}</Badge> : <Badge variant="outline">{t('warranty.expired', 'Expired {{date}}', { date: fmt.date(r.expires) })}</Badge> : '—'),
      value: (r) => r.expires ?? '',
    },
  ];

  return (
    <Page>
      <PageHeader title={t('warranty.title', 'IMEI & warranty lookup')} />
      <Input autoFocus className="mb-4 max-w-md" placeholder={t('warranty.search', 'Scan or type IMEI / serial number')} value={query} onChange={(e) => setQuery(e.target.value)} data-testid="warranty-search" />
      <DataTable data={rows} columns={columns} rowKey={(r) => r.id} onRowClick={(r) => r.sale_id && navigate(`/sales/${r.sale_id}`)} exportName="serials" empty={{ icon: ShieldCheckIcon, title: t('warranty.empty', 'No matching serial numbers') }} />
    </Page>
  );
}
