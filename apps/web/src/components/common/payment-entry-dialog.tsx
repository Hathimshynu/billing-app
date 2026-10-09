import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { PAYMENT_METHOD_LABELS, paymentEntrySchema, type PaymentEntryInput, type PaymentMethod } from '@shopdesk/shared';
import { useFormat } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { NumberInput } from './number-input';
import { FormRow } from './form';
import { ResponsiveDialog } from './responsive-dialog';
import { todayString } from './date-range';

const METHODS: PaymentMethod[] = ['cash', 'upi', 'card', 'bank_transfer', 'wallet', 'other'];

/** Record a payment received from a customer or paid to a supplier (validated with the shared schema). */
export function PaymentEntryDialog({
  open,
  onOpenChange,
  title,
  description,
  suggested,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  suggested: number;
  onSubmit: (input: PaymentEntryInput) => Promise<void>;
}) {
  const { t } = useTranslation();
  const fmt = useFormat();
  const [amount, setAmount] = useState<number | null>(null);
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [reference, setReference] = useState('');
  const [date, setDate] = useState(todayString());
  const [notes, setNotes] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setAmount(suggested > 0 ? suggested : null);
    setMethod('cash');
    setReference('');
    setDate(todayString());
    setNotes('');
    setErrors({});
  }, [open, suggested]);

  const save = async () => {
    const parsed = paymentEntrySchema.safeParse({ amount: amount ?? 0, method, reference: reference || null, payment_date: date, notes: notes || null });
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])));
      return;
    }
    setSaving(true);
    try {
      await onSubmit(parsed.data);
      onOpenChange(false);
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
      title={title}
      description={description}
      dismissible={!saving}
      footer={
        <Button onClick={() => void save()} disabled={saving} data-testid="payment-save">
          {t('payment.record', 'Record payment')} {amount ? fmt.money(amount) : ''}
        </Button>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <FormRow label={t('payment.amount', 'Amount')} htmlFor="pe-amount" error={errors.amount} required>
          <NumberInput id="pe-amount" value={amount} onValueChange={setAmount} autoFocus data-testid="payment-amount" />
        </FormRow>
        <FormRow label={t('payment.method', 'Method')} htmlFor="pe-method">
          <Select value={method} onValueChange={(v) => setMethod(v as PaymentMethod)}>
            <SelectTrigger id="pe-method" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {METHODS.map((m) => (
                <SelectItem key={m} value={m}>
                  {PAYMENT_METHOD_LABELS[m]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormRow>
        <FormRow label={t('payment.date', 'Date')} htmlFor="pe-date" error={errors.payment_date}>
          <Input id="pe-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </FormRow>
        <FormRow label={t('payment.reference', 'Reference / transaction ID')} htmlFor="pe-ref" error={errors.reference}>
          <Input id="pe-ref" value={reference} onChange={(e) => setReference(e.target.value)} />
        </FormRow>
        <FormRow label={t('common.notes', 'Notes')} htmlFor="pe-notes" className="sm:col-span-2" error={errors.notes}>
          <Textarea id="pe-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </FormRow>
      </div>
    </ResponsiveDialog>
  );
}
