import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useLiveQuery } from 'dexie-react-hooks';
import { toast } from 'sonner';
import { ArmchairIcon, PencilIcon, PlusIcon, Trash2Icon } from 'lucide-react';
import { restaurantTableSchema, roundTo } from '@shopdesk/shared';
import { cn } from '@/lib/utils';
import { db } from '@/lib/db/business';
import { useFormat } from '@/lib/format';
import { runtime } from '@/lib/runtime';
import { createTable, deleteTable, updateTable } from '@/lib/repos/industry';
import { useCan } from '@/hooks/use-app';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { confirm } from '@/components/common/confirm';
import { FormGrid, FormRow } from '@/components/common/form';
import { NumberInput } from '@/components/common/number-input';
import { EmptyState, Page, PageHeader } from '@/components/common/page';
import { ResponsiveDialog } from '@/components/common/responsive-dialog';
import { usePos } from '@/features/pos/pos-store';

interface Draft {
  id: string | null;
  name: string;
  area: string;
  capacity: number | null;
  sort_order: number;
  active: boolean;
}

/** Floor view: occupied tables (open KOTs, not yet billed) and table setup. */
export default function TablesPage() {
  const { t } = useTranslation();
  const fmt = useFormat();
  const can = useCan();
  const navigate = useNavigate();
  const [editing, setEditing] = useState<Draft | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const data = useLiveQuery(async () => {
    const storeId = runtime().storeId;
    const [tables, kots] = await Promise.all([db().restaurant_tables.filter((x) => !x.deleted_at && x.store_id === storeId).sortBy('sort_order'), db().kitchen_orders.filter((k) => !k.sale_id && k.status !== 'cancelled' && !k.deleted_at).toArray()]);
    return tables.map((table) => {
      const open = kots.filter((k) => k.table_id === table.id);
      const total = roundTo(open.reduce((s, k) => s + (k.is_void ? -1 : 1) * k.items.reduce((a, i) => a + i.quantity * (i.unit_price + i.modifiers.reduce((m, x) => m + x.price, 0)), 0), 0));
      const since = open.map((k) => k.occurred_at).sort()[0] ?? null;
      return { ...table, kots: open.length, total, since };
    });
  }, []);

  const save = async () => {
    if (!editing) return;
    const parsed = restaurantTableSchema.safeParse({ name: editing.name, area: editing.area || null, capacity: editing.capacity ?? 0, sort_order: editing.sort_order, active: editing.active });
    if (!parsed.success) return setErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])));
    try {
      if (editing.id) await updateTable(editing.id, parsed.data);
      else await createTable(parsed.data);
      setEditing(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };

  const areas = [...new Set((data ?? []).map((x) => x.area ?? ''))];

  return (
    <Page>
      <PageHeader
        title={t('tables.title', 'Tables')}
        description={t('tables.description', 'Tap a table to take or bill its order. Orders are shared across devices through KOTs.')}
        actions={
          can('restaurant.manage') ? (
            <Button
              onClick={() => {
                setErrors({});
                setEditing({ id: null, name: '', area: '', capacity: 4, sort_order: data?.length ?? 0, active: true });
              }}
            >
              <PlusIcon /> {t('tables.add', 'Add table')}
            </Button>
          ) : null
        }
      />
      {data && data.length === 0 ? <EmptyState icon={ArmchairIcon} title={t('tables.empty', 'No tables yet')} description={t('tables.empty_hint', 'Add your tables to take dine-in orders.')} /> : null}
      {areas.map((area) => (
        <div key={area} className="mb-6">
          {area ? <h2 className="mb-2 text-sm font-semibold text-muted-foreground">{area}</h2> : null}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {(data ?? [])
              .filter((x) => (x.area ?? '') === area)
              .map((table) => (
                <div key={table.id} className={cn('relative rounded-xl border p-3', table.kots ? 'border-primary bg-primary/5' : 'bg-card', !table.active && 'opacity-50')}>
                  <button
                    type="button"
                    className="block w-full text-left"
                    disabled={!table.active}
                    onClick={() => {
                      const pos = usePos.getState();
                      pos.clear();
                      pos.setOrderType('dine_in', table.id);
                      navigate(`/pos?table=${table.id}`);
                    }}
                  >
                    <p className="text-lg font-semibold">{table.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {table.capacity} {t('tables.seats', 'seats')}
                    </p>
                    {table.kots ? (
                      <p className="mt-2 text-sm">
                        <span className="money font-semibold">{fmt.money(table.total)}</span>
                        <span className="block text-xs text-muted-foreground">
                          {table.kots} KOT · {fmt.relative(table.since)}
                        </span>
                      </p>
                    ) : (
                      <p className="mt-2 text-sm text-success">{t('tables.free', 'Free')}</p>
                    )}
                  </button>
                  {can('restaurant.manage') ? (
                    <div className="absolute top-2 right-2 flex">
                      <Button size="icon-xs" variant="ghost" aria-label={t('common.edit', 'Edit')} onClick={() => setEditing({ id: table.id, name: table.name, area: table.area ?? '', capacity: table.capacity, sort_order: table.sort_order, active: table.active })}>
                        <PencilIcon />
                      </Button>
                      <Button
                        size="icon-xs"
                        variant="ghost"
                        aria-label={t('common.delete', 'Delete')}
                        onClick={async () => {
                          if (table.kots) return toast.error(t('tables.busy', 'Bill or cancel the open order first.'));
                          const { confirmed } = await confirm({ title: t('tables.delete', 'Delete table {{name}}?', { name: table.name }), destructive: true, confirmLabel: t('common.delete', 'Delete') });
                          if (confirmed) await deleteTable(table.id);
                        }}
                      >
                        <Trash2Icon />
                      </Button>
                    </div>
                  ) : null}
                </div>
              ))}
          </div>
        </div>
      ))}
      <ResponsiveDialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)} size="sm" title={editing?.id ? t('tables.edit', 'Edit table') : t('tables.add', 'Add table')} footer={<Button onClick={() => void save()}>{t('common.save', 'Save')}</Button>}>
        {editing ? (
          <FormGrid>
            <FormRow label={t('tables.name', 'Name / number')} htmlFor="tb-name" error={errors.name} required>
              <Input id="tb-name" autoFocus value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
            </FormRow>
            <FormRow label={t('tables.area', 'Area')} htmlFor="tb-area">
              <Input id="tb-area" value={editing.area} onChange={(e) => setEditing({ ...editing, area: e.target.value })} placeholder="AC hall, Garden…" />
            </FormRow>
            <FormRow label={t('tables.capacity', 'Seats')} htmlFor="tb-cap" error={errors.capacity}>
              <NumberInput id="tb-cap" decimals={0} value={editing.capacity} onValueChange={(v) => setEditing({ ...editing, capacity: v === null ? null : Math.round(v) })} />
            </FormRow>
            <FormRow label={t('catalog.sort', 'Display order')} htmlFor="tb-sort">
              <NumberInput id="tb-sort" decimals={0} value={editing.sort_order} onValueChange={(v) => setEditing({ ...editing, sort_order: Math.max(0, Math.round(v ?? 0)) })} />
            </FormRow>
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={editing.active} onCheckedChange={(v) => setEditing({ ...editing, active: v })} /> {t('product.active_label', 'Active')}
            </label>
          </FormGrid>
        ) : null}
      </ResponsiveDialog>
    </Page>
  );
}
