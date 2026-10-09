import QRCode from 'qrcode';
import { amountInWords, INDIAN_STATES, PAYMENT_METHOD_LABELS, type Business, type InvoiceSettings, type KitchenOrder, type PrinterSettings, type Sale, type SaleReturn, type Store } from '@shopdesk/shared';
import type { Formatter } from '../format';

const esc = (value: unknown) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const DOC_TITLES: Record<string, string> = {
  invoice: 'TAX INVOICE',
  quotation: 'QUOTATION',
  estimate: 'ESTIMATE',
  proforma: 'PROFORMA INVOICE',
  delivery_challan: 'DELIVERY CHALLAN',
};

export interface ReceiptContext {
  business: Business;
  store: Store | undefined;
  invoice: InvoiceSettings;
  printer: PrinterSettings;
  fmt: Formatter;
}

function stateName(code: string | null | undefined) {
  return INDIAN_STATES.find((s) => s.code === code)?.name ?? code ?? '';
}

async function upiQr(ctx: ReceiptContext, sale: Sale): Promise<string> {
  if (!ctx.invoice.upi_id || sale.doc_type !== 'invoice' || sale.balance_due <= 0) return '';
  const params = new URLSearchParams({ pa: ctx.invoice.upi_id, pn: ctx.business.name, am: sale.balance_due.toFixed(2), cu: ctx.business.currency, tn: sale.invoice_number });
  const data = await QRCode.toDataURL(`upi://pay?${params.toString()}`, { margin: 1, width: 180 });
  return `<div class="center qr"><img src="${data}" alt="UPI QR" width="120" height="120"/><div class="muted">Scan to pay ${esc(ctx.fmt.money(sale.balance_due))} via UPI</div></div>`;
}

function savings(sale: Sale): number {
  return sale.items.reduce((sum, i) => (i.mrp && i.mrp > i.unit_price ? sum + (i.mrp - i.unit_price) * i.quantity : sum), 0);
}

const thermalCss = (width: string) => `
  @page { size: ${width} auto; margin: 0; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 6px 8px; width: ${width}; font: 12px/1.35 ui-monospace, 'Cascadia Mono', Menlo, Consolas, monospace; color: #000; }
  .center { text-align: center; } .right { text-align: right; } .bold { font-weight: 700; } .muted { color: #333; font-size: 11px; }
  h1 { font-size: 15px; margin: 0 0 2px; } hr { border: 0; border-top: 1px dashed #000; margin: 6px 0; }
  table { width: 100%; border-collapse: collapse; } td { vertical-align: top; padding: 1px 0; }
  .total td { font-size: 14px; font-weight: 700; padding-top: 3px; } .qr img { margin-top: 6px; }
`;

const a4Css = `
  @page { size: A4; margin: 12mm; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 11px/1.45 'Inter', 'Segoe UI', Arial, sans-serif; color: #111; }
  .right { text-align: right; } .center { text-align: center; } .bold { font-weight: 700; } .muted { color: #555; }
  .head { display: flex; justify-content: space-between; border-bottom: 2px solid #111; padding-bottom: 8px; margin-bottom: 10px; }
  h1 { font-size: 20px; margin: 0; } .doc-title { font-size: 14px; font-weight: 700; letter-spacing: .08em; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 10px; }
  .box { border: 1px solid #ccc; border-radius: 6px; padding: 8px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 10px; }
  th { background: #f3f4f6; text-align: left; font-weight: 600; } th, td { border: 1px solid #ddd; padding: 5px 6px; }
  .totals { width: 45%; margin-left: auto; } .totals td { border: 0; padding: 3px 6px; } .grand td { border-top: 2px solid #111; font-size: 14px; font-weight: 700; }
  .foot { margin-top: 14px; display: flex; justify-content: space-between; gap: 20px; } .sign { margin-top: 40px; border-top: 1px solid #111; padding-top: 4px; width: 200px; text-align: center; }
  .qr img { width: 110px; height: 110px; }
`;

export async function renderReceipt(sale: Sale, ctx: ReceiptContext, paper: PrinterSettings['paper'] = ctx.printer.paper): Promise<string> {
  return paper === 'a4' ? renderA4(sale, ctx) : renderThermal(sale, ctx, paper === '58mm' ? '58mm' : '80mm');
}

async function renderThermal(sale: Sale, ctx: ReceiptContext, width: '58mm' | '80mm'): Promise<string> {
  const { business, fmt } = ctx;
  const narrow = width === '58mm';
  const lines = sale.items
    .map(
      (i) => `<tr><td colspan="3">${esc(i.name)}${i.serial_numbers.length ? `<div class="muted">IMEI/SN: ${esc(i.serial_numbers.join(', '))}</div>` : ''}${i.modifiers.length ? `<div class="muted">+ ${esc(i.modifiers.map((m) => m.option).join(', '))}</div>` : ''}</td></tr>
      <tr><td class="muted">${fmt.qty(i.quantity)} × ${esc(fmt.number(i.unit_price))}</td><td></td><td class="right">${esc(fmt.number(i.total))}</td></tr>`,
    )
    .join('');
  const taxes = sale.tax_breakup.map((t) => `<tr><td>${esc(t.code)} ${t.rate}%</td><td class="right">${esc(fmt.number(t.amount))}</td></tr>`).join('');
  const payments = sale.payments
    .map((p) => `<tr><td>${esc(PAYMENT_METHOD_LABELS[p.method] ?? p.method)}${p.reference ? ` (${esc(p.reference)})` : ''}</td><td class="right">${esc(fmt.number(p.amount))}</td></tr>`)
    .join('');
  const saved = savings(sale);
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(sale.invoice_number)}</title><style>${thermalCss(width)}</style></head><body>
    <div class="center">
      ${ctx.printer.header_text ? `<div class="muted">${esc(ctx.printer.header_text)}</div>` : ''}
      <h1>${esc(business.name)}</h1>
      ${business.address ? `<div class="muted">${esc(business.address)}${business.city ? `, ${esc(business.city)}` : ''}</div>` : ''}
      ${business.phone ? `<div class="muted">Ph: ${esc(business.phone)}</div>` : ''}
      ${business.gstin ? `<div class="muted">GSTIN: ${esc(business.gstin)}</div>` : ''}
      <div class="bold" style="margin-top:4px">${DOC_TITLES[sale.doc_type] ?? 'INVOICE'}</div>
    </div>
    <hr/>
    <table><tr><td>No: <span class="bold">${esc(sale.invoice_number)}</span></td><td class="right">${esc(fmt.date(sale.invoice_date))}</td></tr>
    <tr><td>${esc(fmt.time(sale.occurred_at))}</td><td class="right">${esc(sale.created_by_name ?? '')}</td></tr></table>
    ${sale.number_status === 'provisional' ? '<div class="muted">Provisional number — final number assigned on sync</div>' : ''}
    ${sale.customer_name ? `<div>Customer: ${esc(sale.customer_name)}${sale.customer_phone ? ` (${esc(sale.customer_phone)})` : ''}</div>` : ''}
    ${sale.customer_gstin ? `<div class="muted">GSTIN: ${esc(sale.customer_gstin)}</div>` : ''}
    <hr/>
    <table>${lines}</table>
    <hr/>
    <table>
      <tr><td>Items: ${sale.items.length} · Qty: ${esc(fmt.qty(sale.items.reduce((s, i) => s + i.quantity, 0)))}</td><td class="right">${esc(fmt.number(sale.gross_total))}</td></tr>
      ${sale.discount_total ? `<tr><td>Discount</td><td class="right">-${esc(fmt.number(sale.discount_total))}</td></tr>` : ''}
      ${sale.charges.map((c) => `<tr><td>${esc(c.name)}</td><td class="right">${esc(fmt.number(c.total))}</td></tr>`).join('')}
      ${taxes}
      ${sale.round_off ? `<tr><td>Round off</td><td class="right">${esc(fmt.number(sale.round_off))}</td></tr>` : ''}
      <tr class="total"><td>TOTAL</td><td class="right">${esc(fmt.money(sale.grand_total))}</td></tr>
    </table>
    ${payments ? `<hr/><table>${payments}${sale.change_due ? `<tr><td>Change</td><td class="right">${esc(fmt.number(sale.change_due))}</td></tr>` : ''}${sale.balance_due ? `<tr><td class="bold">Balance due</td><td class="right bold">${esc(fmt.number(sale.balance_due))}</td></tr>` : ''}</table>` : ''}
    ${ctx.invoice.show_mrp_savings && saved > 0.004 ? `<hr/><div class="center bold">You saved ${esc(fmt.money(saved))} on MRP!</div>` : ''}
    ${narrow ? '' : `<div class="muted" style="margin-top:4px">${esc(amountInWords(sale.grand_total, business.currency === 'INR' ? {} : { major: business.currency, minor: '', system: 'international' }))}</div>`}
    ${await upiQr(ctx, sale)}
    <hr/>
    ${ctx.invoice.terms ? `<div class="muted center">${esc(ctx.invoice.terms)}</div>` : ''}
    <div class="center bold" style="margin-top:4px">${esc(ctx.printer.footer_text || ctx.invoice.footer)}</div>
  </body></html>`;
}

async function renderA4(sale: Sale, ctx: ReceiptContext): Promise<string> {
  const { business, fmt } = ctx;
  const hsn = new Map<string, { taxable: number; tax: number; rate: number }>();
  for (const i of sale.items) {
    const key = `${i.hsn_code ?? '—'}|${i.tax?.rate ?? 0}`;
    const row = hsn.get(key) ?? { taxable: 0, tax: 0, rate: i.tax?.rate ?? 0 };
    row.taxable += i.taxable;
    row.tax += i.tax_total;
    hsn.set(key, row);
  }
  const rows = sale.items
    .map(
      (i, n) => `<tr><td>${n + 1}</td><td>${esc(i.name)}${i.serial_numbers.length ? `<div class="muted">SN/IMEI: ${esc(i.serial_numbers.join(', '))}</div>` : ''}${i.jewellery ? `<div class="muted">${esc(i.jewellery.purity)} · Net ${i.jewellery.net_weight}g @ ${esc(fmt.number(i.jewellery.rate_per_gram))}/g · Making ${esc(fmt.number(i.jewellery.making_charges))}${i.jewellery.huid ? ` · HUID ${esc(i.jewellery.huid)}` : ''}</div>` : ''}</td>
      <td>${esc(i.hsn_code ?? '')}</td><td class="right">${esc(fmt.qty(i.quantity))} ${esc(i.unit_code ?? '')}</td><td class="right">${esc(fmt.number(i.unit_price))}</td>
      <td class="right">${esc(fmt.number(i.line_discount + i.bill_discount))}</td><td class="right">${esc(fmt.number(i.taxable))}</td><td class="right">${i.tax?.rate ?? 0}%</td><td class="right">${esc(fmt.number(i.total))}</td></tr>`,
    )
    .join('');
  const hsnRows = [...hsn.entries()]
    .map(([key, v]) => `<tr><td>${esc(key.split('|')[0])}</td><td class="right">${esc(fmt.number(v.taxable))}</td><td class="right">${v.rate}%</td><td class="right">${esc(fmt.number(v.tax))}</td></tr>`)
    .join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(sale.invoice_number)}</title><style>${a4Css}</style></head><body>
    <div class="head">
      <div><h1>${esc(business.name)}</h1>
        <div class="muted">${esc([business.address, business.city, business.pincode].filter(Boolean).join(', '))}</div>
        <div class="muted">${business.phone ? `Phone: ${esc(business.phone)}` : ''} ${business.email ? ` · ${esc(business.email)}` : ''}</div>
        ${business.gstin ? `<div><span class="bold">GSTIN:</span> ${esc(business.gstin)} · State: ${esc(stateName(business.state_code))} (${esc(business.state_code)})</div>` : ''}
      </div>
      <div class="right"><div class="doc-title">${DOC_TITLES[sale.doc_type] ?? 'INVOICE'}</div>
        <div>No: <span class="bold">${esc(sale.invoice_number)}</span></div>
        <div>Date: ${esc(fmt.date(sale.invoice_date))}</div>
        ${sale.valid_until ? `<div>Valid until: ${esc(fmt.date(sale.valid_until))}</div>` : ''}
        ${sale.number_status === 'provisional' ? '<div class="muted">Provisional number</div>' : ''}
      </div>
    </div>
    <div class="grid">
      <div class="box"><div class="muted">Bill to</div><div class="bold">${esc(sale.customer_name ?? 'Walk-in customer')}</div>
        ${sale.customer_phone ? `<div>${esc(sale.customer_phone)}</div>` : ''}${sale.customer_gstin ? `<div>GSTIN: ${esc(sale.customer_gstin)}</div>` : ''}</div>
      <div class="box"><div class="muted">Place of supply</div><div>${esc(stateName(sale.place_of_supply))}</div>
        <div class="muted">Supply: ${sale.supply_type === 'inter' ? 'Inter-state (IGST)' : sale.supply_type === 'none' ? '—' : 'Intra-state (CGST + SGST)'}</div></div>
    </div>
    <table><thead><tr><th>#</th><th>Item</th><th>HSN/SAC</th><th class="right">Qty</th><th class="right">Rate</th><th class="right">Disc.</th><th class="right">Taxable</th><th class="right">GST</th><th class="right">Amount</th></tr></thead><tbody>${rows}</tbody></table>
    ${ctx.invoice.show_hsn_summary && hsnRows ? `<table style="width:60%"><thead><tr><th>HSN/SAC</th><th class="right">Taxable value</th><th class="right">Rate</th><th class="right">Tax</th></tr></thead><tbody>${hsnRows}</tbody></table>` : ''}
    <table class="totals">
      <tr><td>Taxable value</td><td class="right">${esc(fmt.number(sale.taxable_total))}</td></tr>
      ${sale.tax_breakup.map((t) => `<tr><td>${esc(t.code)} @ ${t.rate}%</td><td class="right">${esc(fmt.number(t.amount))}</td></tr>`).join('')}
      ${sale.charges.map((c) => `<tr><td>${esc(c.name)}</td><td class="right">${esc(fmt.number(c.taxable))}</td></tr>`).join('')}
      ${sale.round_off ? `<tr><td>Round off</td><td class="right">${esc(fmt.number(sale.round_off))}</td></tr>` : ''}
      <tr class="grand"><td>Total</td><td class="right">${esc(fmt.money(sale.grand_total))}</td></tr>
      ${sale.paid_total ? `<tr><td>Paid</td><td class="right">${esc(fmt.number(sale.paid_total))}</td></tr>` : ''}
      ${sale.balance_due ? `<tr><td class="bold">Balance due</td><td class="right bold">${esc(fmt.number(sale.balance_due))}</td></tr>` : ''}
    </table>
    <div><span class="bold">Amount in words:</span> ${esc(amountInWords(sale.grand_total, business.currency === 'INR' ? {} : { major: business.currency, minor: '', system: 'international' }))}</div>
    <div class="foot">
      <div style="flex:1">
        ${ctx.invoice.bank_details ? `<div class="bold">Bank details</div><div style="white-space:pre-line">${esc(ctx.invoice.bank_details)}</div>` : ''}
        ${ctx.invoice.terms ? `<div class="bold" style="margin-top:6px">Terms</div><div class="muted" style="white-space:pre-line">${esc(ctx.invoice.terms)}</div>` : ''}
      </div>
      ${await upiQr(ctx, sale)}
      <div><div class="sign">For ${esc(business.name)}<br/><span class="muted">Authorised signatory</span></div></div>
    </div>
  </body></html>`;
}

export function renderCreditNote(ret: SaleReturn, sale: Sale | undefined, ctx: ReceiptContext): string {
  const { business, fmt } = ctx;
  const rows = ret.items.map((i) => `<tr><td>${esc(i.name)}</td><td class="right">${esc(fmt.qty(i.quantity))}</td><td class="right">${esc(fmt.number(i.total))}</td></tr>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(ret.return_number)}</title><style>${thermalCss('80mm')}</style></head><body>
    <div class="center"><h1>${esc(business.name)}</h1>${business.gstin ? `<div class="muted">GSTIN: ${esc(business.gstin)}</div>` : ''}<div class="bold">CREDIT NOTE</div></div><hr/>
    <div>No: <span class="bold">${esc(ret.return_number)}</span> · ${esc(fmt.date(ret.return_date))}</div>
    <div>Against invoice: ${esc(sale?.invoice_number ?? ret.sale_number)}</div><hr/>
    <table>${rows}</table><hr/>
    <table><tr><td>Tax included</td><td class="right">${esc(fmt.number(ret.tax_total))}</td></tr><tr class="total"><td>REFUND</td><td class="right">${esc(fmt.money(ret.total))}</td></tr>
    <tr><td>Mode</td><td class="right">${esc(ret.refund_method.replace('_', ' '))}</td></tr></table>
    ${ret.reason ? `<div class="muted">Reason: ${esc(ret.reason)}</div>` : ''}
  </body></html>`;
}

/** Kitchen order ticket: large item names and quantities, no prices. */
export function renderKot(kot: KitchenOrder, tableName: string | null, ctx: ReceiptContext): string {
  const width = ctx.printer.kot_paper === '58mm' ? '58mm' : '80mm';
  const rows = kot.items
    .map(
      (i) => `<tr><td class="bold" style="font-size:15px">${esc(i.quantity)} ×</td><td style="font-size:15px">${esc(i.name)}${
        i.modifiers.length ? `<div class="muted">+ ${esc(i.modifiers.map((m) => m.option).join(', '))}</div>` : ''
      }${i.notes ? `<div class="muted">» ${esc(i.notes)}</div>` : ''}</td></tr>`,
    )
    .join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>KOT ${esc(kot.kot_number)}</title><style>${thermalCss(width)}</style></head><body>
    <div class="center"><h1>${kot.is_void ? 'VOID ' : ''}KOT ${esc(kot.kot_number)}</h1>
    <div class="bold">${esc(tableName ? `Table ${tableName}` : kot.order_type.replace('_', ' ').toUpperCase())}${kot.guests ? ` · ${esc(kot.guests)} guests` : ''}</div>
    <div class="muted">${esc(ctx.fmt.dateTime(kot.occurred_at))}</div></div><hr/>
    <table>${rows}</table>${kot.notes ? `<hr/><div>${esc(kot.notes)}</div>` : ''}
  </body></html>`;
}
