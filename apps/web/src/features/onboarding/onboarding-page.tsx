import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslation } from 'react-i18next';
import { ArrowLeftIcon, ArrowRightIcon, CheckCircle2Icon, PackagePlusIcon, PercentIcon, ShoppingCartIcon, UploadIcon, UsersIcon } from 'lucide-react';
import {
  ALL_PERMISSIONS,
  BUSINESS_TYPE_DEFS,
  BUSINESS_TYPES,
  COUNTRY_PRESETS,
  INDIAN_STATES,
  businessSchema,
  type Business,
  type BusinessInput,
  type BusinessType,
} from '@shopdesk/shared';
import { cn } from '@/lib/utils';
import { apiData, errorMessage, ApiError, NetworkError } from '@/lib/api';
import { useSession } from '@/stores/session';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { FormGrid, FormRow, SelectField } from '@/components/common/form';
import { BUSINESS_ICONS } from './business-icons';

type Step = 'type' | 'details' | 'done';

export default function OnboardingPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { addMembership, selectBusiness, account } = useSession();
  const [step, setStep] = useState<Step>('type');
  const [error, setError] = useState<string | null>(null);
  const form = useForm<BusinessInput>({
    resolver: zodResolver(businessSchema),
    defaultValues: {
      name: '',
      business_type: 'general',
      country: 'IN',
      currency: 'INR',
      timezone: 'Asia/Kolkata',
      tax_system: 'gst',
      gstin: null,
      state_code: '32',
      address: null,
      city: null,
      pincode: null,
      phone: account?.phone ?? null,
      email: account?.email ?? null,
    },
  });
  const type = form.watch('business_type');
  const country = form.watch('country');
  const errors = form.formState.errors;

  const chooseCountry = (code: string) => {
    const preset = COUNTRY_PRESETS[code];
    form.setValue('country', code);
    if (preset) {
      form.setValue('currency', preset.currency);
      form.setValue('timezone', preset.timezone);
      form.setValue('tax_system', preset.taxSystem);
    }
    if (code !== 'IN') form.setValue('state_code', null);
  };

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      const result = await apiData<{ business: Business; role_key: string }>('/businesses', {
        body: { ...values, state_code: values.gstin ? values.gstin.slice(0, 2) : values.state_code },
      });
      await addMembership({ business: result.business, role_key: 'owner', role_name: 'Owner', permissions: [...ALL_PERMISSIONS], store_ids: null });
      await selectBusiness(result.business.id);
      setStep('done');
    } catch (e) {
      if (e instanceof ApiError && Object.keys(e.errors).length) {
        for (const [field, messages] of Object.entries(e.errors)) form.setError(field as keyof BusinessInput, { message: messages[0] });
        setError(e.message);
      } else if (e instanceof NetworkError) {
        setError(t('onboarding.needs_internet', 'Creating a business needs an internet connection once. After that the app works offline.'));
      } else {
        setError(errorMessage(e));
      }
    }
  });

  return (
    <div className="min-h-dvh bg-muted/30">
      <div className="mx-auto max-w-4xl px-4 py-8 sm:py-14">
        {step === 'type' ? (
          <>
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{t('onboarding.welcome', 'Welcome! What kind of business do you run?')}</h1>
            <p className="mt-1 text-muted-foreground">{t('onboarding.type_hint', 'We set up sensible defaults — units, taxes, categories and modules. You can change everything later.')}</p>
            <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3" role="radiogroup">
              {BUSINESS_TYPES.map((value: BusinessType) => {
                const def = BUSINESS_TYPE_DEFS[value];
                const Icon = BUSINESS_ICONS[value];
                const selected = type === value;
                return (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    data-testid={`business-type-${value}`}
                    onClick={() => form.setValue('business_type', value)}
                    className={cn('flex items-start gap-3 rounded-xl border bg-card p-4 text-left transition hover:border-primary/60 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none', selected && 'border-primary ring-2 ring-primary/30')}
                  >
                    <span className={cn('flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted', selected && 'bg-primary text-primary-foreground')}>
                      <Icon className="size-5" />
                    </span>
                    <span>
                      <span className="block font-medium">{def.label}</span>
                      <span className="block text-xs text-muted-foreground">{def.description}</span>
                    </span>
                  </button>
                );
              })}
            </div>
            <div className="mt-6 flex justify-end">
              <Button size="lg" onClick={() => setStep('details')}>
                {t('common.continue', 'Continue')} <ArrowRightIcon />
              </Button>
            </div>
          </>
        ) : step === 'details' ? (
          <form onSubmit={onSubmit} noValidate className="rounded-2xl border bg-card p-5 shadow-sm sm:p-8">
            <h1 className="text-2xl font-semibold tracking-tight">{t('onboarding.create_business', 'Create your business')}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{BUSINESS_TYPE_DEFS[type].label}</p>
            <div className="mt-6 space-y-4">
              <FormRow label={t('onboarding.business_name', 'Business name')} htmlFor="name" error={errors.name?.message} required>
                <Input id="name" autoFocus {...form.register('name')} placeholder="FreshMart Supermarket" />
              </FormRow>
              <FormGrid>
                <FormRow label={t('onboarding.country', 'Country')} htmlFor="country">
                  <select id="country" className="h-9 w-full rounded-lg border bg-background px-2.5 text-sm" value={country} onChange={(e) => chooseCountry(e.target.value)}>
                    <option value="IN">India</option>
                    <option value="AE">United Arab Emirates</option>
                    <option value="GB">United Kingdom</option>
                    <option value="US">United States</option>
                    <option value="SG">Singapore</option>
                  </select>
                </FormRow>
                <SelectField
                  control={form.control}
                  name="tax_system"
                  label={t('onboarding.tax_system', 'Tax system')}
                  options={[
                    { value: 'gst', label: 'GST (India)' },
                    { value: 'vat', label: 'VAT' },
                    { value: 'simple', label: t('onboarding.sales_tax', 'Sales tax') },
                    { value: 'none', label: t('onboarding.no_tax', 'No tax') },
                  ]}
                />
                <FormRow label={t('onboarding.currency', 'Currency')} htmlFor="currency">
                  <Input id="currency" {...form.register('currency')} maxLength={3} className="uppercase" />
                </FormRow>
                <FormRow label={t('onboarding.timezone', 'Timezone')} htmlFor="timezone">
                  <Input id="timezone" {...form.register('timezone')} />
                </FormRow>
                {country === 'IN' ? (
                  <>
                    <SelectField control={form.control} name="state_code" label={t('onboarding.state', 'State')} options={INDIAN_STATES.map((s) => ({ value: s.code, label: `${s.name} (${s.code})` }))} />
                    <FormRow label="GSTIN" htmlFor="gstin" error={errors.gstin?.message} description={t('onboarding.gstin_hint', 'Optional. Leave empty if not registered.')}>
                      <Input id="gstin" className="uppercase" maxLength={15} {...form.register('gstin', { setValueAs: (v) => (v ? String(v).toUpperCase() : null) })} />
                    </FormRow>
                  </>
                ) : null}
                <FormRow label={t('common.phone', 'Phone')} htmlFor="phone" error={errors.phone?.message}>
                  <Input id="phone" type="tel" {...form.register('phone', { setValueAs: (v) => v || null })} />
                </FormRow>
                <FormRow label={t('common.email', 'Email')} htmlFor="email" error={errors.email?.message}>
                  <Input id="email" type="email" {...form.register('email', { setValueAs: (v) => v || null })} />
                </FormRow>
              </FormGrid>
              <FormRow label={t('common.address', 'Address')} htmlFor="address">
                <Input id="address" {...form.register('address', { setValueAs: (v) => v || null })} />
              </FormRow>
              <FormGrid>
                <FormRow label={t('common.city', 'City')} htmlFor="city">
                  <Input id="city" {...form.register('city', { setValueAs: (v) => v || null })} />
                </FormRow>
                <FormRow label={t('common.pincode', 'PIN code')} htmlFor="pincode">
                  <Input id="pincode" inputMode="numeric" {...form.register('pincode', { setValueAs: (v) => v || null })} />
                </FormRow>
              </FormGrid>
            </div>
            {error ? (
              <p role="alert" className="mt-4 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                {error}
              </p>
            ) : null}
            <div className="mt-6 flex justify-between">
              <Button type="button" variant="ghost" onClick={() => setStep('type')}>
                <ArrowLeftIcon /> {t('common.back', 'Back')}
              </Button>
              <Button type="submit" size="lg" disabled={form.formState.isSubmitting} data-testid="create-business">
                {form.formState.isSubmitting ? <Spinner /> : null}
                {t('onboarding.create', 'Create business')}
              </Button>
            </div>
          </form>
        ) : (
          <div className="rounded-2xl border bg-card p-6 text-center shadow-sm sm:p-10">
            <CheckCircle2Icon className="mx-auto size-12 text-success" />
            <h1 className="mt-4 text-2xl font-semibold">{t('onboarding.ready', 'Your business is ready')}</h1>
            <p className="mt-1 text-muted-foreground">{t('onboarding.next_steps', 'A few next steps to get selling:')}</p>
            <div className="mx-auto mt-6 grid max-w-2xl gap-3 sm:grid-cols-2">
              {[
                { to: '/products/new', icon: PackagePlusIcon, label: t('onboarding.add_products', 'Add products') },
                { to: '/settings/import', icon: UploadIcon, label: t('onboarding.import_products', 'Import products (CSV)') },
                { to: '/catalog?tab=taxes', icon: PercentIcon, label: t('onboarding.configure_tax', 'Configure tax') },
                { to: '/employees', icon: UsersIcon, label: t('onboarding.create_users', 'Create users') },
              ].map((item) => (
                <Link key={item.to} to={item.to} className="flex items-center gap-3 rounded-xl border p-4 text-left hover:border-primary/60 hover:bg-muted/40">
                  <item.icon className="size-5 text-primary" />
                  <span className="font-medium">{item.label}</span>
                </Link>
              ))}
            </div>
            <Button size="lg" className="mt-6" onClick={() => navigate('/pos')}>
              <ShoppingCartIcon /> {t('onboarding.open_pos', 'Open POS')}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
