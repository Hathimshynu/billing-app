import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { roundQty, type Customer, type DiscountType, type OrderType, type SaleDocType, type SelectedModifier } from '@shopdesk/shared';
import { emptyCart, tierPrice, type CartCharge, type CartLine, type CartState } from '@/lib/pos/cart';

interface PosState extends CartState {
  /** Business the persisted cart belongs to (carts never leak across businesses). */
  businessId: string | null;
  selectedKey: string | null;
  /** Price tiers per product, kept to re-price lines when quantities change. */
  tiers: Record<string, Array<{ min_qty: number; price: number }>>;
  editingQuotationId: string | null;

  bind: (businessId: string) => void;
  addLine: (line: CartLine, tiers?: Array<{ min_qty: number; price: number }>) => void;
  setQuantity: (key: string, quantity: number) => void;
  increment: (key: string, delta: number) => void;
  removeLine: (key: string) => void;
  updateLine: (key: string, patch: Partial<CartLine>) => void;
  setLineDiscount: (key: string, type: DiscountType | null, value: number | null) => void;
  setModifiers: (key: string, modifiers: SelectedModifier[]) => void;
  select: (key: string | null) => void;
  setCustomer: (customer: Customer | null) => void;
  setBillDiscount: (type: DiscountType | null, value: number | null, coupon?: string | null) => void;
  setCharges: (charges: CartCharge[]) => void;
  setDocType: (docType: SaleDocType) => void;
  setOrderType: (orderType: OrderType, tableId?: string | null) => void;
  setNotes: (notes: string | null) => void;
  setLoyaltyRedeem: (points: number) => void;
  load: (cart: CartState, options?: { editingQuotationId?: string | null }) => void;
  clear: () => void;
}

const sameLine = (a: CartLine, b: CartLine) =>
  a.product_id === b.product_id &&
  a.variant_id === b.variant_id &&
  a.batch_id === b.batch_id &&
  a.serial_ids.length === 0 &&
  b.serial_ids.length === 0 &&
  !a.jewellery &&
  !b.jewellery &&
  a.modifiers.length === 0 &&
  b.modifiers.length === 0 &&
  !a.kitchen_order_id &&
  a.unit_price === a.list_price;

function reprice(line: CartLine, tiers: PosState['tiers']): CartLine {
  // Only re-apply tier pricing when the cashier has not overridden the price.
  if (!line.product_id || line.unit_price !== line.list_price) return line;
  const productTiers = tiers[line.product_id];
  if (!productTiers?.length) return line;
  const base = productTiers.find((t) => t.min_qty === 0)?.price ?? line.list_price;
  const price = tierPrice({ price_tiers: productTiers.filter((t) => t.min_qty > 0) }, base, line.quantity);
  return { ...line, unit_price: price, list_price: price };
}

export const usePos = create<PosState>()(
  persist(
    (set, get) => ({
      ...emptyCart(),
      businessId: null,
      selectedKey: null,
      tiers: {},
      editingQuotationId: null,

      bind: (businessId) => {
        if (get().businessId !== businessId) set({ ...emptyCart(), businessId, selectedKey: null, tiers: {}, editingQuotationId: null });
      },

      addLine: (line, tiers) =>
        set((state) => {
          const nextTiers = tiers && line.product_id ? { ...state.tiers, [line.product_id]: [{ min_qty: 0, price: line.list_price }, ...tiers] } : state.tiers;
          const existing = state.lines.find((l) => sameLine(l, line));
          if (existing) {
            const lines = state.lines.map((l) => (l.key === existing.key ? reprice({ ...l, quantity: roundQty(l.quantity + line.quantity) }, nextTiers) : l));
            return { lines, selectedKey: existing.key, tiers: nextTiers };
          }
          return { lines: [...state.lines, reprice(line, nextTiers)], selectedKey: line.key, tiers: nextTiers };
        }),

      setQuantity: (key, quantity) =>
        set((state) => ({
          lines: quantity <= 0 ? state.lines.filter((l) => l.key !== key) : state.lines.map((l) => (l.key === key ? reprice({ ...l, quantity: roundQty(quantity) }, state.tiers) : l)),
        })),

      increment: (key, delta) => {
        const line = get().lines.find((l) => l.key === key);
        if (!line) return;
        const next = roundQty(line.quantity + delta);
        if (next <= 0) get().removeLine(key);
        else get().setQuantity(key, next);
      },

      removeLine: (key) =>
        set((state) => {
          const lines = state.lines.filter((l) => l.key !== key);
          return { lines, selectedKey: state.selectedKey === key ? (lines.at(-1)?.key ?? null) : state.selectedKey };
        }),

      updateLine: (key, patch) => set((state) => ({ lines: state.lines.map((l) => (l.key === key ? { ...l, ...patch } : l)) })),

      setLineDiscount: (key, type, value) =>
        set((state) => ({ lines: state.lines.map((l) => (l.key === key ? { ...l, discount_type: value ? type : null, discount_value: value || null } : l)) })),

      setModifiers: (key, modifiers) => set((state) => ({ lines: state.lines.map((l) => (l.key === key ? { ...l, modifiers } : l)) })),

      select: (key) => set({ selectedKey: key }),

      setCustomer: (customer) =>
        set({
          customer_id: customer?.id ?? null,
          customer_name: customer?.name ?? null,
          customer_phone: customer?.phone ?? null,
          customer_gstin: customer?.gstin ?? null,
          customer_state: customer?.state_code ?? null,
          loyalty_redeem_points: 0,
        }),

      setBillDiscount: (type, value, coupon = null) => set({ bill_discount_type: value ? type : null, bill_discount_value: value || null, coupon_code: coupon }),
      setCharges: (charges) => set({ charges }),
      setDocType: (doc_type) => set({ doc_type }),
      setOrderType: (order_type, tableId) => set((state) => ({ order_type, table_id: tableId === undefined ? state.table_id : tableId })),
      setNotes: (notes) => set({ notes }),
      setLoyaltyRedeem: (points) => set({ loyalty_redeem_points: Math.max(0, Math.floor(points)) }),

      load: (cart, options) => set({ ...cart, selectedKey: cart.lines.at(-1)?.key ?? null, editingQuotationId: options?.editingQuotationId ?? null }),

      clear: () => set((state) => ({ ...emptyCart(), businessId: state.businessId, selectedKey: null, tiers: {}, editingQuotationId: null })),
    }),
    {
      name: 'shopdesk.pos-cart',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => {
        // Persist only data, never functions.
        const { bind: _b, addLine: _a, setQuantity: _q, increment: _i, removeLine: _r, updateLine: _u, setLineDiscount: _d, setModifiers: _m, select: _s, setCustomer: _c, setBillDiscount: _bd, setCharges: _ch, setDocType: _dt, setOrderType: _ot, setNotes: _n, setLoyaltyRedeem: _l, load: _lo, clear: _cl, ...data } = state;
        return data;
      },
    },
  ),
);

export function cartSnapshot(): CartState {
  const s = usePos.getState();
  return {
    lines: s.lines,
    customer_id: s.customer_id,
    customer_name: s.customer_name,
    customer_phone: s.customer_phone,
    customer_gstin: s.customer_gstin,
    customer_state: s.customer_state,
    bill_discount_type: s.bill_discount_type,
    bill_discount_value: s.bill_discount_value,
    coupon_code: s.coupon_code,
    charges: s.charges,
    doc_type: s.doc_type,
    order_type: s.order_type,
    table_id: s.table_id,
    kitchen_order_ids: s.kitchen_order_ids,
    notes: s.notes,
    converted_from_id: s.converted_from_id,
    loyalty_redeem_points: s.loyalty_redeem_points,
  };
}
