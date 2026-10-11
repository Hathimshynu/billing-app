import { useTranslation } from 'react-i18next';
import { CloudOffIcon, CloudUploadIcon, FlagIcon } from 'lucide-react';
import { uuidv7, type Sale } from '@shopdesk/shared';
import { db, type LocalSale } from '@/lib/db/business';
import { emptyCart, type CartLine, type CartState } from '@/lib/pos/cart';
import { Badge } from '@/components/ui/badge';

export const DOC_LABELS: Record<string, string> = {
  invoice: 'Invoice',
  quotation: 'Quotation',
  estimate: 'Estimate',
  proforma: 'Proforma',
  delivery_challan: 'Delivery challan',
};

export const REVIEW_FLAG_LABELS: Record<string, string> = {
  totals_mismatch: 'Totals differ from server calculation',
  credit_limit_exceeded: 'Credit limit exceeded',
  expired_batch_sold: 'Expired batch sold',
  discount_without_permission: 'Discount given without permission',
  below_minimum_price: 'Sold below minimum price',
  credit_without_customer: 'Credit sale without customer',
  credit_without_permission: 'Credit given without permission',
  over_returned: 'Returned more than sold',
  price_override_without_permission: 'Sold below catalogue price without permission',
  tax_mismatch: 'Tax rate differs from the product tax rate',
  negative_line_without_permission: 'Returned lines entered without refund permission',
  loyalty_over_redeemed: 'More loyalty points redeemed than available',
  loyalty_invalid: 'Loyalty redeemed without a customer or while disabled',
  loyalty_mismatch: 'Loyalty points recalculated by the server',
  invalid_coupon: 'Invalid, expired or used-up coupon applied',
  serial_mismatch: 'IMEI/serial does not belong to the product sold',
  returned_after_cancel: 'Returned after the invoice was cancelled',
};

/** Status chips: cancelled / payment status / provisional number / waiting to sync / review flags. */
export function SaleBadges({ sale }: { sale: LocalSale }) {
  const { t } = useTranslation();
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {sale.status === 'cancelled' ? <Badge variant="destructive">{t('sale.cancelled', 'Cancelled')}</Badge> : null}
      {sale.status === 'converted' ? <Badge variant="secondary">{t('sale.converted', 'Converted')}</Badge> : null}
      {sale.doc_type === 'invoice' && sale.status === 'completed' ? (
        sale.payment_status === 'paid' ? (
          <Badge className="bg-success/15 text-success">{t('sale.paid', 'Paid')}</Badge>
        ) : sale.payment_status === 'partial' ? (
          <Badge className="bg-warning/20 text-foreground">{t('sale.partial', 'Partial')}</Badge>
        ) : (
          <Badge variant="outline" className="border-destructive/40 text-destructive">
            {t('sale.unpaid', 'Unpaid')}
          </Badge>
        )
      ) : null}
      {sale.number_status === 'provisional' ? (
        <Badge variant="outline" title={t('sale.provisional_hint', 'Final number is assigned when this device syncs')}>
          <CloudOffIcon /> {t('sale.provisional', 'Temporary no.')}
        </Badge>
      ) : null}
      {sale._pending ? (
        <Badge variant="outline">
          <CloudUploadIcon /> {t('sync.pending_short', 'pending')}
        </Badge>
      ) : null}
      {sale.review_flags?.length ? (
        <Badge variant="outline" className="border-warning text-foreground" title={sale.review_flags.map((f) => REVIEW_FLAG_LABELS[f] ?? f).join(', ')}>
          <FlagIcon /> {t('sale.review', 'Review')}
        </Badge>
      ) : null}
    </span>
  );
}

/** Rebuild a POS cart from a saved document (edit a quotation or convert it into an invoice). */
export async function saleToCart(sale: Sale, mode: 'edit' | 'convert'): Promise<CartState> {
  const productIds = [...new Set(sale.items.map((i) => i.product_id).filter((id): id is string => !!id))];
  const products = new Map((await db().products.bulkGet(productIds)).filter((p) => !!p).map((p) => [p!.id, p!]));
  const units = new Map((await db().units.toArray()).map((u) => [u.code, u]));
  const lines: CartLine[] = sale.items.map((item) => {
    const product = item.product_id ? products.get(item.product_id) : undefined;
    return {
      key: uuidv7(),
      product_id: item.product_id,
      variant_id: item.variant_id,
      batch_id: item.batch_id,
      batch_no: null,
      expiry_date: null,
      serial_ids: [],
      serial_numbers: [],
      name: item.name,
      sku: item.sku,
      hsn_code: item.hsn_code,
      unit_code: item.unit_code,
      allow_decimal: (item.unit_code ? units.get(item.unit_code)?.allow_decimal : undefined) ?? product?.product_type === 'weighed',
      quantity: item.quantity,
      unit_price: roundBase(item.unit_price, item.modifiers),
      list_price: roundBase(item.unit_price, item.modifiers),
      mrp: item.mrp,
      cost_price: item.cost_price,
      price_includes_tax: item.price_includes_tax,
      discount_type: item.discount_type,
      discount_value: item.discount_value,
      tax_rate_id: item.tax_rate_id,
      tax: item.tax,
      modifiers: item.modifiers,
      jewellery: item.jewellery,
      warranty_months: item.warranty_months,
      kitchen_order_id: null,
      notes: item.notes,
      track_inventory: product ? product.track_inventory && product.product_type !== 'service' : false,
      prescription_required: Boolean(product?.attributes?.prescription_required),
    };
  });
  return {
    ...emptyCart(),
    lines,
    customer_id: sale.customer_id,
    customer_name: sale.customer_name,
    customer_phone: sale.customer_phone,
    customer_gstin: sale.customer_gstin,
    customer_state: sale.place_of_supply,
    bill_discount_type: sale.bill_discount_type,
    bill_discount_value: sale.bill_discount_value,
    doc_type: mode === 'convert' ? 'invoice' : sale.doc_type,
    notes: sale.notes,
    converted_from_id: mode === 'convert' ? sale.id : null,
  };
}

/** Item unit price is stored including modifiers; the cart keeps them separate. */
function roundBase(unitPrice: number, modifiers: Array<{ price: number }>): number {
  return Math.round((unitPrice - modifiers.reduce((s, m) => s + m.price, 0)) * 100) / 100;
}
