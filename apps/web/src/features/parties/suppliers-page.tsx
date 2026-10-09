import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useLiveQuery } from 'dexie-react-hooks';
import { PlusIcon, TruckIcon } from 'lucide-react';
import { sumDecimals, type Supplier } from '@shopdesk/shared';
import { db } from '@/lib/db/business';
import { useFormat } from '@/lib/format';
import { supplierBalance } from '@/lib/repos/parties';
import { useCan } from '@/hooks/use-app';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DataTable, type Column } from '@/components/common/data-table';
import { Page, PageHeader } from '@/components/common/page';
import { SupplierFormDialog } from './party-form';

type Row = Supplier & { balance: number };

export default function SuppliersPage() {
  const { t } = useTranslation();
  const fmt = useFormat();
  const can = useCan();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  const rows = useLiveQuery(async () => {
    const [suppliers, ledger] = await Promise.all([db().suppliers.filter((s) => !s.deleted_at).sortBy('name'), db().supplier_ledger.toArray()]);
    const grouped = new Map<string, typeof ledger>();
    for (const e of ledger) grouped.set(e.supplier_id, [...(grouped.get(e.supplier_id) ?? []), e]);
    return suppliers.map((s): Row => ({ ...s, balance: supplierBalance(grouped.get(s.id) ?? []) }));
  }, []);

  const columns: Column<Row>[] = [
    { id: 'name', header: t('supplier.name', 'Name'), cell: (s) => <span className="font-medium">{s.name} {!s.active ? <Badge variant="outline">{t('product.inactive', 'Inactive')}</Badge> : null}</span>, value: (s) => s.name },
    { id: 'phone', header: t('customer.phone', 'Phone'), cell: (s) => s.phone ?? '—', value: (s) => s.phone ?? '', hideOnMobile: true },
    { id: 'gstin', header: 'GSTIN', cell: (s) => s.gstin ?? '—', value: (s) => s.gstin ?? '', hideOnMobile: true },
    { id: 'days', header: t('supplier.credit_days', 'Credit days'), cell: (s) => s.credit_days || '—', value: (s) => s.credit_days, align: 'right', hideOnMobile: true, defaultHidden: true },
    { id: 'balance', header: t('supplier.payable', 'Payable'), cell: (s) => <span className={`money font-medium ${s.balance > 0 ? 'text-destructive' : ''}`}>{fmt.money(s.balance)}</span>, value: (s) => s.balance, align: 'right', numeric: true },
  ];

  return (
    <Page>
      <PageHeader
        title={t('supplier.title', 'Suppliers')}
        description={`${(rows ?? []).length} ${t('supplier.count', 'suppliers')} · ${t('dash.payable', 'to pay')} ${fmt.money(sumDecimals((rows ?? []).filter((s) => s.balance > 0).map((s) => s.balance)))}`}
        actions={
          can('suppliers.create') ? (
            <Button onClick={() => setOpen(true)}>
              <PlusIcon /> {t('supplier.new', 'New supplier')}
            </Button>
          ) : null
        }
      />
      <DataTable
        data={rows}
        columns={columns}
        rowKey={(s) => s.id}
        onRowClick={(s) => navigate(`/suppliers/${s.id}`)}
        searchText={(s) => `${s.name} ${s.phone ?? ''} ${s.gstin ?? ''}`}
        exportName="suppliers"
        empty={{ icon: TruckIcon, title: t('supplier.empty', 'No suppliers yet') }}
      />
      <SupplierFormDialog open={open} onOpenChange={setOpen} supplier={null} onSaved={(s) => navigate(`/suppliers/${s.id}`)} />
    </Page>
  );
}
