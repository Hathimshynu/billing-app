import type { ReactNode } from 'react';
import { Controller, type Control, type FieldPath, type FieldValues } from 'react-hook-form';
import { cn } from '@/lib/utils';
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { NumberInput } from './number-input';

export function FormRow({
  label,
  htmlFor,
  error,
  description,
  children,
  required,
  className,
}: {
  label: ReactNode;
  htmlFor?: string;
  error?: string;
  description?: ReactNode;
  children: ReactNode;
  required?: boolean;
  className?: string;
}) {
  return (
    <Field data-invalid={!!error || undefined} className={className}>
      <FieldLabel htmlFor={htmlFor}>
        {label}
        {required ? <span className="text-destructive" aria-hidden> *</span> : null}
      </FieldLabel>
      {children}
      {description && !error ? <FieldDescription>{description}</FieldDescription> : null}
      {error ? <FieldError>{error}</FieldError> : null}
    </Field>
  );
}

export function FormGrid({ children, className, cols = 2 }: { children: ReactNode; className?: string; cols?: 1 | 2 | 3 }) {
  return <div className={cn('grid gap-4', cols === 2 && 'sm:grid-cols-2', cols === 3 && 'sm:grid-cols-2 lg:grid-cols-3', className)}>{children}</div>;
}

export function NumberField<T extends FieldValues>({
  control,
  name,
  label,
  decimals = 2,
  required,
  description,
  allowNegative,
  placeholder,
  className,
}: {
  control: Control<T>;
  name: FieldPath<T>;
  label: ReactNode;
  decimals?: number;
  required?: boolean;
  description?: ReactNode;
  allowNegative?: boolean;
  placeholder?: string;
  className?: string;
}) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <FormRow label={label} htmlFor={name} error={fieldState.error?.message} required={required} description={description} className={className}>
          <NumberInput
            id={name}
            value={field.value as number | null}
            onValueChange={(v) => field.onChange(v ?? (required ? 0 : null))}
            onBlur={field.onBlur}
            decimals={decimals}
            allowNegative={allowNegative}
            placeholder={placeholder}
            aria-invalid={!!fieldState.error}
          />
        </FormRow>
      )}
    />
  );
}

export function SelectField<T extends FieldValues>({
  control,
  name,
  label,
  options,
  placeholder,
  required,
  nullable,
  description,
  className,
}: {
  control: Control<T>;
  name: FieldPath<T>;
  label: ReactNode;
  options: Array<{ value: string; label: string }>;
  placeholder?: string;
  required?: boolean;
  nullable?: boolean;
  description?: ReactNode;
  className?: string;
}) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <FormRow label={label} htmlFor={name} error={fieldState.error?.message} required={required} description={description} className={className}>
          <Select value={(field.value as string | null) ?? '__none'} onValueChange={(v) => field.onChange(v === '__none' ? null : v)}>
            <SelectTrigger id={name} className="w-full" aria-invalid={!!fieldState.error}>
              <SelectValue placeholder={placeholder} />
            </SelectTrigger>
            <SelectContent>
              {nullable ? <SelectItem value="__none">{placeholder ?? '—'}</SelectItem> : null}
              {options.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormRow>
      )}
    />
  );
}

export function SwitchField<T extends FieldValues>({ control, name, label, description }: { control: Control<T>; name: FieldPath<T>; label: ReactNode; description?: ReactNode }) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field }) => (
        <label htmlFor={name} className="flex cursor-pointer items-start justify-between gap-4 rounded-lg border p-3 hover:bg-muted/40">
          <span className="space-y-0.5">
            <span className="block text-sm font-medium">{label}</span>
            {description ? <span className="block text-xs text-muted-foreground">{description}</span> : null}
          </span>
          <Switch id={name} checked={!!field.value} onCheckedChange={field.onChange} />
        </label>
      )}
    />
  );
}
