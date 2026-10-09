import {
  businessDate,
  formatDocumentNumber,
  numberingPeriod,
  provisionalNumber,
  type DocumentType,
  type NumberBlock,
} from '@shopdesk/shared';
import { apiData } from '../api';
import type { BusinessDb } from '../db/business';
import { db, getMeta, setMeta } from '../db/business';
import { runtime } from '../runtime';

export interface NumberAllocation {
  number: string;
  status: 'final' | 'provisional';
  block_id: string | null;
  sequence: number | null;
}

/** Document types this device keeps reserved numbers for, with block sizes. */
export const RESERVED_TYPES: Array<{ type: DocumentType; size: number }> = [
  { type: 'sale', size: 50 },
  { type: 'quotation', size: 10 },
  { type: 'sale_return', size: 10 },
  { type: 'customer_payment', size: 10 },
  { type: 'expense', size: 10 },
  { type: 'purchase', size: 10 },
  { type: 'purchase_order', size: 10 },
  { type: 'purchase_return', size: 5 },
  { type: 'supplier_payment', size: 10 },
];

function today(): string {
  const rt = runtime();
  return businessDate(new Date(), rt.timezone);
}

/**
 * Take the next number for a document. Must run inside a transaction that includes number_blocks
 * and meta. Uses a reserved block (final number, valid offline) or falls back to a provisional
 * number that the server replaces during sync.
 */
export async function allocateNumber(documentType: DocumentType, date: string = today()): Promise<NumberAllocation> {
  const rt = runtime();
  const database = db();
  const blocks = await database.number_blocks.where('document_type').equals(documentType).sortBy('start_number');
  for (const block of blocks) {
    if (block.next_number > block.end_number) continue;
    if (numberingPeriod(block.format, date, rt.fyStartMonth) !== block.period) continue;
    const sequence = block.next_number;
    await database.number_blocks.put({ ...block, next_number: sequence + 1 });
    return {
      number: formatDocumentNumber(block.format, {
        sequence,
        date,
        deviceCode: block.device_code ?? rt.deviceCode,
        storeCode: rt.storeCode,
        fyStartMonth: rt.fyStartMonth,
      }),
      status: 'final',
      block_id: block.id,
      sequence,
    };
  }
  const counter = ((await getMeta<number>('provisional_seq', database)) ?? 0) + 1;
  await setMeta('provisional_seq', counter, database);
  return { number: provisionalNumber(rt.deviceCode, counter), status: 'provisional', block_id: null, sequence: null };
}

/** Remaining reserved numbers for a type in the current period. */
async function remaining(database: BusinessDb, documentType: string, date: string): Promise<number> {
  const rt = runtime();
  const blocks = await database.number_blocks.where('document_type').equals(documentType).toArray();
  return blocks
    .filter((b) => numberingPeriod(b.format, date, rt.fyStartMonth) === b.period)
    .reduce((sum, b) => sum + Math.max(0, b.end_number - b.next_number + 1), 0);
}

/** Top up number blocks while online so the device can keep issuing final numbers offline. */
export async function ensureNumberBlocks(database: BusinessDb): Promise<void> {
  const date = today();
  const requests: Array<{ document_type: string; date: string; size: number }> = [];
  for (const { type, size } of RESERVED_TYPES) {
    const left = await remaining(database, type, date);
    if (left < Math.ceil(size * 0.3)) requests.push({ document_type: type, date, size });
  }
  if (requests.length === 0) return;
  const blocks = await apiData<NumberBlock[]>('/devices/number-blocks', { body: { requests } });
  await database.transaction('rw', database.number_blocks, async () => {
    // Drop exhausted blocks and blocks of past periods.
    const rt = runtime();
    const all = await database.number_blocks.toArray();
    for (const b of all) {
      if (b.next_number > b.end_number || numberingPeriod(b.format, date, rt.fyStartMonth) !== b.period) {
        await database.number_blocks.delete(b.id);
      }
    }
    await database.number_blocks.bulkPut(blocks);
  });
}
