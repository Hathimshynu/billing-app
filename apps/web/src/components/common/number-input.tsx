import { forwardRef, useEffect, useState, type ComponentProps } from 'react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

export interface NumberInputProps extends Omit<ComponentProps<'input'>, 'value' | 'onChange' | 'type'> {
  value: number | null | undefined;
  onValueChange: (value: number | null) => void;
  /** Maximum decimals accepted while typing (money 2, quantity 3). */
  decimals?: number;
  allowNegative?: boolean;
}

/**
 * Numeric input that keeps the user's text while typing ("12.", "0.0") and reports numbers.
 * Uses inputMode=decimal for a numeric keypad on phones and tablets.
 */
export const NumberInput = forwardRef<HTMLInputElement, NumberInputProps>(function NumberInput(
  { value, onValueChange, decimals = 2, allowNegative = false, className, onBlur, ...props },
  ref,
) {
  const [text, setText] = useState(value === null || value === undefined ? '' : String(value));

  useEffect(() => {
    const parsed = text === '' || text === '-' ? null : Number(text);
    if (parsed !== value && !(parsed === null && (value === null || value === undefined))) {
      setText(value === null || value === undefined ? '' : String(value));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const pattern = new RegExp(`^${allowNegative ? '-?' : ''}\\d*${decimals > 0 ? `(\\.\\d{0,${decimals}})?` : ''}$`);

  return (
    <Input
      ref={ref}
      type="text"
      inputMode="decimal"
      autoComplete="off"
      className={cn('money text-right', className)}
      value={text}
      onChange={(e) => {
        const next = e.target.value.replace(/,/g, '');
        if (!pattern.test(next)) return;
        setText(next);
        onValueChange(next === '' || next === '-' || next === '.' ? null : Number(next));
      }}
      onBlur={(e) => {
        if (text.endsWith('.')) setText(text.slice(0, -1));
        onBlur?.(e);
      }}
      {...props}
    />
  );
});
