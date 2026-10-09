import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useLiveQuery } from 'dexie-react-hooks';
import { Controller, useFieldArray, useForm, useWatch, type Control, type Resolver } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { BarcodeIcon, PackageIcon, PlusIcon, SaveIcon, TagIcon, Trash2Icon } from 'lucide-react';
import {
  BUSINESS_TYPE_DEFS,
  generateInternalEan13,
  PURITIES,
  productSchema,
  uuidv7,
  type BusinessType,
  type ModuleKey,
  type ProductInput,
} from '@shopdesk/shared';
import { db, getMeta, setMeta, type LocalProduct } from '@/lib/db/business';
import { runtime } from '@/lib/runtime';
import { createBatch, createProduct, deleteProduct, updateProduct } from '@/lib/repos/catalog';
import { adjustStock, type AdjustmentLine } from '@/lib/repos/inventory';
import { useBusiness, useCan, useModules } from '@/hooks/use-app';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { confirm } from '@/components/common/confirm';
import { FormGrid, FormRow, NumberField, SelectField, SwitchField } from '@/components/common/form';
import { NumberInput } from '@/components/common/number-input';
import { EmptyState, LoadingRows, Page, PageHeader, Section } from '@/components/common/page';
import { VariantEditor } from './variant-editor';
import { BatchesSection } from './batches-section';
import { LabelsDialog } from './labels-dialog';

function defaults(type: BusinessType | undefined, taxId: string | null, unitId: string | null): ProductInput {
  const def = type ? BUSINESS_TYPE_DEFS[type] : undefined;
  return {
    name: '',
    product_type: type === 'service' ? 'service' : type === 'jewellery' ? 'jewellery' : 'standard',
    sku: null,
    barcode: null,
    barcodes: [],
    plu_code: null,
    category_id: null,
    brand_id: null,
    unit_id: unitId,
    description: null,
    hsn_code: null,
    purchase_price: 0,
    selling_price: 0,
    mrp: null,
    min_selling_price: null,
    tax_rate_id: taxId,
    price_includes_tax: def?.pricesIncludeTax ?? true,
    reorder_level: 0,
    track_inventory: type !== 'service',
    track_batch: type === 'pharmacy',
    track_serial: type === 'mobile',
    track_expiry: type === 'pharmacy',
    has_variants: false,
    variant_attributes: [],
    variants: [],
    attributes: type === 'jewellery' ? { metal: 'gold', purity: '22K', making_charge_type: 'per_gram', wastage_type: 'percent' } : {},
    custom_fields: {},
    modifiers: [],
    price_tiers: [],
    warranty_months: null,
    image_url: null,
    active: true,
  };
}

function toInput(p: LocalProduct): ProductInput {
  return {
    name: p.name,
    product_type: p.product_type,
    sku: p.sku,
    barcode: p.barcode,
    barcodes: p.barcodes ?? [],
    plu_code: p.plu_code,
    category_id: p.category_id,
    brand_id: p.brand_id,
    unit_id: p.unit_id,
    description: p.description,
    hsn_code: p.hsn_code,
    purchase_price: p.purchase_price,
    selling_price: p.selling_price,
    mrp: p.mrp,
    min_selling_price: p.min_selling_price,
    tax_rate_id: p.tax_rate_id,
    price_includes_tax: p.price_includes_tax,
    reorder_level: p.reorder_level,
    track_inventory: p.track_inventory,
    track_batch: p.track_batch,
    track_serial: p.track_serial,
    track_expiry: p.track_expiry,
    has_variants: p.has_variants,
    variant_attributes: p.variant_attributes ?? [],
    variants: (p.variants ?? []).map(({ product_id: _pid, ...v }) => v),
    attributes: p.attributes ?? {},
    custom_fields: p.custom_fields ?? {},
    modifiers: p.modifiers ?? [],
    price_tiers: p.price_tiers ?? [],
    warranty_months: p.warranty_months,
    image_url: p.image_url,
    active: p.active,
  };
}

/** Offline-safe internal EAN-13: prefix 2 + 2-digit device number + 9-digit device sequence. */
async function nextInternalBarcode(): Promise<string> {
  const seq = ((await getMeta<number>('barcode_seq')) ?? 0) + 1;
  await setMeta('barcode_seq', seq);
  const deviceNo = Number(runtime().deviceCode.replace(/\D/g, '') || '0') % 100;
  return generateInternalEan13(Number(`${String(deviceNo).padStart(2, '0')}${String(seq).padStart(9, '0')}`), '2');
}

export default function ProductFormPage() {
  const { id } = useParams();
  const { t } = useTranslation();
  const result = useLiveQuery(async () => ({ product: id ? ((await db().products.get(id)) ?? null) : null }), [id]);
  if (!result) {
    return (
      <Page>
        <LoadingRows />
      </Page>
    );
  }
  if (id && !result.product) {
    return (
      <Page>
        <EmptyState icon={PackageIcon} title={t('product.not_found', 'Product not found')} />
      </Page>
    );
  }
  return <ProductForm key={id ?? 'new'} product={result.product} />;
}

function ProductForm({ product }: { product: LocalProduct | null }) {
  const navigate = useNavigate();
  const can = useCan();
  const hasModule = useModules();
  const business = useBusiness();
  const isNew = !product;
  const readOnly = isNew ? !can('products.create') : !can('products.edit');
  const lookups = useLiveQuery(async () => {
    const [categories, brands, units, taxes] = await Promise.all([
      db().categories.filter((c) => !c.deleted_at && c.active).sortBy('name'),
      db().brands.filter((b) => !b.deleted_at && b.active).sortBy('name'),
      db().units.filter((u) => !u.deleted_at).sortBy('code'),
      db().tax_rates.filter((x) => !x.deleted_at && x.active).toArray(),
    ]);
    return { categories, brands, units, taxes };
  }, []);

  const initial = useMemo(
    () => (product ? toInput(product) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [product?.id],
  );
  if (!lookups || (!initial && !business)) return <LoadingRows />;
  const start =
    initial ??
    defaults(
      business?.business_type,
      lookups.taxes.find((x) => x.is_default)?.id ?? null,
      lookups.units.find((u) => u.code === 'PCS')?.id ?? lookups.units[0]?.id ?? null,
    );
  return <ProductFormInner product={product} initial={start} lookups={lookups} readOnly={readOnly} hasModule={hasModule} businessType={business?.business_type} onDone={(id) => navigate(id ? `/products/${id}` : '/products')} />;
}

interface Lookups {
  categories: Array<{ id: string; name: string }>;
  brands: Array<{ id: string; name: string }>;
  units: Array<{ id: string; code: string; name: string }>;
  taxes: Array<{ id: string; name: string }>;
}

function ProductFormInner({
  product,
  initial,
  lookups,
  readOnly,
  hasModule,
  businessType,
  onDone,
}: {
  product: LocalProduct | null;
  initial: ProductInput;
  lookups: Lookups;
  readOnly: boolean;
  hasModule: (m: ModuleKey) => boolean;
  businessType: BusinessType | undefined;
  onDone: (id: string | null) => void;
}) {
  const { t } = useTranslation();
  const can = useCan();
  const isNew = !product;
  const [productId] = useState(() => product?.id ?? uuidv7());
  const [opening, setOpening] = useState<number | null>(null);
  const [openingBatch, setOpeningBatch] = useState({ batch_no: '', expiry_date: '' });
  const [variantOpening, setVariantOpening] = useState<Record<string, number | null>>({});
  const [labelsOpen, setLabelsOpen] = useState(false);
  const [extraBarcode, setExtraBarcode] = useState('');
  const [saving, setSaving] = useState(false);

  const form = useForm<ProductInput>({ resolver: zodResolver(productSchema) as unknown as Resolver<ProductInput>, defaultValues: initial, mode: 'onBlur' });
  const { control, register, handleSubmit, setValue, formState, setError } = form;
  const [productType, hasVariants, trackInventory, trackBatch, trackSerial, barcodes] = useWatch({ control, name: ['product_type', 'has_variants', 'track_inventory', 'track_batch', 'track_serial', 'barcodes'] });
  const tiers = useFieldArray({ control, name: 'price_tiers' });
  const modifiers = useFieldArray({ control, name: 'modifiers', keyName: 'key' });
  const tracked = trackInventory && productType !== 'service';
  const errors = formState.errors;

  const submit = handleSubmit(async (values) => {
    // Codes must be unique within the business (checked locally; the server re-checks on sync).
    const codes = [values.barcode, values.sku, values.plu_code, ...values.barcodes, ...values.variants.flatMap((v) => [v.barcode, v.sku])].filter((c): c is string => !!c).map((c) => c.toLowerCase());
    const dupesInForm = codes.filter((c, i) => codes.indexOf(c) !== i);
    if (dupesInForm.length) {
      toast.error(t('product.dup_codes_form', 'The code {{code}} is used twice in this product.', { code: dupesInForm[0] }));
      return;
    }
    for (const code of codes) {
      const other = await db().products.where('codes').equals(code).filter((p) => p.id !== productId && !p.deleted_at).first();
      if (other) {
        if (code === values.barcode?.toLowerCase()) setError('barcode', { message: t('product.code_taken', 'Already used by {{name}}', { name: other.name }) });
        toast.error(t('product.code_taken_toast', '“{{code}}” is already used by {{name}}.', { code, name: other.name }));
        return;
      }
    }
    const payload: ProductInput = {
      ...values,
      track_expiry: values.track_batch ? values.track_expiry : false,
      has_variants: values.has_variants && values.variants.length > 0,
      variants: values.has_variants ? values.variants.map((v, i) => ({ ...v, sort_order: i })) : [],
      variant_attributes: values.has_variants ? values.variant_attributes : [],
      track_inventory: values.product_type === 'service' ? false : values.track_inventory,
    };
    setSaving(true);
    try {
      if (isNew) {
        const created = await createProduct(payload, productId);
        // Opening stock is an inventory movement (ledger), never a number typed into the product.
        if (payload.track_inventory && !payload.track_serial) {
          const lines: AdjustmentLine[] = [];
          if (payload.has_variants) {
            for (const v of payload.variants) {
              const qty = variantOpening[v.id];
              if (qty) lines.push({ product_id: created.id, variant_id: v.id, batch_id: null, quantity: qty, unit_cost: v.purchase_price ?? payload.purchase_price });
            }
          } else if (opening) {
            let batchId: string | null = null;
            if (payload.track_batch) {
              const batch = await createBatch({
                product_id: created.id,
                variant_id: null,
                batch_no: openingBatch.batch_no.trim() || 'OPENING',
                expiry_date: openingBatch.expiry_date || null,
                mfg_date: null,
                mrp: payload.mrp,
                purchase_price: payload.purchase_price,
                selling_price: payload.selling_price,
              });
              batchId = batch.id;
            }
            lines.push({ product_id: created.id, variant_id: null, batch_id: batchId, quantity: opening, unit_cost: payload.purchase_price });
          }
          if (lines.length) await adjustStock('opening_stock', lines, 'Opening stock');
        }
        toast.success(t('product.created', 'Product created'));
        onDone(null);
      } else {
        await updateProduct(productId, payload);
        toast.success(t('product.saved', 'Product saved'));
        form.reset(payload);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  });

  const remove = async () => {
    const { confirmed } = await confirm({ title: t('product.delete_title', 'Delete {{name}}?', { name: product!.name }), description: t('product.delete_hint', 'Past invoices keep their item details. The product can no longer be sold.'), destructive: true, confirmLabel: t('common.delete', 'Delete') });
    if (!confirmed) return;
    await deleteProduct(productId);
    toast.success(t('product.deleted', 'Product deleted'));
    onDone(null);
  };

  const jewellery = productType === 'jewellery';
  const pharmacy = hasModule('prescription') || businessType === 'pharmacy';
  const devices = businessType === 'mobile' || businessType === 'electronics';
  const clothing = businessType === 'clothing';

  return (
    <Page className="max-w-5xl">
      <PageHeader
        back="/products"
        title={isNew ? t('product.new', 'New product') : (product?.name ?? '')}
        description={!isNew && product?._pending ? t('product.unsynced', 'Changes saved on this device — waiting to sync.') : undefined}
        actions={
          <>
            {!isNew ? (
              <Button variant="outline" onClick={() => setLabelsOpen(true)}>
                <TagIcon /> {t('product.labels', 'Print labels')}
              </Button>
            ) : null}
            {!isNew && can('products.delete') ? (
              <Button variant="destructive" onClick={() => void remove()}>
                <Trash2Icon /> {t('common.delete', 'Delete')}
              </Button>
            ) : null}
            {!readOnly ? (
              <Button onClick={() => void submit()} disabled={saving} data-testid="product-save">
                <SaveIcon /> {t('common.save', 'Save')}
              </Button>
            ) : null}
          </>
        }
      />

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        className="space-y-5"
      >
        <fieldset disabled={readOnly} className="space-y-5">
          <Section title={t('product.basic', 'Basic details')}>
            <FormGrid cols={3}>
              <FormRow label={t('product.name', 'Name')} htmlFor="name" error={errors.name?.message} required className="sm:col-span-2">
                <Input id="name" {...register('name')} autoFocus={isNew} data-testid="product-name" />
              </FormRow>
              <SelectField
                control={control}
                name="product_type"
                label={t('product.type', 'Type')}
                options={[
                  { value: 'standard', label: t('product.type_standard', 'Standard item') },
                  { value: 'weighed', label: t('product.type_weighed', 'Sold by weight / measure') },
                  { value: 'service', label: t('product.type_service', 'Service (no stock)') },
                  ...(hasModule('jewellery') ? [{ value: 'jewellery', label: t('product.type_jewellery', 'Jewellery (priced by weight)') }] : []),
                ]}
              />
              <SelectField control={control} name="category_id" label={t('product.category', 'Category')} nullable placeholder="—" options={lookups.categories.map((c) => ({ value: c.id, label: c.name }))} />
              <SelectField control={control} name="brand_id" label={t('product.brand', 'Brand')} nullable placeholder="—" options={lookups.brands.map((b) => ({ value: b.id, label: b.name }))} />
              <SelectField control={control} name="unit_id" label={t('product.unit', 'Unit')} nullable placeholder="—" options={lookups.units.map((u) => ({ value: u.id, label: `${u.code} — ${u.name}` }))} />
              <FormRow label="SKU" htmlFor="sku" error={errors.sku?.message}>
                <Input id="sku" {...register('sku', { setValueAs: (v: string) => v || null })} />
              </FormRow>
              <FormRow label={t('product.barcode', 'Barcode')} htmlFor="barcode" error={errors.barcode?.message}>
                <div className="flex gap-1">
                  <Input id="barcode" {...register('barcode', { setValueAs: (v: string) => v || null })} data-testid="product-barcode" />
                  <Button type="button" variant="outline" size="icon" title={t('product.generate_barcode', 'Generate barcode')} onClick={async () => setValue('barcode', await nextInternalBarcode(), { shouldDirty: true })}>
                    <BarcodeIcon />
                  </Button>
                </div>
              </FormRow>
              <FormRow label={t('product.hsn', 'HSN / SAC code')} htmlFor="hsn" error={errors.hsn_code?.message}>
                <Input id="hsn" inputMode="numeric" {...register('hsn_code', { setValueAs: (v: string) => v || null })} />
              </FormRow>
              {hasModule('weighing') || productType === 'weighed' ? (
                <FormRow label={t('product.plu', 'PLU (scale code)')} htmlFor="plu" error={errors.plu_code?.message}>
                  <Input id="plu" {...register('plu_code', { setValueAs: (v: string) => v || null })} />
                </FormRow>
              ) : null}
              <FormRow label={t('product.extra_barcodes', 'Additional barcodes')} className="sm:col-span-2" error={errors.barcodes?.message}>
                <div className="flex flex-wrap items-center gap-1.5">
                  {barcodes.map((code) => (
                    <span key={code} className="inline-flex items-center gap-1 rounded-md border px-2 py-0.5 font-mono text-xs">
                      {code}
                      <button type="button" onClick={() => setValue('barcodes', barcodes.filter((c) => c !== code), { shouldDirty: true })} aria-label={t('common.remove', 'Remove')}>
                        ×
                      </button>
                    </span>
                  ))}
                  <Input
                    className="h-8 w-44"
                    value={extraBarcode}
                    placeholder={t('product.scan_add', 'Scan to add')}
                    onChange={(e) => setExtraBarcode(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key !== 'Enter') return;
                      e.preventDefault();
                      const code = extraBarcode.trim();
                      if (code && !barcodes.includes(code)) setValue('barcodes', [...barcodes, code], { shouldDirty: true });
                      setExtraBarcode('');
                    }}
                  />
                </div>
              </FormRow>
              <FormRow label={t('product.description', 'Description')} htmlFor="description" className="sm:col-span-3">
                <Textarea id="description" rows={2} {...register('description', { setValueAs: (v: string) => v || null })} />
              </FormRow>
            </FormGrid>
          </Section>

          <Section title={t('product.pricing', 'Pricing & tax')}>
            <FormGrid cols={3}>
              {!jewellery ? (
                <>
                  <NumberField control={control} name="purchase_price" label={t('product.purchase_price', 'Purchase price')} required description={can('products.view_cost') ? undefined : t('product.cost_hidden', 'Hidden for your role')} />
                  <NumberField control={control} name="selling_price" label={t('product.selling_price', 'Selling price')} required />
                  <NumberField control={control} name="mrp" label="MRP" />
                  <NumberField control={control} name="min_selling_price" label={t('product.min_price', 'Minimum selling price')} description={t('product.min_price_hint', 'Cashiers cannot sell below this.')} />
                </>
              ) : null}
              <SelectField control={control} name="tax_rate_id" label={t('product.tax', 'Tax rate')} nullable placeholder={t('product.no_tax', 'No tax')} options={lookups.taxes.map((x) => ({ value: x.id, label: x.name }))} />
              {!jewellery ? <SwitchField control={control} name="price_includes_tax" label={t('product.incl_tax', 'Price includes tax')} description={t('product.incl_tax_hint', 'Typical for retail MRP pricing.')} /> : null}
            </FormGrid>
            {hasModule('wholesale_pricing') && !jewellery ? (
              <div className="mt-4 space-y-2">
                <p className="text-sm font-medium">{t('product.tiers', 'Wholesale / quantity pricing')}</p>
                {tiers.fields.map((field, index) => (
                  <div key={field.id} className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">{t('product.tier_from', 'From qty')}</span>
                    <Controller control={control} name={`price_tiers.${index}.min_qty`} render={({ field: f }) => <NumberInput value={f.value} onValueChange={(v) => f.onChange(v ?? 0)} decimals={3} className="w-24" />} />
                    <span className="text-sm text-muted-foreground">{t('product.tier_price', 'price')}</span>
                    <Controller control={control} name={`price_tiers.${index}.price`} render={({ field: f }) => <NumberInput value={f.value} onValueChange={(v) => f.onChange(v ?? 0)} className="w-28" />} />
                    <Button type="button" variant="ghost" size="icon-sm" onClick={() => tiers.remove(index)} aria-label={t('common.remove', 'Remove')}>
                      <Trash2Icon />
                    </Button>
                  </div>
                ))}
                <Button type="button" variant="outline" size="sm" onClick={() => tiers.append({ min_qty: 10, price: 0 })}>
                  <PlusIcon /> {t('product.add_tier', 'Add price tier')}
                </Button>
              </div>
            ) : null}
          </Section>

          {jewellery ? <JewelleryFields control={control} /> : null}
          {pharmacy || devices || clothing ? <AttributeFields control={control} pharmacy={pharmacy} devices={devices} clothing={clothing} /> : null}

          <Section title={t('product.inventory', 'Inventory')}>
            <div className="grid gap-3 sm:grid-cols-2">
              {productType !== 'service' ? <SwitchField control={control} name="track_inventory" label={t('product.track_inventory', 'Track stock')} description={t('product.track_inventory_hint', 'Keep a stock ledger for this item.')} /> : null}
              {tracked && (hasModule('batches') || trackBatch) ? <SwitchField control={control} name="track_batch" label={t('product.track_batch', 'Batch tracking')} description={t('product.track_batch_hint', 'Stock by batch with its own MRP and cost.')} /> : null}
              {tracked && trackBatch && (hasModule('expiry') || pharmacy) ? <SwitchField control={control} name="track_expiry" label={t('product.track_expiry', 'Expiry dates')} description={t('product.track_expiry_hint', 'Sell first-expiry-first-out; block expired stock.')} /> : null}
              {tracked && (hasModule('serials') || trackSerial) ? <SwitchField control={control} name="track_serial" label={t('product.track_serial', 'IMEI / serial numbers')} description={t('product.track_serial_hint', 'Each unit is sold by its IMEI or serial number.')} /> : null}
              {hasModule('variants') || hasVariants ? <SwitchField control={control} name="has_variants" label={t('product.has_variants', 'Has variants')} description={t('product.has_variants_hint', 'Sizes, colours or other options with their own price and stock.')} /> : null}
            </div>
            <FormGrid cols={3} className="mt-4">
              {tracked ? <NumberField control={control} name="reorder_level" label={t('product.reorder', 'Low stock alert at')} decimals={3} /> : null}
              {hasModule('warranty') || hasModule('serials') ? (
                <Controller
                  control={control}
                  name="warranty_months"
                  render={({ field }) => (
                    <FormRow label={t('product.warranty', 'Warranty (months)')} htmlFor="warranty">
                      <NumberInput id="warranty" value={field.value} onValueChange={(v) => field.onChange(v === null ? null : Math.round(v))} decimals={0} />
                    </FormRow>
                  )}
                />
              ) : null}
              {isNew && tracked && !hasVariants && !trackSerial ? (
                <FormRow label={t('product.opening_stock', 'Opening stock')} htmlFor="opening" description={t('product.opening_hint', 'Recorded as an opening stock movement.')}>
                  <NumberInput id="opening" value={opening} onValueChange={setOpening} decimals={3} data-testid="product-opening" />
                </FormRow>
              ) : null}
              {isNew && tracked && !hasVariants && trackBatch && opening ? (
                <>
                  <FormRow label={t('product.batch_no', 'Batch no.')} htmlFor="ob-no">
                    <Input id="ob-no" value={openingBatch.batch_no} onChange={(e) => setOpeningBatch((b) => ({ ...b, batch_no: e.target.value }))} />
                  </FormRow>
                  <FormRow label={t('product.expiry', 'Expiry date')} htmlFor="ob-exp">
                    <Input id="ob-exp" type="date" value={openingBatch.expiry_date} onChange={(e) => setOpeningBatch((b) => ({ ...b, expiry_date: e.target.value }))} />
                  </FormRow>
                </>
              ) : null}
            </FormGrid>
            {isNew && trackSerial ? <p className="mt-3 text-sm text-muted-foreground">{t('product.serial_stock_hint', 'IMEI / serial stock is added through a purchase, where each unit’s number is recorded.')}</p> : null}
          </Section>

          {hasVariants ? (
            <Section title={t('product.variants', 'Variants')} description={errors.variants?.message ?? errors.variants?.root?.message}>
              <VariantEditor control={control} setValue={setValue} isNew={isNew} tracked={tracked} openingStock={variantOpening} onOpeningStock={(vid, qty) => setVariantOpening((o) => ({ ...o, [vid]: qty }))} />
            </Section>
          ) : null}

          {hasModule('restaurant') ? (
            <Section title={t('product.modifiers', 'Add-ons & options')} description={t('product.modifiers_hint', 'e.g. Spice level, Extra cheese. Chosen at the POS.')}>
              <div className="space-y-3">
                {modifiers.fields.map((group, gi) => (
                  <ModifierGroupEditor key={group.key} control={control} index={gi} onRemove={() => modifiers.remove(gi)} />
                ))}
                <Button type="button" variant="outline" size="sm" onClick={() => modifiers.append({ id: uuidv7(), name: '', min: 0, max: 1, options: [{ id: uuidv7(), name: '', price: 0 }] })}>
                  <PlusIcon /> {t('product.add_modifier_group', 'Add option group')}
                </Button>
              </div>
            </Section>
          ) : null}

          <Section title={t('product.status', 'Status')}>
            <SwitchField control={control} name="active" label={t('product.active_label', 'Active')} description={t('product.active_hint', 'Inactive products are hidden from the POS.')} />
          </Section>
        </fieldset>

        {!isNew && product!.track_batch ? <BatchesSection product={product!} /> : null}

        {!readOnly ? (
          <div className="sticky bottom-0 -mx-4 flex justify-end gap-2 border-t bg-background/90 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-lg sm:border">
            <Button type="button" variant="outline" onClick={() => onDone(null)}>
              {t('common.cancel', 'Cancel')}
            </Button>
            <Button type="submit" disabled={saving}>
              <SaveIcon /> {isNew ? t('product.create', 'Create product') : t('common.save', 'Save')}
            </Button>
          </div>
        ) : null}
      </form>
      {!isNew ? <LabelsDialog open={labelsOpen} onOpenChange={setLabelsOpen} product={product!} /> : null}
    </Page>
  );
}

function ModifierGroupEditor({ control, index, onRemove }: { control: Control<ProductInput>; index: number; onRemove: () => void }) {
  const { t } = useTranslation();
  const options = useFieldArray({ control, name: `modifiers.${index}.options`, keyName: 'key' });
  return (
    <div className="space-y-2 rounded-lg border p-3">
      <div className="flex flex-wrap items-end gap-2">
        <Controller control={control} name={`modifiers.${index}.name`} render={({ field }) => <Input {...field} placeholder={t('product.group_name', 'Group name (e.g. Spice level)')} className="max-w-60" />} />
        <label className="text-xs text-muted-foreground">
          {t('product.min', 'Min')}
          <Controller control={control} name={`modifiers.${index}.min`} render={({ field }) => <NumberInput value={field.value} onValueChange={(v) => field.onChange(Math.round(v ?? 0))} decimals={0} className="h-8 w-16" />} />
        </label>
        <label className="text-xs text-muted-foreground">
          {t('product.max', 'Max')}
          <Controller control={control} name={`modifiers.${index}.max`} render={({ field }) => <NumberInput value={field.value} onValueChange={(v) => field.onChange(Math.max(1, Math.round(v ?? 1)))} decimals={0} className="h-8 w-16" />} />
        </label>
        <Button type="button" variant="ghost" size="icon-sm" onClick={onRemove} aria-label={t('common.remove', 'Remove')}>
          <Trash2Icon />
        </Button>
      </div>
      {options.fields.map((opt, oi) => (
        <div key={opt.key} className="flex items-center gap-2 pl-3">
          <Controller control={control} name={`modifiers.${index}.options.${oi}.name`} render={({ field }) => <Input {...field} placeholder={t('product.option_name', 'Option')} className="h-8 max-w-52" />} />
          <Controller control={control} name={`modifiers.${index}.options.${oi}.price`} render={({ field }) => <NumberInput value={field.value} onValueChange={(v) => field.onChange(v ?? 0)} className="h-8 w-24" placeholder="+0" />} />
          <Button type="button" variant="ghost" size="icon-sm" onClick={() => options.remove(oi)} disabled={options.fields.length === 1} aria-label={t('common.remove', 'Remove')}>
            <Trash2Icon />
          </Button>
        </div>
      ))}
      <Button type="button" variant="ghost" size="sm" onClick={() => options.append({ id: uuidv7(), name: '', price: 0 })}>
        <PlusIcon /> {t('product.add_option', 'Add option')}
      </Button>
    </div>
  );
}

function AttrText({ control, name, label }: { control: Control<ProductInput>; name: string; label: string }) {
  return (
    <Controller
      control={control}
      name={`attributes.${name}`}
      render={({ field }) => (
        <FormRow label={label} htmlFor={`attr-${name}`}>
          <Input id={`attr-${name}`} value={(field.value as string | undefined) ?? ''} onChange={(e) => field.onChange(e.target.value || undefined)} />
        </FormRow>
      )}
    />
  );
}

function AttrNumber({ control, name, label, decimals = 3 }: { control: Control<ProductInput>; name: string; label: string; decimals?: number }) {
  return (
    <Controller
      control={control}
      name={`attributes.${name}`}
      render={({ field }) => (
        <FormRow label={label} htmlFor={`attr-${name}`}>
          <NumberInput id={`attr-${name}`} value={(field.value as number | undefined) ?? null} onValueChange={(v) => field.onChange(v ?? undefined)} decimals={decimals} />
        </FormRow>
      )}
    />
  );
}

function AttrSelect({ control, name, label, options }: { control: Control<ProductInput>; name: string; label: string; options: Array<{ value: string; label: string }> }) {
  return (
    <Controller
      control={control}
      name={`attributes.${name}`}
      render={({ field }) => (
        <FormRow label={label} htmlFor={`attr-${name}`}>
          <select id={`attr-${name}`} className="h-8 w-full rounded-lg border bg-background px-2 text-sm" value={(field.value as string | undefined) ?? ''} onChange={(e) => field.onChange(e.target.value || undefined)}>
            <option value="">—</option>
            {options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </FormRow>
      )}
    />
  );
}

function JewelleryFields({ control }: { control: Control<ProductInput> }) {
  const { t } = useTranslation();
  const metal = (useWatch({ control, name: 'attributes.metal' }) as string | undefined) ?? 'gold';
  return (
    <Section title={t('product.jewellery', 'Jewellery details')} description={t('product.jewellery_hint', 'The price is calculated at the POS from today’s metal rate, weight, making and wastage.')}>
      <FormGrid cols={3}>
        <AttrSelect control={control} name="metal" label={t('jewellery.metal', 'Metal')} options={['gold', 'silver', 'platinum', 'diamond', 'other'].map((m) => ({ value: m, label: m[0]!.toUpperCase() + m.slice(1) }))} />
        <AttrSelect control={control} name="purity" label={t('jewellery.purity', 'Purity')} options={PURITIES.filter((p) => p.metal === metal || metal === 'diamond' || metal === 'other').map((p) => ({ value: p.code, label: p.label }))} />
        <AttrText control={control} name="huid" label="HUID" />
        <AttrNumber control={control} name="gross_weight" label={t('jewellery.gross_weight', 'Gross weight (g)')} />
        <AttrNumber control={control} name="stone_weight" label={t('jewellery.stone_weight', 'Stone weight (g)')} />
        <AttrNumber control={control} name="net_weight" label={t('jewellery.net_weight', 'Net weight (g)')} />
        <AttrSelect
          control={control}
          name="making_charge_type"
          label={t('jewellery.making_type', 'Making charge type')}
          options={[
            { value: 'per_gram', label: t('jewellery.per_gram', 'Per gram') },
            { value: 'percent', label: t('jewellery.percent', '% of metal value') },
            { value: 'fixed', label: t('jewellery.fixed', 'Fixed amount') },
          ]}
        />
        <AttrNumber control={control} name="making_charge_value" label={t('jewellery.making', 'Making')} decimals={2} />
        <AttrText control={control} name="design_no" label={t('jewellery.design', 'Design no.')} />
        <AttrSelect
          control={control}
          name="wastage_type"
          label={t('jewellery.wastage_type', 'Wastage type')}
          options={[
            { value: 'percent', label: t('jewellery.percent_weight', '% of weight') },
            { value: 'fixed', label: t('jewellery.fixed_grams', 'Fixed grams') },
          ]}
        />
        <AttrNumber control={control} name="wastage_value" label={t('jewellery.wastage', 'Wastage')} />
        <AttrNumber control={control} name="stone_charges" label={t('jewellery.stone_charges', 'Stone charges')} decimals={2} />
      </FormGrid>
    </Section>
  );
}

function AttributeFields({ control, pharmacy, devices, clothing }: { control: Control<ProductInput>; pharmacy: boolean; devices: boolean; clothing: boolean }) {
  const { t } = useTranslation();
  return (
    <Section title={t('product.attributes', 'Product attributes')}>
      <FormGrid cols={3}>
        {pharmacy ? (
          <>
            <AttrText control={control} name="generic_name" label={t('product.generic', 'Generic name')} />
            <AttrText control={control} name="manufacturer" label={t('product.manufacturer', 'Manufacturer')} />
            <AttrText control={control} name="composition" label={t('product.composition', 'Composition')} />
            <AttrText control={control} name="pack_size" label={t('product.pack', 'Pack size')} />
            <AttrSelect control={control} name="schedule" label={t('product.schedule', 'Drug schedule')} options={['H', 'H1', 'X', 'G', 'OTC'].map((s) => ({ value: s, label: s === 'OTC' ? 'OTC' : `Schedule ${s}` }))} />
            <Controller
              control={control}
              name="attributes.prescription_required"
              render={({ field }) => (
                <label className="flex items-center justify-between gap-3 rounded-lg border p-3 text-sm">
                  {t('product.rx', 'Prescription required')}
                  <Switch checked={!!field.value} onCheckedChange={field.onChange} />
                </label>
              )}
            />
          </>
        ) : null}
        {devices ? (
          <>
            <AttrText control={control} name="model" label={t('product.model', 'Model')} />
            <AttrText control={control} name="color" label={t('product.color', 'Colour')} />
            <AttrText control={control} name="ram" label="RAM" />
            <AttrText control={control} name="storage" label={t('product.storage', 'Storage')} />
          </>
        ) : null}
        {clothing ? (
          <>
            <AttrText control={control} name="material" label={t('product.material', 'Material')} />
            <AttrText control={control} name="style" label={t('product.style', 'Style')} />
            <AttrText control={control} name="season" label={t('product.season', 'Season')} />
            <AttrSelect control={control} name="gender" label={t('product.gender', 'Gender')} options={['Men', 'Women', 'Kids', 'Unisex'].map((g) => ({ value: g, label: g }))} />
          </>
        ) : null}
      </FormGrid>
    </Section>
  );
}
