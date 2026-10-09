import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { roundQty, sumDecimals, type RefundMethod, type Sale } from '@shopdesk/shared';
import { useFormat } from '@/lib/format';
import { currentRegister } from '@/lib/repos/finance';
import { createSaleReturn, returnAmounts, type ReturnLineInput } from '@/lib/repos/sales';
import { printCreditNote } from '@/lib/print';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { NumberInput } from '@/components/common/number-input';
import { ResponsiveDialog } from '@/components/common/responsive-dialog';

const REFUND_METHODS: Array<{ value: RefundMethod; label: string }> = [
  { value: 'cash', label: 'Cash refund' },
  { value: 'upi', label: 'UPI refund' },
  { value: 'card', label: 'Card refund' },
  { value: 'bank_transfer', label: 'Bank transfer' },
  { value: 'store_credit', label: 'Store credit (customer account)' },
  { value: 'exchange', label: 'Exchange' },
];

interface LineState {
  quantity: number | null;
  restock: boolean;
  serials: string[];
}

export function ReturnDialog({ sale, open, onOpenChange }: { sale: Sale; open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t } = useTranslation();
  const fmt = useFormat();
  const [lines, setLines] = useState<Record<string, LineState>>({});
  const [method, setMethod] = useState<RefundMethod>('cash');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLines(Object.fromEntries(sale.items.map((i) => [i.id, { quantity: null, restock: true, serials: [] }])));
    setMethod(sale.customer_id ? 'store_credit' : 'cash');
    setReason('');
  }, [open, sale]);

  const returnable = sale.items.filter((i) => roundQty(i.quantity - i.returned_qty) > 0);
  const preview = useMemo(
    () =>
      sumDecimals(
        returnable.map((item) => {
          const qty = lines[item.id]?.quantity ?? 0;
          return qty > 0 ? returnAmounts(item, qty).total : 0;
        }),
      ),
    [lines, returnable],
  );

  const update = (id: string, patch: Partial<LineState>) => setLines((current) => ({ ...current, [id]: { ...current[id]!, ...patch } }));

  const save = async () => {
    const input: ReturnLineInput[] = [];
    for (const item of returnable) {
      const state = lines[item.id];
      const qty = state?.quantity ?? 0;
      if (qty <= 0) continue;
      const max = roundQty(item.quantity - item.returned_qty);
      if (qty > max) return toast.error(t('return.too_many', 'You can return at most {{max}} of {{name}}.', { max, name: item.name }));
      if (item.serial_ids.length && state!.serials.length !== qty) return toast.error(t('return.pick_serials', 'Select which serial numbers of {{name}} are being returned.', { name: item.name }));
      input.push({ sale_item_id: item.id, quantity: qty, restock: state!.restock, serial_ids: state!.serials });
    }
    if (!input.length) return toast.error(t('return.none', 'Enter the quantity being returned.'));
    setSaving(true);
    try {
      const register = await currentRegister();
      const ret = await createSaleReturn(sale.id, input, method, reason.trim() || null, register?.id ?? null);
      toast.success(t('return.done', 'Credit note {{number}} created', { number: ret.return_number }));
      onOpenChange(false);
      printCreditNote(ret, fmt).catch((error: unknown) => toast.error(error instanceof Error ? error.message : String(error)));
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
      dismissible={!saving}
      size="lg"
      title={t('return.title', 'Return items — {{number}}', { number: sale.invoice_number })}
      footer={
        <div className="flex w-full items-center justify-between gap-2">
          <span className="text-sm">
            {t('return.refund', 'Refund')}: <span className="money font-semibold">{fmt.money(preview)}</span>
          </span>
          <Button onClick={() => void save()} disabled={saving || preview <= 0} data-testid="return-save">
            {t('return.create', 'Create credit note')}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <ul className="divide-y rounded-lg border">
          {returnable.map((item) => {
            const max = roundQty(item.quantity - item.returned_qty);
            const state = lines[item.id];
            return (
              <li key={item.id} className="space-y-2 p-3">
                <div className="flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{item.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {t('return.sold', 'Sold')} {fmt.qty(item.quantity)} · {t('return.returned', 'returned')} {fmt.qty(item.returned_qty)} · {fmt.money(item.unit_price)}
                    </p>
                  </div>
                  <NumberInput
                    className="w-24"
                    value={state?.quantity ?? null}
                    onValueChange={(v) => update(item.id, { quantity: v })}
                    decimals={Number.isInteger(item.quantity) ? 0 : 3}
                    placeholder={`≤ ${fmt.qty(max)}`}
                    disabled={item.serial_ids.length > 0}
                    aria-label={t('return.qty', 'Return quantity')}
                  />
                </div>
                {item.serial_ids.length ? (
                  <div className="flex flex-wrap gap-2">
                    {item.serial_ids.map((serialId, i) => {
                      const checked = state?.serials.includes(serialId) ?? false;
                      return (
                        <label key={serialId} className="flex items-center gap-1.5 rounded-md border px-2 py-1 font-mono text-xs">
                          <Checkbox
                            checked={checked}
                            onCheckedChange={(c) => {
                              const serials = c ? [...(state?.serials ?? []), serialId] : (state?.serials ?? []).filter((s) => s !== serialId);
                              update(item.id, { serials, quantity: serials.length || null });
                            }}
                          />
                          {item.serial_numbers[i] ?? serialId}
                        </label>
                      );
                    })}
                  </div>
                ) : null}
                {(state?.quantity ?? 0) > 0 ? (
                  <label className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Checkbox checked={state?.restock ?? true} onCheckedChange={(c) => update(item.id, { restock: !!c })} />
                    {t('return.restock', 'Put back into stock (uncheck for damaged items)')}
                  </label>
                ) : null}
              </li>
            );
          })}
        </ul>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <span className="text-sm font-medium">{t('return.method', 'Refund method')}</span>
            <Select value={method} onValueChange={(v) => setMethod(v as RefundMethod)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {REFUND_METHODS.filter((m) => sale.customer_id || m.value !== 'store_credit').map((m) => (
                  <SelectItem key={m.value} value={m.value}>
                    {t(`return.method_${m.value}`, m.label)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <span className="text-sm font-medium">{t('return.reason', 'Reason')}</span>
            <Textarea rows={1} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={250} />
          </div>
        </div>
      </div>
    </ResponsiveDialog>
  );
}
