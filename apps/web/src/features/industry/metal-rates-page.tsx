import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLiveQuery } from 'dexie-react-hooks';
import { toast } from 'sonner';
import { GemIcon } from 'lucide-react';
import { metalRateSchema, PURITIES, type MetalRate, type MetalType } from '@shopdesk/shared';
import { db } from '@/lib/db/business';
import { useFormat } from '@/lib/format';
import { setMetalRate } from '@/lib/repos/industry';
import { useCan } from '@/hooks/use-app';
import { Button } from '@/components/ui/button';
import { DataTable, type Column } from '@/components/common/data-table';
import { NumberInput } from '@/components/common/number-input';
import { Page, PageHeader, Section } from '@/components/common/page';

/** Today's metal rates drive jewellery prices at the POS. */
export default function MetalRatesPage() {
  const { t } = useTranslation();
  const fmt = useFormat();
  const can = useCan();
  const [drafts, setDrafts] = useState<Record<string, number | null>>({});
  const rates = useLiveQuery(() => db().metal_rates.orderBy('effective_from').reverse().toArray(), []);
  const latest = new Map<string, MetalRate>();
  for (const r of rates ?? []) if (!latest.has(r.purity)) latest.set(r.purity, r);

  const save = async () => {
    const entries = Object.entries(drafts).filter(([, v]) => v !== null && v !== undefined);
    if (!entries.length) return toast.error(t('rates.none', 'Enter at least one rate.'));
    try {
      for (const [purity, value] of entries) {
        const def = PURITIES.find((p) => p.code === purity)!;
        const parsed = metalRateSchema.safeParse({ metal: def.metal, purity, rate_per_gram: value });
        if (!parsed.success) throw new Error(`${def.label}: ${parsed.error.issues[0]?.message}`);
        await setMetalRate(parsed.data.metal as MetalType, purity, parsed.data.rate_per_gram);
      }
      setDrafts({});
      toast.success(t('rates.saved', 'Rates updated — new jewellery prices apply immediately.'));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };

  const columns: Column<MetalRate>[] = [
    { id: 'when', header: t('rates.when', 'Set at'), cell: (r) => fmt.dateTime(r.effective_from), value: (r) => r.effective_from },
    { id: 'purity', header: t('jewellery.purity', 'Purity'), cell: (r) => PURITIES.find((p) => p.code === r.purity)?.label ?? r.purity, value: (r) => r.purity },
    { id: 'rate', header: t('jewellery.rate', 'Rate per gram'), cell: (r) => <span className="money">{fmt.money(r.rate_per_gram)}</span>, value: (r) => r.rate_per_gram, align: 'right', numeric: true },
  ];

  return (
    <Page className="max-w-4xl">
      <PageHeader title={t('rates.title', 'Metal rates')} description={t('rates.description', 'Update every morning. Prices at the POS use the latest rate for each purity.')} />
      <Section
        title={t('rates.today', "Today's rates (per gram)")}
        actions={
          can('jewellery.rates') ? (
            <Button onClick={() => void save()} disabled={!Object.values(drafts).some((v) => v)}>
              {t('common.save', 'Save')}
            </Button>
          ) : null
        }
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {PURITIES.map((p) => {
            const current = latest.get(p.code);
            return (
              <label key={p.code} className="space-y-1 rounded-lg border p-3 text-sm">
                <span className="flex items-center gap-1.5 font-medium">
                  <GemIcon className="size-4 text-warning" /> {p.label}
                </span>
                <NumberInput value={drafts[p.code] ?? null} onValueChange={(v) => setDrafts((d) => ({ ...d, [p.code]: v }))} placeholder={current ? String(current.rate_per_gram) : '0'} disabled={!can('jewellery.rates')} />
                <span className="block text-xs text-muted-foreground">{current ? `${fmt.money(current.rate_per_gram)} · ${fmt.relative(current.effective_from)}` : t('rates.not_set', 'Not set')}</span>
              </label>
            );
          })}
        </div>
      </Section>
      <h2 className="mt-6 mb-3 text-sm font-semibold">{t('rates.history', 'Rate history')}</h2>
      <DataTable data={rates} columns={columns} rowKey={(r) => r.id} exportName="metal-rates" empty={{ icon: GemIcon, title: t('rates.empty', 'No rates yet') }} />
    </Page>
  );
}
