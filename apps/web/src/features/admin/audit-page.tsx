import { Fragment, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeftIcon, ChevronRightIcon, ScrollTextIcon } from 'lucide-react';
import { apiRequest, errorMessage } from '@/lib/api';
import { useFormat } from '@/lib/format';
import { useOnline } from '@/hooks/use-app';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { EmptyState, ErrorState, LoadingRows, Page, PageHeader } from '@/components/common/page';

interface AuditRow {
  id: number;
  user: { id: string; name: string } | null;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  old_values: Record<string, unknown> | null;
  new_values: Record<string, unknown> | null;
  device_id: string | null;
  ip_address: string | null;
  created_at: string;
}

interface Page_ {
  data: AuditRow[];
  meta: { current_page: number; last_page: number; total: number };
}

/** Server audit trail (logins, price changes, cancellations, permission changes, conflicts...). Online only. */
export default function AuditPage() {
  const { t } = useTranslation();
  const fmt = useFormat();
  const online = useOnline();
  const [page, setPage] = useState(1);
  const [action, setAction] = useState('');
  const [open, setOpen] = useState<number | null>(null);

  const query = useQuery({
    queryKey: ['audit', page, action],
    queryFn: () => apiRequest<Page_>('/audit-logs', { query: { page, per_page: 50, action: action.trim().toUpperCase() || undefined } }),
    enabled: online,
    networkMode: 'online',
  });

  return (
    <Page>
      <PageHeader title={t('audit.title', 'Audit log')} description={t('audit.description', 'Every important action, recorded on the server. Cannot be edited.')} />
      <div className="mb-3 flex gap-2">
        <Input className="max-w-xs" placeholder={t('audit.filter', 'Filter by action, e.g. SALE_CANCELLED')} value={action} onChange={(e) => {
          setAction(e.target.value);
          setPage(1);
        }} />
      </div>
      {!online ? (
        <EmptyState icon={ScrollTextIcon} title={t('audit.offline', 'The audit log needs an internet connection')} />
      ) : query.isLoading ? (
        <LoadingRows />
      ) : query.isError ? (
        <ErrorState description={errorMessage(query.error)} onRetry={() => void query.refetch()} />
      ) : !query.data?.data.length ? (
        <EmptyState icon={ScrollTextIcon} title={t('audit.empty', 'No audit entries')} />
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('audit.when', 'When')}</TableHead>
                  <TableHead>{t('audit.user', 'User')}</TableHead>
                  <TableHead>{t('audit.action', 'Action')}</TableHead>
                  <TableHead>{t('audit.entity', 'Record')}</TableHead>
                  <TableHead className="hidden md:table-cell">IP</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {query.data.data.map((row) => (
                  <Fragment key={row.id}>
                    <TableRow className="cursor-pointer" onClick={() => setOpen(open === row.id ? null : row.id)}>
                      <TableCell>{fmt.dateTime(row.created_at)}</TableCell>
                      <TableCell>{row.user?.name ?? '—'}</TableCell>
                      <TableCell className="font-mono text-xs">{row.action}</TableCell>
                      <TableCell className="text-xs">{row.entity_type ? `${row.entity_type} ${row.entity_id?.slice(0, 8) ?? ''}` : '—'}</TableCell>
                      <TableCell className="hidden text-xs md:table-cell">{row.ip_address ?? '—'}</TableCell>
                    </TableRow>
                    {open === row.id ? (
                      <TableRow>
                        <TableCell colSpan={5}>
                          <div className="grid gap-3 text-xs md:grid-cols-2">
                            <pre className="overflow-x-auto rounded bg-muted p-2">{JSON.stringify(row.old_values, null, 2) ?? '—'}</pre>
                            <pre className="overflow-x-auto rounded bg-muted p-2">{JSON.stringify(row.new_values, null, 2) ?? '—'}</pre>
                          </div>
                        </TableCell>
                      </TableRow>
                    ) : null}
                  </Fragment>
                ))}
              </TableBody>
            </Table>
          </div>
          <div className="mt-3 flex items-center justify-end gap-2 text-sm">
            {t('audit.page', 'Page {{page}} of {{pages}}', { page: query.data.meta.current_page, pages: query.data.meta.last_page })}
            <Button size="icon-sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} aria-label="Previous">
              <ChevronLeftIcon />
            </Button>
            <Button size="icon-sm" variant="outline" disabled={page >= query.data.meta.last_page} onClick={() => setPage((p) => p + 1)} aria-label="Next">
              <ChevronRightIcon />
            </Button>
          </div>
        </>
      )}
    </Page>
  );
}
