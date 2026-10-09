/**
 * Business-timezone aware date helpers. Businesses operate in their own timezone (default
 * Asia/Kolkata); "today" and report grouping must follow that timezone, not the device's UTC offset.
 */

const partsCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let f = partsCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
    partsCache.set(timeZone, f);
  }
  return f;
}

/** YYYY-MM-DD of an instant in the given timezone. */
export function businessDate(instant: Date | string | number = new Date(), timeZone = 'Asia/Kolkata'): string {
  const date = instant instanceof Date ? instant : new Date(instant);
  const parts = formatterFor(timeZone).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** Hour (0-23) of an instant in the given timezone. */
export function businessHour(instant: Date | string | number, timeZone = 'Asia/Kolkata'): number {
  const date = instant instanceof Date ? instant : new Date(instant);
  const parts = formatterFor(timeZone).formatToParts(date);
  return Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
}

/** Add days to a YYYY-MM-DD date. */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const utc = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, (d ?? 1) + days));
  return utc.toISOString().slice(0, 10);
}

/** First day of the month of a YYYY-MM-DD date. */
export function startOfMonth(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

/** Format YYYY-MM-DD as DD/MM/YYYY (India default) or other patterns. */
export function formatDateString(date: string | null | undefined, pattern: 'DD/MM/YYYY' | 'MM/DD/YYYY' | 'YYYY-MM-DD' = 'DD/MM/YYYY'): string {
  if (!date) return '';
  const [y, m, d] = date.slice(0, 10).split('-');
  switch (pattern) {
    case 'MM/DD/YYYY':
      return `${m}/${d}/${y}`;
    case 'YYYY-MM-DD':
      return `${y}-${m}-${d}`;
    default:
      return `${d}/${m}/${y}`;
  }
}

/** ISO-8601 timestamp for "now" (UTC). All timestamps are stored in UTC. */
export function nowIso(): string {
  return new Date().toISOString();
}
