import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLiveQuery } from 'dexie-react-hooks';
import { toast } from 'sonner';
import { HammerIcon, PlusIcon } from 'lucide-react';
import { PAYMENT_METHOD_LABELS, PURITIES, type Customer, type JewelleryOrder, type MetalType, type PaymentMethod } from '@shopdesk/shared';
import { db } from '@/lib/db/business';
import { useFormat } from '@/lib/format';
import { createJewelleryOrder, updateJewelleryOrder } from '@/lib/repos/industry';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DataTable, type Column } from '@/components/common/data-table';
import { FormGrid, FormRow } from '@/components/common/form';
import { NumberInput } from '@/components/common/number-input';
import { Page, PageHeader } from '@/components/common/page';
import { ResponsiveDialog } from '@/components/common/responsive-dialog';
import { CustomerPicker } from '@/features/pos/customer-picker';

const STATUSES: JewelleryOrder['status'][] = ['received', 'in_progress', 'ready', 'delivered', 'cancelled'];
const STATUS_LABEL: Record<JewelleryOrder['status'], string> = { received: 'Received', in_progress: 'In progress', ready: 'Ready', delivered: 'Delivered', cancelled: 'Cancelled' };

export default function JewelleryOrdersPage() {
  const { t } = useTranslation();
  const fmt = useFormat();
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('open');
  const orders = useLiveQuery(() => db().jewellery_orders.filter((o) => !o.deleted_at).reverse().sortBy('created_at'), []);
  const rows = (orders ?? []).filter((o) => (filter === 'open' ? o.status !== 'delivered' && o.status !== 'cancelled' : filter === 'all' ? true : o.status === filter));

  const setStatus = async (order: JewelleryOrder, status: JewelleryOrder['status']) => {
    try {
      await updateJewelleryOrder(order.id, { status, delivered_at: status === 'delivered' ? new Date().toISOString() : order.delivered_at });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };

  const columns: Column<JewelleryOrder>[] = [
    { id: 'number', header: t('jo.number', 'Order'), cell: (o) => <span className="font-medium">{o.order_number}</span>, value: (o) => o.order_number },
    { id: 'type', header: t('jo.type', 'Type'), cell: (o) => (o.type === 'repair' ? t('jo.repair', 'Repair') : t('jo.custom', 'Custom order')), value: (o) => o.type },
    { id: 'customer', header: t('sales.customer', 'Customer'), cell: (o) => `${o.customer_name}${o.customer_phone ? ` · ${o.customer_phone}` : ''}`, value: (o) => o.customer_name },
    { id: 'desc', header: t('jo.description', 'Description'), cell: (o) => o.description, value: (o) => o.description, hideOnMobile: true },
    { id: 'due', header: t('jo.due', 'Due'), cell: (o) => (o.due_date ? fmt.date(o.due_date) : '—'), value: (o) => o.due_date ?? '' },
    { id: 'amount', header: t('jo.estimate', 'Estimate / advance'), cell: (o) => `${fmt.money(o.estimated_amount)} / ${fmt.money(o.advance_paid)}`, value: (o) => o.estimated_amount, align: 'right', hideOnMobile: true },
    {
      id: 'status',
      header: t('sales.status', 'Status'),
      cell: (o) =>
        o.status === 'delivered' || o.status === 'cancelled' ? (
          <Badge variant="outline">{STATUS_LABEL[o.status]}</Badge>
        ) : (
          <select className="h-7 rounded-md border bg-background px-1 text-xs" value={o.status} onClick={(e) => e.stopPropagation()} onChange={(e) => void setStatus(o, e.target.value as JewelleryOrder['status'])}>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        ),
      value: (o) => o.status,
    },
  ];

  return (
    <Page>
      <PageHeader
        title={t('jo.title', 'Repairs & custom orders')}
        actions={
          <Button onClick={() => setOpen(true)}>
            <PlusIcon /> {t('jo.new', 'New order')}
          </Button>
        }
      />
      <DataTable
        data={orders ? rows : undefined}
        columns={columns}
        rowKey={(o) => o.id}
        searchText={(o) => `${o.order_number} ${o.customer_name} ${o.customer_phone ?? ''} ${o.description}`}
        exportName="jewellery-orders"
        toolbar={
          <Select value={filter} onValueChange={setFilter}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="open">{t('jo.open', 'Open orders')}</SelectItem>
              {STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {STATUS_LABEL[s]}
                </SelectItem>
              ))}
              <SelectItem value="all">{t('purchase.f_all', 'All')}</SelectItem>
            </SelectContent>
          </Select>
        }
        empty={{ icon: HammerIcon, title: t('jo.empty', 'No orders') }}
      />
      <OrderDialog open={open} onOpenChange={setOpen} />
    </Page>
  );
}

function OrderDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t } = useTranslation();
  const [pickOpen, setPickOpen] = useState(false);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [type, setType] = useState<'repair' | 'custom'>('repair');
  const [description, setDescription] = useState('');
  const [purity, setPurity] = useState('22K');
  const [weight, setWeight] = useState<number | null>(null);
  const [estimate, setEstimate] = useState<number | null>(null);
  const [advance, setAdvance] = useState<number | null>(null);
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [due, setDue] = useState('');
  const [notes, setNotes] = useState('');

  const save = async () => {
    const customerName = customer?.name ?? name.trim();
    if (!customerName) return toast.error(t('jo.need_customer', 'Enter the customer name.'));
    if (!description.trim()) return toast.error(t('jo.need_desc', 'Describe the item / work.'));
    if ((advance ?? 0) > (estimate ?? 0) && estimate) return toast.error(t('jo.advance_high', 'Advance is more than the estimate.'));
    try {
      const metal = (PURITIES.find((p) => p.code === purity)?.metal ?? 'gold') as MetalType;
      await createJewelleryOrder({
        type,
        customer_id: customer?.id ?? null,
        customer_name: customerName,
        customer_phone: customer?.phone ?? (phone.trim() || null),
        description: description.trim(),
        metal,
        purity,
        weight,
        estimated_amount: estimate ?? 0,
        advance_paid: advance ?? 0,
        advance_method: advance ? method : null,
        due_date: due || null,
        status: 'received',
        notes: notes.trim() || null,
      });
      toast.success(t('jo.saved', 'Order created'));
      onOpenChange(false);
      setCustomer(null);
      setName('');
      setPhone('');
      setDescription('');
      setWeight(null);
      setEstimate(null);
      setAdvance(null);
      setNotes('');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange} size="lg" title={t('jo.new', 'New order')} footer={<Button onClick={() => void save()}>{t('common.save', 'Save')}</Button>}>
      <FormGrid>
        <FormRow label={t('sales.customer', 'Customer')} required className="sm:col-span-2">
          {customer ? (
            <div className="flex items-center gap-2 text-sm">
              <span className="font-medium">{customer.name}</span> {customer.phone}
              <Button size="xs" variant="ghost" onClick={() => setCustomer(null)}>
                {t('common.change', 'Change')}
              </Button>
            </div>
          ) : (
            <div className="flex gap-2">
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('customer.name', 'Name')} />
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder={t('customer.phone', 'Phone')} />
              <Button variant="outline" onClick={() => setPickOpen(true)}>
                {t('jo.pick', 'Pick')}
              </Button>
            </div>
          )}
        </FormRow>
        <FormRow label={t('jo.type', 'Type')}>
          <select className="h-8 w-full rounded-lg border bg-background px-2 text-sm" value={type} onChange={(e) => setType(e.target.value as 'repair' | 'custom')}>
            <option value="repair">{t('jo.repair', 'Repair')}</option>
            <option value="custom">{t('jo.custom', 'Custom order')}</option>
          </select>
        </FormRow>
        <FormRow label={t('jewellery.purity', 'Purity')}>
          <select className="h-8 w-full rounded-lg border bg-background px-2 text-sm" value={purity} onChange={(e) => setPurity(e.target.value)}>
            {PURITIES.map((p) => (
              <option key={p.code} value={p.code}>
                {p.label}
              </option>
            ))}
          </select>
        </FormRow>
        <FormRow label={t('jo.description', 'Description')} className="sm:col-span-2" required>
          <Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
        </FormRow>
        <FormRow label={t('jewellery.gross_weight', 'Gross weight (g)')}>
          <NumberInput decimals={3} value={weight} onValueChange={setWeight} />
        </FormRow>
        <FormRow label={t('jo.due', 'Due')}>
          <Input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
        </FormRow>
        <FormRow label={t('jo.estimate_amt', 'Estimated amount')}>
          <NumberInput value={estimate} onValueChange={setEstimate} />
        </FormRow>
        <FormRow label={t('jo.advance', 'Advance received')}>
          <div className="flex gap-2">
            <NumberInput value={advance} onValueChange={setAdvance} />
            <select className="h-8 rounded-lg border bg-background px-2 text-sm" value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
              {(['cash', 'upi', 'card', 'bank_transfer'] as PaymentMethod[]).map((m) => (
                <option key={m} value={m}>
                  {PAYMENT_METHOD_LABELS[m]}
                </option>
              ))}
            </select>
          </div>
        </FormRow>
        <FormRow label={t('common.notes', 'Notes')} className="sm:col-span-2">
          <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </FormRow>
      </FormGrid>
      <CustomerPicker open={pickOpen} onOpenChange={setPickOpen} onPick={setCustomer} />
    </ResponsiveDialog>
  );
}
