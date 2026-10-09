import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLiveQuery } from 'dexie-react-hooks';
import { toast } from 'sonner';
import { PlusIcon, SearchIcon, UserIcon } from 'lucide-react';
import { customerSchema, INDIAN_STATES, type Customer } from '@shopdesk/shared';
import { db, type LocalCustomer } from '@/lib/db/business';
import { useFormat } from '@/lib/format';
import { runtime } from '@/lib/runtime';
import { createCustomer, ledgerBalance } from '@/lib/repos/parties';
import { useCan } from '@/hooks/use-app';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ResponsiveDialog } from '@/components/common/responsive-dialog';

/** Customer search with inline quick-add. Works fully offline (IndexedDB). */
export function CustomerPicker({ open, onOpenChange, onPick }: { open: boolean; onOpenChange: (open: boolean) => void; onPick: (customer: Customer) => void }) {
  const { t } = useTranslation();
  const fmt = useFormat();
  const can = useCan();
  const [query, setQuery] = useState('');
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    if (open) {
      setQuery('');
      setAdding(false);
    }
  }, [open]);

  const results = useLiveQuery(async () => {
    const q = query.trim().toLowerCase();
    const all = db().customers.filter((c) => c.active && !c.deleted_at);
    const list: LocalCustomer[] = q ? await all.filter((c) => (c.search ?? `${c.name} ${c.phone ?? ''}`.toLowerCase()).includes(q)).limit(30).toArray() : await all.limit(30).toArray();
    const balances = new Map<string, number>();
    for (const c of list) balances.set(c.id, ledgerBalance(await db().customer_ledger.where('customer_id').equals(c.id).toArray()));
    return list.map((c) => ({ customer: c, balance: balances.get(c.id) ?? 0 }));
  }, [query]);

  const pick = (customer: Customer) => {
    onPick(customer);
    onOpenChange(false);
  };

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange} title={adding ? t('customer.new', 'New customer') : t('customer.select', 'Select customer')}>
      {adding ? (
        <QuickAdd initialQuery={query} onCancel={() => setAdding(false)} onCreated={pick} />
      ) : (
        <div className="space-y-3">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('customer.search', 'Name or phone')}
                className="pl-8"
                data-testid="customer-search"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && results?.length === 1) pick(results[0]!.customer);
                }}
              />
            </div>
            {can('customers.create') ? (
              <Button onClick={() => setAdding(true)} data-testid="customer-add">
                <PlusIcon /> {t('common.new', 'New')}
              </Button>
            ) : null}
          </div>
          <ul className="max-h-[50dvh] divide-y overflow-y-auto rounded-lg border">
            {(results ?? []).map(({ customer, balance }) => (
              <li key={customer.id}>
                <button type="button" className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-muted" onClick={() => pick(customer)} data-testid="customer-option">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted">
                    <UserIcon className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{customer.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">{[customer.phone, customer.gstin].filter(Boolean).join(' · ')}</span>
                  </span>
                  {balance > 0 ? <span className="money text-xs font-medium text-destructive">{t('customer.due', 'Due')} {fmt.money(balance)}</span> : null}
                </button>
              </li>
            ))}
            {results && results.length === 0 ? <li className="p-6 text-center text-sm text-muted-foreground">{t('customer.none', 'No customers found.')}</li> : null}
          </ul>
        </div>
      )}
    </ResponsiveDialog>
  );
}

function QuickAdd({ initialQuery, onCancel, onCreated }: { initialQuery: string; onCancel: () => void; onCreated: (customer: Customer) => void }) {
  const { t } = useTranslation();
  const looksLikePhone = /^[+\d\s-]{6,}$/.test(initialQuery.trim());
  const [name, setName] = useState(looksLikePhone ? '' : initialQuery.trim());
  const [phone, setPhone] = useState(looksLikePhone ? initialQuery.trim() : '');
  const [gstin, setGstin] = useState('');
  const [state, setState] = useState<string>(runtime().stateCode ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const save = async () => {
    const parsed = customerSchema.safeParse({
      name,
      phone: phone || null,
      email: null,
      address: null,
      city: null,
      state_code: state || null,
      pincode: null,
      gstin: gstin || null,
      credit_limit: 0,
      opening_balance: 0,
      tier: null,
      notes: null,
      date_of_birth: null,
      active: true,
    });
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])));
      return;
    }
    if (parsed.data.phone && (await db().customers.where('phone').equals(parsed.data.phone).filter((c) => !c.deleted_at).count()) > 0) {
      setErrors({ phone: t('customer.phone_exists', 'A customer with this phone number already exists.') });
      return;
    }
    setSaving(true);
    try {
      const customer = await createCustomer(parsed.data);
      toast.success(t('customer.created', 'Customer added'));
      onCreated(customer);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <label className="block space-y-1 text-sm">
        <span className="font-medium">{t('customer.name', 'Name')} *</span>
        <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} aria-invalid={!!errors.name} data-testid="customer-name" />
        {errors.name ? <span className="text-xs text-destructive">{errors.name}</span> : null}
      </label>
      <label className="block space-y-1 text-sm">
        <span className="font-medium">{t('customer.phone', 'Phone')}</span>
        <Input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" aria-invalid={!!errors.phone} data-testid="customer-phone" />
        {errors.phone ? <span className="text-xs text-destructive">{errors.phone}</span> : null}
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block space-y-1 text-sm">
          <span className="font-medium">GSTIN</span>
          <Input value={gstin} onChange={(e) => setGstin(e.target.value.toUpperCase())} aria-invalid={!!errors.gstin} />
          {errors.gstin ? <span className="text-xs text-destructive">{errors.gstin}</span> : null}
        </label>
        <label className="block space-y-1 text-sm">
          <span className="font-medium">{t('customer.state', 'State')}</span>
          <select className="h-9 w-full rounded-lg border bg-background px-2" value={state} onChange={(e) => setState(e.target.value)}>
            <option value="">—</option>
            {INDIAN_STATES.map((s) => (
              <option key={s.code} value={s.code}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" onClick={onCancel}>
          {t('common.back', 'Back')}
        </Button>
        <Button type="submit" disabled={saving} data-testid="customer-save">
          {t('customer.save_select', 'Save & select')}
        </Button>
      </div>
    </form>
  );
}
