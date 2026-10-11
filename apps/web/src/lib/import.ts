import Papa from 'papaparse';
import { strFromU8, unzipSync } from 'fflate';
import { customerSchema, productSchema, supplierSchema, uuidv7, type CustomerInput, type ProductInput, type SupplierInput } from '@shopdesk/shared';
import { db } from './db/business';
import { createCategory, createProduct } from './repos/catalog';
import { createCustomer, createSupplier } from './repos/parties';
import { adjustStock } from './repos/inventory';
import { exportCsv } from './export';

export type ImportKind = 'products' | 'customers' | 'suppliers';
export type RawRow = Record<string, string>;

export const TEMPLATES: Record<ImportKind, string[]> = {
  products: ['name', 'sku', 'barcode', 'category', 'unit', 'hsn_code', 'purchase_price', 'selling_price', 'mrp', 'gst_rate', 'price_includes_tax', 'reorder_level', 'opening_stock'],
  customers: ['name', 'phone', 'email', 'gstin', 'address', 'city', 'state_code', 'pincode', 'credit_limit', 'opening_balance'],
  suppliers: ['name', 'phone', 'email', 'gstin', 'address', 'city', 'state_code', 'credit_days', 'opening_balance'],
};

export function downloadTemplate(kind: ImportKind): void {
  const example: Record<ImportKind, Record<string, string | number>> = {
    products: { name: 'Sample Rice 1kg', sku: 'RICE1', barcode: '8901234567890', category: 'Groceries', unit: 'PCS', hsn_code: '1006', purchase_price: 52, selling_price: 60, mrp: 65, gst_rate: 5, price_includes_tax: 'yes', reorder_level: 10, opening_stock: 50 },
    customers: { name: 'Anil Kumar', phone: '9876543210', email: '', gstin: '', address: '', city: 'Kochi', state_code: '32', pincode: '682001', credit_limit: 5000, opening_balance: 0 },
    suppliers: { name: 'ABC Distributors', phone: '9876500000', email: '', gstin: '', address: '', city: 'Kochi', state_code: '32', credit_days: 30, opening_balance: 0 },
  };
  exportCsv(`${kind}-template`, TEMPLATES[kind].map((key) => ({ key, header: key })), [example[kind]]);
}

const normalizeHeader = (h: string) => h.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

/** Parse CSV or XLSX (first sheet) into rows keyed by normalized header. */
export async function parseFile(file: File): Promise<RawRow[]> {
  if (/\.xlsx$/i.test(file.name)) return parseXlsx(new Uint8Array(await file.arrayBuffer()));
  const text = await file.text();
  const result = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: 'greedy', transformHeader: normalizeHeader });
  if (result.errors.length && !result.data.length) throw new Error(result.errors[0]!.message);
  return result.data.map((row) => Object.fromEntries(Object.entries(row).map(([k, v]) => [k, String(v ?? '').trim()])));
}

/** Minimal XLSX reader: shared strings + inline strings + numbers of the first worksheet. */
export function parseXlsx(bytes: Uint8Array): RawRow[] {
  const files = unzipSync(bytes);
  const xml = (name: string) => (files[name] ? new DOMParser().parseFromString(strFromU8(files[name]!), 'application/xml') : null);
  const shared = xml('xl/sharedStrings.xml');
  const strings = shared ? Array.from(shared.getElementsByTagName('si')).map((si) => Array.from(si.getElementsByTagName('t')).map((t) => t.textContent ?? '').join('')) : [];
  const sheetName = Object.keys(files).filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n)).sort()[0];
  if (!sheetName) throw new Error('The Excel file has no worksheet.');
  const sheet = xml(sheetName)!;
  const colIndex = (ref: string) => {
    const letters = ref.replace(/\d+/g, '');
    let n = 0;
    for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
    return n - 1;
  };
  const grid: string[][] = [];
  for (const row of Array.from(sheet.getElementsByTagName('row'))) {
    const values: string[] = [];
    for (const c of Array.from(row.getElementsByTagName('c'))) {
      const type = c.getAttribute('t');
      const v = c.getElementsByTagName('v')[0]?.textContent ?? '';
      const value = type === 's' ? (strings[Number(v)] ?? '') : type === 'inlineStr' ? Array.from(c.getElementsByTagName('t')).map((t) => t.textContent ?? '').join('') : v;
      values[colIndex(c.getAttribute('r') ?? 'A1')] = value.trim();
    }
    grid.push(Array.from(values, (v) => v ?? ''));
  }
  const [header, ...body] = grid;
  if (!header) return [];
  const keys = header.map(normalizeHeader);
  return body.filter((r) => r.some((v) => v)).map((r) => Object.fromEntries(keys.map((k, i) => [k, r[i] ?? ''])));
}

const num = (v: string | undefined, fallback = 0) => {
  if (v === undefined || v.trim() === '') return fallback;
  const n = Number(v.replace(/[,₹\s]/g, ''));
  return Number.isFinite(n) ? n : NaN;
};
const text = (v: string | undefined) => (v && v.trim() ? v.trim() : null);
const bool = (v: string | undefined, fallback: boolean) => (v ? /^(1|y|yes|true)$/i.test(v.trim()) : fallback);

export interface Validated<T> {
  row: number;
  data: T | null;
  errors: string[];
  extra: { category?: string | null; unit?: string | null; gst_rate?: number | null; opening_stock?: number };
}

export async function validateRows(kind: ImportKind, rows: RawRow[]): Promise<Array<Validated<ProductInput | CustomerInput | SupplierInput>>> {
  const out: Array<Validated<ProductInput | CustomerInput | SupplierInput>> = [];
  const seen = new Set<string>();
  const existingCodes = new Set((await db().products.toArray()).filter((p) => !p.deleted_at).flatMap((p) => p.codes ?? []));
  const existingPhones = new Set((await (kind === 'customers' ? db().customers : db().suppliers).toArray()).filter((c) => !c.deleted_at).map((c) => c.phone).filter(Boolean));

  rows.forEach((r, index) => {
    const errors: string[] = [];
    let data: ProductInput | CustomerInput | SupplierInput | null = null;
    const extra: Validated<ProductInput>['extra'] = {};
    if (kind === 'products') {
      const gst = r.gst_rate ? num(r.gst_rate) : null;
      extra.category = text(r.category);
      extra.unit = text(r.unit)?.toUpperCase() ?? null;
      extra.gst_rate = gst;
      extra.opening_stock = num(r.opening_stock);
      const parsed = productSchema.safeParse({
        name: r.name ?? '',
        product_type: 'standard',
        sku: text(r.sku),
        barcode: text(r.barcode),
        barcodes: [],
        plu_code: null,
        category_id: null,
        brand_id: null,
        unit_id: null,
        description: null,
        hsn_code: text(r.hsn_code ?? r.hsn),
        purchase_price: num(r.purchase_price ?? r.cost),
        selling_price: num(r.selling_price ?? r.price),
        mrp: r.mrp ? num(r.mrp) : null,
        min_selling_price: null,
        tax_rate_id: null,
        price_includes_tax: bool(r.price_includes_tax, true),
        reorder_level: num(r.reorder_level),
        track_inventory: true,
        track_batch: false,
        track_serial: false,
        track_expiry: false,
        has_variants: false,
        variant_attributes: [],
        variants: [],
        attributes: {},
        custom_fields: {},
        modifiers: [],
        price_tiers: [],
        warranty_months: null,
        image_url: null,
        active: true,
      });
      if (!parsed.success) errors.push(...parsed.error.issues.map((i) => `${String(i.path[0] ?? '')}: ${i.message}`));
      else data = parsed.data;
      for (const code of [r.sku, r.barcode].map((c) => c?.trim().toLowerCase()).filter((c): c is string => !!c)) {
        if (existingCodes.has(code)) errors.push(`Code ${code} already exists`);
        if (seen.has(code)) errors.push(`Code ${code} repeated in file`);
        seen.add(code);
      }
      if (Number.isNaN(extra.opening_stock) || (extra.opening_stock ?? 0) < 0) errors.push('opening_stock must be a positive number');
      if (gst !== null && (Number.isNaN(gst) || gst < 0 || gst > 100)) errors.push('gst_rate must be between 0 and 100');
    } else {
      const base = {
        name: r.name ?? '',
        phone: text(r.phone ?? r.mobile),
        email: text(r.email),
        address: text(r.address),
        city: text(r.city),
        state_code: text(r.state_code),
        gstin: text(r.gstin)?.toUpperCase() ?? null,
        opening_balance: num(r.opening_balance),
        notes: null,
        active: true,
      };
      const parsed =
        kind === 'customers'
          ? customerSchema.safeParse({ ...base, pincode: text(r.pincode), credit_limit: num(r.credit_limit), tier: text(r.tier), date_of_birth: null })
          : supplierSchema.safeParse({ ...base, credit_days: num(r.credit_days) });
      if (!parsed.success) errors.push(...parsed.error.issues.map((i) => `${String(i.path[0] ?? '')}: ${i.message}`));
      else data = parsed.data;
      if (base.phone) {
        if (existingPhones.has(base.phone)) errors.push(`Phone ${base.phone} already exists`);
        if (seen.has(base.phone)) errors.push(`Phone ${base.phone} repeated in file`);
        seen.add(base.phone);
      }
    }
    out.push({ row: index + 2, data: errors.length ? null : data, errors, extra });
  });
  return out;
}

/** Import the valid rows (offline-safe: each record is a normal local create + sync operation). */
export async function importRows(kind: ImportKind, rows: Array<Validated<ProductInput | CustomerInput | SupplierInput>>, onProgress?: (done: number) => void): Promise<number> {
  let done = 0;
  if (kind === 'products') {
    const categories = new Map((await db().categories.filter((c) => !c.deleted_at).toArray()).map((c) => [c.name.toLowerCase(), c.id]));
    const units = new Map((await db().units.toArray()).map((u) => [u.code.toUpperCase(), u.id]));
    const taxes = (await db().tax_rates.filter((x) => !x.deleted_at && x.active).toArray());
    const defaultUnit = units.get('PCS') ?? null;
    const stock: Parameters<typeof adjustStock>[1] = [];
    for (const r of rows) {
      if (!r.data) continue;
      const input = r.data as ProductInput;
      let categoryId: string | null = null;
      if (r.extra.category) {
        categoryId = categories.get(r.extra.category.toLowerCase()) ?? null;
        if (!categoryId) {
          const created = await createCategory({ name: r.extra.category, parent_id: null, color: null, sort_order: categories.size, active: true });
          categories.set(r.extra.category.toLowerCase(), created.id);
          categoryId = created.id;
        }
      }
      const tax = r.extra.gst_rate !== null && r.extra.gst_rate !== undefined ? taxes.find((x) => x.kind === 'gst' && x.rate === r.extra.gst_rate) ?? taxes.find((x) => x.rate === r.extra.gst_rate) : taxes.find((x) => x.is_default);
      const id = uuidv7();
      await createProduct({ ...input, category_id: categoryId, unit_id: (r.extra.unit && units.get(r.extra.unit)) || defaultUnit, tax_rate_id: tax?.id ?? null }, id);
      if (r.extra.opening_stock) stock.push({ product_id: id, variant_id: null, batch_id: null, quantity: r.extra.opening_stock, unit_cost: input.purchase_price });
      done++;
      onProgress?.(done);
    }
    // One adjustment document for all opening stock, in chunks to keep transactions small.
    for (let i = 0; i < stock.length; i += 200) await adjustStock('opening_stock', stock.slice(i, i + 200), 'Opening stock (import)');
    return done;
  }
  for (const r of rows) {
    if (!r.data) continue;
    if (kind === 'customers') await createCustomer(r.data as CustomerInput);
    else await createSupplier(r.data as SupplierInput);
    done++;
    onProgress?.(done);
  }
  return done;
}
