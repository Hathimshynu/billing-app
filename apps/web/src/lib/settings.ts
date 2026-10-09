import { useLiveQuery } from 'dexie-react-hooks';
import {
  DEFAULT_SCALE_BARCODE_CONFIG,
  type InvoiceSettings,
  type LoyaltySettings,
  type NotificationSettings,
  type PosSettings,
  type PrinterSettings,
} from '@shopdesk/shared';
import { db, hasDb } from './db/business';

/** Defaults mirror App\Services\Business\BusinessService::defaultSettings(). */
export const SETTING_DEFAULTS = {
  invoice: {
    formats: {},
    terms: 'Goods once sold will not be taken back without the bill.',
    footer: 'Thank you for shopping with us!',
    show_hsn_summary: true,
    show_mrp_savings: true,
    round_off: '1.00',
    default_doc_type: 'invoice',
    number_block_size: 50,
    quotation_validity_days: 15,
    upi_id: null,
    bank_details: null,
  } satisfies InvoiceSettings as InvoiceSettings,
  pos: {
    allow_negative_stock: true,
    default_customer_required: false,
    quick_amounts: [100, 200, 500, 2000],
    enabled_payment_methods: ['cash', 'upi', 'card', 'credit'],
    print_after_sale: true,
    require_register: false,
    scale_barcode: DEFAULT_SCALE_BARCODE_CONFIG,
    near_expiry_days: 90,
    max_discount_percent: 100,
    service_charge_percent: 0,
    service_charge_tax_rate_id: null,
    shortcuts: {},
    product_grid: 'grid',
  } satisfies PosSettings as PosSettings,
  printer: {
    paper: '80mm',
    connection: 'browser',
    copies: 1,
    show_logo: true,
    header_text: '',
    footer_text: '',
    kot_paper: '80mm',
  } satisfies PrinterSettings as PrinterSettings,
  loyalty: {
    enabled: false,
    earn_per_100: 1,
    point_value: 1,
    min_redeem_points: 50,
    tiers: [],
  } satisfies LoyaltySettings as LoyaltySettings,
  notifications: {
    low_stock: true,
    expiry: true,
    near_expiry_days: 90,
    customer_dues: true,
    supplier_dues: true,
    register_mismatch: true,
    sync_failed: true,
  } satisfies NotificationSettings as NotificationSettings,
};

export type SettingKeyName = keyof typeof SETTING_DEFAULTS;
export type SettingValue<K extends SettingKeyName> = (typeof SETTING_DEFAULTS)[K];

export async function getSetting<K extends SettingKeyName>(key: K): Promise<SettingValue<K>> {
  const row = await db().settings.where('key').equals(key).first();
  return { ...SETTING_DEFAULTS[key], ...((row?.value ?? {}) as object) } as SettingValue<K>;
}

/** Live settings with defaults applied. */
export function useSetting<K extends SettingKeyName>(key: K): SettingValue<K> {
  const value = useLiveQuery(async () => (hasDb() ? (await db().settings.where('key').equals(key).first())?.value : undefined), [key]);
  return { ...SETTING_DEFAULTS[key], ...((value ?? {}) as object) } as SettingValue<K>;
}
