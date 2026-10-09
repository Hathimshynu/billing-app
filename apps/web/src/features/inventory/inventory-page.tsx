import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useLiveQuery } from 'dexie-react-hooks';
import { toast } from 'sonner';
import { ArrowRightLeftIcon, BoxesIcon, CalendarClockIcon, ClipboardListIcon, PackageCheckIcon, SlidersHorizontalIcon, Trash2Icon } from 'lucide-react';
import { roundQty, roundTo, sumDecimals, type AdjustmentType, type InventoryMovement, type StockTransfer } from '@shopdesk/shared';
import { db } from '@/lib/db/business';
import { useFormat } from '@/lib/format';
import { runtime } from '@/lib/runtime';
import { adjustStock, createTransfer, receiveTransfer, setCountedStock, type AdjustmentLine } from '@/lib/repos/inventory';
import { useCan } from '@/hooks/use-app';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DataTable, type Column } from '@/components/common/data-table';
import { FormRow } from '@/components/common/form';
import { NumberInput } from '@/components/common/number-input';
import { Page, PageHeader, StatCard } from '@/components/common/page';
import { ProductSearch, type ProductPick } from '@/components/common/product-search';
import { ResponsiveDialog } from '@/components/common/responsive-dialog';

interface StockRow {
  key: string;
  product_id: string;
  variant_id: string | null;
  batch_id: string | null;
  name: string;
  sku: string | null;
  batch: string | null;
  expiry: string | null;
  qty: number;
  avg_cost: number;
  value: number;
  reorder: number;
}

export default function InventoryPage() {
  const { t } = useTranslation();
  const can = useCan();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const tab = params.get('tab') ?? 'stock';
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  return (
    <Page>
      <PageHeader
        title={t('inventory.title', 'Inventory')}
        actions={
          <>
            <Button variant="outline" asChild>
              <Link to="/inventory/expiry">
                <CalendarClockIcon /> {t('inventory.expiry', 'Expiry')}
              </Link>
            </Button>
            {can('inventory.transfer') ? (
              <Button variant="outline" onClick={() => setTransferOpen(true)}>
                <ArrowRightLeftIcon /> {t('inventory.transfer', 'Transfer')}
              </Button>
            ) : null}
            {can('inventory.adjust') ? (
              <Button onClick={() => setAdjustOpen(true)} data-testid="adjust-stock">
                <SlidersHorizontalIcon /> {t('inventory.adjust', 'Adjust stock')}
              </Button>
            ) : null}
          </>
        }
      />
      <Tabs value={tab} onValueChange={(v) => navigate(`/inventory?tab=${v}`, { replace: true })}>
        <TabsList className="mb-4">
          <TabsTrigger value="stock">{t('inventory.stock', 'Stock')}</TabsTrigger>
          <TabsTrigger value="ledger">{t('inventory.ledger', 'Stock ledger')}</TabsTrigger>
          <TabsTrigger value="transfers">{t('inventory.transfers', 'Transfers')}</TabsTrigger>
        </TabsList>
        <TabsContent value="stock">
          <StockTab />
        </TabsContent>
        <TabsContent value="ledger">
          <LedgerTab />
        </TabsContent>
        <TabsContent value="transfers">
          <TransfersTab />
        </TabsContent>
      </Tabs>
      <AdjustDialog open={adjustOpen} onOpenChange={setAdjustOpen} />
      <TransferDialog open={transferOpen} onOpenChange={setTransferOpen} />
    </Page>
  );
}

function StockTab() {
  const { t } = useTranslation();
  const fmt = useFormat();
  const can = useCan();
  const [filter, setFilter] = useState('all');
  const [counting, setCounting] = useState<StockRow | null>(null);
  const showCost = can('products.view_cost');

  const rows = useLiveQuery(async () => {
    const storeId = runtime().storeId;
    const [levels, products, batches] = await Promise.all([db().stock_levels.where('store_id').equals(storeId).toArray(), db().products.toArray(), db().product_batches.toArray()]);
    const productMap = new Map(products.map((p) => [p.id, p]));
    const batchMap = new Map(batches.map((b) => [b.id, b]));
    const out: StockRow[] = [];
    const seen = new Set<string>();
    for (const l of levels) {
      const p = productMap.get(l.product_id);
      if (!p || p.deleted_at) continue;
      seen.add(p.id);
      const variant = l.variant_id ? p.variants.find((v) => v.id === l.variant_id) : null;
      const batch = l.batch_id ? batchMap.get(l.batch_id) : null;
      const cost = l.avg_cost || p.purchase_price;
      out.push({
        key: l.stock_key,
        product_id: p.id,
        variant_id: l.variant_id,
        batch_id: l.batch_id,
        name: variant ? `${p.name} (${variant.name})` : p.name,
        sku: variant?.sku ?? p.sku,
        batch: batch?.batch_no ?? null,
        expiry: batch?.expiry_date ?? null,
        qty: roundQty(l.qty),
        avg_cost: cost,
        value: roundTo(Math.max(l.qty, 0) * cost),
        reorder: p.reorder_level,
      });
    }
    // Tracked products with no stock row yet show as zero stock.
    for (const p of products) {
      if (seen.has(p.id) || p.deleted_at || !p.active || !p.track_inventory || p.product_type === 'service') continue;
      out.push({ key: p.id, product_id: p.id, variant_id: null, batch_id: null, name: p.name, sku: p.sku, batch: null, expiry: null, qty: 0, avg_cost: p.purchase_price, value: 0, reorder: p.reorder_level });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }, []);

  const filtered = (rows ?? []).filter((r) => (filter === 'low' ? r.qty <= r.reorder : filter === 'negative' ? r.qty < 0 : filter === 'zero' ? r.qty === 0 : true));
  const totalValue = sumDecimals(filtered.map((r) => r.value));

  const columns: Column<StockRow>[] = [
    { id: 'name', header: t('product.name', 'Name'), cell: (r) => <span className="font-medium">{r.name}</span>, value: (r) => r.name },
    { id: 'sku', header: 'SKU', cell: (r) => r.sku ?? '—', value: (r) => r.sku ?? '', hideOnMobile: true, defaultHidden: true },
    { id: 'batch', header: t('product.batch_no', 'Batch no.'), cell: (r) => (r.batch ? `${r.batch}${r.expiry ? ` · ${fmt.date(r.expiry)}` : ''}` : '—'), value: (r) => r.batch ?? '', hideOnMobile: true },
    { id: 'qty', header: t('product.stock', 'Stock'), cell: (r) => <span className={r.qty < 0 ? 'font-semibold text-destructive' : r.qty <= r.reorder ? 'font-semibold text-warning-foreground' : ''}>{fmt.qty(r.qty)}</span>, value: (r) => r.qty, align: 'right', numeric: true },
    ...(showCost
      ? [
          { id: 'cost', header: t('inventory.avg_cost', 'Avg. cost'), cell: (r: StockRow) => <span className="money">{fmt.money(r.avg_cost)}</span>, value: (r: StockRow) => r.avg_cost, align: 'right' as const, numeric: true, hideOnMobile: true },
          { id: 'value', header: t('inventory.value', 'Value'), cell: (r: StockRow) => <span className="money">{fmt.money(r.value)}</span>, value: (r: StockRow) => r.value, align: 'right' as const, numeric: true },
        ]
      : []),
    ...(can('inventory.adjust')
      ? [
          {
            id: 'count',
            header: '',
            sortable: false,
            cell: (r: StockRow) => (
              <Button
                size="xs"
                variant="outline"
                onClick={(e) => {
                  e.stopPropagation();
                  setCounting(r);
                }}
              >
                {t('inventory.count', 'Count')}
              </Button>
            ),
          },
        ]
      : []),
  ];

  return (
    <div className="space-y-4">
      {showCost ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <StatCard label={t('inventory.items', 'Stock rows')} value={filtered.length} icon={BoxesIcon} />
          <StatCard label={t('inventory.value', 'Value')} value={fmt.money(totalValue)} icon={PackageCheckIcon} hint={t('inventory.at_cost', 'At average cost')} />
          <StatCard label={t('inventory.low', 'Low / out of stock')} value={(rows ?? []).filter((r) => r.qty <= r.reorder).length} icon={ClipboardListIcon} />
        </div>
      ) : null}
      <DataTable
        data={rows ? filtered : undefined}
        columns={columns}
        rowKey={(r) => r.key}
        searchText={(r) => `${r.name} ${r.sku ?? ''} ${r.batch ?? ''}`}
        exportName="stock"
        toolbar={
          <Select value={filter} onValueChange={setFilter}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('inventory.f_all', 'All stock')}</SelectItem>
              <SelectItem value="low">{t('product.f_low', 'Low stock')}</SelectItem>
              <SelectItem value="zero">{t('inventory.f_zero', 'Zero stock')}</SelectItem>
              <SelectItem value="negative">{t('inventory.f_negative', 'Negative stock')}</SelectItem>
            </SelectContent>
          </Select>
        }
        empty={{ icon: BoxesIcon, title: t('inventory.empty', 'No stock yet'), description: t('inventory.empty_hint', 'Stock comes from opening stock, purchases and adjustments.') }}
      />
      <CountDialog row={counting} onClose={() => setCounting(null)} />
    </div>
  );
}

function CountDialog({ row, onClose }: { row: StockRow | null; onClose: () => void }) {
  const { t } = useTranslation();
  const fmt = useFormat();
  const [counted, setCounted] = useState<number | null>(null);
  const [reason, setReason] = useState('');
  const save = async () => {
    if (!row || counted === null) return;
    try {
      await setCountedStock(row.product_id, row.variant_id, row.batch_id, counted, reason.trim() || 'Stock count');
      toast.success(t('inventory.count_saved', 'Stock updated to {{qty}}', { qty: fmt.qty(counted) }));
      setCounted(null);
      setReason('');
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };
  return (
    <ResponsiveDialog
      open={!!row}
      onOpenChange={(o) => !o && onClose()}
      size="sm"
      title={t('inventory.count_title', 'Physical count')}
      description={row ? `${row.name}${row.batch ? ` · ${row.batch}` : ''} — ${t('inventory.system_qty', 'system stock')} ${fmt.qty(row.qty)}` : ''}
      footer={
        <Button onClick={() => void save()} disabled={counted === null}>
          {t('inventory.set_count', 'Set stock')}
        </Button>
      }
    >
      <div className="space-y-3">
        <FormRow label={t('inventory.counted', 'Counted quantity')} htmlFor="cnt">
          <NumberInput id="cnt" autoFocus value={counted} onValueChange={setCounted} decimals={3} onKeyDown={(e) => e.key === 'Enter' && void save()} />
        </FormRow>
        {row && counted !== null ? (
          <p className="text-sm text-muted-foreground">
            {t('inventory.difference', 'Difference')}: <span className="font-medium text-foreground">{fmt.qty(roundQty(counted - row.qty))}</span>
          </p>
        ) : null}
        <FormRow label={t('return.reason', 'Reason')} htmlFor="cnt-r">
          <Input id="cnt-r" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t('inventory.count_reason', 'Stock count')} />
        </FormRow>
      </div>
    </ResponsiveDialog>
  );
}

const MOVEMENT_LABELS: Record<string, string> = {
  PURCHASE: 'Purchase',
  SALE: 'Sale',
  SALE_RETURN: 'Sale return',
  PURCHASE_RETURN: 'Purchase return',
  ADJUSTMENT: 'Adjustment',
  TRANSFER_IN: 'Transfer in',
  TRANSFER_OUT: 'Transfer out',
  DAMAGE: 'Damage',
  EXPIRED: 'Expired',
  OPENING_STOCK: 'Opening stock',
};

function LedgerTab() {
  const { t } = useTranslation();
  const fmt = useFormat();
  const [type, setType] = useState('all');
  const data = useLiveQuery(async () => {
    const storeId = runtime().storeId;
    const [movements, products] = await Promise.all([
      db().inventory_movements.orderBy('occurred_at').reverse().filter((m) => m.store_id === storeId).limit(5000).toArray(),
      db().products.toArray(),
    ]);
    const names = new Map(products.map((p) => [p.id, p]));
    return movements.map((m) => {
        const p = names.get(m.product_id);
        const v = m.variant_id ? p?.variants.find((x) => x.id === m.variant_id) : null;
        return { ...m, product_name: p ? (v ? `${p.name} (${v.name})` : p.name) : m.product_id };
      });
  }, []);
  const rows = (data ?? []).filter((m) => type === 'all' || m.type === type);
  const columns: Column<InventoryMovement & { product_name: string }>[] = [
    { id: 'date', header: t('sales.date', 'Date'), cell: (m) => fmt.dateTime(m.occurred_at), value: (m) => m.occurred_at },
    { id: 'product', header: t('product.name', 'Name'), cell: (m) => m.product_name, value: (m) => m.product_name },
    { id: 'type', header: t('inventory.type', 'Type'), cell: (m) => MOVEMENT_LABELS[m.type] ?? m.type, value: (m) => m.type },
    { id: 'ref', header: t('inventory.reference', 'Reference'), cell: (m) => m.reference_no ?? m.notes ?? '—', value: (m) => m.reference_no ?? '', hideOnMobile: true },
    { id: 'in', header: t('inventory.in', 'In'), cell: (m) => (m.qty_in ? <span className="text-success">+{fmt.qty(m.qty_in)}</span> : ''), value: (m) => m.qty_in, align: 'right', numeric: true },
    { id: 'out', header: t('inventory.out', 'Out'), cell: (m) => (m.qty_out ? <span className="text-destructive">−{fmt.qty(m.qty_out)}</span> : ''), value: (m) => m.qty_out, align: 'right', numeric: true },
    { id: 'sync', header: '', cell: (m) => (m.synced === 0 ? <Badge variant="outline">{t('sync.pending_short', 'pending')}</Badge> : null), sortable: false },
  ];
  return (
    <DataTable
      data={data ? rows : undefined}
      columns={columns}
      rowKey={(m) => m.id}
      searchText={(m) => `${m.product_name} ${m.reference_no ?? ''} ${m.notes ?? ''}`}
      exportName="stock-ledger"
      dense
      toolbar={
        <Select value={type} onValueChange={setType}>
          <SelectTrigger className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('inventory.all_types', 'All movements')}</SelectItem>
            {Object.entries(MOVEMENT_LABELS).map(([k, label]) => (
              <SelectItem key={k} value={k}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      }
      empty={{ icon: ClipboardListIcon, title: t('inventory.no_movements', 'No stock movements yet') }}
    />
  );
}

function TransfersTab() {
  const { t } = useTranslation();
  const fmt = useFormat();
  const can = useCan();
  const data = useLiveQuery(async () => {
    const [transfers, stores] = await Promise.all([db().stock_transfers.toArray(), db().stores.toArray()]);
    const names = new Map(stores.map((s) => [s.id, s.name]));
    return transfers.sort((a, b) => b.sent_at.localeCompare(a.sent_at)).map((x) => ({ ...x, from: names.get(x.from_store_id) ?? '—', to: names.get(x.to_store_id) ?? '—' }));
  }, []);
  const storeId = runtime().storeId;
  const columns: Column<StockTransfer & { from: string; to: string }>[] = [
    { id: 'number', header: t('inventory.transfer_no', 'Transfer'), cell: (x) => x.transfer_number, value: (x) => x.transfer_number },
    { id: 'date', header: t('sales.date', 'Date'), cell: (x) => fmt.dateTime(x.sent_at), value: (x) => x.sent_at },
    { id: 'route', header: t('inventory.route', 'From → To'), cell: (x) => `${x.from} → ${x.to}`, value: (x) => `${x.from} ${x.to}` },
    { id: 'items', header: t('sales.items', 'Items'), cell: (x) => x.items.length, value: (x) => x.items.length, align: 'right' },
    {
      id: 'status',
      header: t('sales.status', 'Status'),
      cell: (x) =>
        x.status === 'in_transit' && x.to_store_id === storeId && can('inventory.transfer') ? (
          <Button
            size="xs"
            onClick={async (e) => {
              e.stopPropagation();
              try {
                await receiveTransfer(x.id);
                toast.success(t('inventory.received', 'Stock received'));
              } catch (error) {
                toast.error(error instanceof Error ? error.message : String(error));
              }
            }}
          >
            {t('inventory.receive', 'Receive')}
          </Button>
        ) : (
          <Badge variant={x.status === 'received' ? 'secondary' : 'outline'}>{x.status.replace('_', ' ')}</Badge>
        ),
      value: (x) => x.status,
    },
  ];
  return <DataTable data={data} columns={columns} rowKey={(x) => x.id} exportName="stock-transfers" empty={{ icon: ArrowRightLeftIcon, title: t('inventory.no_transfers', 'No transfers yet') }} />;
}

interface DraftLine extends AdjustmentLine {
  key: string;
  name: string;
  batches: Array<{ id: string; label: string }>;
  needsBatch: boolean;
}

function useDraftLines() {
  const [lines, setLines] = useState<DraftLine[]>([]);
  const add = async ({ product, variant }: ProductPick, sign = 1) => {
    if (!product.track_inventory || product.product_type === 'service') return toast.error(`${product.name} does not track stock.`);
    if (product.track_serial) return toast.error(`${product.name} is tracked by IMEI/serial. Add or remove units through purchases, sales and returns.`);
    const batches = product.track_batch ? await db().product_batches.where('product_id').equals(product.id).filter((b) => !b.deleted_at).toArray() : [];
    setLines((l) => [
      ...l,
      {
        key: crypto.randomUUID(),
        product_id: product.id,
        variant_id: variant?.id ?? null,
        batch_id: batches.length === 1 ? batches[0]!.id : null,
        quantity: sign,
        unit_cost: variant?.purchase_price ?? product.purchase_price,
        name: variant ? `${product.name} (${variant.name})` : product.name,
        batches: batches.map((b) => ({ id: b.id, label: `${b.batch_no}${b.expiry_date ? ` · exp ${b.expiry_date}` : ''}` })),
        needsBatch: product.track_batch,
      },
    ]);
  };
  return { lines, setLines, add };
}

function LineEditor({ lines, setLines, signed }: { lines: DraftLine[]; setLines: (fn: (l: DraftLine[]) => DraftLine[]) => void; signed: boolean }) {
  const { t } = useTranslation();
  return (
    <ul className="divide-y rounded-lg border">
      {lines.map((line) => (
        <li key={line.key} className="flex flex-wrap items-center gap-2 p-2">
          <span className="min-w-40 flex-1 text-sm">{line.name}</span>
          {line.needsBatch ? (
            <select className="h-8 rounded-lg border bg-background px-2 text-sm" value={line.batch_id ?? ''} onChange={(e) => setLines((l) => l.map((x) => (x.key === line.key ? { ...x, batch_id: e.target.value || null } : x)))} aria-label={t('product.batch_no', 'Batch no.')}>
              <option value="">{t('inventory.pick_batch', 'Choose batch')}</option>
              {line.batches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.label}
                </option>
              ))}
            </select>
          ) : null}
          <NumberInput className="w-24" value={line.quantity} decimals={3} allowNegative={signed} onValueChange={(v) => setLines((l) => l.map((x) => (x.key === line.key ? { ...x, quantity: v ?? 0 } : x)))} aria-label={t('sale.qty', 'Qty')} />
          <Button variant="ghost" size="icon-sm" onClick={() => setLines((l) => l.filter((x) => x.key !== line.key))} aria-label={t('common.remove', 'Remove')}>
            <Trash2Icon />
          </Button>
        </li>
      ))}
      {lines.length === 0 ? <li className="p-4 text-center text-sm text-muted-foreground">{t('inventory.add_items', 'Search or scan products to add them.')}</li> : null}
    </ul>
  );
}

function AdjustDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t } = useTranslation();
  const { lines, setLines, add } = useDraftLines();
  const [type, setType] = useState<AdjustmentType>('adjustment');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const removing = type === 'damage' || type === 'expired';

  const save = async () => {
    if (lines.some((l) => l.needsBatch && !l.batch_id)) return toast.error(t('inventory.batch_needed', 'Choose a batch for every batch-tracked item.'));
    setSaving(true);
    try {
      await adjustStock(type, lines.map((l) => ({ product_id: l.product_id, variant_id: l.variant_id, batch_id: l.batch_id, quantity: removing ? -Math.abs(l.quantity) : type === 'opening_stock' ? Math.abs(l.quantity) : l.quantity, unit_cost: l.unit_cost })), reason.trim() || null);
      toast.success(t('inventory.adjusted', 'Stock adjusted'));
      setLines(() => []);
      setReason('');
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      dismissible={!saving}
      title={t('inventory.adjust', 'Adjust stock')}
      description={type === 'adjustment' ? t('inventory.adjust_hint', 'Positive quantities add stock, negative quantities remove stock.') : removing ? t('inventory.writeoff_hint', 'Quantities are removed from stock.') : t('inventory.opening_hint', 'Quantities are added as opening stock.')}
      footer={
        <Button onClick={() => void save()} disabled={saving || lines.length === 0} data-testid="adjust-save">
          {t('common.save', 'Save')}
        </Button>
      }
    >
      <div className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <Select value={type} onValueChange={(v) => setType(v as AdjustmentType)}>
            <SelectTrigger className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="adjustment">{t('inventory.t_adjustment', 'Correction (+/−)')}</SelectItem>
              <SelectItem value="opening_stock">{t('inventory.t_opening', 'Opening stock')}</SelectItem>
              <SelectItem value="damage">{t('inventory.t_damage', 'Damaged')}</SelectItem>
              <SelectItem value="expired">{t('inventory.t_expired', 'Expired write-off')}</SelectItem>
            </SelectContent>
          </Select>
          <ProductSearch className="min-w-60 flex-1" onPick={(pick) => void add(pick)} autoFocus />
        </div>
        <LineEditor lines={lines} setLines={setLines} signed={type === 'adjustment'} />
        <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t('return.reason', 'Reason')} />
      </div>
    </ResponsiveDialog>
  );
}

function TransferDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t } = useTranslation();
  const { lines, setLines, add } = useDraftLines();
  const stores = useLiveQuery(() => db().stores.filter((s) => s.active && !s.deleted_at && s.id !== runtime().storeId).toArray(), []);
  const [to, setTo] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!to) return toast.error(t('inventory.pick_store', 'Choose the destination store.'));
    if (lines.some((l) => l.needsBatch && !l.batch_id)) return toast.error(t('inventory.batch_needed', 'Choose a batch for every batch-tracked item.'));
    if (lines.some((l) => l.quantity <= 0)) return toast.error(t('inventory.qty_positive', 'Transfer quantities must be positive.'));
    setSaving(true);
    try {
      await createTransfer(to, lines.map((l) => ({ product_id: l.product_id, variant_id: l.variant_id, batch_id: l.batch_id, quantity: l.quantity, unit_cost: l.unit_cost })), notes.trim() || null);
      toast.success(t('inventory.transfer_sent', 'Transfer sent. The other store receives it after sync.'));
      setLines(() => []);
      setNotes('');
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      dismissible={!saving}
      title={t('inventory.transfer', 'Transfer')}
      footer={
        <Button onClick={() => void save()} disabled={saving || lines.length === 0}>
          <ArrowRightLeftIcon /> {t('inventory.send', 'Send transfer')}
        </Button>
      }
    >
      {stores && stores.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('inventory.one_store', 'Add another store in Settings → Stores to transfer stock.')}</p>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Select value={to} onValueChange={setTo}>
              <SelectTrigger className="w-52">
                <SelectValue placeholder={t('inventory.to_store', 'To store')} />
              </SelectTrigger>
              <SelectContent>
                {(stores ?? []).map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <ProductSearch className="min-w-60 flex-1" onPick={(pick) => void add(pick)} />
          </div>
          <LineEditor lines={lines} setLines={setLines} signed={false} />
          <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t('common.notes', 'Notes')} />
        </div>
      )}
    </ResponsiveDialog>
  );
}
