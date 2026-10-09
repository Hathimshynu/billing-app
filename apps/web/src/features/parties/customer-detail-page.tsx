import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useLiveQuery } from 'dexie-react-hooks';
import { toast } from 'sonner';
import { BanknoteIcon, FileTextIcon, HandCoinsIcon, MessageCircleIcon, PencilIcon, PrinterIcon, ShoppingCartIcon, StarIcon, Trash2Icon, UserIcon } from 'lucide-react';
import { sumDecimals } from '@shopdesk/shared';
import { db, type LocalSale } from '@/lib/db/business';
import { useFormat } from '@/lib/format';
import { printer } from '@/lib/print/printer';
import { currentRegister } from '@/lib/repos/finance';
import { deleteCustomer, ledgerBalance, receiveCustomerPayment } from '@/lib/repos/parties';
import { useBusiness, useCan, useOnline } from '@/hooks/use-app';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { confirm } from '@/components/common/confirm';
import { DataTable, type Column } from '@/components/common/data-table';
import { EmptyState, LoadingRows, Page, PageHeader, StatCard } from '@/components/common/page';
import { PaymentEntryDialog } from '@/components/common/payment-entry-dialog';
import { usePos } from '@/features/pos/pos-store';
import { SaleBadges } from '@/features/sales/sale-utils';
import { LedgerTable, renderStatement, withRunningBalance } from './ledger-table';
import { CustomerFormDialog } from './party-form';

export default function CustomerDetailPage() {
  const { id = '' } = useParams();
  const { t } = useTranslation();
  const fmt = useFormat();
  const can = useCan();
  const online = useOnline();
  const navigate = useNavigate();
  const business = useBusiness();
  const [editOpen, setEditOpen] = useState(false);
  const [payOpen, setPayOpen] = useState(false);

  const data = useLiveQuery(async () => {
    const customer = await db().customers.get(id);
    if (!customer) return { customer: null };
    const [ledger, sales] = await Promise.all([db().customer_ledger.where('customer_id').equals(id).toArray(), db().sales.where('customer_id').equals(id).toArray()]);
    return {
      customer,
      ledger: withRunningBalance(ledger, 1),
      balance: ledgerBalance(ledger),
      points: ledger.reduce((s, e) => s + (e.points ?? 0), 0),
      sales: sales.sort((a, b) => b.occurred_at.localeCompare(a.occurred_at)),
    };
  }, [id]);

  if (!data) {
    return (
      <Page>
        <LoadingRows />
      </Page>
    );
  }
  if (!data.customer) {
    return (
      <Page>
        <EmptyState icon={UserIcon} title={t('customer.not_found', 'Customer not found')} />
      </Page>
    );
  }
  const { customer, ledger = [], balance = 0, points = 0, sales = [] } = data;
  const invoices = sales.filter((s) => s.doc_type === 'invoice' && s.status === 'completed');
  const lifetime = sumDecimals(invoices.map((s) => s.grand_total));

  const statement = () =>
    printer.print(
      renderStatement({
        business: business?.name ?? '',
        party: customer.name,
        partyMeta: [customer.phone, customer.gstin ? `GSTIN ${customer.gstin}` : null].filter(Boolean).join(' · '),
        entries: ledger,
        fmt,
        debitLabel: t('ledger.debit_c', 'Debit (billed)'),
        creditLabel: t('ledger.credit_c', 'Credit (paid)'),
        balanceLabel: balance >= 0 ? t('ledger.closing_due', 'Amount due') : t('ledger.closing_adv', 'Advance'),
      }),
    );

  const remind = () => {
    const phone = (customer.phone ?? '').replace(/\D/g, '');
    const text = t('customer.reminder_text', 'Dear {{name}}, your outstanding balance with {{shop}} is {{amount}}. Kindly pay at your earliest convenience. Thank you!', { name: customer.name, shop: business?.name ?? '', amount: fmt.money(balance) });
    window.open(`https://wa.me/${phone.length === 10 ? `91${phone}` : phone}?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
  };

  const saleColumns: Column<LocalSale>[] = [
    { id: 'number', header: t('sales.number', 'Invoice'), cell: (s) => <span className="font-medium">{s.invoice_number}</span>, value: (s) => s.invoice_number },
    { id: 'date', header: t('sales.date', 'Date'), cell: (s) => fmt.date(s.invoice_date), value: (s) => s.invoice_date },
    { id: 'status', header: t('sales.status', 'Status'), cell: (s) => <SaleBadges sale={s} />, sortable: false },
    { id: 'due', header: t('sales.due', 'Due'), cell: (s) => (s.balance_due > 0 && s.status === 'completed' ? <span className="money text-destructive">{fmt.money(s.balance_due)}</span> : '—'), value: (s) => s.balance_due, align: 'right', numeric: true },
    { id: 'total', header: t('sales.total', 'Total'), cell: (s) => <span className="money">{fmt.money(s.grand_total)}</span>, value: (s) => s.grand_total, align: 'right', numeric: true },
  ];

  return (
    <Page>
      <PageHeader
        back="/customers"
        title={customer.name}
        description={[customer.phone, customer.email, customer.gstin ? `GSTIN ${customer.gstin}` : null, customer.city].filter(Boolean).join(' · ')}
        actions={
          <>
            {can('sales.create') ? (
              <Button
                variant="outline"
                onClick={() => {
                  usePos.getState().setCustomer(customer);
                  navigate('/pos');
                }}
              >
                <ShoppingCartIcon /> {t('customer.new_sale', 'New sale')}
              </Button>
            ) : null}
            <Button variant="outline" onClick={() => void statement()}>
              <PrinterIcon /> {t('customer.statement', 'Statement')}
            </Button>
            {balance > 0 && customer.phone ? (
              <Button variant="outline" onClick={remind} disabled={!online} title={online ? undefined : t('receipt.share_offline', 'Sharing needs internet')}>
                <MessageCircleIcon /> {t('customer.remind', 'Remind')}
              </Button>
            ) : null}
            {can('customers.edit') ? (
              <Button variant="outline" onClick={() => setEditOpen(true)}>
                <PencilIcon /> {t('common.edit', 'Edit')}
              </Button>
            ) : null}
            {can('customers.payments') ? (
              <Button onClick={() => setPayOpen(true)} data-testid="receive-payment">
                <HandCoinsIcon /> {t('customer.receive', 'Receive payment')}
              </Button>
            ) : null}
            {can('customers.delete') ? (
              <Button
                variant="ghost"
                size="icon"
                aria-label={t('common.delete', 'Delete')}
                onClick={async () => {
                  if (balance !== 0) return toast.error(t('customer.delete_balance', 'Settle the balance before deleting this customer.'));
                  const { confirmed } = await confirm({ title: t('customer.delete_title', 'Delete {{name}}?', { name: customer.name }), description: t('customer.delete_hint', 'Past invoices keep the customer name.'), destructive: true, confirmLabel: t('common.delete', 'Delete') });
                  if (!confirmed) return;
                  await deleteCustomer(customer.id);
                  navigate('/customers');
                }}
              >
                <Trash2Icon />
              </Button>
            ) : null}
          </>
        }
      />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label={balance >= 0 ? t('customer.due_label', 'Balance due') : t('customer.advance_label', 'Advance')} value={fmt.money(Math.abs(balance))} icon={BanknoteIcon} className={balance > 0 ? 'border-destructive/40' : undefined} hint={customer.credit_limit ? `${t('customer.credit_limit', 'Credit limit')} ${fmt.money(customer.credit_limit)}` : undefined} />
        <StatCard label={t('customer.lifetime', 'Total purchases')} value={fmt.money(lifetime)} icon={ShoppingCartIcon} hint={`${invoices.length} ${t('dash.bills_short', 'bills')}`} />
        <StatCard label={t('customer.points', 'Points')} value={points} icon={StarIcon} />
        <StatCard label={t('customer.last_visit', 'Last purchase')} value={invoices[0] ? fmt.date(invoices[0].invoice_date) : '—'} icon={FileTextIcon} />
      </div>
      <Tabs defaultValue="ledger">
        <TabsList className="mb-3">
          <TabsTrigger value="ledger">{t('customer.ledger', 'Ledger')}</TabsTrigger>
          <TabsTrigger value="sales">{t('customer.invoices', 'Invoices')}</TabsTrigger>
        </TabsList>
        <TabsContent value="ledger">
          <LedgerTable entries={ledger} debitLabel={t('ledger.debit_c', 'Debit (billed)')} creditLabel={t('ledger.credit_c', 'Credit (paid)')} exportName={`ledger-${customer.name}`} />
        </TabsContent>
        <TabsContent value="sales">
          <DataTable data={sales} columns={saleColumns} rowKey={(s) => s.id} onRowClick={(s) => navigate(`/sales/${s.id}`)} exportName={`invoices-${customer.name}`} empty={{ icon: FileTextIcon, title: t('customer.no_sales', 'No invoices yet') }} />
        </TabsContent>
      </Tabs>
      <CustomerFormDialog open={editOpen} onOpenChange={setEditOpen} customer={customer} />
      <PaymentEntryDialog
        open={payOpen}
        onOpenChange={setPayOpen}
        title={t('customer.receive', 'Receive payment')}
        description={`${customer.name} · ${t('customer.due_label', 'Balance due')} ${fmt.money(Math.max(balance, 0))}`}
        suggested={Math.max(balance, 0)}
        onSubmit={async (input) => {
          const register = await currentRegister();
          // Apply the payment to the oldest unpaid invoices first, so invoice statuses stay accurate.
          let remaining = input.amount;
          const unpaid = invoices.filter((s) => s.balance_due > 0).sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));
          for (const sale of unpaid) {
            if (remaining <= 0) break;
            const part = Math.min(remaining, sale.balance_due);
            await receiveCustomerPayment(customer.id, { ...input, amount: Math.round(part * 100) / 100, sale_id: sale.id, register_id: register?.id ?? null });
            remaining = Math.round((remaining - part) * 100) / 100;
          }
          if (remaining > 0) await receiveCustomerPayment(customer.id, { ...input, amount: remaining, sale_id: null, register_id: register?.id ?? null });
          toast.success(t('sale.payment_recorded', 'Payment recorded'));
        }}
      />
    </Page>
  );
}
