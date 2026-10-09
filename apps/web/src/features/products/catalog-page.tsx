import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useLiveQuery } from 'dexie-react-hooks';
import { toast } from 'sonner';
import { PencilIcon, PlusIcon, Trash2Icon } from 'lucide-react';
import { brandSchema, categorySchema, couponSchema, taxRateSchema, unitSchema, type Coupon, type TaxKind, type TaxRate } from '@shopdesk/shared';
import { db } from '@/lib/db/business';
import { useFormat } from '@/lib/format';
import {
  createBrand,
  createCategory,
  createCoupon,
  createTaxRate,
  createUnit,
  deleteBrand,
  deleteCategory,
  deleteTaxRate,
  deleteUnit,
  updateBrand,
  updateCategory,
  updateCoupon,
  updateTaxRate,
  updateUnit,
} from '@/lib/repos/catalog';
import { useCan } from '@/hooks/use-app';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { confirm } from '@/components/common/confirm';
import { FormGrid, FormRow } from '@/components/common/form';
import { NumberInput } from '@/components/common/number-input';
import { Page, PageHeader } from '@/components/common/page';
import { ResponsiveDialog } from '@/components/common/responsive-dialog';

type Issues = Record<string, string>;
const issuesOf = (error: { issues: Array<{ path: PropertyKey[]; message: string }> }): Issues => Object.fromEntries(error.issues.map((i) => [String(i.path[0] ?? ''), i.message]));

async function guarded(work: () => Promise<unknown>, success: string): Promise<boolean> {
  try {
    await work();
    toast.success(success);
    return true;
  } catch (error) {
    toast.error(error instanceof Error ? error.message : String(error));
    return false;
  }
}

async function confirmDelete(name: string, t: (k: string, d: string, o?: Record<string, unknown>) => string): Promise<boolean> {
  const { confirmed } = await confirm({ title: t('catalog.delete_title', 'Delete {{name}}?', { name }), destructive: true, confirmLabel: t('common.delete', 'Delete') });
  return confirmed;
}

function ListShell({ children, onAdd, canEdit, addLabel }: { children: ReactNode; onAdd: () => void; canEdit: boolean; addLabel: string }) {
  return (
    <div className="space-y-3">
      {canEdit ? (
        <div className="flex justify-end">
          <Button onClick={onAdd}>
            <PlusIcon /> {addLabel}
          </Button>
        </div>
      ) : null}
      <ul className="divide-y rounded-xl border bg-card">{children}</ul>
    </div>
  );
}

function Row({ title, subtitle, badges, onEdit, onDelete }: { title: ReactNode; subtitle?: ReactNode; badges?: ReactNode; onEdit?: () => void; onDelete?: () => void }) {
  return (
    <li className="flex items-center gap-3 px-4 py-2.5">
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
          {title} {badges}
        </p>
        {subtitle ? <p className="text-xs text-muted-foreground">{subtitle}</p> : null}
      </div>
      {onEdit ? (
        <Button variant="ghost" size="icon-sm" onClick={onEdit} aria-label="Edit">
          <PencilIcon />
        </Button>
      ) : null}
      {onDelete ? (
        <Button variant="ghost" size="icon-sm" onClick={onDelete} aria-label="Delete">
          <Trash2Icon />
        </Button>
      ) : null}
    </li>
  );
}

export default function CatalogPage() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const tab = params.get('tab') ?? 'categories';
  return (
    <Page className="max-w-4xl">
      <PageHeader back="/products" title={t('catalog.title', 'Catalog setup')} description={t('catalog.description', 'Categories, brands, units, tax rates and coupons.')} />
      <Tabs value={tab} onValueChange={(v) => navigate(`/catalog?tab=${v}`, { replace: true })}>
        <TabsList className="mb-4 w-full justify-start overflow-x-auto">
          <TabsTrigger value="categories">{t('catalog.categories', 'Categories')}</TabsTrigger>
          <TabsTrigger value="brands">{t('catalog.brands', 'Brands')}</TabsTrigger>
          <TabsTrigger value="units">{t('catalog.units', 'Units')}</TabsTrigger>
          <TabsTrigger value="taxes">{t('catalog.taxes', 'Tax rates')}</TabsTrigger>
          <TabsTrigger value="coupons">{t('catalog.coupons', 'Coupons')}</TabsTrigger>
        </TabsList>
        <TabsContent value="categories">
          <Categories />
        </TabsContent>
        <TabsContent value="brands">
          <Brands />
        </TabsContent>
        <TabsContent value="units">
          <Units />
        </TabsContent>
        <TabsContent value="taxes">
          <Taxes />
        </TabsContent>
        <TabsContent value="coupons">
          <Coupons />
        </TabsContent>
      </Tabs>
    </Page>
  );
}

/* --------------------------------------------------------------- categories */

function Categories() {
  const { t } = useTranslation();
  const can = useCan();
  const canEdit = can('products.create');
  const rows = useLiveQuery(async () => {
    const [categories, products] = await Promise.all([db().categories.filter((c) => !c.deleted_at).sortBy('sort_order'), db().products.filter((p) => !p.deleted_at).toArray()]);
    const counts = new Map<string, number>();
    for (const p of products) if (p.category_id) counts.set(p.category_id, (counts.get(p.category_id) ?? 0) + 1);
    return categories.map((c) => ({ ...c, count: counts.get(c.id) ?? 0 }));
  }, []);
  const [editing, setEditing] = useState<{ id: string | null; name: string; color: string; sort_order: number; active: boolean } | null>(null);
  const [errors, setErrors] = useState<Issues>({});

  const save = async () => {
    if (!editing) return;
    const parsed = categorySchema.safeParse({ name: editing.name, parent_id: null, color: editing.color || null, sort_order: editing.sort_order, active: editing.active });
    if (!parsed.success) return setErrors(issuesOf(parsed.error));
    const ok = await guarded(() => (editing.id ? updateCategory(editing.id, parsed.data) : createCategory(parsed.data)), t('catalog.saved', 'Saved'));
    if (ok) setEditing(null);
  };

  return (
    <ListShell canEdit={canEdit} addLabel={t('catalog.add_category', 'Add category')} onAdd={() => (setErrors({}), setEditing({ id: null, name: '', color: '', sort_order: rows?.length ?? 0, active: true }))}>
      {(rows ?? []).map((c) => (
        <Row
          key={c.id}
          title={
            <>
              {c.color ? <span className="size-3 rounded-full" style={{ background: c.color }} /> : null}
              {c.name}
            </>
          }
          subtitle={`${c.count} ${t('product.count', 'products')}`}
          badges={!c.active ? <Badge variant="outline">{t('product.inactive', 'Inactive')}</Badge> : null}
          onEdit={canEdit ? () => (setErrors({}), setEditing({ id: c.id, name: c.name, color: c.color ?? '', sort_order: c.sort_order, active: c.active })) : undefined}
          onDelete={
            can('products.delete')
              ? async () => {
                  if (c.count > 0) return toast.error(t('catalog.in_use', 'Move its {{count}} products to another category first.', { count: c.count }));
                  if (await confirmDelete(c.name, t)) await guarded(() => deleteCategory(c.id), t('catalog.deleted', 'Deleted'));
                }
              : undefined
          }
        />
      ))}
      {rows && rows.length === 0 ? <li className="p-6 text-center text-sm text-muted-foreground">{t('catalog.none', 'Nothing here yet.')}</li> : null}
      <ResponsiveDialog
        open={!!editing}
        onOpenChange={(o) => !o && setEditing(null)}
        title={editing?.id ? t('catalog.edit_category', 'Edit category') : t('catalog.add_category', 'Add category')}
        footer={<Button onClick={() => void save()}>{t('common.save', 'Save')}</Button>}
      >
        {editing ? (
          <FormGrid>
            <FormRow label={t('catalog.name', 'Name')} htmlFor="c-name" error={errors.name} required className="sm:col-span-2">
              <Input id="c-name" autoFocus value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && void save()} />
            </FormRow>
            <FormRow label={t('catalog.color', 'Colour')} htmlFor="c-color">
              <Input id="c-color" type="color" value={editing.color || '#6366f1'} onChange={(e) => setEditing({ ...editing, color: e.target.value })} className="h-9 w-20 p-1" />
            </FormRow>
            <FormRow label={t('catalog.sort', 'Display order')} htmlFor="c-sort">
              <NumberInput id="c-sort" decimals={0} value={editing.sort_order} onValueChange={(v) => setEditing({ ...editing, sort_order: Math.max(0, Math.round(v ?? 0)) })} />
            </FormRow>
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={editing.active} onCheckedChange={(v) => setEditing({ ...editing, active: v })} /> {t('product.active_label', 'Active')}
            </label>
          </FormGrid>
        ) : null}
      </ResponsiveDialog>
    </ListShell>
  );
}

/* ------------------------------------------------------------------- brands */

function Brands() {
  const { t } = useTranslation();
  const can = useCan();
  const canEdit = can('products.create');
  const rows = useLiveQuery(() => db().brands.filter((b) => !b.deleted_at).sortBy('name'), []);
  const [editing, setEditing] = useState<{ id: string | null; name: string; active: boolean } | null>(null);
  const [errors, setErrors] = useState<Issues>({});
  const save = async () => {
    if (!editing) return;
    const parsed = brandSchema.safeParse({ name: editing.name, active: editing.active });
    if (!parsed.success) return setErrors(issuesOf(parsed.error));
    if (await guarded(() => (editing.id ? updateBrand(editing.id, parsed.data) : createBrand(parsed.data)), t('catalog.saved', 'Saved'))) setEditing(null);
  };
  return (
    <ListShell canEdit={canEdit} addLabel={t('catalog.add_brand', 'Add brand')} onAdd={() => (setErrors({}), setEditing({ id: null, name: '', active: true }))}>
      {(rows ?? []).map((b) => (
        <Row
          key={b.id}
          title={b.name}
          badges={!b.active ? <Badge variant="outline">{t('product.inactive', 'Inactive')}</Badge> : null}
          onEdit={canEdit ? () => (setErrors({}), setEditing({ id: b.id, name: b.name, active: b.active })) : undefined}
          onDelete={
            can('products.delete')
              ? async () => {
                  const used = await db().products.filter((p) => p.brand_id === b.id && !p.deleted_at).count();
                  if (used) return toast.error(t('catalog.brand_in_use', '{{count}} products use this brand.', { count: used }));
                  if (await confirmDelete(b.name, t)) await guarded(() => deleteBrand(b.id), t('catalog.deleted', 'Deleted'));
                }
              : undefined
          }
        />
      ))}
      {rows && rows.length === 0 ? <li className="p-6 text-center text-sm text-muted-foreground">{t('catalog.none', 'Nothing here yet.')}</li> : null}
      <ResponsiveDialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)} size="sm" title={editing?.id ? t('catalog.edit_brand', 'Edit brand') : t('catalog.add_brand', 'Add brand')} footer={<Button onClick={() => void save()}>{t('common.save', 'Save')}</Button>}>
        {editing ? (
          <div className="space-y-3">
            <FormRow label={t('catalog.name', 'Name')} htmlFor="b-name" error={errors.name} required>
              <Input id="b-name" autoFocus value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && void save()} />
            </FormRow>
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={editing.active} onCheckedChange={(v) => setEditing({ ...editing, active: v })} /> {t('product.active_label', 'Active')}
            </label>
          </div>
        ) : null}
      </ResponsiveDialog>
    </ListShell>
  );
}

/* -------------------------------------------------------------------- units */

function Units() {
  const { t } = useTranslation();
  const can = useCan();
  const canEdit = can('settings.manage') || can('products.create');
  const rows = useLiveQuery(() => db().units.filter((u) => !u.deleted_at).sortBy('code'), []);
  const [editing, setEditing] = useState<{ id: string | null; code: string; name: string; allow_decimal: boolean } | null>(null);
  const [errors, setErrors] = useState<Issues>({});
  const save = async () => {
    if (!editing) return;
    const parsed = unitSchema.safeParse({ code: editing.code.toUpperCase(), name: editing.name, allow_decimal: editing.allow_decimal });
    if (!parsed.success) return setErrors(issuesOf(parsed.error));
    const clash = (rows ?? []).find((u) => u.code.toUpperCase() === parsed.data.code && u.id !== editing.id);
    if (clash) return setErrors({ code: t('catalog.unit_exists', 'This unit code already exists.') });
    if (await guarded(() => (editing.id ? updateUnit(editing.id, parsed.data) : createUnit(parsed.data)), t('catalog.saved', 'Saved'))) setEditing(null);
  };
  return (
    <ListShell canEdit={canEdit} addLabel={t('catalog.add_unit', 'Add unit')} onAdd={() => (setErrors({}), setEditing({ id: null, code: '', name: '', allow_decimal: false }))}>
      {(rows ?? []).map((u) => (
        <Row
          key={u.id}
          title={`${u.code} — ${u.name}`}
          subtitle={u.allow_decimal ? t('catalog.decimal', 'Decimal quantities allowed') : t('catalog.whole', 'Whole quantities')}
          onEdit={canEdit ? () => (setErrors({}), setEditing({ id: u.id, code: u.code, name: u.name, allow_decimal: u.allow_decimal })) : undefined}
          onDelete={
            can('products.delete')
              ? async () => {
                  const used = await db().products.filter((p) => p.unit_id === u.id && !p.deleted_at).count();
                  if (used) return toast.error(t('catalog.unit_in_use', '{{count}} products use this unit.', { count: used }));
                  if (await confirmDelete(u.code, t)) await guarded(() => deleteUnit(u.id), t('catalog.deleted', 'Deleted'));
                }
              : undefined
          }
        />
      ))}
      <ResponsiveDialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)} size="sm" title={editing?.id ? t('catalog.edit_unit', 'Edit unit') : t('catalog.add_unit', 'Add unit')} footer={<Button onClick={() => void save()}>{t('common.save', 'Save')}</Button>}>
        {editing ? (
          <div className="space-y-3">
            <FormRow label={t('catalog.code', 'Code')} htmlFor="u-code" error={errors.code} required>
              <Input id="u-code" autoFocus value={editing.code} onChange={(e) => setEditing({ ...editing, code: e.target.value.toUpperCase() })} placeholder="KG" />
            </FormRow>
            <FormRow label={t('catalog.name', 'Name')} htmlFor="u-name" error={errors.name} required>
              <Input id="u-name" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} placeholder="Kilogram" />
            </FormRow>
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={editing.allow_decimal} onCheckedChange={(v) => setEditing({ ...editing, allow_decimal: v })} /> {t('catalog.allow_decimal', 'Allow decimal quantities (e.g. 1.250 kg)')}
            </label>
          </div>
        ) : null}
      </ResponsiveDialog>
    </ListShell>
  );
}

/* -------------------------------------------------------------------- taxes */

type TaxDraft = { id: string | null; name: string; kind: TaxKind; rate: number | null; cess_rate: number | null; components: Array<{ code: string; name: string; rate: number }>; is_default: boolean; active: boolean };

function Taxes() {
  const { t } = useTranslation();
  const can = useCan();
  const canEdit = can('settings.manage');
  const rows = useLiveQuery(() => db().tax_rates.filter((x) => !x.deleted_at).sortBy('rate'), []);
  const [editing, setEditing] = useState<TaxDraft | null>(null);
  const [errors, setErrors] = useState<Issues>({});
  const describe = (x: TaxRate) =>
    x.kind === 'gst' ? `GST ${x.rate}% (CGST ${x.rate / 2}% + SGST ${x.rate / 2}% / IGST ${x.rate}%)${x.cess_rate ? ` + cess ${x.cess_rate}%` : ''}` : x.kind === 'custom' ? (x.components ?? []).map((c) => `${c.name} ${c.rate}%`).join(' + ') : x.kind === 'exempt' ? t('catalog.exempt', 'Exempt / nil rated') : `${x.kind.toUpperCase()} ${x.rate}%`;
  const save = async () => {
    if (!editing) return;
    const parsed = taxRateSchema.safeParse({ ...editing, rate: editing.kind === 'exempt' ? 0 : (editing.rate ?? 0), cess_rate: editing.cess_rate ?? 0, components: editing.kind === 'custom' ? editing.components : null });
    if (!parsed.success) return setErrors(issuesOf(parsed.error));
    if (await guarded(() => (editing.id ? updateTaxRate(editing.id, parsed.data) : createTaxRate(parsed.data)), t('catalog.saved', 'Saved'))) setEditing(null);
  };
  return (
    <ListShell canEdit={canEdit} addLabel={t('catalog.add_tax', 'Add tax rate')} onAdd={() => (setErrors({}), setEditing({ id: null, name: '', kind: 'gst', rate: null, cess_rate: 0, components: [], is_default: false, active: true }))}>
      {(rows ?? []).map((x) => (
        <Row
          key={x.id}
          title={x.name}
          subtitle={describe(x)}
          badges={
            <>
              {x.is_default ? <Badge>{t('catalog.default', 'Default')}</Badge> : null}
              {!x.active ? <Badge variant="outline">{t('product.inactive', 'Inactive')}</Badge> : null}
            </>
          }
          onEdit={canEdit ? () => (setErrors({}), setEditing({ id: x.id, name: x.name, kind: x.kind, rate: x.rate, cess_rate: x.cess_rate, components: x.components ?? [], is_default: x.is_default, active: x.active })) : undefined}
          onDelete={
            canEdit
              ? async () => {
                  const used = await db().products.filter((p) => p.tax_rate_id === x.id && !p.deleted_at).count();
                  if (used) return toast.error(t('catalog.tax_in_use', '{{count}} products use this tax rate.', { count: used }));
                  if (await confirmDelete(x.name, t)) await guarded(() => deleteTaxRate(x.id), t('catalog.deleted', 'Deleted'));
                }
              : undefined
          }
        />
      ))}
      <ResponsiveDialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)} title={editing?.id ? t('catalog.edit_tax', 'Edit tax rate') : t('catalog.add_tax', 'Add tax rate')} footer={<Button onClick={() => void save()}>{t('common.save', 'Save')}</Button>}>
        {editing ? (
          <FormGrid>
            <FormRow label={t('catalog.name', 'Name')} htmlFor="t-name" error={errors.name} required>
              <Input id="t-name" autoFocus value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} placeholder="GST 18%" />
            </FormRow>
            <FormRow label={t('catalog.kind', 'Type')} htmlFor="t-kind">
              <select id="t-kind" className="h-8 w-full rounded-lg border bg-background px-2 text-sm" value={editing.kind} onChange={(e) => setEditing({ ...editing, kind: e.target.value as TaxKind })}>
                <option value="gst">GST (CGST/SGST or IGST)</option>
                <option value="vat">VAT</option>
                <option value="simple">{t('catalog.simple', 'Simple tax')}</option>
                <option value="custom">{t('catalog.custom', 'Custom components')}</option>
                <option value="exempt">{t('catalog.exempt', 'Exempt / nil rated')}</option>
              </select>
            </FormRow>
            {editing.kind !== 'exempt' && editing.kind !== 'custom' ? (
              <FormRow label={t('catalog.rate', 'Rate %')} htmlFor="t-rate" error={errors.rate}>
                <NumberInput id="t-rate" decimals={3} value={editing.rate} onValueChange={(v) => setEditing({ ...editing, rate: v })} />
              </FormRow>
            ) : null}
            {editing.kind === 'gst' ? (
              <FormRow label={t('catalog.cess', 'Cess %')} htmlFor="t-cess" error={errors.cess_rate}>
                <NumberInput id="t-cess" decimals={3} value={editing.cess_rate} onValueChange={(v) => setEditing({ ...editing, cess_rate: v })} />
              </FormRow>
            ) : null}
            {editing.kind === 'custom' ? (
              <div className="space-y-2 sm:col-span-2">
                {editing.components.map((c, i) => (
                  <div key={i} className="flex gap-2">
                    <Input className="w-24" placeholder="CODE" value={c.code} onChange={(e) => setEditing({ ...editing, components: editing.components.map((x, j) => (j === i ? { ...x, code: e.target.value.toUpperCase() } : x)) })} />
                    <Input placeholder={t('catalog.name', 'Name')} value={c.name} onChange={(e) => setEditing({ ...editing, components: editing.components.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} />
                    <NumberInput className="w-24" decimals={3} value={c.rate} onValueChange={(v) => setEditing({ ...editing, components: editing.components.map((x, j) => (j === i ? { ...x, rate: v ?? 0 } : x)) })} />
                    <Button variant="ghost" size="icon" onClick={() => setEditing({ ...editing, components: editing.components.filter((_, j) => j !== i) })} aria-label={t('common.remove', 'Remove')}>
                      <Trash2Icon />
                    </Button>
                  </div>
                ))}
                <Button variant="outline" size="sm" onClick={() => setEditing({ ...editing, components: [...editing.components, { code: '', name: '', rate: 0 }] })}>
                  <PlusIcon /> {t('catalog.add_component', 'Add component')}
                </Button>
                {errors.components ? <p className="text-xs text-destructive">{errors.components}</p> : null}
              </div>
            ) : null}
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={editing.is_default} onCheckedChange={(v) => setEditing({ ...editing, is_default: v })} /> {t('catalog.is_default', 'Default for new products')}
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={editing.active} onCheckedChange={(v) => setEditing({ ...editing, active: v })} /> {t('product.active_label', 'Active')}
            </label>
          </FormGrid>
        ) : null}
      </ResponsiveDialog>
    </ListShell>
  );
}

/* ------------------------------------------------------------------ coupons */

type CouponDraft = Omit<Coupon, 'id' | 'business_id' | 'version' | 'created_at' | 'updated_at' | 'deleted_at' | 'used_count' | 'discount_value' | 'min_amount'> & { id: string | null; discount_value: number | null; min_amount: number | null };

function Coupons() {
  const { t } = useTranslation();
  const fmt = useFormat();
  const can = useCan();
  const canEdit = can('settings.manage');
  const rows = useLiveQuery(() => db().coupons.filter((c) => !c.deleted_at).sortBy('code'), []);
  const [editing, setEditing] = useState<CouponDraft | null>(null);
  const [errors, setErrors] = useState<Issues>({});
  useEffect(() => setErrors({}), [editing?.id]);
  const save = async () => {
    if (!editing) return;
    const { id, ...draft } = editing;
    const parsed = couponSchema.safeParse({ ...draft, discount_value: draft.discount_value ?? 0, min_amount: draft.min_amount ?? 0 });
    if (!parsed.success) return setErrors(issuesOf(parsed.error));
    if (parsed.data.valid_from && parsed.data.valid_to && parsed.data.valid_to < parsed.data.valid_from) return setErrors({ valid_to: t('catalog.valid_order', 'End date is before start date.') });
    if (await guarded(() => (id ? updateCoupon(id, parsed.data) : createCoupon(parsed.data)), t('catalog.saved', 'Saved'))) setEditing(null);
  };
  return (
    <ListShell canEdit={canEdit} addLabel={t('catalog.add_coupon', 'Add coupon')} onAdd={() => setEditing({ id: null, code: '', description: null, discount_type: 'percent', discount_value: null, min_amount: 0, max_discount: null, valid_from: null, valid_to: null, usage_limit: null, active: true })}>
      {(rows ?? []).map((c) => (
        <Row
          key={c.id}
          title={<span className="font-mono">{c.code}</span>}
          subtitle={`${c.discount_type === 'percent' ? `${c.discount_value}%` : fmt.money(c.discount_value)} ${t('catalog.off', 'off')}${c.min_amount ? ` · ${t('catalog.min', 'min')} ${fmt.money(c.min_amount)}` : ''}${c.max_discount ? ` · ${t('catalog.max', 'max')} ${fmt.money(c.max_discount)}` : ''} · ${t('catalog.used', 'used')} ${c.used_count}${c.usage_limit ? `/${c.usage_limit}` : ''}${c.valid_to ? ` · ${t('catalog.until', 'until')} ${fmt.date(c.valid_to)}` : ''}`}
          badges={!c.active ? <Badge variant="outline">{t('product.inactive', 'Inactive')}</Badge> : null}
          onEdit={canEdit ? () => setEditing({ ...c }) : undefined}
        />
      ))}
      {rows && rows.length === 0 ? <li className="p-6 text-center text-sm text-muted-foreground">{t('catalog.none', 'Nothing here yet.')}</li> : null}
      <ResponsiveDialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)} title={editing?.id ? t('catalog.edit_coupon', 'Edit coupon') : t('catalog.add_coupon', 'Add coupon')} footer={<Button onClick={() => void save()}>{t('common.save', 'Save')}</Button>}>
        {editing ? (
          <FormGrid>
            <FormRow label={t('catalog.code', 'Code')} htmlFor="cp-code" error={errors.code} required>
              <Input id="cp-code" autoFocus value={editing.code} disabled={!!editing.id} onChange={(e) => setEditing({ ...editing, code: e.target.value.toUpperCase() })} />
            </FormRow>
            <FormRow label={t('catalog.description_label', 'Description')} htmlFor="cp-desc">
              <Input id="cp-desc" value={editing.description ?? ''} onChange={(e) => setEditing({ ...editing, description: e.target.value || null })} />
            </FormRow>
            <FormRow label={t('catalog.discount', 'Discount')} htmlFor="cp-val" error={errors.discount_value} required>
              <div className="flex gap-2">
                <select className="h-8 rounded-lg border bg-background px-2 text-sm" value={editing.discount_type} onChange={(e) => setEditing({ ...editing, discount_type: e.target.value as 'percent' | 'amount' })}>
                  <option value="percent">%</option>
                  <option value="amount">{fmt.currency}</option>
                </select>
                <NumberInput id="cp-val" value={editing.discount_value} onValueChange={(v) => setEditing({ ...editing, discount_value: v })} />
              </div>
            </FormRow>
            <FormRow label={t('catalog.min_bill', 'Minimum bill amount')} htmlFor="cp-min" error={errors.min_amount}>
              <NumberInput id="cp-min" value={editing.min_amount} onValueChange={(v) => setEditing({ ...editing, min_amount: v })} />
            </FormRow>
            {editing.discount_type === 'percent' ? (
              <FormRow label={t('catalog.max_discount', 'Maximum discount')} htmlFor="cp-max" error={errors.max_discount}>
                <NumberInput id="cp-max" value={editing.max_discount} onValueChange={(v) => setEditing({ ...editing, max_discount: v })} />
              </FormRow>
            ) : null}
            <FormRow label={t('catalog.usage_limit', 'Usage limit')} htmlFor="cp-limit" error={errors.usage_limit}>
              <NumberInput id="cp-limit" decimals={0} value={editing.usage_limit} onValueChange={(v) => setEditing({ ...editing, usage_limit: v === null ? null : Math.round(v) })} placeholder={t('catalog.unlimited', 'Unlimited')} />
            </FormRow>
            <FormRow label={t('catalog.valid_from', 'Valid from')} htmlFor="cp-from">
              <Input id="cp-from" type="date" value={editing.valid_from ?? ''} onChange={(e) => setEditing({ ...editing, valid_from: e.target.value || null })} />
            </FormRow>
            <FormRow label={t('catalog.valid_to', 'Valid to')} htmlFor="cp-to" error={errors.valid_to}>
              <Input id="cp-to" type="date" value={editing.valid_to ?? ''} onChange={(e) => setEditing({ ...editing, valid_to: e.target.value || null })} />
            </FormRow>
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={editing.active} onCheckedChange={(v) => setEditing({ ...editing, active: v })} /> {t('product.active_label', 'Active')}
            </label>
          </FormGrid>
        ) : null}
      </ResponsiveDialog>
    </ListShell>
  );
}
