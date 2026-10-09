import { describe, expect, it } from 'vitest';
import { calculatePricing, effectiveTaxRate, gstSupplyType, isValidGstin, resolveTaxComponents } from '../tax';
import {
  DEFAULT_SCALE_BARCODE_CONFIG,
  generateInternalEan13,
  gs1CheckDigit,
  isValidGtin,
  looksLikeScannerInput,
  normalizeBarcode,
  parseScaleBarcode,
} from '../barcode';
import { allocateFefo, expiryStatus } from '../fefo';
import { isPerDeviceSeries, provisionalNumber } from '../numbering';
import { isUuid, stockKey, uuidv7 } from '../ids';
import { addDays, businessDate, formatDateString } from '../dates';
import { DEFAULT_ROLES, hasPermission } from '../permissions';
import { BUSINESS_TYPE_DEFS, isValidIndianMobile } from '../business';
import { backoffDelay } from '../sync';
import { customerSchema, productSchema, registerSchema } from '../schemas';

describe('tax engine', () => {
  it('splits GST by supply type', () => {
    const gst = { name: 'GST 18%', kind: 'gst' as const, rate: 18 };
    expect(resolveTaxComponents(gst, 'intra').map((c) => c.code)).toEqual(['CGST', 'SGST']);
    expect(resolveTaxComponents(gst, 'inter').map((c) => c.code)).toEqual(['IGST']);
    expect(resolveTaxComponents(gst, 'union_territory').map((c) => c.code)).toEqual(['CGST', 'UTGST']);
    expect(resolveTaxComponents({ name: 'Exempt', kind: 'exempt', rate: 0 })).toEqual([]);
    expect(effectiveTaxRate({ name: 'x', kind: 'gst', rate: 28, cess_rate: 12 })).toBe(40);
  });

  it('keeps taxable + tax equal to the inclusive amount for every line', () => {
    const prices = [1, 9.99, 10, 49.5, 99.99, 118, 249, 999.99, 1234.56];
    const rates = [0.25, 3, 5, 12, 18, 28];
    for (const price of prices) {
      for (const rate of rates) {
        const result = calculatePricing({
          lines: [{ key: 'x', quantity: 1, unit_price: price, price_includes_tax: true, tax: { name: 'GST', kind: 'gst', rate } }],
        });
        const line = result.lines[0]!;
        expect(Math.round((line.taxable + line.tax_total) * 100)).toBe(Math.round(price * 100));
        // CGST and SGST are always equal
        expect(line.taxes[0]!.amount).toBe(line.taxes[1]!.amount);
      }
    }
  });

  it('identity: gross - discount + exclusive tax + charges + round off = grand total', () => {
    const result = calculatePricing({
      supply_type: 'intra',
      bill_discount_type: 'percent',
      bill_discount_value: 7.5,
      round_off: '1.00',
      lines: [
        { key: 'a', quantity: 3, unit_price: 47.25, price_includes_tax: true, tax: { name: 'GST 12%', kind: 'gst', rate: 12 } },
        { key: 'b', quantity: 1.75, unit_price: 88, price_includes_tax: false, discount_type: 'amount', discount_value: 4, tax: { name: 'GST 5%', kind: 'gst', rate: 5 } },
        { key: 'c', quantity: 2, unit_price: 15, price_includes_tax: false, tax: null },
      ],
      charges: [{ key: 'pack', name: 'Packing', amount: 20, tax: { name: 'GST 18%', kind: 'gst', rate: 18 } }],
    });
    const lhs = result.gross_total - result.discount_total + result.tax_exclusive_total + result.charges_total + result.round_off;
    expect(Math.round(lhs * 100)).toBe(Math.round(result.grand_total * 100));
    expect(result.grand_total % 1).toBe(0);
  });

  it('caps discounts at the line value', () => {
    const result = calculatePricing({
      lines: [{ key: 'a', quantity: 1, unit_price: 50, price_includes_tax: false, discount_type: 'amount', discount_value: 80, tax: null }],
    });
    expect(result.lines[0]!.line_discount).toBe(50);
    expect(result.grand_total).toBe(0);
  });

  it('derives supply type from state codes', () => {
    expect(gstSupplyType('32', '32')).toBe('intra');
    expect(gstSupplyType('32', '33')).toBe('inter');
    expect(gstSupplyType('32', null)).toBe('intra');
  });

  it('validates GSTIN checksums', () => {
    expect(isValidGstin('27AAPFU0939F1ZV')).toBe(true);
    expect(isValidGstin('27AAPFU0939F1ZX')).toBe(false);
    expect(isValidGstin('ABC')).toBe(false);
  });
});

describe('barcodes', () => {
  it('computes GS1 check digits', () => {
    expect(gs1CheckDigit('890123456789')).toBe(0);
    expect(isValidGtin('8901234567890')).toBe(true);
    expect(isValidGtin('8901234567891')).toBe(false);
    expect(isValidGtin(generateInternalEan13(42))).toBe(true);
  });

  it('parses weighing scale labels', () => {
    const config = { ...DEFAULT_SCALE_BARCODE_CONFIG, enabled: true };
    const body = '201234' + '01250';
    const code = body + gs1CheckDigit(body);
    expect(parseScaleBarcode(code, config)).toEqual({ item_code: '01234', value_type: 'weight', value: 1.25 });
    expect(parseScaleBarcode('8901234567890', config)).toBeNull();
    expect(parseScaleBarcode(code, { ...config, enabled: false })).toBeNull();
  });

  it('normalizes scanner input and detects scanner bursts', () => {
    expect(normalizeBarcode(' 890123\r\n')).toBe('890123');
    expect(looksLikeScannerInput([0, 10, 20, 30, 40, 50])).toBe(true);
    expect(looksLikeScannerInput([0, 150, 300, 450, 600])).toBe(false);
  });
});

describe('FEFO allocation', () => {
  const batches = [
    { batch_id: 'late', expiry_date: '2028-08-31', available: 100 },
    { batch_id: 'soon', expiry_date: '2026-11-30', available: 5 },
    { batch_id: 'expired', expiry_date: '2026-01-31', available: 10 },
    { batch_id: 'never', expiry_date: null, available: 50 },
  ];

  it('sells earliest expiry first and skips expired stock', () => {
    const result = allocateFefo(batches, 8, '2026-10-08');
    expect(result.allocations).toEqual([
      { batch_id: 'soon', quantity: 5, expired: false },
      { batch_id: 'late', quantity: 3, expired: false },
    ]);
    expect(result.shortfall).toBe(0);
    expect(result.usedExpired).toBe(false);
  });

  it('only uses expired stock when explicitly allowed', () => {
    const result = allocateFefo(batches, 2, '2026-10-08', { allowExpired: true });
    expect(result.allocations[0]).toEqual({ batch_id: 'expired', quantity: 2, expired: true });
    expect(result.usedExpired).toBe(true);
  });

  it('reports shortfall', () => {
    expect(allocateFefo(batches, 200, '2026-10-08').shortfall).toBe(45);
  });

  it('classifies expiry', () => {
    expect(expiryStatus('2026-01-01', '2026-10-08')).toBe('expired');
    expect(expiryStatus('2026-11-01', '2026-10-08')).toBe('near_expiry');
    expect(expiryStatus('2028-01-01', '2026-10-08')).toBe('ok');
    expect(expiryStatus(null, '2026-10-08')).toBe('none');
  });
});

describe('identifiers and numbering', () => {
  it('generates sortable unique UUIDv7 values', () => {
    const ids = Array.from({ length: 500 }, () => uuidv7());
    expect(new Set(ids).size).toBe(500);
    expect(ids.every(isUuid)).toBe(true);
    expect([...ids].sort()).toEqual(ids);
    expect(ids[0]!.charAt(14)).toBe('7');
  });

  it('builds stock keys and provisional numbers', () => {
    expect(stockKey('s', 'p')).toBe('s|p||');
    expect(stockKey('s', 'p', 'v', 'b')).toBe('s|p|v|b');
    expect(provisionalNumber('C1', 3)).toBe('TMP-C1-00003');
    expect(isPerDeviceSeries('INV-{DEVICE}-{SEQ}')).toBe(true);
  });
});

describe('dates', () => {
  it('uses the business timezone for the business date', () => {
    // 20:00 UTC on 8 Oct is already 9 Oct in India
    expect(businessDate('2026-10-08T20:00:00Z', 'Asia/Kolkata')).toBe('2026-10-09');
    expect(businessDate('2026-10-08T20:00:00Z', 'UTC')).toBe('2026-10-08');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(formatDateString('2026-10-08')).toBe('08/10/2026');
  });
});

describe('permissions & business types', () => {
  it('grants owners everything and cashiers a subset', () => {
    expect(hasPermission(DEFAULT_ROLES.owner.permissions, 'settings.manage')).toBe(true);
    expect(hasPermission(DEFAULT_ROLES.cashier.permissions, 'sales.create')).toBe(true);
    expect(hasPermission(DEFAULT_ROLES.cashier.permissions, 'sales.refund')).toBe(false);
    expect(hasPermission(DEFAULT_ROLES.cashier.permissions, ['sales.create', 'products.delete'])).toBe(false);
  });

  it('maps business types to modules', () => {
    expect(BUSINESS_TYPE_DEFS.pharmacy.modules).toContain('batches');
    expect(BUSINESS_TYPE_DEFS.jewellery.modules).toContain('jewellery');
    expect(BUSINESS_TYPE_DEFS.mobile.modules).toContain('serials');
    expect(BUSINESS_TYPE_DEFS.restaurant.modules).toContain('restaurant');
  });

  it('validates Indian mobile numbers', () => {
    expect(isValidIndianMobile('+91 98765 43210')).toBe(true);
    expect(isValidIndianMobile('09876543210')).toBe(true);
    expect(isValidIndianMobile('12345')).toBe(false);
  });
});

describe('sync helpers', () => {
  it('backs off exponentially with a cap', () => {
    expect(backoffDelay(0, 2000, 300_000, () => 1)).toBe(2000);
    expect(backoffDelay(3, 2000, 300_000, () => 1)).toBe(16000);
    expect(backoffDelay(20, 2000, 300_000, () => 1)).toBe(300_000);
    expect(backoffDelay(3, 2000, 300_000, () => 0)).toBe(8000);
  });
});

describe('validation schemas', () => {
  const baseProduct = {
    name: 'Paracetamol 500mg',
    product_type: 'standard',
    sku: 'PCM500',
    barcode: null,
    barcodes: [],
    plu_code: null,
    category_id: null,
    brand_id: null,
    unit_id: null,
    description: null,
    hsn_code: '3004',
    purchase_price: 15,
    selling_price: 22,
    mrp: 25,
    min_selling_price: null,
    tax_rate_id: null,
    price_includes_tax: true,
    reorder_level: 10,
    track_inventory: true,
    track_batch: true,
    track_serial: false,
    track_expiry: true,
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
  };

  it('accepts a valid product and rejects price above MRP', () => {
    expect(productSchema.safeParse(baseProduct).success).toBe(true);
    const invalid = productSchema.safeParse({ ...baseProduct, selling_price: 30 });
    expect(invalid.success).toBe(false);
  });

  it('validates customers and registration', () => {
    expect(
      customerSchema.safeParse({
        name: 'Anil',
        phone: '9876543210',
        email: '',
        address: null,
        city: null,
        state_code: '32',
        pincode: null,
        gstin: null,
        credit_limit: 5000,
        opening_balance: 0,
        tier: null,
        notes: null,
        date_of_birth: null,
        active: true,
      }).success,
    ).toBe(true);
    expect(
      registerSchema.safeParse({ name: 'A B', email: 'a@b.co', phone: null, password: 'secret123', password_confirmation: 'nope' })
        .success,
    ).toBe(false);
  });
});
