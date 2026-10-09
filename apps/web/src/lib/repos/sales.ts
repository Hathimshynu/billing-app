import {
  addDays,
  businessDate,
  fromScaled,
  mulDivRound,
  QTY_SCALE,
  roundTo,
  toScaled,
  uuidv7,
  type DocumentType,
  type OldGoldDetails,
  type PaymentMethod,
  type PricingResult,
  type RefundMethod,
  type RoundOffMode,
  type Sale,
  type SaleItem,
  type SalePayment,
  type SaleReturn,
  type SaleReturnItem,
  type SupplyType,
} from '@shopdesk/shared';
import { db, type LocalSale } from '../db/business';
import { deriveSale } from '../db/derive';
import { effectiveUnitPrice, type CartState } from '../pos/cart';
import { runtime } from '../runtime';
import { getSetting } from '../settings';
import { allocateNumber } from '../sync/numbers';
import { enqueue, mutate } from '../sync/outbox';
import { newEntityBase, nowIso, recordMovement, toPayload } from './base';
import { customerLedgerEntry } from './parties';

export interface PaymentInput {
  method: PaymentMethod;
  amount: number;
  reference?: string | null;
  tendered?: number | null;
  change?: number | null;
  old_gold?: OldGoldDetails | null;
}

export interface CompleteSaleInput {
  cart: CartState;
  pricing: PricingResult;
  payments: PaymentInput[];
  supplyType: SupplyType;
  roundOff: RoundOffMode;
  registerId: string | null;
  loyaltyEarned?: number;
}

const DOC_SERIES: Record<string, DocumentType> = {
  invoice: 'sale',
  quotation: 'quotation',
  estimate: 'estimate',
  proforma: 'proforma',
  delivery_challan: 'delivery_challan',
};

const STOCK_DOC_TYPES = new Set(['invoice', 'delivery_challan']);

/**
 * Complete a sale (or save a quotation / estimate / proforma / challan) entirely offline.
 * Everything — the document, stock movements, IMEI status, ledger, outbox operation — is written
 * in ONE IndexedDB transaction. If the browser closes mid-way nothing is half-written.
 */
export async function completeSale(input: CompleteSaleInput): Promise<LocalSale> {
  const rt = runtime();
  const database = db();
  const { cart, pricing } = input;
  if (cart.lines.length === 0) throw new Error('Add at least one item.');
  const isInvoice = cart.doc_type === 'invoice';
  const invoiceSettings = await getSetting('invoice');

  return mutate(
    [
      database.sales,
      database.inventory_movements,
      database.stock_levels,
      database.product_serials,
      database.customer_ledger,
      database.coupons,
      database.kitchen_orders,
      database.number_blocks,
    ],
    async () => {
      const occurredAt = nowIso();
      const invoiceDate = businessDate(occurredAt, rt.timezone);
      const number = await allocateNumber(DOC_SERIES[cart.doc_type] ?? 'sale', invoiceDate);
      const saleId = uuidv7();
      const movementIds: Record<string, string> = {};

      const items: SaleItem[] = cart.lines.map((line, index) => {
        const calc = pricing.lines[index]!;
        return {
          id: uuidv7(),
          product_id: line.product_id,
          variant_id: line.variant_id,
          batch_id: line.batch_id,
          serial_ids: line.serial_ids,
          serial_numbers: line.serial_numbers,
          name: line.name,
          sku: line.sku,
          hsn_code: line.hsn_code,
          unit_code: line.unit_code,
          quantity: line.quantity,
          unit_price: effectiveUnitPrice(line),
          mrp: line.mrp,
          cost_price: line.cost_price,
          price_includes_tax: line.price_includes_tax,
          discount_type: line.discount_type,
          discount_value: line.discount_value,
          tax_rate_id: line.tax_rate_id,
          tax: line.tax,
          gross: calc.gross,
          line_discount: calc.line_discount,
          bill_discount: calc.bill_discount,
          taxable: calc.taxable,
          taxes: calc.taxes,
          tax_total: calc.tax_total,
          total: calc.total,
          returned_qty: 0,
          modifiers: line.modifiers,
          jewellery: line.jewellery,
          warranty_months: line.warranty_months,
          kitchen_order_id: line.kitchen_order_id,
          notes: line.notes,
        };
      });

      const payments: SalePayment[] = isInvoice
        ? input.payments
            .filter((p) => p.amount !== 0)
            .map((p) => ({
              id: uuidv7(),
              method: p.method,
              amount: roundTo(p.amount),
              reference: p.reference ?? null,
              tendered: p.tendered ?? null,
              change: p.change ?? null,
              old_gold: p.old_gold ?? null,
              occurred_at: occurredAt,
            }))
        : [];
      const paid = roundTo(payments.filter((p) => p.method !== 'credit').reduce((s, p) => s + p.amount, 0));
      const grand = pricing.grand_total;
      const paidTotal = Math.min(paid, grand);
      const balanceDue = isInvoice ? roundTo(Math.max(grand - paid, 0)) : 0;
      const changeDue = roundTo(payments.reduce((s, p) => s + (p.change ?? 0), 0));
      const loyaltyRedeemed = isInvoice ? cart.loyalty_redeem_points : 0;
      const loyaltyEarned = isInvoice && cart.customer_id ? (input.loyaltyEarned ?? 0) : 0;

      const sale: LocalSale = deriveSale({
        ...newEntityBase(saleId),
        store_id: rt.storeId,
        device_id: rt.deviceId,
        register_id: isInvoice ? input.registerId : null,
        customer_id: cart.customer_id,
        customer_name: cart.customer_name,
        customer_phone: cart.customer_phone,
        customer_gstin: cart.customer_gstin,
        doc_type: cart.doc_type,
        status: isInvoice ? 'completed' : 'draft',
        invoice_number: number.number,
        number_status: number.status,
        number_block_id: number.block_id,
        provisional_number: number.status === 'provisional' ? number.number : null,
        invoice_date: invoiceDate,
        occurred_at: occurredAt,
        due_date: null,
        supply_type: input.supplyType,
        place_of_supply: cart.customer_state ?? rt.stateCode,
        order_type: cart.order_type,
        table_id: cart.table_id,
        kitchen_order_ids: cart.kitchen_order_ids,
        items,
        payments,
        charges: cart.charges.map((c, i) => ({ ...c, taxable: pricing.charges[i]?.taxable ?? c.amount, tax_total: pricing.charges[i]?.tax_total ?? 0, total: pricing.charges[i]?.total ?? c.amount })),
        bill_discount_type: cart.bill_discount_type,
        bill_discount_value: cart.bill_discount_value,
        round_off_mode: isInvoice ? input.roundOff : 'none',
        gross_total: pricing.gross_total,
        line_discount_total: pricing.line_discount_total,
        bill_discount_total: pricing.bill_discount_total,
        discount_total: pricing.discount_total,
        taxable_total: pricing.taxable_total,
        tax_total: pricing.tax_total,
        charges_total: pricing.charges_total,
        round_off: pricing.round_off,
        grand_total: grand,
        paid_total: paidTotal,
        change_due: changeDue,
        balance_due: balanceDue,
        returned_total: 0,
        payment_status: !isInvoice ? 'unpaid' : balanceDue <= 0 ? 'paid' : paid > 0 ? 'partial' : 'unpaid',
        tax_breakup: pricing.tax_breakup,
        coupon_code: cart.coupon_code,
        loyalty_points_earned: loyaltyEarned,
        loyalty_points_redeemed: loyaltyRedeemed,
        converted_from_id: cart.converted_from_id,
        converted_to_id: null,
        valid_until: isInvoice ? null : addDays(invoiceDate, invoiceSettings.quotation_validity_days || 15),
        notes: cart.notes,
        created_by: rt.userId,
        created_by_name: rt.userName,
        cancelled_at: null,
        cancelled_by: null,
        cancel_reason: null,
        review_flags: [],
      } as Sale);

      // Stock: one movement per line (lines are split per batch / serial at the POS).
      if (STOCK_DOC_TYPES.has(cart.doc_type)) {
        for (const [index, line] of cart.lines.entries()) {
          if (!line.product_id || !line.track_inventory) continue;
          const item = items[index]!;
          const movement = await recordMovement({
            product_id: line.product_id,
            variant_id: line.variant_id,
            batch_id: line.batch_id,
            type: line.quantity > 0 ? 'SALE' : 'SALE_RETURN',
            qty_out: line.quantity > 0 ? line.quantity : 0,
            qty_in: line.quantity < 0 ? -line.quantity : 0,
            unit_cost: line.cost_price,
            reference_type: 'sale',
            reference_id: saleId,
            reference_no: number.number,
            occurred_at: occurredAt,
          });
          movementIds[item.id] = movement.id;
        }
      }

      if (isInvoice) {
        for (const line of cart.lines) {
          for (const serialId of line.serial_ids) {
            const serial = await database.product_serials.get(serialId);
            if (!serial) continue;
            const months = line.warranty_months ?? serial.warranty_months;
            await database.product_serials.put({
              ...serial,
              status: 'sold',
              sale_id: saleId,
              customer_id: cart.customer_id,
              sold_at: occurredAt,
              warranty_months: months,
              warranty_expires_at: months ? addMonths(invoiceDate, months) : null,
              _pending: 1,
            });
          }
        }
      }

      const ledgerIds: Record<string, string | null> = { sale: null, payment: null, loyalty_earn: null, loyalty_redeem: null };
      if (isInvoice && cart.customer_id) {
        const common = { customer_id: cart.customer_id, reference_type: 'sale', reference_id: saleId, reference_no: number.number, occurred_at: occurredAt };
        const saleEntry = customerLedgerEntry({ ...common, type: 'sale', debit: grand });
        await database.customer_ledger.put(saleEntry);
        ledgerIds.sale = saleEntry.id;
        const ledgerCredit = roundTo(payments.filter((p) => p.method !== 'credit' && p.method !== 'credit_note').reduce((s, p) => s + p.amount, 0));
        if (ledgerCredit > 0) {
          const paymentEntry = customerLedgerEntry({ ...common, type: 'sale_payment', credit: ledgerCredit });
          await database.customer_ledger.put(paymentEntry);
          ledgerIds.payment = paymentEntry.id;
        }
        if (loyaltyEarned > 0) {
          const earn = customerLedgerEntry({ ...common, type: 'loyalty_earn', points: loyaltyEarned });
          await database.customer_ledger.put(earn);
          ledgerIds.loyalty_earn = earn.id;
        }
        if (loyaltyRedeemed > 0) {
          const redeem = customerLedgerEntry({ ...common, type: 'loyalty_redeem', points: -loyaltyRedeemed });
          await database.customer_ledger.put(redeem);
          ledgerIds.loyalty_redeem = redeem.id;
        }
      }

      if (isInvoice && cart.coupon_code) {
        const coupon = await database.coupons.where('code').equals(cart.coupon_code.toUpperCase()).first();
        if (coupon) await database.coupons.put({ ...coupon, used_count: coupon.used_count + 1 });
      }
      for (const kotId of cart.kitchen_order_ids) {
        const kot = await database.kitchen_orders.get(kotId);
        if (kot) await database.kitchen_orders.put({ ...kot, sale_id: saleId, status: kot.status === 'cancelled' ? 'cancelled' : 'served' });
      }
      if (cart.converted_from_id) {
        const quote = await database.sales.get(cart.converted_from_id);
        if (quote) await database.sales.put({ ...quote, status: 'converted', converted_to_id: saleId });
      }

      await database.sales.put(sale);
      await enqueue({
        operation: 'CREATE_SALE',
        entity_id: saleId,
        payload: {
          ...toPayload(sale as unknown as Record<string, unknown>, ['created_by_name', 'provisional_number', 'review_flags', 'returned_total', 'converted_to_id', 'cancelled_at', 'cancelled_by', 'cancel_reason', 'device_id', 'created_by']),
          number_sequence: number.sequence,
          items: items.map((item) => ({ ...item, movement_id: movementIds[item.id] ?? null })),
          ledger_ids: ledgerIds,
        },
      });
      return sale;
    },
  );
}

function addMonths(date: string, months: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const target = new Date(Date.UTC(y!, m! - 1 + months, d!));
  return target.toISOString().slice(0, 10);
}

/** Cancel an invoice (requires sales.delete): reverses stock and the customer's balance locally. */
export async function cancelSale(saleId: string, reason: string): Promise<void> {
  const database = db();
  await mutate([database.sales, database.inventory_movements, database.stock_levels, database.product_serials, database.customer_ledger], async () => {
    const sale = await database.sales.get(saleId);
    if (!sale || sale.status === 'cancelled') return;
    const wasInvoice = sale.doc_type === 'invoice' && sale.status === 'completed';
    const movementIds: Record<string, string> = {};
    if (wasInvoice || sale.doc_type === 'delivery_challan') {
      for (const item of sale.items) {
        const remaining = roundTo(item.quantity - item.returned_qty, 3);
        if (item.product_id && remaining > 0) {
          const product = await database.products.get(item.product_id);
          if (product?.track_inventory && product.product_type !== 'service') {
            const movement = await recordMovement({
              store_id: sale.store_id,
              product_id: item.product_id,
              variant_id: item.variant_id,
              batch_id: item.batch_id,
              type: 'SALE_RETURN',
              qty_in: remaining,
              unit_cost: item.cost_price,
              reference_type: 'sale_cancel',
              reference_id: sale.id,
              reference_no: sale.invoice_number,
              notes: 'Invoice cancelled',
            });
            movementIds[item.id] = movement.id;
          }
        }
        for (const serialId of item.serial_ids) {
          const serial = await database.product_serials.get(serialId);
          if (serial?.sale_id === sale.id) {
            await database.product_serials.put({ ...serial, status: 'in_stock', sale_id: null, customer_id: null, sold_at: null, warranty_expires_at: null });
          }
        }
      }
    }
    if (wasInvoice && sale.customer_id) {
      const outstanding = roundTo(sale.grand_total - sale.returned_total);
      await database.customer_ledger.put(customerLedgerEntry({ customer_id: sale.customer_id, type: 'adjustment', credit: outstanding, reference_type: 'sale_cancel', reference_id: sale.id, reference_no: sale.invoice_number, notes: 'Invoice cancelled' }));
      const refund = roundTo(Math.min(sale.paid_total, outstanding));
      if (refund > 0) {
        await database.customer_ledger.put(customerLedgerEntry({ customer_id: sale.customer_id, type: 'refund', debit: refund, reference_type: 'sale_cancel', reference_id: sale.id, reference_no: sale.invoice_number, notes: 'Payment refunded on cancellation' }));
      }
    }
    await database.sales.put({ ...sale, status: 'cancelled', cancelled_at: nowIso(), cancelled_by: runtime().userId, cancel_reason: reason, _pending: 1 });
    await enqueue({ operation: 'CANCEL_SALE', entity_id: sale.id, payload: { reason, movement_ids: movementIds } });
  });
}

export interface ReturnLineInput {
  sale_item_id: string;
  quantity: number;
  restock: boolean;
  serial_ids?: string[];
}

/**
 * Pro-rata refund amounts from the original invoice line — the exact integer math used by the
 * server (SaleReturnService), so credit notes match to the paisa.
 */
export function returnAmounts(item: Pick<SaleItem, 'quantity' | 'taxable' | 'total'>, quantity: number, decimals = 2) {
  const sold = toScaled(item.quantity, QTY_SCALE);
  const qty = toScaled(quantity, QTY_SCALE);
  const taxable = sold ? mulDivRound(toScaled(item.taxable, decimals), qty, sold) : 0;
  const total = sold ? mulDivRound(toScaled(item.total, decimals), qty, sold) : 0;
  return { taxable: fromScaled(taxable, decimals), total: fromScaled(total, decimals), tax_total: fromScaled(total - taxable, decimals) };
}

export async function createSaleReturn(saleId: string, lines: ReturnLineInput[], refundMethod: RefundMethod, reason: string | null, registerId: string | null): Promise<SaleReturn> {
  const rt = runtime();
  const database = db();
  return mutate(
    [database.sales, database.sale_returns, database.inventory_movements, database.stock_levels, database.product_serials, database.customer_ledger, database.number_blocks],
    async () => {
      const sale = await database.sales.get(saleId);
      if (!sale) throw new Error('Invoice not found');
      const occurredAt = nowIso();
      const returnDate = businessDate(occurredAt, rt.timezone);
      const number = await allocateNumber('sale_return', returnDate);
      const returnId = uuidv7();
      const items: SaleReturnItem[] = [];
      const payloadItems: Array<Record<string, unknown>> = [];
      const updatedItems = sale.items.map((i) => ({ ...i }));

      for (const line of lines.filter((l) => l.quantity > 0)) {
        const item = updatedItems.find((i) => i.id === line.sale_item_id);
        if (!item) continue;
        const amounts = returnAmounts(item, line.quantity, rt.currencyDecimals);
        const returnItem: SaleReturnItem = {
          id: uuidv7(),
          sale_item_id: item.id,
          product_id: item.product_id,
          variant_id: item.variant_id,
          batch_id: item.batch_id,
          serial_ids: line.serial_ids ?? [],
          name: item.name,
          quantity: line.quantity,
          unit_price: item.unit_price,
          taxable: amounts.taxable,
          tax_total: amounts.tax_total,
          total: amounts.total,
          restock: line.restock,
        };
        items.push(returnItem);
        item.returned_qty = roundTo(item.returned_qty + line.quantity, 3);
        let movementId: string | null = null;
        const product = item.product_id ? await database.products.get(item.product_id) : undefined;
        if (line.restock && product?.track_inventory && product.product_type !== 'service') {
          const movement = await recordMovement({
            store_id: sale.store_id,
            product_id: product.id,
            variant_id: item.variant_id,
            batch_id: item.batch_id,
            type: 'SALE_RETURN',
            qty_in: line.quantity,
            unit_cost: item.cost_price,
            reference_type: 'sale_return',
            reference_id: returnId,
            reference_no: number.number,
            occurred_at: occurredAt,
          });
          movementId = movement.id;
        }
        for (const serialId of line.serial_ids ?? []) {
          const serial = await database.product_serials.get(serialId);
          if (serial?.sale_id === sale.id) {
            await database.product_serials.put({ ...serial, status: line.restock ? 'in_stock' : 'returned', sale_id: null, customer_id: null, sold_at: null, warranty_expires_at: null });
          }
        }
        payloadItems.push({ id: returnItem.id, sale_item_id: item.id, quantity: line.quantity, restock: line.restock, serial_ids: line.serial_ids ?? [], movement_id: movementId });
      }
      if (items.length === 0) throw new Error('Select at least one item to return.');

      const total = roundTo(items.reduce((s, i) => s + i.total, 0));
      const taxable = roundTo(items.reduce((s, i) => s + i.taxable, 0));
      const saleReturn: SaleReturn = {
        ...newEntityBase(returnId),
        store_id: sale.store_id,
        device_id: rt.deviceId,
        register_id: registerId,
        sale_id: sale.id,
        sale_number: sale.invoice_number,
        customer_id: sale.customer_id,
        return_number: number.number,
        number_status: number.status,
        return_date: returnDate,
        occurred_at: occurredAt,
        items,
        taxable_total: taxable,
        tax_total: roundTo(total - taxable),
        total,
        refund_method: refundMethod,
        reason,
        created_by: rt.userId,
      };
      await database.sale_returns.put({ ...saleReturn, _pending: 1 });
      await database.sales.put({ ...sale, items: updatedItems, returned_total: roundTo(sale.returned_total + total), _pending: 1 });

      const ledgerIds: Record<string, string | null> = { return: null, refund: null };
      if (sale.customer_id) {
        const common = { customer_id: sale.customer_id, reference_type: 'sale_return', reference_id: returnId, reference_no: number.number, occurred_at: occurredAt };
        const credit = customerLedgerEntry({ ...common, type: 'sale_return', credit: total });
        await database.customer_ledger.put(credit);
        ledgerIds.return = credit.id;
        if (refundMethod !== 'store_credit' && refundMethod !== 'exchange') {
          const refund = customerLedgerEntry({ ...common, type: 'refund', debit: total });
          await database.customer_ledger.put(refund);
          ledgerIds.refund = refund.id;
        }
      }
      await enqueue({
        operation: 'CREATE_SALE_RETURN',
        entity_id: returnId,
        payload: {
          sale_id: sale.id,
          store_id: sale.store_id,
          register_id: registerId,
          return_number: number.number,
          number_status: number.status,
          number_block_id: number.block_id,
          number_sequence: number.sequence,
          return_date: returnDate,
          occurred_at: occurredAt,
          refund_method: refundMethod,
          reason,
          items: payloadItems,
          ledger_ids: ledgerIds,
        },
      });
      return saleReturn;
    },
  );
}

/** Edit a draft quotation / estimate (replaces its lines). */
export async function updateQuotation(saleId: string, cart: CartState, pricing: PricingResult, supplyType: SupplyType): Promise<void> {
  const database = db();
  await mutate([database.sales], async () => {
    const sale = await database.sales.get(saleId);
    if (!sale || sale.doc_type === 'invoice' || sale.status !== 'draft') throw new Error('Only draft quotations can be edited.');
    const items: SaleItem[] = cart.lines.map((line, i) => {
      const calc = pricing.lines[i]!;
      return {
        ...(sale.items[i] ?? {}),
        id: uuidv7(),
        product_id: line.product_id,
        variant_id: line.variant_id,
        batch_id: line.batch_id,
        serial_ids: [],
        serial_numbers: [],
        name: line.name,
        sku: line.sku,
        hsn_code: line.hsn_code,
        unit_code: line.unit_code,
        quantity: line.quantity,
        unit_price: effectiveUnitPrice(line),
        mrp: line.mrp,
        cost_price: line.cost_price,
        price_includes_tax: line.price_includes_tax,
        discount_type: line.discount_type,
        discount_value: line.discount_value,
        tax_rate_id: line.tax_rate_id,
        tax: line.tax,
        gross: calc.gross,
        line_discount: calc.line_discount,
        bill_discount: calc.bill_discount,
        taxable: calc.taxable,
        taxes: calc.taxes,
        tax_total: calc.tax_total,
        total: calc.total,
        returned_qty: 0,
        modifiers: line.modifiers,
        jewellery: line.jewellery,
        warranty_months: line.warranty_months,
        kitchen_order_id: null,
        notes: line.notes,
      };
    });
    const next: LocalSale = deriveSale({
      ...sale,
      items,
      customer_id: cart.customer_id,
      customer_name: cart.customer_name,
      customer_phone: cart.customer_phone,
      bill_discount_type: cart.bill_discount_type,
      bill_discount_value: cart.bill_discount_value,
      gross_total: pricing.gross_total,
      line_discount_total: pricing.line_discount_total,
      bill_discount_total: pricing.bill_discount_total,
      discount_total: pricing.discount_total,
      taxable_total: pricing.taxable_total,
      tax_total: pricing.tax_total,
      round_off: pricing.round_off,
      grand_total: pricing.grand_total,
      tax_breakup: pricing.tax_breakup,
      supply_type: supplyType,
      notes: cart.notes,
      updated_at: nowIso(),
    });
    await database.sales.put({ ...next, _pending: 1 });
    await enqueue({
      operation: 'UPDATE_QUOTATION',
      entity_id: saleId,
      payload: {
        store_id: sale.store_id,
        doc_type: sale.doc_type,
        invoice_date: sale.invoice_date,
        occurred_at: sale.occurred_at,
        customer_id: cart.customer_id,
        customer_name: cart.customer_name,
        customer_phone: cart.customer_phone,
        supply_type: supplyType,
        bill_discount_type: cart.bill_discount_type,
        bill_discount_value: cart.bill_discount_value,
        round_off_mode: 'none',
        notes: cart.notes,
        items: items.map((i) => ({ ...i })),
      },
    });
  });
}

/* ---------------------------- Held sales (local only) ---------------------------- */

export async function holdSale(cart: CartState, total: number, label?: string): Promise<void> {
  const rt = runtime();
  const count = await db().held_sales.count();
  await db().held_sales.put({
    id: uuidv7(),
    label: label || cart.customer_name || `Hold #${count + 1}`,
    cart,
    total,
    item_count: cart.lines.length,
    created_at: nowIso(),
    created_by: rt.userId,
  });
}

export async function takeHeldSale(id: string): Promise<CartState | null> {
  const held = await db().held_sales.get(id);
  if (!held) return null;
  await db().held_sales.delete(id);
  return held.cart as CartState;
}

export const deleteHeldSale = (id: string) => db().held_sales.delete(id);
