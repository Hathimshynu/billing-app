import { useState } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useLiveQuery } from 'dexie-react-hooks';
import { toast } from 'sonner';
import { AlertTriangleIcon, CheckCircle2Icon, CloudIcon, CloudOffIcon, RefreshCwIcon, RotateCcwIcon, Trash2Icon } from 'lucide-react';
import { FINANCIAL_OPERATIONS, type SyncQueueItem } from '@shopdesk/shared';
import { db, getMeta } from '@/lib/db/business';
import { useFormat } from '@/lib/format';
import { runtime } from '@/lib/runtime';
import { syncEngine } from '@/lib/sync/engine';
import { useSyncStore } from '@/lib/sync/store';
import { discardOperation, retryFailed } from '@/lib/repos/sync-center';
import { useCan } from '@/hooks/use-app';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { confirm } from '@/components/common/confirm';
import { DataTable, type Column } from '@/components/common/data-table';
import { Page, PageHeader, Section, StatCard } from '@/components/common/page';

const STATUS_VARIANT: Record<string, 'outline' | 'secondary' | 'destructive' | 'default'> = { pending: 'outline', syncing: 'secondary', synced: 'secondary', failed: 'destructive', conflict: 'destructive' };

/** Everything about offline data on this device: what is waiting, what failed and why. */
export default function SyncCenterPage() {
  const { t } = useTranslation();
  const fmt = useFormat();
  const can = useCan();
  const sync = useSyncStore();
  const [filter, setFilter] = useState('open');
  const [syncing, setSyncing] = useState(false);

  const data = useLiveQuery(async () => {
    const [queue, conflicts, syncedTotal, cursor, device, attachments] = await Promise.all([
      db().sync_queue.orderBy('id').toArray(),
      db().sync_conflicts.where('status').equals('open').count(),
      getMeta<number>('synced_total'),
      getMeta<number>('cursor'),
      db().devices.get(runtime().deviceId),
      db().attachments.where('uploaded').equals(0).count(),
    ]);
    return { queue, conflicts, syncedTotal: syncedTotal ?? 0, cursor: cursor ?? 0, device, attachments };
  }, []);

  const queue = data?.queue ?? [];
  const count = (s: string) => queue.filter((q) => q.status === s).length;
  const rows = queue.filter((q) => (filter === 'open' ? q.status !== 'synced' : filter === 'all' ? true : q.status === filter)).reverse();

  const syncNow = async () => {
    setSyncing(true);
    try {
      await syncEngine.syncNow();
      const state = useSyncStore.getState();
      if (state.status === 'offline') toast.warning(t('sync.still_offline', 'Still offline. Data is safe on this device.'));
      else if (state.status === 'error') toast.error(state.lastError ?? t('sync.failed', 'Sync failed'));
      else toast.success(t('sync.done', 'Sync finished'));
    } finally {
      setSyncing(false);
    }
  };

  const columns: Column<SyncQueueItem>[] = [
    { id: 'id', header: '#', cell: (q) => q.id, value: (q) => q.id ?? 0, hideOnMobile: true },
    { id: 'op', header: t('sync.operation', 'Operation'), cell: (q) => <span className="font-mono text-xs">{q.operation}</span>, value: (q) => q.operation },
    { id: 'ref', header: t('sync.record', 'Record'), cell: (q) => String(q.payload.invoice_number ?? q.payload.name ?? q.payload.return_number ?? q.payload.expense_number ?? q.entity_id.slice(0, 8)), sortable: false, hideOnMobile: true },
    { id: 'created', header: t('sync.created', 'Created'), cell: (q) => fmt.dateTime(q.created_at), value: (q) => q.created_at },
    {
      id: 'status',
      header: t('sales.status', 'Status'),
      cell: (q) => (
        <span className="flex flex-col gap-0.5">
          <Badge variant={STATUS_VARIANT[q.status] ?? 'outline'}>{q.status}</Badge>
          {q.retry_count ? <span className="text-[11px] text-muted-foreground">{t('sync.retries', '{{count}} retries', { count: q.retry_count })}</span> : null}
        </span>
      ),
      value: (q) => q.status,
    },
    { id: 'error', header: t('sync.error', 'Problem'), cell: (q) => <span className="text-xs text-destructive">{q.last_error ?? ''}</span>, value: (q) => q.last_error ?? '', hideOnMobile: true },
    {
      id: 'actions',
      header: '',
      sortable: false,
      cell: (q) =>
        q.status === 'failed' ? (
          <span className="flex gap-1">
            <Button size="icon-sm" variant="ghost" aria-label={t('sync.retry', 'Retry')} onClick={() => void retryFailed([q.id!])}>
              <RotateCcwIcon />
            </Button>
            {can('sync.manage') && !FINANCIAL_OPERATIONS.includes(q.operation as never) ? (
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={t('sync.discard', 'Discard')}
                onClick={async () => {
                  const { confirmed } = await confirm({ title: t('sync.discard_title', 'Discard this change?'), description: t('sync.discard_hint', 'It will never reach the server. The next sync replaces the local record with the server copy.'), destructive: true, confirmLabel: t('sync.discard', 'Discard') });
                  if (confirmed) await discardOperation(q);
                }}
              >
                <Trash2Icon />
              </Button>
            ) : null}
          </span>
        ) : null,
    },
  ];

  const pending = count('pending') + count('syncing');
  return (
    <Page>
      <PageHeader
        title={t('sync.center', 'Sync center')}
        description={t('sync.center_hint', 'All changes are saved on this device first and sent to the server automatically.')}
        actions={
          <>
            {count('failed') ? (
              <Button variant="outline" onClick={() => void retryFailed()}>
                <RotateCcwIcon /> {t('sync.retry_all', 'Retry failed')}
              </Button>
            ) : null}
            <Button onClick={() => void syncNow()} disabled={syncing || sync.status === 'syncing'} data-testid="sync-now">
              <RefreshCwIcon className={syncing || sync.status === 'syncing' ? 'animate-spin' : ''} /> {t('sync.now', 'Sync now')}
            </Button>
          </>
        }
      />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label={t('sync.connection', 'Connection')} value={sync.online ? t('sync.online', 'Online') : t('sync.offline_mode', 'Offline Mode')} icon={sync.online ? CloudIcon : CloudOffIcon} hint={sync.lastSyncAt ? `${t('sync.last', 'Last sync')} ${fmt.relative(sync.lastSyncAt)}` : t('sync.never', 'Never synced')} />
        <StatCard label={t('sync.pending', 'Waiting to sync')} value={<span data-testid="pending-count">{pending}</span>} icon={RefreshCwIcon} hint={data?.attachments ? t('sync.attachments', '{{count}} files to upload', { count: data.attachments }) : undefined} />
        <StatCard label={t('sync.failed_label', 'Failed')} value={count('failed')} icon={AlertTriangleIcon} className={count('failed') ? 'border-destructive/40' : undefined} />
        <StatCard label={t('sync.synced', 'Synced from this device')} value={data?.syncedTotal ?? 0} icon={CheckCircle2Icon} />
      </div>

      {sync.progress ? (
        <Section title={t('sync.in_progress', 'Syncing…')} className="mb-5">
          <p className="mb-2 text-sm capitalize">
            {sync.progress.phase} {sync.progress.total ? `${sync.progress.done}/${sync.progress.total}` : ''}
          </p>
          <Progress value={sync.progress.total ? (sync.progress.done / sync.progress.total) * 100 : 50} />
        </Section>
      ) : null}
      {sync.lastError ? <p className="mb-4 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm">{sync.lastError}</p> : null}
      {sync.nextRetryAt && sync.nextRetryAt > Date.now() ? <p className="mb-4 text-sm text-muted-foreground">{t('sync.next_retry', 'Next automatic retry {{when}}.', { when: fmt.relative(new Date(sync.nextRetryAt).toISOString()) })}</p> : null}
      {data?.conflicts ? (
        <p className="mb-4 flex items-center justify-between gap-2 rounded-lg border border-warning/50 bg-warning/10 px-3 py-2 text-sm">
          {t('sync.conflicts_open', '{{count}} conflicts need a decision.', { count: data.conflicts })}
          <Button asChild size="sm" variant="outline">
            <Link to="/sync/conflicts">{t('sync.review', 'Review')}</Link>
          </Button>
        </p>
      ) : null}

      <DataTable
        data={data ? rows : undefined}
        columns={columns}
        rowKey={(q) => q.operation_id}
        searchText={(q) => `${q.operation} ${q.entity_id} ${q.last_error ?? ''}`}
        exportName="sync-queue"
        dense
        toolbar={
          <Select value={filter} onValueChange={setFilter}>
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="open">{t('sync.f_open', 'Not yet synced')}</SelectItem>
              <SelectItem value="failed">{t('sync.f_failed', 'Failed')}</SelectItem>
              <SelectItem value="conflict">{t('sync.f_conflict', 'Conflicts')}</SelectItem>
              <SelectItem value="synced">{t('sync.f_synced', 'Synced (last 3 days)')}</SelectItem>
              <SelectItem value="all">{t('purchase.f_all', 'All')}</SelectItem>
            </SelectContent>
          </Select>
        }
        empty={{ icon: CheckCircle2Icon, title: t('sync.all_synced', 'Everything is synced') }}
      />
      <p className="mt-4 text-xs text-muted-foreground">
        {t('sync.device_info', 'Device {{code}} · change-feed position {{cursor}}', { code: data?.device?.code ?? runtime().deviceCode, cursor: data?.cursor ?? 0 })}
      </p>
    </Page>
  );
}
