import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLiveQuery } from 'dexie-react-hooks';
import { toast } from 'sonner';
import { ChefHatIcon, Maximize2Icon, PrinterIcon } from 'lucide-react';
import type { KitchenOrder, KitchenStatus } from '@shopdesk/shared';
import { cn } from '@/lib/utils';
import { config } from '@/lib/config';
import { db } from '@/lib/db/business';
import { useFormat } from '@/lib/format';
import { printKot } from '@/lib/print';
import { setKotStatus } from '@/lib/repos/industry';
import { syncEngine } from '@/lib/sync/engine';
import { useOnline } from '@/hooks/use-app';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState, Page, PageHeader } from '@/components/common/page';

const NEXT: Partial<Record<KitchenStatus, KitchenStatus>> = { pending: 'preparing', preparing: 'ready', ready: 'served' };
const COLUMNS: KitchenStatus[] = ['pending', 'preparing', 'ready'];

/** Kitchen display: KOTs from every device (synced every few seconds while this screen is open). */
export default function KitchenPage() {
  const { t } = useTranslation();
  const fmt = useFormat();
  const online = useOnline();
  const [, setTick] = useState(0);

  useEffect(() => {
    // Poll faster while the kitchen screen is open; restore the normal interval on leave.
    syncEngine.setInterval(5_000);
    const timer = window.setInterval(() => setTick((x) => x + 1), 30_000);
    return () => {
      syncEngine.setInterval(config.syncIntervalMs);
      window.clearInterval(timer);
    };
  }, []);

  const data = useLiveQuery(async () => {
    const [kots, tables] = await Promise.all([db().kitchen_orders.where('status').anyOf(COLUMNS).filter((k) => !k.deleted_at).sortBy('occurred_at'), db().restaurant_tables.toArray()]);
    return { kots, tables: new Map(tables.map((x) => [x.id, x.name])) };
  }, []);

  const label: Record<string, string> = { pending: t('kitchen.pending', 'New'), preparing: t('kitchen.preparing', 'Preparing'), ready: t('kitchen.ready', 'Ready') };
  const action: Record<string, string> = { pending: t('kitchen.start', 'Start'), preparing: t('kitchen.mark_ready', 'Ready'), ready: t('kitchen.served', 'Served') };

  const advance = async (kot: KitchenOrder) => {
    const next = NEXT[kot.status];
    if (!next) return;
    try {
      await setKotStatus(kot.id, next);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <Page className="max-w-none">
      <PageHeader
        title={t('kitchen.title', 'Kitchen display')}
        description={online ? t('kitchen.live', 'Live — refreshes every few seconds.') : t('kitchen.offline', 'Offline — showing orders from this device only until the connection returns.')}
        actions={
          <Button variant="outline" onClick={() => void document.documentElement.requestFullscreen?.()}>
            <Maximize2Icon /> {t('kitchen.fullscreen', 'Full screen')}
          </Button>
        }
      />
      {data && data.kots.length === 0 ? <EmptyState icon={ChefHatIcon} title={t('kitchen.empty', 'No open orders')} /> : null}
      <div className="grid gap-4 lg:grid-cols-3">
        {COLUMNS.map((status) => (
          <section key={status} className="space-y-3">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              {label[status]} <Badge variant="secondary">{(data?.kots ?? []).filter((k) => k.status === status).length}</Badge>
            </h2>
            {(data?.kots ?? [])
              .filter((k) => k.status === status)
              .map((kot) => {
                const minutes = Math.floor((Date.now() - new Date(kot.occurred_at).getTime()) / 60000);
                return (
                  <article key={kot.id} className={cn('rounded-xl border bg-card p-3 shadow-sm', kot.is_void && 'border-destructive', minutes >= 20 && status !== 'ready' && 'ring-2 ring-warning')}>
                    <header className="mb-2 flex items-start justify-between gap-2">
                      <div>
                        <p className="font-semibold">
                          {kot.is_void ? <span className="text-destructive">VOID </span> : null}
                          {kot.table_id ? `${t('pos.table', 'Table')} ${data?.tables.get(kot.table_id) ?? ''}` : kot.order_type.replace('_', ' ')}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {kot.kot_number} · {fmt.time(kot.occurred_at)} · {minutes} min
                        </p>
                      </div>
                      <Button size="icon-sm" variant="ghost" aria-label={t('receipt.print', 'Print')} onClick={() => void printKot(kot, fmt)}>
                        <PrinterIcon />
                      </Button>
                    </header>
                    <ul className="space-y-1">
                      {kot.items.map((i) => (
                        <li key={i.id} className="text-sm">
                          <span className="font-semibold">{i.quantity} ×</span> {i.name}
                          {i.modifiers.length ? <span className="block pl-5 text-xs text-muted-foreground">+ {i.modifiers.map((m) => m.option).join(', ')}</span> : null}
                          {i.notes ? <span className="block pl-5 text-xs text-warning-foreground">» {i.notes}</span> : null}
                        </li>
                      ))}
                    </ul>
                    {kot.notes ? <p className="mt-2 text-xs text-muted-foreground">{kot.notes}</p> : null}
                    <div className="mt-3 flex gap-2">
                      <Button className="flex-1" onClick={() => void advance(kot)}>
                        {action[status]}
                      </Button>
                      {status === 'pending' ? (
                        <Button variant="outline" onClick={() => void setKotStatus(kot.id, 'cancelled')}>
                          {t('kitchen.cancel', 'Cancel')}
                        </Button>
                      ) : null}
                    </div>
                  </article>
                );
              })}
          </section>
        ))}
      </div>
    </Page>
  );
}
