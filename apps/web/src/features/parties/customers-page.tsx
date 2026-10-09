import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useLiveQuery } from 'dexie-react-hooks';
import { PlusIcon, UsersIcon } from 'lucide-react';
import { sumDecimals, type Customer } from '@shopdesk/shared';
import { db } from '@/lib/db/business';
import { useFormat } from '@/lib/format';
import { ledgerBalance } from '@/lib/repos/parties';
import { useCan } from '@/hooks/use-app';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DataTable, type Column } from '@/components/common/data-table';
import { Page, PageHeader } from '@/components/common/page';
import { CustomerFormDialog } from './party-form';

type Row = Customer & { balance: number; points: number; _pending?: 0 | 1 };

export default function CustomersPage() {
  const { t } = useTranslation();
  const fmt = useFormat();
  const can = useCan();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('all');

  const rows = useLiveQuery(async () => {
    const [customers, ledger] = await Promise.all([db().customers.filter((c) => !c.deleted_at).sortBy('name'), db().customer_ledger.toArray()]);
    const grouped = new Map<string, typeof ledger>();
    for (const e of ledger) grouped.set(e.customer_id, [...(grouped.get(e.customer_id) ?? []), e]);
    return customers.map((c): Row => {
      const entries = grouped.get(c.id) ?? [];
      return { ...c, balance: ledgerBalance(entries), points: entries.reduce((s, e) => s + (e.points ?? 0), 0) };
    });
  }, []);
  const filtered = (rows ?? []).filter((c) => (filter === 'due' ? c.balance > 0 : filter === 'over' ? c.credit_limit > 0 && c.balance > c.credit_limit : filter === 'inactive' ? !c.active : true));

  const columns: Column<Row>[] = [
    {
      id: 'name',
      header: t('customer.name', 'Name'),
      cell: (c) => (
        <span className="flex flex-col">
          <span className="font-medium">
            {c.name} {!c.active ? <Badge variant="outline">{t('product.inactive', 'Inactive')}</Badge> : null} {c.tier ? <Badge variant="secondary">{c.tier}</Badge> : null}
          </span>
          <span className="text-xs text-muted-foreground md:hidden">{c.phone}</span>
        </span>
      ),
      value: (c) => c.name,
    },
    { id: 'phone', header: t('customer.phone', 'Phone'), cell: (c) => c.phone ?? '—', value: (c) => c.phone ?? '', hideOnMobile: true },
    { id: 'city', header: t('customer.city', 'City'), cell: (c) => c.city ?? '—', value: (c) => c.city ?? '', hideOnMobile: true, defaultHidden: true },
    { id: 'gstin', header: 'GSTIN', cell: (c) => c.gstin ?? '—', value: (c) => c.gstin ?? '', hideOnMobile: true, defaultHidden: true },
    { id: 'points', header: t('customer.points', 'Points'), cell: (c) => c.points || '—', value: (c) => c.points, align: 'right', hideOnMobile: true, defaultHidden: true },
    { id: 'limit', header: t('customer.credit_limit', 'Credit limit'), cell: (c) => (c.credit_limit ? <span className="money">{fmt.money(c.credit_limit)}</span> : '—'), value: (c) => c.credit_limit, align: 'right', numeric: true, hideOnMobile: true },
    {
      id: 'balance',
      header: t('customer.balance', 'Balance'),
      cell: (c) => <span className={`money font-medium ${c.balance > 0 ? 'text-destructive' : c.balance < 0 ? 'text-success' : ''}`}>{c.balance < 0 ? `${fmt.money(-c.balance)} ${t('customer.advance', 'adv.')}` : fmt.money(c.balance)}</span>,
      value: (c) => c.balance,
      align: 'right',
      numeric: true,
    },
  ];

  return (
    <Page>
      <PageHeader
        title={t('customer.title', 'Customers')}
        description={`${filtered.length} ${t('customer.count', 'customers')} · ${t('dash.receivable', 'To collect')} ${fmt.money(sumDecimals(filtered.filter((c) => c.balance > 0).map((c) => c.balance)))}`}
        actions={
          can('customers.create') ? (
            <Button onClick={() => setOpen(true)} data-testid="new-customer">
              <PlusIcon /> {t('customer.new', 'New customer')}
            </Button>
          ) : null
        }
      />
      <DataTable
        data={rows ? filtered : undefined}
        columns={columns}
        rowKey={(c) => c.id}
        onRowClick={(c) => navigate(`/customers/${c.id}`)}
        searchText={(c) => `${c.name} ${c.phone ?? ''} ${c.gstin ?? ''} ${c.city ?? ''}`}
        searchPlaceholder={t('customer.search', 'Name or phone')}
        exportName="customers"
        toolbar={
          <Select value={filter} onValueChange={setFilter}>
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('customer.f_all', 'All customers')}</SelectItem>
              <SelectItem value="due">{t('customer.f_due', 'With dues')}</SelectItem>
              <SelectItem value="over">{t('customer.f_over', 'Over credit limit')}</SelectItem>
              <SelectItem value="inactive">{t('product.f_inactive', 'Inactive')}</SelectItem>
            </SelectContent>
          </Select>
        }
        empty={{ icon: UsersIcon, title: t('customer.empty', 'No customers yet'), description: t('customer.empty_hint', 'Customers can also be added from the POS while billing.') }}
      />
      <CustomerFormDialog open={open} onOpenChange={setOpen} customer={null} onSaved={(c) => navigate(`/customers/${c.id}`)} />
    </Page>
  );
}
