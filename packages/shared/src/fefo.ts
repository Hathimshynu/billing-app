/**
 * FEFO (First Expiry, First Out) batch allocation used by pharmacy / grocery batch-tracked stock.
 */
import { QTY_SCALE, fromScaled, toScaled } from './money';

export interface BatchStock {
  batch_id: string;
  batch_no?: string;
  /** ISO date (YYYY-MM-DD) or null when the batch does not expire. */
  expiry_date: string | null;
  available: number;
}

export interface BatchAllocation {
  batch_id: string;
  quantity: number;
  expired: boolean;
}

export interface FefoResult {
  allocations: BatchAllocation[];
  shortfall: number;
  usedExpired: boolean;
}

export type ExpiryStatus = 'expired' | 'near_expiry' | 'ok' | 'none';

/** Classify a batch expiry relative to `today` (YYYY-MM-DD). */
export function expiryStatus(expiryDate: string | null | undefined, today: string, nearExpiryDays = 90): ExpiryStatus {
  if (!expiryDate) return 'none';
  if (expiryDate < today) return 'expired';
  const diff = daysBetween(today, expiryDate);
  return diff <= nearExpiryDays ? 'near_expiry' : 'ok';
}

/** Whole days from a to b (both YYYY-MM-DD). */
export function daysBetween(a: string, b: string): number {
  const toUtc = (s: string) => {
    const [y, m, d] = s.slice(0, 10).split('-').map(Number);
    return Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1);
  };
  return Math.round((toUtc(b) - toUtc(a)) / 86_400_000);
}

/**
 * Allocate `quantity` across batches, earliest expiry first. Batches without expiry go last.
 * Expired batches are skipped unless `allowExpired` is set (requires an authorized administrator).
 */
export function allocateFefo(
  batches: BatchStock[],
  quantity: number,
  today: string,
  options: { allowExpired?: boolean } = {},
): FefoResult {
  const sorted = [...batches]
    .filter((b) => b.available > 0)
    .sort((a, b) => {
      if (a.expiry_date === b.expiry_date) return (a.batch_no ?? a.batch_id).localeCompare(b.batch_no ?? b.batch_id);
      if (a.expiry_date === null) return 1;
      if (b.expiry_date === null) return -1;
      return a.expiry_date.localeCompare(b.expiry_date);
    });
  let remaining = toScaled(quantity, QTY_SCALE);
  const allocations: BatchAllocation[] = [];
  let usedExpired = false;
  for (const batch of sorted) {
    if (remaining <= 0) break;
    const expired = batch.expiry_date !== null && batch.expiry_date < today;
    if (expired && !options.allowExpired) continue;
    const available = toScaled(batch.available, QTY_SCALE);
    const take = Math.min(available, remaining);
    if (take <= 0) continue;
    allocations.push({ batch_id: batch.batch_id, quantity: fromScaled(take, QTY_SCALE), expired });
    if (expired) usedExpired = true;
    remaining -= take;
  }
  return { allocations, shortfall: fromScaled(Math.max(remaining, 0), QTY_SCALE), usedExpired };
}
