import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLiveQuery } from 'dexie-react-hooks';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { BarChart3Icon } from 'lucide-react';
import { PAYMENT_METHOD_LABELS, sumDecimals } from '@shopdesk/shared';
import { useFormat } from '@/lib/format';
import { runtime } from '@/lib/runtime';
import {
  byCashier,
  byCategory,
  byCustomer,
  byPaymentMethod,
  byProduct,
  customerDues,
  dailySeries,
  expensesInRange,
  hourlySeries,
  hsnSummary,
  profitAndLoss,
  purchasesInRange,
  returnsInRange,
  salesInRange,
  stockValuation,
  summarize,
  supplierDues,
} from '@/lib/reports';
import { useCan } from '@/hooks/use-app';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DataTable, type Column } from '@/components/common/data-table';
import { DateRangePicker, presetRange, type Range } from '@/components/common/date-range';
import { LoadingRows, Page, PageHeader, Section, StatCard } from '@/components/common/page';

type Row = Record<string, string | number | null>;

const REPORTS = [
  { id: 'summary', label: 'Sales summary', financial: false, ranged: true },
  { id: 'daily', label: 'Daily sales', financial: false, ranged: true },
  { id: 'hourly', label: 'Sales by hour', financial: false, ranged: true },
  { id: 'items', label: 'Item-wise sales & margin', financial: true, ranged: true },
  { id: 'categories', label: 'Category-wise sales', financial: false, ranged: true },
  { id: 'customers', label: 'Customer-wise sales', financial: false, ranged: true },
  { id: 'cashiers', label: 'Cashier-wise sales', financial: false, ranged: true },
  { id: 'payments', label: 'Payment methods', financial: false, ranged: true },
  { id: 'gst', label: 'GST / HSN summary', financial: false, ranged: true },
  { id: 'pnl', label: 'Profit & loss', financial: true, ranged: true },
  { id: 'purchases', label: 'Purchases by supplier', financial: true, ranged: true },
  { id: 'expenses', label: 'Expenses by category', financial: true, ranged: true },
  { id: 'stock', label: 'Stock valuation', financial: true, ranged: false },
  { id: 'receivables', label: 'Customer dues', financial: false, ranged: false },
  { id: 'payables', label: 'Supplier dues', financial: true, ranged: false },
] as const;
type ReportId = (typeof REPORTS)[number]['id'];

interface Result {
  rows: Row[];
  columns: Array<{ id: string; header: string; money?: boolean; qty?: boolean }>;
  stats?: Array<{ label: string; value: string }>;
  chart?: Array<{ label: string; value: number }>;
}

export default function ReportsPage() {
  const { t } = useTranslation();
  const fmt = useFormat();
  const can = useCan();
  const [report, setReport] = useState<ReportId>('summary');
  const [range, setRange] = useState<Range>(() => presetRange('month'));
  const available = REPORTS.filter((r) => !r.financial || can('reports.financial'));
  const def = REPORTS.find((r) => r.id === report)!;

  const result = useLiveQuery(() => build(report, range, fmt.date, runtime().timezone), [report, range.from, range.to]);

  const columns: Column<Row>[] = (result?.columns ?? []).map((c) => ({
    id: c.id,
    header: c.header,
    cell: (r) => {
      const v = r[c.id];
      if (c.money) return <span className="money">{fmt.money(Number(v ?? 0))}</span>;
      if (c.qty) return fmt.qty(Number(v ?? 0));
      return v ?? '—';
    },
    value: (r) => r[c.id],
    align: c.money || c.qty ? 'right' : 'left',
    numeric: c.money || c.qty,
  }));

  return (
    <Page>
      <PageHeader title={t('reports.title', 'Reports')} description={t('reports.description', 'Calculated on this device from synced data — available offline.')} />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Select value={report} onValueChange={(v) => setReport(v as ReportId)}>
          <SelectTrigger className="w-64" data-testid="report-select">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {available.map((r) => (
              <SelectItem key={r.id} value={r.id}>
                {t(`reports.r_${r.id}`, r.label)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {def.ranged ? <DateRangePicker value={range} onChange={setRange} /> : null}
      </div>
      {!result ? (
        <LoadingRows />
      ) : (
        <div className="space-y-4">
          {result.stats?.length ? (
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              {result.stats.map((s) => (
                <StatCard key={s.label} label={s.label} value={s.value} />
              ))}
            </div>
          ) : null}
          {result.chart?.length ? (
            <Section title={def.label}>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={result.chart}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} minTickGap={16} />
                    <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={56} tickFormatter={(v: number) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(v))} />
                    <Tooltip formatter={(v) => fmt.money(Number(v))} contentStyle={{ borderRadius: 8, fontSize: 12 }} />
                    <Bar dataKey="value" fill="var(--color-primary)" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Section>
          ) : null}
          <DataTable key={report} data={result.rows} columns={columns} rowKey={(r) => String(r.key ?? JSON.stringify(r))} exportName={`${report}${def.ranged ? `-${range.from}-to-${range.to}` : ''}`} pageSize={50} empty={{ icon: BarChart3Icon, title: t('reports.empty', 'No data for this period') }} />
        </div>
      )}
    </Page>
  );
}

async function build(report: ReportId, range: Range, date: (d: string) => string, timezone: string): Promise<Result> {
  const m = (n: number) => n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  switch (report) {
    case 'summary': {
      const [sales, returns] = await Promise.all([salesInRange(range), returnsInRange(range)]);
      const s = summarize(sales, returns);
      const rows: Row[] = [
        { key: 'count', metric: 'Invoices', value: s.count },
        { key: 'gross', metric: 'Gross sales', value: m(s.gross) },
        { key: 'discount', metric: 'Discounts', value: m(s.discount) },
        { key: 'taxable', metric: 'Taxable value', value: m(s.taxable) },
        { key: 'tax', metric: 'Tax collected', value: m(s.tax) },
        { key: 'total', metric: 'Invoice total', value: m(s.total) },
        { key: 'returns', metric: 'Returns (credit notes)', value: m(s.returns) },
        { key: 'net', metric: 'Net sales', value: m(s.net) },
        { key: 'paid', metric: 'Collected at sale', value: m(s.paid) },
        { key: 'due', metric: 'Outstanding from these invoices', value: m(s.due) },
        { key: 'avg', metric: 'Average bill', value: m(s.average) },
        { key: 'items', metric: 'Items sold', value: s.items },
      ];
      return { rows, columns: [{ id: 'metric', header: 'Metric' }, { id: 'value', header: 'Value' }], stats: [{ label: 'Net sales', value: m(s.net) }, { label: 'Invoices', value: String(s.count) }, { label: 'Tax', value: m(s.tax) }, { label: 'Average bill', value: m(s.average) }] };
    }
    case 'daily': {
      const series = dailySeries(await salesInRange(range), range);
      return { rows: series.map((d) => ({ key: d.date, date: date(d.date), count: d.count, total: d.total })), columns: [{ id: 'date', header: 'Date' }, { id: 'count', header: 'Invoices', qty: true }, { id: 'total', header: 'Sales', money: true }], chart: series.map((d) => ({ label: date(d.date).slice(0, 5), value: d.total })) };
    }
    case 'hourly': {
      const series = hourlySeries(await salesInRange(range), timezone);
      return { rows: series.map((h) => ({ key: h.hour, hour: `${String(h.hour).padStart(2, '0')}:00`, count: h.count, total: h.total })), columns: [{ id: 'hour', header: 'Hour' }, { id: 'count', header: 'Invoices', qty: true }, { id: 'total', header: 'Sales', money: true }], chart: series.map((h) => ({ label: `${h.hour}`, value: h.total })) };
    }
    case 'items': {
      const rows = byProduct(await salesInRange(range)).sort((a, b) => b.total - a.total);
      return {
        rows: rows.map((r) => ({ key: r.key, name: r.name, quantity: r.quantity, taxable: r.taxable, total: r.total, cost: r.cost, profit: r.profit, margin: `${r.margin}%` })),
        columns: [{ id: 'name', header: 'Item' }, { id: 'quantity', header: 'Qty', qty: true }, { id: 'taxable', header: 'Taxable', money: true }, { id: 'total', header: 'Sales', money: true }, { id: 'cost', header: 'Cost', money: true }, { id: 'profit', header: 'Profit', money: true }, { id: 'margin', header: 'Margin' }],
        stats: [{ label: 'Profit', value: m(sumDecimals(rows.map((r) => r.profit))) }, { label: 'Items', value: String(rows.length) }],
      };
    }
    case 'categories': {
      const rows = await byCategory(await salesInRange(range));
      return { rows, columns: [{ id: 'name', header: 'Category' }, { id: 'quantity', header: 'Qty', qty: true }, { id: 'total', header: 'Sales', money: true }], chart: rows.slice(0, 12).map((r) => ({ label: r.name, value: r.total })) };
    }
    case 'customers': {
      const rows = byCustomer(await salesInRange(range));
      return { rows, columns: [{ id: 'name', header: 'Customer' }, { id: 'phone', header: 'Phone' }, { id: 'count', header: 'Invoices', qty: true }, { id: 'total', header: 'Sales', money: true }, { id: 'due', header: 'Due', money: true }] };
    }
    case 'cashiers': {
      const rows = byCashier(await salesInRange(range));
      return { rows, columns: [{ id: 'name', header: 'Cashier' }, { id: 'count', header: 'Invoices', qty: true }, { id: 'cash', header: 'Cash collected', money: true }, { id: 'total', header: 'Sales', money: true }] };
    }
    case 'payments': {
      const rows = byPaymentMethod(await salesInRange(range));
      return { rows: rows.map((r) => ({ key: r.method, method: PAYMENT_METHOD_LABELS[r.method], count: r.count, amount: r.amount })), columns: [{ id: 'method', header: 'Method' }, { id: 'count', header: 'Payments', qty: true }, { id: 'amount', header: 'Amount', money: true }], chart: rows.map((r) => ({ label: PAYMENT_METHOD_LABELS[r.method], value: r.amount })) };
    }
    case 'gst': {
      const [sales, returns] = await Promise.all([salesInRange(range), returnsInRange(range)]);
      const rows = hsnSummary(sales, returns);
      return {
        rows: rows.map((r) => ({ ...r })),
        columns: [{ id: 'hsn', header: 'HSN/SAC' }, { id: 'rate', header: 'Rate %' }, { id: 'quantity', header: 'Qty', qty: true }, { id: 'taxable', header: 'Taxable', money: true }, { id: 'cgst', header: 'CGST', money: true }, { id: 'sgst', header: 'SGST/UTGST', money: true }, { id: 'igst', header: 'IGST', money: true }, { id: 'cess', header: 'Cess', money: true }, { id: 'total_tax', header: 'Total tax', money: true }],
        stats: [{ label: 'Taxable', value: m(sumDecimals(rows.map((r) => r.taxable))) }, { label: 'CGST', value: m(sumDecimals(rows.map((r) => r.cgst))) }, { label: 'SGST', value: m(sumDecimals(rows.map((r) => r.sgst))) }, { label: 'IGST', value: m(sumDecimals(rows.map((r) => r.igst))) }],
      };
    }
    case 'pnl': {
      const p = await profitAndLoss(range);
      const rows: Row[] = [
        { key: 'rev', line: 'Sales (taxable value)', amount: p.revenue },
        { key: 'ret', line: 'Less: returns', amount: -p.returns },
        { key: 'net', line: 'Net revenue', amount: p.netRevenue },
        { key: 'cogs', line: 'Less: cost of goods sold', amount: -p.cogs },
        { key: 'gp', line: 'Gross profit', amount: p.grossProfit },
        ...p.expenseByCategory.map((e) => ({ key: `e-${e.name}`, line: `Expense: ${e.name}`, amount: -e.amount })),
        { key: 'np', line: 'Net profit', amount: p.netProfit },
      ];
      return { rows, columns: [{ id: 'line', header: 'Line' }, { id: 'amount', header: 'Amount', money: true }], stats: [{ label: 'Net revenue', value: m(p.netRevenue) }, { label: 'Gross profit', value: m(p.grossProfit) }, { label: 'Expenses', value: m(p.expenses) }, { label: 'Net profit', value: m(p.netProfit) }] };
    }
    case 'purchases': {
      const purchases = await purchasesInRange(range);
      const map = new Map<string, Row & { total: number; due: number; count: number }>();
      for (const p of purchases) {
        const row = map.get(p.supplier_id) ?? { key: p.supplier_id, name: p.supplier_name ?? '—', count: 0, total: 0, due: 0 };
        row.count += 1;
        row.total = sumDecimals([row.total, p.grand_total]);
        row.due = sumDecimals([row.due, p.balance_due]);
        map.set(p.supplier_id, row);
      }
      return { rows: [...map.values()].sort((a, b) => b.total - a.total), columns: [{ id: 'name', header: 'Supplier' }, { id: 'count', header: 'Bills', qty: true }, { id: 'total', header: 'Purchases', money: true }, { id: 'due', header: 'Due', money: true }] };
    }
    case 'expenses': {
      const expenses = await expensesInRange(range);
      const map = new Map<string, number>();
      for (const e of expenses) map.set(e.category_name ?? 'Other', sumDecimals([map.get(e.category_name ?? 'Other') ?? 0, e.amount]));
      const rows = [...map.entries()].map(([name, amount]) => ({ key: name, name, amount })).sort((a, b) => b.amount - a.amount);
      return { rows, columns: [{ id: 'name', header: 'Category' }, { id: 'amount', header: 'Amount', money: true }], chart: rows.map((r) => ({ label: r.name, value: r.amount })) };
    }
    case 'stock': {
      const rows = await stockValuation(runtime().storeId);
      return {
        rows: rows.map((r) => ({ key: r.product_id, name: r.name, sku: r.sku, category: r.category, quantity: r.quantity, unit_cost: r.unit_cost, value: r.value, retail_value: r.retail_value })),
        columns: [{ id: 'name', header: 'Item' }, { id: 'sku', header: 'SKU' }, { id: 'category', header: 'Category' }, { id: 'quantity', header: 'Qty', qty: true }, { id: 'unit_cost', header: 'Cost', money: true }, { id: 'value', header: 'Value at cost', money: true }, { id: 'retail_value', header: 'Value at price', money: true }],
        stats: [{ label: 'Value at cost', value: m(sumDecimals(rows.map((r) => r.value))) }, { label: 'Value at price', value: m(sumDecimals(rows.map((r) => r.retail_value))) }, { label: 'Items', value: String(rows.length) }],
      };
    }
    case 'receivables': {
      const rows = await customerDues();
      return { rows: rows.map((r) => ({ key: r.id, name: r.name, phone: r.phone, credit_limit: r.credit_limit, last: r.last_activity ? date(r.last_activity) : '—', balance: r.balance })), columns: [{ id: 'name', header: 'Customer' }, { id: 'phone', header: 'Phone' }, { id: 'last', header: 'Last activity' }, { id: 'credit_limit', header: 'Credit limit', money: true }, { id: 'balance', header: 'Due', money: true }], stats: [{ label: 'Total receivable', value: m(sumDecimals(rows.map((r) => r.balance))) }, { label: 'Customers', value: String(rows.length) }] };
    }
    case 'payables': {
      const rows = await supplierDues();
      return { rows: rows.map((r) => ({ key: r.id, name: r.name, phone: r.phone, balance: r.balance })), columns: [{ id: 'name', header: 'Supplier' }, { id: 'phone', header: 'Phone' }, { id: 'balance', header: 'Payable', money: true }], stats: [{ label: 'Total payable', value: m(sumDecimals(rows.map((r) => r.balance))) }] };
    }
  }
}
