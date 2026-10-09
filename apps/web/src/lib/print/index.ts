import type { KitchenOrder, PrinterSettings, Sale, SaleReturn } from '@shopdesk/shared';
import { db } from '../db/business';
import type { Formatter } from '../format';
import { runtime } from '../runtime';
import { getSetting } from '../settings';
import { renderCreditNote, renderKot, renderReceipt, type ReceiptContext } from './receipt';
import { openPreview, printer } from './printer';

export async function receiptContext(fmt: Formatter): Promise<ReceiptContext> {
  const rt = runtime();
  const database = db();
  const [business, store, invoice, printerSettings] = await Promise.all([
    database.business.get(rt.businessId),
    database.stores.get(rt.storeId),
    getSetting('invoice'),
    getSetting('printer'),
  ]);
  if (!business) throw new Error('Business details are not available yet.');
  return { business, store, invoice, printer: printerSettings, fmt };
}

export async function saleHtml(sale: Sale, fmt: Formatter, paper?: PrinterSettings['paper']): Promise<string> {
  const ctx = await receiptContext(fmt);
  return renderReceipt(sale, ctx, paper ?? ctx.printer.paper);
}

export async function printSale(sale: Sale, fmt: Formatter, paper?: PrinterSettings['paper']): Promise<void> {
  const ctx = await receiptContext(fmt);
  await printer.print(await renderReceipt(sale, ctx, paper ?? ctx.printer.paper), ctx.printer.copies || 1);
}

export async function previewSale(sale: Sale, fmt: Formatter, paper?: PrinterSettings['paper']): Promise<void> {
  openPreview(await saleHtml(sale, fmt, paper));
}

export async function printCreditNote(ret: SaleReturn, fmt: Formatter): Promise<void> {
  const ctx = await receiptContext(fmt);
  const sale = await db().sales.get(ret.sale_id);
  await printer.print(renderCreditNote(ret, sale, ctx));
}

export async function printKot(kot: KitchenOrder, fmt: Formatter): Promise<void> {
  const ctx = await receiptContext(fmt);
  const table = kot.table_id ? await db().restaurant_tables.get(kot.table_id) : undefined;
  await printer.print(renderKot(kot, table?.name ?? null, ctx));
}
