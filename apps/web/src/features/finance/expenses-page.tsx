import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLiveQuery } from 'dexie-react-hooks';
import { toast } from 'sonner';
import { PaperclipIcon, PlusIcon, SettingsIcon, Trash2Icon, WalletIcon } from 'lucide-react';
import { EXPENSE_CATEGORIES, expenseSchema, PAYMENT_METHOD_LABELS, sumDecimals, type Expense, type PaymentMethod } from '@shopdesk/shared';
import { db } from '@/lib/db/business';
import { useFormat } from '@/lib/format';
import { createExpense, createExpenseCategory, currentRegister, deleteExpenseCategory, voidExpense } from '@/lib/repos/finance';
import { useCan } from '@/hooks/use-app';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { confirm } from '@/components/common/confirm';
import { DataTable, type Column } from '@/components/common/data-table';
import { DateRangePicker, presetRange, todayString } from '@/components/common/date-range';
import { FormGrid, FormRow } from '@/components/common/form';
import { NumberInput } from '@/components/common/number-input';
import { Page, PageHeader } from '@/components/common/page';
import { ResponsiveDialog } from '@/components/common/responsive-dialog';

const METHODS: PaymentMethod[] = ['cash', 'upi', 'card', 'bank_transfer', 'wallet', 'other'];

export default function ExpensesPage() {
  const { t } = useTranslation();
  const fmt = useFormat();
  const can = useCan();
  const [range, setRange] = useState(() => presetRange('month'));
  const [open, setOpen] = useState(false);
  const [catsOpen, setCatsOpen] = useState(false);
  const data = useLiveQuery(() => db().expenses.where('expense_date').between(range.from, range.to, true, true).filter((e) => !e.deleted_at).reverse().sortBy('expense_date'), [range.from, range.to]);
  const attachments = useLiveQuery(async () => new Set((await db().attachments.toArray()).map((a) => a.entity_id)), []);
  const active = (data ?? []).filter((e) => e.status === 'active');

  const columns: Column<Expense>[] = [
    { id: 'number', header: t('expense.number', 'No.'), cell: (e) => <span className="font-medium">{e.expense_number}</span>, value: (e) => e.expense_number },
    { id: 'date', header: t('sales.date', 'Date'), cell: (e) => fmt.date(e.expense_date), value: (e) => e.expense_date },
    { id: 'category', header: t('expense.category', 'Category'), cell: (e) => e.category_name ?? '—', value: (e) => e.category_name ?? '' },
    { id: 'method', header: t('payment.method', 'Method'), cell: (e) => PAYMENT_METHOD_LABELS[e.payment_method], value: (e) => e.payment_method, hideOnMobile: true },
    {
      id: 'notes',
      header: t('common.notes', 'Notes'),
      cell: (e) => (
        <span className="flex items-center gap-1">
          {e.notes ?? e.reference ?? ''}
          {e.attachment_url || attachments?.has(e.id) ? <PaperclipIcon className="size-3.5 text-muted-foreground" /> : null}
          {e.status === 'void' ? <Badge variant="destructive">{t('expense.void', 'Void')}</Badge> : null}
        </span>
      ),
      value: (e) => e.notes ?? '',
      hideOnMobile: true,
    },
    { id: 'amount', header: t('payment.amount', 'Amount'), cell: (e) => <span className={`money font-medium ${e.status === 'void' ? 'line-through opacity-60' : ''}`}>{fmt.money(e.amount)}</span>, value: (e) => e.amount, align: 'right', numeric: true },
    ...(can('expenses.delete')
      ? [
          {
            id: 'void',
            header: '',
            sortable: false,
            cell: (e: Expense) =>
              e.status === 'active' ? (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t('expense.void_action', 'Void expense')}
                  onClick={async () => {
                    const { confirmed } = await confirm({ title: t('expense.void_title', 'Void {{number}}?', { number: e.expense_number }), destructive: true, confirmLabel: t('expense.void_action', 'Void expense') });
                    if (confirmed) await voidExpense(e.id);
                  }}
                >
                  <Trash2Icon />
                </Button>
              ) : null,
          },
        ]
      : []),
  ];

  return (
    <Page>
      <PageHeader
        title={t('expense.title', 'Expenses')}
        description={`${active.length} · ${fmt.money(sumDecimals(active.map((e) => e.amount)))}`}
        actions={
          <>
            {can('settings.manage') || can('expenses.create') ? (
              <Button variant="outline" onClick={() => setCatsOpen(true)}>
                <SettingsIcon /> {t('expense.categories', 'Categories')}
              </Button>
            ) : null}
            {can('expenses.create') ? (
              <Button onClick={() => setOpen(true)} data-testid="new-expense">
                <PlusIcon /> {t('expense.new', 'New expense')}
              </Button>
            ) : null}
          </>
        }
      />
      <DataTable
        data={data}
        columns={columns}
        rowKey={(e) => e.id}
        searchText={(e) => `${e.expense_number} ${e.category_name ?? ''} ${e.notes ?? ''} ${e.reference ?? ''}`}
        exportName={`expenses-${range.from}-to-${range.to}`}
        toolbar={<DateRangePicker value={range} onChange={setRange} />}
        empty={{ icon: WalletIcon, title: t('expense.empty', 'No expenses in this period') }}
      />
      <ExpenseDialog open={open} onOpenChange={setOpen} />
      <CategoriesDialog open={catsOpen} onOpenChange={setCatsOpen} />
    </Page>
  );
}

function ExpenseDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t } = useTranslation();
  const categories = useLiveQuery(() => db().expense_categories.filter((c) => c.active && !c.deleted_at).sortBy('name'), []);
  const [categoryId, setCategoryId] = useState<string>('');
  const [amount, setAmount] = useState<number | null>(null);
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [date, setDate] = useState(todayString());
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setAmount(null);
    setReference('');
    setNotes('');
    setFile(null);
    setErrors({});
    setDate(todayString());
  }, [open]);

  const save = async () => {
    const parsed = expenseSchema.safeParse({ category_id: categoryId || null, amount: amount ?? 0, payment_method: method, expense_date: date, reference: reference || null, notes: notes || null });
    if (!parsed.success) return setErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])));
    if (file && file.size > 5 * 1024 * 1024) return setErrors({ file: t('expense.file_size', 'Attachment must be under 5 MB.') });
    setSaving(true);
    try {
      const register = method === 'cash' ? await currentRegister() : undefined;
      await createExpense({ ...parsed.data, register_id: register?.id ?? null }, file);
      toast.success(t('expense.saved', 'Expense recorded'));
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange} dismissible={!saving} title={t('expense.new', 'New expense')} footer={<Button onClick={() => void save()} disabled={saving} data-testid="expense-save">{t('common.save', 'Save')}</Button>}>
      <FormGrid>
        <FormRow label={t('payment.amount', 'Amount')} htmlFor="ex-amount" error={errors.amount} required>
          <NumberInput id="ex-amount" autoFocus value={amount} onValueChange={setAmount} data-testid="expense-amount" />
        </FormRow>
        <FormRow label={t('expense.category', 'Category')} htmlFor="ex-cat">
          <Select value={categoryId} onValueChange={setCategoryId}>
            <SelectTrigger id="ex-cat" className="w-full">
              <SelectValue placeholder="—" />
            </SelectTrigger>
            <SelectContent>
              {(categories ?? []).map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormRow>
        <FormRow label={t('payment.method', 'Method')} htmlFor="ex-method">
          <Select value={method} onValueChange={(v) => setMethod(v as PaymentMethod)}>
            <SelectTrigger id="ex-method" className="w-full">
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
        <FormRow label={t('payment.date', 'Date')} htmlFor="ex-date" error={errors.expense_date}>
          <Input id="ex-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </FormRow>
        <FormRow label={t('payment.reference', 'Reference / transaction ID')} htmlFor="ex-ref">
          <Input id="ex-ref" value={reference} onChange={(e) => setReference(e.target.value)} />
        </FormRow>
        <FormRow label={t('expense.receipt', 'Receipt photo / PDF')} htmlFor="ex-file" error={errors.file} description={t('expense.receipt_hint', 'Stored on this device and uploaded when online.')}>
          <Input id="ex-file" type="file" accept="image/*,application/pdf" capture="environment" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </FormRow>
        <FormRow label={t('common.notes', 'Notes')} htmlFor="ex-notes" className="sm:col-span-2">
          <Textarea id="ex-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </FormRow>
      </FormGrid>
    </ResponsiveDialog>
  );
}

function CategoriesDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t } = useTranslation();
  const categories = useLiveQuery(() => db().expense_categories.filter((c) => !c.deleted_at).sortBy('name'), []);
  const [name, setName] = useState('');
  const add = async (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return;
    if ((categories ?? []).some((c) => c.name.toLowerCase() === trimmed.toLowerCase())) return toast.error(t('expense.cat_exists', 'Category already exists.'));
    await createExpenseCategory(trimmed);
    setName('');
  };
  const missing = EXPENSE_CATEGORIES.filter((c) => !(categories ?? []).some((x) => x.name.toLowerCase() === c.toLowerCase()));
  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange} title={t('expense.categories', 'Categories')}>
      <div className="space-y-3">
        <div className="flex gap-2">
          <Input value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void add(name)} placeholder={t('expense.cat_name', 'New category')} />
          <Button onClick={() => void add(name)}>
            <PlusIcon /> {t('common.add', 'Add')}
          </Button>
        </div>
        {missing.length ? (
          <div className="flex flex-wrap gap-1.5">
            {missing.map((m) => (
              <Button key={m} size="xs" variant="outline" onClick={() => void add(m)}>
                + {m}
              </Button>
            ))}
          </div>
        ) : null}
        <ul className="divide-y rounded-lg border">
          {(categories ?? []).map((c) => (
            <li key={c.id} className="flex items-center justify-between px-3 py-2 text-sm">
              {c.name}
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t('common.delete', 'Delete')}
                onClick={async () => {
                  const used = await db().expenses.filter((e) => e.category_id === c.id).count();
                  if (used) return toast.error(t('expense.cat_used', 'This category has expenses and cannot be deleted.'));
                  await deleteExpenseCategory(c.id);
                }}
              >
                <Trash2Icon />
              </Button>
            </li>
          ))}
        </ul>
      </div>
    </ResponsiveDialog>
  );
}
