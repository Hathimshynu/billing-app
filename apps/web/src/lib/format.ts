import { formatDateString, formatMoney, formatQty } from '@shopdesk/shared';
import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo } from 'react';
import { db, hasDb } from './db/business';
import { maybeRuntime } from './runtime';

export interface Formatter {
  money: (value: number | null | undefined) => string;
  number: (value: number | null | undefined) => string;
  qty: (value: number | null | undefined) => string;
  date: (value: string | null | undefined) => string;
  dateTime: (value: string | null | undefined) => string;
  time: (value: string | null | undefined) => string;
  relative: (value: string | null | undefined) => string;
  currency: string;
}

export function createFormatter(opts: { currency: string; locale: string; decimals: number; timezone: string; dateFormat: 'DD/MM/YYYY' | 'MM/DD/YYYY' | 'YYYY-MM-DD' }): Formatter {
  const time = new Intl.DateTimeFormat(opts.locale, { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: opts.timezone });
  const dayFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: opts.timezone, year: 'numeric', month: '2-digit', day: '2-digit' });
  const relative = new Intl.RelativeTimeFormat(opts.locale, { numeric: 'auto' });
  const toDay = (iso: string) => dayFormatter.format(new Date(iso));
  return {
    currency: opts.currency,
    money: (v) => formatMoney(v ?? 0, { currency: opts.currency, locale: opts.locale, decimals: opts.decimals }),
    number: (v) => (v ?? 0).toLocaleString(opts.locale, { maximumFractionDigits: opts.decimals }),
    qty: (v) => formatQty(v ?? 0),
    date: (v) => (v ? formatDateString(v.length > 10 ? toDay(v) : v, opts.dateFormat) : ''),
    dateTime: (v) => (v ? `${formatDateString(toDay(v), opts.dateFormat)} ${time.format(new Date(v))}` : ''),
    time: (v) => (v ? time.format(new Date(v)) : ''),
    relative: (v) => {
      if (!v) return '';
      const seconds = Math.round((new Date(v).getTime() - Date.now()) / 1000);
      const abs = Math.abs(seconds);
      if (abs < 45) return relative.format(Math.round(seconds), 'second');
      if (abs < 2700) return relative.format(Math.round(seconds / 60), 'minute');
      if (abs < 86_400) return relative.format(Math.round(seconds / 3600), 'hour');
      return relative.format(Math.round(seconds / 86_400), 'day');
    },
  };
}

const fallback = createFormatter({ currency: 'INR', locale: 'en-IN', decimals: 2, timezone: 'Asia/Kolkata', dateFormat: 'DD/MM/YYYY' });

/** Formatting bound to the open business (currency, locale, timezone, date format). */
export function useFormat(): Formatter {
  const business = useLiveQuery(async () => {
    const rt = maybeRuntime();
    return rt && hasDb() ? db().business.get(rt.businessId) : undefined;
  }, []);
  return useMemo(() => {
    if (!business) return fallback;
    return createFormatter({
      currency: business.currency,
      locale: business.locale || 'en-IN',
      decimals: business.currency_decimals ?? 2,
      timezone: business.timezone || 'Asia/Kolkata',
      dateFormat: business.date_format || 'DD/MM/YYYY',
    });
  }, [business]);
}

export { fallback as defaultFormatter };
