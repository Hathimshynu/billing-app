import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { SaveIcon, WifiOffIcon } from 'lucide-react';
import { DEFAULT_NUMBER_FORMATS, formatDocumentNumber, INDIAN_STATES, PAYMENT_METHOD_LABELS, PAYMENT_METHODS, type Business, type PaymentMethod } from '@shopdesk/shared';
import { apiData, errorMessage } from '@/lib/api';
import { db } from '@/lib/db/business';
import { runtime } from '@/lib/runtime';
import { useSetting, type SettingKeyName, type SettingValue } from '@/lib/settings';
import { updateSetting } from '@/lib/repos/industry';
import { useBusiness, useOnline } from '@/hooks/use-app';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { FormGrid, FormRow } from '@/components/common/form';
import { NumberInput } from '@/components/common/number-input';
import { Section } from '@/components/common/page';
import { POS_ACTIONS, type PosAction } from '@/features/pos/shortcuts';
import { eventCombo } from '@/hooks/use-app';

/** Local draft of a settings group; saving sends only changed fields (field-level conflict detection). */
function useSettingDraft<K extends SettingKeyName>(key: K) {
  const saved = useSetting(key);
  const [draft, setDraft] = useState<SettingValue<K>>(saved);
  const [dirty, setDirty] = useState(false);
  const savedJson = JSON.stringify(saved);
  useEffect(() => {
    if (!dirty) setDraft(JSON.parse(savedJson) as SettingValue<K>);
  }, [savedJson, dirty]);
  const set = <F extends keyof SettingValue<K>>(field: F, value: SettingValue<K>[F]) => {
    setDraft((d) => ({ ...d, [field]: value }));
    setDirty(true);
  };
  const save = async () => {
    const changes: Record<string, unknown> = {};
    for (const [field, value] of Object.entries(draft as object)) {
      if (JSON.stringify(value) !== JSON.stringify((saved as unknown as Record<string, unknown>)[field])) changes[field] = value;
    }
    if (Object.keys(changes).length === 0) return setDirty(false);
    await updateSetting(key, changes);
    setDirty(false);
    toast.success('Settings saved');
  };
  return { draft, set, save, dirty };
}

function SaveBar({ dirty, onSave }: { dirty: boolean; onSave: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="flex justify-end">
      <Button onClick={onSave} disabled={!dirty} data-testid="settings-save">
        <SaveIcon /> {t('common.save', 'Save')}
      </Button>
    </div>
  );
}

function Toggle({ label, description, checked, onChange }: { label: ReactNode; description?: ReactNode; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4 rounded-lg border p-3 hover:bg-muted/40">
      <span className="space-y-0.5">
        <span className="block text-sm font-medium">{label}</span>
        {description ? <span className="block text-xs text-muted-foreground">{description}</span> : null}
      </span>
      <Switch checked={checked} onCheckedChange={onChange} />
    </label>
  );
}

/* ----------------------------------------------------------------- business */

export function BusinessTab() {
  const { t } = useTranslation();
  const business = useBusiness();
  const online = useOnline();
  const [draft, setDraft] = useState<Partial<Business>>({});
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (business) setDraft(business);
  }, [business?.id, business?.version]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!business) return null;
  const set = (patch: Partial<Business>) => setDraft((d) => ({ ...d, ...patch }));
  const save = async () => {
    setSaving(true);
    try {
      const fields = ['name', 'legal_name', 'gstin', 'state_code', 'phone', 'email', 'address', 'city', 'pincode', 'tax_system', 'fy_start_month', 'date_format', 'timezone'] as const;
      const body = Object.fromEntries(fields.map((f) => [f, (draft as Record<string, unknown>)[f] === '' ? null : (draft as Record<string, unknown>)[f]]));
      const updated = await apiData<Business>('/business', { method: 'PUT', body });
      await db().business.put(updated);
      toast.success(t('settings.business_saved', 'Business details updated'));
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setSaving(false);
    }
  };
  return (
    <Section title={t('settings.business', 'Business details')} description={t('settings.business_hint', 'Printed on invoices. Changing these needs an internet connection.')}>
      {!online ? (
        <p className="mb-3 flex items-center gap-2 text-sm text-muted-foreground">
          <WifiOffIcon className="size-4" /> {t('settings.online_only', 'Connect to the internet to edit.')}
        </p>
      ) : null}
      <fieldset disabled={!online || saving}>
        <FormGrid>
          <FormRow label={t('settings.name', 'Business name')} required>
            <Input value={draft.name ?? ''} onChange={(e) => set({ name: e.target.value })} />
          </FormRow>
          <FormRow label={t('settings.legal_name', 'Legal name')}>
            <Input value={draft.legal_name ?? ''} onChange={(e) => set({ legal_name: e.target.value })} />
          </FormRow>
          <FormRow label="GSTIN">
            <Input value={draft.gstin ?? ''} onChange={(e) => set({ gstin: e.target.value.toUpperCase() })} />
          </FormRow>
          <FormRow label={t('customer.state', 'State')}>
            <select className="h-8 w-full rounded-lg border bg-background px-2 text-sm" value={draft.state_code ?? ''} onChange={(e) => set({ state_code: e.target.value || null })}>
              <option value="">—</option>
              {INDIAN_STATES.map((s) => (
                <option key={s.code} value={s.code}>
                  {s.name}
                </option>
              ))}
            </select>
          </FormRow>
          <FormRow label={t('customer.phone', 'Phone')}>
            <Input value={draft.phone ?? ''} onChange={(e) => set({ phone: e.target.value })} />
          </FormRow>
          <FormRow label={t('customer.email', 'Email')}>
            <Input type="email" value={draft.email ?? ''} onChange={(e) => set({ email: e.target.value })} />
          </FormRow>
          <FormRow label={t('customer.address', 'Address')} className="sm:col-span-2">
            <Textarea rows={2} value={draft.address ?? ''} onChange={(e) => set({ address: e.target.value })} />
          </FormRow>
          <FormRow label={t('customer.city', 'City')}>
            <Input value={draft.city ?? ''} onChange={(e) => set({ city: e.target.value })} />
          </FormRow>
          <FormRow label={t('customer.pincode', 'PIN code')}>
            <Input value={draft.pincode ?? ''} onChange={(e) => set({ pincode: e.target.value })} />
          </FormRow>
          <FormRow label={t('settings.tax_system', 'Tax system')}>
            <select className="h-8 w-full rounded-lg border bg-background px-2 text-sm" value={draft.tax_system ?? 'gst'} onChange={(e) => set({ tax_system: e.target.value as Business['tax_system'] })}>
              <option value="gst">GST (India)</option>
              <option value="vat">VAT</option>
              <option value="simple">{t('catalog.simple', 'Simple tax')}</option>
              <option value="none">{t('settings.no_tax', 'No tax')}</option>
            </select>
          </FormRow>
          <FormRow label={t('settings.fy', 'Financial year starts in')}>
            <select className="h-8 w-full rounded-lg border bg-background px-2 text-sm" value={draft.fy_start_month ?? 4} onChange={(e) => set({ fy_start_month: Number(e.target.value) })}>
              {Array.from({ length: 12 }, (_, i) => (
                <option key={i + 1} value={i + 1}>
                  {new Date(2000, i, 1).toLocaleString('en', { month: 'long' })}
                </option>
              ))}
            </select>
          </FormRow>
          <FormRow label={t('settings.date_format', 'Date format')}>
            <select className="h-8 w-full rounded-lg border bg-background px-2 text-sm" value={draft.date_format ?? 'DD/MM/YYYY'} onChange={(e) => set({ date_format: e.target.value as Business['date_format'] })}>
              {['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD'].map((f) => (
                <option key={f}>{f}</option>
              ))}
            </select>
          </FormRow>
        </FormGrid>
        <div className="mt-4 flex justify-end">
          <Button onClick={() => void save()} disabled={!online || saving}>
            <SaveIcon /> {t('common.save', 'Save')}
          </Button>
        </div>
      </fieldset>
    </Section>
  );
}

/* ------------------------------------------------------------------ invoice */

const FORMAT_LABELS: Record<string, string> = { sale: 'Invoice', quotation: 'Quotation', sale_return: 'Credit note', purchase: 'Purchase', purchase_order: 'Purchase order', expense: 'Expense', customer_payment: 'Payment receipt' };

export function InvoiceTab() {
  const { t } = useTranslation();
  const { draft, set, save, dirty } = useSettingDraft('invoice');
  const preview = (format: string) => {
    try {
      return formatDocumentNumber(format, { sequence: 1, date: new Date().toISOString().slice(0, 10), fyStartMonth: runtime().fyStartMonth, deviceCode: runtime().deviceCode, storeCode: runtime().storeCode });
    } catch {
      return t('settings.bad_format', 'Invalid format');
    }
  };
  return (
    <div className="space-y-5">
      <Section title={t('settings.invoice', 'Invoice')}>
        <FormGrid>
          <FormRow label={t('settings.upi', 'UPI ID (for payment QR)')}>
            <Input value={draft.upi_id ?? ''} onChange={(e) => set('upi_id', e.target.value.trim() || null)} placeholder="shop@upi" />
          </FormRow>
          <FormRow label={t('settings.round_off', 'Round off invoice total to')}>
            <select className="h-8 w-full rounded-lg border bg-background px-2 text-sm" value={draft.round_off} onChange={(e) => set('round_off', e.target.value as typeof draft.round_off)}>
              <option value="none">{t('settings.no_round', 'No rounding')}</option>
              <option value="0.05">0.05</option>
              <option value="0.10">0.10</option>
              <option value="0.50">0.50</option>
              <option value="1.00">1.00</option>
            </select>
          </FormRow>
          <FormRow label={t('settings.quote_days', 'Quotation validity (days)')}>
            <NumberInput decimals={0} value={draft.quotation_validity_days} onValueChange={(v) => set('quotation_validity_days', Math.max(1, Math.round(v ?? 15)))} />
          </FormRow>
          <FormRow label={t('settings.block', 'Invoice numbers reserved per device')} description={t('settings.block_hint', 'Used for billing offline. Larger blocks = more offline invoices with final numbers.')}>
            <NumberInput decimals={0} value={draft.number_block_size} onValueChange={(v) => set('number_block_size', Math.min(500, Math.max(10, Math.round(v ?? 50))))} />
          </FormRow>
          <FormRow label={t('settings.terms', 'Terms & conditions')} className="sm:col-span-2">
            <Textarea rows={2} value={draft.terms} onChange={(e) => set('terms', e.target.value)} />
          </FormRow>
          <FormRow label={t('settings.footer', 'Footer message')}>
            <Input value={draft.footer} onChange={(e) => set('footer', e.target.value)} />
          </FormRow>
          <FormRow label={t('settings.bank', 'Bank details (A4 invoices)')}>
            <Textarea rows={2} value={draft.bank_details ?? ''} onChange={(e) => set('bank_details', e.target.value || null)} />
          </FormRow>
          <Toggle label={t('settings.hsn', 'Show HSN-wise tax summary')} checked={draft.show_hsn_summary} onChange={(v) => set('show_hsn_summary', v)} />
          <Toggle label={t('settings.savings', 'Show "You saved" vs MRP')} checked={draft.show_mrp_savings} onChange={(v) => set('show_mrp_savings', v)} />
        </FormGrid>
      </Section>
      <Section title={t('settings.numbering', 'Document numbering')} description={t('settings.numbering_hint', 'Placeholders: {YYYY} {YY} {MM} {FY} {FYY} {STORE} {DEVICE} {SEQ:6}. Changes apply to new number blocks.')}>
        <div className="space-y-2">
          {Object.entries(FORMAT_LABELS).map(([type, label]) => {
            const value = draft.formats[type] ?? DEFAULT_NUMBER_FORMATS[type as keyof typeof DEFAULT_NUMBER_FORMATS];
            return (
              <div key={type} className="grid items-center gap-2 sm:grid-cols-[10rem_1fr_10rem]">
                <span className="text-sm">{label}</span>
                <Input className="font-mono" value={value} onChange={(e) => set('formats', { ...draft.formats, [type]: e.target.value })} />
                <span className="font-mono text-xs text-muted-foreground">{preview(value)}</span>
              </div>
            );
          })}
        </div>
      </Section>
      <SaveBar dirty={dirty} onSave={() => void save()} />
    </div>
  );
}

/* ---------------------------------------------------------------------- pos */

export function PosTab() {
  const { t } = useTranslation();
  const { draft, set, save, dirty } = useSettingDraft('pos');
  const taxes = useTaxes();
  const [recording, setRecording] = useState<PosAction | null>(null);
  useEffect(() => {
    if (!recording) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return;
      set('shortcuts', { ...draft.shortcuts, [recording]: e.key === 'Escape' ? '' : eventCombo(e) });
      setRecording(null);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [recording, draft.shortcuts]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-5">
      <Section title={t('settings.pos', 'Billing rules')}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Toggle label={t('settings.negative', 'Allow selling beyond stock')} description={t('settings.negative_hint', 'Turn off to block sales when stock is not available.')} checked={draft.allow_negative_stock} onChange={(v) => set('allow_negative_stock', v)} />
          <Toggle label={t('settings.require_customer', 'Customer required on every bill')} checked={draft.default_customer_required} onChange={(v) => set('default_customer_required', v)} />
          <Toggle label={t('settings.print_after', 'Print receipt after each sale')} checked={draft.print_after_sale} onChange={(v) => set('print_after_sale', v)} />
          <Toggle label={t('settings.require_register', 'Require an open cash register')} checked={draft.require_register} onChange={(v) => set('require_register', v)} />
        </div>
        <FormGrid cols={3} className="mt-4">
          <FormRow label={t('settings.max_discount', 'Maximum discount %')}>
            <NumberInput value={draft.max_discount_percent} onValueChange={(v) => set('max_discount_percent', Math.min(100, Math.max(0, v ?? 0)))} />
          </FormRow>
          <FormRow label={t('settings.near_expiry', 'Near-expiry warning (days)')}>
            <NumberInput decimals={0} value={draft.near_expiry_days} onValueChange={(v) => set('near_expiry_days', Math.max(1, Math.round(v ?? 90)))} />
          </FormRow>
          <FormRow label={t('settings.quick', 'Quick cash amounts')}>
            <Input value={draft.quick_amounts.join(', ')} onChange={(e) => set('quick_amounts', e.target.value.split(',').map((x) => Number(x.trim())).filter((n) => Number.isFinite(n) && n > 0))} />
          </FormRow>
          <FormRow label={t('settings.service_charge', 'Service charge % (dine-in)')}>
            <NumberInput value={draft.service_charge_percent} onValueChange={(v) => set('service_charge_percent', Math.min(100, Math.max(0, v ?? 0)))} />
          </FormRow>
          <FormRow label={t('settings.service_tax', 'Tax on service charge')}>
            <select className="h-8 w-full rounded-lg border bg-background px-2 text-sm" value={draft.service_charge_tax_rate_id ?? ''} onChange={(e) => set('service_charge_tax_rate_id', e.target.value || null)}>
              <option value="">{t('product.no_tax', 'No tax')}</option>
              {taxes.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
          </FormRow>
        </FormGrid>
      </Section>
      <Section title={t('settings.methods', 'Payment methods at the POS')}>
        <div className="flex flex-wrap gap-4">
          {PAYMENT_METHODS.filter((m) => !['credit_note', 'loyalty', 'old_gold'].includes(m)).map((m) => (
            <label key={m} className="flex items-center gap-2 text-sm">
              <Checkbox checked={draft.enabled_payment_methods.includes(m)} onCheckedChange={(c) => set('enabled_payment_methods', c ? [...draft.enabled_payment_methods, m] : draft.enabled_payment_methods.filter((x: PaymentMethod) => x !== m))} />
              {PAYMENT_METHOD_LABELS[m]}
            </label>
          ))}
        </div>
      </Section>
      <Section title={t('settings.scale', 'Weighing-scale barcodes')} description={t('settings.scale_hint', 'Labels printed by a scale embed the item code and its weight or price.')}>
        <Toggle label={t('settings.scale_enable', 'Read weighing-scale labels')} checked={draft.scale_barcode.enabled} onChange={(v) => set('scale_barcode', { ...draft.scale_barcode, enabled: v })} />
        {draft.scale_barcode.enabled ? (
          <FormGrid cols={3} className="mt-3">
            <FormRow label={t('settings.scale_prefix', 'Prefixes')}>
              <Input value={draft.scale_barcode.prefixes.join(',')} onChange={(e) => set('scale_barcode', { ...draft.scale_barcode, prefixes: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) })} />
            </FormRow>
            <FormRow label={t('settings.scale_item', 'Item code digits')}>
              <NumberInput decimals={0} value={draft.scale_barcode.item_code_length} onValueChange={(v) => set('scale_barcode', { ...draft.scale_barcode, item_code_length: Math.round(v ?? 5) })} />
            </FormRow>
            <FormRow label={t('settings.scale_type', 'Embedded value')}>
              <select className="h-8 w-full rounded-lg border bg-background px-2 text-sm" value={draft.scale_barcode.value_type} onChange={(e) => set('scale_barcode', { ...draft.scale_barcode, value_type: e.target.value as 'weight' | 'price' })}>
                <option value="weight">{t('settings.weight', 'Weight')}</option>
                <option value="price">{t('settings.price', 'Price')}</option>
              </select>
            </FormRow>
            <FormRow label={t('settings.scale_len', 'Value digits')}>
              <NumberInput decimals={0} value={draft.scale_barcode.value_length} onValueChange={(v) => set('scale_barcode', { ...draft.scale_barcode, value_length: Math.round(v ?? 5) })} />
            </FormRow>
            <FormRow label={t('settings.scale_dec', 'Value decimals')}>
              <NumberInput decimals={0} value={draft.scale_barcode.value_decimals} onValueChange={(v) => set('scale_barcode', { ...draft.scale_barcode, value_decimals: Math.round(v ?? 3) })} />
            </FormRow>
          </FormGrid>
        ) : null}
      </Section>
      <Section title={t('settings.shortcuts', 'Keyboard shortcuts')} description={t('settings.shortcuts_hint', 'Click a key, then press the new combination (Esc to clear).')}>
        <div className="grid gap-2 sm:grid-cols-2">
          {(Object.keys(POS_ACTIONS) as PosAction[]).map((action) => (
            <div key={action} className="flex items-center justify-between rounded-lg border px-3 py-2 text-sm">
              {POS_ACTIONS[action].label}
              <Button size="sm" variant={recording === action ? 'default' : 'outline'} className="min-w-24 font-mono" onClick={() => setRecording(action)}>
                {recording === action ? t('settings.press', 'Press keys…') : (draft.shortcuts[action] ?? POS_ACTIONS[action].default) || '—'}
              </Button>
            </div>
          ))}
        </div>
      </Section>
      <SaveBar dirty={dirty} onSave={() => void save()} />
    </div>
  );
}

function useTaxes() {
  const [taxes, setTaxes] = useState<Array<{ id: string; name: string }>>([]);
  useEffect(() => {
    void db()
      .tax_rates.filter((x) => !x.deleted_at && x.active)
      .toArray()
      .then(setTaxes);
  }, []);
  return taxes;
}

/* --------------------------------------------------- printer, loyalty, alerts */

export function PrinterTab() {
  const { t } = useTranslation();
  const printer = useSettingDraft('printer');
  const loyalty = useSettingDraft('loyalty');
  const alerts = useSettingDraft('notifications');
  return (
    <div className="space-y-5">
      <Section title={t('settings.printer', 'Printing')} description={t('settings.printer_hint', 'Receipts print through the browser print dialog to any installed printer (thermal or A4).')}>
        <FormGrid cols={3}>
          <FormRow label={t('settings.paper', 'Receipt paper')}>
            <select className="h-8 w-full rounded-lg border bg-background px-2 text-sm" value={printer.draft.paper} onChange={(e) => printer.set('paper', e.target.value as 'a4' | '80mm' | '58mm')}>
              <option value="80mm">80 mm thermal</option>
              <option value="58mm">58 mm thermal</option>
              <option value="a4">A4 / Letter</option>
            </select>
          </FormRow>
          <FormRow label={t('settings.kot_paper', 'KOT paper')}>
            <select className="h-8 w-full rounded-lg border bg-background px-2 text-sm" value={printer.draft.kot_paper} onChange={(e) => printer.set('kot_paper', e.target.value as '80mm' | '58mm')}>
              <option value="80mm">80 mm</option>
              <option value="58mm">58 mm</option>
            </select>
          </FormRow>
          <FormRow label={t('settings.copies', 'Copies')}>
            <NumberInput decimals={0} value={printer.draft.copies} onValueChange={(v) => printer.set('copies', Math.min(5, Math.max(1, Math.round(v ?? 1))))} />
          </FormRow>
          <FormRow label={t('settings.header_text', 'Header text')} className="sm:col-span-3">
            <Input value={printer.draft.header_text} onChange={(e) => printer.set('header_text', e.target.value)} />
          </FormRow>
          <FormRow label={t('settings.footer_text', 'Footer text')} className="sm:col-span-3">
            <Input value={printer.draft.footer_text} onChange={(e) => printer.set('footer_text', e.target.value)} />
          </FormRow>
          <Toggle label={t('settings.logo', 'Print logo')} checked={printer.draft.show_logo} onChange={(v) => printer.set('show_logo', v)} />
        </FormGrid>
        <div className="mt-4">
          <SaveBar dirty={printer.dirty} onSave={() => void printer.save()} />
        </div>
      </Section>
      <Section title={t('settings.loyalty', 'Loyalty points')}>
        <Toggle label={t('settings.loyalty_on', 'Enable loyalty points')} checked={loyalty.draft.enabled} onChange={(v) => loyalty.set('enabled', v)} />
        {loyalty.draft.enabled ? (
          <FormGrid cols={3} className="mt-3">
            <FormRow label={t('settings.earn', 'Points per 100 spent')}>
              <NumberInput value={loyalty.draft.earn_per_100} onValueChange={(v) => loyalty.set('earn_per_100', Math.max(0, v ?? 0))} />
            </FormRow>
            <FormRow label={t('settings.point_value', 'Value of one point')}>
              <NumberInput value={loyalty.draft.point_value} onValueChange={(v) => loyalty.set('point_value', Math.max(0.01, v ?? 1))} />
            </FormRow>
            <FormRow label={t('settings.min_redeem', 'Minimum points to redeem')}>
              <NumberInput decimals={0} value={loyalty.draft.min_redeem_points} onValueChange={(v) => loyalty.set('min_redeem_points', Math.max(0, Math.round(v ?? 0)))} />
            </FormRow>
          </FormGrid>
        ) : null}
        <div className="mt-4">
          <SaveBar dirty={loyalty.dirty} onSave={() => void loyalty.save()} />
        </div>
      </Section>
      <Section title={t('settings.alerts', 'Alerts')}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Toggle label={t('settings.a_low', 'Low stock')} checked={alerts.draft.low_stock} onChange={(v) => alerts.set('low_stock', v)} />
          <Toggle label={t('settings.a_expiry', 'Expiry')} checked={alerts.draft.expiry} onChange={(v) => alerts.set('expiry', v)} />
          <Toggle label={t('settings.a_cust', 'Customer dues')} checked={alerts.draft.customer_dues} onChange={(v) => alerts.set('customer_dues', v)} />
          <Toggle label={t('settings.a_supp', 'Supplier dues')} checked={alerts.draft.supplier_dues} onChange={(v) => alerts.set('supplier_dues', v)} />
          <Toggle label={t('settings.a_reg', 'Cash register mismatch')} checked={alerts.draft.register_mismatch} onChange={(v) => alerts.set('register_mismatch', v)} />
          <Toggle label={t('settings.a_sync', 'Sync failures')} checked={alerts.draft.sync_failed} onChange={(v) => alerts.set('sync_failed', v)} />
        </div>
        <div className="mt-4">
          <SaveBar dirty={alerts.dirty} onSave={() => void alerts.save()} />
        </div>
      </Section>
    </div>
  );
}
