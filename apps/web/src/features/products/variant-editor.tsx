import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Controller, useFieldArray, useWatch, type Control, type UseFormSetValue } from 'react-hook-form';
import { PlusIcon, Trash2Icon, WandSparklesIcon, XIcon } from 'lucide-react';
import { uuidv7, type ProductInput } from '@shopdesk/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { NumberInput } from '@/components/common/number-input';

type VariantRow = ProductInput['variants'][number];

/** Cartesian product of attribute values: [{Size:[S,M]},{Colour:[Red]}] → S/Red, M/Red. */
export function buildVariantMatrix(attributes: ProductInput['variant_attributes'], existing: VariantRow[], base: { selling_price: number; purchase_price: number; mrp: number | null }): VariantRow[] {
  const valid = attributes.filter((a) => a.name.trim() && a.values.length);
  if (!valid.length) return existing;
  let combos: Array<Record<string, string>> = [{}];
  for (const attr of valid) combos = combos.flatMap((c) => attr.values.map((v) => ({ ...c, [attr.name]: v })));
  return combos.map((attrs, index) => {
    const match = existing.find((v) => valid.every((a) => v.attributes[a.name] === attrs[a.name]));
    return (
      match ?? {
        id: uuidv7(),
        name: Object.values(attrs).join(' / '),
        sku: null,
        barcode: null,
        attributes: attrs,
        purchase_price: base.purchase_price || null,
        selling_price: base.selling_price || null,
        mrp: base.mrp,
        active: true,
        sort_order: index,
      }
    );
  });
}

export function VariantEditor({
  control,
  setValue,
  openingStock,
  onOpeningStock,
  isNew,
  tracked,
}: {
  control: Control<ProductInput>;
  setValue: UseFormSetValue<ProductInput>;
  openingStock: Record<string, number | null>;
  onOpeningStock: (variantId: string, qty: number | null) => void;
  isNew: boolean;
  tracked: boolean;
}) {
  const { t } = useTranslation();
  const attributes = useWatch({ control, name: 'variant_attributes' });
  const variants = useWatch({ control, name: 'variants' });
  const [selling, purchase, mrp] = useWatch({ control, name: ['selling_price', 'purchase_price', 'mrp'] });
  const { fields, remove } = useFieldArray({ control, name: 'variants', keyName: 'key' });
  const [drafts, setDrafts] = useState<Record<number, string>>({});

  const setAttributes = (next: ProductInput['variant_attributes']) => setValue('variant_attributes', next, { shouldDirty: true });

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        {attributes.map((attr, i) => (
          <div key={i} className="rounded-lg border p-3">
            <div className="flex items-center gap-2">
              <Input
                className="max-w-48"
                placeholder={t('product.attr_name', 'Attribute (e.g. Size)')}
                value={attr.name}
                onChange={(e) => setAttributes(attributes.map((a, j) => (j === i ? { ...a, name: e.target.value } : a)))}
              />
              <Button variant="ghost" size="icon-sm" onClick={() => setAttributes(attributes.filter((_, j) => j !== i))} aria-label={t('common.remove', 'Remove')}>
                <Trash2Icon />
              </Button>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {attr.values.map((value) => (
                <Badge key={value} variant="secondary" className="gap-1">
                  {value}
                  <button type="button" onClick={() => setAttributes(attributes.map((a, j) => (j === i ? { ...a, values: a.values.filter((v) => v !== value) } : a)))} aria-label={t('common.remove', 'Remove')}>
                    <XIcon className="size-3" />
                  </button>
                </Badge>
              ))}
              <Input
                className="h-7 w-48"
                placeholder={t('product.attr_values', 'Add values, comma separated')}
                value={drafts[i] ?? ''}
                onChange={(e) => setDrafts((d) => ({ ...d, [i]: e.target.value }))}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter' && e.key !== ',') return;
                  e.preventDefault();
                  const values = (drafts[i] ?? '').split(',').map((v) => v.trim()).filter(Boolean);
                  if (!values.length) return;
                  setAttributes(attributes.map((a, j) => (j === i ? { ...a, values: [...new Set([...a.values, ...values])] } : a)));
                  setDrafts((d) => ({ ...d, [i]: '' }));
                }}
                onBlur={() => {
                  const values = (drafts[i] ?? '').split(',').map((v) => v.trim()).filter(Boolean);
                  if (!values.length) return;
                  setAttributes(attributes.map((a, j) => (j === i ? { ...a, values: [...new Set([...a.values, ...values])] } : a)));
                  setDrafts((d) => ({ ...d, [i]: '' }));
                }}
              />
            </div>
          </div>
        ))}
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => setAttributes([...attributes, { name: attributes.length === 0 ? 'Size' : attributes.length === 1 ? 'Colour' : '', values: [] }])}>
            <PlusIcon /> {t('product.add_attribute', 'Add attribute')}
          </Button>
          <Button
            size="sm"
            onClick={() => setValue('variants', buildVariantMatrix(attributes, variants, { selling_price: selling, purchase_price: purchase, mrp }), { shouldDirty: true, shouldValidate: true })}
            disabled={!attributes.some((a) => a.values.length)}
          >
            <WandSparklesIcon /> {t('product.generate_variants', 'Generate variants')}
          </Button>
        </div>
      </div>

      {fields.length ? (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
              <tr>
                <th className="p-2">{t('product.variant', 'Variant')}</th>
                <th className="p-2">SKU</th>
                <th className="p-2">{t('product.barcode', 'Barcode')}</th>
                <th className="p-2 text-right">{t('product.cost', 'Cost')}</th>
                <th className="p-2 text-right">{t('product.price', 'Price')}</th>
                <th className="p-2 text-right">MRP</th>
                {isNew && tracked ? <th className="p-2 text-right">{t('product.opening', 'Opening qty')}</th> : null}
                <th className="p-2">{t('product.active', 'Active')}</th>
                <th />
              </tr>
            </thead>
            <tbody className="divide-y">
              {fields.map((field, index) => (
                <tr key={field.key}>
                  <td className="p-1.5">
                    <Controller control={control} name={`variants.${index}.name`} render={({ field: f }) => <Input {...f} className="h-8" />} />
                  </td>
                  <td className="p-1.5">
                    <Controller control={control} name={`variants.${index}.sku`} render={({ field: f }) => <Input value={f.value ?? ''} onChange={(e) => f.onChange(e.target.value || null)} className="h-8 w-28" />} />
                  </td>
                  <td className="p-1.5">
                    <Controller control={control} name={`variants.${index}.barcode`} render={({ field: f }) => <Input value={f.value ?? ''} onChange={(e) => f.onChange(e.target.value || null)} className="h-8 w-36" />} />
                  </td>
                  {(['purchase_price', 'selling_price', 'mrp'] as const).map((key) => (
                    <td key={key} className="p-1.5">
                      <Controller control={control} name={`variants.${index}.${key}`} render={({ field: f }) => <NumberInput value={f.value} onValueChange={f.onChange} className="h-8 w-24" />} />
                    </td>
                  ))}
                  {isNew && tracked ? (
                    <td className="p-1.5">
                      <NumberInput value={openingStock[field.id] ?? null} onValueChange={(v) => onOpeningStock(field.id, v)} decimals={3} className="h-8 w-20" />
                    </td>
                  ) : null}
                  <td className="p-1.5">
                    <Controller control={control} name={`variants.${index}.active`} render={({ field: f }) => <Switch checked={f.value} onCheckedChange={f.onChange} />} />
                  </td>
                  <td className="p-1.5">
                    <Button variant="ghost" size="icon-sm" onClick={() => remove(index)} aria-label={t('common.remove', 'Remove')}>
                      <Trash2Icon />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">{t('product.no_variants', 'Add attributes such as Size and Colour, then generate variants.')}</p>
      )}
    </div>
  );
}

