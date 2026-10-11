import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { CheckCircle2Icon, CloudDownloadIcon, DownloadIcon, FileUpIcon, HardDriveDownloadIcon, UploadIcon, XCircleIcon } from 'lucide-react';
import { errorMessage, getApiContext } from '@/lib/api';
import { config } from '@/lib/config';
import { downloadDeviceBackup, restoreDeviceBackup } from '@/lib/backup';
import { downloadBlob } from '@/lib/export';
import { downloadTemplate, importRows, parseFile, validateRows, type ImportKind, type Validated } from '@/lib/import';
import { useCan, useOnline } from '@/hooks/use-app';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { confirm } from '@/components/common/confirm';
import { Section } from '@/components/common/page';

export function ImportTab() {
  const { t } = useTranslation();
  const [kind, setKind] = useState<ImportKind>('products');
  const [rows, setRows] = useState<Array<Validated<unknown>> | null>(null);
  const [fileName, setFileName] = useState('');
  const [progress, setProgress] = useState<number | null>(null);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setFileName(file.name);
    setRows(null);
    try {
      const raw = await parseFile(file);
      if (!raw.length) return toast.error(t('import.empty', 'The file has no rows.'));
      if (raw.length > 5000) return toast.error(t('import.too_many', 'Import at most 5,000 rows at a time.'));
      setRows((await validateRows(kind, raw)) as Array<Validated<unknown>>);
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  const valid = (rows ?? []).filter((r) => r.data);
  const invalid = (rows ?? []).filter((r) => !r.data);

  const run = async () => {
    setProgress(0);
    try {
      const count = await importRows(kind, valid as never, (done) => setProgress(done));
      toast.success(t('import.done', 'Imported {{count}} records. They sync automatically.', { count }));
      setRows(null);
      setFileName('');
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setProgress(null);
    }
  };

  return (
    <Section title={t('import.title', 'Import data')} description={t('import.hint', 'CSV or Excel (.xlsx). Every row is validated first; only valid rows are imported. Works offline.')}>
      <div className="flex flex-wrap items-center gap-2">
        <Select value={kind} onValueChange={(v) => { setKind(v as ImportKind); setRows(null); }}>
          <SelectTrigger className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="products">{t('nav.products', 'Products')}</SelectItem>
            <SelectItem value="customers">{t('nav.customers', 'Customers')}</SelectItem>
            <SelectItem value="suppliers">{t('nav.suppliers', 'Suppliers')}</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" onClick={() => downloadTemplate(kind)}>
          <DownloadIcon /> {t('import.template', 'Download template')}
        </Button>
        <label className="inline-flex">
          <Input type="file" accept=".csv,.xlsx,text/csv" className="sr-only" onChange={(e) => void onFile(e.target.files?.[0])} data-testid="import-file" />
          <span className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg bg-primary px-2.5 text-sm text-primary-foreground">
            <FileUpIcon className="size-4" /> {t('import.choose', 'Choose file')}
          </span>
        </label>
        {fileName ? <span className="text-sm text-muted-foreground">{fileName}</span> : null}
      </div>
      {rows ? (
        <div className="mt-4 space-y-3">
          <p className="flex flex-wrap gap-4 text-sm">
            <span className="flex items-center gap-1 text-success">
              <CheckCircle2Icon className="size-4" /> {valid.length} {t('import.valid', 'valid rows')}
            </span>
            <span className="flex items-center gap-1 text-destructive">
              <XCircleIcon className="size-4" /> {invalid.length} {t('import.invalid', 'rows with errors (skipped)')}
            </span>
          </p>
          {invalid.length ? (
            <ul className="max-h-60 overflow-y-auto rounded-lg border text-sm">
              {invalid.slice(0, 200).map((r) => (
                <li key={r.row} className="border-b px-3 py-1.5 last:border-0">
                  <span className="font-medium">
                    {t('import.row', 'Row')} {r.row}:
                  </span>{' '}
                  <span className="text-destructive">{r.errors.join('; ')}</span>
                </li>
              ))}
            </ul>
          ) : null}
          {progress !== null ? <Progress value={(progress / Math.max(valid.length, 1)) * 100} /> : null}
          <Button onClick={() => void run()} disabled={!valid.length || progress !== null} data-testid="import-run">
            <UploadIcon /> {t('import.run', 'Import {{count}} rows', { count: valid.length })}
          </Button>
        </div>
      ) : null}
    </Section>
  );
}

export function BackupTab() {
  const { t } = useTranslation();
  const can = useCan();
  const online = useOnline();
  const [busy, setBusy] = useState(false);

  const serverExport = async () => {
    setBusy(true);
    try {
      const ctx = getApiContext();
      const response = await fetch(`${config.apiBaseUrl}/backup/export`, {
        headers: { Authorization: `Bearer ${ctx.token}`, 'X-Business-Id': ctx.businessId ?? '', 'X-Device-Id': ctx.deviceId ?? '', Accept: 'application/json' },
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { message?: string } | null;
        throw new Error(body?.message ?? `Export failed (${response.status})`);
      }
      downloadBlob(await response.blob(), `shopdesk-server-export-${new Date().toISOString().slice(0, 10)}.json`);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const restore = async (file: File | undefined) => {
    if (!file) return;
    const { confirmed } = await confirm({ title: t('backup.restore_title', 'Restore this backup on this device?'), description: t('backup.restore_hint', 'Records are merged and changes that never synced are queued again. The server ignores anything it already has.'), confirmLabel: t('backup.restore', 'Restore') });
    if (!confirmed) return;
    setBusy(true);
    try {
      const summary = await restoreDeviceBackup(file);
      toast.success(t('backup.restored', 'Restored {{records}} records; {{ops}} changes queued for sync.', { records: summary.records, ops: summary.pendingOperations }));
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <Section title={t('backup.device', 'Device backup')} description={t('backup.device_hint', 'Everything stored on this device, including sales not yet synced. Keep it safe before clearing browser data.')}>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => void downloadDeviceBackup()} disabled={busy}>
            <HardDriveDownloadIcon /> {t('backup.download', 'Download device backup')}
          </Button>
          <label className="inline-flex">
            <Input type="file" accept="application/json,.json" className="sr-only" onChange={(e) => void restore(e.target.files?.[0])} disabled={busy} />
            <span className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 text-sm hover:bg-muted">
              <UploadIcon className="size-4" /> {t('backup.restore', 'Restore')}
            </span>
          </label>
        </div>
      </Section>
      {can('backup.manage') ? (
        <Section title={t('backup.server', 'Full business export')} description={t('backup.server_hint', 'A complete JSON export of all stores and devices from the server (needs internet).')}>
          <Button variant="outline" onClick={() => void serverExport()} disabled={!online || busy}>
            <CloudDownloadIcon /> {t('backup.export', 'Download server export')}
          </Button>
        </Section>
      ) : null}
    </div>
  );
}
