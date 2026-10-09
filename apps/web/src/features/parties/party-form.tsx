import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useForm, type Resolver } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { customerSchema, INDIAN_STATES, supplierSchema, type Customer, type CustomerInput, type Supplier, type SupplierInput } from '@shopdesk/shared';
import { db } from '@/lib/db/business';
import { runtime } from '@/lib/runtime';
import { createCustomer, createSupplier, updateCustomer, updateSupplier } from '@/lib/repos/parties';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { FormGrid, FormRow, NumberField, SelectField, SwitchField } from '@/components/common/form';
import { ResponsiveDialog } from '@/components/common/responsive-dialog';

const STATE_OPTIONS = INDIAN_STATES.map((s) => ({ value: s.code, label: `${s.name} (${s.code})` }));
const blank = (v: string) => (v === '' ? null : v);

export function CustomerFormDialog({ open, onOpenChange, customer, onSaved }: { open: boolean; onOpenChange: (o: boolean) => void; customer: Customer | null; onSaved?: (c: Customer) => void }) {
  const { t } = useTranslation();
  const form = useForm<CustomerInput>({ resolver: zodResolver(customerSchema) as unknown as Resolver<CustomerInput> });
  const { register, control, handleSubmit, reset, formState, setError } = form;

  useEffect(() => {
    if (!open) return;
    reset(
      customer
        ? { name: customer.name, phone: customer.phone, email: customer.email, address: customer.address, city: customer.city, state_code: customer.state_code, pincode: customer.pincode, gstin: customer.gstin, credit_limit: customer.credit_limit, opening_balance: customer.opening_balance, tier: customer.tier, notes: customer.notes, date_of_birth: customer.date_of_birth, active: customer.active }
        : { name: '', phone: null, email: null, address: null, city: null, state_code: runtime().stateCode, pincode: null, gstin: null, credit_limit: 0, opening_balance: 0, tier: null, notes: null, date_of_birth: null, active: true },
    );
  }, [open, customer, reset]);

  const submit = handleSubmit(async (values) => {
    if (values.phone) {
      const clash = await db().customers.where('phone').equals(values.phone).filter((c) => c.id !== customer?.id && !c.deleted_at).first();
      if (clash) return setError('phone', { message: t('customer.phone_taken', 'Already used by {{name}}', { name: clash.name }) });
    }
    try {
      if (customer) {
        await updateCustomer(customer.id, values);
        onSaved?.({ ...customer, ...values });
      } else {
        onSaved?.(await createCustomer(values));
      }
      toast.success(t('customer.saved', 'Customer saved'));
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  });
  const e = formState.errors;

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title={customer ? t('customer.edit', 'Edit customer') : t('customer.new', 'New customer')}
      footer={
        <Button onClick={() => void submit()} disabled={formState.isSubmitting} data-testid="customer-form-save">
          {t('common.save', 'Save')}
        </Button>
      }
    >
      <form onSubmit={(ev) => (ev.preventDefault(), void submit())}>
        <FormGrid>
          <FormRow label={t('customer.name', 'Name')} htmlFor="cf-name" error={e.name?.message} required>
            <Input id="cf-name" autoFocus {...register('name')} />
          </FormRow>
          <FormRow label={t('customer.phone', 'Phone')} htmlFor="cf-phone" error={e.phone?.message}>
            <Input id="cf-phone" inputMode="tel" {...register('phone', { setValueAs: blank })} />
          </FormRow>
          <FormRow label={t('customer.email', 'Email')} htmlFor="cf-email" error={e.email?.message}>
            <Input id="cf-email" type="email" {...register('email', { setValueAs: blank })} />
          </FormRow>
          <FormRow label="GSTIN" htmlFor="cf-gstin" error={e.gstin?.message}>
            <Input id="cf-gstin" className="uppercase" {...register('gstin', { setValueAs: blank })} />
          </FormRow>
          <FormRow label={t('customer.address', 'Address')} htmlFor="cf-addr" className="sm:col-span-2">
            <Textarea id="cf-addr" rows={2} {...register('address', { setValueAs: blank })} />
          </FormRow>
          <FormRow label={t('customer.city', 'City')} htmlFor="cf-city">
            <Input id="cf-city" {...register('city', { setValueAs: blank })} />
          </FormRow>
          <SelectField control={control} name="state_code" label={t('customer.state', 'State')} nullable placeholder="—" options={STATE_OPTIONS} description={t('customer.state_hint', 'Decides CGST+SGST or IGST.')} />
          <FormRow label={t('customer.pincode', 'PIN code')} htmlFor="cf-pin">
            <Input id="cf-pin" inputMode="numeric" {...register('pincode', { setValueAs: blank })} />
          </FormRow>
          <FormRow label={t('customer.dob', 'Birthday')} htmlFor="cf-dob">
            <Input id="cf-dob" type="date" {...register('date_of_birth', { setValueAs: blank })} />
          </FormRow>
          <NumberField control={control} name="credit_limit" label={t('customer.credit_limit', 'Credit limit')} description={t('customer.credit_limit_hint', '0 = no limit')} />
          <NumberField control={control} name="opening_balance" label={t('customer.opening', 'Opening balance (receivable)')} allowNegative />
          <FormRow label={t('customer.tier', 'Group / tier')} htmlFor="cf-tier">
            <Input id="cf-tier" {...register('tier', { setValueAs: blank })} placeholder="Retail, Wholesale, VIP…" />
          </FormRow>
          <FormRow label={t('common.notes', 'Notes')} htmlFor="cf-notes" className="sm:col-span-2">
            <Textarea id="cf-notes" rows={2} {...register('notes', { setValueAs: blank })} />
          </FormRow>
          <SwitchField control={control} name="active" label={t('product.active_label', 'Active')} />
        </FormGrid>
      </form>
    </ResponsiveDialog>
  );
}

export function SupplierFormDialog({ open, onOpenChange, supplier, onSaved }: { open: boolean; onOpenChange: (o: boolean) => void; supplier: Supplier | null; onSaved?: (s: Supplier) => void }) {
  const { t } = useTranslation();
  const form = useForm<SupplierInput>({ resolver: zodResolver(supplierSchema) as unknown as Resolver<SupplierInput> });
  const { register, control, handleSubmit, reset, formState } = form;

  useEffect(() => {
    if (!open) return;
    reset(
      supplier
        ? { name: supplier.name, phone: supplier.phone, email: supplier.email, address: supplier.address, city: supplier.city, state_code: supplier.state_code, gstin: supplier.gstin, opening_balance: supplier.opening_balance, credit_days: supplier.credit_days, notes: supplier.notes, active: supplier.active }
        : { name: '', phone: null, email: null, address: null, city: null, state_code: runtime().stateCode, gstin: null, opening_balance: 0, credit_days: 0, notes: null, active: true },
    );
  }, [open, supplier, reset]);

  const submit = handleSubmit(async (values) => {
    try {
      if (supplier) {
        // The opening balance is a ledger entry created once; later corrections are ledger adjustments.
        const { opening_balance: _ob, ...rest } = values;
        await updateSupplier(supplier.id, rest);
        onSaved?.({ ...supplier, ...rest });
      } else {
        onSaved?.(await createSupplier(values));
      }
      toast.success(t('supplier.saved', 'Supplier saved'));
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  });
  const e = formState.errors;

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title={supplier ? t('supplier.edit', 'Edit supplier') : t('supplier.new', 'New supplier')}
      footer={
        <Button onClick={() => void submit()} disabled={formState.isSubmitting}>
          {t('common.save', 'Save')}
        </Button>
      }
    >
      <form onSubmit={(ev) => (ev.preventDefault(), void submit())}>
        <FormGrid>
          <FormRow label={t('supplier.name', 'Name')} htmlFor="sf-name" error={e.name?.message} required>
            <Input id="sf-name" autoFocus {...register('name')} />
          </FormRow>
          <FormRow label={t('customer.phone', 'Phone')} htmlFor="sf-phone" error={e.phone?.message}>
            <Input id="sf-phone" inputMode="tel" {...register('phone', { setValueAs: blank })} />
          </FormRow>
          <FormRow label={t('customer.email', 'Email')} htmlFor="sf-email" error={e.email?.message}>
            <Input id="sf-email" type="email" {...register('email', { setValueAs: blank })} />
          </FormRow>
          <FormRow label="GSTIN" htmlFor="sf-gstin" error={e.gstin?.message}>
            <Input id="sf-gstin" className="uppercase" {...register('gstin', { setValueAs: blank })} />
          </FormRow>
          <FormRow label={t('customer.address', 'Address')} htmlFor="sf-addr" className="sm:col-span-2">
            <Textarea id="sf-addr" rows={2} {...register('address', { setValueAs: blank })} />
          </FormRow>
          <FormRow label={t('customer.city', 'City')} htmlFor="sf-city">
            <Input id="sf-city" {...register('city', { setValueAs: blank })} />
          </FormRow>
          <SelectField control={control} name="state_code" label={t('customer.state', 'State')} nullable placeholder="—" options={STATE_OPTIONS} />
          <NumberField control={control} name="credit_days" label={t('supplier.credit_days', 'Credit days')} decimals={0} />
          {!supplier ? <NumberField control={control} name="opening_balance" label={t('supplier.opening', 'Opening balance (payable)')} allowNegative /> : null}
          <FormRow label={t('common.notes', 'Notes')} htmlFor="sf-notes" className="sm:col-span-2">
            <Textarea id="sf-notes" rows={2} {...register('notes', { setValueAs: blank })} />
          </FormRow>
          <SwitchField control={control} name="active" label={t('product.active_label', 'Active')} />
        </FormGrid>
      </form>
    </ResponsiveDialog>
  );
}
