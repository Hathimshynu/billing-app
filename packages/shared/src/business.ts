/**
 * Business types and the industry modules they enable. A single core POS is extended by modules;
 * business type only chooses sensible defaults (modules can be toggled later in settings).
 * Mirrored in PHP by App\Domain\Business\BusinessTypes.
 */

export const BUSINESS_TYPES = [
  'supermarket',
  'pharmacy',
  'jewellery',
  'mobile',
  'electronics',
  'clothing',
  'hardware',
  'bakery',
  'restaurant',
  'general',
  'wholesale',
  'service',
  'custom',
] as const;
export type BusinessType = (typeof BUSINESS_TYPES)[number];

export const MODULES = [
  'batches',
  'expiry',
  'serials',
  'warranty',
  'variants',
  'weighing',
  'jewellery',
  'restaurant',
  'prescription',
  'loyalty',
  'wholesale_pricing',
  'services',
] as const;
export type ModuleKey = (typeof MODULES)[number];

export interface BusinessTypeDef {
  type: BusinessType;
  label: string;
  description: string;
  icon: string;
  modules: ModuleKey[];
  defaultCategories: string[];
  defaultUnits: string[];
  defaultTaxRates: number[];
  pricesIncludeTax: boolean;
}

export const MODULE_LABELS: Record<ModuleKey, { label: string; description: string }> = {
  batches: { label: 'Batch tracking', description: 'Stock by batch with batch-wise MRP & cost' },
  expiry: { label: 'Expiry tracking', description: 'Expiry dates, FEFO selling and near-expiry alerts' },
  serials: { label: 'Serial / IMEI tracking', description: 'Track every unit by serial number or IMEI' },
  warranty: { label: 'Warranty', description: 'Warranty periods and warranty lookup' },
  variants: { label: 'Variants', description: 'Size / colour / pack-size variants with own SKU & stock' },
  weighing: { label: 'Weighing scale', description: 'Weight-based items and scale barcodes' },
  jewellery: { label: 'Jewellery', description: 'Metal rates, weights, making charges, old gold exchange' },
  restaurant: { label: 'Restaurant', description: 'Tables, KOT, kitchen display, modifiers' },
  prescription: { label: 'Prescriptions', description: 'Prescription-required medicines and doctor details' },
  loyalty: { label: 'Loyalty', description: 'Points, tiers and coupons' },
  wholesale_pricing: { label: 'Wholesale pricing', description: 'Quantity based price tiers' },
  services: { label: 'Services', description: 'Non-stock service items (SAC codes)' },
};

export const BUSINESS_TYPE_DEFS: Record<BusinessType, BusinessTypeDef> = {
  supermarket: {
    type: 'supermarket',
    label: 'Supermarket / Grocery',
    description: 'Barcodes, loose items by weight, expiry and offers',
    icon: 'shopping-basket',
    modules: ['weighing', 'expiry', 'loyalty', 'variants'],
    defaultCategories: ['Groceries', 'Fruits & Vegetables', 'Dairy', 'Beverages', 'Snacks', 'Personal Care', 'Household'],
    defaultUnits: ['pcs', 'kg', 'g', 'l', 'ml', 'pkt', 'box', 'dozen'],
    defaultTaxRates: [0, 5, 12, 18],
    pricesIncludeTax: true,
  },
  pharmacy: {
    type: 'pharmacy',
    label: 'Medical Shop / Pharmacy',
    description: 'Batch & expiry tracking with FEFO, schedules and prescriptions',
    icon: 'pill',
    modules: ['batches', 'expiry', 'prescription'],
    defaultCategories: ['Tablets', 'Capsules', 'Syrups', 'Injections', 'Ointments', 'Surgical', 'OTC', 'Personal Care'],
    defaultUnits: ['strip', 'pcs', 'bottle', 'box', 'tube', 'vial'],
    defaultTaxRates: [0, 5, 12, 18],
    pricesIncludeTax: true,
  },
  jewellery: {
    type: 'jewellery',
    label: 'Jewellery',
    description: 'Daily metal rates, weights, making charges and old gold exchange',
    icon: 'gem',
    modules: ['jewellery'],
    defaultCategories: ['Gold Ornaments', 'Silver Ornaments', 'Diamond', 'Platinum', 'Coins & Bars'],
    defaultUnits: ['pcs', 'g'],
    defaultTaxRates: [3],
    pricesIncludeTax: false,
  },
  mobile: {
    type: 'mobile',
    label: 'Mobile Phone Shop',
    description: 'IMEI tracking, warranty and accessories',
    icon: 'smartphone',
    modules: ['serials', 'warranty', 'variants'],
    defaultCategories: ['Smartphones', 'Feature Phones', 'Chargers', 'Cables', 'Cases', 'Screen Protectors', 'Earbuds', 'Power Banks'],
    defaultUnits: ['pcs'],
    defaultTaxRates: [18],
    pricesIncludeTax: true,
  },
  electronics: {
    type: 'electronics',
    label: 'Electronics',
    description: 'Serial numbers, warranty and model variants',
    icon: 'tv',
    modules: ['serials', 'warranty', 'variants'],
    defaultCategories: ['Televisions', 'Laptops', 'Appliances', 'Audio', 'Accessories'],
    defaultUnits: ['pcs'],
    defaultTaxRates: [18, 28],
    pricesIncludeTax: true,
  },
  clothing: {
    type: 'clothing',
    label: 'Clothing / Fashion',
    description: 'Size & colour variants with per-variant barcodes',
    icon: 'shirt',
    modules: ['variants'],
    defaultCategories: ['Men', 'Women', 'Kids', 'Footwear', 'Accessories'],
    defaultUnits: ['pcs'],
    defaultTaxRates: [5, 12],
    pricesIncludeTax: true,
  },
  hardware: {
    type: 'hardware',
    label: 'Hardware',
    description: 'Many units of measure and wholesale pricing',
    icon: 'hammer',
    modules: ['variants', 'wholesale_pricing'],
    defaultCategories: ['Tools', 'Fasteners', 'Electrical', 'Plumbing', 'Paints', 'Building Material'],
    defaultUnits: ['pcs', 'kg', 'm', 'ft', 'box', 'bag', 'l'],
    defaultTaxRates: [18, 28],
    pricesIncludeTax: true,
  },
  bakery: {
    type: 'bakery',
    label: 'Bakery',
    description: 'Fresh items by weight, expiry and quick counter billing',
    icon: 'croissant',
    modules: ['weighing', 'expiry'],
    defaultCategories: ['Breads', 'Cakes', 'Pastries', 'Cookies', 'Snacks', 'Beverages'],
    defaultUnits: ['pcs', 'kg', 'g'],
    defaultTaxRates: [0, 5, 18],
    pricesIncludeTax: true,
  },
  restaurant: {
    type: 'restaurant',
    label: 'Restaurant / Cafe',
    description: 'Tables, KOT, kitchen display, dine-in / takeaway / delivery',
    icon: 'utensils',
    modules: ['restaurant'],
    defaultCategories: ['Starters', 'Main Course', 'Breads', 'Rice', 'Desserts', 'Beverages'],
    defaultUnits: ['plate', 'pcs', 'glass'],
    defaultTaxRates: [5],
    pricesIncludeTax: false,
  },
  general: {
    type: 'general',
    label: 'General Retail',
    description: 'Everything a retail counter needs',
    icon: 'store',
    modules: ['variants'],
    defaultCategories: ['General'],
    defaultUnits: ['pcs', 'kg', 'box'],
    defaultTaxRates: [0, 5, 12, 18, 28],
    pricesIncludeTax: true,
  },
  wholesale: {
    type: 'wholesale',
    label: 'Wholesale',
    description: 'Credit customers, quantity pricing and bulk units',
    icon: 'warehouse',
    modules: ['wholesale_pricing', 'variants'],
    defaultCategories: ['General'],
    defaultUnits: ['pcs', 'box', 'case', 'kg', 'bag'],
    defaultTaxRates: [0, 5, 12, 18, 28],
    pricesIncludeTax: false,
  },
  service: {
    type: 'service',
    label: 'Service Business',
    description: 'Service items with SAC codes, no stock',
    icon: 'wrench',
    modules: ['services'],
    defaultCategories: ['Services'],
    defaultUnits: ['hr', 'job', 'pcs'],
    defaultTaxRates: [18],
    pricesIncludeTax: false,
  },
  custom: {
    type: 'custom',
    label: 'Custom',
    description: 'Start minimal and switch on the modules you need',
    icon: 'settings',
    modules: [],
    defaultCategories: ['General'],
    defaultUnits: ['pcs'],
    defaultTaxRates: [0, 18],
    pricesIncludeTax: true,
  },
};

export interface UnitDef {
  code: string;
  name: string;
  allow_decimal: boolean;
}

export const STANDARD_UNITS: UnitDef[] = [
  { code: 'pcs', name: 'Piece', allow_decimal: false },
  { code: 'kg', name: 'Kilogram', allow_decimal: true },
  { code: 'g', name: 'Gram', allow_decimal: true },
  { code: 'l', name: 'Litre', allow_decimal: true },
  { code: 'ml', name: 'Millilitre', allow_decimal: true },
  { code: 'm', name: 'Metre', allow_decimal: true },
  { code: 'ft', name: 'Feet', allow_decimal: true },
  { code: 'pkt', name: 'Packet', allow_decimal: false },
  { code: 'box', name: 'Box', allow_decimal: false },
  { code: 'case', name: 'Case', allow_decimal: false },
  { code: 'bag', name: 'Bag', allow_decimal: false },
  { code: 'dozen', name: 'Dozen', allow_decimal: true },
  { code: 'strip', name: 'Strip', allow_decimal: false },
  { code: 'bottle', name: 'Bottle', allow_decimal: false },
  { code: 'tube', name: 'Tube', allow_decimal: false },
  { code: 'vial', name: 'Vial', allow_decimal: false },
  { code: 'plate', name: 'Plate', allow_decimal: true },
  { code: 'glass', name: 'Glass', allow_decimal: false },
  { code: 'hr', name: 'Hour', allow_decimal: true },
  { code: 'job', name: 'Job', allow_decimal: false },
];

export const PAYMENT_METHODS = [
  'cash',
  'upi',
  'card',
  'bank_transfer',
  'wallet',
  'credit',
  'credit_note',
  'old_gold',
  'loyalty',
  'other',
] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: 'Cash',
  upi: 'UPI',
  card: 'Card',
  bank_transfer: 'Bank Transfer',
  wallet: 'Wallet',
  credit: 'Credit',
  credit_note: 'Credit Note',
  old_gold: 'Old Gold',
  loyalty: 'Loyalty Points',
  other: 'Other',
};

/** Tenders that do not represent money received now (affect customer ledger instead). */
export const NON_CASH_SETTLEMENT_METHODS: PaymentMethod[] = ['credit'];

export const EXPENSE_CATEGORIES = [
  'Rent',
  'Electricity',
  'Salary',
  'Transportation',
  'Supplier Payment',
  'Maintenance',
  'Internet & Phone',
  'Miscellaneous',
];

export const INDIAN_STATES: Array<{ code: string; name: string; ut?: boolean }> = [
  { code: '01', name: 'Jammu and Kashmir', ut: true },
  { code: '02', name: 'Himachal Pradesh' },
  { code: '03', name: 'Punjab' },
  { code: '04', name: 'Chandigarh', ut: true },
  { code: '05', name: 'Uttarakhand' },
  { code: '06', name: 'Haryana' },
  { code: '07', name: 'Delhi' },
  { code: '08', name: 'Rajasthan' },
  { code: '09', name: 'Uttar Pradesh' },
  { code: '10', name: 'Bihar' },
  { code: '11', name: 'Sikkim' },
  { code: '12', name: 'Arunachal Pradesh' },
  { code: '13', name: 'Nagaland' },
  { code: '14', name: 'Manipur' },
  { code: '15', name: 'Mizoram' },
  { code: '16', name: 'Tripura' },
  { code: '17', name: 'Meghalaya' },
  { code: '18', name: 'Assam' },
  { code: '19', name: 'West Bengal' },
  { code: '20', name: 'Jharkhand' },
  { code: '21', name: 'Odisha' },
  { code: '22', name: 'Chhattisgarh' },
  { code: '23', name: 'Madhya Pradesh' },
  { code: '24', name: 'Gujarat' },
  { code: '26', name: 'Dadra and Nagar Haveli and Daman and Diu', ut: true },
  { code: '27', name: 'Maharashtra' },
  { code: '29', name: 'Karnataka' },
  { code: '30', name: 'Goa' },
  { code: '31', name: 'Lakshadweep', ut: true },
  { code: '32', name: 'Kerala' },
  { code: '33', name: 'Tamil Nadu' },
  { code: '34', name: 'Puducherry', ut: true },
  { code: '35', name: 'Andaman and Nicobar Islands', ut: true },
  { code: '36', name: 'Telangana' },
  { code: '37', name: 'Andhra Pradesh' },
  { code: '38', name: 'Ladakh', ut: true },
  { code: '97', name: 'Other Territory', ut: true },
];

export const COUNTRY_PRESETS: Record<string, { currency: string; locale: string; timezone: string; taxSystem: 'gst' | 'vat' | 'simple'; dateFormat: 'DD/MM/YYYY' | 'MM/DD/YYYY' | 'YYYY-MM-DD'; phoneCode: string }> = {
  IN: { currency: 'INR', locale: 'en-IN', timezone: 'Asia/Kolkata', taxSystem: 'gst', dateFormat: 'DD/MM/YYYY', phoneCode: '+91' },
  AE: { currency: 'AED', locale: 'en-AE', timezone: 'Asia/Dubai', taxSystem: 'vat', dateFormat: 'DD/MM/YYYY', phoneCode: '+971' },
  GB: { currency: 'GBP', locale: 'en-GB', timezone: 'Europe/London', taxSystem: 'vat', dateFormat: 'DD/MM/YYYY', phoneCode: '+44' },
  US: { currency: 'USD', locale: 'en-US', timezone: 'America/New_York', taxSystem: 'simple', dateFormat: 'MM/DD/YYYY', phoneCode: '+1' },
  SG: { currency: 'SGD', locale: 'en-SG', timezone: 'Asia/Singapore', taxSystem: 'vat', dateFormat: 'DD/MM/YYYY', phoneCode: '+65' },
};

/** Indian mobile number: 10 digits starting 6-9, optional +91 / 0 prefix. */
export function isValidIndianMobile(value: string): boolean {
  const digits = value.replace(/[\s-]/g, '').replace(/^(\+91|91|0)/, '');
  return /^[6-9]\d{9}$/.test(digits);
}
