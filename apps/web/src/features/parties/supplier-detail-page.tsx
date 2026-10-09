import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useLiveQuery } from 'dexie-react-hooks';
import { toast } from 'sonner';
import { BanknoteIcon, PencilIcon, PlusIcon, PrinterIcon, ReceiptIcon, Trash2Icon, TruckIcon } from 'lucide-react';
import { sumDecimals, type Purchase } from '@shopdesk/shared';
import { db } from '@/lib/db/business';
import { useFormat } from '@/lib/format';
import { printer } from '@/lib/print/printer';
import { currentRegister } from '@/lib/repos/finance';
import { deleteSupplier, paySupplier, supplierBalance } from '@/lib/repos/parties';
import { useBusiness, useCan } from '@/hooks/use-app';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { confirm } from '@/components/common/confirm';
import { DataTable, type Column } from '@/components/common/data-table';
import { EmptyState, LoadingRows, Page, PageHeader, StatCard } from '@/components/common/page';
import { PaymentEntryDialog } from '@/components/common/payment-entry-dialog';
import { LedgerTable, renderStatement, withRunningBalance } from './ledger-table';
import { SupplierFormDialog } from './party-form';

export default function SupplierDetailPage() {
  const { id = '' } = useParams();
  const { t } = useTranslation();
  const fmt = useFormat();
  const can = useCan();
  const navigate = useNavigate();
  const business = useBusiness();
  const [editOpen, setEditOpen] = useState(false);
  const [payOpen, setPayOpen] = useState(false);

  const data = useLiveQuery(async () => {
    const supplier = await db().suppliers.get(id);
    if (!supplier) return { supplier: null };
    const [ledger, purchases] = await Promise.all([db().supplier_ledger.where('supplier_id').equals(id).toArray(), db().purchases.where('supplier_id').equals(id).toArray()]);
    return { supplier, ledger: withRunningBalance(ledger, -1), balance: supplierBalance(ledger), purchases: purchases.sort((a, b) => b.purchase_date.localeCompare(a.purchase_date)) };
  }, [id]);

  if (!data) {
    return (
      <Page>
        <LoadingRows />
      </Page>
    );
  }
  if (!data.supplier) {
    return (
      <Page>
        <EmptyState icon={TruckIcon} title={t('supplier.not_found', 'Supplier not found')} />
      </Page>
    );
  }
  const { supplier, ledger = [], balance = 0, purchases = [] } = data;
  const bills = purchases.filter((p) => p.doc_type === 'invoice' && p.status !== 'cancelled');

  const columns: Column<Purchase>[] = [
    { id: 'number', header: t('purchase.number', 'Purchase'), cell: (p) => <span className="font-medium">{p.purchase_number}</span>, value: (p) => p.purchase_number },
    { id: 'bill', header: t('purchase.supplier_bill', 'Supplier bill'), cell: (p) => p.supplier_invoice_no ?? '—', value: (p) => p.supplier_invoice_no ?? '' },
    { id: 'date', header: t('sales.date', 'Date'), cell: (p) => fmt.date(p.purchase_date), value: (p) => p.purchase_date },
    { id: 'status', header: t('sales.status', 'Status'), cell: (p) => <Badge variant="outline">{p.doc_type === 'order' ? t('purchase.order', 'Order') : p.status.replace('_', ' ')}</Badge>, value: (p) => p.status },
    { id: 'due', header: t('sales.due', 'Due'), cell: (p) => (p.balance_due > 0 ? <span className="money text-destructive">{fmt.money(p.balance_due)}</span> : '—'), value: (p) => p.balance_due, align: 'right', numeric: true },
    { id: 'total', header: t('sales.total', 'Total'), cell: (p) => <span className="money">{fmt.money(p.grand_total)}</span>, value: (p) => p.grand_total, align: 'right', numeric: true },
  ];

  return (
    <Page>
      <PageHeader
        back="/suppliers"
        title={supplier.name}
        description={[supplier.phone, supplier.email, supplier.gstin ? `GSTIN ${supplier.gstin}` : null].filter(Boolean).join(' · ')}
        actions={
          <>
            {can('purchases.create') ? (
              <Button variant="outline" asChild>
                <Link to={`/purchases/new?supplier=${supplier.id}`}>
                  <PlusIcon /> {t('purchase.new', 'New purchase')}
                </Link>
              </Button>
            ) : null}
            <Button
              variant="outline"
              onClick={() =>
                void printer.print(
                  renderStatement({
                    business: business?.name ?? '',
                    party: supplier.name,
                    partyMeta: [supplier.phone, supplier.gstin ? `GSTIN ${supplier.gstin}` : null].filter(Boolean).join(' · '),
                    entries: ledger,
                    fmt,
                    debitLabel: t('ledger.debit_s', 'Debit (paid / returned)'),
                    creditLabel: t('ledger.credit_s', 'Credit (purchased)'),
                    balanceLabel: t('supplier.payable', 'Payable'),
                  }),
                )
              }
            >
              <PrinterIcon /> {t('customer.statement', 'Statement')}
            </Button>
            {can('suppliers.edit') ? (
              <Button variant="outline" onClick={() => setEditOpen(true)}>
                <PencilIcon /> {t('common.edit', 'Edit')}
              </Button>
            ) : null}
            {can('suppliers.payments') ? (
              <Button onClick={() => setPayOpen(true)}>
                <BanknoteIcon /> {t('supplier.pay', 'Pay supplier')}
              </Button>
            ) : null}
            {can('suppliers.delete') ? (
              <Button
                variant="ghost"
                size="icon"
                aria-label={t('common.delete', 'Delete')}
                onClick={async () => {
                  if (balance !== 0) return toast.error(t('supplier.delete_balance', 'Settle the balance before deleting this supplier.'));
                  const { confirmed } = await confirm({ title: t('customer.delete_title', 'Delete {{name}}?', { name: supplier.name }), destructive: true, confirmLabel: t('common.delete', 'Delete') });
                  if (!confirmed) return;
                  await deleteSupplier(supplier.id);
                  navigate('/suppliers');
                }}
              >
                <Trash2Icon />
              </Button>
            ) : null}
          </>
        }
      />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-3">
        <StatCard label={t('supplier.payable', 'Payable')} value={fmt.money(balance)} icon={BanknoteIcon} />
        <StatCard label={t('supplier.total_purchases', 'Total purchases')} value={fmt.money(sumDecimals(bills.map((p) => p.grand_total)))} icon={ReceiptIcon} hint={`${bills.length} ${t('supplier.bills', 'bills')}`} />
        <StatCard label={t('supplier.credit_days', 'Credit days')} value={supplier.credit_days || '—'} icon={TruckIcon} />
      </div>
      <Tabs defaultValue="ledger">
        <TabsList className="mb-3">
          <TabsTrigger value="ledger">{t('customer.ledger', 'Ledger')}</TabsTrigger>
          <TabsTrigger value="purchases">{t('nav.purchases', 'Purchases')}</TabsTrigger>
        </TabsList>
        <TabsContent value="ledger">
          <LedgerTable entries={ledger} debitLabel={t('ledger.debit_s', 'Debit (paid / returned)')} creditLabel={t('ledger.credit_s', 'Credit (purchased)')} exportName={`ledger-${supplier.name}`} />
        </TabsContent>
        <TabsContent value="purchases">
          <DataTable data={purchases} columns={columns} rowKey={(p) => p.id} onRowClick={(p) => navigate(`/purchases/${p.id}`)} exportName={`purchases-${supplier.name}`} empty={{ icon: ReceiptIcon, title: t('purchase.empty', 'No purchases yet') }} />
        </TabsContent>
      </Tabs>
      <SupplierFormDialog open={editOpen} onOpenChange={setEditOpen} supplier={supplier} />
      <PaymentEntryDialog
        open={payOpen}
        onOpenChange={setPayOpen}
        title={t('supplier.pay', 'Pay supplier')}
        description={`${supplier.name} · ${t('supplier.payable', 'Payable')} ${fmt.money(Math.max(balance, 0))}`}
        suggested={Math.max(balance, 0)}
        onSubmit={async (input) => {
          const register = input.method === 'cash' ? await currentRegister() : undefined;
          let remaining = input.amount;
          const unpaid = bills.filter((p) => p.balance_due > 0).sort((a, b) => a.purchase_date.localeCompare(b.purchase_date));
          for (const bill of unpaid) {
            if (remaining <= 0) break;
            const part = Math.min(remaining, bill.balance_due);
            await paySupplier(supplier.id, { ...input, amount: Math.round(part * 100) / 100, purchase_id: bill.id, register_id: register?.id ?? null });
            remaining = Math.round((remaining - part) * 100) / 100;
          }
          if (remaining > 0) await paySupplier(supplier.id, { ...input, amount: remaining, purchase_id: null, register_id: register?.id ?? null });
          toast.success(t('supplier.paid', 'Payment recorded'));
        }}
      />
    </Page>
  );
}
