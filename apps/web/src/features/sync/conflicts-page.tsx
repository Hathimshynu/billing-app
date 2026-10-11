import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLiveQuery } from 'dexie-react-hooks';
import { toast } from 'sonner';
import { CheckCircle2Icon, GitMergeIcon } from 'lucide-react';
import type { SyncConflictRecord } from '@shopdesk/shared';
import { db } from '@/lib/db/business';
import { useFormat } from '@/lib/format';
import { resolveConflict } from '@/lib/repos/sync-center';
import { useCan } from '@/hooks/use-app';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { EmptyState, Page, PageHeader } from '@/components/common/page';

const show = (v: unknown) => (v === null || v === undefined || v === '' ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v));

/**
 * Conflicts happen when two devices edit the same record offline. The server never silently
 * overwrites: the user decides which value wins (financial records are never in conflict — they
 * are append-only and flagged for review instead).
 */
export default function ConflictsPage() {
  const { t } = useTranslation();
  const fmt = useFormat();
  const can = useCan();
  const [tab, setTab] = useState<'open' | 'resolved'>('open');
  const conflicts = useLiveQuery(() => db().sync_conflicts.where('status').equals(tab).reverse().sortBy('created_at'), [tab]);

  const resolve = async (c: SyncConflictRecord, resolution: 'keep_local' | 'keep_server' | 'reviewed') => {
    try {
      await resolveConflict(c, resolution);
      toast.success(t('conflict.resolved', 'Conflict resolved'));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <Page className="max-w-5xl">
      <PageHeader back="/sync" title={t('conflict.title', 'Conflict center')} description={t('conflict.description', 'Choose which version to keep when the same record was changed on two devices.')} />
      <Tabs value={tab} onValueChange={(v) => setTab(v as 'open' | 'resolved')} className="mb-4">
        <TabsList>
          <TabsTrigger value="open">{t('conflict.open', 'Needs decision')}</TabsTrigger>
          <TabsTrigger value="resolved">{t('conflict.resolved_tab', 'Resolved')}</TabsTrigger>
        </TabsList>
      </Tabs>
      {conflicts && conflicts.length === 0 ? <EmptyState icon={CheckCircle2Icon} title={t('conflict.none', 'No conflicts')} /> : null}
      <div className="space-y-4">
        {(conflicts ?? []).map((c) => (
          <article key={c.id} className="rounded-xl border bg-card p-4" data-testid="conflict-card">
            <header className="mb-3 flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="flex items-center gap-2 font-medium">
                  <GitMergeIcon className="size-4" />
                  {c.entity_type.replace('_', ' ')} · {show(c.server_data?.name ?? c.server_data?.invoice_number ?? c.entity_id.slice(0, 8))}
                </p>
                <p className="text-sm text-muted-foreground">{c.message}</p>
              </div>
              <span className="text-xs text-muted-foreground">
                {fmt.dateTime(c.created_at)} {c.resolution ? <Badge variant="outline">{c.resolution.replace('_', ' ')}</Badge> : null}
              </span>
            </header>
            {c.fields.length ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs text-muted-foreground">
                    <tr>
                      <th className="py-1">{t('conflict.field', 'Field')}</th>
                      <th className="py-1">{t('conflict.base', 'Before')}</th>
                      <th className="py-1">{t('conflict.local', 'This device')}</th>
                      <th className="py-1">{t('conflict.server', 'Server / other device')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {c.fields.map((f) => (
                      <tr key={f.field}>
                        <td className="py-1.5 font-medium">{f.field}</td>
                        <td className="py-1.5 text-muted-foreground">{show(f.base)}</td>
                        <td className="py-1.5 text-primary">{show(f.local)}</td>
                        <td className="py-1.5">{show(f.server)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
            {c.status === 'open' && can('sync.manage') ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {c.conflict_type === 'field' || c.conflict_type === 'deleted' ? (
                  <>
                    <Button size="sm" onClick={() => void resolve(c, 'keep_local')} data-testid="keep-local">
                      {c.conflict_type === 'deleted' ? t('conflict.restore', 'Restore my version') : t('conflict.keep_local', 'Keep this device’s values')}
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => void resolve(c, 'keep_server')} data-testid="keep-server">
                      {t('conflict.keep_server', 'Keep server values')}
                    </Button>
                  </>
                ) : (
                  <Button size="sm" onClick={() => void resolve(c, 'reviewed')}>
                    {t('conflict.reviewed', 'Mark as reviewed')}
                  </Button>
                )}
              </div>
            ) : c.status === 'open' ? (
              <p className="mt-3 text-xs text-muted-foreground">{t('conflict.no_permission', 'A manager with sync permission must decide.')}</p>
            ) : null}
          </article>
        ))}
      </div>
    </Page>
  );
}
