import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useLiveQuery } from 'dexie-react-hooks';
import { PackageIcon, PlusIcon, UploadIcon } from 'lucide-react';
import { db, type LocalProduct } from '@/lib/db/business';
import { useFormat } from '@/lib/format';
import { runtime } from '@/lib/runtime';
import { useCan } from '@/hooks/use-app';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DataTable, type Column } from '@/components/common/data-table';
import { Page, PageHeader } from '@/components/common/page';

type Row = LocalProduct & { stock: number | null; category: string };

export default function ProductsPage() {
  const { t } = useTranslation();
  const fmt = useFormat();
  const can = useCan();
  const navigate = useNavigate();
  const [filter, setFilter] = useState('active');
  const [categoryId, setCategoryId] = useState('all');

  const data = useLiveQuery(async () => {
    const [products, categories, levels] = await Promise.all([db().products.filter((p) => !p.deleted_at).sortBy('name'), db().categories.toArray(), db().stock_levels.where('store_id').equals(runtime().storeId).toArray()]);
    const stock = new Map<string, number>();
    for (const l of levels) stock.set(l.product_id, (stock.get(l.product_id) ?? 0) + l.qty);
    const names = new Map(categories.map((c) => [c.id, c.name]));
    return {
      categories: categories.filter((c) => !c.deleted_at),
      rows: products.map((p): Row => ({ ...p, stock: p.track_inventory && p.product_type !== 'service' ? Math.round((stock.get(p.id) ?? 0) * 1000) / 1000 : null, category: (p.category_id && names.get(p.category_id)) || '' })),
    };
  }, []);

  const rows = (data?.rows ?? []).filter((p) => {
    if (categoryId !== 'all' && p.category_id !== categoryId) return false;
    switch (filter) {
      case 'active':
        return p.active;
      case 'inactive':
        return !p.active;
      case 'low':
        return p.active && p.stock !== null && p.stock <= p.reorder_level;
      case 'out':
        return p.active && p.stock !== null && p.stock <= 0;
      default:
        return true;
    }
  });

  const columns: Column<Row>[] = [
    {
      id: 'name',
      header: t('product.name', 'Name'),
      cell: (p) => (
        <span className="flex flex-col">
          <span className="font-medium">
            {p.name} {!p.active ? <Badge variant="outline">{t('product.inactive', 'Inactive')}</Badge> : null} {p._pending ? <Badge variant="outline">{t('sync.pending_short', 'pending')}</Badge> : null}
          </span>
          <span className="text-xs text-muted-foreground">{[p.sku, p.barcode, p.has_variants ? `${p.variants.length} ${t('pos.variants', 'variants')}` : null].filter(Boolean).join(' · ')}</span>
        </span>
      ),
      value: (p) => p.name,
    },
    { id: 'sku', header: 'SKU', cell: (p) => p.sku ?? '—', value: (p) => p.sku ?? '', defaultHidden: true },
    { id: 'barcode', header: t('product.barcode', 'Barcode'), cell: (p) => p.barcode ?? '—', value: (p) => p.barcode ?? '', defaultHidden: true },
    { id: 'category', header: t('product.category', 'Category'), cell: (p) => p.category || '—', value: (p) => p.category, hideOnMobile: true },
    { id: 'hsn', header: 'HSN', cell: (p) => p.hsn_code ?? '—', value: (p) => p.hsn_code ?? '', defaultHidden: true },
    ...(can('products.view_cost') ? [{ id: 'cost', header: t('product.cost', 'Cost'), cell: (p: Row) => <span className="money">{fmt.money(p.purchase_price)}</span>, value: (p: Row) => p.purchase_price, align: 'right' as const, numeric: true, hideOnMobile: true }] : []),
    { id: 'price', header: t('product.price', 'Price'), cell: (p) => (p.product_type === 'jewellery' ? t('pos.by_weight', 'By weight') : <span className="money">{fmt.money(p.selling_price)}</span>), value: (p) => p.selling_price, align: 'right', numeric: true },
    { id: 'mrp', header: 'MRP', cell: (p) => (p.mrp ? <span className="money">{fmt.money(p.mrp)}</span> : '—'), value: (p) => p.mrp, align: 'right', numeric: true, defaultHidden: true },
    {
      id: 'stock',
      header: t('product.stock', 'Stock'),
      cell: (p) => (p.stock === null ? <span className="text-muted-foreground">—</span> : <span className={p.stock <= 0 ? 'font-medium text-destructive' : p.stock <= p.reorder_level ? 'font-medium text-warning-foreground' : ''}>{fmt.qty(p.stock)}</span>),
      value: (p) => p.stock,
      align: 'right',
      numeric: true,
    },
  ];

  return (
    <Page>
      <PageHeader
        title={t('product.title', 'Products')}
        description={`${rows.length} ${t('product.count', 'products')}`}
        actions={
          <>
            {can('data.import') ? (
              <Button variant="outline" asChild>
                <Link to="/settings/import">
                  <UploadIcon /> {t('product.import', 'Import')}
                </Link>
              </Button>
            ) : null}
            {can(['products.create', 'settings.manage']) ? (
              <Button variant="outline" asChild>
                <Link to="/catalog">{t('nav.catalog', 'Categories & taxes')}</Link>
              </Button>
            ) : null}
            {can('products.create') ? (
              <Button asChild data-testid="new-product">
                <Link to="/products/new">
                  <PlusIcon /> {t('product.new', 'New product')}
                </Link>
              </Button>
            ) : null}
          </>
        }
      />
      <DataTable
        data={data ? rows : undefined}
        columns={columns}
        rowKey={(p) => p.id}
        onRowClick={(p) => navigate(`/products/${p.id}`)}
        searchText={(p) => `${p.search ?? p.name} ${(p.codes ?? []).join(' ')}`}
        searchPlaceholder={t('product.search', 'Name, SKU, barcode')}
        exportName="products"
        toolbar={
          <>
            <Select value={filter} onValueChange={setFilter}>
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="active">{t('product.f_active', 'Active')}</SelectItem>
                <SelectItem value="low">{t('product.f_low', 'Low stock')}</SelectItem>
                <SelectItem value="out">{t('product.f_out', 'Out of stock')}</SelectItem>
                <SelectItem value="inactive">{t('product.f_inactive', 'Inactive')}</SelectItem>
                <SelectItem value="all">{t('product.f_all', 'All')}</SelectItem>
              </SelectContent>
            </Select>
            <Select value={categoryId} onValueChange={setCategoryId}>
              <SelectTrigger className="w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('product.all_categories', 'All categories')}</SelectItem>
                {(data?.categories ?? []).map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </>
        }
        empty={{
          icon: PackageIcon,
          title: t('product.empty', 'No products'),
          description: t('product.empty_hint', 'Add products one by one or import them from a CSV / Excel file.'),
          action: can('products.create') ? (
            <Button asChild>
              <Link to="/products/new">
                <PlusIcon /> {t('product.new', 'New product')}
              </Link>
            </Button>
          ) : undefined,
        }}
      />
    </Page>
  );
}
