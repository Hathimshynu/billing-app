/**
 * Zod validation schemas shared by forms, CSV import and client-side payload checks.
 * The server re-validates everything with Laravel validation rules (never trust the client).
 */
import { z } from 'zod';
import { BUSINESS_TYPES, MODULES, PAYMENT_METHODS, isValidIndianMobile } from './business';
import { isValidGstin } from './tax';

const trimmed = (max: number) => z.string().trim().max(max);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .transform((v) => (v === '' ? null : v));
const money = (label = 'Amount') =>
  z
    .number({ error: `${label} must be a number` })
    .refine(Number.isFinite, `${label} must be a number`)
    .min(0, `${label} cannot be negative`)
    .max(10_000_000_000, `${label} is too large`);
const optionalMoney = (label = 'Amount') => money(label).nullable();
const percent = z.number().min(0, 'Cannot be negative').max(100, 'Cannot exceed 100%');
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

export const phoneSchema = z
  .string()
  .trim()
  .max(20)
  .nullable()
  .refine((v) => !v || /^[+\d][\d\s-]{5,18}$/.test(v), 'Enter a valid phone number');

export const indianMobileSchema = z
  .string()
  .trim()
  .refine((v) => isValidIndianMobile(v), 'Enter a valid 10 digit mobile number');

export const gstinSchema = z
  .string()
  .trim()
  .toUpperCase()
  .nullable()
  .refine((v) => !v || isValidGstin(v), 'Enter a valid GSTIN (15 characters)');

export const emailSchema = z.string().trim().toLowerCase().email('Enter a valid email address').max(190);

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Password is required').max(200),
});

export const registerSchema = z
  .object({
    name: trimmed(120).min(2, 'Enter your name'),
    email: emailSchema,
    phone: phoneSchema,
    password: z
      .string()
      .min(8, 'Use at least 8 characters')
      .max(200)
      .regex(/[A-Za-z]/, 'Include a letter')
      .regex(/\d/, 'Include a number'),
    password_confirmation: z.string(),
  })
  .refine((d) => d.password === d.password_confirmation, {
    path: ['password_confirmation'],
    message: 'Passwords do not match',
  });

export const businessSchema = z.object({
  name: trimmed(150).min(2, 'Enter the business name'),
  business_type: z.enum(BUSINESS_TYPES),
  country: z.string().length(2),
  currency: z.string().length(3),
  timezone: z.string().min(3).max(64),
  tax_system: z.enum(['gst', 'vat', 'simple', 'none']),
  gstin: gstinSchema,
  state_code: z.string().max(4).nullable(),
  address: optionalText(500),
  city: optionalText(100),
  pincode: optionalText(12),
  phone: phoneSchema,
  email: z.string().trim().email('Enter a valid email').max(190).nullable().or(z.literal('').transform(() => null)),
  modules: z.array(z.enum(MODULES)).optional(),
});

export const categorySchema = z.object({
  name: trimmed(120).min(1, 'Name is required'),
  parent_id: z.string().nullable(),
  color: z.string().max(20).nullable(),
  sort_order: z.number().int().min(0).max(100000),
  active: z.boolean(),
});

export const brandSchema = z.object({
  name: trimmed(120).min(1, 'Name is required'),
  active: z.boolean(),
});

export const unitSchema = z.object({
  code: trimmed(16).min(1, 'Code is required'),
  name: trimmed(60).min(1, 'Name is required'),
  allow_decimal: z.boolean(),
});

export const taxRateSchema = z
  .object({
    name: trimmed(80).min(1, 'Name is required'),
    kind: z.enum(['gst', 'vat', 'simple', 'custom', 'exempt']),
    rate: percent,
    cess_rate: percent,
    components: z
      .array(z.object({ code: trimmed(16).min(1), name: trimmed(40).min(1), rate: percent }))
      .nullable(),
    is_default: z.boolean(),
    active: z.boolean(),
  })
  .refine((t) => t.kind !== 'custom' || (t.components?.length ?? 0) > 0, {
    path: ['components'],
    message: 'Add at least one component',
  });

export const variantSchema = z.object({
  id: z.string(),
  name: trimmed(120).min(1, 'Variant name is required'),
  sku: optionalText(64),
  barcode: optionalText(64),
  attributes: z.record(z.string(), z.string()),
  purchase_price: optionalMoney('Cost'),
  selling_price: optionalMoney('Price'),
  mrp: optionalMoney('MRP'),
  active: z.boolean(),
  sort_order: z.number().int(),
});

export const modifierGroupSchema = z.object({
  id: z.string(),
  name: trimmed(60).min(1),
  min: z.number().int().min(0),
  max: z.number().int().min(1),
  options: z.array(z.object({ id: z.string(), name: trimmed(60).min(1), price: money('Price') })).min(1),
});

export const productSchema = z
  .object({
    name: trimmed(200).min(1, 'Product name is required'),
    product_type: z.enum(['standard', 'service', 'jewellery', 'weighed']),
    sku: optionalText(64),
    barcode: optionalText(64),
    barcodes: z.array(trimmed(64).min(1)).max(20),
    plu_code: optionalText(16),
    category_id: z.string().nullable(),
    brand_id: z.string().nullable(),
    unit_id: z.string().nullable(),
    description: optionalText(2000),
    hsn_code: z
      .string()
      .trim()
      .max(10)
      .nullable()
      .refine((v) => !v || /^\d{2,8}$/.test(v), 'HSN/SAC must be 2–8 digits'),
    purchase_price: money('Purchase price'),
    selling_price: money('Selling price'),
    mrp: optionalMoney('MRP'),
    min_selling_price: optionalMoney('Minimum price'),
    tax_rate_id: z.string().nullable(),
    price_includes_tax: z.boolean(),
    reorder_level: z.number().min(0).max(1_000_000),
    track_inventory: z.boolean(),
    track_batch: z.boolean(),
    track_serial: z.boolean(),
    track_expiry: z.boolean(),
    has_variants: z.boolean(),
    variant_attributes: z.array(z.object({ name: trimmed(40).min(1), values: z.array(trimmed(40).min(1)).min(1) })),
    variants: z.array(variantSchema),
    attributes: z.record(z.string(), z.unknown()),
    custom_fields: z.record(z.string(), z.unknown()),
    modifiers: z.array(modifierGroupSchema),
    price_tiers: z.array(z.object({ min_qty: z.number().positive(), price: money('Tier price') })),
    warranty_months: z.number().int().min(0).max(240).nullable(),
    image_url: z.string().nullable(),
    active: z.boolean(),
  })
  .refine((p) => p.mrp === null || p.mrp === 0 || p.selling_price <= p.mrp, {
    path: ['selling_price'],
    message: 'Selling price cannot exceed MRP',
  })
  .refine((p) => !p.has_variants || p.variants.length > 0, {
    path: ['variants'],
    message: 'Add at least one variant',
  });

export const customerSchema = z.object({
  name: trimmed(150).min(1, 'Customer name is required'),
  phone: phoneSchema,
  email: z.string().trim().email('Enter a valid email').max(190).nullable().or(z.literal('').transform(() => null)),
  address: optionalText(500),
  city: optionalText(100),
  state_code: z.string().max(4).nullable(),
  pincode: optionalText(12),
  gstin: gstinSchema,
  credit_limit: money('Credit limit'),
  opening_balance: z.number().min(-10_000_000_000).max(10_000_000_000),
  tier: optionalText(40),
  notes: optionalText(1000),
  date_of_birth: isoDate.nullable(),
  active: z.boolean(),
});

export const supplierSchema = z.object({
  name: trimmed(150).min(1, 'Supplier name is required'),
  phone: phoneSchema,
  email: z.string().trim().email('Enter a valid email').max(190).nullable().or(z.literal('').transform(() => null)),
  address: optionalText(500),
  city: optionalText(100),
  state_code: z.string().max(4).nullable(),
  gstin: gstinSchema,
  opening_balance: z.number().min(-10_000_000_000).max(10_000_000_000),
  credit_days: z.number().int().min(0).max(365),
  notes: optionalText(1000),
  active: z.boolean(),
});

export const expenseCategorySchema = z.object({
  name: trimmed(80).min(1, 'Name is required'),
  active: z.boolean(),
});

export const expenseSchema = z.object({
  category_id: z.string().nullable(),
  amount: money('Amount').refine((v) => v > 0, 'Amount must be greater than zero'),
  payment_method: z.enum(PAYMENT_METHODS),
  expense_date: isoDate,
  reference: optionalText(100),
  notes: optionalText(1000),
});

export const paymentEntrySchema = z.object({
  amount: money('Amount').refine((v) => v > 0, 'Amount must be greater than zero'),
  method: z.enum(PAYMENT_METHODS),
  reference: optionalText(100),
  payment_date: isoDate,
  notes: optionalText(500),
});

export const restaurantTableSchema = z.object({
  name: trimmed(40).min(1, 'Table name is required'),
  area: optionalText(40),
  capacity: z.number().int().min(1).max(100),
  sort_order: z.number().int().min(0),
  active: z.boolean(),
});

export const metalRateSchema = z.object({
  metal: z.enum(['gold', 'silver', 'platinum', 'diamond', 'other']),
  purity: trimmed(16).min(1),
  rate_per_gram: money('Rate').refine((v) => v > 0, 'Rate must be greater than zero'),
});

export const couponSchema = z.object({
  code: trimmed(32)
    .min(3, 'Code must be at least 3 characters')
    .regex(/^[A-Z0-9_-]+$/i, 'Use letters, numbers, - or _')
    .transform((v) => v.toUpperCase()),
  description: optionalText(200),
  discount_type: z.enum(['percent', 'amount']),
  discount_value: money('Discount').refine((v) => v > 0, 'Discount must be greater than zero'),
  min_amount: money('Minimum amount'),
  max_discount: optionalMoney('Max discount'),
  valid_from: isoDate.nullable(),
  valid_to: isoDate.nullable(),
  usage_limit: z.number().int().min(1).nullable(),
  active: z.boolean(),
});

export const storeSchema = z.object({
  name: trimmed(120).min(1, 'Store name is required'),
  code: trimmed(10).min(1, 'Code is required').regex(/^[A-Z0-9]+$/i, 'Letters and numbers only'),
  address: optionalText(500),
  phone: phoneSchema,
  gstin: gstinSchema,
  state_code: z.string().max(4).nullable(),
});

export const memberInviteSchema = z.object({
  name: trimmed(120).min(2, 'Enter a name'),
  email: emailSchema,
  phone: phoneSchema,
  role_id: z.string().min(1, 'Choose a role'),
  password: z.string().min(8, 'Use at least 8 characters').max(200),
  store_ids: z.array(z.string()).nullable(),
});

export type LoginInput = z.infer<typeof loginSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
export type BusinessInput = z.infer<typeof businessSchema>;
export type CategoryInput = z.infer<typeof categorySchema>;
export type BrandInput = z.infer<typeof brandSchema>;
export type UnitInput = z.infer<typeof unitSchema>;
export type TaxRateInput = z.infer<typeof taxRateSchema>;
export type ProductInput = z.infer<typeof productSchema>;
export type VariantInput = z.infer<typeof variantSchema>;
export type CustomerInput = z.infer<typeof customerSchema>;
export type SupplierInput = z.infer<typeof supplierSchema>;
export type ExpenseInput = z.infer<typeof expenseSchema>;
export type ExpenseCategoryInput = z.infer<typeof expenseCategorySchema>;
export type PaymentEntryInput = z.infer<typeof paymentEntrySchema>;
export type RestaurantTableInput = z.infer<typeof restaurantTableSchema>;
export type MetalRateInput = z.infer<typeof metalRateSchema>;
export type CouponInput = z.infer<typeof couponSchema>;
export type StoreInput = z.infer<typeof storeSchema>;
export type MemberInviteInput = z.infer<typeof memberInviteSchema>;
