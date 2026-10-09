import { useTranslation } from 'react-i18next';
import { addDays, businessDate, startOfMonth } from '@shopdesk/shared';
import { maybeRuntime } from '@/lib/runtime';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export interface Range {
  from: string;
  to: string;
}

export function todayString(): string {
  return businessDate(new Date(), maybeRuntime()?.timezone ?? 'Asia/Kolkata');
}

export function presetRange(preset: string): Range {
  const today = todayString();
  switch (preset) {
    case 'yesterday':
      return { from: addDays(today, -1), to: addDays(today, -1) };
    case '7d':
      return { from: addDays(today, -6), to: today };
    case '30d':
      return { from: addDays(today, -29), to: today };
    case 'month':
      return { from: startOfMonth(today), to: today };
    case 'last_month': {
      const end = addDays(startOfMonth(today), -1);
      return { from: startOfMonth(end), to: end };
    }
    case 'fy': {
      const fyStart = maybeRuntime()?.fyStartMonth ?? 4;
      const [y, m] = today.split('-').map(Number);
      const year = m! >= fyStart ? y! : y! - 1;
      return { from: `${year}-${String(fyStart).padStart(2, '0')}-01`, to: today };
    }
    default:
      return { from: today, to: today };
  }
}

const PRESETS = [
  { value: 'today', label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: 'month', label: 'This month' },
  { value: 'last_month', label: 'Last month' },
  { value: 'fy', label: 'This financial year' },
];

export function DateRangePicker({ value, onChange }: { value: Range; onChange: (range: Range) => void }) {
  const { t } = useTranslation();
  const preset = PRESETS.find((p) => {
    const r = presetRange(p.value);
    return r.from === value.from && r.to === value.to;
  })?.value;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select value={preset ?? 'custom'} onValueChange={(v) => v !== 'custom' && onChange(presetRange(v))}>
        <SelectTrigger className="w-44" aria-label={t('range.period', 'Period')}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {PRESETS.map((p) => (
            <SelectItem key={p.value} value={p.value}>
              {t(`range.${p.value}`, p.label)}
            </SelectItem>
          ))}
          <SelectItem value="custom">{t('range.custom', 'Custom')}</SelectItem>
        </SelectContent>
      </Select>
      <Input type="date" className="w-40" value={value.from} max={value.to} onChange={(e) => e.target.value && onChange({ ...value, from: e.target.value })} aria-label={t('range.from', 'From')} />
      <span className="text-sm text-muted-foreground">–</span>
      <Input type="date" className="w-40" value={value.to} min={value.from} onChange={(e) => e.target.value && onChange({ ...value, to: e.target.value })} aria-label={t('range.to', 'To')} />
    </div>
  );
}
