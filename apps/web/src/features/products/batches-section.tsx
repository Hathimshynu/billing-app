import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLiveQuery } from 'dexie-react-hooks';
import { toast } from 'sonner';
import { PlusIcon } from 'lucide-react';
import { businessDate, expiryStatus } from '@shopdesk/shared';
import { db, type LocalProduct } from '@/lib/db/business';
import { useFormat } from '@/lib/format';
import { runtime } from '@/lib/runtime';
import { useSetting } from '@/lib/settings';
import { createBatch } from '@/lib/repos/catalog';
import { useCan } from '@/hooks/use-app';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FormGrid, FormRow } from '@/components/common/form';
import { NumberInput } from '@/components/common/number-input';
import { Section } from '@/components/common/page';
import { ResponsiveDialog } from '@/components/common/responsive-dialog';

export function BatchesSection({ product }: { product: LocalProduct }) {
  const { t } = useTranslation();
  const fmt = useFormat();
  const can = useCan();
  const pos = useSetting('pos');
  const [open, setOpen] = useState(false);
  const today = businessDate(new Date(), runtime().timezone);
  const rows = useLiveQuery(async () => {
    const batches = await db().product_batches.where('product_id').equals(product.id).filter((b) => !b.deleted_at).toArray();
    const levels = await db().stock_levels.where('product_id').equals(product.id).filter((l) => l.store_id === runtime().storeId).toArray();
    return batches
      .map((b) => ({ ...b, qty: levels.filter((l) => l.batch_id === b.id).reduce((s, l) => s + l.qty, 0) }))
      .sort((a, b) => (a.expiry_date ?? '9999').localeCompare(b.expiry_date ?? '9999'));
  }, [product.id]);

  return (
    <Section
      title={t('product.batches', 'Batches')}
      description={t('product.batches_hint', 'Stock for each batch comes from purchases and stock adjustments.')}
      actions={
        can('products.edit') ? (
          <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
            <PlusIcon /> {t('product.add_batch', 'Add batch')}
          </Button>
        ) : null
      }
    >
      {rows?.length ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                <th className="py-1">{t('product.batch_no', 'Batch no.')}</th>
                <th className="py-1">{t('product.expiry', 'Expiry date')}</th>
                <th className="py-1 text-right">MRP</th>
                <th className="py-1 text-right">{t('product.price', 'Price')}</th>
                <th className="py-1 text-right">{t('product.stock', 'Stock')}</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((b) => {
                const status = expiryStatus(b.expiry_date, today, pos.near_expiry_days);
                return (
                  <tr key={b.id}>
                    <td className="py-1.5 font-mono">{b.batch_no}</td>
                    <td className="py-1.5">
                      {b.expiry_date ? fmt.date(b.expiry_date) : '—'}{' '}
                      {status === 'expired' ? <Badge variant="destructive">{t('expiry.expired', 'Expired')}</Badge> : status === 'near_expiry' ? <Badge className="bg-warning/25 text-foreground">{t('expiry.near', 'Expiring soon')}</Badge> : null}
                    </td>
                    <td className="money py-1.5 text-right">{b.mrp !== null ? fmt.money(b.mrp) : '—'}</td>
                    <td className="money py-1.5 text-right">{fmt.money(b.selling_price ?? product.selling_price)}</td>
                    <td className="py-1.5 text-right tabular-nums">{fmt.qty(b.qty)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">{t('product.no_batches', 'No batches yet.')}</p>
      )}
      <AddBatchDialog product={product} open={open} onOpenChange={setOpen} />
    </Section>
  );
}

function AddBatchDialog({ product, open, onOpenChange }: { product: LocalProduct; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t } = useTranslation();
  const [batchNo, setBatchNo] = useState('');
  const [expiry, setExpiry] = useState('');
  const [mfg, setMfg] = useState('');
  const [mrp, setMrp] = useState<number | null>(product.mrp);
  const [cost, setCost] = useState<number | null>(product.purchase_price);
  const [price, setPrice] = useState<number | null>(product.selling_price);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!batchNo.trim()) return toast.error(t('product.batch_required', 'Enter the batch number.'));
    if (product.track_expiry && !expiry) return toast.error(t('product.expiry_required', 'Enter the expiry date.'));
    const exists = await db().product_batches.where('product_id').equals(product.id).filter((b) => b.batch_no.toLowerCase() === batchNo.trim().toLowerCase() && !b.deleted_at).count();
    if (exists) return toast.error(t('product.batch_exists', 'This batch number already exists for the product.'));
    setSaving(true);
    try {
      await createBatch({ product_id: product.id, variant_id: null, batch_no: batchNo.trim(), expiry_date: expiry || null, mfg_date: mfg || null, mrp, purchase_price: cost, selling_price: price });
      toast.success(t('product.batch_added', 'Batch added'));
      onOpenChange(false);
      setBatchNo('');
      setExpiry('');
      setMfg('');
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
      title={t('product.add_batch', 'Add batch')}
      footer={
        <Button onClick={() => void save()} disabled={saving}>
          {t('common.save', 'Save')}
        </Button>
      }
    >
      <FormGrid>
        <FormRow label={t('product.batch_no', 'Batch no.')} htmlFor="b-no" required>
          <Input id="b-no" value={batchNo} onChange={(e) => setBatchNo(e.target.value)} autoFocus />
        </FormRow>
        <FormRow label={t('product.expiry', 'Expiry date')} htmlFor="b-exp" required={product.track_expiry}>
          <Input id="b-exp" type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} />
        </FormRow>
        <FormRow label={t('product.mfg', 'Manufacturing date')} htmlFor="b-mfg">
          <Input id="b-mfg" type="date" value={mfg} onChange={(e) => setMfg(e.target.value)} />
        </FormRow>
        <FormRow label="MRP" htmlFor="b-mrp">
          <NumberInput id="b-mrp" value={mrp} onValueChange={setMrp} />
        </FormRow>
        <FormRow label={t('product.purchase_price', 'Purchase price')} htmlFor="b-cost">
          <NumberInput id="b-cost" value={cost} onValueChange={setCost} />
        </FormRow>
        <FormRow label={t('product.selling_price', 'Selling price')} htmlFor="b-price">
          <NumberInput id="b-price" value={price} onValueChange={setPrice} />
        </FormRow>
      </FormGrid>
    </ResponsiveDialog>
  );
}
