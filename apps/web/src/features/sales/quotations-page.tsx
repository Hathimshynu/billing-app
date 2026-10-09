import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useLiveQuery } from 'dexie-react-hooks';
import { FileTextIcon, PlusIcon } from 'lucide-react';
import { db, type LocalSale } from '@/lib/db/business';
import { useFormat } from '@/lib/format';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DataTable, type Column } from '@/components/common/data-table';
import { todayString } from '@/components/common/date-range';
import { Page, PageHeader } from '@/components/common/page';
import { usePos } from '@/features/pos/pos-store';
import { DOC_LABELS, SaleBadges } from './sale-utils';

export default function QuotationsPage() {
  const { t } = useTranslation();
  const fmt = useFormat();
  const navigate = useNavigate();
  const [type, setType] = useState('all');
  const today = todayString();

  const docs = useLiveQuery(() => db().sales.where('doc_type').anyOf(['quotation', 'estimate', 'proforma', 'delivery_challan']).filter((s) => !s.deleted_at).reverse().sortBy('occurred_at'), []);
  const rows = (docs ?? []).filter((d) => type === 'all' || d.doc_type === type);

  const columns: Column<LocalSale>[] = [
    { id: 'number', header: t('quote.number', 'Number'), cell: (s) => <span className="font-medium">{s.invoice_number}</span>, value: (s) => s.invoice_number },
    { id: 'type', header: t('quote.type', 'Type'), cell: (s) => DOC_LABELS[s.doc_type], value: (s) => s.doc_type },
    { id: 'date', header: t('sales.date', 'Date'), cell: (s) => fmt.date(s.invoice_date), value: (s) => s.invoice_date, hideOnMobile: true },
    { id: 'customer', header: t('sales.customer', 'Customer'), cell: (s) => s.customer_name ?? '—', value: (s) => s.customer_name ?? '' },
    {
      id: 'valid',
      header: t('quote.valid_until', 'Valid until'),
      cell: (s) => (s.valid_until ? <span className={s.status === 'draft' && s.valid_until < today ? 'text-destructive' : ''}>{fmt.date(s.valid_until)}</span> : '—'),
      value: (s) => s.valid_until ?? '',
      hideOnMobile: true,
    },
    {
      id: 'status',
      header: t('sales.status', 'Status'),
      cell: (s) => (s.status === 'draft' ? s.valid_until && s.valid_until < today ? <Badge variant="outline">{t('quote.expired', 'Expired')}</Badge> : <Badge variant="secondary">{t('quote.open', 'Open')}</Badge> : <SaleBadges sale={s} />),
      sortable: false,
    },
    { id: 'total', header: t('sales.total', 'Total'), cell: (s) => <span className="money">{fmt.money(s.grand_total)}</span>, value: (s) => s.grand_total, align: 'right', numeric: true },
  ];

  return (
    <Page>
      <PageHeader
        title={t('quote.title', 'Quotations & documents')}
        description={t('quote.description', 'Quotations, estimates, proforma invoices and delivery challans.')}
        actions={
          <Button
            onClick={() => {
              const pos = usePos.getState();
              pos.clear();
              pos.setDocType('quotation');
              navigate('/pos');
            }}
          >
            <PlusIcon /> {t('quote.new', 'New quotation')}
          </Button>
        }
      />
      <DataTable
        data={docs ? rows : undefined}
        columns={columns}
        rowKey={(s) => s.id}
        onRowClick={(s) => navigate(`/sales/${s.id}`)}
        searchText={(s) => `${s.invoice_number} ${s.customer_name ?? ''} ${s.customer_phone ?? ''}`}
        exportName="quotations"
        toolbar={
          <Select value={type} onValueChange={setType}>
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('quote.all', 'All types')}</SelectItem>
              {Object.entries(DOC_LABELS)
                .filter(([k]) => k !== 'invoice')
                .map(([k, label]) => (
                  <SelectItem key={k} value={k}>
                    {label}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        }
        empty={{
          icon: FileTextIcon,
          title: t('quote.empty', 'No quotations yet'),
          description: t('quote.empty_hint', 'Choose “Quotation” as the document type on the POS to create one.'),
          action: (
            <Button asChild variant="outline">
              <Link to="/pos">{t('nav.pos', 'POS')}</Link>
            </Button>
          ),
        }}
      />
    </Page>
  );
}
