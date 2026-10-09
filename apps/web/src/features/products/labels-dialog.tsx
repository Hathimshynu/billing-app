import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { PrinterIcon } from 'lucide-react';
import type { LocalProduct } from '@/lib/db/business';
import { useFormat } from '@/lib/format';
import { LABEL_SIZES, printLabels, type LabelItem, type LabelSize } from '@/lib/print/labels';
import { useBusiness } from '@/hooks/use-app';
import { Button } from '@/components/ui/button';
import { NumberInput } from '@/components/common/number-input';
import { ResponsiveDialog } from '@/components/common/responsive-dialog';

/** Print barcode labels for a product (one row per variant). */
export function LabelsDialog({ open, onOpenChange, product }: { open: boolean; onOpenChange: (o: boolean) => void; product: LocalProduct }) {
  const { t } = useTranslation();
  const fmt = useFormat();
  const business = useBusiness();
  const [size, setSize] = useState<LabelSize>('38x25');
  const [copies, setCopies] = useState<Record<string, number | null>>({});

  const rows = product.has_variants
    ? product.variants.filter((v) => v.active).map((v) => ({ id: v.id, name: `${product.name} ${v.name}`, code: v.barcode ?? v.sku ?? product.barcode ?? product.sku, price: v.selling_price ?? product.selling_price, mrp: v.mrp ?? product.mrp }))
    : [{ id: product.id, name: product.name, code: product.barcode ?? product.sku, price: product.selling_price, mrp: product.mrp }];

  useEffect(() => {
    if (open) setCopies({});
  }, [open]);

  const print = async () => {
    const items: LabelItem[] = rows.filter((r) => r.code && (copies[r.id] ?? 1) > 0).map((r) => ({ name: r.name, code: r.code!, price: product.product_type === 'jewellery' ? null : r.price, mrp: r.mrp, copies: copies[r.id] ?? 1 }));
    if (!items.length) return toast.error(t('labels.no_code', 'Add a barcode or SKU to the product first.'));
    try {
      await printLabels(items, size, fmt, business?.name ?? '');
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('product.labels', 'Print labels')}
      footer={
        <Button onClick={() => void print()}>
          <PrinterIcon /> {t('receipt.print', 'Print')}
        </Button>
      }
    >
      <div className="space-y-4">
        <div className="flex flex-wrap gap-2">
          {(Object.keys(LABEL_SIZES) as LabelSize[]).map((key) => (
            <Button key={key} variant={size === key ? 'default' : 'outline'} size="sm" onClick={() => setSize(key)}>
              {LABEL_SIZES[key].label}
            </Button>
          ))}
        </div>
        <ul className="divide-y rounded-lg border">
          {rows.map((r) => (
            <li key={r.id} className="flex items-center gap-3 px-3 py-2">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm">{r.name}</span>
                <span className="block font-mono text-xs text-muted-foreground">{r.code ?? t('labels.missing', 'No barcode')}</span>
              </span>
              <NumberInput className="w-20" decimals={0} value={copies[r.id] ?? 1} onValueChange={(v) => setCopies((c) => ({ ...c, [r.id]: v }))} disabled={!r.code} aria-label={t('labels.copies', 'Copies')} />
            </li>
          ))}
        </ul>
      </div>
    </ResponsiveDialog>
  );
}
