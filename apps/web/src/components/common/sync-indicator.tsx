import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { useTranslation } from 'react-i18next';
import { AlertTriangleIcon, CloudOffIcon, RefreshCwIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { db, hasDb } from '@/lib/db/business';
import { useFormat } from '@/lib/format';
import { syncEngine } from '@/lib/sync/engine';
import { useSyncStore } from '@/lib/sync/store';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

/** Count of operations waiting to be synced (live). */
export function usePendingCount(): { pending: number; failed: number; conflicts: number } {
  return (
    useLiveQuery(async () => {
      if (!hasDb()) return { pending: 0, failed: 0, conflicts: 0 };
      const database = db();
      const [pending, syncing, failed, conflicts] = await Promise.all([
        database.sync_queue.where('status').equals('pending').count(),
        database.sync_queue.where('status').equals('syncing').count(),
        database.sync_queue.where('status').equals('failed').count(),
        database.sync_conflicts.where('status').equals('open').count(),
      ]);
      return { pending: pending + syncing, failed, conflicts };
    }, []) ?? { pending: 0, failed: 0, conflicts: 0 }
  );
}

/** Re-render periodically so "synced 10 seconds ago" stays fresh. */
function useTick(ms: number) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), ms);
    return () => window.clearInterval(id);
  }, [ms]);
}

export function SyncIndicator({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation();
  const fmt = useFormat();
  const { status, online, lastSyncAt } = useSyncStore();
  const { pending, failed, conflicts } = usePendingCount();
  useTick(15_000);

  const issue = status === 'error' || status === 'auth' || failed > 0 || conflicts > 0;
  let dot = 'bg-success';
  let label = t('sync.online', 'Online');
  let detail = lastSyncAt ? `${t('sync.last_synced', 'Last synced')} ${fmt.relative(lastSyncAt)}` : t('sync.not_synced_yet', 'Not synced yet');
  if (status === 'syncing') {
    dot = 'bg-primary animate-pulse';
    label = t('sync.syncing', 'Syncing…');
  } else if (!online || status === 'offline') {
    dot = 'bg-warning';
    label = t('sync.offline', 'Offline');
    detail = pending ? `${t('sync.working_locally', 'Working locally')} · ${pending} ${t('sync.changes_waiting', 'changes waiting to sync')}` : t('sync.working_locally', 'Working locally');
  } else if (issue) {
    dot = 'bg-destructive';
    label = t('sync.issue', 'Sync issue');
    detail = status === 'auth' ? t('sync.sign_in_needed', 'Sign in to resume syncing') : conflicts ? `${conflicts} ${t('sync.conflicts_to_review', 'conflicts to review')}` : failed ? `${failed} ${t('sync.failed_changes', 'changes failed')}` : (useSyncStore.getState().lastError ?? '');
  } else if (pending) {
    detail = `${pending} ${t('sync.changes_waiting', 'changes waiting to sync')}`;
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Link
          to="/sync"
          data-testid="sync-indicator"
          data-status={!online || status === 'offline' ? 'offline' : status}
          className="flex min-w-0 items-center gap-2 rounded-lg px-2 py-1 text-sm hover:bg-muted"
          aria-live="polite"
        >
          {status === 'syncing' ? <RefreshCwIcon className="size-3.5 animate-spin text-primary" aria-hidden /> : <span className={cn('size-2 shrink-0 rounded-full', dot)} aria-hidden />}
          <span className="font-medium">{label}</span>
          {!compact ? <span className="hidden truncate text-xs text-muted-foreground lg:inline">{detail}</span> : null}
          {pending > 0 && compact ? <span className="rounded-full bg-muted px-1.5 text-xs tabular-nums">{pending}</span> : null}
        </Link>
      </TooltipTrigger>
      <TooltipContent>{detail}</TooltipContent>
    </Tooltip>
  );
}

/** Non-blocking notice: the POS keeps working offline. */
export function OfflineBanner() {
  const { t } = useTranslation();
  const { status, online } = useSyncStore();
  const { pending } = usePendingCount();
  if (online && status !== 'offline') {
    if (status === 'auth') {
      return (
        <div className="flex items-center justify-center gap-2 border-b bg-warning/15 px-4 py-1.5 text-sm" role="status">
          <AlertTriangleIcon className="size-4" />
          <span>{t('sync.session_expired', 'Your session expired. Sales continue normally — sign in to resume syncing.')}</span>
          <Button asChild size="xs" variant="outline">
            <Link to="/login?reauth=1">{t('auth.sign_in', 'Sign in')}</Link>
          </Button>
        </div>
      );
    }
    return null;
  }
  return (
    <div className="flex items-center justify-center gap-2 border-b bg-warning/15 px-4 py-1.5 text-sm" role="status" data-testid="offline-banner">
      <CloudOffIcon className="size-4 shrink-0" />
      <span className="font-medium">{t('sync.offline_mode', 'Offline Mode')}</span>
      <span className="hidden text-muted-foreground sm:inline">
        {t('sync.offline_explainer', 'Sales continue normally. Changes will sync automatically when internet returns.')}
        {pending ? ` (${pending} ${t('sync.pending_short', 'pending')})` : ''}
      </span>
      <Button size="xs" variant="ghost" onClick={() => void syncEngine.syncNow()}>
        <RefreshCwIcon /> {t('sync.retry', 'Retry')}
      </Button>
    </div>
  );
}
